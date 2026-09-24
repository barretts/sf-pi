/* SPDX-License-Identifier: Apache-2.0 */
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { guardrailInputHash } from "../guardrail-identity.ts";
import {
  assertPreparedSoqlArtifactPlan,
  assertSoqlArtifactLease,
  authorizeSoqlArtifactPlan,
  claimSoqlArtifactPlan,
  prepareSoqlArtifactPlan,
  registerSoqlArtifactPlanner,
  revokeAllSoqlArtifactPlans,
  revokeSoqlArtifactPlan,
  wasSoqlArtifactPlanPrepared,
  type SoqlArtifactPlan,
  type SoqlArtifactPlanBinding,
} from "../sf-soql-artifact-plan/store.ts";

let sequence = 0;
function binding(): SoqlArtifactPlanBinding {
  return {
    sessionId: `synthetic-session-${++sequence}`,
    toolCallId: "call-1",
    toolName: "sf_soql",
    inputHash: guardrailInputHash({ action: "query.run", query: "SELECT Id FROM Demo__c LIMIT 3" }),
    cwd: "/synthetic/project",
  };
}
function sourcePlan(root = "/synthetic/agent/sf-pi/sf-soql"): SoqlArtifactPlan {
  const runDirectory = path.join(root, "runs", `jev-${"a".repeat(32)}`);
  const directories: string[] = [];
  for (let current = runDirectory; ; current = path.dirname(current)) {
    directories.unshift(current);
    if (path.dirname(current) === current) break;
  }
  return {
    version: 1,
    root,
    writerCwd: "/synthetic/writer",
    runDirectory,
    directories,
    files: [
      "query.soql",
      "result.raw.json",
      "result.flattened.json",
      "result.flattened.csv",
      "summary.json",
    ].map((name) => path.join(runDirectory, name)),
  };
}
function prepare() {
  const create = vi.fn(() => sourcePlan());
  registerSoqlArtifactPlanner(create);
  const input = binding();
  const prepared = prepareSoqlArtifactPlan(input);
  return { input, prepared, create };
}
afterEach(() => {
  revokeAllSoqlArtifactPlans();
  vi.useRealTimers();
});

