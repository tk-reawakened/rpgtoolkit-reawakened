// The tile bitmap document (story 12.8, T-62): commands over the real reader and writer, with expected bytes built by
// hand from the stored layout (`docs/spec/formats/tiles.md#tile-bitmap-tbm`), never by the document under test.
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  BinaryReader,
  TILE_BITMAP_MAGIC,
  compositeTileBitmap,
  expandTileToRgba,
  readTileBitmap,
  readTileset,
  tileDimensions,
  writeTileBitmap,
  type TileBitmap,
  type TileBitmapCell,
} from "@tk-reawakened/core";
import { createMemoryPlatformServices, type MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import {
  colourOfShade,
  createDocumentIdentity,
  createDocumentWorkspace,
  createTileBitmapDocument,
  kindForPath,
  lightnessOfShade,
  openTileBitmapDocument,
  previewTileBitmap,
  shadeOfColour,
  shadeWithLightness,
  tileBitmapCellAt,
  type TileBitmapCommand,
  type TileBitmapDocument,
} from "../src/index.ts";

const tileset = new Uint8Array(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "spec", "examples", "versions", "tileset", "tileset_detail1.tst")));

const PATH = "Bitmap/house.tbm";
const identity = createDocumentIdentity("memory-project", PATH);

const EMPTY: TileBitmapCell = { tile: "", r: 0, g: 0, b: 0 };
const cell = (tile: string, r = 0, g = 0, b = 0): TileBitmapCell => ({ tile, r, g, b });

/** A bitmap model from its drawn grid; the stored extra column and row hold `padding`, and the layout is x outer, y inner. */
function bitmap(width: number, height: number, drawn: (x: number, y: number) => TileBitmapCell, padding: TileBitmapCell = EMPTY, extra: Partial<TileBitmap> = {}): TileBitmap {
  const cells: TileBitmapCell[] = [];
  for (let x = 0; x <= width; x += 1) {
    for (let y = 0; y <= height; y += 1) cells.push(x < width && y < height ? drawn(x, y) : padding);
  }
  return { magic: TILE_BITMAP_MAGIC, major: 3, minor: 0, width, height, cells, residue: new Uint8Array(), ...extra };
}

const bytesOf = (model: TileBitmap): Uint8Array => {
  const written = writeTileBitmap(model);
  if (!written.ok) throw new Error(written.error.message);
  return written.value;
};

/** A 3 × 2 shaded stamp with a hand-chosen extra row and column, a different version and bytes no reader models. */
const STAMP = bitmap(
  3,
  2,
  (x, y) => (x === 1 && y === 0 ? cell("") : cell(`village.tst${(x + y) % 2 + 1}`, x * 10, 0 - y * 20, x - y)),
  cell("pad.gph", 7, 8, 9),
  { major: 3, minor: 1, residue: Uint8Array.from([0xde, 0xad, 0xbe, 0xef]) },
);
const STAMP_BYTES = bytesOf(STAMP);

async function open(bytes: Uint8Array = STAMP_BYTES): Promise<{ readonly host: MemoryPlatformServices; readonly doc: TileBitmapDocument }> {
  const host = createMemoryPlatformServices({ files: { [PATH]: bytes } });
  const opened = await openTileBitmapDocument(host.fs, identity);
  ok(opened.ok, "the bitmap opens");
  return { host, doc: opened.document };
}

const accepted = (doc: TileBitmapDocument, command: TileBitmapCommand): void => {
  const result = doc.apply(command);
  ok(result.ok, result.ok ? "" : result.rejection.message);
};

