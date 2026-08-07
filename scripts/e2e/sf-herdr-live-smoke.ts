/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Opt-in live disposable-pane smoke for the current Herdr runtime.
 *
 * Run only from a disposable Herdr session:
 *   SF_HERDR_LIVE_SMOKE=1 node --experimental-strip-types scripts/e2e/sf-herdr-live-smoke.ts
 *
 * The pane is closed only after split, harmless marker run, and a matching
 * output snapshot all succeed. Any failure leaves the pane open and prints its opaque ID.
 */
import { spawnSync } from "node:child_process";

interface JsonEnvelope<T> {
  result?: T;
  error?: { code?: string; message?: string };
}

if (process.env.SF_HERDR_LIVE_SMOKE !== "1") {
  console.error("Refusing live Herdr smoke without SF_HERDR_LIVE_SMOKE=1.");
  process.exit(2);
}
if (process.env.HERDR_ENV !== "1" || !process.env.HERDR_PANE_ID) {
  console.error("Run the live smoke inside a Herdr pane with HERDR_ENV=1 and HERDR_PANE_ID set.");
  process.exit(2);
}

const markerSuffix = `${process.pid}-${Date.now()}`;
const marker = `sf-herdr-smoke-${markerSuffix}`;
let createdPane: string | undefined;
let observedSuccess = false;

try {
  const split = runJson<{ pane: { pane_id: string } }>([
    "pane",
    "split",
    process.env.HERDR_PANE_ID,
    "--direction",
    "right",
    "--cwd",
    process.cwd(),
    "--no-focus",
  ]);
  createdPane = split.pane.pane_id;
  if (!createdPane) throw new Error("pane split returned no opaque pane ID");

  // `pane run` is a successful submission command and does not return a JSON envelope.
  run(["pane", "run", createdPane, `printf 'sf-herdr-smoke-%s\\n' '${markerSuffix}'`]);
  const matched = runJson<{ read?: { text?: string } }>([
    "pane",
    "wait-output",
    createdPane,
    "--match",
    marker,
    "--source",
    "recent-unwrapped",
    "--timeout",
    "10000",
  ]);
  if (!matched.read?.text?.includes(marker)) {
    throw new Error("marker was not present in the matched output snapshot");
  }
  observedSuccess = true;

  runJson(["pane", "close", createdPane]);
  console.info(`SF Herdr live smoke passed and closed pane ${createdPane}.`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`SF Herdr live smoke failed: ${message}`);
  if (createdPane && !observedSuccess) {
    console.error(`Pane ${createdPane} remains open for inspection.`);
  } else if (createdPane) {
    console.error(`Success was observed but cleanup failed; pane ${createdPane} may remain open.`);
  }
  process.exitCode = 1;
}

function runJson<T = Record<string, unknown>>(args: string[]): T {
  const output = run(args);
  let envelope: JsonEnvelope<T>;
  try {
    envelope = JSON.parse(output) as JsonEnvelope<T>;
  } catch {
    throw new Error(`Herdr returned non-JSON output for: herdr ${args.join(" ")}`);
  }
  if (envelope.error) {
    throw new Error(envelope.error.message ?? envelope.error.code ?? "unknown Herdr error");
  }
  if (!envelope.result) throw new Error(`Herdr returned no result for: herdr ${args.join(" ")}`);
  return envelope.result;
}

function run(args: string[]): string {
  const result = spawnSync("herdr", args, { encoding: "utf8", timeout: 20_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || result.stdout.trim() || `herdr exited ${result.status}`,
    );
  }
  return result.stdout;
}
