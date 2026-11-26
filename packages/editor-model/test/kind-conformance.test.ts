// The kind-conformance suite (ADR 0026 decision 5): one table of registered kinds run through one set of checks, so the
// lifecycle promises of ADR 0022 D2 and D3 are proved per kind and not re-argued per editor. Each case uses the smallest
// authored fixture for its kind and no engine (the owner's test-speed rule).
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ANIMATION_MAGIC, TILE_BITMAP_MAGIC, writeAnimation, writeTileBitmap, utf8Encode } from "@tk-reawakened/core";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createDocumentIdentity, DOCUMENT_KINDS, kindForPath, type AnyCommand, type AnyDocument } from "../src/index.ts";
import { exampleBoard, exampleCharacter, exampleItem, exampleMain, exampleTileset } from "./fixtures.ts";

interface KindCase {
  readonly kind: string;
  readonly path: string;
  readonly bytes: Uint8Array;
  /** A command the kind accepts and that changes the document. */
  readonly accepted: AnyCommand;
  /** A command the kind rejects whole. */
  readonly rejected: unknown;
}

/** A 2 × 1 tile bitmap with its stored extra column and row: (2 + 1) × (1 + 1) cells, x outer. */
function exampleTileBitmap(): Uint8Array {
  const cell = (tile: string) => ({ tile, r: 0, g: 0, b: 0 });
  const written = writeTileBitmap({
    magic: TILE_BITMAP_MAGIC,
    major: 3,
    minor: 0,
    width: 2,
    height: 1,
    cells: [cell("village.tst1"), cell(""), cell(""), cell(""), cell(""), cell("")],
    residue: new Uint8Array(),
  });
  if (!written.ok) throw new Error(written.error.message);
  return written.value;
}

function exampleAnimation(): Uint8Array {
  const written = writeAnimation({
    magic: ANIMATION_MAGIC,
    major: 2,
    minor: 3,
    width: 32,
    height: 32,
    frames: [{ image: "walk.png", transparent: { r: 255, g: 0, b: 255 }, sound: "" }],
    delay: 0.1,
    residue: new Uint8Array(),
  });
  if (!written.ok) throw new Error(written.error.message);
  return written.value;
}

