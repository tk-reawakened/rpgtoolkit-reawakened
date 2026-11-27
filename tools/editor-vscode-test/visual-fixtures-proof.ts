import type { expect as playwrightExpect, Frame, Page } from "@playwright/test";
import { BinaryReader, createEmptyBoard, readBoard, writeBoard, type Board, type WorldProgram } from "@tk-reawakened/core";
import { CREATOR_TEST_BOARD_PATH, createCreatorTestFiles } from "./creator-tests-fixture.mjs";
import { openNativeQuickOpenFile } from "./native-quick-open.ts";

type Expect = typeof playwrightExpect;
type File = { readonly path: string; readonly bytes: Uint8Array };
type VisualFixtureProofHost = {
  readonly readBacking: (path: string) => Promise<Uint8Array>;
  readonly writeBacking: (path: string, bytes: Uint8Array) => Promise<void>;
};

export const VISUAL_FIXTURE_PROOF_PATH = ".tkr-tests/Prg/visual-fixtures.spec.prg";
const DOOR_PATH = ".tkr-tests/Boards/door.brd";

/*
 * Why the door is a step-on region and why the destination is asserted by `specWait`:
 * - TOOL-5's scripted `specInput`/`specAction` edges never reach a key-press (E-41) region, so a confirm-driven door
 *   cannot be proven here. That seam is its own bug, #3590, and not a gate for this proof.
 * - `Send` stops the old board's non-persistent threads, which includes the spec's own thread, so no `expect` can run
 *   after the board changes. The case therefore asserts the start (board and gold) first, and `specWait` is the
 *   destination assertion: it returns only once the engine's active board is the destination and otherwise raises
 *   `spec.timeout` at its own authored line.
 */
/** The authored doorway: stepping onto the top-left tile runs this region's own program. */
export function doorRegion(): WorldProgram {
  return {
    program: 'Send("Boards/door.brd", 3, 2, 1)',
    graphic: "",
    initialVar: "",
    initialValue: "",
    finalVar: "",
    finalValue: "",
    activate: 0,
    activationType: 0,
    repeatDistance: 0,
    layer: 1,
    points: [{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 32 }, { x: 0, y: 32 }],
    closed: 1,
    handle: "doorway",
  };
}

/** The wall board with its authored door region, so a broken door is a changed board rather than a changed case. */
export function boardWithDoor(bytes: Uint8Array, door: boolean): Uint8Array {
  const parsed = readBoard(new BinaryReader(bytes));
  if (!parsed.ok) throw new Error(`The visual-fixture proof board could not be read: ${parsed.error.message}`);
  const written = writeBoard({ ...parsed.value, programs: door ? [doorRegion()] : [] } satisfies Board);
  if (!written.ok) throw new Error(`The visual-fixture proof board could not be written: ${written.error.message}`);
  return written.value;
}

export function visualFixtureProofFiles(): readonly File[] {
  const files = createCreatorTestFiles().filter((file) => file.path !== ".tkr-tests/Prg/wall.spec.prg");
  const wall = files.find((file) => file.path === CREATOR_TEST_BOARD_PATH);
  if (wall === undefined) throw new Error("The visual-fixture proof needs the authored wall board.");
  const proofBoard = (sizeX: number, sizeY: number): Uint8Array => {
    const empty = createEmptyBoard();
    const cells = sizeX * sizeY;
    const result = writeBoard({
      ...empty, sizeX, sizeY, sizeL: 1,
      tileMatrix: Array(cells).fill(0),
      tileRuns: [{ lutIndex: 0, count: cells, marker: true }],
      layerTitles: ["", "Ground"],
      properties: { ...empty.properties, start: { x: sizeX, y: sizeY - 1, layer: 1 } },
    });
    if (!result.ok) throw new Error(`Could not author a visual-fixture board: ${result.error.message}`);
    return result.value;
  };
  const source = [
    "// native visual fixture: opaque ASCII source line",
    'function handwrittenFixture() { preservedText = "yes" }',
    String.raw`specFixture({ board: "Boards\wall.brd", party: { length: 1, "0": "Chrs\Hero.tem" }, x: 1, y: 2, facing: "E", gold: 25 })`,
    'it("door opens onto its destination", () => {',
    '  expect(specValue("board")).toBe("boards/wall.brd")',
    '  expect(specValue("gold")).toBe(25)',
    '  specAction("up", 20)',
    '  specWait("board", "Boards/door.brd", 12)',
    "})",
    "// opaque trailer stays in place",
    "",
  ].join("\r\n");
  return [
    ...files.map((file) => file.path === CREATOR_TEST_BOARD_PATH ? { ...file, bytes: boardWithDoor(file.bytes, true) } : file),
    { path: DOOR_PATH, bytes: proofBoard(5, 3) },
    { path: ".tkr-tests/Boards/narrow.brd", bytes: proofBoard(2, 2) },
    { path: VISUAL_FIXTURE_PROOF_PATH, bytes: new TextEncoder().encode(source) },
  ];
}

