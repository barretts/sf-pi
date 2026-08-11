/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { colorsEnabled, stripAnsiIfNoColor, stripAnsiSgr } from "../color-policy.ts";

const colored = "\x1b[38;2;1;2;3mHello\x1b[0m";

describe("shared NO_COLOR policy", () => {
  it("treats NO_COLOR presence as disabling color", () => {
    expect(colorsEnabled({})).toBe(true);
    expect(colorsEnabled({ NO_COLOR: "1" })).toBe(false);
    expect(colorsEnabled({ NO_COLOR: "" })).toBe(false);
  });

  it("strips only ANSI SGR sequences when color is disabled", () => {
    expect(stripAnsiSgr(colored)).toBe("Hello");
    expect(stripAnsiIfNoColor(colored, { NO_COLOR: "1" })).toBe("Hello");
    expect(stripAnsiIfNoColor(colored, {})).toBe(colored);
  });
});
