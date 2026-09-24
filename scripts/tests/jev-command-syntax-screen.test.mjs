/* SPDX-License-Identifier: Apache-2.0 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  prepare,
  project,
  inverse,
  decode,
  score,
  captureFetch,
  sha,
  equivalentLabelTokens,
  runCase,
  createQueuedReceiptWriter,
} from "../jev-command-syntax-screen.mjs";
const synthetic = (c) => ({
  model: "typesafe/jev-1.13-20260917",
  provider: "TypeSafe",
  id: "synthetic-" + c.caseId,
  usage: { input_tokens: 1, output_tokens: 1, cost: 0 },
  answers: Object.fromEntries(
    c.questionIds.map((id) => [
      id,
      {
        type: "choice",
        choice: c.expected[id],
        confidence: 1,
        probabilities: {
          match: c.expected[id] === "match" ? 1 : 0,
          no_match: c.expected[id] === "match" ? 0 : 1,
        },
      },
    ]),
  ),
});
let prepared;
test("prepare retains all source rows without wire labels or key access", async () => {
  const prior = process.env.SF_GUARDRAIL_JEV_API_KEY;
  process.env.SF_GUARDRAIL_JEV_API_KEY = "invalid\nkey";
  try {
    prepared = await prepare();
    assert.equal(prepared.plan.cases.length, 26);
    assert.equal(
      prepared.plan.cases.reduce((s, c) => s + c.questionIds.length, 0),
      1617,
    );
    assert(prepared.maxRequestBytes <= 32768);
    for (const c of prepared.plan.cases) {
      const b = JSON.parse(c.json);
      assert.deepEqual(Object.keys(b.questions), c.questionIds);
      for (const key of [
        "expected",
        "sourceSingletonChoice",
        "sourceWinner",
        "syntaxLabel",
        "matchedRules",
      ])
        assert(!c.json.includes('"' + key + '"'));
      const old = structuredClone(b);
      old.state.version = 37;
      delete old.state.syntaxInstruction.boundary;
      for (const q of Object.values(old.questions)) delete q.instructions.rule;
      assert.deepEqual(inverse(b, old), old);
      assert.equal(sha(c.json), c.requestHash);
    }
  } finally {
    if (prior === undefined) delete process.env.SF_GUARDRAIL_JEV_API_KEY;
    else process.env.SF_GUARDRAIL_JEV_API_KEY = prior;
  }
});
test("literal rules bind the actual selector namespaces for all nine kinds", () => {
  const seen = new Set();
  for (const c of prepared.plan.cases) {
    const b = JSON.parse(c.json);
    for (const q of Object.values(b.questions)) {
      seen.add(q.instructions.selector.kind);
      assert.equal(typeof q.instructions.rule, "string");
      assert(!q.instructions.rule.includes("row."));
      assert(!q.instructions.rule.includes("operation.metadata.commandTokens"));
    }
    assert(b.state.syntaxInstruction.boundary.includes("no intervening token ID"));
    assert(b.state.syntaxInstruction.boundary.includes("numeric ID is still supplied"));
  }
  assert.equal(seen.size, 8); // The paid cohort has no empty selector. Test that source kind separately.
  const old = JSON.parse(prepared.plan.cases[0].json);
  old.state.version = 37;
  delete old.state.syntaxInstruction.boundary;
  for (const q of Object.values(old.questions)) delete q.instructions.rule;
  old.questions.r_a.instructions.selector = { kind: "empty", publicNames: {} };
  const empty = project(old);
  assert.equal(empty.questions.r_a.instructions.rule, old.state.matchGrammar.empty);
  seen.add("empty");
  assert.equal(seen.size, 9);
});
test("inverse rejects added outcome fields and overflow instead of dropping rows", () => {
  const b = JSON.parse(prepared.plan.cases[0].json);
  const old = structuredClone(b);
  old.state.version = 37;
  delete old.state.syntaxInstruction.boundary;
  for (const q of Object.values(old.questions)) delete q.instructions.rule;
  b.questions.r_a.instructions.matched = true;
  assert.throws(() => inverse(b, old));
  old.state.commandTokens.extra = "x".repeat(32768);
  assert.throws(() => project(old), /request-too-large/);
});
test("current strict stage decoder preserves raw probabilities and exact origin", async () => {
  const c = prepared.plan.cases[0];
  const bytes = Buffer.from(JSON.stringify(synthetic(c)));
  const d = await decode(bytes, 200, JSON.parse(c.json));
  assert.equal(d.responseHash, sha(bytes));
  assert.equal(d.requestHash, c.requestHash);
  assert.deepEqual(Object.keys(d.answers), c.questionIds);
  assert.deepEqual(d.answers.r_a.probabilities, { match: 0, no_match: 1 });
});
for (const mode of [
  "extra-answer-key",
  "missing-answer",
  "wrong-pin",
  "bad-probability",
  "bad-usage",
  "duplicate-key",
  "invalid-utf8",
  "http-error",
])
  test("strict decoder rejects " + mode, async () => {
    const c = prepared.plan.cases[0];
    const v = synthetic(c);
    let status = 200,
      bytes;
    if (mode === "extra-answer-key") v.answers.r_a.extra = true;
    if (mode === "missing-answer") delete v.answers.r_a;
    if (mode === "wrong-pin") v.provider = "AnotherProvider";
    if (mode === "bad-probability") v.answers.r_a.probabilities = { match: 0.9, no_match: 0.9 };
    if (mode === "bad-usage") v.usage.input_tokens = -1;
    if (mode === "http-error") status = 500;
    bytes = Buffer.from(JSON.stringify(v));
    if (mode === "duplicate-key")
      bytes = Buffer.from(
        bytes.toString().replace('"confidence":1', '"confidence":1,"confidence":1'),
      );
    if (mode === "invalid-utf8") bytes = Buffer.from([0xff]);
    await assert.rejects(() => decode(bytes, status, JSON.parse(c.json)));
  });
test("capture observes actual bytes, blocks extra sends and rejects a key in the reply", async () => {
  const c = prepared.plan.cases[0],
    capture = {};
  const fetch = captureFetch(capture, async () => new Response(JSON.stringify(synthetic(c))));
  const response = await fetch("https://decisions.example.test", {
    body: c.json,
    headers: { Authorization: "Bearer synthetic-key" },
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(capture.postedBody, c.json);
  assert.equal(capture.complete, true);
  assert.equal(sha(capture.raw), sha(bytes));
  assert.equal(capture.actualCalls, 1);
  await assert.rejects(() =>
    fetch("https://decisions.example.test", {
      body: c.json,
      headers: { Authorization: "Bearer synthetic-key" },
    }),
  );
  const keyFetch = captureFetch({}, async () => new Response("synthetic-key"));
  const leak = await keyFetch("https://decisions.example.test", {
    body: c.json,
    headers: { Authorization: "Bearer synthetic-key" },
  });
  await assert.rejects(() => leak.arrayBuffer());
});
test("score rejects copied flags, missing, extra, duplicate-ID and late results", async () => {
  const results = [];
  for (const c of prepared.plan.cases) {
    results.push({
      caseId: c.caseId,
      requestHash: c.requestHash,
      valid: true,
      totalLatencyMs: 1,
      decoded: await decode(Buffer.from(JSON.stringify(synthetic(c))), 200, JSON.parse(c.json)),
    });
  }
  assert.equal(score(prepared.plan, results).targetsPassed, true);
  assert.equal(score(prepared.plan, structuredClone(results)).targetsPassed, false);
  assert.equal(score(prepared.plan, results.slice(1)).targetsPassed, false);
  assert.equal(score(prepared.plan, [...results, results[0]]).targetsPassed, false);
  const sameId = synthetic(prepared.plan.cases[1]);
  sameId.id = results[0].decoded.requestId;
  const duplicate = [...results];
  duplicate[1] = {
    ...results[1],
    decoded: await decode(
      Buffer.from(JSON.stringify(sameId)),
      200,
      JSON.parse(prepared.plan.cases[1].json),
    ),
  };
  assert.equal(score(prepared.plan, duplicate).targetsPassed, false);
  assert.equal(
    score(prepared.plan, [{ ...results[0], totalLatencyMs: 10000 }, ...results.slice(1)])
      .targetsPassed,
    false,
  );
  for (const latency of [NaN, Infinity, -1, undefined])
    assert.equal(
      score(prepared.plan, [{ ...results[0], totalLatencyMs: latency }, ...results.slice(1)])
        .targetsPassed,
      false,
    );
  assert.equal(
    score(prepared.plan, [{ ...results[0], valid: "true" }, ...results.slice(1)]).targetsPassed,
    false,
  );
  assert.throws(() => {
    results[0].decoded.answers.r_a.choice = "match";
  }, TypeError);
  assert.equal(Object.isFrozen(results[0].decoded.answers.r_a.probabilities), true);
});

test("prospective token check rejects altered or referenced classes", () => {
  const current = JSON.parse(prepared.plan.cases[0].json).state.commandTokens;
  const rows = Object.values(JSON.parse(prepared.plan.cases[0].json).questions).map(
    (q) => q.instructions.selector,
  );
  const extra = structuredClone(current);
  extra.classes.push({ id: 2047 });
  assert.equal(equivalentLabelTokens(current, extra, rows), true);
  extra.classes[0] = { id: 0, equalsPrefix: 2047 };
  assert.equal(equivalentLabelTokens(current, extra, rows), false);
  const changed = structuredClone(current);
  changed.flat.push(2047);
  changed.classes.push({ id: 2047 });
  assert.equal(equivalentLabelTokens(current, changed, rows), false);
});

for (const mode of ["source", "receipt", "post-source"])
  test("one active deadline bounds a pending " + mode + " wait", async () => {
    const c = prepared.plan.cases[0];
    let calls = 0,
      checks = 0;
    const previous = process.env.SF_GUARDRAIL_JEV_API_KEY;
    process.env.SF_GUARDRAIL_JEV_API_KEY = "synthetic-deadline-key";
    try {
      const r = await runCase(c, {
        deadlineMs: 30,
        endpoint: "https://decisions.example.test",
        checkSources: async () => {
          checks++;
          if (mode === "source" || (mode === "post-source" && checks === 2))
            await new Promise(() => {});
        },
        persist: async () => {
          if (mode === "receipt") await new Promise(() => {});
        },
        fetch: async () => {
          calls++;
          return new Response(JSON.stringify(synthetic(c)));
        },
      });
      assert.equal(r.valid, false);
      assert.equal(r.failure, "timeout");
      assert(r.totalLatencyMs >= 25 && r.totalLatencyMs < 500);
      assert.equal(calls, mode === "post-source" ? 1 : 0);
      if (mode === "post-source") {
        assert(r.rawResponseBase64);
        assert.equal(r.actualEvidence.requestId, "synthetic-" + c.caseId);
        assert.equal(r.actualEvidence.requestHash, c.requestHash);
        assert.equal(r.actualEvidence.responseHash, r.rawResponseHash);
      }
    } finally {
      if (previous === undefined) delete process.env.SF_GUARDRAIL_JEV_API_KEY;
      else process.env.SF_GUARDRAIL_JEV_API_KEY = previous;
    }
  });
test("a final queued receipt follows a timed-out pending write without a late send", async () => {
  const c = prepared.plan.cases[0],
    record = { caseId: c.caseId, requestHash: c.requestHash, valid: false, failure: "pending" },
    report = { results: [record] };
  let bytes = Buffer.alloc(0),
    release,
    calls = 0,
    truncates = 0;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const file = {
    async truncate() {
      truncates++;
      if (truncates === 1) await blocked;
      bytes = Buffer.alloc(0);
    },
    async write(input, offset, length, position) {
      const size = Math.min(17, length);
      const next = Buffer.alloc(Math.max(bytes.length, position + size));
      bytes.copy(next);
      input.copy(next, position, offset, offset + size);
      bytes = next;
      return { bytesWritten: size };
    },
    async sync() {},
  };
  const writer = createQueuedReceiptWriter(file, () => report);
  const result = await runCase(c, {
    record,
    deadlineMs: 30,
    endpoint: "https://decisions.example.test",
    checkSources: async () => {},
    persist: () => writer.persist(),
    fetch: async () => {
      calls++;
      throw new Error("unexpected-send");
    },
  });
  assert.equal(result.failure, "timeout");
  assert.equal(calls, 0);
  assert.equal(truncates, 1);
  const final = writer.persist();
  await Promise.resolve();
  assert.equal(truncates, 1);
  release();
  await final;
  await writer.settle();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(truncates, 2);
  assert.equal(calls, 0);
  assert.deepEqual(JSON.parse(bytes.toString()), report);
  assert.equal(JSON.parse(bytes.toString()).results[0].failure, "timeout");
});
test("outer timeout keeps settled primary transport failure evidence", async () => {
  const previous = process.env.SF_GUARDRAIL_JEV_API_KEY;
  process.env.SF_GUARDRAIL_JEV_API_KEY = "synthetic-timeout-key";
  try {
    const c = prepared.plan.cases[0];
    let calls = 0;
    const r = await runCase(c, {
      deadlineMs: 30,
      endpoint: "https://decisions.example.test",
      checkSources: async () => {},
      persist: async () => {},
      fetch: async () => {
        calls++;
        return new Promise(() => {});
      },
    });
    assert.equal(r.valid, false);
    assert.equal(r.failure, "timeout");
    assert.equal(calls, 1);
    assert.equal(r.actualProviderCalls, 1);
    assert.equal(r.failedTransportEvidence.requestSent, true);
    assert.equal(r.failedTransportEvidence.requestHash, c.requestHash);
    assert.equal(r.failedTransportEvidence.requestBytes, Buffer.byteLength(c.json));
    assert.match(r.failedTransportEvidence.transportHash, /^[a-f0-9]{64}$/);
    assert.equal(r.failedTransportEvidence.stage, "syntax");
    assert(Number.isFinite(r.diagnosticTransportSettlementMs));
    assert(r.diagnosticTransportSettlementMs >= 0);
  } finally {
    if (previous === undefined) delete process.env.SF_GUARDRAIL_JEV_API_KEY;
    else process.env.SF_GUARDRAIL_JEV_API_KEY = previous;
  }
});
test("failed strict decoding retains safe bounded raw reply and actual transport origin", async () => {
  const previous = process.env.SF_GUARDRAIL_JEV_API_KEY;
  process.env.SF_GUARDRAIL_JEV_API_KEY = "synthetic-failure-key";
  try {
    const c = prepared.plan.cases[0],
      malformed = JSON.stringify({ model: "typesafe/jev-1.13-20260917", provider: "TypeSafe" }),
      r = await runCase(c, {
        endpoint: "https://decisions.example.test",
        checkSources: async () => {},
        persist: async () => {},
        fetch: async () => new Response(malformed),
      });
    assert.equal(r.valid, false);
    assert.equal(r.failure, "invalid_response");
    assert.equal(r.status, 200);
    assert.equal(r.actualProviderCalls, 1);
    assert.equal(Buffer.from(r.rawResponseBase64, "base64").toString(), malformed);
    assert.equal(r.rawResponseHash, sha(malformed));
    assert.equal(r.failedTransportEvidence.requestSent, true);
    assert.equal(r.failedTransportEvidence.responseComplete, true);
    assert.equal(r.failedTransportEvidence.requestHash, c.requestHash);
    assert.equal(r.failedTransportEvidence.responseHash, r.rawResponseHash);
  } finally {
    if (previous === undefined) delete process.env.SF_GUARDRAIL_JEV_API_KEY;
    else process.env.SF_GUARDRAIL_JEV_API_KEY = previous;
  }
});
