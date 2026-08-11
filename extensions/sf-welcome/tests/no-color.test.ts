/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { SfWelcomeHeader, SfWelcomeOverlay } from "../lib/splash-component.ts";
import { collectInitialSplashData } from "../lib/splash-data.ts";

const ANSI_SGR = /\x1b\[[0-9;]*m/;

describe("SF Welcome NO_COLOR behavior", () => {
  it("renders the overlay and persistent header without ANSI color escapes", () => {
    withNoColor(() => {
      const data = collectInitialSplashData("Example Model", "example-provider", 100);
      const overlay = new SfWelcomeOverlay(data).render(140).join("\n");
      const header = new SfWelcomeHeader(data).render(140).join("\n");

      expect(overlay).toContain("Welcome back!");
      expect(header).toContain("Press Esc to dismiss");
      expect(overlay).not.toMatch(ANSI_SGR);
      expect(header).not.toMatch(ANSI_SGR);
    });
  });
});

function withNoColor(work: () => void): void {
  const previous = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    work();
  } finally {
    if (previous === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previous;
  }
}
