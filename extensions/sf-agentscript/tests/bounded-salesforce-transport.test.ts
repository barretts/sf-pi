/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, test, vi } from "vitest";
import {
  boundedPromise,
  boundedRestRequest,
  boundedSoqlQuery,
} from "../lib/bounded-salesforce-transport.ts";

function fakeConn() {
  return {
    accessToken: "JWT",
    instanceUrl: "https://example.my.salesforce.com",
    getApiVersion: () => "67.0",
    getConnectionOptions: () => ({
      accessToken: "JWT",
      instanceUrl: "https://example.my.salesforce.com",
    }),
  };
}

describe("boundedPromise", () => {
  test("rejects when an operation never settles", async () => {
    vi.useFakeTimers();
    try {
      const result = boundedPromise(new Promise<unknown>(() => undefined), "metadata read", 5);
      const assertion = expect(result).rejects.toMatchObject({
        name: "BoundedOperationTimeoutError",
        timedOutAfterMs: 5,
      });
      await vi.advanceTimersByTimeAsync(5);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("boundedRestRequest auth refresh", () => {
  test("retries once with refreshed auth after a stale-token 401", async () => {
    const conn = fakeConn() as ReturnType<typeof fakeConn> & {
      refreshAuth: ReturnType<typeof vi.fn>;
    };
    conn.refreshAuth = vi.fn(async () => {
      conn.accessToken = "FRESH";
      conn.getConnectionOptions = () => ({
        accessToken: conn.accessToken,
        instanceUrl: conn.instanceUrl,
      });
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await boundedRestRequest<{ ok: boolean }>(
      conn as never,
      "/sobjects/User/describe",
      "GET",
    );

    expect(result).toMatchObject({ ok: true, status: 200, body: { ok: true } });
    expect(conn.refreshAuth).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});

describe("boundedRestRequest legacy fallback", () => {
  test("tokenless fallback times out instead of waiting forever", async () => {
    vi.useFakeTimers();
    try {
      const conn = {
        getApiVersion: () => "67.0",
        request: () => new Promise<unknown>(() => undefined),
      };

      const resultPromise = boundedRestRequest(conn as never, "/sobjects/User", "POST", {
        timeoutMs: 5,
      });
      await vi.advanceTimersByTimeAsync(5);
      await expect(resultPromise).resolves.toMatchObject({
        ok: false,
        reason: "timeout",
        timed_out_after_ms: 5,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("pre-aborted signal prevents tokenless fallback request", async () => {
    const controller = new AbortController();
    controller.abort();
    const request = vi.fn();
    const conn = { getApiVersion: () => "67.0", request };

    const result = await boundedRestRequest(conn as never, "/sobjects/User", "POST", {
      signal: controller.signal,
    });

    expect(result).toMatchObject({ ok: false, reason: "aborted" });
    expect(request).not.toHaveBeenCalled();
  });
});

describe("boundedSoqlQuery auth refresh", () => {
  test("retries once with refreshed auth after a stale-token 401", async () => {
    const conn = fakeConn() as ReturnType<typeof fakeConn> & {
      refreshAuth: ReturnType<typeof vi.fn>;
    };
    conn.refreshAuth = vi.fn(async () => {
      conn.accessToken = "FRESH";
      conn.getConnectionOptions = () => ({
        accessToken: conn.accessToken,
        instanceUrl: conn.instanceUrl,
      });
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ errorCode: "INVALID_SESSION_ID" }]), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ records: [{ Id: "001" }], totalSize: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await boundedSoqlQuery<{ Id: string }>(conn as never, "SELECT Id FROM Account");

    expect(result).toMatchObject({ ok: true, records: [{ Id: "001" }], totalSize: 1 });
    expect(conn.refreshAuth).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer FRESH",
    });
    vi.unstubAllGlobals();
  });
});

describe("boundedSoqlQuery cancellation", () => {
  test("pre-aborted signal returns an aborted result without fetching", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn<typeof fetch>();

    const result = await boundedSoqlQuery(fakeConn() as never, "SELECT Id FROM Account", {
      signal: controller.signal,
      fetchImpl,
    });

    expect(result).toMatchObject({ ok: false, reason: "aborted" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("tokenless query fallback times out instead of waiting forever", async () => {
    vi.useFakeTimers();
    try {
      const conn = {
        getApiVersion: () => "67.0",
        query: () => new Promise<unknown>(() => undefined),
      };

      const resultPromise = boundedSoqlQuery(conn as never, "SELECT Id FROM Account", {
        timeoutMs: 5,
      });
      await vi.advanceTimersByTimeAsync(5);
      await expect(resultPromise).resolves.toMatchObject({
        ok: false,
        reason: "timeout",
        timed_out_after_ms: 5,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
