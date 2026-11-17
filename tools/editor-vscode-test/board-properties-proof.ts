import { BinaryReader, readBoard, readMainFile, writeBoard } from "@tk-reawakened/core";
import { boardToScreen, buildNewBoard, cellCentre, clampViewport } from "@tk-reawakened/editor-model";
import type { expect as playwrightExpect, Locator } from "@playwright/test";

export const PROPERTIES_BOARD = "Game/Example/Boards/properties-origin.brd";
export const PROPERTIES_NEIGHBOR = "Game/Example/Boards/properties-neighbor.brd";
export const PROPERTIES_PROGRAM = "Game/Example/Prg/properties-link.prg";
export const PROPERTIES_THREAD = "Game/Example/Prg/properties-thread.prg";

/** Authored from board.md: two layers, deliberate unused slots and trailing bytes. No fetched game is copied. */
export function boardPropertiesProofFiles(): readonly { readonly path: string; readonly bytes: Uint8Array }[] {
  const built = buildNewBoard({ name: "properties-origin", coordSystem: "2d", pixelCoordinates: false, width: 8, height: 8, layers: 2, backgroundImage: "", template: null });
  if (!built.ok) throw new Error(built.message);
  const read = readBoard(new BinaryReader(built.bytes));
  if (!read.ok) throw new Error(read.error.message);
  const board = {
    ...read.value,
    constants: ["keep first", "", "keep third"],
    threads: ["properties-thread.prg", ""],
    layerTitles: ["unused zero", "Ground", "Canopy"],
    properties: { ...read.value.properties, battleSkill: 7, start: { x: 48, y: 63, layer: 1 } },
    residue: new Uint8Array([231, 19, 87]),
  };
  const written = writeBoard(board);
  if (!written.ok) throw new Error(written.error.message);
  return [
    { path: PROPERTIES_BOARD, bytes: written.value },
    { path: PROPERTIES_NEIGHBOR, bytes: built.bytes },
    { path: PROPERTIES_PROGRAM, bytes: new TextEncoder().encode('// linked board program proof\nmessage = "LINKED PROGRAM"\nend()\n') },
    { path: PROPERTIES_THREAD, bytes: new TextEncoder().encode('// board thread proof\nmessage = "BOARD THREAD"\nend()\n') },
  ];
}

export interface BoardPropertiesProofHost {
  openBoard(path: string): Promise<Locator>;
  reopenBoard(path: string): Promise<Locator>;
  closeBoard(path: string): Promise<void>;
  save(editor: Locator): Promise<void>;
  read(path: string): Promise<Uint8Array>;
  expectBoard(path: string): Promise<void>;
  expectProgram(path: string, text: string): Promise<void>;
  returnToBoard(): Promise<Locator>;
  setInitial(editor: Locator, accept: boolean): Promise<void>;
  saveMain(): Promise<void>;
  settle(): Promise<void>;
  readonly main: string;
}