test(".tbm files are a registered kind, and a document opens with its size, cells and summary", async () => {
  equal(kindForPath("Bitmap/HOUSE.TBM")?.id, "tile-bitmap");
  const { doc } = await open();
  const snapshot = doc.getSnapshot();
  equal(doc.kind, "tile-bitmap");
  equal(snapshot.readOnly, null);
  equal(snapshot.width, 3);
  equal(snapshot.height, 2);
  equal(snapshot.minor, 1);
  equal(snapshot.cells.length, 6, "only the drawn cells, never the stored extra row and column");
  deepEqual(tileBitmapCellAt(snapshot, 2, 1), cell("village.tst2", 20, -20, 1));
  deepEqual(tileBitmapCellAt(snapshot, 1, 0), EMPTY);
  equal(tileBitmapCellAt(snapshot, 3, 0), null, "the extra column is not drawn");
  equal(tileBitmapCellAt(snapshot, 0, 2), null, "the extra row is not drawn");
  equal(kindForPath(PATH)?.summarise(STAMP_BYTES, PATH), "3×2 tile bitmap");
  deepEqual(doc.serialize(), STAMP_BYTES, "opening changes nothing (AD-18)");
});

test("draw, erase and shade change only their own cell, and a saved file reopens with the same size and cells", async () => {
  const { host, doc } = await open();
  accepted(doc, { type: "set-bitmap-cell", x: 1, y: 0, tile: "village.tst2" });
  accepted(doc, { type: "set-bitmap-cell", x: 2, y: 1, tile: "" });
  accepted(doc, { type: "set-bitmap-shade", x: 0, y: 1, r: -255, g: 255, b: 0 });
  equal(doc.getSnapshot().dirty, true);
  ok((await doc.save()).ok);
  equal(doc.getSnapshot().dirty, false);

  // The oracle: the same stamp written by hand with exactly those three cells changed. The extra row and column,
  // the version and the trailing bytes are the file's own.
  const expected = bitmap(
    3,
    2,
    (x, y) => {
      if (x === 1 && y === 0) return cell("village.tst2");
      if (x === 2 && y === 1) return cell("", 20, -20, 1);
      if (x === 0 && y === 1) return cell("village.tst2", -255, 255, 0);
      return STAMP.cells[x * 3 + y]!;
    },
    cell("pad.gph", 7, 8, 9),
    { major: 3, minor: 1, residue: Uint8Array.from([0xde, 0xad, 0xbe, 0xef]) },
  );
  deepEqual(host.bytesOf(PATH), bytesOf(expected));

  const reopened = await openTileBitmapDocument(host.fs, identity);
  ok(reopened.ok);
  const snapshot = reopened.document.getSnapshot();
  equal(snapshot.width, 3);
  equal(snapshot.height, 2);
  deepEqual(tileBitmapCellAt(snapshot, 1, 0), cell("village.tst2"));
  deepEqual(tileBitmapCellAt(snapshot, 2, 1), cell("", 20, -20, 1), "erasing keeps the cell's shade");
  deepEqual(tileBitmapCellAt(snapshot, 0, 1), cell("village.tst2", -255, 255, 0), "drawing keeps and shading keeps the other half of the cell");
});

test("undo and redo restore the exact bytes of each edit", async () => {
  const { doc } = await open();
  accepted(doc, { type: "set-bitmap-cell", x: 0, y: 0, tile: "village.tst2" });
  const afterDraw = doc.serialize();
  accepted(doc, { type: "set-bitmap-shade", x: 0, y: 0, r: 1, g: 2, b: 3 });
  const edits = doc.getSnapshot().edits;
  equal(edits.length, 2);
  deepEqual(edits.map((edit) => edit.label), ['Draw "village.tst2" at column 1, row 1', "Shade column 1, row 1 (1, 2, 3)"]);
  ok(doc.undo(edits[1]!.editId).ok);
  deepEqual(doc.serialize(), afterDraw);
  ok(doc.undo(edits[0]!.editId).ok);
  deepEqual(doc.serialize(), STAMP_BYTES);
  equal(doc.getSnapshot().dirty, false);
});

