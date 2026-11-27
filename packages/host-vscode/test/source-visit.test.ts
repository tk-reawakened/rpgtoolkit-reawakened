// A board's "Edit tile artwork" visit in the VS Code host (story 13.1): the tile belongs to that one visit. When the file
// opens in an editor that cannot select it, the author is told, and a later ordinary open or split does not inherit it.
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildNewBoard } from "@tk-reawakened/editor-model";
import type { DialogService, FileSystemService } from "@tk-reawakened/platform-services";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createGameEditorProvider, type GameEditorPort, type GameEditorProvider, type UriLike } from "../src/custom-editor.ts";

const BOARD = "Boards/Village.brd";
const ART = "Tiles/art.tst";
const PNG = "Bitmap/ordinary.png";
const WAV = "Media/ordinary.wav";
const TBM = "Bitmap/forest.tbm";
const artBytes = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/tileset/tileset_detail1.tst", import.meta.url)));
const pngBytes = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/tileset/tileset_iso.png", import.meta.url)));
const tbmBytes = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/game/Game/Example/Bitmap/forest.tbm", import.meta.url)));
const wavBytes = Uint8Array.of(82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69);

type TestUri = UriLike & { toString(): string };
const uriFor = (path: string): TestUri => ({ path: `/project/${path}`, toString: () => `memory-project/${path}` });

function harness(opensCustom: boolean, extraFiles: Record<string, Uint8Array> = {}) {
  const built = buildNewBoard({ name: "Village", coordSystem: "2d", pixelCoordinates: false, width: 2, height: 2, layers: 1, backgroundImage: "", template: null });
  if (!built.ok) throw new Error(built.message);
  const files = { [BOARD]: built.bytes, [ART]: artBytes, ...extraFiles };
  const host = createMemoryPlatformServices({ files });
  const fs: FileSystemService = {
    ...host.fs,
    readProject: (projectId, path) => Object.hasOwn(files, path)
      ? host.fs.readProject(projectId, path)
      : Promise.resolve({ ok: false, error: { code: "not-found", message: `${path} is not in the case-sensitive fixture` } }),
    list: async (path) => {
      const entries = new Map<string, { readonly name: string; readonly kind: "directory" | "file" }>();
      for (const filePath of Object.keys(files)) {
        const prefix = path === "" ? "" : `${path}/`;
        if (prefix !== "" && !filePath.startsWith(prefix)) continue;
        const tail = prefix === "" ? filePath : filePath.slice(prefix.length);
        const [name, ...rest] = tail.split("/");
        if (name !== undefined) entries.set(name, { name, kind: rest.length === 0 ? "file" : "directory" });
      }
      return { ok: true, value: [...entries.values()] };
    },
  };
  const dialogs: DialogService = { ask: async () => { throw new Error("no question expected"); }, pickSavePath: async () => null };
  const folder = { uri: uriFor(""), key: "memory-project" };
  const openedPaths: string[] = [];
  let provider: GameEditorProvider<TestUri> | undefined;
  const port: GameEditorPort<TestUri> = {
    capabilities: host.capabilities,
    folderOf: () => folder,
    fileSystem: () => fs,
    dialogs: () => dialogs,
    readBackup: async () => new Uint8Array(),
    writeBackup: async (_destination, bytes) => String(bytes.byteLength),
    deleteBackup: async () => undefined,
    saveEditor: async () => undefined,
    uriFor: (_folder, path) => uriFor(path),
    // VS Code resolves custom documents while opening, but delegates ordinary image/audio files to its native editor.
    openEditor: async (target) => {
      openedPaths.push(target.path);
      const hasCustomEditor = /\.(?:brd|tst|tbm)$/i.test(target.path);
      if (opensCustom && hasCustomEditor && provider!.openDocument(target) === undefined) await provider!.openCustomDocument(target, undefined);
    },
    quickPick: async () => undefined,
  };
  provider = createGameEditorProvider(port, () => undefined);
  return { provider, host, openedPaths };
}