const CASES: readonly KindCase[] = [
  {
    kind: "main",
    path: "Main/example.gam",
    bytes: exampleMain(9),
    accepted: { type: "set-game-title", title: "Renamed" },
    rejected: { type: "set-game-title", title: "no \u0000 allowed" },
  },
  {
    kind: "board",
    path: "Boards/village.brd",
    bytes: exampleBoard(4),
    accepted: { type: "set-tile", layer: 0, x: 1, y: 1, tile: "village.tst8" },
    rejected: { type: "set-tile", layer: 0, x: 9, y: 9, tile: "village.tst8" },
  },
  {
    kind: "tile-bitmap",
    path: "Bitmap/house.tbm",
    bytes: exampleTileBitmap(),
    accepted: { type: "set-bitmap-cell", x: 1, y: 0, tile: "village.tst2" },
    rejected: { type: "set-bitmap-cell", x: 2, y: 0, tile: "village.tst2" },
  },
  {
    kind: "font",
    path: "Font/retro.fnt",
    // Written by hand from the format: three header lines, then 2048 rows as ` n ` with CRLF; glyph 65's first row is 129.
    bytes: new TextEncoder().encode(`RPGTLKIT FONT\r\n2\r\n0\r\n${Array.from({ length: 2048 }, (_, index) => ` ${index === 65 * 8 ? 129 : 0} `).join("\r\n")}\r\n`),
    accepted: { type: "set-font-pixels", glyph: 65, pixels: [{ x: 0, y: 0, ink: true }, { x: 7, y: 7, ink: true }] },
    rejected: { type: "set-font-pixels", glyph: 65, pixels: [{ x: 8, y: 0, ink: true }] },
  },
  {
    kind: "animation",
    path: "Misc/walk.anm",
    bytes: exampleAnimation(),
    accepted: { type: "insert-animation-frame", index: 1, frame: { image: "run.png", transparent: { r: 0, g: 0, b: 0 }, sound: "step.wav" } },
    rejected: { type: "insert-animation-frame", index: 3, frame: { image: "bad.png", transparent: { r: 0, g: 0, b: 0 }, sound: "" } },
  },
  {
    kind: "character",
    path: "Chrs/hero.tem",
    bytes: exampleCharacter(),
    accepted: { type: "set-sprite-animation", group: "walk", index: 7, file: "Misc/hero_walk_se.anm" },
    rejected: { type: "set-sprite-animation", group: "walk", index: 8, file: "Misc/hero_walk_invalid.anm" },
  },
  {
    kind: "item",
    path: "Item/chest.itm",
    bytes: exampleItem(),
    accepted: { type: "set-sprite-animation", group: "idle", index: 7, file: "Misc/chest_idle_se.anm" },
    rejected: { type: "set-sprite-animation", group: "battle", index: 0, file: "Misc/chest_battle.anm" },
  },
  {
    kind: "program",
    path: "Prg/intro.prg",
    // CRLF, a Windows-1252 byte (0xE9), a lone CR, and no final newline: nothing here may change on a plain save.
    bytes: new Uint8Array([0x2f, 0x2f, 0x20, 0x63, 0x61, 0x66, 0xe9, 0x0d, 0x0a, 0x78, 0x20, 0x3d, 0x20, 0x31, 0x0d, 0x79]),
    accepted: { type: "edit-text", edits: [{ from: 0, to: 0, text: "// header\n" }] },
    rejected: { type: "edit-text", edits: [{ from: 0, to: 0, text: "\u0100" }] },
  },
  {
    kind: "tileset",
    path: "Tiles/art.tst",
    bytes: exampleTileset(1),
    accepted: { type: "paint-tileset-pixels", tile: 0, changes: [{ x: 0, y: 0, rgba: [230, 17, 99, 255] }] },
    rejected: { type: "paint-tileset-pixels", tile: 0, changes: [{ x: 0, y: 0, rgba: [230, 17, 99, 127] }] },
  },
  {
    kind: "native-clip",
    path: "Misc/walk.tkranm",
    bytes: utf8Encode("contract: animation-clip\nversion: 1.0.0-pre.1\ncanvas: {width: 32, height: 32}\ndelay: 0.15 # timing\nframes:\n  - image: bitmap/walk.png # frame\n"),
    accepted: { type: "set-native-clip-property", path: ["delay"], value: 0.2 },
    rejected: { type: "set-native-clip-property", path: ["delay"], value: -1 },
  },
  {
    kind: "native-tile",
    path: "Tiles/fence.tkrtle",
    bytes: utf8Encode("contract: tile\nversion: 1.0.0-pre.1\nname: Fence\nprojection: 2d\nrole: wall\nvisual: {transparent: {mode: alpha}, sample: {file: Bitmap/fence.png, rect: [0, 0, 32, 32]}}\n"),
    accepted: { type: "set-native-geometry", solid: [{ label: "Rail", closed: false, points: [[16, 5], [16, 12]] }], under: [] },
    rejected: { type: "set-native-geometry", solid: [{ label: "Rail", closed: true, points: [[16, 5], [16, 12]] }], under: [] },
  },
  {
    kind: "native-asset-pack",
    path: "Packs/garden.tkrpack",
    bytes: utf8Encode("contract: asset-pack\nversion: 1.0.0-pre.1\nname: Garden\nprojection: 2d\ngrid: {tileWidth: 32, tileHeight: 32}\nsources: [{id: atlas, file: Bitmap/arch.png}]\nassets:\n  - id: arch\n    name: Arch\n    kind: prop\n    anchor: {x: 16, y: 32, snap: bottom-center}\n    visuals: [{source: atlas, rect: [0, 0, 32, 32]}]\n"),
    accepted: { type: "set-native-geometry", asset: "arch", solid: [], under: [{ label: "Lintel", closed: true, attributes: 4, points: [[-8, -16], [8, -16], [8, -8]] }] },
    rejected: { type: "set-native-geometry", asset: "missing", solid: [], under: [] },
  },
  {
    kind: "terrain-scene",
    path: "Boards/pond.tkrscn",
    bytes: utf8Encode("contract: scene\nversion: 1.0.0-pre.2\n# Keep the pond editable\nprojection: 2d\nsize: {width: 1, height: 1}\nfloors: [{id: ground}]\n"),
    accepted: { type: "edit-scene-terrain", terrain: { tileOverrides: [{ floor: "ground", cell: [0, 0], tile: { legacy: "bank.tst1" } }] } },
    rejected: { type: "edit-scene-terrain", terrain: { tileOverrides: [{ floor: "ground", cell: [1, 0], tile: { legacy: "bank.tst1" } }] } },
  },
  {
    kind: "special-move",
    path: "SpcMove/fireball.spc",
    bytes: new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/game/Game/Example/SpcMove/fireball.spc", import.meta.url))),
    accepted: { type: "set-special-move-usable", context: "battle", usable: true },
    rejected: { type: "set-special-move-amount", field: "damage", value: 2_147_483_648 },
  },
  {
    kind: "status-effect",
    path: "StatusE/burn.ste",
    bytes: new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/game/Game/Example/StatusE/burn.ste", import.meta.url))),
    accepted: { type: "set-status-effect-number", field: "hpPerRound", value: -2 },
    rejected: { type: "set-status-effect-number", field: "hpPerRound", value: 32_768 },
  },
  {
    kind: "battle-background",
    path: "Bkrounds/forest.bkg",
    bytes: new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/game/Game/Example/Bkrounds/forest.bkg", import.meta.url))),
    accepted: { type: "set-battle-background-text", field: "image", value: "arena.tbm" },
    rejected: { type: "set-battle-background-text", field: "music", value: "bad\u0000name.mid" },
  },
];

