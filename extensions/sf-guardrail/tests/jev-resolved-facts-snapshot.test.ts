/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";
import { snapshotJevResolvedFacts } from "../lib/jev-risk.ts";
import type { JevResolvedFacts } from "../lib/types.ts";

describe("returned facts snapshot has no duplicate host wire cap", () => {
  it("preserves finite scalars, optional undefined and shared values without aliases", () => {
    const shared = { signedZero: -0, subnormal: Number.MIN_VALUE, largest: Number.MAX_VALUE };
    const original = {
      facts: {
        browser: { status: "fresh", ageMs: -0, role: undefined },
        files: [{ path: "notes.txt", exists: true, kind: undefined, numbers: shared }],
        numbers: shared,
      },
      orgIdentity: undefined,
      browserIdentity: "local-synthetic-browser-identity",
    } as unknown as JevResolvedFacts;
    const result = snapshotJevResolvedFacts(original);
    expect(result).toEqual(original);
    expect(result).not.toBe(original);
    expect(result.facts).not.toBe(original.facts);
    expect(Object.is(result.facts.browser!.ageMs, -0)).toBe(true);
    expect(Object.hasOwn(result.facts.browser!, "role")).toBe(true);
    expect(Object.hasOwn(result.facts.files![0], "kind")).toBe(true);
    expect(Object.hasOwn(result, "orgIdentity")).toBe(true);
    const copied = (result.facts as any).numbers;
    expect(copied).toBe((result.facts.files![0] as any).numbers);
    expect(copied).not.toBe(shared);
    expect(Object.is(copied.signedZero, -0)).toBe(true);
    expect(Object.is(copied.subnormal, Number.MIN_VALUE)).toBe(true);
    expect(Object.is(copied.largest, Number.MAX_VALUE)).toBe(true);
    expect(
      [
        result,
        result.facts,
        result.facts.files,
        result.facts.files![0],
        result.facts.browser,
        copied,
      ].every(Object.isFrozen),
    ).toBe(true);
    shared.signedZero = 1;
    original.facts.browser!.status = "stale";
    expect(Object.is(copied.signedZero, -0)).toBe(true);
    expect(result.facts.browser!.status).toBe("fresh");
    expect(Object.isFrozen(original)).toBe(false);
    expect(() => {
      result.facts.browser!.status = "changed";
    }).toThrow(TypeError);
  });

  it("does not count unrelated host fields against a wire envelope", () => {
    const original = {
      facts: {},
      padding: Array.from({ length: 17000 }, () => 0),
    } as JevResolvedFacts;
    const result = snapshotJevResolvedFacts(original);
    expect(result).toEqual(original);
    expect((result as any).padding).not.toBe((original as any).padding);
    expect(Object.isFrozen((result as any).padding)).toBe(true);
  });

  it("checks plain data before cloning without invoking getters or serializers", () => {
    const getter = vi.fn(() => ({}));
    const toJSON = vi.fn(() => ({}));
    const result = Object.defineProperty({ toJSON }, "facts", { enumerable: true, get: getter });
    expect(() => snapshotJevResolvedFacts(result as any)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
  });

  it("rejects unsupported hidden fields and symbols instead of dropping source data", () => {
    const hidden = Object.defineProperty({ facts: {} }, "hidden", {
      value: "lost",
      enumerable: false,
    });
    const symbol = { facts: {}, [Symbol("lost")]: "lost" };
    for (const result of [hidden, symbol]) expect(() => snapshotJevResolvedFacts(result)).toThrow();
  });

  it.each([NaN, Infinity, -Infinity])("rejects the non-finite scalar %s", (number) => {
    const result = { facts: { browser: { status: "fresh", ageMs: number } } };
    expect(() => snapshotJevResolvedFacts(result)).toThrow();
  });
});
