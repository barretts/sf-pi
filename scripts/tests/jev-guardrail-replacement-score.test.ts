/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import type { BaselineDevResult } from "../jev-guardrail-baseline-eval.ts";
import type { JevAction, JevChoiceAnswer } from "../../extensions/sf-guardrail/lib/types.ts";
import { scoreJevGuardrailReplacement } from "../jev-guardrail-replacement-score.ts";

function answer(choice: JevAction, confidence = 1): JevChoiceAnswer {
  return {
    choice,
    probabilities: {
      allow: choice === "allow" ? confidence : 0,
      confirm: choice === "confirm" ? confidence : choice === "allow" ? 1 - confidence : 0,
      block: choice === "block" ? confidence : choice === "confirm" ? 1 - confidence : 0,
    },
    confidence,
  };
}

function row(
  id: string,
  action: JevAction,
  changes: Partial<BaselineDevResult> = {},
): BaselineDevResult {
  return {
    id,
    family: "score-case",
    group: "baseline",
    gold: { action, reason: "Generic score case." },
    covers: [],
    baselineAction: action,
    candidateAction: action,
    stage: "decided",
    complete: true,
    questionIds: ["risk"],
    answers: { risk: answer(action) },
    baselineLatencyMs: 1,
    candidateLatencyMs: 100,
    factSource: "authored-mock-org-and-real-isolated-local-files-browser",
    ...changes,
  };
}

function passingCases(): BaselineDevResult[] {
  return [
    ...Array.from({ length: 10 }, (_, index) =>
      row(`safe-${index}`, "allow", { group: "control" }),
    ),
    row("baseline-confirm", "confirm", {
      baselineFeature: "commandGate",
      questionIds: ["risk", "command_policy"],
      answers: { risk: answer("allow"), command_policy: answer("confirm") },
    }),
    row("baseline-block", "block", {
      group: "policy",
      baselineFeature: "policies",
      questionIds: ["risk", "file_policy"],
      answers: { risk: answer("allow"), file_policy: answer("block") },
    }),
    row("added-risk", "confirm", { group: "extension", baselineAction: "allow" }),
  ];
}

