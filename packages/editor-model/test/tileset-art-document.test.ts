import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { DOS_PALETTE, readTileset, tilesetDetail, writeTileset } from "@tk-reawakened/core";
import { createDocumentIdentity } from "../src/identity.ts";
import { createTilesetArtDocument, tilesetArtCodec, type PaintTilesetPixelsCommand } from "../src/tileset-art-document.ts";

const PATH = "Tiles/art.tst";
const identity = createDocumentIdentity("memory-project", PATH);
const storage = createMemoryPlatformServices();

function bytesOf(detailCode: number, pixels: readonly Uint8Array[], residue = new Uint8Array([0xde, 0xad])): Uint8Array {
  const detail = tilesetDetail(detailCode);
  ok(detail);
  const written = writeTileset({ version: 20, detail, tiles: pixels.map((tile) => ({ pixels: tile })), residue });
  ok(written.ok);
  return written.value;
}

function open(bytes: Uint8Array) {
  const result = createTilesetArtDocument(storage.fs, identity, bytes);
  ok(result.ok);
  return result.document;
}

function paint(changes: PaintTilesetPixelsCommand["changes"], tile = 0): PaintTilesetPixelsCommand {
  return { type: "paint-tileset-pixels", tile, changes };
}

test("TST pixel fields are row-major and one gesture saves through the original encoding", () => {
  const firstTile = new Uint8Array(32 * 32 * 3);
  const secondTile = new Uint8Array(32 * 32 * 3);
  for (let x = 0; x < 32; x += 1) for (let y = 0; y < 32; y += 1) {
    const at = (x * 32 + y) * 3;
    firstTile.set([x, y, (x + y) & 255], at);
    secondTile.set([17, 29, 43], at);
  }
  const residue = new Uint8Array([0xde, 0xad]);
  const original = bytesOf(1, [firstTile, secondTile], residue);
  const doc = open(original);
  const snapshot = doc.getSnapshot();
  equal(snapshot.tiles[0]!.width, 32);
  const viewAt = (3 * 32 + 7) * 4;
  deepEqual(snapshot.tiles[0]!.pixels.slice(viewAt, viewAt + 4), [7, 3, 10, 255]);

  const accepted = doc.apply(paint([{ x: 7, y: 3, rgba: [90, 80, 70, 255] }]));
  ok(accepted.ok);
  equal(doc.getSnapshot().edits.length, 1);
  const saved = readTileset(doc.serialize());
  ok(saved.ok);
  deepEqual(Array.from(saved.value.tiles[0]!.pixels.slice((7 * 32 + 3) * 3, (7 * 32 + 3) * 3 + 3)), [90, 80, 70]);
  deepEqual(saved.value.tiles[1]!.pixels, secondTile);
  deepEqual(saved.value.residue, residue);
  equal(saved.value.version, 20);
  equal(saved.value.detail.code, 1);
  ok(doc.undo(accepted.editId).ok);
  deepEqual(doc.serialize(), original);
});

test("16-pixel and indexed details retain exact storage colors and transparency", () => {
  for (const code of [2, 3, 4, 5, 6]) {
    const detail = tilesetDetail(code);
    ok(detail);
    const raw = new Uint8Array(detail.size * detail.size * detail.bytesPerPixel);
    const doc = open(bytesOf(code, [raw]));
    const color: readonly [number, number, number, number] = detail.bytesPerPixel === 3
      ? [19, 83, 161, 255]
      : [DOS_PALETTE[3]!, DOS_PALETTE[4]!, DOS_PALETTE[5]!, 255];
    ok(doc.apply(paint([
      { x: 3, y: 7, rgba: color },
      { x: 2, y: 4, rgba: [19, 23, 29, 0] },
    ])).ok, `detail ${code} accepts its exact representable colors`);
    const tile = doc.getSnapshot().tiles[0]!;
    equal(tile.width, detail.size);
    equal(tile.height, detail.size);
    deepEqual(tile.pixels.slice((7 * detail.size + 3) * 4, (7 * detail.size + 3) * 4 + 4), color);
    equal(tile.pixels[(4 * detail.size + 2) * 4 + 3], 0);
    const expected = raw.slice();
    if (detail.bytesPerPixel === 3) {
      expected.set(color.slice(0, 3), (3 * detail.size + 7) * 3);
      expected.set([0, 1, 2], (2 * detail.size + 4) * 3);
    } else {
      expected[3 * detail.size + 7] = 1;
      expected[2 * detail.size + 4] = 255;
    }
    deepEqual(doc.serialize(), bytesOf(code, [expected]), `detail ${code} preserves its legacy bytes`);
  }
});

