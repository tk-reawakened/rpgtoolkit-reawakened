import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { BinaryReader, readBoard, utf8Encode } from "@tk-reawakened/core";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { asTerrainSceneDocument } from "../src/kinds.ts";
import { encodeScenePng } from "../src/scene-png.ts";
import { createDocumentWorkspace } from "../src/workspace.ts";

const path = "Boards/pond.tkrscn";
const output = "Boards/pond.brd";
const source = `contract: scene
version: 1.0.0-pre.2
projection: 2d
size: {width: 1, height: 1}
floors: [{id: ground, tiles: [[1, 1]]}]
tilePalette: [{}, {legacy: grass.tst1}]
`;

void test("workspace Save All builds the edited scene, and a later outside board edit stops a normal save", async () => {
  const host = createMemoryPlatformServices({ files: { [path]: utf8Encode(source) } });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const opened = await workspace.open(path);
  ok(opened.ok, JSON.stringify(opened));
  const doc = asTerrainSceneDocument(opened.document);
  ok(doc.apply({ type: "edit-scene-terrain", terrain: { tileOverrides: [{ floor: "ground", cell: [0, 0], tile: {} }] } }).ok);
  deepEqual(await workspace.saveAll(), [{ document: path, result: { ok: true } }]);
  const built = await host.fs.read(output);
  ok(built.ok);
  const board = readBoard(new BinaryReader(built.value));
  ok(board.ok);
  deepEqual(board.value.tileMatrix, [0]);
  const savedSource = await host.fs.read(path);
  ok(savedSource.ok);
  ok(doc.apply({ type: "edit-scene-terrain", terrain: { tileOverrides: [] } }).ok);
  const outside = Uint8Array.of(15, 25, 35);
  ok((await host.fs.write(output, outside)).ok);
  const refused = await doc.save();
  ok(!refused.ok);
  equal(refused.failure.kind, "conflict");
  equal(doc.getSnapshot().dirty, true);
  deepEqual(await host.fs.read(output), { ok: true, value: outside });
  deepEqual(await host.fs.read(path), savedSource);
});

void test("unsupported automatic wall caps do not write the source or generated board", async () => {
  const text = source.replace("id: ground, tiles:", "id: ground, boundarySources: {autoWallCaps: true}, tiles:");
  const host = createMemoryPlatformServices({ files: { [path]: utf8Encode(text) } });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const opened = await workspace.open(path);
  ok(opened.ok, JSON.stringify(opened));
  ok(asTerrainSceneDocument(opened.document).apply({ type: "edit-scene-terrain", terrain: { tileOverrides: [{ floor: "ground", cell: [0, 0], tile: {} }] } }).ok);
  const saved = await opened.document.save();
  ok(!saved.ok);
  ok(saved.failure.message.includes("floors[0].boundarySources.autoWallCaps"));
  deepEqual(host.bytesOf(path), utf8Encode(text));
  equal((await host.fs.read(output)).ok, false);
});

void test("separate games in one workspace can each build Tiles/pond.tst without sharing it", async () => {
  const files: Record<string, Uint8Array> = {};
  for (const game of ["Game/First", "Game/Second"]) {
    const tile = `${game}/Tiles/bank.tkrtle`;
    const image = `${game}/Tiles/sheet.png`;
    files[`${game}/${path}`] = utf8Encode(source.replace("legacy: grass.tst1", `tile: ${tile}`));
    files[`${game}/Tiles/bank.tkrtst`] = utf8Encode(`contract: tileset\nversion: 1.0.0-pre.2\nname: Bank\nexpects: {projection: 2d, cellSize: [32, 32]}\ntiles: [{tile: ${tile}}]\noutputBinding: {target: Tiles/pond.tst, detail: 1, slots: [{slot: 1, tile: ${tile}}]}\n`);
    files[tile] = utf8Encode(`contract: tile\nversion: 1.0.0-pre.1\nname: Bank\nprojection: 2d\nrole: floor\nvisual: {transparent: {mode: alpha}, sample: {file: ${image}, rect: [0, 0, 32, 32]}}\n`);
    files[image] = encodeScenePng({ w: 32, h: 32, rgba: new Uint8Array(32 * 32 * 4).fill(game.endsWith("First") ? 255 : 0) });
  }
  const host = createMemoryPlatformServices({ files });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  for (const game of ["Game/First", "Game/Second"]) {
    const opened = await workspace.open(`${game}/${path}`);
    ok(opened.ok);
    const built = await opened.document.save();
    ok(built.ok, built.ok ? "" : built.failure.message);
    ok((await host.fs.read(`${game}/Tiles/pond.tst`)).ok);
  }
  equal((await host.fs.read("Tiles/pond.tst")).ok, false);
  workspace.dispose();
});
