/* SPDX-License-Identifier: Apache-2.0 */
/** Central evaluator capability and display metadata for eval result interpretation. */

export type EvaluatorCapability = "live_proven" | "client_recognized" | "candidate";
export type EvaluatorFamily = "assertion" | "scoring" | "unknown";

export interface EvaluatorCatalogEntry {
  type: string;
  label: string;
  family: EvaluatorFamily;
  capability: EvaluatorCapability;
  defaultMetricName?: string;
  defaultThreshold?: number;
}

const ENTRIES: readonly EvaluatorCatalogEntry[] = [
  {
    type: "evaluator.string_assertion",
    label: "String assertion",
    family: "assertion",
    capability: "live_proven",
    defaultMetricName: "string_assertion",
  },
  {
    type: "evaluator.numeric_assertion",
    label: "Numeric assertion",
    family: "assertion",
    capability: "live_proven",
  },
  {
    type: "evaluator.list_assertion",
    label: "List assertion",
    family: "assertion",
    capability: "live_proven",
  },
  {
    type: "evaluator.bot_response_rating",
    label: "Bot response rating",
    family: "assertion",
    capability: "live_proven",
  },
  {
    type: "evaluator.text_alignment",
    label: "Text alignment",
    family: "scoring",
    capability: "live_proven",
    defaultMetricName: "base.cosine_similarity",
    defaultThreshold: 0.3,
  },
  {
    type: "evaluator.hallucination_detection",
    label: "Hallucination detection",
    family: "scoring",
    capability: "live_proven",
    defaultMetricName: "hallucination_detection",
  },
  {
    type: "evaluator.citation_recall",
    label: "Citation recall",
    family: "scoring",
    capability: "live_proven",
    defaultMetricName: "citation_recall",
  },
  {
    type: "evaluator.answer_faithfulness",
    label: "Answer faithfulness",
    family: "scoring",
    capability: "live_proven",
    defaultMetricName: "answer_faithfulness",
  },
  {
    type: "evaluator.text_quality",
    label: "Text quality",
    family: "scoring",
    capability: "client_recognized",
    defaultThreshold: 0.8,
  },
] as const;

const BY_TYPE = new Map(ENTRIES.map((entry) => [entry.type, entry]));

export const EVALUATOR_CATALOG = ENTRIES;
export const SCORING_EVALUATORS = new Set(
  ENTRIES.filter((entry) => entry.family === "scoring" && entry.capability === "live_proven").map(
    (entry) => entry.type,
  ),
);
export const ASSERTION_EVALUATORS = new Set(
  ENTRIES.filter(
    (entry) =>
      entry.family === "assertion" &&
      entry.capability === "live_proven" &&
      entry.type !== "evaluator.bot_response_rating",
  ).map((entry) => entry.type),
);
export const DEFAULT_METRIC_NAMES = Object.fromEntries(
  ENTRIES.flatMap((entry) =>
    entry.defaultMetricName ? [[entry.type, entry.defaultMetricName] as const] : [],
  ),
) as Readonly<Record<string, string>>;

export function evaluatorCatalogEntry(type: string | undefined): EvaluatorCatalogEntry {
  const normalized = type ?? "";
  return (
    BY_TYPE.get(normalized) ?? {
      type: normalized || "unknown",
      label: normalized || "Unknown evaluator",
      family: "unknown",
      capability: "candidate",
    }
  );
}
