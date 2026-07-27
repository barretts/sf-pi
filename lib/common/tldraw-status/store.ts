/* SPDX-License-Identifier: Apache-2.0 */
/** Render-safe, in-process status bridge from sf-tldraw to passive UI consumers. */
export type TldrawStatusKind =
  | "hidden"
  | "detected"
  | "ready"
  | "no-open-document"
  | "not-running"
  | "stale-config"
  | "auth-error"
  | "incompatible";

export interface TldrawStatusSnapshot {
  kind: TldrawStatusKind;
  origin?: "startup-probe" | "interaction";
  port?: number;
  openDocuments?: number;
  focusedDocumentName?: string;
  message?: string;
  updatedAt?: string;
}

export type TldrawStatusListener = (status: TldrawStatusSnapshot) => void;

const EMPTY: TldrawStatusSnapshot = { kind: "hidden" };
const GLOBAL_SLOT = "__sfPiTldrawStatusStore" as const;

interface BackingState {
  status: TldrawStatusSnapshot;
  listeners: Set<TldrawStatusListener>;
}

function backing(): BackingState {
  const root = globalThis as unknown as Record<string, BackingState | undefined>;
  let state = root[GLOBAL_SLOT];
  if (!state) {
    state = { status: EMPTY, listeners: new Set() };
    root[GLOBAL_SLOT] = state;
  }
  return state;
}

export function getTldrawStatus(): TldrawStatusSnapshot {
  return backing().status;
}

export function setTldrawStatus(status: TldrawStatusSnapshot): void {
  const state = backing();
  state.status = { ...status, updatedAt: status.updatedAt ?? new Date().toISOString() };
  for (const listener of state.listeners) {
    try {
      listener(state.status);
    } catch {
      // One UI consumer cannot break status publication.
    }
  }
}

export function clearTldrawStatus(): void {
  setTldrawStatus(EMPTY);
}

export function subscribeTldrawStatus(listener: TldrawStatusListener): () => void {
  const state = backing();
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export function __resetTldrawStatusStoreForTests(): void {
  const state = backing();
  state.status = EMPTY;
  state.listeners.clear();
}
