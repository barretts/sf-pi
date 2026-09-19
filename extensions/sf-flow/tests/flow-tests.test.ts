/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it, vi } from "vitest";
import {
  defaultFlowTestAdapter,
  discoverFlowTests,
  getFlowTestResult,
  runFlowTests,
  type FlowTestAdapter,
} from "../lib/flow-tests.ts";
import type { SfFlowSessionState } from "../lib/types.ts";

const writeArtifact = async (kind: string, filename: string) => ({
  path: `/tmp/${filename}`,
  kind,
});

describe("SF Flow targeted tests", () => {
  it("discovers FlowTest metadata and groups tests by Flow API name", async () => {
    const query = vi.fn(async () => ({
      records: [
        {
          DeveloperName: "Happy_Path",
          MasterLabel: "Happy Path",
          Metadata: { flowApiName: "Fixture_Flow" },
        },
        {
          DeveloperName: "Alternate_Path",
          MasterLabel: "Alternate Path",
          Metadata: { flowApiName: "Fixture_Flow" },
        },
      ],
    }));

    const candidates = await defaultFlowTestAdapter.discover({ query } as never, 10);

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ api: "tooling", soql: expect.stringContaining("FROM FlowTest") }),
    );
    expect(candidates).toEqual([
      {
        flow_name: "Fixture_Flow",
        namespace: undefined,
        test_names: ["Happy_Path", "Alternate_Path"],
      },
    ]);
  });

  it("discovers only Flow tests", async () => {
    const adapter: FlowTestAdapter = {
      discover: async () => [{ flow_name: "Request_Intake", test_names: ["Happy_Path"] }],
      run: vi.fn(),
      result: vi.fn(),
    };

    const result = await discoverFlowTests(
      { action: "test.discover", target_org: "sandbox" },
      {} as never,
      { adapter, writeArtifact },
    );

    expect(result.details.candidates).toEqual([
      { flow_name: "Request_Intake", test_names: ["Happy_Path"] },
    ]);
  });

  it("runs specified Flow tests with the Flow category", async () => {
    const state: SfFlowSessionState = {};
    const run = vi.fn<FlowTestAdapter["run"]>().mockResolvedValue({
      run_id: "707000000000001",
      queued: true,
    });
    const adapter: FlowTestAdapter = {
      discover: vi.fn(),
      run,
      result: vi.fn(),
    };

    const result = await runFlowTests(
      {
        action: "test.run",
        target_org: "sandbox",
        tests: ["Request_Intake.Happy_Path"],
        wait_seconds: 0,
      },
      {} as never,
      state,
      { adapter, writeArtifact },
    );

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "Flow",
        tests: ["Request_Intake.Happy_Path"],
      }),
    );
    expect(result.details.run_id).toBe("707000000000001");
    expect(state.last_test_run_id).toBe("707000000000001");
  });

  it("retrieves normalized Flow test results", async () => {
    const adapter: FlowTestAdapter = {
      discover: vi.fn(),
      run: vi.fn(),
      result: async () => ({
        run_id: "707000000000002",
        queued: false,
        outcome: "Passed",
        tests: [
          {
            flow_name: "Request_Intake",
            test_name: "Happy_Path",
            outcome: "Pass",
            run_time_ms: 25,
          },
        ],
        raw: { summary: { outcome: "Passed" } },
      }),
    };

    const result = await getFlowTestResult(
      { action: "test.result", target_org: "sandbox", run_id: "707000000000002" },
      {} as never,
      {},
      { adapter, writeArtifact },
    );

    expect(result.details).toMatchObject({ ok: true, outcome: "Passed", passing: 1, failing: 0 });
    expect(result.details.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "tests" }),
        expect.objectContaining({ kind: "test-reports" }),
      ]),
    );
  });
});
