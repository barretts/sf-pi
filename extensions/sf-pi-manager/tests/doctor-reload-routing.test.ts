/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior Proof for `/sf-pi doctor fix` reload routing. */
import { describe, expect, it, vi } from "vitest";

const { handleDoctor, runDoctorDiagnostics } = vi.hoisted(() => ({
  handleDoctor: vi.fn(),
  runDoctorDiagnostics: vi.fn(),
}));

vi.mock("../lib/doctor-command.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/doctor-command.ts")>();
  return { ...actual, handleDoctor };
});
vi.mock("../../../lib/common/doctor/diagnostics.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/common/doctor/diagnostics.ts")>();
  return { ...actual, runDoctorDiagnostics };
});

import { handleCommand } from "../index.ts";

const autoUpdateRunner = {
  runNow: vi.fn(),
  onSessionStart: vi.fn(),
  onAgentStart: vi.fn(),
  onAgentSettled: vi.fn(),
  onSessionShutdown: vi.fn(),
};

function context() {
  return {
    cwd: "/tmp/sf-pi-doctor-routing-test",
    ui: { setStatus: vi.fn() },
  };
}

describe("doctor command reload routing", () => {
  it("does not reuse the command ctx after doctor reloads", async () => {
    handleDoctor.mockResolvedValueOnce(true);
    const ctx = context();

    await handleCommand({} as never, "doctor fix startup", ctx as never, autoUpdateRunner as never);

    expect(handleDoctor).toHaveBeenCalledOnce();
    expect(runDoctorDiagnostics).not.toHaveBeenCalled();
    expect(ctx.ui.setStatus).not.toHaveBeenCalled();
  });

  it("refreshes the doctor nudge when the command does not reload", async () => {
    handleDoctor.mockResolvedValueOnce(false);
    runDoctorDiagnostics.mockReturnValueOnce({});
    const ctx = context();

    await handleCommand({} as never, "doctor runtime", ctx as never, autoUpdateRunner as never);

    expect(runDoctorDiagnostics).toHaveBeenCalledOnce();
    expect(ctx.ui.setStatus).toHaveBeenCalledOnce();
  });
});