async function open(entry: KindCase): Promise<{ readonly host: ReturnType<typeof createMemoryPlatformServices>; readonly doc: AnyDocument }> {
  const host = createMemoryPlatformServices({ files: { [entry.path]: entry.bytes } });
  const kind = kindForPath(entry.path);
  ok(kind !== null, `${entry.path} has a registered kind`);
  const opened = await kind.open(host.fs, createDocumentIdentity("memory-project", entry.path));
  ok(opened.ok, `${entry.path} opens`);
  return { host, doc: opened.document };
}

test("every registered kind is in the conformance table (ADR 0026 decision 5)", () => {
  deepEqual(DOCUMENT_KINDS.map((kind) => kind.id).sort(), CASES.map((entry) => entry.kind).sort());
});

for (const entry of CASES) {
  test(`${entry.kind}: opening and saving with no edit leaves the bytes identical (AD-18)`, async () => {
    const { host, doc } = await open(entry);
    equal(doc.kind, entry.kind);
    equal(doc.getSnapshot().readOnly, null);
    deepEqual(doc.serialize(), entry.bytes);
    ok((await doc.save()).ok);
    deepEqual(host.bytesOf(entry.path), entry.bytes);
  });

  test(`${entry.kind}: a rejected command leaves the snapshot unchanged and names its reason (ADR 0022 D3.1)`, async () => {
    const { doc } = await open(entry);
    const before = doc.getSnapshot();
    const result = doc.apply(entry.rejected as AnyCommand);
    ok(!result.ok);
    equal(result.rejection.reason, "invalid");
    ok(result.rejection.message.length > 0);
    equal(doc.getSnapshot(), before, "the very same snapshot object: nothing changed");
  });

  test(`${entry.kind}: apply then undo gives back the snapshot before, and every command has a label (AD-19)`, async () => {
    const { doc } = await open(entry);
    const before = doc.getSnapshot();
    const applied = doc.apply(entry.accepted);
    ok(applied.ok);
    const edit = doc.getSnapshot().edits.at(-1);
    ok(edit !== undefined && edit.label.length > 0);
    equal(doc.getSnapshot().dirty, true);
    ok(doc.undo(applied.editId).ok);
    const after = doc.getSnapshot();
    equal(after.dirty, false);
    deepEqual({ ...after, edits: [] }, { ...before, edits: [], canRedo: after.canRedo });
    deepEqual(doc.serialize(), entry.bytes);
  });

  test(`${entry.kind}: apply, save and reopen agree (ADR 0022 D3.3)`, async () => {
    const { host, doc } = await open(entry);
    ok(doc.apply(entry.accepted).ok);
    ok((await doc.save()).ok);
    equal(doc.getSnapshot().dirty, false);
    const kind = kindForPath(entry.path)!;
    const reopened = await kind.open(host.fs, createDocumentIdentity("memory-project", entry.path));
    ok(reopened.ok);
    deepEqual(reopened.document.serialize(), doc.serialize());
    deepEqual(host.bytesOf(entry.path), doc.serialize());
  });
}