test("resizing keeps cells that stay inside, adds empty cells, and keeps the stored extra row and column and the rest of the file", async () => {
  const { host, doc } = await open();
  accepted(doc, { type: "set-bitmap-size", width: 4, height: 1 });
  equal(doc.getSnapshot().width, 4);
  equal(doc.getSnapshot().height, 1);
  ok((await doc.save()).ok);
  // The extra column was stored at x = 3 and the extra row at y = 2. In the new 4 × 1 grid the old extra column is
  // drawn (empty), old row 1 is the new extra row (artwork never becomes padding), and the cell that was extra in both
  // grids, (3, 1), keeps the file's own padding.
  const expected = bitmap(
    4,
    1,
    (x, y) => (x < 3 && y < 1 ? STAMP.cells[x * 3 + y]! : EMPTY),
    EMPTY,
    { major: 3, minor: 1, residue: Uint8Array.from([0xde, 0xad, 0xbe, 0xef]) },
  );
  const padded = { ...expected, cells: expected.cells.map((entry, index) => (index === 3 * 2 + 1 ? cell("pad.gph", 7, 8, 9) : entry)) };
  deepEqual(host.bytesOf(PATH), bytesOf(padded));
  const read = readTileBitmap(new BinaryReader(host.bytesOf(PATH)!));
  ok(read.ok);
  equal(read.value.cells.length, 5 * 2, "one extra column and row are still stored");

  accepted(doc, { type: "set-bitmap-size", width: 3, height: 2 });
  const back = doc.getSnapshot();
  deepEqual(tileBitmapCellAt(back, 0, 0), cell("village.tst1", 0, 0, 0));
  deepEqual(tileBitmapCellAt(back, 2, 1), EMPTY, "a cell that was removed does not come back when the size does");
  equal(back.cells.length, 6);
});

test("a command that names a cell outside the drawn grid, an out-of-range value, or no change is refused and changes nothing", async () => {
  const { doc } = await open();
  const before = doc.getSnapshot();
  const refused: readonly [TileBitmapCommand, RegExp][] = [
    [{ type: "set-bitmap-cell", x: 3, y: 0, tile: "village.tst1" }, /outside the tile bitmap/],
    [{ type: "set-bitmap-cell", x: 0, y: 2, tile: "village.tst1" }, /outside the tile bitmap/],
    [{ type: "set-bitmap-cell", x: -1, y: 0, tile: "village.tst1" }, /outside the tile bitmap/],
    [{ type: "set-bitmap-cell", x: 0.5, y: 0, tile: "village.tst1" }, /outside the tile bitmap/],
    [{ type: "set-bitmap-cell", x: 0, y: 0, tile: "village.tst1" }, /already/],
    [{ type: "set-bitmap-cell", x: 0, y: 0, tile: "bad\u0000name" }, /./],
    [{ type: "set-bitmap-shade", x: 0, y: 0, r: 256, g: 0, b: 0 }, /-255 to 255/],
    [{ type: "set-bitmap-shade", x: 0, y: 0, r: 0, g: -256, b: 0 }, /whole number/],
    [{ type: "set-bitmap-shade", x: 0, y: 0, r: 0, g: 0, b: 1.5 }, /whole number/],
    [{ type: "set-bitmap-shade", x: 0, y: 0, r: 0, g: 0, b: 0 }, /already/],
    [{ type: "set-bitmap-size", width: 0, height: 2 }, /1 to 40/],
    [{ type: "set-bitmap-size", width: 41, height: 2 }, /1 to 40/],
    [{ type: "set-bitmap-size", width: 2.5, height: 2 }, /1 to 40/],
    [{ type: "set-bitmap-size", width: 3, height: 2 }, /already 3 × 2/],
  ];
  for (const [command, message] of refused) {
    const result = doc.apply(command);
    ok(!result.ok, JSON.stringify(command));
    equal(result.rejection.reason, "invalid");
    match(result.rejection.message, message, JSON.stringify(command));
  }
  equal(doc.getSnapshot(), before, "the very same snapshot: nothing changed");
  equal(doc.getSnapshot().dirty, false);
});

