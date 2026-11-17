import { readFileSync } from "node:fs";
import { BinaryReader, readAnimation, readBoard, readItem, writeAnimation, writeBoard, writeItem } from "@tk-reawakened/core";
import { boardToScreen, buildNewBoard, clampViewport } from "@tk-reawakened/editor-model";
import type { expect as playwrightExpect, Locator, Page } from "@playwright/test";

export const OBJECTS_BOARD = "Game/Example/Boards/objects-proof.brd";
export const OBJECTS_PROGRAM = "Game/Example/Prg/objects-link.prg";
export const OBJECTS_ITEM = "Game/Example/Item/objects-chest.itm";
export const OBJECTS_ITEM_NAME = "Object proof item";
const RED = [200, 10, 20] as const;

/** Small authored fixtures; no game or legacy source is copied. */
export function boardObjectsProofFiles(): readonly { readonly path: string; readonly bytes: Uint8Array }[] {
  const built = buildNewBoard({ name: "objects-proof", coordSystem: "2d", pixelCoordinates: false, width: 8, height: 8, layers: 2, backgroundImage: "", template: null });
  if (!built.ok) throw new Error(built.message);
  const parsed = readBoard(new BinaryReader(built.bytes));
  const item = readItem(new BinaryReader(new Uint8Array(readFileSync(new URL("../../docs/spec/examples/versions/item/item_minor7.itm", import.meta.url)))));
  const animation = readAnimation(new BinaryReader(new Uint8Array(readFileSync(new URL("../../docs/spec/examples/versions/animation/animation_minor3.anm", import.meta.url)))));
  if (!parsed.ok || !item.ok || !animation.ok) throw new Error("The authored format examples could not be read");
  const points = [{ x: 64, y: 64 }, { x: 128, y: 64 }, { x: 128, y: 128 }, { x: 64, y: 128 }];
  const condition = { initialVar: "", initialValue: "", finalVar: "", finalValue: "", activate: 0, activationType: 0 };
  const vector = { points, attributes: 8, closed: -1, layer: 1, type: 1, handle: "object-vector" };
  const program = { ...condition, program: "objects-link.prg", graphic: "reserved-graphic", repeatDistance: 0, layer: 1, points, closed: -1, handle: "object-program" };
  const sprite = { ...condition, itemFile: "objects-chest.itm", activationPrg: "", multitaskPrg: "", loadingVar: "", loadingValue: "", x: 176, y: 191, layer: 1, reserved: -1 };
  const image = { file: "objects.bmp", left: 32, top: 160, layer: 1, drawType: 0, transparent: { r: 255, g: 0, b: 255 }, reserved: 75 };
  const board = writeBoard({ ...parsed.value,
    vectors: [{ ...vector, points: [], type: 4, closed: 1, handle: "unused legacy slot" }, vector],
    programs: [{ ...program, program: "", points: [] }, program],
    sprites: [{ ...sprite, itemFile: "", x: 16, y: 31 }, sprite],
    images: [{ ...image, file: "", left: 0, top: 0 }, image], residue: new Uint8Array([231, 19, 87]),
  });
  const writtenItem = writeItem({ ...item.value, name: OBJECTS_ITEM_NAME, idleAnimations: ["objects-rest.anm", ...Array(7).fill("")] });
  const writtenAnimation = writeAnimation({ ...animation.value, width: 96, height: 32, frames: animation.value.frames.map((frame, index) => ({ ...frame, image: index === 0 ? "objects.bmp" : "", transparent: image.transparent })) });
  if (!board.ok || !writtenItem.ok || !writtenAnimation.ok) throw new Error("The authored object fixtures could not be written");
  const pixels = new Uint8Array(32 * 32 * 3);
  for (let at = 0; at < pixels.length; at += 3) pixels.set([RED[2], RED[1], RED[0]], at);
  const picture = new Uint8Array(54 + pixels.length);
  const header = new DataView(picture.buffer);
  picture.set([0x42, 0x4d]); header.setUint32(2, picture.length, true); header.setUint32(10, 54, true); header.setUint32(14, 40, true);
  header.setInt32(18, 32, true); header.setInt32(22, 32, true); header.setUint16(26, 1, true); header.setUint16(28, 24, true); header.setUint32(34, pixels.length, true);
  picture.set(pixels, 54);
  return [
    { path: OBJECTS_BOARD, bytes: board.value }, { path: OBJECTS_ITEM, bytes: writtenItem.value },
    { path: "Game/Example/Misc/objects-rest.anm", bytes: writtenAnimation.value },
    { path: "Game/Example/Bitmap/objects.bmp", bytes: picture },
    { path: OBJECTS_PROGRAM, bytes: new TextEncoder().encode('// OBJECT REGION SOURCE\nend()\n') },
  ];
}

export interface BoardObjectsProofHost {
  readonly page: Page;
  openBoard(path: string): Promise<Locator>;
  reopenBoard(path: string): Promise<Locator>;
  save(editor: Locator): Promise<void>;
  undo(editor: Locator): Promise<void>;
  redo(editor: Locator): Promise<void>;
  read(path: string): Promise<Uint8Array>;
  expectProgram(path: string, text: string): Promise<void>;
  expectItem(path: string, name: string): Promise<void>;
  returnToBoard(): Promise<Locator>;
  settle(): Promise<void>;
}

