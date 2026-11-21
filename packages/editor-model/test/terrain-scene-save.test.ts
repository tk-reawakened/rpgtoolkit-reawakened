import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { BinaryReader, readBoard, utf8Encode } from "@tk-reawakened/core";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { asTerrainSceneDocument } from "../src/kinds.ts";
import { createDocumentWorkspace } from "../src/workspace.ts";

const path = "Boards/pond.tkrscn";
const output = "Boards/pond.brd";
const source = `contract: scene
version: 1.0.0-pre.1
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

void test("saving a scene does not silently discard pack placements or boundary tracing", async () => {
  const text = `${source.replace("id: ground, tiles:", "id: ground, boundarySources: {walkableTiles: [{legacy: grass.tst1}]}, tiles:")}placedPacks: [{instanceId: arch, pack: Art/props.tkrpack, asset: arch, floor: ground, x: 20, y: 30}]\n`;
  const host = createMemoryPlatformServices({ files: { [path]: utf8Encode(text) } });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const opened = await workspace.open(path);
  ok(opened.ok, JSON.stringify(opened));
  const saved = await opened.document.save();
  ok(!saved.ok);
  ok(saved.failure.message.includes("placedPacks"));
  ok(saved.failure.message.includes("floors[0].boundarySources"));
  equal((await host.fs.read(output)).ok, false);
});
