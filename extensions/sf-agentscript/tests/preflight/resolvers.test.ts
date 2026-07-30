/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Resolver-by-resolver tests.
 *
 * Each resolver is exercised against a fake Connection so the test runs
 * offline. The fake captures the request URL so we can assert each
 * resolver hits the right SOQL endpoint with the right sObject + name
 * field.
 */

import { describe, expect, it, vi } from "vitest";
import type { Connection } from "@salesforce/core";

import { agentforceResolver } from "../../lib/preflight/resolvers/agentforce.ts";
import { alwaysAvailableResolver } from "../../lib/preflight/resolvers/always-available.ts";
import { apexResolver } from "../../lib/preflight/resolvers/apex.ts";
import { externalServiceResolver } from "../../lib/preflight/resolvers/external-service.ts";
import { flowResolver } from "../../lib/preflight/resolvers/flow.ts";
import { placeholderResolver } from "../../lib/preflight/resolvers/placeholder.ts";
import { promptTemplateResolver } from "../../lib/preflight/resolvers/prompt-template.ts";
import { quickActionResolver } from "../../lib/preflight/resolvers/quick-action.ts";

interface CapturedRequest {
  url?: string;
}

function fakeConn(rows: Array<Record<string, unknown>>) {
  const captured: CapturedRequest = {};
  const request = vi.fn(async (options: { url: string }) => {
    captured.url = options.url;
    return { records: rows };
  });
  return { conn: { request } as unknown as Connection, captured };
}

function decode(url: string | undefined): string {
  return url ? decodeURIComponent(url) : "";
}

describe("flowResolver", () => {
  it("hits /query?FlowDefinitionView.ApiName and dedups names", async () => {
    const { conn, captured } = fakeConn([{ ApiName: "MyFlow" }]);
    const found = await flowResolver.resolve(conn, ["MyFlow", "MyFlow", "Other"]);
    expect(found?.has("MyFlow")).toBe(true);
    expect(decode(captured.url)).toContain("/query");
    expect(decode(captured.url)).toContain("FROM FlowDefinitionView");
    expect(decode(captured.url)).toContain("ApiName");
    expect(decode(captured.url)).toContain("IsActive = true");
    // Dedup
    const matches = (decode(captured.url).match(/'MyFlow'/g) ?? []).length;
    expect(matches).toBe(1);
  });

  it("returns empty Set for empty input without a network call", async () => {
    const { conn } = fakeConn([]);
    const found = await flowResolver.resolve(conn, []);
    expect(found?.size).toBe(0);
    expect(
      (conn as unknown as { request: { mock: { calls: unknown[] } } }).request.mock.calls,
    ).toHaveLength(0);
  });

  it("checks Agent Script I/O names against active Flow variables", async () => {
    const { conn } = fakeConn([
      {
        Definition: { DeveloperName: "MyFlow" },
        Metadata: {
          variables: [
            { name: "order_id", isInput: true, isOutput: false },
            { name: "status", isInput: false, isOutput: true },
          ],
        },
      },
    ]);
    const detailed = await flowResolver.resolveTargets?.(conn, [
      {
        name: "ok",
        target: "flow://MyFlow",
        scheme: "flow",
        ref_name: "MyFlow",
        input_names: ["order_id"],
        output_names: ["status"],
      },
      {
        name: "bad",
        target: "flow://MyFlow",
        scheme: "flow",
        ref_name: "MyFlow",
        input_names: ["customer_id"],
        output_names: ["status"],
      },
    ]);
    expect(detailed?.[0].status).toBe("ok");
    expect(detailed?.[1].status).toBe("missing");
    expect(detailed?.[1].reason).toBe("io_mismatch");
    expect(detailed?.[1].detail).toMatch(/customer_id/);
    expect(detailed?.[1].data?.actual_inputs).toEqual(["order_id"]);
  });

  it("fixHint suggests deploying the Flow", () => {
    expect(flowResolver.fixHint?.("MyFlow")).toMatch(/Flow:MyFlow/);
  });
});

