/* SPDX-License-Identifier: Apache-2.0 */
/** Human-only transcript renderer for deferred Agent Script quality cards. */
import type { EntryRenderer, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { AGENT_SCRIPT_QUALITY_ENTRY_TYPE } from "./auto-scan.ts";
import {
  createQualityCardComponent,
  qualityCardData,
  type AgentScriptQualityCardData,
} from "./presentation.ts";
import type { AgentScriptQualityResult } from "./types.ts";

interface LegacyAgentScriptQualityTranscriptEntry {
  content?: string;
  details?: {
    status?: string;
    file?: string;
    summary?: AgentScriptQualityResult["summary"];
    findings?: AgentScriptQualityResult["findings"];
    coverage?: AgentScriptQualityResult["coverage"];
    metrics?: AgentScriptQualityResult["metrics"];
    suppressions?: AgentScriptQualityResult["suppressions"];
    failure_reason?: string;
  };
}

type AgentScriptQualityTranscriptEntry =
  AgentScriptQualityCardData | LegacyAgentScriptQualityTranscriptEntry;

export function registerAgentScriptQualityTranscriptRenderer(pi: ExtensionAPI): void {
  pi.registerEntryRenderer<AgentScriptQualityTranscriptEntry>(
    AGENT_SCRIPT_QUALITY_ENTRY_TYPE,
    createAgentScriptQualityTranscriptRenderer(),
  );
}

export function createAgentScriptQualityTranscriptRenderer(): EntryRenderer<AgentScriptQualityTranscriptEntry> {
  return (entry, options, theme) => {
    const card = normalizeCard(entry.data);
    return card
      ? createQualityCardComponent(card, options.expanded, theme)
      : new Text(theme.fg("dim", "Agent Script quality"), 0, 0);
  };
}

function normalizeCard(data: AgentScriptQualityTranscriptEntry | undefined) {
  if (!data) return undefined;
  if ("schema_version" in data && data.schema_version === 1) return data;
  const details = "details" in data ? data.details : undefined;
  if (!details?.summary || !details.coverage || !details.metrics) return undefined;
  const quality: AgentScriptQualityResult = {
    ok: details.status !== "failed",
    status:
      details.status === "clean" ||
      details.status === "findings" ||
      details.status === "partial" ||
      details.status === "failed"
        ? details.status
        : "findings",
    findings: details.findings ?? [],
    summary: details.summary,
    coverage: details.coverage,
    metrics: details.metrics,
    suppressions: details.suppressions ?? { applied: [], invalid: [], unused: [] },
    ...(details.failure_reason ? { failure_reason: details.failure_reason } : {}),
  };
  return qualityCardData(details.file ?? "Agent.agent", quality, {
    ...(details.status === "stopped" ? { state: "stopped" as const } : {}),
  });
}
