/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Upstream AgentScript navigation adapter.
 *
 * SF Pi's public tools accept explicit symbols such as `@subagent.billing`,
 * while the official language/LSP APIs operate on parsed documents, ranges,
 * and language-service state. Keep that bridging logic here so inspect and
 * mutate do not each carry their own reference/definition plumbing.
 */

import { AGENTFORCE_DOCUMENT_URI, processAgentforceDocument } from "./agentforce-document.ts";
import type { DocumentState } from "@sf-agentscript/lsp";
import type { AgentScriptRange } from "./types.ts";

export interface AgentforceSymbol {
  namespace: string;
  name: string;
}

export interface AgentforceReferenceOccurrence {
  range: AgentScriptRange;
  isDefinition: boolean;
}

export interface AgentforceTextEdit {
  range: AgentScriptRange;
  newText: string;
}

export interface AgentforceDefinition {
  definitionRange: AgentScriptRange;
  fullRange?: AgentScriptRange;
  scope?: Record<string, string>;
}

export type ParsedAgentforceSymbol =
  { ok: true; symbol: AgentforceSymbol } | { ok: false; reason: string };

export const DECLARABLE_NAVIGATION_NAMESPACES = new Set([
  "topic",
  "subagent",
  "actions",
  "variables",
]);

export function parseAgentforceSymbol(
  raw: string,
  opts: { requireAt?: boolean } = {},
): ParsedAgentforceSymbol {
  const re = opts.requireAt ? /^@([\w-]+)\.([\w-]+)$/ : /^@?([\w-]+)\.([\w-]+)$/;
  const m = re.exec(raw);
  if (!m) {
    const expected = opts.requireAt
      ? "'@<namespace>.<property>'"
      : "'@<namespace>.<name>' or '<namespace>.<name>'";
    return {
      ok: false,
      reason: `Symbol must be of the form ${expected}, got '${raw}'.`,
    };
  }
  return { ok: true, symbol: { namespace: m[1], name: m[2] } };
}

export function formatAgentforceSymbol(symbol: AgentforceSymbol): string {
  return `@${symbol.namespace}.${symbol.name}`;
}

export function isDeclarableNavigationNamespace(namespace: string): boolean {
  return DECLARABLE_NAVIGATION_NAMESPACES.has(namespace);
}

async function definitionsInState(
  state: DocumentState,
  symbol: AgentforceSymbol,
): Promise<AgentforceDefinition[]> {
  if (!state.ast) return [];
  const { walkDefinitionKeys } = await import("@sf-agentscript/language");
  const matches: AgentforceDefinition[] = [];
  const scopesRequired = state.service.schemaContext.scopedNamespaces.get(symbol.namespace);
  walkDefinitionKeys(state.ast, (namespace, name, definitionRange, fullRange, scope) => {
    if (namespace === symbol.namespace && name === symbol.name) {
      matches.push({
        definitionRange,
        fullRange,
        scope: Object.fromEntries(
          [...(scopesRequired ?? [])]
            .map((scopeName) => [scopeName, scope[scopeName]] as const)
            .filter((entry): entry is readonly [string, string] => !!entry[1]),
        ),
      });
    }
  });
  return matches;
}

async function resolveDefinitionInState(
  state: DocumentState,
  symbol: AgentforceSymbol,
): Promise<AgentforceDefinition | null> {
  const matches = await definitionsInState(state, symbol);
  return matches.length === 1 ? matches[0] : null;
}

async function stateForSource(
  source: string,
  existingState?: DocumentState,
  uri = AGENTFORCE_DOCUMENT_URI,
): Promise<DocumentState> {
  return existingState?.source === source ? existingState : processAgentforceDocument(source, uri);
}

export async function findAgentforceDefinitions(
  source: string,
  symbol: AgentforceSymbol,
  existingState?: DocumentState,
): Promise<AgentforceDefinition[]> {
  const state = await stateForSource(source, existingState);
  return definitionsInState(state, symbol);
}

export async function resolveAgentforceSymbol(
  source: string,
  symbol: AgentforceSymbol,
  existingState?: DocumentState,
): Promise<AgentforceDefinition | null> {
  const state = await stateForSource(source, existingState);
  if (!state.ast) return null;

  return resolveDefinitionInState(state, symbol);
}

async function findReferencesInState(
  state: DocumentState,
  symbol: AgentforceSymbol,
  includeDeclaration: boolean,
): Promise<AgentforceReferenceOccurrence[]> {
  if (!state.ast) return [];
  const { findAllReferences } = await import("@sf-agentscript/language");
  return findAllReferences(
    state.ast,
    symbol.namespace,
    symbol.name,
    state.service.schemaContext,
    undefined,
    includeDeclaration,
    state.service.getSymbols(),
  ) as AgentforceReferenceOccurrence[];
}

export async function findAgentforceReferences(
  source: string,
  symbol: AgentforceSymbol,
  includeDeclaration = true,
  existingState?: DocumentState,
): Promise<AgentforceReferenceOccurrence[]> {
  const state = await stateForSource(source, existingState);
  return findReferencesInState(state, symbol, includeDeclaration);
}

export async function findAgentforceReferenceEdits(
  source: string,
  from: AgentforceSymbol,
  newText: string,
  existingState?: DocumentState,
): Promise<AgentforceTextEdit[]> {
  const state = await stateForSource(source, existingState);
  const refs = await findReferencesInState(state, from, true);
  const semantic = refs
    .filter((ref) => !ref.isDefinition)
    .map((ref) => ({ range: ref.range, newText }));
  return mergeTransitionGapEdits(
    semantic,
    findDirectTransitionEdits(cstRoot(state), from, newText, false),
  );
}