/** The same ordinary creator actions and byte assertions run through both actual hosts. */
export async function runBoardPropertiesProof(host: BoardPropertiesProofHost, expect: typeof playwrightExpect): Promise<void> {
  const decode = async () => {
    const read = readBoard(new BinaryReader(await host.read(PROPERTIES_BOARD)));
    if (!read.ok) throw new Error(read.error.message);
    return read.value;
  };
  const main = async () => {
    const read = readMainFile(new BinaryReader(await host.read(host.main)));
    if (!read.ok) throw new Error(read.error.message);
    return read.value;
  };
  const before = await decode();
  const mainBefore = await host.read(host.main);
  const originalMain = await main();
  let editor = await host.openBoard(PROPERTIES_BOARD);
  const properties = () => editor.locator(".tkr-board-properties");
  const reveal = async () => {
    if (!await properties().getByLabel("North link", { exact: true }).isVisible()) {
      await properties().locator("summary").click();
    }
    await expect(properties().getByLabel("North link", { exact: true })).toBeVisible();
  };
  await reveal();
  for (const [label, value] of [
    ["North link", "properties-neighbor.brd"], ["South link", "properties-link.prg"],
    ["East link", "properties-neighbor.brd"], ["West link", "properties-link.prg"],
    ["Background music", "proof.mid"], ["Enter program", "properties-link.prg"],
    ["Background image", "missing-proof.png"], ["Background image mode", "1"],
    ["Background colour Red", "12"], ["Background colour Green", "34"], ["Background colour Blue", "56"],
    ["Ambient RGB Red", "-12"], ["Ambient RGB Green", "34"], ["Ambient RGB Blue", "-56"],
    ["Battle background", "proof.bkg"], ["Battle skill", "9"],
  ] as const) await properties().getByLabel(label, { exact: true }).fill(value);
  await properties().getByLabel("Board threads", { exact: true }).fill("properties-thread.prg\n\nproperties-link.prg");
  await properties().getByLabel("Board constants", { exact: true }).fill("keep first\n\nchanged third");
  await properties().getByLabel("Layer titles", { exact: true }).fill("unused zero\nGround edited\nCanopy");
  await properties().getByRole("checkbox", { name: "Random battles enabled", exact: true }).check();
  await properties().getByRole("checkbox", { name: "Disable saving", exact: true }).check();
  // Apply via keyboard, then save immediately: bridge acknowledgements must precede persistence.
  const apply = properties().getByRole("button", { name: "Apply", exact: true });
  await apply.focus();
  await apply.press("Enter");
  await host.save(editor);
  await expect.poll(async () => (await decode()).links).toEqual({ north: "properties-neighbor.brd", south: "properties-link.prg", east: "properties-neighbor.brd", west: "properties-link.prg" });
  const saved = await decode();
  expect(saved.properties.backgroundMusic).toBe("proof.mid");
  expect(saved.properties.enterPrg).toBe("properties-link.prg");
  expect(saved.threads).toEqual(["properties-thread.prg", "", "properties-link.prg"]);
  expect(saved.constants).toEqual(["keep first", "", "changed third"]);
  expect(saved.layerTitles).toEqual(["unused zero", "Ground edited", "Canopy"]);
  expect(saved.properties).toEqual({
    ...before.properties,
    backgroundImage: "missing-proof.png", backgroundDrawType: 1,
    backgroundColour: { r: 12, g: 34, b: 56 },
    backgroundMusic: "proof.mid", enterPrg: "properties-link.prg",
    ambient: { r: -12, g: 34, b: -56 }, battleBackground: "proof.bkg",
    battleSkill: 9, allowBattles: 1, disableSaving: 1,
  });
  expect(saved.tileMatrix).toEqual(before.tileMatrix);
  expect(saved.residue).toEqual(before.residue);
  expect(saved.minor).toBe(before.minor);
  expect(await host.read(host.main)).toEqual(mainBefore);
  editor = await host.reopenBoard(PROPERTIES_BOARD);
  await reveal();
  await expect(properties().getByLabel("North link", { exact: true })).toHaveValue("properties-neighbor.brd");
  await expect(properties().getByLabel("Background music", { exact: true })).toHaveValue("proof.mid");
  await expect(editor.getByLabel("Layer", { exact: true }).locator('option[value="0"]')).toHaveText("1 – Ground edited");
  await expect(editor.getByLabel("Layer", { exact: true }).locator('option[value="1"]')).toHaveText("2 – Canopy");

  // The cursor belongs to this board view, not the visited definition.
  const selected = editor.getByRole("button", { name: "Column 3, row 4: empty", exact: true });
  await selected.click();
  await properties().getByRole("button", { name: "Open North link", exact: true }).click();
  await host.settle();
  await host.expectBoard(PROPERTIES_NEIGHBOR);
  editor = await host.returnToBoard();
  await expect(editor.getByRole("button", { name: "Column 3, row 4: empty", exact: true })).toHaveAttribute("tabindex", "0");
  await reveal();
  await properties().getByRole("button", { name: "Open South link", exact: true }).click();
  await host.expectProgram(PROPERTIES_PROGRAM, "LINKED PROGRAM");
  editor = await host.returnToBoard();
  await reveal();
  await properties().getByRole("button", { name: "Open thread 1", exact: true }).click();
  await host.expectProgram(PROPERTIES_THREAD, "BOARD THREAD");
  editor = await host.returnToBoard();
  await reveal();

  await properties().getByLabel("Start column", { exact: true }).fill("4");
  await properties().getByLabel("Start row", { exact: true }).fill("5");
  await properties().getByLabel("Start layer", { exact: true }).fill("2");
  const start = properties().getByRole("button", { name: "Apply player start", exact: true });
  await start.focus();
  await start.press("Enter");
  await host.save(editor);
  await expect.poll(async () => (await decode()).properties.start).toEqual({ x: 112, y: 159, layer: 2 });
  editor = await host.reopenBoard(PROPERTIES_BOARD);
  await reveal();
  await expect(properties().getByLabel("Start column", { exact: true })).toHaveValue("4");
  await expect(properties().getByLabel("Start row", { exact: true })).toHaveValue("5");
  await expect(properties().getByLabel("Start layer", { exact: true })).toHaveValue("2");
  await editor.getByLabel("Layer", { exact: true }).selectOption("0");
  await properties().getByRole("button", { name: "Set player start", exact: true }).click();
  const canvas = editor.locator("canvas.tkr-board-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const dimensions = await canvas.evaluate((element) => ({ width: (element as HTMLCanvasElement).width, height: (element as HTMLCanvasElement).height }));
  const shape = { sizeX: 8, sizeY: 8, coordType: 0 };
  const viewport = clampViewport(shape, { x: 0, y: 0, zoomIndex: 2, width: dimensions.width, height: dimensions.height });
  const centre = cellCentre(shape, 5, 2);
  const point = boardToScreen(viewport, centre.x, centre.y);
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("The player-start canvas is not visible");
  await canvas.click({ position: { x: point.x * box.width / dimensions.width, y: point.y * box.height / dimensions.height } });
  await host.save(editor);
  await expect.poll(async () => (await decode()).properties.start).toEqual({ x: 176, y: 95, layer: 1 });
  editor = await host.reopenBoard(PROPERTIES_BOARD);
  await reveal();
  await expect(properties().getByLabel("Start column", { exact: true })).toHaveValue("6");
  await expect(properties().getByLabel("Start row", { exact: true })).toHaveValue("3");
  // Returning from a native text tab must also reopen an origin which the author closed.
  await properties().getByRole("button", { name: "Open South link", exact: true }).click();
  await host.expectProgram(PROPERTIES_PROGRAM, "LINKED PROGRAM");
  await host.closeBoard(PROPERTIES_BOARD);
  await host.settle();
  await host.expectProgram(PROPERTIES_PROGRAM, "LINKED PROGRAM");
  editor = await host.returnToBoard();
  await reveal();
  await expect(properties().getByLabel("Background music", { exact: true })).toHaveValue("proof.mid");
  await expect(properties().getByLabel("Start column", { exact: true })).toHaveValue("6");
  await host.setInitial(editor, false);
  expect(await host.read(host.main)).toEqual(mainBefore);
  await host.setInitial(editor, true);
  await host.saveMain();
  await expect.poll(async () => (await main()).initBoard).toBe("properties-origin.brd");
  const changedMain = await main();
  expect({ ...changedMain, initBoard: originalMain.initBoard }).toEqual(originalMain);
  expect((await decode()).properties.start).toEqual({ x: 176, y: 95, layer: 1 });
}
