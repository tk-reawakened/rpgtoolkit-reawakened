import { readFileSync } from "node:fs";
import {
  BinaryReader,
  TILE_BITMAP_MAGIC,
  compositeTileBitmap,
  expandTileToRgba,
  readAnimation,
  readBoard,
  readItem,
  readTileBitmap,
  readTileset,
  tileDimensions,
  writeAnimation,
  writeBoard,
  writeItem,
  writeTileBitmap,
  type TileBitmap,
  type Engine,
} from "@tk-reawakened/core";
import { boardToScreen, buildNewBoard, clampViewport } from "@tk-reawakened/editor-model";
import type { expect as playwrightExpect, Frame, Locator, Page } from "@playwright/test";

export const CONNECTED_BOARD = "Game/Example/Boards/connected-authoring.brd";
export const CONNECTED_ITEM = "Game/Example/Item/connected-chest.itm";
export const CONNECTED_ANIMATION = "Game/Example/Misc/connected-south.anm";
export const CONNECTED_BITMAP = "Game/Example/Bitmap/connected-frame.tbm";
export const CONNECTED_TILESET = "Game/Example/Tiles/connected.tst";
export const CONNECTED_ACTIVATION_A = "Game/Example/Prg/connected-activation-a.prg";
export const CONNECTED_ACTIVATION_B = "Game/Example/Prg/connected-activation-b.prg";
export const CONNECTED_ACTIVATION_EDITED = "Game/Example/Prg/connected-activation-edited.prg";
export const CONNECTED_PARALLEL_A = "Game/Example/Prg/connected-parallel-a.prg";
export const CONNECTED_PARALLEL_B = "Game/Example/Prg/connected-parallel-b.prg";
export const CONNECTED_STARTUP = "Game/Example/Prg/start.prg";

const STARTUP_OLD = 'mwin("CONNECTED STARTUP OLD")\nwait()\n';
const STARTUP_NEW = 'mwin("CONNECTED STARTUP NEW")\nwait()\n';
const ACTIVATION_OLD = 'mwin("CONNECTED ACTIVATION OLD")\nwait()\n';
const ACTIVATION_NEW = 'mwin("CONNECTED ACTIVATION UPDATED")\nwait()\n';
const PARALLEL_OLD = 'connectedParallelRevision$ = "CONNECTED PARALLEL OLD"\n';
const PARALLEL_NEW = 'connectedParallelRevision$ = "CONNECTED PARALLEL NEW"\n';
const CHOSEN_ANIMATION_REFERENCE = "connected-chosen.anm";
const CHOSEN_ANIMATION_PATH = `Game/Example/Misc/${CHOSEN_ANIMATION_REFERENCE}`;
const ITEM_NAME = "Connected shared chest";
const TILESET_BYTES = new Uint8Array(readFileSync(new URL("../../docs/spec/examples/versions/tileset/tileset_detail1.tst", import.meta.url)));

type ProofFile = { readonly path: string; readonly bytes: Uint8Array };
type Expect = typeof playwrightExpect;

function bitmapModel(edited: boolean): TileBitmap {
  const cells = [];
  for (let x = 0; x <= 1; x += 1) for (let y = 0; y <= 1; y += 1) {
    cells.push({ tile: x === 0 && y === 0 ? `connected.tst${edited ? 2 : 1}` : "connected.tst1", r: 0, g: 0, b: 0 });
  }
  return { magic: TILE_BITMAP_MAGIC, major: 3, minor: 0, width: 1, height: 1, cells, residue: Uint8Array.of(71, 23, 91) };
}

export function connectedBitmapBytes(edited: boolean): Uint8Array {
  const written = writeTileBitmap(bitmapModel(edited));
  if (!written.ok) throw new Error(written.error.message);
  return written.value;
}

