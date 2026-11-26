// The VS Code host's route of Import as Scene (docs/spec/formats/native-scene.md#import-from-a-board-to-a-scene): the
// board view's one action goes through the same shared service, refuses pending board work without asking, and opens only
// the scene it created. The webview request names no path; a read-only history preview has no import at all.
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { test } from "node:test";
import { buildNewBoard, DEFAULT_EDITOR_PREFERENCES } from "@tk-reawakened/editor-model";
import type { DialogQuestion, DialogService } from "@tk-reawakened/platform-services";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createGameEditorProvider, type GameEditorPort, type UriLike } from "../src/custom-editor.ts";
import { handleEditorHostRequest, isEditorHostRequest, RemoteDocument, type BridgedDocument, type BridgeMessage, type EditorHostRequest, type VscodeApi } from "../src/document-bridge.ts";

const PATH = "Boards/Village.brd";
const SCENE = "Boards/Village.tkrscn";

function boardBytes(): Uint8Array {
  const built = buildNewBoard({ name: "Village", coordSystem: "2d", pixelCoordinates: false, width: 2, height: 2, layers: 1, backgroundImage: "", template: null });
  ok(built.ok, built.ok ? "" : built.message);
  return built.bytes;
}

type TestUri = UriLike & { toString(): string };

function harness(answers: ("cancel" | "import")[]) {
  const host = createMemoryPlatformServices({ files: { [PATH]: boardBytes() } });
  const questions: DialogQuestion<string>[] = [];
  const opened: string[] = [];
  const dialogs: DialogService = {
    async ask<Id extends string>(question: DialogQuestion<Id>): Promise<Id> {
      questions.push(question as unknown as DialogQuestion<string>);
      return (answers.shift() ?? "cancel") as Id;
    },
    pickSavePath: async () => null,
  };
  const root: TestUri = { path: "/project", toString: () => "memory-project" };
  const folder = { uri: root, key: "memory-project" };
  const uri: TestUri = { path: `/project/${PATH}`, toString: () => `memory-project/${PATH}` };
  const port: GameEditorPort<TestUri> = {
    capabilities: host.capabilities,
    folderOf: () => folder,
    fileSystem: () => host.fs,
    dialogs: () => dialogs,
    readBackup: async () => new Uint8Array(),
    writeBackup: async (_destination, bytes) => String(bytes.byteLength),
    deleteBackup: async () => undefined,
    saveEditor: async () => undefined,
    uriFor: (_folder, path) => ({ path: `/project/${path}`, toString: () => `memory-project/${path}` }),
    openEditor: async (target) => { opened.push(target.path.slice("/project/".length)); },
    quickPick: async () => undefined,
  };
  return { host, questions, opened, port, folder, uri };
}

void test("the board view's import asks once, cancels without writing and otherwise opens only the new scene", async () => {
  const { host, questions, opened, port, uri } = harness(["cancel", "import"]);
  const provider = createGameEditorProvider(port, () => undefined);
  const document = await provider.openCustomDocument(uri, undefined);
  equal(provider.openDocument(uri), document, "a host command reaches the live board document");

  deepEqual(await document.importAsScene(), { ok: true, value: undefined });
  equal(host.bytesOf(SCENE), undefined, "cancelling writes nothing");
  deepEqual(host.bytesOf(PATH), boardBytes(), "the original board is unchanged");
  deepEqual(opened, [], "cancelling opens nothing");

  deepEqual(await document.importAsScene(), { ok: true, value: undefined });
  const scene = new TextDecoder().decode(host.bytesOf(SCENE));
  match(scene, /^contract: scene/m);
  deepEqual(host.bytesOf(PATH), boardBytes(), "the original board is unchanged after the import");
  deepEqual(opened, [SCENE], "only the created scene is opened");
  equal(questions.length, 2);
  match(questions[0]!.message, /Import Boards\/Village\.brd as a scene\?/);
  deepEqual(questions[0]!.choices.map((choice) => choice.label), ["Cancel", "Import as Scene"]);
  match(questions[0]!.detail, /Creates Boards\/Village\.tkrscn only/);
});

void test("a board with pending edits refuses the import before any review appears", async () => {
  const { host, questions, opened, port, uri } = harness(["import"]);
  const provider = createGameEditorProvider(port, () => undefined);
  const document = await provider.openCustomDocument(uri, undefined);
  const applied = document.model.apply({ type: "set-tiles", gesture: "draw", cells: [{ layer: 0, x: 0, y: 0, tile: "village.tst1" }] });
  ok(applied.ok, applied.ok ? "" : applied.rejection.message);

  const result = await document.importAsScene();
  ok(!result.ok);
  match(result.error.message, /pending edits/);
  deepEqual(questions, [], "no review is shown for work that cannot be imported");
  deepEqual(opened, []);
  equal(host.bytesOf(SCENE), undefined);
});

void test("an open dirty text buffer for the board is not silently ignored by import", async () => {
  const { host, questions, opened, port, uri } = harness(["import"]);
  const provider = createGameEditorProvider({ ...port, hasDirtyTextDocument: (target) => target.path === uri.path }, () => undefined);
  const document = await provider.openCustomDocument(uri, undefined);
  const result = await document.importAsScene();
  ok(!result.ok);
  match(result.error.message, /pending edits/);
  deepEqual(questions, []);
  deepEqual(opened, []);
  equal(host.bytesOf(SCENE), undefined);
  deepEqual(host.bytesOf(PATH), boardBytes());
});

