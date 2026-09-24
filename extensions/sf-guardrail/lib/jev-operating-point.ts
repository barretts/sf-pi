/* SPDX-License-Identifier: Apache-2.0 */
/** Select and bind one exact experimental operating point. */
import { types } from "node:util";
import { JevClientError } from "./jev-client.ts";
import { jevHash } from "./jev-identity.ts";
import type { JevOperatingPoint } from "./types.ts";
export type { JevOperatingPoint } from "./types.ts";

const CONSERVATIVE = Object.freeze({
  version: 1,
  name: "conservative",
  allowProbability: 0.99,
  syntaxProbability: 0.99,
  totalTimeoutMs: 10_000,
} as const);
const ARGMAX = Object.freeze({
  version: 1,
  name: "argmax",
  allowProbability: 0,
  syntaxProbability: 0,
  totalTimeoutMs: 10_000,
} as const);
const FIELDS = Object.freeze([
  "version",
  "name",
  "allowProbability",
  "syntaxProbability",
  "totalTimeoutMs",
] as const);

export const JEV_OPERATING_POINT_PROTOCOL = Object.freeze({
  version: 1,
  environmentVariable: "SF_GUARDRAIL_JEV_OPERATING_POINT",
  defaultName: "conservative",
  fields: FIELDS,
  shapes: Object.freeze({ conservative: CONSERVATIVE, argmax: ARGMAX }),
  completeOriginalContextRequired: true,
  jointCalibration: false,
  safetyQualification: false,
  conservative:
    "Every actual action answer must select allow with raw P(allow) >= 0.99. Every actual syntax answer must have raw P(selected choice) >= 0.99. These floors do not establish joint calibration.",
  argmax:
    "Use the actual selected choices with both probability floors at zero. Every actual action answer must still select allow. This experimental point has no safety qualification.",
  deadline:
    "One total 10,000 ms deadline includes preparation, all calls, response reads, validation, and synchronous cleanup. Do not reset it for a stage.",
} as const);

function fail(): never {
  throw new JevClientError("invalid_request");
}

/** Read the current name. Do not accept aliases or custom probability floors. */
export function resolveJevOperatingPoint(
  value: unknown = process.env.SF_GUARDRAIL_JEV_OPERATING_POINT,
): JevOperatingPoint {
  if (value === undefined || value === "conservative") return CONSERVATIVE;
  if (value === "argmax") return ARGMAX;
  return fail();
}

/** Inspect data fields without calling getters, proxy traps, or serializers. */
export function validateJevOperatingPoint(point: unknown): JevOperatingPoint {
  if (
    point === null ||
    typeof point !== "object" ||
    types.isProxy(point) ||
    Object.getPrototypeOf(point) !== Object.prototype
  ) {
    return fail();
  }
  const keys = Reflect.ownKeys(point);
  if (keys.length !== FIELDS.length || !FIELDS.every((field) => keys.includes(field))) {
    return fail();
  }
  const descriptors = Object.getOwnPropertyDescriptors(point);
  for (const field of FIELDS) {
    const descriptor = descriptors[field];
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) {
      return fail();
    }
  }
  const name = descriptors.name.value;
  const expected = name === "conservative" ? CONSERVATIVE : name === "argmax" ? ARGMAX : fail();
  for (const field of FIELDS) {
    const value = descriptors[field].value;
    if (
      !Object.is(value, expected[field]) ||
      (field !== "name" && (typeof value !== "number" || !Number.isFinite(value)))
    ) {
      return fail();
    }
  }
  return Object.freeze({ ...expected });
}

/** Hash the validated local copy with the current canonical identity helper. */
export function jevOperatingPointHash(point: unknown): string {
  return jevHash(validateJevOperatingPoint(point));
}