describe("one-shot SOQL artifact plan", () => {
  it("retains one immutable source plan during guard rechecks", () => {
    const { input, prepared, create } = prepare();
    expect(prepareSoqlArtifactPlan(input)).toBe(prepared);
    expect(create).toHaveBeenCalledOnce();
    expect(Object.isFrozen(prepared.plan.files)).toBe(true);
    expect(Object.isFrozen(prepared.binding)).toBe(true);
    assertPreparedSoqlArtifactPlan(prepared);
    expect(() => assertPreparedSoqlArtifactPlan({ ...prepared })).toThrow("blocked");
  });

  it.each(["sessionId", "toolCallId", "inputHash", "cwd"] as const)(
    "refuses a claim with another %s",
    async (field) => {
      const { input, prepared } = prepare();
      authorizeSoqlArtifactPlan(
        prepared,
        guardrailInputHash("context"),
        async () => true,
        () => true,
      );
      const changed = {
        ...input,
        [field]:
          field === "inputHash"
            ? guardrailInputHash("other")
            : field === "cwd"
              ? "/other"
              : "other",
      };
      await expect(claimSoqlArtifactPlan(changed)).rejects.toThrow("blocked");
    },
  );

  it("refuses changed input for a repeated preparation", () => {
    const { input } = prepare();
    expect(() =>
      prepareSoqlArtifactPlan({ ...input, inputHash: guardrailInputHash("other") }),
    ).toThrow("blocked");
  });

  it("does not claim a prepared plan before guard authorization", async () => {
    const { input } = prepare();
    await expect(claimSoqlArtifactPlan(input)).rejects.toThrow("blocked");
  });

  it("moves state before its verification await and permits only one consumer", async () => {
    const { input, prepared } = prepare();
    let finish!: (value: boolean) => void;
    const pending = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    authorizeSoqlArtifactPlan(
      prepared,
      guardrailInputHash("context"),
      () => pending,
      () => true,
    );
    const first = claimSoqlArtifactPlan(input);
    await expect(claimSoqlArtifactPlan(input)).rejects.toThrow("blocked");
    assertPreparedSoqlArtifactPlan(prepared);
    finish(true);
    const lease = await first;
    assertSoqlArtifactLease(lease);
    await expect(claimSoqlArtifactPlan(input)).rejects.toThrow("blocked");
    expect(() => assertSoqlArtifactLease({ ...lease })).toThrow("blocked");
    lease.finish();
    expect(() => lease.check()).toThrow("blocked");
    expect(() => assertPreparedSoqlArtifactPlan(prepared)).toThrow("blocked");
  });

  it("revokes failed verification without restoring authority", async () => {
    const { input, prepared } = prepare();
    authorizeSoqlArtifactPlan(
      prepared,
      guardrailInputHash("context"),
      async () => false,
      () => true,
    );
    await expect(claimSoqlArtifactPlan(input)).rejects.toThrow("blocked");
    expect(() => assertPreparedSoqlArtifactPlan(prepared)).toThrow("blocked");
    await expect(claimSoqlArtifactPlan(input)).rejects.toThrow("blocked");
  });

  it("checks context again before writes and preserves terminal revocation", async () => {
    const { input, prepared } = prepare();
    let current = true;
    const verify = vi.fn(async () => current);
    authorizeSoqlArtifactPlan(prepared, guardrailInputHash("context"), verify, () => current);
    const lease = await claimSoqlArtifactPlan(input);
    await lease.beforeWrite();
    expect(verify).toHaveBeenCalledTimes(2);
    current = false;
    await expect(lease.beforeWrite()).rejects.toThrow("blocked");
    revokeSoqlArtifactPlan(prepared);
    current = true;
    expect(() => lease.check()).toThrow("blocked");
  });

  it("blocks cancellation before claim and after an API await", async () => {
    const { input, prepared } = prepare();
    const controller = new AbortController();
    authorizeSoqlArtifactPlan(
      prepared,
      guardrailInputHash("context"),
      async () => true,
      () => true,
    );
    const lease = await claimSoqlArtifactPlan(input, controller.signal);
    controller.abort();
    await expect(lease.beforeWrite()).rejects.toThrow("blocked");
    expect(() => lease.check()).toThrow("blocked");
    const other = prepare();
    authorizeSoqlArtifactPlan(
      other.prepared,
      guardrailInputHash("context"),
      async () => true,
      () => true,
    );
    await expect(claimSoqlArtifactPlan(other.input, controller.signal)).rejects.toThrow("blocked");
  });

  it("expires unused authority and revokes it when the producer reloads", async () => {
    vi.useFakeTimers();
    const { input, prepared } = prepare();
    authorizeSoqlArtifactPlan(
      prepared,
      guardrailInputHash("context"),
      async () => true,
      () => true,
    );
    vi.advanceTimersByTime(10 * 60 * 1000);
    await expect(claimSoqlArtifactPlan(input)).rejects.toThrow("blocked");
    const second = prepare();
    authorizeSoqlArtifactPlan(
      second.prepared,
      guardrailInputHash("context"),
      async () => true,
      () => true,
    );
    registerSoqlArtifactPlanner(() => sourcePlan());
    await expect(claimSoqlArtifactPlan(second.input)).rejects.toThrow("blocked");
  });

  it.each(["files", "directories", "runDirectory"] as const)(
    "rejects an unrepresentable or changed %s before approval",
    (field) => {
      const plan = sourcePlan();
      const changed = {
        ...plan,
        [field]:
          field === "runDirectory" ? "/other/destination" : (plan[field] as string[]).slice(1),
      };
      registerSoqlArtifactPlanner(() => changed);
      expect(() => prepareSoqlArtifactPlan(binding())).toThrow("blocked");
    },
  );

  it("rejects too many ancestors without trimming any planned path", () => {
    registerSoqlArtifactPlanner(() =>
      sourcePlan(`/${Array.from({ length: 30 }, () => "deep").join("/")}`),
    );
    expect(() => prepareSoqlArtifactPlan(binding())).toThrow("blocked");
  });

  it.each(["finished", "revoked", "expired"])(
    "retains a %s call record when another plan is prepared",
    async (state) => {
      vi.useFakeTimers();
      const { input, prepared } = prepare();
      if (state === "finished") {
        authorizeSoqlArtifactPlan(
          prepared,
          guardrailInputHash("context"),
          async () => true,
          () => true,
        );
        (await claimSoqlArtifactPlan(input)).finish();
      } else if (state === "revoked") {
        revokeSoqlArtifactPlan(prepared);
      } else {
        vi.advanceTimersByTime(10 * 60 * 1000);
      }
      prepareSoqlArtifactPlan(binding());
      expect(wasSoqlArtifactPlanPrepared(input.sessionId, input.toolCallId)).toBe(true);
      await expect(claimSoqlArtifactPlan(input)).rejects.toThrow("blocked");
    },
  );

  it("rejects new plans at the bound without removing a previous call record", async () => {
    vi.resetModules();
    const fresh = await import("../sf-soql-artifact-plan/store.ts");
    fresh.registerSoqlArtifactPlanner(() => sourcePlan());
    const first = binding();
    fresh.revokeSoqlArtifactPlan(fresh.prepareSoqlArtifactPlan(first));
    for (let i = 1; i < 256; i++) {
      fresh.revokeSoqlArtifactPlan(fresh.prepareSoqlArtifactPlan(binding()));
    }
    expect(() => fresh.prepareSoqlArtifactPlan(binding())).toThrow("blocked");
    expect(fresh.wasSoqlArtifactPlanPrepared(first.sessionId, first.toolCallId)).toBe(true);
    await expect(fresh.claimSoqlArtifactPlan(first)).rejects.toThrow("blocked");
  });
});
