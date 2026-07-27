/* SPDX-License-Identifier: Apache-2.0 */
/** Official Agent Script packages that form sf-pi's local authoring toolchain. */
export const AGENT_SCRIPT_PACKAGES = [
  { name: "@sf-agentscript/agentforce", kind: "direct" },
  { name: "@sf-agentscript/compiler", kind: "transitive" },
  { name: "@sf-agentscript/language", kind: "direct" },
  { name: "@sf-agentscript/lsp", kind: "direct" },
  { name: "@sf-agentscript/agentforce-dialect", kind: "transitive" },
  { name: "@sf-agentscript/agentscript-dialect", kind: "transitive" },
  { name: "@sf-agentscript/parser", kind: "transitive" },
  { name: "@sf-agentscript/types", kind: "transitive" },
] as const;

export type AgentScriptPackageCatalogEntry = (typeof AGENT_SCRIPT_PACKAGES)[number];

export function collectLockedAgentScriptVersions(
  packages: Record<string, { version?: string }>,
): Map<string, string[]> {
  const versions = new Map<string, Set<string>>();
  for (const [key, value] of Object.entries(packages)) {
    const pkg = AGENT_SCRIPT_PACKAGES.find(
      ({ name }) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`),
    );
    if (!pkg || !value.version) continue;
    const found = versions.get(pkg.name) ?? new Set<string>();
    found.add(value.version);
    versions.set(pkg.name, found);
  }
  return new Map([...versions].map(([name, found]) => [name, [...found].sort()]));
}