void test("a visited tile reaches the new artwork document once; a split view does not inherit it", async () => {
  const { provider, host } = harness(true);
  const board = await provider.openCustomDocument(uriFor(BOARD), undefined);
  deepEqual(await board.visitSource(ART, 2), { ok: true, path: ART });
  const art = provider.openDocument(uriFor(ART));
  if (art === undefined) throw new Error("the visit did not create the artwork document");
  equal(art.sourceTarget(), 2, "the first view of the visited document opens at the chosen tile");
  equal(art.sourceTarget(), undefined, "a later view keeps its own tile choice");
  deepEqual(host.bytesOf(ART), artBytes, "visiting changes no stored artwork");
});

void test("a visit that opens without the artwork editor is reported, and a later ordinary open is not sent to that tile", async () => {
  const { provider, host } = harness(false);
  const board = await provider.openCustomDocument(uriFor(BOARD), undefined);
  const outcome = await board.visitSource(ART, 2);
  if (outcome.ok) throw new Error("a visit without the artwork editor must be reported");
  match(outcome.message, /cannot select tile 2/);
  const art = await provider.openCustomDocument(uriFor(ART), undefined);
  equal(art.sourceTarget(), undefined, "an ordinary open shows the editor's own default tile");
  deepEqual(host.bytesOf(ART), artBytes);
});
void test("ordinary image and audio links use native Open, while TBM remains a registered custom editor", async () => {
  const { provider, host, openedPaths } = harness(true, { ["Bitmap/Ordinary.PNG"]: pngBytes, [WAV]: wavBytes, [TBM]: tbmBytes });
  const board = await provider.openCustomDocument(uriFor(BOARD), undefined);
  deepEqual(await board.visit(PNG), { ok: true, path: "Bitmap/Ordinary.PNG" });
  deepEqual(await board.visit(WAV), { ok: true, path: WAV });
  deepEqual(await board.visit(TBM), { ok: true, path: TBM });
  deepEqual(openedPaths, ["/project/Bitmap/Ordinary.PNG", "/project/Media/ordinary.wav", "/project/Bitmap/forest.tbm"]);
  const bitmap = provider.openDocument(uriFor(TBM));
  if (bitmap === undefined) throw new Error("the .tbm visit did not create a custom document");
  equal(bitmap.model.identity.path, TBM);
  deepEqual(host.bytesOf("Bitmap/Ordinary.PNG"), pngBytes);
  deepEqual(host.bytesOf(WAV), wavBytes);
});

void test("native image and audio visits reject missing files and case-colliding paths before opening", async () => {
  const { provider, openedPaths } = harness(true, {
    ["Bitmap/forest.PNG"]: pngBytes,
    ["Bitmap/FOREST.png"]: pngBytes,
    [WAV]: wavBytes,
  });
  const board = await provider.openCustomDocument(uriFor(BOARD), undefined);
  const collision = await board.visit("Bitmap/Forest.png");
  if (collision.ok) throw new Error("a case-colliding image path must not select one spelling");
  match(collision.message, /case/i);
  const missing = await board.visit("Media/missing.wav");
  if (missing.ok) throw new Error("a missing native audio file must not open");
  match(missing.message, /not in the project/i);
  deepEqual(openedPaths, [], "invalid native paths never reach VS Code Open");
});
void test("native image and audio visits reject directories before opening", async () => {
  const { provider, openedPaths } = harness(true, { ["Bitmap/not-an-image.png/child.dat"]: pngBytes });
  const board = await provider.openCustomDocument(uriFor(BOARD), undefined);
  const outcome = await board.visit("Bitmap/not-an-image.png");
  if (outcome.ok) throw new Error("a directory with an image suffix must not open as an image");
  match(outcome.message, /not a file/i);
  deepEqual(openedPaths, []);
});
