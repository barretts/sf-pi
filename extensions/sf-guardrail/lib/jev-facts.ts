/* SPDX-License-Identifier: Apache-2.0 */
import { stat, realpath } from "node:fs/promises";
import path from "node:path";
import { findLatestBrowserSnapshotRefLookup } from "../../../lib/common/sf-browser-snapshot-state.ts";
import type { GuardrailConfig, JevResolvedFacts, JevToolMetadata, OrgTypeFilter } from "./types.ts";
import { jevHash } from "./jev-identity.ts";

export async function resolveJevFacts(options: {
  toolName: string;
  input: Record<string, unknown>;
  metadata: JevToolMetadata;
  cwd: string;
  config: GuardrailConfig;
  sessionId?: string;
  signal: AbortSignal;
  targetOrg?: string;
}): Promise<JevResolvedFacts> {
  const { toolName, input, metadata, cwd, config, sessionId, signal } = options;
  signal.throwIfAborted();
  const result: JevResolvedFacts = { facts: {} };
  let browserTarget: string | undefined;
  const paths = Array.isArray(metadata.metadata.paths)
    ? metadata.metadata.paths.filter((value): value is string => typeof value === "string")
    : typeof metadata.metadata.path === "string"
      ? [metadata.metadata.path]
      : [];
  if (paths.length > 32) throw new Error("invalid-metadata");
  if (paths.length) {
    result.facts.files = await Promise.all(
      paths.map(async (file) => {
        const absolute = path.resolve(
          cwd,
          file.startsWith("~/") ? path.join(process.env.HOME ?? "", file.slice(2)) : file,
        );
        try {
          await stat(absolute);
          return { path: file, exists: true, resolvedPath: await realpath(absolute) };
        } catch (error) {
          return {
            path: file,
            exists:
              (error as NodeJS.ErrnoException).code === "ENOENT" ? false : ("unknown" as const),
          };
        }
      }),
    );
  }
  if (toolName.startsWith("sf_browser_")) {
    const lookup = findLatestBrowserSnapshotRefLookup(
      sessionId,
      typeof input.ref === "string" ? input.ref : undefined,
    );
    browserTarget = lookup.url;
    const observedRole = lookup.ref?.role;
    const observedLabel = lookup.ref?.label;
    const role =
      observedRole && safeObservedText(observedRole) ? observedRole.slice(0, 80) : undefined;
    const label =
      observedLabel && safeObservedText(observedLabel) ? observedLabel.slice(0, 160) : undefined;
    const withheld = !!((observedRole && !role) || (observedLabel && !label));
    result.facts.browser = {
      status: lookup.status === "fresh" && withheld ? "incomplete" : lookup.status,
      ...(lookup.status === "fresh" && role ? { role } : {}),
      ...(lookup.status === "fresh" && label ? { label } : {}),
      ...(Number.isFinite(lookup.ageMs) ? { ageMs: lookup.ageMs } : {}),
    };
    result.browserIdentity = jevHash({
      session: sessionId ?? null,
      capturedAt: lookup.session?.capturedAt ?? null,
      invalidatedAt: lookup.session?.invalidatedAt ?? null,
      ref: lookup.ref?.ref ?? null,
      url: lookup.url ?? null,
    });
  }
  const shell = metadata.metadata.shell as { commands?: Array<{ executable: string }> } | undefined;
  const usesOrg =
    /^(sf_apex|sf_soql|data360_|agentscript_lifecycle|sf_browser_)/.test(toolName) ||
    shell?.commands?.some(
      (command) =>
        path.basename(command.executable) === "sf" || path.basename(command.executable) === "sfdx",
    ) ||
    typeof input.target_org === "string";
  if (usesOrg) {
    const explicitTarget =
      options.targetOrg ?? (typeof input.target_org === "string" ? input.target_org : undefined);
    result.facts.org = { type: "unknown", verified: false, explicit: explicitTarget !== undefined };
    const orgCommands =
      shell?.commands?.filter((command) =>
        ["sf", "sfdx"].includes(path.basename(command.executable)),
      ) ?? [];
    if (orgCommands.length > 1) {
      signal.throwIfAborted();
      return result;
    }
    const lookupSignal = AbortSignal.any([signal, AbortSignal.timeout(400)]);
    try {
      // Fresh SDK resolution supplies identity/type authority; old status caches do not grant approval.
      const resolution = (async () => {
        if (explicitTarget && config.productionAliases.includes(explicitTarget)) {
          return { type: "production" as OrgTypeFilter, identity: explicitTarget };
        }
        const { connectSalesforce } = await import("../../../lib/common/sf-conn/index.ts");
        const session = await connectSalesforce({
          cwd,
          targetOrg: explicitTarget,
          fresh: true,
          timeoutMs: 400,
          signal: lookupSignal,
        });
        if (
          toolName.startsWith("sf_browser_") &&
          !sameBrowserOrg(browserTarget, session.target.instanceUrl)
        )
          return undefined;
        // Let the fresh connection resolve an unspecified default itself. Reading
        // detectConfig first would turn its cached default into a stale explicit target.
        const type = config.productionAliases.includes(session.target.targetOrg)
          ? "production"
          : session.target.orgType;
        if (!["production", "sandbox", "scratch", "developer", "trial"].includes(type))
          return undefined;
        const identity = session.target.orgId ?? session.target.username;
        if (!identity) return undefined;
        return { type: type as OrgTypeFilter, identity };
      })();
      const resolved = await abortableFact(resolution, lookupSignal);
      if (resolved) {
        result.facts.org = {
          type: resolved.type,
          verified: true,
          explicit: explicitTarget !== undefined,
        };
        result.orgIdentity = resolved.identity;
      }
    } catch {
      signal.throwIfAborted();
      // Missing/incomplete org facts remain unknown; Jev can request explicit approval.
    }
  }
  signal.throwIfAborted();
  return result;
}

function safeObservedText(value: string | undefined): boolean {
  return (
    !!value &&
    !/[\x00-\x1f\x7f]|https?:\/\/|\bBearer\s+\S+|\b(?:sk|or)-[a-zA-Z0-9-]{12,}|(?:api[_ -]?key|password|token)\s*[:=]\s*\S+/i.test(
      value,
    )
  );
}

function sameBrowserOrg(observed: string | undefined, instance: string): boolean {
  try {
    if (!observed) return false;
    const browser = new URL(observed);
    const org = new URL(instance);
    const prefix = (url: URL) =>
      url.hostname.match(/^(.+)\.(?:my\.salesforce|lightning\.force)\.com$/)?.[1];
    return (
      browser.protocol === "https:" &&
      org.protocol === "https:" &&
      browser.port === org.port &&
      (browser.hostname === org.hostname || (!!prefix(browser) && prefix(browser) === prefix(org)))
    );
  } catch {
    return false;
  }
}

function abortableFact<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error("fact-resolution-aborted"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
