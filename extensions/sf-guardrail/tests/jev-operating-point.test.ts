/* SPDX-License-Identifier: Apache-2.0 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JevClientError } from "../lib/jev-client.ts";
import { jevHash } from "../lib/jev-identity.ts";
import {
  JEV_OPERATING_POINT_PROTOCOL,
  jevOperatingPointHash,
  resolveJevOperatingPoint,
  validateJevOperatingPoint,
} from "../lib/jev-operating-point.ts";

const ENV = "SF_GUARDRAIL_JEV_OPERATING_POINT";
const conservative = () => ({
  version: 1,
  name: "conservative",
  allowProbability: 0.99,
  syntaxProbability: 0.99,
  totalTimeoutMs: 10_000,
});
const argmax = () => ({
  version: 1,
  name: "argmax",
  allowProbability: 0,
  syntaxProbability: 0,
  totalTimeoutMs: 10_000,
});

function expectInvalid(run: () => unknown): void {
  let failure: unknown;
  try {
    run();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(JevClientError);
  expect(failure).toMatchObject({ code: "invalid_request" });
}

beforeEach(() => vi.stubEnv(ENV, undefined));
afterEach(() => vi.unstubAllEnvs());

describe("experimental Jev operating point selection", () => {
  it("uses the frozen conservative point when the environment value is absent", () => {
    const point = resolveJevOperatingPoint();
    expect(point).toEqual(conservative());
    expect(Object.isFrozen(point)).toBe(true);
    expect(Reflect.set(point, "allowProbability", 0)).toBe(false);
    expect(point).toEqual(conservative());
  });

  it.each([
    ["conservative", conservative()],
    ["argmax", argmax()],
  ])("selects only the exact frozen %s values", (name, expected) => {
    const point = resolveJevOperatingPoint(name);
    expect(point).toEqual(expected);
    expect(Object.isFrozen(point)).toBe(true);
  });

  it.each(["", " ", "default", "safe", "Conservative", "ARGMAX", " argmax", "0.99"])(
    "rejects the unsupported name %j",
    (name) => {
      expectInvalid(() => resolveJevOperatingPoint(name));
      vi.stubEnv(ENV, name);
      expectInvalid(() => resolveJevOperatingPoint());
    },
  );

  it.each([null, 0, 0.99, true, {}, [], conservative(), new String("argmax")])(
    "rejects a supplied value that is not a named string",
    (value) => expectInvalid(() => resolveJevOperatingPoint(value)),
  );

  it("does not call a supplied value serializer", () => {
    const toString = vi.fn(() => "argmax");
    const toJSON = vi.fn(() => "argmax");
    expectInvalid(() => resolveJevOperatingPoint({ toString, toJSON }));
    expect(toString).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
  });

  it("reads each current environment value without changing a previous point", () => {
    const first = resolveJevOperatingPoint();
    vi.stubEnv(ENV, "argmax");
    expect(resolveJevOperatingPoint()).toEqual(argmax());
    expect(first).toEqual(conservative());
    vi.stubEnv(ENV, undefined);
    expect(resolveJevOperatingPoint()).toEqual(conservative());
  });

  it("keeps explicit selection separate from the current environment value", () => {
    vi.stubEnv(ENV, "invalid");
    expectInvalid(() => resolveJevOperatingPoint());
    expect(resolveJevOperatingPoint("conservative")).toEqual(conservative());
    expect(resolveJevOperatingPoint("argmax")).toEqual(argmax());
  });
});

describe("exact Jev operating point validation", () => {
  it.each([conservative(), argmax()])(
    "returns a frozen independent copy of valid fields",
    (input) => {
      const point = validateJevOperatingPoint(input);
      expect(point).toEqual(input);
      expect(point).not.toBe(input);
      expect(Object.isFrozen(point)).toBe(true);
      input.allowProbability = 0.5;
      expect(point.allowProbability).not.toBe(0.5);
      expectInvalid(() => validateJevOperatingPoint(input));
      expectInvalid(() => jevOperatingPointHash(input));
    },
  );

  it.each([
    { ...conservative(), name: "argmax" },
    { ...argmax(), name: "conservative" },
    { ...conservative(), allowProbability: 0 },
    { ...conservative(), syntaxProbability: 0 },
    { ...argmax(), allowProbability: 0.99 },
    { ...argmax(), syntaxProbability: 0.99 },
    { ...conservative(), allowProbability: 0.98 },
    { ...conservative(), syntaxProbability: 1 },
    { ...conservative(), version: 2 },
    { ...conservative(), totalTimeoutMs: 1_500 },
    { ...argmax(), allowProbability: -0 },
    { ...argmax(), syntaxProbability: -0 },
  ])("rejects changed fields and mismatched name pairs", (point) => {
    expectInvalid(() => validateJevOperatingPoint(point));
    expectInvalid(() => jevOperatingPointHash(point));
  });

  it.each([NaN, Infinity, -Infinity, "0.99", undefined])(
    "rejects invalid numeric fields",
    (value) => {
      for (const field of ["version", "allowProbability", "syntaxProbability", "totalTimeoutMs"]) {
        expectInvalid(() => validateJevOperatingPoint({ ...conservative(), [field]: value }));
      }
    },
  );

  it.each([null, undefined, "conservative", [], Object.create(null), new Date()])(
    "rejects an invalid point shape or prototype",
    (point) => expectInvalid(() => validateJevOperatingPoint(point)),
  );

  it("rejects inherited fields and custom prototypes", () => {
    expectInvalid(() => validateJevOperatingPoint(Object.create(conservative())));
    const inheritedSerializer = vi.fn();
    const point = Object.assign(Object.create({ toJSON: inheritedSerializer }), conservative());
    expectInvalid(() => jevOperatingPointHash(point));
    expect(inheritedSerializer).not.toHaveBeenCalled();
  });

  it.each(JEV_OPERATING_POINT_PROTOCOL.fields)("rejects missing field %s", (field) => {
    const point: Record<string, unknown> = conservative();
    delete point[field];
    expectInvalid(() => validateJevOperatingPoint(point));
  });

  it.each(JEV_OPERATING_POINT_PROTOCOL.fields)(
    "rejects getter field %s without reading it",
    (field) => {
      const getter = vi.fn(() => conservative()[field]);
      const point = Object.defineProperty(conservative(), field, { get: getter, enumerable: true });
      expectInvalid(() => validateJevOperatingPoint(point));
      expectInvalid(() => jevOperatingPointHash(point));
      expect(getter).not.toHaveBeenCalled();
    },
  );

  it("rejects nonenumerable fields and every extra own key", () => {
    expectInvalid(() => validateJevOperatingPoint({ ...conservative(), extra: true }));
    expectInvalid(() => validateJevOperatingPoint({ ...conservative(), [Symbol("extra")]: true }));
    const hidden = Object.defineProperty(conservative(), "name", { enumerable: false });
    expectInvalid(() => validateJevOperatingPoint(hidden));
    const serializer = vi.fn();
    const withSerializer = Object.defineProperty(conservative(), "toJSON", { value: serializer });
    expectInvalid(() => jevOperatingPointHash(withSerializer));
    expect(serializer).not.toHaveBeenCalled();
  });

  it("rejects proxy inputs before invoking any trap", () => {
    const trap = vi.fn();
    const point = new Proxy(conservative(), {
      get: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
      getOwnPropertyDescriptor: trap,
    });
    expectInvalid(() => validateJevOperatingPoint(point));
    expectInvalid(() => jevOperatingPointHash(point));
    expect(trap).not.toHaveBeenCalled();
    const revoked = Proxy.revocable(conservative(), {});
    revoked.revoke();
    expectInvalid(() => validateJevOperatingPoint(revoked.proxy));
  });
});

describe("Jev operating point identity and protocol", () => {
  it("uses the current canonical helper and binds different named points", () => {
    const first = resolveJevOperatingPoint("conservative");
    const second = resolveJevOperatingPoint("argmax");
    expect(jevOperatingPointHash(first)).toBe(jevHash(first));
    expect(jevOperatingPointHash(second)).toBe(jevHash(second));
    expect(jevOperatingPointHash(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(jevOperatingPointHash(first)).not.toBe(jevOperatingPointHash(second));
  });

  it("keeps point identity independent of property order and later environment changes", () => {
    const point = {
      totalTimeoutMs: 10_000,
      syntaxProbability: 0.99,
      allowProbability: 0.99,
      name: "conservative",
      version: 1,
    };
    const identity = jevOperatingPointHash(point);
    vi.stubEnv(ENV, "argmax");
    expect(jevOperatingPointHash(point)).toBe(identity);
    expect(identity).toBe(jevOperatingPointHash(resolveJevOperatingPoint("conservative")));
    expect(identity).not.toBe(jevOperatingPointHash(resolveJevOperatingPoint()));
  });

  it("freezes the declared shapes and preserves the experimental proof limits", () => {
    const protocol = JEV_OPERATING_POINT_PROTOCOL;
    expect(protocol.shapes.conservative).toEqual(conservative());
    expect(protocol.shapes.argmax).toEqual(argmax());
    expect(protocol.completeOriginalContextRequired).toBe(true);
    expect(protocol.jointCalibration).toBe(false);
    expect(protocol.safetyQualification).toBe(false);
    for (const value of [
      protocol,
      protocol.fields,
      protocol.shapes,
      ...Object.values(protocol.shapes),
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });
});
