/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { parseSoql } from "../../sf-soql/lib/parser.ts";
import { readBundledConfig } from "../lib/config.ts";
import { jevHash } from "../lib/jev-identity.ts";
import { buildJevMetadata } from "../lib/jev-metadata.ts";
import { buildJevRequest, evaluateJevPrediction, jevContextComplete } from "../lib/jev-risk.ts";
import type { JevPrediction } from "../lib/types.ts";

const SOURCE = "SyntheticPrivateSource__c";
const query = (source = SOURCE, limit = 25) => `SELECT Id FROM ${source} LIMIT ${limit}`;
const shape = (queryLimit = 25) => ({
  projection: "single_Id",
  sourceCount: 1,
  queryLimit,
  otherClauses: false,
  sourceSpelling: "withheld",
  sensitivity: "unknown",
});
const metadata = (text: string, extra: Record<string, unknown> = {}) =>
  buildJevMetadata("sf_soql", { action: "query.run", query: text, ...extra });

describe("narrow native SOQL structure", () => {
  it.each([
    ["base", query(), 25],
    ["ASCII case", query().toLowerCase(), 25],
    ["ASCII whitespace", ` \t\r\nSELECT\tId\nFROM\r${SOURCE}\tLIMIT\n25 \t\r\n`, 25],
    ["minimum LIMIT", query(SOURCE, 1), 1],
    ["maximum LIMIT", query(SOURCE, 2000), 2000],
    ["maximum source length", query("A".repeat(80)), 25],
    ["maximum input bytes", query() + " ".repeat(512 - Buffer.byteLength(query())), 25],
  ])("observes only the %s structure", (_name, text, queryLimit) => {
    const input = { action: "query.run", query: text, max_rows: 25 };
    const before = JSON.stringify(input);
    const result = buildJevMetadata("sf_soql", input);
    expect(result.metadata.queryShape).toEqual(shape(Number(queryLimit)));
    expect(result.complete).toBe(false);
    expect(result.omissions).toContain("generated_artifact_paths_unobserved");
    expect(result.omissions).toContain("payload_withheld");
    expect(result.metadata).not.toHaveProperty("query");
    expect(result.metadata).not.toHaveProperty("paths");
    expect(JSON.stringify(result)).not.toContain(SOURCE);
    expect(JSON.stringify(input)).toBe(before);
    expect(parseSoql(String(text)).syntax_errors).toBeUndefined();
  });

  it.each([
    ["extra projection", `SELECT Id, Name FROM ${SOURCE} LIMIT 25`],
    ["projection alias", `SELECT Id alias FROM ${SOURCE} LIMIT 25`],
    ["source alias", `SELECT Id FROM ${SOURCE} alias LIMIT 25`],
    ["multiple sources", `SELECT Id FROM ${SOURCE}, OtherSource__c LIMIT 25`],
    ["relationship field", `SELECT Owner.Id FROM ${SOURCE} LIMIT 25`],
    ["relationship source", `SELECT Id FROM ${SOURCE}.Other LIMIT 25`],
    ["subquery", `SELECT Id, (SELECT Id FROM Children) FROM ${SOURCE} LIMIT 25`],
    ["aggregate", `SELECT COUNT(Id) FROM ${SOURCE} LIMIT 25`],
    ["FIELDS", `SELECT FIELDS(ALL) FROM ${SOURCE} LIMIT 25`],
    ["TYPEOF", `SELECT TYPEOF What WHEN Account THEN Id END FROM ${SOURCE} LIMIT 25`],
    ["WHERE", `SELECT Id FROM ${SOURCE} WHERE Name = 'synthetic' LIMIT 25`],
    ["ORDER BY", `SELECT Id FROM ${SOURCE} ORDER BY Id LIMIT 25`],
    ["GROUP BY", `SELECT Id FROM ${SOURCE} GROUP BY Id LIMIT 25`],
    ["HAVING", `SELECT Id FROM ${SOURCE} GROUP BY Id HAVING COUNT(Id) > 1 LIMIT 25`],
    ["OFFSET", query() + " OFFSET 1"],
    ["WITH", `SELECT Id FROM ${SOURCE} WITH SECURITY_ENFORCED LIMIT 25`],
    ["USING SCOPE", `SELECT Id FROM ${SOURCE} USING SCOPE mine LIMIT 25`],
    ["ALL ROWS", query() + " ALL ROWS"],
    ["FOR VIEW", query() + " FOR VIEW"],
    ["FOR REFERENCE", query() + " FOR REFERENCE"],
    ["FOR UPDATE", query() + " FOR UPDATE"],
    ["UPDATE VIEWSTAT", query() + " UPDATE VIEWSTAT"],
    ["UPDATE TRACKING", query() + " UPDATE TRACKING"],
    ["header comment", "// synthetic\n" + query()],
    ["block comment", "/* synthetic */ " + query()],
    ["trailing comment", query() + " // synthetic"],
    ["semicolon", query() + ";"],
    ["second query", query() + "; " + query("OtherSource__c")],
    ["bind", `SELECT Id FROM ${SOURCE} LIMIT :syntheticLimit`],
    ["no LIMIT", `SELECT Id FROM ${SOURCE}`],
    ["zero LIMIT", query(SOURCE, 0)],
    ["negative LIMIT", query(SOURCE, -25)],
    ["fractional LIMIT", query(SOURCE, 25.5)],
    ["leading-zero LIMIT", `SELECT Id FROM ${SOURCE} LIMIT 025`],
    ["LIMIT above observer bound", query(SOURCE, 2001)],
    ["huge LIMIT", `SELECT Id FROM ${SOURCE} LIMIT 999999999999999999`],
    ["source above observer bound", query("A".repeat(81))],
    ["input above observer bound", query() + " ".repeat(513 - Buffer.byteLength(query()))],
    ["leading nonbreaking space", "\u00a0" + query()],
    ["trailing nonbreaking space", query() + "\u00a0"],
    ["leading byte-order mark", "\ufeff" + query()],
    ["trailing byte-order mark", query() + "\ufeff"],
    ["trailing Unicode line separator", query() + "\u2028"],
    ["trailing Unicode paragraph separator", query() + "\u2029"],
    ["Unicode keyword case", query().replace("SELECT", "\u017fELECT")],
    ["interior Unicode whitespace", query().replace("FROM ", "FROM\u00a0")],
    ["zero-width marker", query() + "\u200b"],
    ["Unicode source", query("SyntheticSourc\u00e9__c")],
    ["vertical tab", query().replace("FROM ", "FROM\v")],
    ["form feed", query().replace("FROM ", "FROM\f")],
    ["null marker", query() + "\0"],
    ["reserved source token rejected by SDK", query("SELECT")],
    ["empty query", ""],
  ])("keeps %s withheld and incomplete", (_name, text) => {
    const result = metadata(text);
    expect(result.metadata).not.toHaveProperty("queryShape");
    expect(result.metadata).not.toHaveProperty("query");
    expect(result.complete).toBe(false);
    expect(result.omissions).toContain("payload_withheld");
    expect(JSON.stringify(result)).not.toContain(SOURCE);
  });

  it.each(["query.sample", "query.count", "query.queryAll", "query.validate", "query.export"])(
    "does not transfer the witness to %s",
    (action) => {
      const result = buildJevMetadata("sf_soql", { action, query: query() });
      expect(result.metadata).not.toHaveProperty("queryShape");
      expect(result.complete).toBe(false);
    },
  );

  it.each([
    { unknown_parameter: "synthetic" },
    { fields: ["SyntheticField__c"] },
    { filters: ["synthetic"] },
    { intent: "synthetic" },
    { queryShape: { sensitivity: "ordinary" } },
  ])("retains independent unknown fields %#", (extra) => {
    const result = metadata(query(), extra);
    expect(result.metadata.queryShape).toEqual(shape());
    expect(result.complete).toBe(false);
  });

  it.each(["rest", "tooling"])("retains %s and include_deleted without changing shape", (api) => {
    const result = metadata(query(), { api, include_deleted: true });
    expect(result.metadata).toMatchObject({ api, include_deleted: true, queryShape: shape() });
    expect(result.complete).toBe(false);
  });

  it("does not transfer the witness to another native tool", () => {
    const result = buildJevMetadata("sf_apex", { action: "apex.search", query: query() });
    expect(result.metadata).not.toHaveProperty("queryShape");
    expect(result.complete).toBe(false);
  });

  it("retains invalid query type handling", () => {
    expect(() => buildJevMetadata("sf_soql", { action: "query.run", query: 25 })).toThrow();
  });

  it("keeps opaque-source collisions private and binds full original inputs locally", () => {
    const first = { action: "query.run", query: query("SyntheticSourceA__c") };
    const second = { action: "query.run", query: query("SyntheticSourceB__c") };
    expect(buildJevMetadata("sf_soql", first)).toEqual(buildJevMetadata("sf_soql", second));
    expect(jevHash(first)).not.toBe(jevHash(second));
    expect(jevHash(first)).not.toBe(jevHash({ ...first, query: first.query.toLowerCase() }));
  });

  it.each(["FOR VIEW", "FOR REFERENCE", "UPDATE VIEWSTAT", "UPDATE TRACKING"])(
    "checks SDK-valid %s outside the admitted shape",
    (clause) => {
      const text = query() + ` ${clause}`;
      expect(parseSoql(text).syntax_errors).toBeUndefined();
      expect(metadata(text).complete).toBe(false);
    },
  );

  it("checks the SDK rejection that a bare-token anchor alone cannot detect", () => {
    expect(parseSoql(query("SELECT")).syntax_errors?.length).toBeGreaterThan(0);
    expect(metadata(query("SELECT")).complete).toBe(false);
  });

  it("imports metadata without loading the SDK and keeps SDK faults incomplete", () => {
    const moduleUrl = new URL("../lib/jev-metadata.ts", import.meta.url).href;
    const code = `
      import Module from "node:module";
      let sdkLoads = 0;
      const load = Module._load;
      Module._load = function(id, ...args) {
        if (id === "@salesforce/soql-common") {
          sdkLoads++;
          throw new Error("synthetic unavailable parser");
        }
        return load.call(this, id, ...args);
      };
      const { buildJevMetadata } = await import(${JSON.stringify(moduleUrl)});
      const afterImport = sdkLoads;
      const rejected = ${JSON.stringify([
        "SELECT Id FROM SyntheticSource__c LIMIT 25 ALL ROWS",
        query() + "\u2028",
        "\ufeff" + query(),
        query("A".repeat(81)),
        query(SOURCE, 2001),
        query() + " ".repeat(513 - Buffer.byteLength(query())),
      ])}.map(query => buildJevMetadata("sf_soql", { action: "query.run", query }));
      const afterRejected = sdkLoads;
      const narrow = buildJevMetadata("sf_soql", { action: "query.run", query: "SELECT Id FROM SyntheticSource__c LIMIT 25" });
      process.stdout.write(JSON.stringify({ afterImport, afterRejected, sdkLoads, rejectedComplete: rejected.every(result => result.complete), narrowComplete: narrow.complete, hasShape: !!narrow.metadata.queryShape }));
    `;
    const output = execFileSync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "--eval", code],
      { encoding: "utf8" },
    );
    expect(JSON.parse(output)).toEqual({
      afterImport: 0,
      afterRejected: 0,
      sdkLoads: 1,
      rejectedComplete: false,
      narrowComplete: false,
      hasShape: false,
    });
  });
});