function connectedBitmapPicture(edited: boolean): { readonly width: number; readonly height: number; readonly rgba: Uint8Array } {
  const tileset = readTileset(TILESET_BYTES, "connected.tst");
  if (!tileset.ok) throw new Error(tileset.error.message);
  const dimensions = tileDimensions(tileset.value.detail);
  const tiles = new Map<string, { readonly w: number; readonly h: number; readonly rgba: Uint8Array }>();
  tileset.value.tiles.forEach((_tile, index) => {
    const expanded = expandTileToRgba(tileset.value, index);
    if (!expanded.ok) throw new Error(expanded.error.message);
    const rgba = new Uint8Array(dimensions.width * dimensions.height * 4);
    for (let x = 0; x < dimensions.width; x += 1) for (let y = 0; y < dimensions.height; y += 1) {
      const source = (x * dimensions.height + y) * 4;
      const target = (y * dimensions.width + x) * 4;
      rgba.set(expanded.value.subarray(source, source + 4), target);
    }
    tiles.set(`connected.tst${index + 1}`, { w: dimensions.width, h: dimensions.height, rgba });
  });
  const composed = compositeTileBitmap(bitmapModel(edited), tiles);
  if (!composed.ok) throw new Error(composed.error.message);
  return { width: composed.value.w, height: composed.value.h, rgba: composed.value.rgba };
}

/** Small authored files attached to the real Game/Example fixture; no asset is duplicated at the project root. */
export function connectedAuthoringProofFiles(): readonly ProofFile[] {
  const created = buildNewBoard({ name: "connected-authoring", coordSystem: "2d", pixelCoordinates: false, width: 8, height: 8, layers: 2, backgroundImage: "", template: null });
  if (!created.ok) throw new Error(created.message);
  const board = readBoard(new BinaryReader(created.bytes));
  const item = readItem(new BinaryReader(new Uint8Array(readFileSync(new URL("../../docs/spec/examples/versions/item/item_minor7.itm", import.meta.url)))));
  const animation = readAnimation(new BinaryReader(new Uint8Array(readFileSync(new URL("../../docs/spec/examples/versions/animation/animation_minor3.anm", import.meta.url)))));
  if (!board.ok || !item.ok || !animation.ok) throw new Error("The authored connected-authoring format examples could not be read");
  const condition = { initialVar: "", initialValue: "", finalVar: "", finalValue: "", activate: 0, activationType: 0 };
  const sprite = (x: number, activationPrg: string, multitaskPrg: string) => ({
    ...condition, itemFile: "connected-chest.itm", activationPrg, multitaskPrg, loadingVar: "", loadingValue: "", x, y: 95, layer: 1, reserved: -1,
  });
  const writtenBoard = writeBoard({ ...board.value, sprites: [
    sprite(48, "connected-activation-a.prg", "connected-parallel-a.prg"),
    sprite(112, "connected-activation-b.prg", "connected-parallel-b.prg"),
  ] });
  const writtenItem = writeItem({ ...item.value, name: ITEM_NAME, movementAnimations: ["connected-south.anm", ...Array(7).fill("")], idleAnimations: ["connected-south.anm", ...Array(7).fill("")] });
  const authoredAnimation = {
    ...animation.value,
    width: 32,
    height: 32,
    frames: animation.value.frames.map((frame, index) => index === 0 ? { ...frame, image: "connected-frame.tbm", transparent: { r: 255, g: 0, b: 255 } } : { ...frame, image: "" }),
  };
  const writtenAnimation = writeAnimation(authoredAnimation);
  const chosenAnimation = writeAnimation({ ...authoredAnimation, delay: 0.25 });
  if (!writtenBoard.ok || !writtenItem.ok || !writtenAnimation.ok || !chosenAnimation.ok) throw new Error("The authored connected-authoring fixtures could not be written");
  return [
    { path: CONNECTED_BOARD, bytes: writtenBoard.value },
    { path: CONNECTED_ITEM, bytes: writtenItem.value },
    { path: CONNECTED_ANIMATION, bytes: writtenAnimation.value },
    { path: CHOSEN_ANIMATION_PATH, bytes: chosenAnimation.value },
    { path: CONNECTED_BITMAP, bytes: connectedBitmapBytes(false) },
    { path: CONNECTED_TILESET, bytes: TILESET_BYTES },
    { path: CONNECTED_ACTIVATION_A, bytes: new TextEncoder().encode(ACTIVATION_OLD) },
    { path: CONNECTED_ACTIVATION_B, bytes: new TextEncoder().encode('mwin("CONNECTED ACTIVATION B")\nwait()\n') },
    { path: CONNECTED_ACTIVATION_EDITED, bytes: new TextEncoder().encode(ACTIVATION_OLD) },
    { path: CONNECTED_PARALLEL_A, bytes: new TextEncoder().encode(PARALLEL_OLD) },
    { path: CONNECTED_PARALLEL_B, bytes: new TextEncoder().encode('connectedParallelOther$ = "B"\n') },
    { path: CONNECTED_STARTUP, bytes: new TextEncoder().encode(STARTUP_OLD) },
    // Native VS Code keeps saved launches in launch.json, not the browser's Run panel (ADR 0037).
    { path: ".vscode/launch.json", bytes: new TextEncoder().encode(JSON.stringify({ version: "0.2.0", configurations: [
      { type: "tkr", request: "launch", name: "Connected board test", kind: "board", main: "Main/example.gam", projectFolder: "Game/Example", seed: 0,
        start: { board: CONNECTED_BOARD, x: 1, y: 1, layer: 1 }, party: ["Game/Example/Chrs/ada.tem"] },
      { type: "tkr", request: "launch", name: "Connected game start-up", kind: "game", main: "Main/example.gam", projectFolder: "Game/Example", seed: 0 },
    ] }, null, 2)) },
  ];
}