/** Identical creator actions exercise the browser and packaged native custom editor. */
export async function runBoardObjectsProof(host: BoardObjectsProofHost, expect: typeof playwrightExpect): Promise<void> {
  let editor = await host.openBoard(OBJECTS_BOARD);
  const decode = async () => {
    const parsed = readBoard(new BinaryReader(await host.read(OBJECTS_BOARD)));
    if (!parsed.ok) throw new Error(parsed.error.message);
    return parsed.value;
  };
  const before = await decode();
  const definitionBefore = await host.read(OBJECTS_ITEM);
  const inspector = () => editor.locator(".tkr-board-objects:visible");
  const mode = async (value: string) => {
    await editor.locator(`[data-board-mode="${value}"]`).click();
    await host.settle();
  };
  const slot = async (value: number) => { await inspector().getByLabel("Stored slot", { exact: true }).selectOption(String(value)); await host.settle(); };
  const apply = async () => { await inspector().getByRole("button", { name: "Apply", exact: true }).click(); await host.settle(); };
  const canvas = () => editor.locator("canvas.tkr-board-canvas");
  const canvasCoordinates = async () => {
    const surface = canvas(); await surface.scrollIntoViewIfNeeded();
    const dimensions = await surface.evaluate((element) => ({ width: (element as HTMLCanvasElement).width, height: (element as HTMLCanvasElement).height }));
    const viewport = clampViewport({ sizeX: 8, sizeY: 8, coordType: 0 }, { x: 0, y: 0, zoomIndex: 2, ...dimensions });
    const bounds = await surface.boundingBox(); if (bounds === null) throw new Error("The board canvas is not visible");
    return (x: number, y: number) => { const point = boardToScreen(viewport, x, y); return { x: bounds.x + point.x, y: bounds.y + point.y }; };
  };
  await expect.poll(async () => canvas().evaluate((element) => {
    const surface = element as HTMLCanvasElement;
    const rgba = surface.getContext("2d")!.getImageData(0, 0, surface.width, surface.height).data;
    for (let at = 0; at < rgba.length; at += 4) if (rgba[at] === 200 && rgba[at + 1] === 10 && rgba[at + 2] === 20 && rgba[at + 3] === 255) return true;
    return false;
  }), { timeout: 15_000 }).toBe(true);

  await mode("vectors"); await slot(1);
  await inspector().getByLabel("Handle", { exact: true }).fill("pending vector handle");
  await mode("tiles"); await mode("vectors");
  await inspector().getByRole("button", { name: "Return to draft", exact: true }).click();
  await expect(inspector().getByLabel("Handle", { exact: true })).toHaveValue("pending vector handle");
  await inspector().getByLabel("Point 1 X", { exact: true }).fill("72"); await apply();
  await host.undo(editor); await host.settle();
  await expect(inspector().getByLabel("Handle", { exact: true })).toHaveValue("object-vector");
  await host.redo(editor); await host.settle();
  await expect(inspector().getByLabel("Handle", { exact: true })).toHaveValue("pending vector handle");
  await host.save(editor);
  await expect.poll(async () => (await decode()).vectors[1]?.points[0]?.x).toBe(72);

  const saved = await host.read(OBJECTS_BOARD);
  await inspector().getByRole("button", { name: "Remove slot and renumber", exact: true }).click();
  const dialog = editor.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(inspector().getByLabel("Stored slot", { exact: true })).toHaveValue("1");
  expect(await host.read(OBJECTS_BOARD)).toEqual(saved);

  await mode("programs"); await slot(1);
  await inspector().getByLabel("Repeat distance (pixels)", { exact: true }).fill("24"); await apply();
  await inspector().getByRole("button", { name: "Open program", exact: true }).click();
  await host.expectProgram(OBJECTS_PROGRAM, "OBJECT REGION SOURCE"); editor = await host.returnToBoard();
  await expect(editor.locator('[data-board-mode="programs"]')).toHaveAttribute("aria-pressed", "true");
  await expect(inspector().getByLabel("Stored slot", { exact: true })).toHaveValue("1");
  await mode("sprites");
  await editor.locator('[data-tool="select"]').click();
  await inspector().getByLabel("Stored slot", { exact: true }).selectOption("");
  // The 96px frame extends beyond the generic 32px fallback and its 16px pick tolerance.
  // Picking its visible left edge proves real host bounds and raw slot identity survive the bridge.
  const spritePoint = (await canvasCoordinates())(132, 176);
  await host.page.mouse.click(spritePoint.x, spritePoint.y); await host.settle();
  await expect(inspector().getByLabel("Stored slot", { exact: true })).toHaveValue("1");
  await inspector().getByLabel("Activation program override", { exact: true }).fill("objects-link.prg"); await apply();
  await inspector().getByRole("button", { name: "Open item", exact: true }).click();
  await host.expectItem(OBJECTS_ITEM, OBJECTS_ITEM_NAME); editor = await host.returnToBoard();
  await expect(editor.locator('[data-board-mode="sprites"]')).toHaveAttribute("aria-pressed", "true");
  await expect(inspector().getByLabel("Stored slot", { exact: true })).toHaveValue("1");
  await mode("images"); await slot(1);
  await inspector().getByRole("button", { name: "Pick colour from canvas", exact: true }).click();
  const colourPoint = (await canvasCoordinates())(176, 176);
  await host.page.mouse.click(colourPoint.x, colourPoint.y); await host.settle();
  await expect(inspector().getByLabel("Stored slot", { exact: true })).toHaveValue("1");
  await expect(inspector().getByLabel("R", { exact: true })).toHaveValue("200");
  await expect(inspector().getByLabel("G", { exact: true })).toHaveValue("10");
  await expect(inspector().getByLabel("B", { exact: true })).toHaveValue("20");
  await inspector().getByLabel("Left (pixels)", { exact: true }).fill("48");
  await inspector().getByLabel("R", { exact: true }).fill("17"); await apply();
  await host.undo(editor); await host.settle(); await host.save(editor);
  await expect.poll(async () => (await decode()).images[1]).toEqual(before.images[1]);
  await host.redo(editor); await host.settle(); await host.save(editor);
  await expect.poll(async () => (await decode()).images[1]?.left).toBe(48);
  let result = await decode();
  expect(result.programs[1]?.repeatDistance).toBe(24);
  expect(result.sprites[1]?.activationPrg).toBe("objects-link.prg");
  expect(result.images[1]?.transparent.r).toBe(17);
  expect(result.vectors[0]).toEqual(before.vectors[0]); expect(result.programs[0]).toEqual(before.programs[0]);
  expect(result.sprites[0]).toEqual(before.sprites[0]); expect(result.images[0]).toEqual(before.images[0]);
  expect(result.residue).toEqual(before.residue);
  editor = await host.reopenBoard(OBJECTS_BOARD);
  await mode("images"); await slot(1);
  await expect(inspector().getByLabel("Left (pixels)", { exact: true })).toHaveValue("48");
  await inspector().getByLabel("Image file", { exact: true }).fill(""); await apply(); await host.save(editor);
  await expect.poll(async () => (await decode()).images[1]?.file).toBe("");
  result = await decode(); expect(result.images).toHaveLength(2); expect(result.images[1]?.reserved).toBe(75);

  await mode("vectors");
  await editor.locator('[data-tool="rectangle"]').click();
  const coordinates = await canvasCoordinates();
  const from = coordinates(32, 32), to = coordinates(96, 64);
  await host.page.mouse.move(from.x, from.y); await host.page.mouse.down();
  await host.page.mouse.move(to.x, to.y, { steps: 4 }); await host.page.mouse.up(); await host.settle();
  await host.save(editor);
  await expect.poll(async () => (await decode()).vectors.length).toBe(3);
  expect((await decode()).vectors[2]?.points).toEqual([{ x: 32, y: 32 }, { x: 96, y: 32 }, { x: 96, y: 64 }, { x: 32, y: 64 }]);

  await mode("programs");
  await inspector().getByRole("button", { name: "Add program", exact: true }).click(); await host.settle();
  await inspector().getByLabel("Inline RPGCode", { exact: true }).fill("end()"); await apply();
  await mode("sprites");
  await inspector().getByRole("button", { name: "Add sprite", exact: true }).click(); await host.settle();
  await inspector().getByLabel("Item definition", { exact: true }).fill("objects-chest.itm"); await apply();
  await mode("images");
  await inspector().getByRole("button", { name: "Add image", exact: true }).click(); await host.settle();
  await inspector().getByLabel("Image file", { exact: true }).fill("objects.bmp");
  await inspector().getByLabel("Left (pixels)", { exact: true }).fill("96");
  await inspector().getByLabel("Top (pixels)", { exact: true }).fill("192"); await apply(); await host.save(editor);
  await expect.poll(async () => (await decode()).images[2]?.top).toBe(192);
  result = await decode();
  expect(result.programs[2]?.program).toBe("end()");
  expect(result.sprites[2]?.itemFile).toBe("objects-chest.itm");
  expect(result.images[2]?.file).toBe("objects.bmp"); expect(result.images[2]?.left).toBe(96);
  expect(result.vectors[0]).toEqual(before.vectors[0]); expect(result.programs[0]).toEqual(before.programs[0]);
  expect(result.sprites[0]).toEqual(before.sprites[0]); expect(result.images[0]).toEqual(before.images[0]);
  expect(result.residue).toEqual(before.residue);
  expect(await host.read(OBJECTS_ITEM)).toEqual(definitionBefore);
  editor = await host.reopenBoard(OBJECTS_BOARD);
  await mode("sprites"); await slot(2);
  await expect(inspector().getByLabel("Item definition", { exact: true })).toHaveValue("objects-chest.itm");
  await mode("programs"); await slot(2);
  await expect(inspector().getByLabel("Inline RPGCode", { exact: true })).toHaveValue("end()");
}