test("an absurd size is refused at once and never allocates a grid", async () => {
  const { doc } = await open();
  const before = doc.getSnapshot();
  const started = performance.now();
  for (const [width, height] of [[2 ** 30, 2 ** 30], [32767, 32767], [41, 1], [1, 41], [Number.MAX_SAFE_INTEGER, 2]] as const) {
    const result = doc.apply({ type: "set-bitmap-size", width, height });
    ok(!result.ok, `${width} × ${height}`);
    match(result.rejection.message, /1 to 40/);
  }
  ok(performance.now() - started < 200, "refusing needs no allocation proportional to the size");
  equal(doc.getSnapshot(), before);
});

test("a webview command is only applied when it has the shape of a tile bitmap command", () => {
  const kind = kindForPath(PATH)!;
  ok(kind.isCommand({ type: "set-bitmap-cell", x: 0, y: 0, tile: "a.tst1" }));
  ok(kind.isCommand({ type: "set-bitmap-shade", x: 0, y: 0, r: 1, g: 2, b: 3 }));
  ok(kind.isCommand({ type: "set-bitmap-size", width: 2, height: 2 }));
  for (const bad of [null, {}, { type: "set-tile", layer: 0, x: 0, y: 0, tile: "a" }, { type: "set-bitmap-cell", x: 0, y: 0 }, { type: "set-bitmap-shade", x: 0, y: 0, r: "1", g: 0, b: 0 }, { type: "set-bitmap-size", width: 2 }]) {
    equal(kind.isCommand(bad), false, JSON.stringify(bad));
  }
});

test("a bitmap that stores no cells opens, shows an empty grid and can be given a size", async () => {
  const empty: TileBitmap = { magic: TILE_BITMAP_MAGIC, major: 3, minor: 0, width: -1, height: -1, cells: [], residue: new Uint8Array() };
  const { doc } = await open(bytesOf(empty));
  equal(doc.getSnapshot().width, 0);
  equal(doc.getSnapshot().cells.length, 0);
  accepted(doc, { type: "set-bitmap-size", width: 2, height: 1 });
  deepEqual(doc.serialize(), bytesOf(bitmap(2, 1, () => EMPTY)));
});

test("a file the reader refuses is not opened", () => {
  const host = createMemoryPlatformServices({ files: { [PATH]: STAMP_BYTES } });
  const refused = createTileBitmapDocument(host.fs, identity, STAMP_BYTES.subarray(0, 4));
  ok(!refused.ok);
  equal(refused.error.kind, "format");
  ok(createTileBitmapDocument(host.fs, identity, STAMP_BYTES).ok);
});

test("the workspace opens a .tbm through its registered kind and saves it back", async () => {
  const host = createMemoryPlatformServices({ files: { [PATH]: STAMP_BYTES } });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: { fs: host.fs, dialogs: host.dialogs, capabilities: host.capabilities } });
  const opened = await workspace.open(PATH);
  ok(opened.ok);
  equal(opened.document.kind, "tile-bitmap");
  const document = opened.document as unknown as TileBitmapDocument;
  ok(document.apply({ type: "set-bitmap-cell", x: 0, y: 0, tile: "village.tst2" }).ok);
  ok((await document.save()).ok);
  equal(readTileBitmap(new BinaryReader(host.bytesOf(PATH)!)).ok, true);
});

