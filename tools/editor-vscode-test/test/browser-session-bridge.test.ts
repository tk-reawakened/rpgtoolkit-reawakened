import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createBrowserSession, type BrowserState, type BrowserStatePatch } from "@tk-reawakened/editor-ui/browser-session";
import { createDocumentIdentity, createBoardDocument } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { RemoteDocument, isEditorHostRequest, type EditorHostRequest } from "@tk-reawakened/host-vscode/testing";

const selection = {
  kind: "tiles" as const,
  path: "Tiles/village.tst",
  reference: "Tiles/village.tst2",
  label: "village tile 2",
  boardTile: "Tiles/village.tst2",
};

test("asynchronous split-view patches merge independently and preserve unknown session fields", async () => {
  const boardBytes = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/board/board_minor4.brd", import.meta.url)));
  const storage = createMemoryPlatformServices({ files: { "Boards/village.brd": boardBytes } });
  const opened = createBoardDocument(storage.fs, createDocumentIdentity("shared-project", "Boards/village.brd"), boardBytes);
  ok(opened.ok);
  const initial = { selection: null, path: null, scrollTop: 0, futureField: "preserved" } as BrowserState;
  const outboundA: EditorHostRequest[] = [];
  const outboundB: EditorHostRequest[] = [];
  const makeApi = (outbound: EditorHostRequest[]) => ({
    postMessage: (message: EditorHostRequest) => { outbound.push(message); },
    getState: () => undefined,
    setState: () => undefined,
  });
  const first = new RemoteDocument("board", opened.document.getSnapshot(), initial, makeApi(outboundA));
  const second = new RemoteDocument("board", opened.document.getSnapshot(), initial, makeApi(outboundB));
  const authority = createBrowserSession(initial);
  const broadcast: BrowserStatePatch[] = [];
  authority.subscribe((update) => { broadcast.push(update); });

  first.browserSession.update({ selection });
  equal(outboundA.length, 1);
  ok(isEditorHostRequest(outboundA[0]));
  equal(outboundA[0]?.type, "browser-context");
  if (outboundA[0]?.type !== "browser-context") throw new Error("selection patch was not sent");
  deepEqual(outboundA[0].changes, [{ field: "selection", value: selection }]);
  applyPatch(authority, outboundA[0].changes);
  deepEqual(broadcast, [[{ field: "selection", value: selection }]]);

  // B's scroll event races the delayed selection broadcast from A; a full-state message would erase this local scroll.
  second.browserSession.update({ scrollTop: 240 });
  equal(outboundB.length, 1);
  if (outboundB[0]?.type !== "browser-context") throw new Error("scroll patch was not sent");
  deepEqual(outboundB[0].changes, [{ field: "scrollTop", value: 240 }]);
  second.receive({ type: "browser-state", changes: broadcast[0]! });
  deepEqual(second.browserSession.getSnapshot(), { selection, path: null, scrollTop: 240, futureField: "preserved" });

  // Deliver B's delayed scroll to the host and its broadcast back to A: both fields survive independent delivery.
  applyPatch(authority, outboundB[0].changes);
  first.receive({ type: "browser-state", changes: broadcast[1]! });
  deepEqual(authority.getSnapshot(), { selection, path: null, scrollTop: 240, futureField: "preserved" });
  deepEqual(first.browserSession.getSnapshot(), authority.getSnapshot());

  ok(isEditorHostRequest({ type: "browser-context", changes: [{ field: "scrollTop", value: 5 }], futureField: "also preserved" }));
  equal(isEditorHostRequest({ type: "browser-context", state: { selection: null, path: null, scrollTop: 5 } }), false);
});
function applyPatch(session: ReturnType<typeof createBrowserSession>, changes: BrowserStatePatch): void {
  const update: { -readonly [Key in keyof BrowserState]?: BrowserState[Key] } = {};
  for (const change of changes) {
    if (change.field === "selection") update.selection = change.value;
    else if (change.field === "path") update.path = change.value;
    else update.scrollTop = change.value;
  }
  session.update(update);
}