export interface ConnectedAuthoringProofHost {
  readonly page: Page;
  readonly launchSetupPath: string;
  read(path: string): Promise<Uint8Array>;
  openBoard(path: string): Promise<Locator>;
  openDocument(path: string): Promise<void>;
  save(): Promise<void>;
  chooseAsset(reference: string): Promise<void>;
  cancelAssetPicker(): Promise<void>;
  spriteEditor(): Promise<Locator>;
  animationEditor(): Promise<Locator>;
  bitmapEditor(): Promise<Locator>;
  returnToAnimation(): Promise<Locator>;
  returnToBoard(): Promise<Locator>;
  expectSingleSharedItemDocument(): Promise<void>;
  expectProgram(path: string, text: string): Promise<void>;
  writeProgram(path: string, text: string, before: string): Promise<void>;
  runSavedBoardSetup(): Promise<Frame>;
  runGame(): Promise<Frame>;
  revealRun(): Promise<void>;
  readRunSnapshot(frame: Frame): Promise<{ readonly kind: string; readonly manifest: string; readonly start: { readonly board: string } | null }>;
  stopRun(): Promise<void>;
  settle(): Promise<void>;
}

async function scene(frame: Frame): Promise<{ readonly tick: number; readonly board: string | null; readonly text: readonly string[]; readonly parallelRevision: string | null }> {
  return frame.locator("#screen").evaluate(() => {
    const live = Reflect.get(window, "__live") as { board: string | null } | undefined;
    const session = Reflect.get(window, "__session") as { engine: Pick<Engine, "drawList" | "debugView"> } | undefined;
    if (session === undefined) throw new Error("The actual player session has not been published");
    const debug = session.engine.debugView();
    const revision = debug.globals.find((entry) => entry.name === "connectedparallelrevision")?.value;
    const text: string[] = [];
    for (const command of session.engine.drawList(0, { shading: true, images: true, sprites: true }).commands) {
      if (command.kind === "text") text.push(command.text);
    }
    return {
      tick: debug.tick,
      board: live?.board ?? null,
      text,
      parallelRevision: typeof revision === "string" ? revision : null,
    };
  });
}

