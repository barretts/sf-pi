/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-guardrail behavior contract
 *
 * A Salesforce-aware safety layer for pi. Distills the best patterns from
 * @aliou/pi-guardrails (file-protection policies, AST command matching,
 * config layering, strongest-wins conflict resolution) but re-implemented
 * from scratch and layered with org-aware confirmation tuned for Salesforce
 * workflows (prod deploys, apex run, data mutations, destructive REST calls).
 *
 * Three rule families, each controlled by per-rule behavior:
 *
 *   1. policies        — file-protection rules with three levels
 *                        (noAccess, readOnly, none). Strongest wins.
 *                        Ships with rules for destructiveChanges*.xml,
 *                        .forceignore, .sf/**, .sfdx/**, and .env files.
 *
 *   2. commandGate     — dangerous-command patterns matched against the
 *                        tokenized form of the bash command. Ships with
 *                        rm -rf, sudo, sf org delete, git push --force.
 *                        Prompts user confirmation.
 *
 *   3. orgAwareGate    — bash rules that fire only when the resolved
 *                        target-org type matches (e.g. production). Ships
 *                        with deploy / apex run / data mutate / destructive
 *                        HTTP-method REST calls on production. Prompts.
 *
 * Plus:
 *   - rule guidance    — once-per-session sf-brain-style kernel so the LLM
 *                        knows the gating categories and recommended
 *                        workflow (validate, check-only, Savepoint rollback).
 *   - session memory   — "Allow for this session" persists via pi.appendEntry.
 *   - audit trail      — every decision persisted; rendered by /sf-guardrail
 *                        audit.
 *   - headless gate    — fail-closed by default; SF_GUARDRAIL_ALLOW_HEADLESS=1
 *                        opens the escape hatch.
 *
 * Behavior matrix:
 *
 *   Event              | Condition                         | Result
 *   -------------------|-----------------------------------|--------------------------------------
 *   session_start      | —                                 | Hydrate allow-memory from entries; notify loaded
 *   before_agent_start | prompt entry already in session   | Skip
 *   before_agent_start | first call                       | Inject rule-derived hidden guidance
 *   tool_call          | guardrail disabled                | Pass through
 *   tool_call          | classifies to block               | { block: true, reason }, audit
 *   tool_call          | classifies to confirm, allowed    | Pass through, audit as allow_session
 *   tool_call          | classifies to confirm, user picks | Allow once / Allow session / Block, audit
 *   tool_call          | classifies to confirm, headless   | Fail closed unless env opt-in, audit
 *   /sf-guardrail      | UI available                     | open Manager detail page
 *   /sf-guardrail      | no UI                            | status notification
 *   /sf-guardrail settings | UI available                  | open Manager settings page
 *   /sf-guardrail list | —                                 | rules notification
 *   /sf-guardrail audit| —                                 | decisions notification
 *   /sf-guardrail forget | —                               | clear session allow-memory
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { performance } from "node:perf_hooks";
import {
  authorizeSoqlArtifactPlan,
  prepareSoqlArtifactPlan,
  revokeAllSoqlArtifactPlans,
  revokeSoqlArtifactPlan,
  type PreparedSoqlArtifactPlan,
} from "../../lib/common/sf-soql-artifact-plan/store.ts";

import {
  registerManagerDetailActions,
  type ManagerDetailAction,
} from "../../lib/common/manager-actions.ts";
import {
  openExtensionInManager,
  type SfPiManagerOpenRoute,
} from "../../lib/common/manager-deep-link.ts";
import { getFirstTokenCompletions } from "../../lib/common/command-actions.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import { registerExtensionDoctor } from "../../lib/common/doctor/registry.ts";
import { runExtensionDoctor as runGuardrailExtensionDoctor } from "./lib/extension-doctor.ts";
import { openInfoPanel } from "../../lib/common/info-panel.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import { registerLatestContextProjection } from "../../lib/common/session/active-branch-context.ts";
import { shouldInjectOnce } from "../../lib/common/session/inject-once.ts";
import {
  clearProjectApprovals,
  forgetSessionApprovals,
  grantSessionApproval,
  hasSessionApproval,
  readRecentData360ExecutionChains,
  readRecentDecisions,
  recordDecision,
  renderProjectApprovals,
  restoreApprovalLedger,
} from "./lib/approval-ledger.ts";
import { renderApprovalDetail } from "./lib/approval-detail.ts";
import { evaluateSafety } from "./lib/safety-kernel.ts";
import { loadGuardrailSnapshot } from "./lib/config.ts";
import { confirmDecision, isOperatorAutoApproveEnabled } from "./lib/hitl.ts";
import { readGuardrailPiSettings, setGuardrailEngine } from "./lib/guardrail-settings.ts";
import {
  jevCredentialStatus,
  jevEndpointStatus,
  JEV_RESOLVED_MODEL,
  JEV_TIMEOUT_MS,
} from "./lib/jev-client.ts";
import {
  jevConfigHash,
  jevFactBindingHash,
  jevTransportBindingHash,
  withinDeadline,
  JEV_PROTOCOL_HASH,
} from "./lib/jev-risk.ts";
import { jevHash } from "./lib/jev-identity.ts";
import { addJevArtifactPlan, buildJevMetadata, extractJevTargetOrg } from "./lib/jev-metadata.ts";
import { resolveJevFacts } from "./lib/jev-facts.ts";
import { shouldPowerToolAutoApprove } from "./lib/power-tool-mode.ts";
import { loadPrompt } from "./lib/prompt-injection.ts";
import { openProductionAliasesEditor } from "./lib/production-aliases-panel.ts";
import {
  createForgetApprovalsActionPanel,
  createProtectedAliasesActionPanel,
} from "./lib/manager-action-panels.ts";
import { renderAudit, renderRules, renderStatus } from "./lib/status.ts";
import {
  COMMAND_NAME,
  INJECTION_ENTRY_TYPE,
  type ClassifiedDecision,
  type JevToolDescriptor,
} from "./lib/types.ts";

export default function sfGuardrail(pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-guardrail")) return;
  revokeAllSoqlArtifactPlans();
  registerLatestContextProjection(pi, [INJECTION_ENTRY_TYPE]);

  // Each tool call reads one validated config snapshot; Jev releases recheck its identity.

  // Contribute Guardrail config readiness to the aggregated `/sf-pi doctor`
  // view. Recent decisions stay in /sf-guardrail audit (which has access to
  // the ExtensionContext); this provider is cwd-only by design.
  registerExtensionDoctor("sf-guardrail", () => runGuardrailExtensionDoctor());

  registerManagerDetailActions(pi, "sf-guardrail", buildGuardrailManagerActions(pi));

  // ─── session_start: hydrate allow-memory ──────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    revokeAllSoqlArtifactPlans();
    restoreApprovalLedger(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    // /tree navigation rewrites the active branch — allowances on the old
    // branch should not leak. Rehydrate from the new branch only.
    revokeAllSoqlArtifactPlans();
    restoreApprovalLedger(ctx);
  });

  pi.on("session_shutdown", async () => {
    revokeAllSoqlArtifactPlans();
  });

  // ─── before_agent_start: inject current Guardrail guidance ─────────────
  // The shared helper reads Pi's active, compaction-aware branch. The context
  // projection keeps only the latest guidance while tool_call enforcement and
  // state-only approval/audit entries remain untouched.
  pi.on("before_agent_start", async (_event, ctx) => {
    let prompt: string;
    try {
      const { config, engine } = loadGuardrailSnapshot();
      prompt =
        engine === "jev"
          ? "<sf_guardrail>\nJev evaluates every tool call against the effective guardrail policy using operation metadata. Wait for explicit human approval when requested; never bypass a block. Power Tool and headless/operator auto-approval do not apply in Jev mode.\n</sf_guardrail>\n"
          : loadPrompt(config);
    } catch {
      prompt =
        "<sf_guardrail>Guardrail configuration is invalid. Tool execution is blocked until it is repaired.</sf_guardrail>\n";
    }
    const stillFresh = (entry: { content: string | unknown[] }) => entry.content === prompt;
    if (!shouldInjectOnce(ctx.sessionManager, INJECTION_ENTRY_TYPE, stillFresh)) return;
    return {
      message: {
        customType: INJECTION_ENTRY_TYPE,
        content: prompt,
        display: false,
      },
    };
  });

  // ─── tool_call: the main enforcement seam ─────────────────────────────────
  pi.on("tool_call", async (event, ctx) => {
    let artifactPlan: Readonly<PreparedSoqlArtifactPlan> | undefined;
    let artifactReleased = false;
    try {
      const classificationStarted = performance.now();
      let snapshot: ReturnType<typeof loadGuardrailSnapshot>;
      try {
        snapshot = loadGuardrailSnapshot();
      } catch {
        const decision: ClassifiedDecision = {
          ruleId: "guardrail-config-invalid",
          feature: "jevGate",
          action: "block",
          fingerprint: "invalid",
          subject: event.toolName,
          reason: "Guardrail configuration could not be validated; execution is blocked.",
          jev: {
            model: JEV_RESOLVED_MODEL,
            policyHash: "invalid",
            protocolHash: JEV_PROTOCOL_HASH,
            latencyMs: 0,
            failure: "invalid-config",
          },
        };
        recordDecision(pi, decision, "hard_block", event.toolName);
        return { block: true, reason: decision.reason };
      }
      const { config, engine } = snapshot;
      const capturedCwd = ctx.cwd;
      const capturedSession = ctx.sessionManager.getSessionId();
      const capturedLeaf = ctx.sessionManager.getLeafId?.();
      if (engine === "jev" && event.toolName === "sf_soql" && event.input?.action === "query.run") {
        artifactPlan = prepareSoqlArtifactPlan({
          sessionId: capturedSession,
          toolCallId: event.toolCallId,
          toolName: "sf_soql",
          inputHash: jevHash(event.input ?? {}),
          cwd: capturedCwd,
        });
      }
      const getDescriptor = (): JevToolDescriptor | undefined => {
        const tool = pi.getAllTools().find((tool) => tool.name === event.toolName);
        return tool ? { description: tool.description, parameters: tool.parameters } : undefined;
      };

      let decision: ClassifiedDecision | undefined;
      try {
        decision = await evaluateSafety({
          toolName: event.toolName,
          input: (event.input ?? {}) as Record<string, unknown>,
          cwd: ctx.cwd,
          config,
          sessionId: ctx.sessionManager.getSessionId(),
          toolCallId: event.toolCallId,
          engine,
          ...(artifactPlan ? { artifactPlan } : {}),
          ...(engine === "jev" ? { signal: ctx.signal, descriptor: getDescriptor() } : {}),
        });
      } catch {
        if (engine !== "jev") throw new Error("Guardrail evaluation failed.");
      }
      if (!decision) {
        if (engine !== "jev") return undefined;
        const failed: ClassifiedDecision = {
          ruleId: "jev-risk-v1",
          feature: "jevGate",
          action: "block",
          fingerprint: "invalid",
          subject: event.toolName,
          reason: "Jev evaluation did not produce a valid decision; execution is blocked.",
          jev: {
            model: JEV_RESOLVED_MODEL,
            policyHash: jevConfigHash(config),
            protocolHash: JEV_PROTOCOL_HASH,
            latencyMs: performance.now() - classificationStarted,
            failure: "missing-decision",
          },
        };
        recordDecision(pi, failed, "hard_block", event.toolName);
        return { block: true, reason: failed.reason };
      }

      const basicStateChanged = (): boolean => {
        if (engine !== "jev") return false;
        if (
          artifactPlan &&
          (event.toolCallId !== artifactPlan.binding.toolCallId ||
            event.toolName !== artifactPlan.binding.toolName ||
            process.cwd() !== artifactPlan.plan.writerCwd)
        )
          return true;
        if (
          ctx.signal?.aborted ||
          ctx.cwd !== capturedCwd ||
          ctx.sessionManager.getSessionId() !== capturedSession
        )
          return true;
        if (
          capturedLeaf &&
          !ctx.sessionManager.getBranch().some((entry) => entry.id === capturedLeaf)
        )
          return true;
        try {
          const current = loadGuardrailSnapshot();
          return (
            current.engine !== "jev" ||
            jevConfigHash(current.config) !== decision.jev?.policyHash ||
            jevTransportBindingHash() !== decision.jev?.transportHash ||
            jevHash(event.input ?? {}) !== decision.jev?.inputHash ||
            jevHash(JSON.parse(JSON.stringify(getDescriptor() ?? null))) !==
              decision.jev?.descriptorHash
          );
        } catch {
          return true;
        }
      };
      const stateChanged = async (remainingMs: number): Promise<boolean> => {
        if (engine !== "jev") return false;
        if (remainingMs <= 0 || basicStateChanged()) return true;
        const timeout = AbortSignal.timeout(Math.max(1, Math.floor(remainingMs)));
        const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
        try {
          const baseMetadata = buildJevMetadata(
            event.toolName,
            (event.input ?? {}) as Record<string, unknown>,
            getDescriptor(),
          );
          const metadata = artifactPlan
            ? addJevArtifactPlan(baseMetadata, artifactPlan, {
                toolName: event.toolName,
                input: (event.input ?? {}) as Record<string, unknown>,
                cwd: capturedCwd,
                sessionId: capturedSession,
                toolCallId: event.toolCallId,
              })
            : baseMetadata;
          const latest = await withinDeadline(
            resolveJevFacts({
              toolName: event.toolName,
              input: (event.input ?? {}) as Record<string, unknown>,
              metadata,
              cwd: capturedCwd,
              config,
              sessionId: capturedSession,
              signal,
              targetOrg: extractJevTargetOrg(
                event.toolName,
                (event.input ?? {}) as Record<string, unknown>,
              ),
            }),
            signal,
          );
          return (
            signal.aborted ||
            basicStateChanged() ||
            jevFactBindingHash(latest) !== decision.jev?.factsHash
          );
        } catch {
          return true;
        }
      };
      const releaseArtifacts = () => {
        if (!artifactPlan) return;
        authorizeSoqlArtifactPlan(
          artifactPlan,
          decision.fingerprint,
          async () => !(await stateChanged(JEV_TIMEOUT_MS)),
          () => !basicStateChanged(),
        );
        artifactReleased = true;
      };
      const blockChangedState = () => {
        const changed = {
          ...decision,
          action: "block" as const,
          reason:
            "Jev approval context changed or was cancelled; execution is blocked. Retry to classify the current operation.",
          ...(decision.jev ? { jev: { ...decision.jev, failure: "changed-context" } } : {}),
        };
        recordDecision(pi, changed, "hard_block", event.toolName);
        return { block: true as const, reason: changed.reason };
      };
      if (
        decision.action !== "block" &&
        (await stateChanged(JEV_TIMEOUT_MS - (performance.now() - classificationStarted)))
      )
        return blockChangedState();
      if (decision.jev) decision.jev.latencyMs = performance.now() - classificationStarted;

      // Audited auto-allow → no prompt.
      if (decision.action === "allow") {
        recordDecision(pi, decision, "allow_auto", event.toolName);
        releaseArtifacts();
        return undefined;
      }

      // Hard block → no prompt.
      if (decision.action === "block") {
        recordDecision(pi, decision, "hard_block", event.toolName);
        if (ctx.hasUI) ctx.ui.notify(decision.reason, "warning");
        return { block: true, reason: decision.reason };
      }

      // Previously granted for this session?
      if (hasSessionApproval(decision)) {
        recordDecision(pi, decision, "allow_session", event.toolName);
        releaseArtifacts();
        return undefined;
      }

      if (
        engine !== "jev" &&
        shouldPowerToolAutoApprove(decision, readGuardrailPiSettings().powerTool)
      ) {
        recordDecision(pi, decision, "operator_auto_approve", event.toolName);
        return undefined;
      }

      // Confirmation required.
      const result = await confirmDecision(ctx, {
        title: decision.promptTitle ?? "sf-guardrail",
        detail: renderApprovalDetail(decision),
        timeoutMs: config.confirmTimeoutMs,
        escapeHatchEnv: config.headlessEscapeHatchEnv,
        signal: ctx.signal,
        allowSession: decision.approvalScope?.allowSession !== false,
        allowAutomaticApproval: engine !== "jev",
      });

      if (
        (result.outcome === "allow_once" || result.outcome === "allow_session") &&
        (await stateChanged(JEV_TIMEOUT_MS))
      )
        return blockChangedState();

      switch (result.outcome) {
        case "allow_once":
          recordDecision(pi, decision, "allow_once", event.toolName);
          releaseArtifacts();
          return undefined;
        case "allow_session":
          recordDecision(pi, decision, "allow_session", event.toolName);
          grantSessionApproval(pi, decision);
          releaseArtifacts();
          return undefined;
        case "operator_auto_approve":
          recordDecision(pi, decision, "operator_auto_approve", event.toolName);
          return undefined;
        case "headless_pass":
          recordDecision(pi, decision, "headless_pass", event.toolName);
          return undefined;
        case "headless_block":
          recordDecision(pi, decision, "headless_block", event.toolName);
          return { block: true, reason: result.reason };
        case "timeout":
          recordDecision(pi, decision, "timeout", event.toolName);
          return { block: true, reason: result.reason };
        case "cancel":
          recordDecision(pi, decision, "cancel", event.toolName);
          return { block: true, reason: result.reason };
        case "block":
        default:
          recordDecision(pi, decision, "block", event.toolName);
          return { block: true, reason: result.reason };
      }
    } catch {
      // Pi reports handler exceptions and continues. A guardrail exception must
      // instead return a block, even if UI or audit storage itself has failed.
      const failed: ClassifiedDecision = {
        ruleId: "guardrail-handler-error",
        feature: "jevGate",
        action: "block",
        fingerprint: "invalid",
        subject: event.toolName,
        reason:
          "Guardrail enforcement failed; execution is blocked. Retry after repairing the local error.",
      };
      try {
        recordDecision(pi, failed, "hard_block", event.toolName);
      } catch {
        // There is no alternate approval authority when audit storage is unavailable.
      }
      return { block: true, reason: failed.reason };
    } finally {
      if (artifactPlan && !artifactReleased) revokeSoqlArtifactPlan(artifactPlan);
    }
  });

  // ─── /sf-guardrail command ────────────────────────────────────────────────
  pi.registerCommand(COMMAND_NAME, {
    description: "Inspect and manage sf-guardrail — status, settings, rules, audit",
    getArgumentCompletions: (prefix) => getFirstTokenCompletions(GUARDRAIL_SUBCOMMANDS, prefix),
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, COMMAND_NAME, async () => {
        const sub = (args ?? "").trim().toLowerCase();
        if (sub === "" && ctx.hasUI) {
          await openGuardrailInManager(pi, ctx, "detail");
          return;
        }
        await handleGuardrailCommand(pi, ctx, sub === "" ? "status" : sub);
      });
    },
  });
}

function buildGuardrailManagerActions(pi: ExtensionAPI): ManagerDetailAction[] {
  return [
    {
      id: "rules",
      label: "Effective rules",
      description: "Show resolved file, command, and org-aware rules.",
      run: (ctx) => handleGuardrailCommand(pi, ctx, "list", true),
    },
    {
      id: "audit",
      label: "Audit trail",
      description: "Show recent allow/block/timeout decisions.",
      run: (ctx) => handleGuardrailCommand(pi, ctx, "audit", true),
    },
    {
      id: "grants",
      label: "Approval grants",
      description: "Show legacy persisted approval grants.",
      run: (ctx) => handleGuardrailCommand(pi, ctx, "grants", true),
    },
    {
      id: "forget",
      label: "Forget approvals",
      description: "Clear session approvals and persisted project grants.",
      run: (ctx) => handleGuardrailCommand(pi, ctx, "forget", true),
      createPanel: (theme, _cwd, _scope, done, ctx) =>
        createForgetApprovalsActionPanel(pi, ctx, theme, done),
    },
    {
      id: "aliases",
      label: "Protected org aliases",
      description: "Treat aliases as production-level risk targets.",
      run: (ctx) => handleGuardrailCommand(pi, ctx, "aliases", true),
      createPanel: (theme, _cwd, _scope, done) => createProtectedAliasesActionPanel(theme, done),
    },
    {
      id: "power-tool-mode",
      label: "Power Tool Mode",
      description: "Configure persisted auto-approval for advanced users.",
      run: (ctx) => openGuardrailInManager(pi, ctx, "settings"),
    },
    {
      id: "help",
      label: "Help",
      description: "Show the sf-guardrail command reference.",
      run: (ctx) => handleGuardrailCommand(pi, ctx, "help", true),
    },
  ];
}

async function openGuardrailInManager(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  view: NonNullable<SfPiManagerOpenRoute["view"]>,
): Promise<void> {
  const opened = await openExtensionInManager(pi, ctx, {
    extensionId: "sf-guardrail",
    view,
    actions: buildGuardrailManagerActions(pi),
  });

  if (!opened) {
    ctx.ui.notify("SF Pi Manager is unavailable. Try /sf-pi open sf-guardrail.", "warning");
    return;
  }
}

const GUARDRAIL_SUBCOMMANDS = [
  { value: "engine", description: "Select deterministic or Jev policy decisions." },
  {
    value: "status",
    description: "Show active rules, config source, headless behavior, and recent decisions.",
  },
  { value: "list", description: "Print the effective guardrail rule set." },
  { value: "audit", description: "List recent guardrail decisions." },
  { value: "grants", description: "List active persisted approval grants." },
  { value: "settings", description: "Open SF Guardrail settings in the SF Pi Manager." },
  { value: "aliases", description: "Edit protected org aliases." },
  { value: "forget", description: "Clear session allows and persisted project grants." },
  { value: "help", description: "Show command usage." },
] as const;

async function handleGuardrailCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  sub: string,
  fromPanel = false,
): Promise<void> {
  if (sub.startsWith("engine ")) {
    const engine = sub.slice(7).trim();
    if (engine !== "deterministic" && engine !== "jev") {
      await emitGuardrailOutput(
        ctx,
        "Guardrail engine",
        "Use /sf-guardrail engine deterministic|jev.",
        "warning",
        fromPanel,
      );
      return;
    }
    setGuardrailEngine(engine);
    forgetSessionApprovals(pi);
    await emitGuardrailOutput(
      ctx,
      "Guardrail engine",
      `Engine: ${engine}. Existing session approvals have been revoked.`,
      "info",
      fromPanel,
    );
    return;
  }
  const { config, source, engine } = loadGuardrailSnapshot();

  if (sub === "status" || sub === "help") {
    const text =
      sub === "help"
        ? renderGuardrailHelp()
        : renderStatus({
            config,
            configSource: source,
            recent: readRecentDecisions(ctx, 5),
            data360ExecutionChains: readRecentData360ExecutionChains(ctx, 3),
            hasUI: ctx.hasUI,
            headlessEnabled: !!process.env[config.headlessEscapeHatchEnv],
            operatorAutoApproveEnabled: isOperatorAutoApproveEnabled(),
            powerTool: readGuardrailPiSettings().powerTool,
            engine,
            jevModel: JEV_RESOLVED_MODEL,
            jevCredentialReady: jevCredentialStatus().startsWith("ready ("),
            jevEndpointStatus: engine === "jev" ? jevEndpointStatus() : undefined,
          });
    await emitGuardrailOutput(
      ctx,
      sub === "help" ? "SF Guardrail help" : "SF Guardrail status",
      text,
      "info",
      fromPanel,
    );
    return;
  }

  if (sub === "list") {
    await emitGuardrailOutput(ctx, "SF Guardrail rules", renderRules(config), "info", fromPanel);
    return;
  }

  if (sub === "audit") {
    await emitGuardrailOutput(
      ctx,
      "SF Guardrail audit",
      renderAudit(readRecentDecisions(ctx, 50), readRecentData360ExecutionChains(ctx, 20)),
      "info",
      fromPanel,
    );
    return;
  }

  if (sub === "grants") {
    await emitGuardrailOutput(
      ctx,
      "SF Guardrail approval grants",
      renderProjectApprovals(ctx.cwd),
      "info",
      fromPanel,
    );
    return;
  }

  if (sub === "settings") {
    if (ctx.hasUI) {
      await openGuardrailInManager(pi, ctx, "settings");
      return;
    }
    await emitGuardrailOutput(
      ctx,
      "SF Guardrail settings moved",
      renderSettingsMovedHelp(),
      "info",
      fromPanel,
    );
    return;
  }

  if (sub === "aliases") {
    await openProductionAliasesEditor(ctx, config);
    return;
  }

  if (sub === "forget") {
    forgetSessionApprovals(pi);
    const removed = clearProjectApprovals(ctx.cwd);
    await emitGuardrailOutput(
      ctx,
      "SF Guardrail active approvals cleared",
      `Session allows are revoked for this branch. Cleared ${removed} persisted approval grant(s) for this project.`,
      "info",
      fromPanel,
    );
    return;
  }

  await emitGuardrailOutput(
    ctx,
    "Unknown command",
    `Unknown /sf-guardrail subcommand: ${sub}. Use engine deterministic|jev, status, list, audit, grants, settings, aliases, forget, help.`,
    "warning",
    fromPanel,
  );
}

async function emitGuardrailOutput(
  ctx: ExtensionCommandContext,
  title: string,
  body: string,
  level: "info" | "warning" | "error" | "success",
  fromPanel: boolean,
): Promise<void> {
  if (fromPanel && ctx.hasUI) {
    await openInfoPanel(ctx, { title, body, severity: level });
    return;
  }
  ctx.ui.notify(body ? `${title}\n\n${body}` : title, level === "success" ? "info" : level);
}

function renderSettingsMovedHelp(): string {
  return [
    "Routine Guardrail Preferences now live in Pi settings under sfPi.guardrail.",
    "",
    "Open them from:",
    "  /sf-pi → SF Guardrail → Settings",
    "",
    "Saved at:",
    "  ~/.pi/agent/settings.json",
    "",
    "Advanced custom rule overrides remain expert-only JSON:",
    "  ~/.pi/agent/sf-guardrail/rules.json",
    "",
    "Runtime safety decisions read the effective config on each tool call. Reload is recommended after changing settings so hidden agent guidance refreshes.",
  ].join("\n");
}

function renderGuardrailHelp(): string {
  return [
    "sf-guardrail — Salesforce-aware safety layer",
    "",
    "Commands:",
    `  /${COMMAND_NAME}                 Open SF Guardrail in the SF Pi Manager`,
    `  /${COMMAND_NAME} status          Show active rules and recent decisions`,
    `  /${COMMAND_NAME} engine deterministic|jev  Select the policy engine`,
    `  /${COMMAND_NAME} list            List active file/command/org-aware rules`,
    `  /${COMMAND_NAME} audit           Show recent decisions in this session branch`,
    `  /${COMMAND_NAME} grants          Show active persisted approval grants`,
    `  /${COMMAND_NAME} settings        Show where Pi-backed guardrail preferences live`,
    `  /${COMMAND_NAME} aliases         Edit protected org aliases`,
    `  /${COMMAND_NAME} forget          Clear session allows and project approval grants`,
    `  /${COMMAND_NAME} help            Show this help`,
  ].join("\n");
}