test("an unrepresentable pixel gesture is refused without changing bytes or history", () => {
  const doc = open(bytesOf(1, [new Uint8Array(32 * 32 * 3)]));
  const original = doc.serialize();
  const partialAlpha = doc.apply(paint([{ x: 2, y: 4, rgba: [9, 8, 7, 128] }]));
  ok(!partialAlpha.ok);
  const opaqueKey = doc.apply(paint([{ x: 2, y: 4, rgba: [0, 1, 2, 255] }]));
  ok(!opaqueKey.ok);
  const outOfBounds = doc.apply(paint([{ x: 2, y: 4, rgba: [9, 8, 7, 128] }, { x: 32, y: 0, rgba: [0, 0, 0, 255] }]));
  ok(!outOfBounds.ok);
  deepEqual(doc.serialize(), original);
  equal(doc.getSnapshot().edits.length, 0);
  equal(doc.getSnapshot().canUndo, false);
});

test("a visual no-op on duplicate indexed colors preserves the existing palette index", () => {
  const detail = tilesetDetail(3);
  ok(detail);
  let duplicate = -1;
  for (let a = 0; a < 255 && duplicate < 0; a += 1) {
    for (let b = a + 1; b < 255; b += 1) {
      const atA = a * 3;
      const atB = b * 3;
      if (DOS_PALETTE[atA] === DOS_PALETTE[atB] && DOS_PALETTE[atA + 1] === DOS_PALETTE[atB + 1] && DOS_PALETTE[atA + 2] === DOS_PALETTE[atB + 2]) { duplicate = b; break; }
    }
  }
  ok(duplicate >= 0);
  const duplicateAt = duplicate * 3;
  const rgb = [DOS_PALETTE[duplicateAt], DOS_PALETTE[duplicateAt + 1], DOS_PALETTE[duplicateAt + 2]] as const;
  const indices = new Uint8Array(32 * 32).fill(duplicate);
  const original = bytesOf(3, [indices]);
  const doc = open(original);
  const result = doc.apply(paint([{ x: 5, y: 9, rgba: [rgb[0]!, rgb[1]!, rgb[2]!, 255] }]));
  ok(!result.ok);
  deepEqual(doc.serialize(), original);
  equal(doc.getSnapshot().edits.length, 0);
});

test("the command boundary rejects malformed, sparse, and oversized pixel gestures", () => {
  const valid = { type: "paint-tileset-pixels", tile: 0, changes: [{ x: 0, y: 0, rgba: [1, 2, 3, 255] }] };
  ok(tilesetArtCodec.isCommand(valid));
  ok(!tilesetArtCodec.isCommand({ ...valid, changes: [{ x: 0, y: 0, rgba: [1n, 2, 3, 255] }] }));
  ok(!tilesetArtCodec.isCommand({ ...valid, changes: new Array(1) }));
  ok(!tilesetArtCodec.isCommand({ ...valid, changes: [{ x: 0, y: 0, rgba: [1, "2", 3, 255] }] }));
  ok(!tilesetArtCodec.isCommand({ ...valid, changes: [{ x: 0.5, y: 0, rgba: [1, 2, 3, 255] }] }));
  ok(!tilesetArtCodec.isCommand({ ...valid, changes: [{ x: 0, y: 0, rgba: [1.5, 2, 3, 255] }] }));
  ok(!tilesetArtCodec.isCommand({ ...valid, changes: [{ x: 0, y: 0, rgba: [256, 2, 3, 255] }] }));
  ok(!tilesetArtCodec.isCommand({ ...valid, changes: [] }));
  ok(!tilesetArtCodec.isCommand({ ...valid, changes: new Array(1025).fill(valid.changes[0]) }));
});
