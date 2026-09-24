/* SPDX-License-Identifier: Apache-2.0 */
import { stat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { findLatestBrowserSnapshotRefLookup } from "../../../lib/common/sf-browser-snapshot-state.ts";
import type {
  GuardrailConfig,
  JevFacts,
  JevFileKind,
  JevResolvedFacts,
  JevToolMetadata,
  OrgTypeFilter,
} from "./types.ts";
import { jevHash } from "./jev-identity.ts";
import { jevShellExecutableHeads } from "./jev-metadata.ts";

/** Escape has no element-target requirement; this does not decide its policy action. */
export function isJevTargetIndependentBrowserPress(
  toolName: string,
  input: Record<string, unknown>,
  metadata: JevToolMetadata,
): boolean {
  return (
    toolName === "sf_browser_press" &&
    metadata.toolName === toolName &&
    input.key === "Escape" &&
    metadata.metadata.key === "Escape"
  );
}

/** Select trusted org observations by tool and retained policy shape, never a policy verdict. */
export function isJevOrgObservationApplicable(
  toolName: string,
  input: Record<string, unknown>,
  metadata: JevToolMetadata,
  config: GuardrailConfig,
): boolean {
  if (isJevTargetIndependentBrowserPress(toolName, input, metadata)) return false;
  const shell = metadata.metadata.shell as { commands?: Array<{ executable: string }> } | undefined;
  const heads = shell ? jevShellExecutableHeads(metadata) : undefined;
  const hasOrgPolicy =
    !!shell && config.orgAwareGate.rules.some((rule) => !heads || heads.has(rule.match.ast.cmd));
  return (
    /^(sf_apex|sf_soql|data360_|agentscript_lifecycle|sf_browser_)/.test(toolName) ||
    !!shell?.commands?.some(
      (command) =>
        path.basename(command.executable) === "sf" || path.basename(command.executable) === "sfdx",
    ) ||
    hasOrgPolicy ||
    typeof input.target_org === "string"
  );
}

/** Observe paths without reading bodies or interpreting file policy. */
export async function resolveJevFileFacts(
  paths: readonly string[],
  cwd: string,
): Promise<NonNullable<JevFacts["files"]>> {
  if (!Array.isArray(paths) || paths.length > 32 || paths.some((file) => typeof file !== "string"))
    throw new Error("invalid-metadata");
  const home = path.resolve(process.env.HOME || homedir());
  return Promise.all(
    paths.map(async (file) => {
      const absolutePath = path.resolve(
        cwd,
        file === "~" ? home : file.startsWith("~/") ? path.join(home, file.slice(2)) : file,
      );
      const homeRelative = path.relative(home, absolutePath);
      const insideHome =
        homeRelative !== ".." &&
        !homeRelative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(homeRelative);
      const variants = {
        path: file,
        absolutePath,
        relativePath: path.relative(path.resolve(cwd), absolutePath),
        basename: path.basename(absolutePath),
        ...(insideHome
          ? { homeRelativePath: homeRelative ? `~/${homeRelative.split(path.sep).join("/")}` : "~" }
          : {}),
      };
      try {
        const details = await stat(absolutePath);
        const kind: JevFileKind = details.isFile()
          ? "file"
          : details.isDirectory()
            ? "directory"
            : "other";
        return { ...variants, exists: true, kind, resolvedPath: await realpath(absolutePath) };
      } catch (error) {
        return {
          ...variants,
          exists: (error as NodeJS.ErrnoException).code === "ENOENT" ? false : ("unknown" as const),
          kind: "unknown" as const,
        };
      }
    }),
  );
}

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
  const targetIndependentPress = isJevTargetIndependentBrowserPress(toolName, input, metadata);
  let browserTarget: string | undefined;
  const paths = Array.isArray(metadata.metadata.paths)
    ? metadata.metadata.paths.filter((value): value is string => typeof value === "string")
    : typeof metadata.metadata.path === "string"
      ? [metadata.metadata.path]
      : [];
  if (paths.length > 32) throw new Error("invalid-metadata");
  if (paths.length) {
    result.facts.files = await resolveJevFileFacts(paths, cwd);
  }
  if (toolName.startsWith("sf_browser_")) {
    const lookup = findLatestBrowserSnapshotRefLookup(
      sessionId,
      // A valid probe obtains the stored page observation without claiming any focused ref.
      targetIndependentPress ? "e0" : typeof input.ref === "string" ? input.ref : undefined,
    );
    browserTarget = lookup.url;
    if (!targetIndependentPress) {
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
    }
    result.browserIdentity = jevHash({
      session: sessionId ?? null,
      capturedAt: lookup.session?.capturedAt ?? null,
      invalidatedAt: lookup.session?.invalidatedAt ?? null,
      ref: targetIndependentPress ? null : (lookup.ref?.ref ?? null),
      url: lookup.url ?? null,
    });
  }
  const shell = metadata.metadata.shell as { commands?: Array<{ executable: string }> } | undefined;
  if (isJevOrgObservationApplicable(toolName, input, metadata, config)) {
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