void test("a live board document delegates PNG bytes to the host's native save flow", async () => {
  const { port, folder, uri } = harness([]);
  const saved: { folder: string; name: string; bytes: Uint8Array }[] = [];
  const provider = createGameEditorProvider({
    ...port,
    saveImage: async (target, fileName, bytes) => {
      saved.push({ folder: target.key, name: fileName, bytes });
      return { ok: true, value: true };
    },
  }, () => undefined);
  const document = await provider.openCustomDocument(uri, undefined);
  const bytes = Uint8Array.of(137, 80, 78, 71);
  deepEqual(await document.saveImage("Village.png", bytes), { ok: true, value: true });
  deepEqual(saved, [{ folder: folder.key, name: "Village.png", bytes }]);
});
void test("the webview's import request carries the document's own board, and a history preview never offers it", async () => {
  const request: EditorHostRequest = { type: "import-as-scene", requestId: "r1" };
  equal(isEditorHostRequest(request), true);
  equal(isEditorHostRequest({ type: "import-as-scene" }), false, "a request without an id is ignored");
  equal(isEditorHostRequest({ type: "preview", requestId: "p1", request: { preserveComposition: true } }), true);
  equal(isEditorHostRequest({ type: "preview", requestId: "p2", request: { preserveComposition: "true" } }), false);
  equal(isEditorHostRequest({ type: "save-image", requestId: "p3", fileName: "../outside.png", bytes: new Uint8Array() }), false);

  const posted: EditorHostRequest[] = [];
  const api: VscodeApi = { postMessage: (message) => { posted.push(message); }, getState: () => undefined, setState: () => undefined };
  const browsed = { selection: null, path: null, scrollTop: 0 };
  const snapshot = { identity: { projectId: "memory-project", path: PATH, key: "board" }, dirty: false, readOnly: null, canUndo: false, canRedo: false, edits: [], saving: false, saveError: null, conflict: null };
  const preview = new RemoteDocument("board", snapshot, browsed, api, DEFAULT_EDITOR_PREFERENCES, undefined, false);
  equal(preview.importAsScene, undefined, "a read-only history preview shows no import action");

  const live = new RemoteDocument("board", snapshot, browsed, api, DEFAULT_EDITOR_PREFERENCES, undefined, true);
  ok(live.importAsScene !== undefined);
  const pending = live.importAsScene!();
  const sent = posted.at(-1)!;
  deepEqual(sent, { type: "import-as-scene", requestId: "import-as-scene-1" });
  ok(!("path" in sent), "the webview names no file");
  live.receive({ type: "import-as-scene-result", requestId: "import-as-scene-1", result: { ok: true, value: undefined } });
  deepEqual(await pending, { ok: true, value: undefined });
  const imageBytes = Uint8Array.of(137, 80, 78, 71);
  const imageSave = live.saveImage("Village.png", imageBytes);
  const imageRequest = posted.at(-1)!;
  deepEqual(imageRequest, { type: "save-image", requestId: "save-image-2", fileName: "Village.png", bytes: imageBytes });
  equal(isEditorHostRequest(imageRequest), true);
  live.receive({ type: "save-image-result", requestId: "save-image-2", result: { ok: true, value: true } });
  deepEqual(await imageSave, { ok: true, value: true });
  ok(live.runUpgradeCommand !== undefined, "a live board view receives registered upgrade actions");
  live.runUpgradeCommand!("tile-to-pixel");
  deepEqual(posted.at(-1), { type: "run-board-upgrade", requestId: "upgrade-3", operation: "tile-to-pixel" });
  equal(isEditorHostRequest(posted.at(-1)), true);
  equal(isEditorHostRequest({ type: "run-board-upgrade", requestId: "bad", operation: "delete" }), false);

  const calls: string[] = [];
  const replies: BridgeMessage[] = [];
  const bridged = {
    model: { kind: "board", getSnapshot: () => snapshot },
    importAsScene: async () => { calls.push("import"); return { ok: true as const, value: undefined }; },
    saveImage: async (fileName: string, bytes: Uint8Array) => {
      calls.push(`${fileName}:${bytes.byteLength}`);
      return { ok: true as const, value: true };
    },
    runBoardUpgrade: async (operation: string) => { calls.push(`upgrade:${operation}`); },
  } as unknown as BridgedDocument;
  const forged = { type: "import-as-scene", requestId: "r2", path: "Boards/Other.brd" } as unknown as EditorHostRequest;
  await handleEditorHostRequest(bridged, forged, (reply) => { replies.push(reply); });
  deepEqual(calls, ["import"], "the handler runs the document's own import and reads no path from the message");
  deepEqual(replies, [{ type: "import-as-scene-result", requestId: "r2", result: { ok: true, value: undefined } }]);
  const hostImageRequest: EditorHostRequest = { type: "save-image", requestId: "r3", fileName: "Village.png", bytes: imageBytes };
  await handleEditorHostRequest(bridged, hostImageRequest, (reply) => { replies.push(reply); });
  deepEqual(calls, ["import", "Village.png:4"]);
  deepEqual(replies.at(-1), { type: "save-image-result", requestId: "r3", result: { ok: true, value: true } });
  await handleEditorHostRequest(bridged, { type: "run-board-upgrade", requestId: "r4", operation: "pre-vector" }, (reply) => { replies.push(reply); });
  deepEqual(calls, ["import", "Village.png:4", "upgrade:pre-vector"]);
});
