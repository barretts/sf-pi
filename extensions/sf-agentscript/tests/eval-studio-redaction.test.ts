/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { redactStudioValue } from "../lib/eval-studio/redaction.ts";

describe("Eval Studio redaction", () => {
  it("masks secrets, raw prompts, action payloads, and session-bearing URLs recursively", () => {
    const result = redactStudioValue({
      token: "secret-token",
      nested: { password: "secret", safe: "visible" },
      prompt_content: "system instructions",
      action_input: { account: "private" },
      link: "https://example.invalid/path?sid=session-secret&view=ok",
      conversation: "ordinary user text",
    });
    expect(result).toMatchObject({
      token: "[REDACTED]",
      nested: { password: "[REDACTED]", safe: "visible" },
      prompt_content: "[REDACTED]",
      action_input: "[REDACTED]",
      conversation: "ordinary user text",
    });
    expect((result as { link: string }).link).not.toContain("session-secret");
  });

  it("masks short org-derived values on token boundaries", () => {
    expect(
      redactStudioValue("Region US but status BUSY", "", {
        sensitiveValues: new Set(["US"]),
      }),
    ).toBe("Region [REDACTED] but status BUSY");
  });

  it("masks org-derived names and values throughout run projections", () => {
    const result = redactStudioValue(
      {
        agent_response: "Account 001SECRET is ready.",
        actual_value: "001SECRET",
        state_variables: { customer_id: "001SECRET", safe_state: "visible" },
      },
      "",
      {
        sensitiveNames: new Set(["customer_id"]),
        sensitiveValues: new Set(["001SECRET"]),
      },
    );
    expect(result).toEqual({
      agent_response: "Account [REDACTED] is ready.",
      actual_value: "[REDACTED]",
      state_variables: { customer_id: "[REDACTED]", safe_state: "visible" },
    });
  });

  it("masks every context-variable value regardless of its field name", () => {
    expect(
      redactStudioValue({
        context_variables: [
          { name: "RoutableId", type: "Text", value: "0Mw000000000001AAA" },
          { name: "customer_email", type: "Text", value: "customer@example.com" },
        ],
      }),
    ).toEqual({
      context_variables: [
        { name: "RoutableId", type: "Text", value: "[REDACTED]" },
        { name: "customer_email", type: "Text", value: "[REDACTED]" },
      ],
    });
  });
});
