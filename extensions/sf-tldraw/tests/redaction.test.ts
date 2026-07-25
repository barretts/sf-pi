/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { sanitizeRuntimeText, sanitizeRuntimeValue } from "../lib/redaction.ts";

describe("sf-tldraw runtime redaction", () => {
  it("redacts auth material, emails, org ids, URLs, and local paths", () => {
    const text = sanitizeRuntimeText(
      "Bearer abc.def token=secret person@example.test 00D000000000001AAA https://example.test /Users/person/private/file.txt",
    );
    expect(text).not.toContain("abc.def");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("person@example.test");
    expect(text).not.toContain("00D000000000001AAA");
    expect(text).not.toContain("https://example.test");
    expect(text).not.toContain("/Users/person/private/file.txt");
  });

  it("redacts secret and path fields in arbitrary runtime objects", () => {
    expect(
      sanitizeRuntimeValue({
        token: "secret",
        filePath: "/tmp/private",
        nested: { email: "person@example.test" },
      }),
    ).toEqual({
      token: "[REDACTED]",
      filePath: "[PATH]",
      nested: { email: "[EMAIL]" },
    });
  });
});
