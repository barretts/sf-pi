/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, test, vi } from "vitest";
import {
  applyGeneratedBaselineSeedConfig,
  redactResolvedSeedValues,
  resolveEvalSeedProfiles,
} from "../lib/eval/seeds.ts";
import type { EvalSpec } from "../lib/eval/types.ts";
import { projectEvalSuite, selectScenarioSpec } from "../lib/eval-studio/projectability.ts";

describe("resolveEvalSeedProfiles", () => {
  test("resolves one reusable SOQL seed profile into ordinary context variables", async () => {
    const spec = {
      seed_profiles: {
        verified_messaging: {
          soql: "SELECT Id, CaseId FROM MessagingSession WHERE Status = 'Active' ORDER BY LastModifiedDate DESC LIMIT 1",
          context_variables: [
            { name: "RoutableId", type: "Text", field: "Id" },
            { name: "case_id", type: "Text", field: "CaseId" },
            { name: "verified_check", type: "Text", value: "true" },
          ],
        },
      },
      tests: [
        testUsingProfile("shipping", "verified_messaging"),
        testUsingProfile("billing", "verified_messaging"),
      ],
    } satisfies EvalSpec;
    const query = vi.fn(async () => ({
      records: [{ Id: "0Mw000000000001AAA", CaseId: "500000000000001AAA" }],
    }));

    const result = await resolveEvalSeedProfiles(spec, { query });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      "SELECT Id, CaseId FROM MessagingSession WHERE Status = 'Active' ORDER BY LastModifiedDate DESC LIMIT 2",
    );
    expect(result.spec).toEqual({
      tests: [expectedResolvedTest("shipping"), expectedResolvedTest("billing")],
    });
    expect(result.provenance).toEqual([
      {
        profile: "verified_messaging",
        scenario_ids: ["shipping", "billing"],
        variable_names: ["RoutableId", "case_id", "verified_check"],
        sensitive_variable_names: ["RoutableId", "case_id"],
        query_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    ]);
  });

  test("rejects a resolved field that does not match the declared wire type", async () => {
    const source = {
      seed_profiles: {
        invalid: {
          soql: "SELECT Id FROM Account ORDER BY CreatedDate DESC LIMIT 1",
          context_variables: [{ name: "is_ready", type: "Boolean", field: "Id" }],
        },
      },
      tests: [testUsingProfile("type_mismatch", "invalid")],
    } satisfies EvalSpec;

    await expect(
      resolveEvalSeedProfiles(source, {
        query: async () => ({ records: [{ Id: "001000000000001AAA" }] }),
      }),
    ).rejects.toThrow(
      "Eval seed profile 'invalid' variable 'is_ready' expected Boolean but resolved string",
    );
  });

  test("ignores clause words inside quoted SOQL literals but rejects comments", async () => {
    const quoted = {
      seed_profiles: {
        quoted: {
          soql: "SELECT Id FROM Account WHERE Name = 'FOR UPDATE' ORDER BY Id LIMIT 1",
          context_variables: [{ name: "account_id", field: "Id" }],
        },
      },
      tests: [testUsingProfile("quoted", "quoted")],
    } satisfies EvalSpec;
    const query = vi.fn(async () => ({ records: [{ Id: "001A" }] }));
    await expect(resolveEvalSeedProfiles(quoted, { query })).resolves.toBeDefined();
    expect(query).toHaveBeenCalledWith(
      "SELECT Id FROM Account WHERE Name = 'FOR UPDATE' ORDER BY Id LIMIT 2",
    );

    const commented = structuredClone(quoted);
    commented.seed_profiles.quoted.soql =
      "SELECT Id FROM Account /* dynamic */ ORDER BY Id LIMIT 1";
    await expect(resolveEvalSeedProfiles(commented, { query })).rejects.toThrow(
      "contains unsupported comments",
    );
  });

  test("fails closed for unsafe queries and ambiguous cardinality", async () => {
    const unsafe = {
      seed_profiles: {
        bad: {
          soql: "SELECT Id FROM Account FOR UPDATE LIMIT 1",
          context_variables: [{ name: "account_id", field: "Id" }],
        },
      },
      tests: [testUsingProfile("unsafe", "bad")],
    } satisfies EvalSpec;
    const query = vi.fn();
    await expect(resolveEvalSeedProfiles(unsafe, { query })).rejects.toThrow(
      "uses a query feature outside seed v1",
    );
    expect(query).not.toHaveBeenCalled();

    const safe = {
      seed_profiles: {
        one: {
          soql: "SELECT Id FROM Account ORDER BY CreatedDate DESC LIMIT 1",
          context_variables: [{ name: "account_id", field: "Id" }],
        },
      },
      tests: [testUsingProfile("cardinality", "one")],
    } satisfies EvalSpec;
    await expect(
      resolveEvalSeedProfiles(safe, { query: async () => ({ records: [] }) }),
    ).rejects.toThrow("must resolve exactly one row; received 0");
    await expect(
      resolveEvalSeedProfiles(safe, {
        query: async () => ({ records: [{ Id: "001A" }, { Id: "001B" }] }),
      }),
    ).rejects.toThrow("must resolve exactly one row; received 2");
  });

  test("keeps an explicit one-run context override above the profile value", async () => {
    const test = testUsingProfile("override", "profile");
    (test.steps[1] as Record<string, unknown>).context_variables = [
      { name: "verified_check", type: "Text", value: "manual" },
    ];
    const source = {
      seed_profiles: {
        profile: {
          soql: "SELECT Id FROM Account ORDER BY CreatedDate DESC LIMIT 1",
          context_variables: [
            { name: "verified_check", type: "Text", value: "true" },
            { name: "account_id", type: "Text", field: "Id" },
          ],
        },
      },
      tests: [test],
    } satisfies EvalSpec;

    const result = await resolveEvalSeedProfiles(source, {
      query: async () => ({ records: [{ Id: "001000000000001AAA" }] }),
    });
    expect(result.spec.tests[0]?.steps[1]?.context_variables).toEqual([
      { name: "verified_check", type: "Text", value: "manual" },
      { name: "account_id", type: "Text", value: "001000000000001AAA" },
    ]);
  });

  test("redacts short resolved values without replacing substrings", () => {
    const spec: EvalSpec = {
      tests: [
        {
          id: "scenario",
          steps: [
            {
              type: "agent.send_message",
              id: "turn",
              context_variables: [{ name: "region", type: "Text", value: "US" }],
            },
          ],
        },
      ],
    };
    const provenance = [
      {
        profile: "region",
        scenario_ids: ["scenario"],
        variable_names: ["region"],
        sensitive_variable_names: ["region"],
        query_digest: "digest",
      },
    ];
    expect(redactResolvedSeedValues("Region US but status BUSY", spec, provenance)).toBe(
      "Region [REDACTED] but status BUSY",
    );
  });

  test("redacts resolved seed names and values from returned failure data", () => {
    const spec: EvalSpec = {
      tests: [
        {
          id: "scenario",
          steps: [
            {
              type: "agent.send_message",
              id: "turn",
              context_variables: [{ name: "customer_id", type: "Text", value: "001SECRET" }],
            },
          ],
        },
      ],
    };
    const provenance = [
      {
        profile: "customer",
        scenario_ids: ["scenario"],
        variable_names: ["customer_id"],
        sensitive_variable_names: ["customer_id"],
        query_digest: "digest",
      },
    ];

    expect(
      redactResolvedSeedValues(
        {
          agent_response: "Account 001SECRET is ready",
          state_variables: { customer_id: "001SECRET", safe: "visible" },
        },
        spec,
        provenance,
      ),
    ).toEqual({
      agent_response: "Account [REDACTED] is ready",
      state_variables: { customer_id: "[REDACTED]", safe: "visible" },
    });
  });

  test("applies designated seed profiles to exact generated baseline test ids", () => {
    const baseline: EvalSpec = {
      tests: [
        { id: "subagent_account_validation", steps: [] },
        { id: "subagent_billing", steps: [] },
        { id: "subagent_product_help", steps: [] },
      ],
    };
    const designated: EvalSpec = {
      seed_profiles: {
        post_auth: {
          soql: "SELECT Id FROM MessagingSession ORDER BY LastModifiedDate DESC LIMIT 1",
          context_variables: [{ name: "verified_check", type: "Text", value: "true" }],
        },
        pre_auth: {
          soql: "SELECT Id FROM MessagingSession ORDER BY LastModifiedDate DESC LIMIT 1",
          context_variables: [{ name: "verified_check", type: "Text", value: "unverified" }],
        },
        unused: {
          soql: "SELECT Id FROM Account ORDER BY CreatedDate DESC LIMIT 1",
          context_variables: [{ name: "account_id", type: "Text", field: "Id" }],
        },
      },
      generated_baseline: {
        default_seed_profile: "post_auth",
        overrides: { subagent_account_validation: "pre_auth" },
        skip_tests: ["subagent_product_help"],
      },
      tests: [],
    };

    expect(applyGeneratedBaselineSeedConfig(baseline, designated)).toEqual({
      seed_profiles: {
        post_auth: designated.seed_profiles.post_auth,
        pre_auth: designated.seed_profiles.pre_auth,
      },
      tests: [
        { id: "subagent_account_validation", seed_profile: "pre_auth", steps: [] },
        { id: "subagent_billing", seed_profile: "post_auth", steps: [] },
      ],
    });
  });

  test("projects dynamic seed names without exposing values", () => {
    const source = {
      seed_profiles: {
        selected: {
          soql: "SELECT Id FROM Account ORDER BY CreatedDate DESC LIMIT 1",
          context_variables: [
            { name: "account_id", type: "Text", field: "Id" },
            { name: "verified_check", type: "Text", value: "true" },
          ],
        },
      },
      tests: [
        {
          id: "one",
          seed_profile: "selected",
          steps: [
            { type: "agent.create_session", id: "session" },
            { type: "agent.send_message", id: "turn", utterance: "hello" },
            {
              type: "evaluator.string_assertion",
              id: "response",
              actual: "{turn.response}",
              expected: "hello",
            },
          ],
        },
      ],
    } satisfies EvalSpec;

    expect(projectEvalSuite(source).scenarios[0]?.seeds).toEqual([
      {
        name: "account_id",
        type: "Text",
        value: "[RESOLVED AT RUN]",
        provenance: "seed_profile:selected",
      },
      {
        name: "verified_check",
        type: "Text",
        value: "[RESOLVED AT RUN]",
        provenance: "seed_profile:selected",
      },
    ]);
  });

  test("retains the selected Scenario's referenced profile for Studio runs", () => {
    const source = {
      seed_profiles: {
        selected: {
          soql: "SELECT Id FROM Account ORDER BY CreatedDate DESC LIMIT 1",
          context_variables: [{ name: "account_id", field: "Id" }],
        },
        unused: {
          soql: "SELECT Id FROM Contact ORDER BY CreatedDate DESC LIMIT 1",
          context_variables: [{ name: "contact_id", field: "Id" }],
        },
      },
      tests: [testUsingProfile("one", "selected"), testUsingProfile("two", "unused")],
    } satisfies EvalSpec;

    expect(selectScenarioSpec(source, "one")).toEqual({
      seed_profiles: { selected: source.seed_profiles.selected },
      tests: [testUsingProfile("one", "selected")],
    });
  });

  test("rejects duplicate scenario and step ids before resolving org data", async () => {
    const duplicateScenario = {
      tests: [testUsingProfile("duplicate", "missing"), testUsingProfile("duplicate", "missing")],
    } satisfies EvalSpec;
    const query = vi.fn();

    await expect(resolveEvalSeedProfiles(duplicateScenario, { query })).rejects.toThrow(
      "Duplicate eval scenario id 'duplicate'",
    );
    expect(query).not.toHaveBeenCalled();

    const duplicateStep = {
      tests: [
        {
          id: "steps",
          steps: [
            { type: "agent.create_session", id: "same" },
            { type: "agent.send_message", id: "same", utterance: "hello" },
          ],
        },
      ],
    } satisfies EvalSpec;

    await expect(resolveEvalSeedProfiles(duplicateStep, { query })).rejects.toThrow(
      "Duplicate step id 'same' in eval scenario 'steps'",
    );
    expect(query).not.toHaveBeenCalled();
  });
});

function testUsingProfile(id: string, seedProfile: string) {
  return {
    id,
    seed_profile: seedProfile,
    steps: [
      { type: "agent.create_session", id: "session" },
      {
        type: "agent.send_message",
        id: "turn1",
        utterance: "hello",
      },
    ],
  };
}

function expectedResolvedTest(id: string) {
  return {
    id,
    steps: [
      { type: "agent.create_session", id: "session" },
      {
        type: "agent.send_message",
        id: "turn1",
        utterance: "hello",
        context_variables: [
          { name: "RoutableId", type: "Text", value: "0Mw000000000001AAA" },
          { name: "case_id", type: "Text", value: "500000000000001AAA" },
          { name: "verified_check", type: "Text", value: "true" },
        ],
      },
    ],
  };
}
