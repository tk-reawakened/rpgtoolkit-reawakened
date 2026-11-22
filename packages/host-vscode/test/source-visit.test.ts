// A board's "Edit tile artwork" visit in the VS Code host (story 13.1): the tile belongs to that one visit. When the file
// opens in an editor that cannot select it, the author is told, and a later ordinary open or split does not inherit it.
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildNewBoard } from "@tk-reawakened/editor-model";
import type { DialogService } from "@tk-reawakened/platform-services";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createGameEditorProvider, type GameEditorPort, type GameEditorProvider, type UriLike } from "../src/custom-editor.ts";

const BOARD = "Boards/Village.brd";
const ART = "Tiles/art.tst";
const artBytes = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/tileset/tileset_detail1.tst", import.meta.url)));

type TestUri = UriLike & { toString(): string };
const uriFor = (path: string): TestUri => ({ path: `/project/${path}`, toString: () => `memory-project/${path}` });

function harness(opensCustom: boolean) {
  const built = buildNewBoard({ name: "Village", coordSystem: "2d", pixelCoordinates: false, width: 2, height: 2, layers: 1, backgroundImage: "", template: null });
  if (!built.ok) throw new Error(built.message);
  const host = createMemoryPlatformServices({ files: { [BOARD]: built.bytes, [ART]: artBytes } });
  const dialogs: DialogService = { ask: async () => { throw new Error("no question expected"); }, pickSavePath: async () => null };
  const folder = { uri: uriFor(""), key: "memory-project" };
  let provider: GameEditorProvider<TestUri> | undefined;
  const port: GameEditorPort<TestUri> = {
    capabilities: host.capabilities,
    folderOf: () => folder,
    fileSystem: () => host.fs,
    dialogs: () => dialogs,
    readBackup: async () => new Uint8Array(),
    writeBackup: async (_destination, bytes) => String(bytes.byteLength),
    deleteBackup: async () => undefined,
    saveEditor: async () => undefined,
    uriFor: (_folder, path) => uriFor(path),
    // VS Code resolves the custom document while opening; a text editor association opens without one.
    openEditor: async (target) => { if (opensCustom && provider!.openDocument(target) === undefined) await provider!.openCustomDocument(target, undefined); },
    quickPick: async () => undefined,
  };
  provider = createGameEditorProvider(port, () => undefined);
  return { provider, host };
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
