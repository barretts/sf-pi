/* SPDX-License-Identifier: Apache-2.0 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetTldrawStatusStoreForTests,
  getTldrawStatus,
  setTldrawStatus,
  subscribeTldrawStatus,
} from "../tldraw-status/store.ts";

describe("tldraw status store", () => {
  beforeEach(() => __resetTldrawStatusStoreForTests());

  it("publishes a small render-safe snapshot", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTldrawStatus(listener);
    setTldrawStatus({ kind: "ready", openDocuments: 2, focusedDocumentName: "Board" });
    expect(getTldrawStatus()).toMatchObject({
      kind: "ready",
      openDocuments: 2,
      focusedDocumentName: "Board",
    });
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });
});