/** Use the official position-index rename provider for same-namespace symbols. */
export async function renameAgentforceSymbol(
  source: string,
  symbol: AgentforceSymbol,
  newName: string,
  existingState?: DocumentState,
): Promise<AgentforceTextEdit[]> {
  const state = await stateForSource(source, existingState);
  if (!state.ast) return [];

  const definition = await resolveDefinitionInState(state, symbol);
  const definitionRange = definition?.definitionRange;
  if (!definitionRange) return [];

  const { provideRename } = await import("@sf-agentscript/lsp");
  const workspaceEdit = provideRename(
    state,
    definitionRange.start.line,
    definitionRange.start.character,
    newName,
  );
  const semanticEdits = (workspaceEdit?.changes?.[AGENTFORCE_DOCUMENT_URI] ?? []).map((edit) => {
    if (!sameRange(edit.range, definitionRange)) return edit;
    // The current upstream provider returns the full declaration key range for
    // block declarations (for example `subagent billing`) rather than only the
    // symbol name. Keep the provider's semantic occurrence set, but narrow its
    // declaration edit to the trailing name so the block keyword survives.
    return {
      ...edit,
      range: {
        start: {
          line: definitionRange.end.line,
          character: Math.max(0, definitionRange.end.character - symbol.name.length),
        },
        end: definitionRange.end,
      },
    };
  });
  return mergeTransitionGapEdits(
    semanticEdits,
    findDirectTransitionEdits(cstRoot(state), symbol, newName, true),
  );
}

/** Use the official deprecated-topic code action for topic → subagent conversion. */
function sameRange(left: AgentScriptRange, right: AgentScriptRange): boolean {
  return (
    left.start.line === right.start.line &&
    left.start.character === right.start.character &&
    left.end.line === right.end.line &&
    left.end.character === right.end.character
  );
}

interface CstNodeLike {
  type: string;
  text: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  children?: CstNodeLike[];
}

/**
 * Compatibility adapter for direct `transition to` statements that compile
 * successfully but are currently preserved as ErrorBlock nodes, outside the
 * official LSP reference index. Walk only the official parser CST's structured
 * transition nodes; comments, templates, and ordinary prose are never scanned.
 */
function cstRoot(state: DocumentState): CstNodeLike | undefined {
  return (state.ast as { __cst?: { node?: CstNodeLike } } | null)?.__cst?.node;
}

function findDirectTransitionEdits(
  root: CstNodeLike | undefined,
  symbol: AgentforceSymbol,
  newText: string,
  nameOnly: boolean,
): AgentforceTextEdit[] {
  if (!root) return [];
  const token = `@${symbol.namespace}.${symbol.name}`;
  const edits: AgentforceTextEdit[] = [];

  const visit = (node: CstNodeLike, inTransition: boolean): void => {
    const inside = inTransition || node.type === "transition_statement";
    if (inside && node.type === "member_expression" && node.text === token) {
      let range: AgentScriptRange = {
        start: { line: node.startRow, character: node.startCol },
        end: { line: node.endRow, character: node.endCol },
      };
      if (nameOnly) {
        const property = [...(node.children ?? [])].reverse().find((child) => child.type === "id");
        if (!property) return;
        range = {
          start: { line: property.startRow, character: property.startCol },
          end: { line: property.endRow, character: property.endCol },
        };
      }
      edits.push({ range, newText });
      return;
    }
    for (const child of node.children ?? []) visit(child, inside);
  };
  visit(root, false);
  return edits;
}

function mergeTransitionGapEdits(
  semantic: AgentforceTextEdit[],
  transitionGaps: AgentforceTextEdit[],
): AgentforceTextEdit[] {
  return [
    ...semantic,
    ...transitionGaps.filter(
      (gap) => !semantic.some((candidate) => rangesOverlap(candidate.range, gap.range)),
    ),
  ];
}

function rangesOverlap(left: AgentScriptRange, right: AgentScriptRange): boolean {
  return comparePosition(left.start, right.end) < 0 && comparePosition(right.start, left.end) < 0;
}

function comparePosition(
  left: AgentScriptRange["start"],
  right: AgentScriptRange["start"],
): number {
  return left.line - right.line || left.character - right.character;
}

export async function convertTopicToSubagent(
  source: string,
  symbol: AgentforceSymbol,
  existingState?: DocumentState,
): Promise<AgentforceTextEdit[]> {
  const state = await stateForSource(source, existingState);
  if (!state.ast) return [];

  const definition = await resolveDefinitionInState(state, symbol);
  const declarationLine = definition?.definitionRange?.start.line;
  if (declarationLine === undefined) return [];

  const diagnostics = state.diagnostics.filter((diagnostic) => {
    const replacement = (diagnostic.data as { replacement?: unknown } | undefined)?.replacement;
    return (
      diagnostic.code === "deprecated-field" &&
      replacement === "subagent" &&
      diagnostic.range.start.line === declarationLine
    );
  });
  if (diagnostics.length === 0) return [];

  const lines = source.split("\n");
  const fullRange: AgentScriptRange = {
    start: { line: 0, character: 0 },
    end: {
      line: Math.max(0, lines.length - 1),
      character: lines.at(-1)?.length ?? 0,
    },
  };
  const { provideCodeActions } = await import("@sf-agentscript/lsp");
  const action = provideCodeActions(state, fullRange, diagnostics).find(
    (candidate) => candidate.title === "Convert to subagent",
  );
  const semanticEdits = action?.edit?.changes?.[AGENTFORCE_DOCUMENT_URI] ?? [];
  return mergeTransitionGapEdits(
    semanticEdits,
    findDirectTransitionEdits(cstRoot(state), symbol, `@subagent.${symbol.name}`, false),
  );
}