async function expectBitmapPixels(editor: Locator, expect: Expect, edited: boolean): Promise<void> {
  const wanted = connectedBitmapPicture(edited);
  const canvas = editor.locator("canvas.tkr-bitmap-canvas");
  await expect.poll(() => canvas.evaluate((element) => ({
    width: (element as HTMLCanvasElement).width,
    height: (element as HTMLCanvasElement).height,
  }))).toEqual({ width: wanted.width, height: wanted.height });
  await expect.poll(async () => canvas.evaluate((element) => {
    const surface = element as HTMLCanvasElement;
    const pixels = surface.getContext("2d")!.getImageData(0, 0, surface.width, surface.height);
    return { width: surface.width, height: surface.height, rgba: Array.from(pixels.data) };
  })).toEqual({ width: wanted.width, height: wanted.height, rgba: Array.from(wanted.rgba) });
}

function artworkProbe(): { readonly width: number; readonly height: number; readonly x: number; readonly y: number; readonly before: readonly number[]; readonly after: readonly number[] } {
  const before = connectedBitmapPicture(false);
  const after = connectedBitmapPicture(true);
  const keyed = (colour: readonly number[]) => colour[0] === 255 && colour[1] === 0 && colour[2] === 255;
  for (let y = 4; y <= 12; y += 1) for (let x = 8; x <= 23; x += 1) {
    const at = (y * before.width + x) * 4;
    const a = [...before.rgba.subarray(at, at + 4)], b = [...after.rgba.subarray(at, at + 4)];
    if (a[3] === 255 && b[3] === 255 && !keyed(a) && !keyed(b) && a.some((value, index) => value !== b[index])) return { width: before.width, height: before.height, x, y, before: a, after: b };
  }
  throw new Error("The authored artwork needs a distinct opaque before/after probe away from selection outlines");
}

async function expectDefinitionArtwork(editor: Locator, expect: Expect, edited: boolean): Promise<void> {
  const probe = artworkProbe();
  const canvas = editor.getByRole("group", { name: "Directional walk animations", exact: true }).locator("canvas");
  await expect.poll(() => canvas.evaluate((element, point) => {
    const surface = element as HTMLCanvasElement;
    return [...surface.getContext("2d")!.getImageData(point.x, point.y, 1, 1).data];
  }, probe), { timeout: 15_000 }).toEqual(edited ? probe.after : probe.before);
}

async function expectAnimationArtwork(editor: Locator, expect: Expect, edited: boolean): Promise<void> {
  const probe = artworkProbe();
  const canvas = editor.getByRole("img", { name: "Animation frame 1 preview", exact: true });
  await expect.poll(() => canvas.evaluate((element, point) => {
    const surface = element as HTMLCanvasElement;
    return [...surface.getContext("2d")!.getImageData(point.x, point.y, 1, 1).data];
  }, probe), { timeout: 15_000 }).toEqual(edited ? probe.after : probe.before);
}

async function expectBoardArtwork(editor: Locator, expect: Expect, edited: boolean): Promise<void> {
  const probe = artworkProbe();
  const canvas = editor.locator("canvas.tkr-board-canvas");
  for (const baseX of [48, 112]) {
    await expect.poll(async () => {
      const dimensions = await canvas.evaluate((element) => ({ width: (element as HTMLCanvasElement).width, height: (element as HTMLCanvasElement).height }));
      const viewport = clampViewport({ sizeX: 8, sizeY: 8, coordType: 0 }, { x: 0, y: 0, zoomIndex: 2, ...dimensions });
      const point = boardToScreen(viewport, baseX - probe.width / 2 + probe.x, 95 - probe.height + probe.y);
      return canvas.evaluate((element, point) => {
        const surface = element as HTMLCanvasElement;
        return [...surface.getContext("2d")!.getImageData(Math.floor(point.x), Math.floor(point.y), 1, 1).data];
      }, point);
    }, { timeout: 15_000 }).toEqual(edited ? probe.after : probe.before);
  }
}

