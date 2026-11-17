import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { BinaryReader, TILE_BITMAP_MAGIC, readAnimation, readBoard, readItem, writeAnimation, writeBoard, writeItem, writeTileBitmap, type Board, type BoardImage, type BoardSprite } from "@tk-reawakened/core";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { buildNewBoard, previewBoard, type BoardPreview } from "../src/index.ts";
import { exampleAnimation, exampleItem, exampleTileset } from "./fixtures.ts";

const MAGENTA = { r: 255, g: 0, b: 255 };
const sprite = (itemFile: string, x = 48, y = 63): BoardSprite => ({ itemFile, x, y, layer: 1, activationPrg: "", multitaskPrg: "", initialVar: "", initialValue: "", finalVar: "", finalValue: "", loadingVar: "", loadingValue: "", activate: 0, activationType: 0, reserved: -1 });
const image = (file: string, left = 0, top = 0): BoardImage => ({ file, left, top, layer: 1, drawType: 0, transparent: MAGENTA, reserved: 100 });
function board(fields: Partial<Board> = {}): Uint8Array {
  const built = buildNewBoard({ name: "objects", coordSystem: "2d", pixelCoordinates: false, width: 4, height: 3, layers: 1, backgroundImage: "", template: null });
  ok(built.ok);
  const parsed = readBoard(new BinaryReader(built.bytes));
  ok(parsed.ok);
  const written = writeBoard({ ...parsed.value, ...fields });
  ok(written.ok, written.ok ? "" : written.error.message);
  return written.value;
}

/** A hand-authored two-by-two 24-bit BMP, pixels supplied in top-down RGB order. */
function bmp(pixels: readonly (readonly [number, number, number])[]): Uint8Array {
  const bytes = new Uint8Array(70);
  const view = new DataView(bytes.buffer);
  bytes.set([0x42, 0x4d]);
  view.setUint32(2, bytes.length, true); view.setUint32(10, 54, true); view.setUint32(14, 40, true);
  view.setInt32(18, 2, true); view.setInt32(22, 2, true); view.setUint16(26, 1, true); view.setUint16(28, 24, true); view.setUint32(34, 16, true);
  for (let y = 0; y < 2; y += 1) for (let x = 0; x < 2; x += 1) {
    const [r, g, b] = pixels[y * 2 + x]!;
    bytes.set([b, g, r], 54 + (1 - y) * 8 + x * 3);
  }
  return bytes;
}
const red = [200, 10, 20] as const;
const blue = [10, 20, 200] as const;
function animation(file: string, firstEmpty = false): Uint8Array {
  const parsed = readAnimation(new BinaryReader(exampleAnimation()));
  ok(parsed.ok);
  const written = writeAnimation({ ...parsed.value, width: 6, height: 4, frames: parsed.value.frames.map((frame, index) => ({ ...frame, image: index === (firstEmpty ? 1 : 0) ? file : "", transparent: MAGENTA })) });
  ok(written.ok);
  return written.value;
}
function item(idle = "rest.anm"): Uint8Array {
  const parsed = readItem(new BinaryReader(exampleItem()));
  ok(parsed.ok);
  const written = writeItem({ ...parsed.value, idleAnimations: [idle, ...Array(7).fill("")], movementAnimations: ["walk.anm", ...Array(7).fill("")] });
  ok(written.ok);
  return written.value;
}
function pixel(picture: Extract<BoardPreview, { ok: true }>, x: number, y: number): number[] {
  const offset = (y * picture.width + x) * 4;
  return [...picture.rgba.subarray(offset, offset + 4)];
}
const graphic = bmp([[255, 255, 255], [255, 0, 255], red, red]);
const files = {
  "Game/Proof/Item/chest.itm": item(),
  "Game/Proof/Misc/rest.anm": animation("rest.bmp"),
  "Game/Proof/Misc/walk.anm": animation("walk.bmp"),
  "Game/Proof/Bitmap/rest.bmp": graphic,
  "Game/Proof/Bitmap/walk.bmp": bmp([blue, blue, blue, blue]),
};
const options = { showSprites: true, root: { kind: "game", projectPath: "Proof" } } as const;

