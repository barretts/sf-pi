/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Resolver for `apex://X` and `apexRest://X`.
 *
 * `apex://` uses Salesforce's registered Apex Action description as the
 * authority for input/output names. This supports both direct primitive
 * invocables and wrapper types without parsing Apex source.
 *
 * `apexRest://` only verifies class presence + @RestResource because it uses
 * a different binding model that isn't exposed through Apex Action describe.
 */

import type { Connection } from "@salesforce/core";
import { boundedRestRequest } from "../../bounded-salesforce-transport.ts";
import { safeQueryRecords, soqlInList } from "../soql.ts";
import type { ActionTarget, TargetResolution, TargetResolver } from "../types.ts";

interface ApexClassRow extends Record<string, unknown> {
  Name?: string;
  Body?: string;
}

interface ApexActionParameter {
  name: string;
}

interface ApexActionDescription {
  name?: string;
  inputs: ApexActionParameter[];
  outputs: ApexActionParameter[];
}

const REST_RESOURCE_RE = /@RestResource\b/i;

function expectedNames(target: ActionTarget): { inputs: string[]; outputs: string[] } {
  return {
    inputs: target.input_names ?? [],
    outputs: target.output_names ?? [],
  };
}

function isApexActionParameter(value: unknown): value is ApexActionParameter {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { name?: unknown }).name === "string"
  );
}

function parameterNames(parameters: ApexActionParameter[]): string[] {
  return parameters.map((parameter) => parameter.name).sort();
}

function isApexActionDescription(value: unknown): value is ApexActionDescription {
  if (!value || typeof value !== "object") return false;
  const description = value as Partial<ApexActionDescription>;
  return (
    Array.isArray(description.inputs) &&
    description.inputs.every(isApexActionParameter) &&
    Array.isArray(description.outputs) &&
    description.outputs.every(isApexActionParameter)
  );
}

function verdictForApexAction(
  target: ActionTarget,
  description: ApexActionDescription,
): TargetResolution {
  const actualInputs = parameterNames(description.inputs ?? []);
  const actualOutputs = parameterNames(description.outputs ?? []);
  const expected = expectedNames(target);
  const inputSet = new Set(actualInputs);
  const outputSet = new Set(actualOutputs);
  const missingInputs = expected.inputs.filter((name) => !inputSet.has(name));
  const missingOutputs = expected.outputs.filter((name) => !outputSet.has(name));

  if (missingInputs.length > 0 || missingOutputs.length > 0) {
    const parts = [
      missingInputs.length ? `missing input(s): ${missingInputs.join(", ")}` : undefined,
      missingOutputs.length ? `missing output(s): ${missingOutputs.join(", ")}` : undefined,
    ].filter(Boolean);
    return {
      status: "missing",
      reason: "io_mismatch",
      detail:
        `Apex action '${target.ref_name}' exists, but its registered contract does not match ` +
        `action '${target.name}' (${parts.join("; ")}).`,
      data: {
        expected_inputs: expected.inputs,
        expected_outputs: expected.outputs,
        actual_inputs: actualInputs,
        actual_outputs: actualOutputs,
      },
    };
  }

  return { status: "ok" };
}

async function describeApexActions(
  conn: Connection,
  names: readonly string[],
): Promise<Map<string, ApexActionDescription | TargetResolution>> {
  const descriptions = new Map<string, ApexActionDescription | TargetResolution>();
  for (const name of new Set(names)) {
    const response = await boundedRestRequest<unknown>(
      conn,
      `/actions/custom/apex/${encodeURIComponent(name)}`,
      "GET",
    );
    if (response.ok === false) {
      descriptions.set(
        name,
        response.status === 404
          ? {
              status: "missing",
              reason: "missing_invocable_action",
              detail: `Apex invocable action '${name}' was not found in the org.`,
            }
          : {
              status: "unverifiable",
              reason: "describe_failed",
              detail: `Apex invocable action '${name}' could not be described: ${response.detail}`,
            },
      );
      continue;
    }
    if (!isApexActionDescription(response.body)) {
      descriptions.set(name, {
        status: "unverifiable",
        reason: "invalid_describe_response",
        detail: `Apex invocable action '${name}' returned an invalid describe response.`,
      });
      continue;
    }
    descriptions.set(name, response.body);
  }
  return descriptions;
}

async function apexRestRowsByName(
  conn: Connection,
  names: readonly string[],
): Promise<Map<string, string> | null> {
  if (names.length === 0) return new Map();
  const soql = `SELECT Name, Body FROM ApexClass WHERE Name IN (${soqlInList(names)})`;
  const rows = await safeQueryRecords<ApexClassRow>(conn, "/tooling/query", soql);
  if (!rows) return null;
  const byName = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.Name === "string") {
      byName.set(row.Name, typeof row.Body === "string" ? row.Body : "");
    }
  }
  return byName;
}

function verdictForApexRestTarget(
  target: ActionTarget,
  body: string | undefined,
): TargetResolution {
  if (body === undefined) {
    return {
      status: "missing",
      reason: "missing_class",
      detail: `Apex class '${target.ref_name}' not found in the org.`,
    };
  }
  if (!REST_RESOURCE_RE.test(body)) {
    return {
      status: "missing",
      reason: "missing_rest_resource",
      detail: `Apex class '${target.ref_name}' exists but does not contain @RestResource.`,
    };
  }
  return { status: "ok" };
}

export const apexResolver: TargetResolver = {
  schemes: ["apex", "apexRest"],
  metadataLabel: "ApexClass",
  async resolve(conn: Connection, names: readonly string[], targets: readonly ActionTarget[] = []) {
    const targetList =
      targets.length > 0
        ? targets
        : names.map((name) => ({ name, target: `apex://${name}`, scheme: "apex", ref_name: name }));
    const detailed = await this.resolveTargets?.(conn, targetList);
    if (!detailed) return null;
    const found = new Set<string>();
    for (let i = 0; i < detailed.length; i++) {
      if (detailed[i]?.status === "ok") found.add(targetList[i].ref_name);
    }
    return found;
  },
  async resolveTargets(conn: Connection, targets: readonly ActionTarget[]) {
    const apexTargets = targets.filter((target) => target.scheme === "apex");
    const apexRestTargets = targets.filter((target) => target.scheme === "apexRest");
    const descriptions = await describeApexActions(
      conn,
      apexTargets.map((target) => target.ref_name),
    );
    const apexRestRows = await apexRestRowsByName(
      conn,
      apexRestTargets.map((target) => target.ref_name),
    );
    if (apexRestTargets.length > 0 && !apexRestRows) return null;

    return targets.map((target) => {
      if (target.scheme === "apexRest") {
        return verdictForApexRestTarget(target, apexRestRows?.get(target.ref_name));
      }
      const description = descriptions.get(target.ref_name);
      if (!description) {
        return {
          status: "unverifiable",
          reason: "missing_describe_result",
          detail: `Apex invocable action '${target.ref_name}' was not described.`,
        };
      }
      return "status" in description ? description : verdictForApexAction(target, description);
    });
  },
  missingDetail(target) {
    if (target.scheme === "apexRest") {
      return `Apex class '${target.ref_name}' not found with @RestResource in the org.`;
    }
    return `Apex invocable action '${target.ref_name}' is missing or its registered input/output contract does not match the Agent Script action.`;
  },
  fixHint(name) {
    return `sf project deploy start -m ApexClass:${name}`;
  },
};
