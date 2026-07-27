/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Resolver for connected-agent target aliases `agent://X` and `agentforce://X`.
 *
 * Target existence and runtime readiness are separate facts. A BotDefinition
 * proves that the referenced agent exists; an Active BotVersion proves that
 * live connected-agent invocation is ready. Inactive targets warn but do not
 * become "missing" or block parent-agent publication.
 */

import type { Connection } from "@salesforce/core";
import { safeQueryRecords, soqlInList } from "../soql.ts";
import type { ActionTarget, TargetResolution, TargetResolver } from "../types.ts";

interface ConnectedAgentRow {
  DeveloperName?: string;
  BotVersions?: {
    records?: Array<{
      DeveloperName?: string;
      VersionNumber?: number;
      Status?: string;
    }>;
  };
}

export const agentforceResolver: TargetResolver = {
  schemes: ["agentforce", "agent"],
  metadataLabel: "Connected Agent (BotDefinition)",
  async resolve(conn: Connection, names: readonly string[]) {
    const rows = await queryConnectedAgents(conn, names);
    return rows ? new Set(rows.map((row) => row.DeveloperName).filter(isString)) : null;
  },
  async resolveTargets(
    conn: Connection,
    targets: readonly ActionTarget[],
  ): Promise<TargetResolution[] | null> {
    const rows = await queryConnectedAgents(
      conn,
      targets.map((target) => target.ref_name),
    );
    if (!rows) return null;
    const byName = new Map(
      rows.flatMap((row) => (row.DeveloperName ? [[row.DeveloperName, row] as const] : [])),
    );
    return targets.map((target) => {
      const row = byName.get(target.ref_name);
      if (!row) {
        return {
          status: "missing",
          detail: `Connected Agent (BotDefinition) '${target.ref_name}' not found in org.`,
        };
      }
      const active = row.BotVersions?.records?.[0];
      if (!active) {
        return {
          status: "ok",
          runtime_readiness: "not_ready",
          runtime_detail:
            `Connected agent '${target.ref_name}' exists but has no Active version. ` +
            `Activate a published version before live preview or invocation: ` +
            `agentscript_lifecycle action='activate' agent_api_name='${target.ref_name}'.`,
        };
      }
      const version =
        active.DeveloperName ??
        (typeof active.VersionNumber === "number"
          ? `v${active.VersionNumber}`
          : "an Active version");
      return {
        status: "ok",
        runtime_readiness: "ready",
        runtime_detail: `${version === "an Active version" ? "An Active version" : `Active version ${version}`} is available for connected-agent invocation.`,
      };
    });
  },
  fixHint(name) {
    return `Publish the connected agent first: agentscript_lifecycle action='publish' for the agent named '${name}'.`;
  },
};

async function queryConnectedAgents(
  conn: Connection,
  names: readonly string[],
): Promise<ConnectedAgentRow[] | null> {
  if (names.length === 0) return [];
  return safeQueryRecords<ConnectedAgentRow>(
    conn,
    "/query",
    `SELECT DeveloperName, ` +
      `(SELECT DeveloperName, VersionNumber, Status FROM BotVersions ` +
      `WHERE Status='Active' ORDER BY VersionNumber DESC LIMIT 1) ` +
      `FROM BotDefinition WHERE DeveloperName IN (${soqlInList(names)})`,
  );
}

function isString(value: string | undefined): value is string {
  return typeof value === "string";
}