describe("narrow native SOQL request", () => {
  it.each([
    [{}, 25, "bounded"],
    [{ limit: 10000 }, 25, "bounded"],
    [{ max_rows: 0, limit: 10000 }, 1, "bounded"],
    [{ max_rows: -0.5 }, 1, "bounded"],
    [{ max_rows: 26.9 }, 26, "bounded"],
    [{ max_rows: 10000 }, 2000, "large"],
  ])("preserves actual query.run cap precedence for %#", (extra, effectiveMaximum, bucket) => {
    const result = metadata(query(), extra as Record<string, unknown>);
    const request = buildJevRequest(result, {}, readBundledConfig());
    expect(request.state).toMatchObject({
      operation: { metadata: { queryShape: shape() }, complete: false },
      observations: {
        contextComplete: false,
        rowLimit: { runnerCap: 2000, effectiveMaximum, bucket },
      },
    });
    expect(request.questions).toHaveProperty("risk");
    expect(request.questions).toHaveProperty("disclosure");
    expect(request.questions).not.toHaveProperty("file_policy");
    expect((request.state as { operation: { omissions: string[] } }).operation.omissions).toContain(
      "generated_artifact_paths_unobserved",
    );
    expect(JSON.stringify(request)).not.toContain(SOURCE);
    expect(JSON.stringify(request)).not.toContain(query());
  });

  it("retains independently unknown org and file facts", () => {
    // Isolate fact checks from the separate generated-artifact gap.
    const result = { ...metadata(query()), complete: true };
    expect(jevContextComplete(result, {})).toBe(true);
    expect(
      jevContextComplete(result, { org: { verified: false, type: "unknown", explicit: true } }),
    ).toBe(false);
    expect(
      jevContextComplete(result, { files: [{ path: "synthetic.txt", exists: "unknown" }] }),
    ).toBe(false);
  });

  it("cannot automatically allow while generated artifact paths remain unobserved", () => {
    const answer = {
      choice: "allow",
      probabilities: { allow: 1, confirm: 0, block: 0 },
      confidence: 1,
    };
    const prediction = {
      ...answer,
      answers: { risk: answer, disclosure: answer },
    } as JevPrediction;
    expect(evaluateJevPrediction(prediction, jevContextComplete(metadata(query()), {}))).toBe(
      "confirm",
    );
  });

  it.each(["confirm", "block"] as const)("leaves disclosure %s to Jev", (choice) => {
    const answer = (selected: "allow" | "confirm" | "block") => ({
      choice: selected,
      probabilities: {
        allow: selected === "allow" ? 1 : 0,
        confirm: selected === "confirm" ? 1 : 0,
        block: selected === "block" ? 1 : 0,
      },
      confidence: 1,
    });
    const prediction = {
      ...answer("allow"),
      answers: { risk: answer("allow"), disclosure: answer(choice) },
    } as JevPrediction;
    expect(evaluateJevPrediction(prediction, true)).toBe(choice);
  });
});
