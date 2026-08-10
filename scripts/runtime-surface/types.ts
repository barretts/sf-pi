/* SPDX-License-Identifier: Apache-2.0 */

export type RuntimeSurfaceName = "commands" | "providers" | "tools" | "events";

export interface ManifestRuntimeSurface {
  id: string;
  commands: string[];
  providers: string[];
  tools: string[];
  events: string[];
}

export interface CapturedRuntimeSurface {
  commands: string[];
  providers: string[];
  tools: string[];
  events: string[];
  eventHandlerCounts: Record<string, number>;
}

export interface RuntimeSurfaceScenario {
  name: string;
  invoke: Array<"session_start" | "resources_discover" | "session_shutdown">;
  expectedTools: "manifest" | "none" | "subset";
  env?: Record<string, string | undefined>;
  activeTools?: string[];
  providerApiKeys?: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
  expectedFetchSuffixes?: string[];
  timeoutMs?: number;
}

export interface RuntimeSurfaceScenarioModule {
  scenarios: RuntimeSurfaceScenario[];
}

export interface RuntimeSurfaceDifference {
  surface: RuntimeSurfaceName;
  missing: string[];
  undeclared: string[];
  duplicates: string[];
}