/** The authored fixture line after the cards save it: the door region's board plus the fields the card cannot show. */
const SAVED_FIXTURE = String.raw`specFixture({"board":"Boards\wall.brd","party":{"0":"Chrs\Hero.tem","length":1},"x":1,"y":2,"facing":"E","gold":25,"layer":1,"seed":17})`;
const SAVED_WALL_CASE = [
  'it("wall stops at the authored boundary", () => {',
  '  specAction("right", 35)',
  '  specWait("player.tileX", 2, 60)',
  '  expect(specValue("player.tileX")).toBe(2)',
  "})",
].join("\r\n");

export async function runVscodeVisualFixturesProof(
  page: Page,
  expect: Expect,
  workbenchUrl: string,
  host: VisualFixtureProofHost,
): Promise<void> {
  await page.goto(workbenchUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-workbench")).toBeVisible({ timeout: 60_000 });
  await openNativeQuickOpenFile(page, expect, VISUAL_FIXTURE_PROOF_PATH);
  const sourceTab = page.getByRole("tab").filter({ hasText: "visual-fixtures.spec.prg" });
  await expect(sourceTab).toBeVisible();
  const command = async (title: string): Promise<void> => {
    const widget = page.locator(".quick-input-widget");
    await page.keyboard.press("ControlOrMeta+Shift+P");
    const input = widget.locator("input:visible");
    await expect(input).toHaveCount(1);
    await input.fill(`>${title}`);
    await widget.getByRole("option", { name: new RegExp(`^${title}(?:,|$)`) }).click();
    await expect(widget).toBeHidden();
  };
  await command("RPG Toolkit: Show Visual fixtures");
  const fixture = await fixtureFrame(page, expect);
  const fixtureTab = page.getByRole("tab", { name: /Visual fixtures/ });
  await expect(fixtureTab).toBeVisible();
  await fixture.getByText(/Unchanged source lines/).click();
  await expect(fixture.getByText(/native visual fixture: opaque ASCII source line/)).toBeVisible();
  // The board-mode bridge labels the start fields from the real board rather than guessing units (#3574).
  await expect(fixture.getByRole("spinbutton", { name: "Start tile X (1–5)" })).toBeVisible({ timeout: 15_000 });
  await expect(fixture.getByRole("spinbutton", { name: "Start tile Y (1–3)" })).toBeVisible();
  const boardPath = fixture.getByRole("textbox", { name: "Board project path" });
  await expect(boardPath).toHaveValue(String.raw`Boards\wall.brd`);
  await boardPath.fill("Boards/narrow.brd");
  const narrowX = fixture.getByRole("spinbutton", { name: "Start tile X (1–2)" });
  await narrowX.fill("4");
  await fixture.getByRole("button", { name: "Save fixture card to source" }).click();
  await expect(fixture.getByRole("alert")).toHaveText("This tile board places the party from 1 to 2 across and 1 to 2 down.");
  await boardPath.fill(String.raw`Boards\wall.brd`);
  await fixture.getByRole("textbox", { name: "Party character paths, comma separated" }).fill(String.raw`Chrs\Hero.tem`);
  await fixture.getByRole("spinbutton", { name: "Start tile X (1–5)" }).fill("1");
  await fixture.getByRole("spinbutton", { name: "Start tile Y (1–3)" }).fill("2");
  await fixture.getByRole("spinbutton", { name: "Layer" }).fill("1");
  await fixture.getByRole("spinbutton", { name: "Seed" }).fill("17");
  await fixture.getByRole("button", { name: "Save fixture card to source" }).click();
  await expect(fixture.getByText(/Fixture at source line/)).toBeVisible();
  await expect(fixture.getByRole("alert"), "the confirmed save clears the previous bounds refusal").toHaveCount(0);
  // A card edit keeps the authored `gold` the cards cannot show (#3569): save the source, then read the bytes back.
  await sourceTab.click();
  await page.keyboard.press("ControlOrMeta+S");
  await expect.poll(async () => new TextDecoder().decode(await host.readBacking(VISUAL_FIXTURE_PROOF_PATH))).toContain('"gold":25');
  await fixture.getByRole("textbox", { name: "Case name" }).fill("wall stops at the authored boundary");
  await fixture.getByRole("textbox", { name: /Actions, one action, ticks per line/ }).fill("right, 35");
  await fixture.getByLabel("Assert state path").selectOption("player.tileX");
  await fixture.getByRole("spinbutton", { name: "Wait up to ticks" }).fill("60");
  await fixture.getByRole("checkbox", { name: "Wait for the value before asserting" }).check();
  await fixture.getByRole("textbox", { name: "Expected value" }).fill("2");
  await fixture.getByRole("button", { name: "Add case to source" }).click();
  await expect(fixture.getByText("wall stops at the authored boundary", { exact: true })).toBeVisible();
  const expectedSource = [
    "// native visual fixture: opaque ASCII source line",
    'function handwrittenFixture() { preservedText = "yes" }',
    SAVED_FIXTURE,
    'it("door opens onto its destination", () => {',
    '  expect(specValue("board")).toBe("boards/wall.brd")',
    '  expect(specValue("gold")).toBe(25)',
    '  specAction("up", 20)',
    '  specWait("board", "Boards/door.brd", 12)',
    "})",
    "// opaque trailer stays in place",
    SAVED_WALL_CASE,
  ].join("\r\n");
  await fixture.getByRole("button", { name: "Save and run saved tests" }).click();
  await expect.poll(() => host.readBacking(VISUAL_FIXTURE_PROOF_PATH)).toEqual(new TextEncoder().encode(expectedSource));
  const tests = await creatorTestsFrame(page, expect);
  await expect(tests.getByRole("status")).toHaveText("Passed: 2 passing cases, 0 failing cases, 0 skipped cases.", { timeout: 30_000 });
  await expect(tests.getByRole("heading", { name: "Pass: door opens onto its destination" })).toBeVisible();
  await expect(tests.getByRole("heading", { name: "Pass: wall stops at the authored boundary" })).toBeVisible();

  // A door that is gone must fail the door case at its own authored wait, not pass on the destination read alone.
  const authoredBoard = visualFixtureProofFiles().find((file) => file.path === CREATOR_TEST_BOARD_PATH);
  if (authoredBoard === undefined) throw new Error("The native fixture proof omitted its authored wall board.");
  await host.writeBacking(CREATOR_TEST_BOARD_PATH, boardWithDoor(authoredBoard.bytes, false));
  await fixtureTab.click();
  await expect(fixture.getByRole("button", { name: "Save and run saved tests" })).toBeVisible();
  await fixture.getByRole("button", { name: "Save and run saved tests" }).click();
  await expect(tests.getByRole("heading", { name: "Fail: door opens onto its destination" })).toBeVisible({ timeout: 30_000 });
  await expect(tests.getByRole("heading", { name: "Pass: wall stops at the authored boundary" })).toBeVisible({ timeout: 30_000 });
  await expect(tests.getByRole("status")).toHaveText("Failed: 1 passing cases, 1 failing cases, 0 skipped cases.", { timeout: 30_000 });
  const doorFailure = tests.locator('tr[data-outcome="fail"]');
  await expect(doorFailure).toHaveCount(1);
  const doorWaitLine = expectedSource.split("\r\n").findIndex((line) => line.includes('specWait("board", "Boards/door.brd", 12)')) + 1;
  const doorLocation = doorFailure.getByRole("button", { name: /^Line \d+, column \d+$/ });
  const doorLabel = await doorLocation.innerText();
  const reportedDoorLine = Number(doorLabel.match(/^Line (\d+),/)?.[1]);
  if (!Number.isInteger(reportedDoorLine) || reportedDoorLine !== doorWaitLine || doorWaitLine < 1) {
    throw new Error(`The broken door did not report its own authored wait line ${doorWaitLine}: ${doorLabel}`);
  }
  const doorTitle = await doorLocation.getAttribute("title");
  if (doorTitle === null || !doorTitle.startsWith(`${VISUAL_FIXTURE_PROOF_PATH}:${doorWaitLine}:`)) {
    throw new Error(`The broken door wait does not locate its own authored source: ${doorTitle}`);
  }

  // The wall mutation keeps the door in place and turns only the wall case red, at its own authored lines.
  const parsedWall = readBoard(new BinaryReader(authoredBoard.bytes));
  if (!parsedWall.ok) throw new Error(`The native fixture proof wall board could not be read: ${parsedWall.error.message}`);
  const openBoard = writeBoard({ ...parsedWall.value, vectors: [], programs: [doorRegion()] });
  if (!openBoard.ok) throw new Error(`The native fixture proof open-board control could not be written: ${openBoard.error.message}`);
  await host.writeBacking(CREATOR_TEST_BOARD_PATH, openBoard.value);
  await fixtureTab.click();
  await fixture.getByRole("button", { name: "Save and run saved tests" }).click();
  // The previous broken-door run shows the same count text, so wait for this run's own headings before reading rows.
  await expect(tests.getByRole("heading", { name: "Pass: door opens onto its destination" })).toBeVisible({ timeout: 30_000 });
  await expect(tests.getByRole("heading", { name: "Fail: wall stops at the authored boundary" })).toBeVisible({ timeout: 30_000 });
  await expect(tests.getByRole("status")).toHaveText("Failed: 1 passing cases, 1 failing cases, 0 skipped cases.", { timeout: 30_000 });
  // Removing the wall turns both of the wall case's own lines red: the bounded wait times out and the assertion reads the wrong tile.
  const wallFailure = tests.locator('tr[data-outcome="fail"]');
  await expect(wallFailure).toHaveCount(2);
  const sourceLines = expectedSource.split("\r\n");
  const wallWaitLine = sourceLines.findIndex((line) => line.includes('specWait("player.tileX", 2, 60)')) + 1;
  const wallExpectLine = sourceLines.findIndex((line) => line.includes('expect(specValue("player.tileX")).toBe(2)')) + 1;
  if (wallWaitLine < 1 || wallExpectLine < 1) throw new Error("The authored wall case lost its wait or assertion line.");
  for (const line of [wallWaitLine, wallExpectLine]) {
    const location = wallFailure.getByRole("button", { name: new RegExp(`^Line ${line}, column \\d+$`) });
    await expect(location, `the wall mutation must report authored line ${line}`).toHaveCount(1);
    const title = await location.getAttribute("title");
    if (title === null || !title.startsWith(`${VISUAL_FIXTURE_PROOF_PATH}:${line}:`)) {
      throw new Error(`The wall mutation line ${line} does not locate its own authored source: ${title}`);
    }
  }

  await fixtureTab.click();
  await fixtureTab.hover();
  await fixtureTab.getByRole("button", { name: /Close/ }).click();
  await expect(fixtureTab).toHaveCount(0);
  // Close and reopen the native view to verify reconstruction from the saved source.
  await expect(tests.getByRole("heading", { name: "Fail: wall stops at the authored boundary" })).toBeVisible();
  await openNativeQuickOpenFile(page, expect, VISUAL_FIXTURE_PROOF_PATH);
  await command("RPG Toolkit: Show Visual fixtures");
  const reopened = await fixtureFrame(page, expect);
  await expect(reopened.getByRole("textbox", { name: "Board project path" })).toHaveValue(String.raw`Boards\wall.brd`);
  await expect(reopened.getByRole("spinbutton", { name: "Start tile X (1–5)" })).toHaveValue("1");
  await expect(reopened.getByText("wall stops at the authored boundary", { exact: true })).toBeVisible();
  await expect.poll(() => host.readBacking(VISUAL_FIXTURE_PROOF_PATH)).toEqual(new TextEncoder().encode(expectedSource));
}

async function fixtureFrame(page: Page, expect: Expect): Promise<Frame> {
  let found: Frame | undefined;
  await expect.poll(async () => {
    found = undefined;
    for (const frame of page.frames()) {
      if (await frame.getByRole("region", { name: "Visual test fixture editor", exact: true }).isVisible().catch(() => false)) {
        found = frame;
        break;
      }
    }
    return found !== undefined;
  }, { timeout: 30_000 }).toBe(true);
  if (found === undefined) throw new Error("VS Code did not render the native visual-fixtures panel.");
  return found;
}

async function creatorTestsFrame(page: Page, expect: Expect): Promise<Frame> {
  let found: Frame | undefined;
  await expect.poll(async () => {
    found = undefined;
    for (const frame of page.frames()) {
      if (await frame.locator("section.tkr-creator-tests").count().catch(() => 0) > 0) {
        found = frame;
        break;
      }
    }
    return found !== undefined;
  }, { timeout: 30_000 }).toBe(true);
  if (found === undefined) throw new Error("The existing saved-tests panel did not render.");
  return found;
}