describe("apexResolver", () => {
  function fakeApexActionConn(
    descriptions: Record<
      string,
      { name: string; inputs: Array<{ name: string }>; outputs: Array<{ name: string }> }
    >,
  ) {
    const request = vi.fn(async (options: { url: string }) => {
      const name = decodeURIComponent(options.url.split("/").at(-1) ?? "");
      const description = descriptions[name];
      if (!description) throw new Error(`No action description for ${name}`);
      return description;
    });
    return { conn: { request } as unknown as Connection, request };
  }

  function authenticatedConn() {
    return {
      accessToken: "JWT",
      instanceUrl: "https://example.my.salesforce.com",
      getApiVersion: () => "67.0",
      getConnectionOptions: () => ({
        accessToken: "JWT",
        instanceUrl: "https://example.my.salesforce.com",
      }),
    } as unknown as Connection;
  }

  it("uses the registered Apex action contract for direct primitive inputs and outputs", async () => {
    expect(apexResolver.schemes).toContain("apex");
    expect(apexResolver.schemes).toContain("apexRest");
    const { conn, request } = fakeApexActionConn({
      DirectPrimitiveAction: {
        name: "DirectPrimitiveAction",
        inputs: [{ name: "channelName" }],
        outputs: [{ name: "output" }],
      },
    });

    const detailed = await apexResolver.resolveTargets?.(conn, [
      {
        name: "check_availability",
        target: "apex://DirectPrimitiveAction",
        scheme: "apex",
        ref_name: "DirectPrimitiveAction",
        input_names: ["channelName"],
        output_names: ["output"],
      },
    ]);

    expect(detailed?.[0].status).toBe("ok");
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0].url).toBe("/actions/custom/apex/DirectPrimitiveAction");
  });

  it("compares registered Apex inputs and outputs separately", async () => {
    const { conn } = fakeApexActionConn({
      OrderAction: {
        name: "OrderAction",
        inputs: [{ name: "orderId" }],
        outputs: [{ name: "status" }],
      },
    });

    const detailed = await apexResolver.resolveTargets?.(conn, [
      {
        name: "bad",
        target: "apex://OrderAction",
        scheme: "apex",
        ref_name: "OrderAction",
        input_names: ["status"],
        output_names: ["orderId"],
      },
    ]);

    expect(detailed?.[0].status).toBe("missing");
    expect(detailed?.[0].reason).toBe("io_mismatch");
    expect(detailed?.[0].detail).toMatch(/missing input\(s\): status/);
    expect(detailed?.[0].detail).toMatch(/missing output\(s\): orderId/);
    expect(detailed?.[0].data?.actual_inputs).toEqual(["orderId"]);
    expect(detailed?.[0].data?.actual_outputs).toEqual(["status"]);
  });

  it("describes each unique Apex action once", async () => {
    const { conn, request } = fakeApexActionConn({
      SharedAction: { name: "SharedAction", inputs: [], outputs: [] },
    });

    const detailed = await apexResolver.resolveTargets?.(conn, [
      { name: "first", target: "apex://SharedAction", scheme: "apex", ref_name: "SharedAction" },
      { name: "second", target: "apex://SharedAction", scheme: "apex", ref_name: "SharedAction" },
    ]);

    expect(detailed?.map((item) => item.status)).toEqual(["ok", "ok"]);
    expect(request).toHaveBeenCalledOnce();
  });

  it("classifies a confirmed missing Apex action as missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify([{ errorCode: "NOT_FOUND", message: "Not found" }]), {
            status: 404,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    try {
      const detailed = await apexResolver.resolveTargets?.(authenticatedConn(), [
        { name: "x", target: "apex://PlainClass", scheme: "apex", ref_name: "PlainClass" },
      ]);
      expect(detailed?.[0].status).toBe("missing");
      expect(detailed?.[0].reason).toBe("missing_invocable_action");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("classifies non-404 Apex action describe failures as unverifiable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify([{ errorCode: "SERVER_ERROR", message: "Try again" }]), {
            status: 500,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    try {
      const detailed = await apexResolver.resolveTargets?.(authenticatedConn(), [
        { name: "x", target: "apex://Unclear", scheme: "apex", ref_name: "Unclear" },
      ]);
      expect(detailed?.[0].status).toBe("unverifiable");
      expect(detailed?.[0].detail).toMatch(/could not be described/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("classifies malformed successful action descriptions as unverifiable", async () => {
    const request = vi.fn(async () => ({ inputs: [null], outputs: [] }));
    const detailed = await apexResolver.resolveTargets?.({ request } as unknown as Connection, [
      { name: "x", target: "apex://Malformed", scheme: "apex", ref_name: "Malformed" },
    ]);

    expect(detailed?.[0].status).toBe("unverifiable");
    expect(detailed?.[0].reason).toBe("invalid_describe_response");
  });

  it("requires @RestResource for apexRest:// targets", async () => {
    const { conn } = fakeConn([
      { Name: "RestClass", Body: "@RestResource public class RestClass {}" },
    ]);
    const found = await apexResolver.resolve(
      conn,
      ["RestClass"],
      [{ name: "x", target: "apexRest://RestClass", scheme: "apexRest", ref_name: "RestClass" }],
    );
    expect(found?.has("RestClass")).toBe(true);

    const { conn: badConn } = fakeConn([{ Name: "RestClass", Body: "public class RestClass {}" }]);
    const detailed = await apexResolver.resolveTargets?.(badConn, [
      { name: "x", target: "apexRest://RestClass", scheme: "apexRest", ref_name: "RestClass" },
    ]);
    expect(detailed?.[0].reason).toBe("missing_rest_resource");
  });

  it("fixHint suggests deploying the ApexClass", () => {
    expect(apexResolver.fixHint?.("MyClass")).toMatch(/ApexClass:MyClass/);
  });
});

describe("agentforceResolver", () => {
  it("queries BotDefinition.DeveloperName via data API", async () => {
    const { conn, captured } = fakeConn([{ DeveloperName: "Order_Agent" }]);
    const found = await agentforceResolver.resolve(conn, ["Order_Agent"]);
    expect(found?.has("Order_Agent")).toBe(true);
    expect(decode(captured.url)).toContain("/query");
    expect(decode(captured.url)).toContain("FROM BotDefinition");
    expect(decode(captured.url)).toContain("DeveloperName");
  });
});

describe("externalServiceResolver", () => {
  it("queries ExternalServiceRegistration.DeveloperName via Tooling API", async () => {
    const { conn, captured } = fakeConn([{ DeveloperName: "MyService" }]);
    const found = await externalServiceResolver.resolve(conn, ["MyService"]);
    expect(found?.has("MyService")).toBe(true);
    expect(decode(captured.url)).toContain("/tooling/query");
    expect(decode(captured.url)).toContain("FROM ExternalServiceRegistration");
  });
});

describe("promptTemplateResolver", () => {
  it("queries Prompt.DeveloperName via Tooling API (for generatePromptResponse://)", async () => {
    expect(promptTemplateResolver.schemes).toEqual(["generatePromptResponse"]);
    const { conn, captured } = fakeConn([{ DeveloperName: "Generate_Schedule" }]);
    const found = await promptTemplateResolver.resolve(conn, ["Generate_Schedule"]);
    expect(found?.has("Generate_Schedule")).toBe(true);
    expect(decode(captured.url)).toContain("/tooling/query");
    expect(decode(captured.url)).toContain("FROM Prompt");
    expect(decode(captured.url)).toContain("Status = 'Active'");
  });
});

describe("quickActionResolver", () => {
  it("queries QuickActionDefinition.DeveloperName via Tooling API", async () => {
    const { conn, captured } = fakeConn([{ DeveloperName: "LogACall" }]);
    const found = await quickActionResolver.resolve(conn, ["LogACall"]);
    expect(found?.has("LogACall")).toBe(true);
    expect(decode(captured.url)).toContain("/tooling/query");
    expect(decode(captured.url)).toContain("FROM QuickActionDefinition");
  });
});

describe("alwaysAvailableResolver", () => {
  it("returns Set(allNames) without a network call for all its schemes", async () => {
    const expected = ["http", "https", "mcp", "mcpTool", "slack", "byon"];
    expect(new Set(alwaysAvailableResolver.schemes)).toEqual(new Set(expected));
    const { conn } = fakeConn([]);
    const found = await alwaysAvailableResolver.resolve(conn, ["A", "B", "C"]);
    expect(found?.size).toBe(3);
    expect(found?.has("A")).toBe(true);
    expect(found?.has("B")).toBe(true);
    expect(found?.has("C")).toBe(true);
    expect(
      (conn as unknown as { request: { mock: { calls: unknown[] } } }).request.mock.calls,
    ).toHaveLength(0);
  });
});

describe("placeholderResolver", () => {
  it("returns an empty Set so every placeholder counts as missing", async () => {
    const found = await placeholderResolver.resolve(undefined as unknown as Connection, ["X"]);
    expect(found?.size).toBe(0);
    expect(placeholderResolver.fixHint?.("X")).toMatch(/Replace placeholder/);
  });
});