/** The same creator journey through the actual browser and packaged VS Code hosts. */
export async function runConnectedAuthoringProof(host: ConnectedAuthoringProofHost, expect: Expect): Promise<void> {
  let board = await host.openBoard(CONNECTED_BOARD);
  const inspector = () => board.locator('.tkr-board-objects[aria-label="Sprite inspector"]:visible');
  const selectSlot = async (slot: number | null) => {
    await inspector().getByLabel("Stored slot", { exact: true }).selectOption(slot === null ? "" : String(slot));
    await host.settle();
  };
  await board.locator('[data-board-mode="sprites"]').click();
  await host.settle();
  const sourceBefore = await host.read(CONNECTED_ITEM);
  const boardBefore = await host.read(CONNECTED_BOARD);
  await selectSlot(null);
  await expectBoardArtwork(board, expect, false);
  await selectSlot(0);
  await expect(inspector().getByLabel("Activation program override", { exact: true })).toHaveValue("connected-activation-a.prg");
  await expect(inspector().getByLabel("Multitask program override", { exact: true })).toHaveValue("connected-parallel-a.prg");
  await inspector().getByRole("button", { name: "Choose activation program", exact: true }).click();
  await host.cancelAssetPicker();
  await expect(inspector().getByLabel("Activation program override", { exact: true })).toHaveValue("connected-activation-a.prg");
  expect(await host.read(CONNECTED_BOARD)).toEqual(boardBefore);
  await inspector().getByRole("button", { name: "Choose activation program", exact: true }).click();
  await host.chooseAsset("connected-activation-edited.prg");
  await expect(inspector().getByLabel("Activation program override", { exact: true })).toHaveValue("connected-activation-edited.prg");
  await inspector().getByRole("button", { name: "Apply", exact: true }).click();
  await host.settle();
  await inspector().getByRole("button", { name: "Open activation program", exact: true }).click();
  await host.expectProgram(CONNECTED_ACTIVATION_EDITED, "CONNECTED ACTIVATION OLD");
  await host.writeProgram(CONNECTED_ACTIVATION_EDITED, ACTIVATION_NEW, ACTIVATION_OLD);
  await expect.poll(() => host.read(CONNECTED_ACTIVATION_EDITED)).toEqual(new TextEncoder().encode(ACTIVATION_NEW));
  expect(await host.read(CONNECTED_ACTIVATION_A)).toEqual(new TextEncoder().encode(ACTIVATION_OLD));
  board = await host.returnToBoard();
  await expect(inspector().getByLabel("Stored slot", { exact: true })).toHaveValue("0");
  await inspector().getByRole("button", { name: "Open item", exact: true }).click();
  const sprite = await host.spriteEditor();
  await expect(sprite.getByRole("group", { name: "Directional walk animations" }).getByLabel("South animation file", { exact: true })).toHaveValue("connected-south.anm");
  await expectDefinitionArtwork(sprite, expect, false);
  await sprite.getByRole("button", { name: "Choose South walking animation", exact: true }).click();
  await host.chooseAsset(CHOSEN_ANIMATION_REFERENCE);
  await expect(sprite.getByRole("group", { name: "Directional walk animations" }).getByLabel("South animation file", { exact: true })).toHaveValue(CHOSEN_ANIMATION_REFERENCE);
  const originalDefinition = readItem(new BinaryReader(sourceBefore));
  if (!originalDefinition.ok) throw new Error(originalDefinition.error.message);
  const originalWalks = originalDefinition.value.movementAnimations;
  if (originalWalks === undefined) throw new Error("The item example must contain directional walking animations");
  const savedDefinition = writeItem({ ...originalDefinition.value, movementAnimations: [CHOSEN_ANIMATION_REFERENCE, ...originalWalks.slice(1)] });
  if (!savedDefinition.ok) throw new Error(savedDefinition.error.message);
  expect(await host.read(CONNECTED_ITEM)).toEqual(sourceBefore);
  await host.save();
  await expect.poll(() => host.read(CONNECTED_ITEM)).toEqual(savedDefinition.value);
  await sprite.getByRole("button", { name: "Open South walking animation", exact: true }).click();
  const animation = await host.animationEditor();
  await expect(animation.getByRole("spinbutton", { name: "Global delay (seconds)", exact: true })).toHaveValue("0.25");
  await expect(animation.getByRole("img", { name: "Animation frame 1 preview", exact: true })).toBeVisible();
  await expectAnimationArtwork(animation, expect, false);
  await animation.getByRole("button", { name: "Open frame image", exact: true }).click();
  const bitmap = await host.bitmapEditor();
  await expectBitmapPixels(bitmap, expect, false);
  await bitmap.locator(".tkr-tileset-browser select").selectOption("Game/Example/Tiles/connected.tst");
  await bitmap.locator('[data-browser-reference="connected.tst2"] .tkr-tileset-browser-source').click();
  await bitmap.getByRole("button", { name: "Draw", exact: true }).click();
  await bitmap.getByRole("button", { name: /^Column 1, row 1:/ }).click();
  await expectBitmapPixels(bitmap, expect, true);
  await host.save();
  await expect.poll(() => host.read(CONNECTED_BITMAP)).toEqual(connectedBitmapBytes(true));
  const decoded = readTileBitmap(new BinaryReader(await host.read(CONNECTED_BITMAP)));
  if (!decoded.ok) throw new Error(decoded.error.message);
  expect(decoded.value.cells[0]?.tile).toBe("connected.tst2");
  await expectAnimationArtwork(await host.returnToAnimation(), expect, true);
  board = await host.returnToBoard();
  await expect(inspector().getByLabel("Stored slot", { exact: true })).toHaveValue("0");
  await host.openDocument(CHOSEN_ANIMATION_PATH);
  await expectAnimationArtwork(await host.animationEditor(), expect, true);
  board = await host.openBoard(CONNECTED_BOARD);
  await expect(inspector().getByLabel("Stored slot", { exact: true })).toHaveValue("0");
  await selectSlot(null);
  await expectBoardArtwork(board, expect, true);
  await selectSlot(1);
  await expect(inspector().getByLabel("Activation program override", { exact: true })).toHaveValue("connected-activation-b.prg");
  await expect(inspector().getByLabel("Multitask program override", { exact: true })).toHaveValue("connected-parallel-b.prg");
  await inspector().getByRole("button", { name: "Open item", exact: true }).click();
  const secondSprite = await host.spriteEditor();
  await expect(secondSprite.getByRole("group", { name: "Directional walk animations" }).getByLabel("South animation file", { exact: true })).toHaveValue(CHOSEN_ANIMATION_REFERENCE);
  await expectDefinitionArtwork(secondSprite, expect, true);
  await host.expectSingleSharedItemDocument();
  expect(await host.read(CONNECTED_ITEM)).toEqual(savedDefinition.value);
  board = await host.returnToBoard();
  await expect(inspector().getByLabel("Stored slot", { exact: true })).toHaveValue("1");
  await selectSlot(0);
  await inspector().getByRole("button", { name: "Open parallel program", exact: true }).click();
  await host.expectProgram(CONNECTED_PARALLEL_A, "CONNECTED PARALLEL OLD");
  board = await host.returnToBoard();
  await expect(inspector().getByLabel("Stored slot", { exact: true })).toHaveValue("0");
  await host.save();
  const savedBoard = readBoard(new BinaryReader(await host.read(CONNECTED_BOARD)));
  if (!savedBoard.ok) throw new Error(savedBoard.error.message);
  expect(savedBoard.value.sprites.map((sprite) => ({
    item: sprite.itemFile,
    activation: sprite.activationPrg,
    parallel: sprite.multitaskPrg,
  }))).toEqual([
    { item: "connected-chest.itm", activation: "connected-activation-edited.prg", parallel: "connected-parallel-a.prg" },
    { item: "connected-chest.itm", activation: "connected-activation-b.prg", parallel: "connected-parallel-b.prg" },
  ]);

  const boardRun = await host.runSavedBoardSetup();
  await expect.poll(async () => (await scene(boardRun)).board ?? "", { timeout: 30_000 }).toContain("connected-authoring.brd");
  const boardSnapshot = await host.readRunSnapshot(boardRun);
  expect(boardSnapshot.kind).toBe("board");
  expect(boardSnapshot.start?.board).toBe(CONNECTED_BOARD);
  expect(boardSnapshot.manifest).toMatch(/^[a-f0-9]{64}$/);
  const launchSetups = JSON.parse(new TextDecoder().decode(await host.read(host.launchSetupPath))) as {
    readonly configurations: readonly { readonly name: string; readonly kind: string; readonly start?: { readonly board: string; readonly x: number; readonly y: number; readonly layer: number }; readonly party?: readonly string[] }[];
  };
  expect(launchSetups.configurations.find((entry) => entry.name === "Connected board test")).toMatchObject({
    kind: "board",
    start: { board: CONNECTED_BOARD, x: 1, y: 1, layer: 1 },
    party: ["Game/Example/Chrs/ada.tem"],
  });
  await expect.poll(async () => (await scene(boardRun)).parallelRevision, { timeout: 30_000 }).toBe("CONNECTED PARALLEL OLD");
  expect((await scene(boardRun)).text.join(" ")).not.toContain("CONNECTED STARTUP OLD");
  await host.writeProgram(CONNECTED_PARALLEL_A, PARALLEL_NEW, PARALLEL_OLD);
  await expect.poll(() => host.read(CONNECTED_PARALLEL_A)).toEqual(new TextEncoder().encode(PARALLEL_NEW));
  const boardTickAfterSave = (await scene(boardRun)).tick;
  await host.revealRun();
  await expect.poll(async () => (await scene(boardRun)).tick).toBeGreaterThan(boardTickAfterSave + 1);
  expect((await host.readRunSnapshot(boardRun)).manifest).toBe(boardSnapshot.manifest);
  expect((await scene(boardRun)).parallelRevision).toBe("CONNECTED PARALLEL OLD");
  await host.stopRun();

  const freshBoardRun = await host.runSavedBoardSetup();
  await expect.poll(async () => (await scene(freshBoardRun)).parallelRevision, { timeout: 30_000 }).toBe("CONNECTED PARALLEL NEW");
  expect((await host.readRunSnapshot(freshBoardRun)).manifest).not.toBe(boardSnapshot.manifest);
  await host.stopRun();

  const oldRun = await host.runGame();
  await expect.poll(async () => (await scene(oldRun)).text.join(" "), { timeout: 30_000 }).toContain("CONNECTED STARTUP OLD");
  const oldSnapshot = await host.readRunSnapshot(oldRun);
  expect(oldSnapshot.kind).toBe("game");
  expect(oldSnapshot.manifest).toMatch(/^[a-f0-9]{64}$/);
  await host.writeProgram(CONNECTED_STARTUP, STARTUP_NEW, STARTUP_OLD);
  await expect.poll(() => host.read(CONNECTED_STARTUP)).toEqual(new TextEncoder().encode(STARTUP_NEW));
  const gameTickAfterSave = (await scene(oldRun)).tick;
  await host.revealRun();
  await expect.poll(async () => (await scene(oldRun)).tick).toBeGreaterThan(gameTickAfterSave + 1);
  expect((await host.readRunSnapshot(oldRun)).manifest).toBe(oldSnapshot.manifest);
  expect((await scene(oldRun)).text.join(" ")).toContain("CONNECTED STARTUP OLD");
  expect((await scene(oldRun)).text.join(" ")).not.toContain("CONNECTED STARTUP NEW");
  await host.stopRun();

  const newRun = await host.runGame();
  await expect.poll(async () => (await scene(newRun)).text.join(" "), { timeout: 30_000 }).toContain("CONNECTED STARTUP NEW");
  const newSnapshot = await host.readRunSnapshot(newRun);
  expect(newSnapshot.kind).toBe("game");
  expect(newSnapshot.manifest).not.toBe(oldSnapshot.manifest);
  await host.stopRun();
}