test("the hue picker, lightness slider and number fields agree (T-62)", () => {
  deepEqual(shadeOfColour("#808080"), { r: 0, g: 0, b: 0 }, "mid-grey is no shade");
  deepEqual(shadeOfColour("#ffffff"), { r: 254, g: 254, b: 254 });
  deepEqual(shadeOfColour("#000000"), { r: -255, g: -255, b: -255 }, "the darkest channel is limited to -255");
  deepEqual(shadeOfColour("#FF8000"), { r: 254, g: 0, b: -255 });
  equal(shadeOfColour("red"), null);
  equal(shadeOfColour("#12345"), null);
  equal(colourOfShade({ r: 0, g: 0, b: 0 }), "#808080");
  equal(colourOfShade({ r: 255, g: -255, b: 100 }), "#ff01b2");
  equal(colourOfShade({ r: -255, g: 254, b: 0 }), "#01ff80");
  equal(lightnessOfShade({ r: 30, g: 0, b: -30 }), 0);
  equal(lightnessOfShade({ r: 10, g: 20, b: 30 }), 20);
  deepEqual(shadeWithLightness({ r: 10, g: 20, b: 30 }, 50), { r: 40, g: 50, b: 60 }, "all three move by the change");
  deepEqual(shadeWithLightness({ r: 250, g: 0, b: -250 }, 100), { r: 255, g: 100, b: -150 }, "each channel is limited");
  deepEqual(shadeWithLightness({ r: 1, g: 1, b: 1 }, 9999), { r: 255, g: 255, b: 255 });
});

test("the preview is the core compositor's picture of the cells over the project's tiles, with a missing tile drawn empty and named", async () => {
  const model = bitmap(2, 1, (x) => (x === 0 ? cell("village.tst1") : cell("village.tst2", 10, -20, 30)));
  const withMissing = bitmap(2, 1, (x) => (x === 0 ? cell("village.tst1") : cell("gone.tst1", 10, -20, 30)));
  const host = createMemoryPlatformServices({ files: { "Tiles/village.tst": tileset } });

  const picture = await previewTileBitmap(host.fs, "memory-project", bytesOf(model));
  ok(picture.ok, picture.ok ? "" : picture.message);
  equal(picture.width, 64);
  equal(picture.height, 32);
  deepEqual(picture.warnings, []);

  // Oracle: the tiles read straight from the tileset (column-major tile pixels turned row-major), composed by core.
  const read = readTileset(tileset, "village.tst");
  ok(read.ok);
  const { width, height } = tileDimensions(read.value.detail);
  const tiles = new Map<string, { w: number; h: number; rgba: Uint8Array }>();
  for (const [reference, index] of [["village.tst1", 0], ["village.tst2", 1]] as const) {
    const column = expandTileToRgba(read.value, index);
    ok(column.ok);
    const rgba = new Uint8Array(width * height * 4);
    for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) rgba.set(column.value.subarray((x * height + y) * 4, (x * height + y) * 4 + 4), (y * width + x) * 4);
    tiles.set(reference, { w: width, h: height, rgba });
  }
  const expected = compositeTileBitmap(model, tiles);
  ok(expected.ok);
  deepEqual(picture.rgba, expected.value.rgba);

  const missing = await previewTileBitmap(host.fs, "memory-project", bytesOf(withMissing));
  ok(missing.ok);
  equal(missing.warnings.length, 1);
  match(missing.warnings[0]!, /gone\.tst1/);
  for (let row = 0; row < 32; row += 1) {
    const left = row * 64 * 4;
    deepEqual(missing.rgba.subarray(left, left + 32 * 4), picture.rgba.subarray(left, left + 32 * 4), "the cell whose tile exists still draws");
    ok(missing.rgba.subarray(left + 32 * 4, left + 64 * 4).every((value, at) => at % 4 !== 3 || value === 0), "the cell with no tile is transparent");
  }

  const none = await previewTileBitmap(host.fs, "memory-project", bytesOf({ magic: TILE_BITMAP_MAGIC, major: 3, minor: 0, width: -1, height: -1, cells: [], residue: new Uint8Array() }));
  ok(!none.ok);
  match(none.message, /no drawn cells/);
});

test("the stored extra row and column are never drawn, so a tile they name is not reported missing", async () => {
  const host = createMemoryPlatformServices({ files: { "Tiles/village.tst": tileset } });
  const model = bitmap(2, 1, () => cell("village.tst1"), cell("pad.gph", 1, 2, 3));
  const picture = await previewTileBitmap(host.fs, "memory-project", bytesOf(model));
  ok(picture.ok);
  deepEqual(picture.warnings, []);
});