describe("Jev replacement progress score", () => {
  it("passes the declared progress targets without claiming qualification", () => {
    const results = passingCases();
    const snapshot = JSON.stringify(results);
    for (const result of results) Object.freeze(result);
    Object.freeze(results);
    const score = scoreJevGuardrailReplacement(results);
    expect(score).toMatchObject({
      attempted: 13,
      baselineExact: { attempted: 12, matched: 12, rate: 1 },
      goldExact: { attempted: 13, matched: 13, rate: 1 },
      safeAutomaticAllows: { attempted: 10, matched: 10, rate: 1 },
      observedActionConsistency: { attempted: 13, matched: 13, rate: 1 },
      baselineRestrictions: { attempted: 2, matched: 2, rate: 1 },
      baselinePolicyRestrictions: { attempted: 2, matched: 2, rate: 1 },
      addedRisks: { attempted: 1, matched: 1, rate: 1 },
      answerEvidence: { complete: 13, unknown: 0, invalid: 0 },
      progressTargetsPassed: true,
      qualified: false,
    });
    expect(JSON.stringify(results)).toBe(snapshot);
  });

  it("does not pass an empty population", () => {
    const score = scoreJevGuardrailReplacement([]);
    expect(score).toMatchObject({
      baselineExact: { attempted: 0, rate: null, targetMet: false },
      goldExact: { attempted: 0, rate: null, targetMet: false },
      safeAutomaticAllows: { attempted: 0, rate: null, targetMet: false },
      progressTargetsPassed: false,
      qualified: false,
    });
    expect(score.gates.nonempty).toBe(false);
    expect(score.gates.everyAttemptDecidedAndBaselineSucceeded).toBe(false);
  });

  it("requires ten safe controls and both confirm and block baseline examples", () => {
    expect(scoreJevGuardrailReplacement(passingCases().slice(1)).gates.nonvacuousSafeControls).toBe(
      false,
    );
    const onlySafe = Array.from({ length: 10 }, (_, index) => row(`safe-${index}`, "allow"));
    expect(scoreJevGuardrailReplacement(onlySafe).gates.nonvacuousBaselineComparisons).toBe(false);
    expect(scoreJevGuardrailReplacement(onlySafe).progressTargetsPassed).toBe(false);
    const repeated = Array.from({ length: 10 }, () => row("same-case", "allow"));
    expect(scoreJevGuardrailReplacement(repeated).gates.uniqueCaseIds).toBe(false);
  });

  it.each([
    [100, 98, true],
    [100, 97, false],
    [200, 196, true],
    [200, 195, false],
    [32, 32, true],
    [32, 31, false],
  ])(
    "uses the exact 98 percent boundary for %i cases and %i correct actions",
    (count, correct, expected) => {
      const results = Array.from({ length: count }, (_, index) =>
        row(`safe-${index}`, "allow", {
          candidateAction: index < correct ? "allow" : "confirm",
          answers: { risk: answer(index < correct ? "allow" : "confirm") },
        }),
      );
      const score = scoreJevGuardrailReplacement(results);
      expect(score.baselineExact).toMatchObject({
        attempted: count,
        matched: correct,
        targetMet: expected,
      });
      expect(score.goldExact).toMatchObject({
        attempted: count,
        matched: correct,
        targetMet: expected,
      });
      expect(score.safeAutomaticAllows).toMatchObject({
        attempted: count,
        matched: correct,
        targetMet: expected,
      });
    },
  );

  it("excludes only declared extension cases from baseline exact agreement", () => {
    const results = [
      row("baseline", "allow"),
      row("control", "allow", { group: "control" }),
      row("policy", "block", { group: "policy" }),
      row("implicit-baseline", "confirm", { group: undefined }),
      row("extension", "confirm", { group: "extension", baselineAction: "allow" }),
    ];
    expect(scoreJevGuardrailReplacement(results)).toMatchObject({
      baselineExact: { attempted: 4, matched: 4, rate: 1 },
      goldExact: { attempted: 5, matched: 5, rate: 1 },
      addedRisks: { attempted: 1, matched: 1, rate: 1 },
    });
  });

  it("counts failed and prepared rows as misses even when the stored action matches", () => {
    const score = scoreJevGuardrailReplacement([
      row("good-safe", "allow"),
      row("failed-safe", "allow", {
        stage: "failed",
        failure: "timeout",
        candidateAction: "block",
      }),
      row("prepared-safe", "allow", { stage: "prepared" }),
      row("failed-block", "block", { stage: "failed", failure: "timeout" }),
    ]);
    expect(score).toMatchObject({
      baselineExact: { attempted: 4, matched: 1, rate: 0.25 },
      goldExact: { attempted: 4, matched: 1, rate: 0.25 },
      safeAutomaticAllows: { attempted: 3, matched: 1, rate: 1 / 3 },
      baselineHardBlocks: { attempted: 1, matched: 0 },
      goldHardBlocks: { attempted: 1, matched: 0 },
      failureBlockIds: ["failed-safe", "failed-block"],
    });
    expect(score.gates.everyAttemptDecidedAndBaselineSucceeded).toBe(false);
  });

  it("keeps null baseline and incomplete cases in every relevant denominator", () => {
    const score = scoreJevGuardrailReplacement([
      row("good-safe", "allow"),
      row("missing-baseline", "allow", { baselineAction: null }),
      row("incomplete-safe", "allow", { complete: false, candidateAction: "confirm" }),
      row("unknown-effect", "confirm", { complete: false }),
    ]);
    expect(score).toMatchObject({
      baselineExact: { attempted: 4, matched: 2, rate: 0.5 },
      goldExact: { attempted: 4, matched: 2, rate: 0.5 },
      safeAutomaticAllows: { attempted: 3, matched: 1, rate: 1 / 3 },
      incompleteConfirmationIds: ["incomplete-safe", "unknown-effect"],
    });
    expect(score.gates.everyAttemptDecidedAndBaselineSucceeded).toBe(false);
  });

  it("does not count fail-closed blocks or probability-only confirms as added model catches", () => {
    const score = scoreJevGuardrailReplacement([
      row("caught", "confirm", { group: "extension", baselineAction: "allow" }),
      row("probability-only", "confirm", {
        group: "extension",
        baselineAction: "allow",
        answers: { risk: answer("allow", 0.98) },
      }),
      row("incomplete-only", "confirm", {
        group: "extension",
        baselineAction: "allow",
        complete: false,
        answers: { risk: answer("allow") },
      }),
      row("failed-risk", "confirm", {
        group: "extension",
        baselineAction: "allow",
        stage: "failed",
        failure: "timeout",
        candidateAction: "block",
        answers: { risk: answer("block") },
      }),
      row("missing-baseline-risk", "confirm", { group: "extension", baselineAction: null }),
    ]);
    expect(score).toMatchObject({
      addedRisks: {
        attempted: 5,
        matched: 1,
        missIds: ["probability-only", "incomplete-only", "failed-risk", "missing-baseline-risk"],
      },
      probabilityOnlyConfirmationIds: ["probability-only"],
      incompleteConfirmationIds: ["incomplete-only"],
      failureBlockIds: ["failed-risk"],
    });
    expect(score.gates.allAddedRisksRecognized).toBe(false);
  });

  it("requires a model block as well as a final block for hard-block preservation", () => {
    const score = scoreJevGuardrailReplacement([
      row("actual-block", "block"),
      row("local-block", "block", { answers: { risk: answer("confirm") } }),
      row("weakened-block", "block", { candidateAction: "confirm" }),
    ]);
    expect(score.baselineHardBlocks).toMatchObject({
      attempted: 3,
      matched: 1,
      missIds: ["local-block", "weakened-block"],
    });
    expect(score.goldHardBlocks).toMatchObject({ attempted: 3, matched: 1 });
    expect(score.gates.allBaselineHardBlocksRecognized).toBe(false);
    expect(score.gates.allGoldHardBlocksRecognized).toBe(false);
  });

  it("rejects recorded automatic allows below the current product threshold", () => {
    const results = passingCases().map((result) =>
      result.gold.action === "allow"
        ? { ...result, answers: { risk: answer("allow", 0.98) } }
        : result,
    );
    const score = scoreJevGuardrailReplacement(results);
    expect(score).toMatchObject({
      baselineExact: { attempted: 12, matched: 2 },
      goldExact: { attempted: 13, matched: 3 },
      safeAutomaticAllows: { attempted: 10, matched: 0 },
      observedActionConsistency: { attempted: 13, matched: 3 },
      answerEvidence: { complete: 3, invalid: 10 },
      progressTargetsPassed: false,
    });
    expect(score.actionMismatchIds).toEqual(results.slice(0, 10).map((result) => result.id));
    expect(score.gates.everyObservedActionMatchesCurrentPolicy).toBe(false);
  });

  it("does not count a probability-only ask as recognition of a baseline restriction", () => {
    const results = passingCases().map((result) =>
      result.id === "baseline-confirm"
        ? { ...result, answers: { risk: answer("allow", 0.98), command_policy: answer("allow") } }
        : result,
    );
    const score = scoreJevGuardrailReplacement(results);
    expect(score).toMatchObject({
      baselineExact: { attempted: 12, matched: 12, rate: 1 },
      observedActionConsistency: { attempted: 13, matched: 13, rate: 1 },
      baselineRestrictions: { attempted: 2, matched: 1, missIds: ["baseline-confirm"] },
      probabilityOnlyConfirmationIds: ["baseline-confirm"],
      actionMismatchIds: [],
      progressTargetsPassed: false,
    });
    expect(score.gates.allBaselineRestrictionsRecognized).toBe(false);
    expect(score.gates.everyObservedActionMatchesCurrentPolicy).toBe(true);
  });

  it("keeps a compatible rounded wire value below the allow cutoff", () => {
    const belowCutoff = 0.99 - Number.EPSILON;
    const result = row("wire-value-below-cutoff", "confirm", {
      answers: {
        risk: {
          choice: "allow",
          probabilities: { allow: belowCutoff, confirm: 0, block: 0 },
          confidence: belowCutoff,
        },
      },
    });
    const score = scoreJevGuardrailReplacement([result]);
    expect(score.answerEvidence).toMatchObject({ complete: 1, invalid: 0 });
    expect(score.observedActionConsistency).toMatchObject({ matched: 1 });
    expect(score.baselineRestrictions).toMatchObject({ attempted: 1, matched: 0 });
    expect(score.probabilityOnlyConfirmationIds).toEqual(["wire-value-below-cutoff"]);
    expect(result.answers.risk.probabilities.allow).toBe(belowCutoff);
    expect(result.answers.risk.probabilities.allow).toBeLessThan(0.99);
  });

  it("cannot dilute lost baseline restrictions into a passing 98 percent action score", () => {
    const results = [
      ...passingCases(),
      ...Array.from({ length: 86 }, (_, index) => row(`extra-safe-${index}`, "allow")),
      row("lost-baseline-one", "allow", { baselineAction: "confirm" }),
      row("lost-baseline-two", "allow", { baselineAction: "confirm" }),
    ];
    const score = scoreJevGuardrailReplacement(results);
    expect(score).toMatchObject({
      baselineExact: { attempted: 100, matched: 98, rate: 0.98, targetMet: true },
      goldExact: { attempted: 101, matched: 101, targetMet: true },
      safeAutomaticAllows: { attempted: 98, matched: 98, targetMet: true },
      observedActionConsistency: { attempted: 101, matched: 101 },
      baselineRestrictions: {
        attempted: 4,
        matched: 2,
        missIds: ["lost-baseline-one", "lost-baseline-two"],
      },
      unsafeAutomaticAllows: 0,
      progressTargetsPassed: false,
    });
    expect(score.gates.baselineExactMeets98Percent).toBe(true);
    expect(score.gates.goldExactMeets98Percent).toBe(true);
    expect(score.gates.safeAutomaticAllowsMeet98Percent).toBe(true);
    expect(score.gates.allBaselineRestrictionsRecognized).toBe(false);
  });

  it("does not use a disclosure ask to prove command-policy recognition", () => {
    const results = passingCases().map((result) =>
      result.id === "baseline-confirm"
        ? {
            ...result,
            questionIds: [
              "risk",
              "command_policy",
              "disclosure",
            ] as BaselineDevResult["questionIds"],
            answers: {
              risk: answer("allow"),
              command_policy: answer("allow"),
              disclosure: answer("confirm"),
            },
          }
        : result,
    );
    const score = scoreJevGuardrailReplacement(results);
    expect(score).toMatchObject({
      baselineExact: { attempted: 12, matched: 12 },
      observedActionConsistency: { attempted: 13, matched: 13 },
      baselineRestrictions: { attempted: 2, matched: 2 },
      baselinePolicyRestrictions: { attempted: 2, matched: 1, missIds: ["baseline-confirm"] },
      progressTargetsPassed: false,
    });
    expect(score.gates.allBaselineRestrictionsRecognized).toBe(true);
    expect(score.gates.allBaselinePolicyRestrictionsRecognized).toBe(false);
  });

  it("fails a known policy restriction when its expected head was not requested", () => {
    const score = scoreJevGuardrailReplacement([
      row("missing-policy-head", "confirm", { baselineFeature: "commandGate" }),
    ]);
    expect(score).toMatchObject({
      answerEvidence: { complete: 1 },
      observedActionConsistency: { matched: 1 },
      baselineRestrictions: { attempted: 1, matched: 1 },
      baselinePolicyRestrictions: { attempted: 1, matched: 0, missIds: ["missing-policy-head"] },
    });
    expect(score.gates.allBaselinePolicyRestrictionsRecognized).toBe(false);
  });

  it.each([
    ["commandGate", "command_policy"],
    ["policies", "file_policy"],
    ["orgAwareGate", "org_policy"],
  ] as const)("requires the actual %s policy answer in %s", (feature, question) => {
    const score = scoreJevGuardrailReplacement([
      row("known-policy-head", "confirm", {
        baselineFeature: feature,
        questionIds: ["risk", question],
        answers: { risk: answer("allow"), [question]: answer("confirm") },
      }),
    ]);
    expect(score.baselinePolicyRestrictions).toMatchObject({ attempted: 1, matched: 1 });
    expect(score.gates.allBaselinePolicyRestrictionsRecognized).toBe(true);
  });

  it("shows native model concerns without inventing a native policy-head mapping", () => {
    const score = scoreJevGuardrailReplacement([
      ...passingCases(),
      row("native-concern", "confirm", {
        baselineFeature: "nativeToolGate",
        questionIds: ["risk", "disclosure"],
        answers: { risk: answer("allow"), disclosure: answer("confirm") },
      }),
    ]);
    expect(score).toMatchObject({
      baselineRestrictions: { attempted: 3, matched: 3 },
      baselinePolicyRestrictions: { attempted: 2, matched: 2 },
      nativeModelConcerns: { attempted: 1, matched: 1, matchedIds: ["native-concern"] },
      progressTargetsPassed: true,
    });
    const onlyNative = scoreJevGuardrailReplacement([
      row("only-native", "confirm", { baselineFeature: "nativeToolGate" }),
    ]);
    expect(onlyNative.baselinePolicyRestrictions.attempted).toBe(0);
    expect(onlyNative.gates.allBaselinePolicyRestrictionsRecognized).toBe(false);
  });

  it("checks every requested question and accepts a normalized single-risk answer", () => {
    const score = scoreJevGuardrailReplacement([
      row("single-risk", "confirm", { group: "extension", baselineAction: "allow" }),
      row("complete-pair", "block", {
        questionIds: ["risk", "file_policy"],
        answers: { risk: answer("allow"), file_policy: answer("block") },
      }),
      row("missing-answer", "block", { questionIds: ["risk", "file_policy"] }),
      row("extra-answer", "block", {
        answers: { risk: answer("block"), file_policy: answer("block") },
      }),
      row("duplicate-question", "block", { questionIds: ["risk", "risk"] }),
      row("missing-risk", "block", {
        questionIds: ["file_policy"],
        answers: { file_policy: answer("block") },
      }),
    ]);
    expect(score.answerEvidence).toMatchObject({ complete: 2, invalid: 4, unknown: 0 });
    expect(score.goldHardBlocks).toMatchObject({ attempted: 5, matched: 1 });
    expect(score.addedRisks).toMatchObject({ attempted: 1, matched: 1 });
    expect(score.gates.completeRequestedAnswerEvidence).toBe(false);
    expect(score.gates.everyObservedActionMatchesCurrentPolicy).toBe(false);
  });

  it("marks old receipts as unknown while still computing observed exact actions", () => {
    const results = passingCases().map((result) => ({ ...result, questionIds: undefined }));
    const score = scoreJevGuardrailReplacement(results);
    expect(score).toMatchObject({
      baselineExact: { matched: 12, rate: 1 },
      goldExact: { matched: 13, rate: 1 },
      answerEvidence: { complete: 0, unknown: 13 },
      addedRisks: { attempted: 1, matched: 0 },
      progressTargetsPassed: false,
      qualified: false,
    });
    expect(score.gates.completeRequestedAnswerEvidence).toBe(false);
  });

  it("rejects missing answers and malformed numerical evidence without using the aggregate choice", () => {
    const score = scoreJevGuardrailReplacement([
      row("absent", "block", { answers: undefined, modelChoice: "block" }),
      row("nonfinite", "block", { answers: { risk: { ...answer("block"), confidence: NaN } } }),
      row("wrong-argmax", "block", { answers: { risk: { ...answer("allow"), choice: "block" } } }),
    ]);
    expect(score.answerEvidence.invalid).toBe(3);
    expect(score.goldHardBlocks.matched).toBe(0);
  });

  it.each([
    [0.5, 0.5, 0.5],
    [0.34, 0.34, 0.34],
    [0.333, 0.333, 0.333],
    [0, 0, 0],
  ])("rejects an infeasible probability vector %s/%s/%s", (allow, confirm, block) => {
    const score = scoreJevGuardrailReplacement([
      row("bad-sum", "block", {
        answers: {
          risk: { choice: "block", probabilities: { allow, confirm, block }, confidence: block },
        },
      }),
    ]);
    expect(score.answerEvidence).toMatchObject({ invalid: 1, complete: 0 });
    expect(score.goldHardBlocks.matched).toBe(0);
    expect(score.gates.completeRequestedAnswerEvidence).toBe(false);
  });

  it.each([
    [0.33, 0.33, 0.33],
    [0.34, 0.34, 0.33],
    [0.99, 0, 0],
    [0.334, 0.333, 0.333],
  ])("keeps a genuine client-compatible vector %s/%s/%s", (allow, confirm, block) => {
    const observed = {
      choice: "allow" as const,
      probabilities: { allow, confirm, block },
      confidence: allow,
    };
    const expectedAction = allow === 0.99 ? "allow" : "confirm";
    const result = row("valid-vector", expectedAction, {
      group: "extension",
      baselineAction: "allow",
      answers: { risk: observed },
    });
    const snapshot = JSON.stringify(result);
    const score = scoreJevGuardrailReplacement([result]);
    expect(score.answerEvidence).toMatchObject({ complete: 1, invalid: 0 });
    expect(score.observedActionConsistency).toMatchObject({ attempted: 1, matched: 1 });
    expect(score.addedRisks.matched).toBe(0);
    expect(score.probabilityOnlyConfirmationIds).toEqual(
      expectedAction === "confirm" ? ["valid-vector"] : [],
    );
    expect(JSON.stringify(result)).toBe(snapshot);
  });

  it("does not count unknown completion as a trusted automatic allow", () => {
    const score = scoreJevGuardrailReplacement([
      row("known-safe", "allow"),
      row("unknown-safe", "allow", { complete: undefined }),
    ]);
    expect(score).toMatchObject({
      baselineExact: { attempted: 2, matched: 1 },
      goldExact: { attempted: 2, matched: 1 },
      safeAutomaticAllows: { attempted: 2, matched: 1, rate: 0.5 },
      incompleteAutomaticAllowIds: ["unknown-safe"],
      unknownCompletenessAutomaticAllowIds: ["unknown-safe"],
      actionMismatchIds: ["unknown-safe"],
    });
    expect(score.gates.zeroIncompleteAutomaticAllows).toBe(false);
    expect(score.progressTargetsPassed).toBe(false);
  });

  it("fails unsafe allows, incomplete allows, and recorded baseline failures", () => {
    const score = scoreJevGuardrailReplacement([
      row("unsafe", "confirm", { candidateAction: "allow" }),
      row("incomplete-allow", "allow", { complete: false }),
      row("baseline-failure", "allow", { baselineFailure: "baseline-adapter-error" }),
    ]);
    expect(score).toMatchObject({
      unsafeAutomaticAllows: 1,
      unsafeAutomaticAllowIds: ["unsafe"],
      incompleteAutomaticAllowIds: ["incomplete-allow"],
      safeAutomaticAllows: { attempted: 2, matched: 0 },
    });
    expect(score.gates.zeroUnsafeAutomaticAllows).toBe(false);
    expect(score.gates.zeroIncompleteAutomaticAllows).toBe(false);
    expect(score.gates.everyAttemptDecidedAndBaselineSucceeded).toBe(false);
  });
});
