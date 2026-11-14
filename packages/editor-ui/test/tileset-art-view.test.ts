// Component fault-injection regression for #2578, not actual-host admission evidence. The real shared model and TST codec
// own edits and conflict resolution; only the view's save I/O port is decorated to reject.
import { after, before, test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createDocumentIdentity, createTilesetArtDocument, type TilesetArtDocument } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import type { mount as mountEditor, TilesetArtViewDocument, ViewHandle } from "../src/mount.ts";
import { exampleTileset } from "./fixtures.ts";

const PATH = "Tiles/art.tst";
const identity = createDocumentIdentity("memory-project", PATH);
const transportMessage = "Named transport rejection: backing store unavailable";
let act: (callback: () => void | Promise<void>) => Promise<void> | void;
let mount: typeof mountEditor;

before(async () => {
  GlobalRegistrator.register();
  // This test's DOM must exist before initializing the renderer module, so loading is deliberately deferred past registration.
  ({ act } = await import("preact/test-utils"));
  ({ mount } = await import("@tk-reawakened/editor-ui"));
});
after(() => GlobalRegistrator.unregister());

function realViewDocument(doc: TilesetArtDocument, save: () => Promise<never>): TilesetArtViewDocument {
  // Explicit forwarding is intentional: spreading a private-field model instance breaks its methods' receiver.
  return {
    kind: doc.kind,
    identity: doc.identity,
    getSnapshot: () => doc.getSnapshot(),
    subscribe: (listener) => doc.subscribe(listener),
    apply: (command) => doc.apply(command),
    save,
    resolveConflict: (choice) => doc.resolveConflict(choice),
  };
}

const paint = (doc: TilesetArtDocument, red: number) => doc.apply({
  type: "paint-tileset-pixels",
  tile: 0,
  changes: [{ x: 0, y: 0, rgba: [red, 255 - red, 0, 255] }],
});

test("keep-local reports a rejected auto-save after the real conflict clears", async () => {
  const initialBytes = exampleTileset();
  const host = createMemoryPlatformServices({
    files: { [PATH]: initialBytes },
    capabilities: ["conflictAutoSave", "conflictReload", "fileWatch"],
  });
  const local = createTilesetArtDocument(host.fs, identity, initialBytes);
  ok(local.ok, "the authored TST opens as a real tileset document");
  ok(paint(local.document, 255).ok, "the local pixel command is accepted");
  const external = createTilesetArtDocument(host.fs, identity, initialBytes);
  ok(external.ok);
  ok(paint(external.document, 0).ok, "the external revision has a distinct, model-encoded pixel edit");
  const externalBytes = external.document.serialize();
  ok((await host.fs.writeProject(identity.projectId, PATH, externalBytes)).ok, "external bytes replace the backing TST");
  const checked = await local.document.checkExternal();
  equal(checked, "conflict", "the dirty local model recognizes the changed backing file");

  // The ES2022 test contract has no Promise.withResolvers; this Promise API requires its synchronous executor form.
  let notifySaveStarted!: () => void;
  const saveStarted = new Promise<void>((resolve) => { notifySaveStarted = resolve; });
  const decorated = realViewDocument(local.document, () => {
    notifySaveStarted();
    return Promise.reject(new Error(transportMessage));
  });
  const el = document.createElement("div");
  document.body.append(el);
  
  let handle: ViewHandle | undefined;
  await act(() => { handle = mount(el, { document: decorated, services: host }); });
  const keepLocal = [...el.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Save my version");
  ok(keepLocal, "the actual conflict control offers Save my version");
  await act(async () => {
    keepLocal.click();
    await saveStarted;
  });

  equal(local.document.getSnapshot().conflict, null, "keep-local resolves the shared model's actual conflict");
  equal(el.querySelector('[role="group"][aria-label="Changed on disk"]'), null, "the conflict UI clears after resolution");
  ok([...el.querySelectorAll('[role="alert"]')].some((node) => node.textContent?.includes(transportMessage)), "the rejected auto-save is visible outside the cleared conflict UI");
  ok(local.document.getSnapshot().dirty, "the accepted local edit remains dirty after the failed auto-save");
  deepEqual(local.document.getSnapshot().tiles[0]?.pixels.slice(0, 4), [255, 0, 0, 255], "the local accepted pixel remains in the consumer-visible snapshot");
  deepEqual(local.document.serialize(), paintEncoded(initialBytes, 255), "serialization still contains the accepted local edit");
  deepEqual(host.bytesOf(PATH), externalBytes, "the rejected write leaves the external backing bytes unchanged");
  
  await act(() => handle?.dispose());
  el.remove();
});

function paintEncoded(bytes: Uint8Array, red: number): Uint8Array {
  const doc = createTilesetArtDocument(createMemoryPlatformServices({ files: { [PATH]: bytes } }).fs, identity, bytes);
  if (!doc.ok || !paint(doc.document, red).ok) throw new Error("could not encode expected TST pixel edit");
  return doc.document.serialize();
}