test("placed sprites resolve the south-rest frame under the game root, retaining white and keyed transparency at the stored base", async () => {
  const bytes = board({ sprites: [sprite("", 16, 31), sprite("chest.itm")] });
  const host = createMemoryPlatformServices({ files });
  const picture = await previewBoard(host.fs, "memory-project", bytes, options);
  ok(picture.ok, picture.ok ? "" : picture.message);
  deepEqual(picture.objectBounds, [
    { kind: "sprites", index: 0, left: 0, top: -1, width: 32, height: 32, placeholder: true },
    { kind: "sprites", index: 1, left: 45, top: 59, width: 6, height: 4, placeholder: false },
  ]);
  deepEqual(pixel(picture, 45, 59), [255, 255, 255, 255]);
  deepEqual(pixel(picture, 48, 59), [0, 0, 0, 255]);
  deepEqual(pixel(picture, 45, 61), [...red, 255]);
  deepEqual(pixel(picture, 44, 61), [0, 0, 0, 255]);
  const ordinary = await previewBoard(host.fs, "memory-project", bytes, { root: options.root });
  ok(ordinary.ok);
  deepEqual(pixel(ordinary, 45, 61), [0, 0, 0, 255]);
  const hidden = await previewBoard(host.fs, "memory-project", bytes, { ...options, visibleLayers: [] });
  ok(hidden.ok);
  deepEqual(hidden.objectBounds, []);
  deepEqual(pixel(hidden, 45, 61), [0, 0, 0, 255]);
});

test("an empty first idle frame is a truthful placeholder, not a later frame or movement fallback", async () => {
  const host = createMemoryPlatformServices({ files: { ...files, "Game/Proof/Misc/rest.anm": animation("rest.bmp", true) } });
  const picture = await previewBoard(host.fs, "memory-project", board({ sprites: [sprite("chest.itm")] }), options);
  ok(picture.ok);
  equal(picture.objectBounds[0]?.placeholder, true);
  deepEqual(pixel(picture, 45, 61), [0, 0, 0, 255]);
  ok(picture.warnings.some((warning) => warning.includes("rest.anm")));
});

test("an item without south idle uses its first south movement frame", async () => {
  const host = createMemoryPlatformServices({ files: { ...files, "Game/Proof/Item/chest.itm": item("") } });
  const picture = await previewBoard(host.fs, "memory-project", board({ sprites: [sprite("chest.itm")] }), options);
  ok(picture.ok);
  deepEqual(pixel(picture, 45, 61), [...blue, 255]);
});

test("missing and undecodable image slots remain selectable placeholders without hiding other board art", async () => {
  const host = createMemoryPlatformServices({ files: { "Bitmap/broken.bmp": new Uint8Array([1, 2, 3]), "Bitmap/blue.bmp": bmp([blue, blue, blue, blue]) } });
  const bytes = board({ images: [image(""), image("missing.bmp", 32, 0), image("broken.bmp", 64, 0), image("blue.bmp", 64, 64)] });
  const picture = await previewBoard(host.fs, "memory-project", bytes);
  ok(picture.ok, picture.ok ? "" : picture.message);
  deepEqual(picture.objectBounds.map(({ index, placeholder }) => ({ index, placeholder })), [
    { index: 0, placeholder: true }, { index: 1, placeholder: true }, { index: 2, placeholder: true }, { index: 3, placeholder: false },
  ]);
  deepEqual(pixel(picture, 64, 64), [...blue, 255]);
  ok(picture.warnings.some((warning) => warning.includes("missing.bmp")));
  ok(picture.warnings.some((warning) => warning.includes("broken.bmp")));
});

test("stretched image bounds match the compositor's board-sized picture rather than the stored origin", async () => {
  const host = createMemoryPlatformServices({ files: { "Bitmap/blue.bmp": bmp([blue, blue, blue, blue]) } });
  const picture = await previewBoard(host.fs, "memory-project", board({ images: [{ ...image("blue.bmp", 40, 50), drawType: 2 }] }));
  ok(picture.ok);
  deepEqual(picture.objectBounds, [{ kind: "images", index: 0, left: 0, top: 0, width: 128, height: 96, placeholder: false }]);
  deepEqual(pixel(picture, 0, 0), [...blue, 255]);
  deepEqual(pixel(picture, 127, 95), [...blue, 255]);
});

test("tile-bitmap board images stay hydrated art rather than being refused as undecodable picture files", async () => {
  const empty = { tile: "", r: 0, g: 0, b: 0 };
  const written = writeTileBitmap({ magic: TILE_BITMAP_MAGIC, major: 3, minor: 0, width: 1, height: 1, cells: [{ ...empty, tile: "art.tst1" }, empty, empty, empty], residue: new Uint8Array() });
  ok(written.ok);
  const host = createMemoryPlatformServices({ files: { "Bitmap/stamp.tbm": written.value, "Tiles/art.tst": exampleTileset(1) } });
  const picture = await previewBoard(host.fs, "memory-project", board({ images: [image("stamp.tbm", 10, 12)] }));
  ok(picture.ok, picture.ok ? "" : picture.message);
  deepEqual(picture.objectBounds, [{ kind: "images", index: 0, left: 10, top: 12, width: 32, height: 32, placeholder: false }]);
  deepEqual(picture.warnings, []);
  ok(picture.rgba.some((value, index) => index % 4 !== 3 && value !== 0), "the tile bitmap contributes visible colour to the board");
});
