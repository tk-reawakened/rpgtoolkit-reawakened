import { deepEqual, equal, notEqual, ok } from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  BinaryReader,
  boardPixelSize,
  assetKey,
  coordLayout,
  createEmptyBoard,
  createEmptyCharacter,
  rasterize,
  readBoard,
  writeBoard,
  writeCharacter,
  tileToPixel,
  usesPixelCoordinates,
  type AssetKey,
  type DecodedTexture,
  type DrawList,
  type RasterAsset,
  type RasterSurfaces,
  type SurfaceId,
} from "@tk-reawakened/core";
import {
  CREATOR_TEST_ACTOR_RGB,
  CREATOR_TEST_CASE_NAME,
  CREATOR_TEST_SPEC_PATH,
  createCreatorTestFiles,
} from "@tk-reawakened/editor-vscode-test";
import { runCreatorSpecs, runSpecProject, type CreatorFrameObservation } from "../src/index.ts";

type File = { readonly path: string; readonly bytes: Uint8Array };

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** The authored line and 1-based column of the token a real spec source places on its line. */
function authoredPosition(source: string, needle: string, token = "expect"): { readonly line: number; readonly column: number } {
  const lines = source.split("\n");
  const index = lines.findIndex((text) => text.includes(needle));
  if (index < 0) throw new Error(`the authored source has no line containing ${needle}`);
  const column = (lines[index]?.indexOf(token) ?? -1) + 1;
  if (column < 1) throw new Error(`the authored line containing ${needle} has no ${token} token`);
  return { line: index + 1, column };
}

function replaceFile(files: readonly File[], path: string, bytes: Uint8Array): File[] {
  return files.map((file) => file.path === path ? { path, bytes } : file);
}

function specText(files: readonly File[]): string {
  const file = files.find((candidate) => candidate.path === CREATOR_TEST_SPEC_PATH);
  if (file === undefined) throw new Error("the authored fixture has no creator-test spec");
  return decode(file.bytes);
}

/** The shared authored board with its only blocking vector removed, every other byte authored as-is. */
function withWallRemoved(files: readonly File[]): File[] {
  const board = files.find((file) => file.path.endsWith("Boards/wall.brd"));
  if (board === undefined) throw new Error("the authored fixture has no wall board");
  const parsed = readBoard(new BinaryReader(board.bytes, board.path));
  if (!parsed.ok) throw new Error(parsed.error.message);
  const written = writeBoard({ ...parsed.value, vectors: [] });
  if (!written.ok) throw new Error(written.error.message);
  return replaceFile(files, board.path, written.value);
}

function selectedCase(
  files: readonly File[],
  name: string,
  options: { readonly coverage?: boolean; readonly onFrame?: (frame: CreatorFrameObservation) => void } = {},
) {
  const report = runCreatorSpecs(files, { ...options, name });
  const result = report.files.flatMap((file) => file.cases).find((candidate) => candidate.name === name);
  if (result === undefined) throw new Error(`creator case not found: ${name}`);
  return { report, result };
}

/** Reuse the core rasterizer on the read-only observation the fixture host presents. */
function rasterizeObservedFrame(frame: CreatorFrameObservation): { readonly tick: number; readonly width: number; readonly height: number; readonly rgba: Uint8Array } {
  const assets = new Map<AssetKey, RasterAsset>();
  const cachedAsset = assets.get.bind(assets);
  assets.get = (key) => {
    const cached = cachedAsset(key);
    if (cached !== undefined) return cached;
    const loaded = frame.picturePixels(key) ?? frame.assetBytes(key);
    if (loaded !== null) assets.set(key, loaded);
    return loaded ?? undefined;
  };
  const surfaces: RasterSurfaces = new Map();
  const revisions = new Map<SurfaceId, Map<number, DecodedTexture>>();
  surfaces.get = (id, revision?: number) => {
    if (revision === undefined) return undefined;
    const cached = revisions.get(id)?.get(revision);
    if (cached !== undefined) return cached;
    const loaded = frame.surfacePixels(id, revision);
    if (loaded === null) return undefined;
    let versions = revisions.get(id);
    if (versions === undefined) { versions = new Map(); revisions.set(id, versions); }
    versions.set(revision, loaded);
    return loaded;
  };
  const pixels = rasterize(frame.drawList as DrawList, assets, surfaces);
  if (pixels.error !== null) throw new Error(`the observed frame could not be drawn: ${pixels.error}`);
  return { tick: frame.tick, width: pixels.width, height: pixels.height, rgba: pixels.rgba };
}

function colours(rgba: Uint8Array): Set<string> {
  const seen = new Set<string>();
  for (let index = 0; index < rgba.length; index += 4) seen.add(`${rgba[index]},${rgba[index + 1]},${rgba[index + 2]}`);
  return seen;
}

test("the authored wall fixture stops its 60-tick right action at the authored tile", () => {
  const files = createCreatorTestFiles();
  const { result } = selectedCase(files, CREATOR_TEST_CASE_NAME);
  equal(result.ok, true, JSON.stringify(result.outcomes, null, 2));
  equal(result.outcomes.filter((outcome) => outcome.kind === "pass").length, 3);
  equal(result.outcomes.filter((outcome) => outcome.kind === "fail").length, 0);
  const actionLog = result.run?.actionLog ?? [];
  equal(actionLog.length, 2);
  ok(actionLog[0]?.event.kind === "action");
  ok(actionLog[1]?.event.kind === "action");
  if (actionLog[0]?.event.kind === "action" && actionLog[1]?.event.kind === "action") {
    equal(actionLog[0].event.action, "right");
    equal(actionLog[0].event.down, true);
    equal(actionLog[1].event.down, false);
    equal(actionLog[1].tick - actionLog[0].tick, 60);
  }
  equal(result.run?.snapshot.fixture.start.y, 2);
  equal(result.run?.snapshot.fixture.party.length, 1);
  ok((result.run?.checkpoints.length ?? 0) >= 2);
  deepEqual(Object.keys(result.run ?? {}), ["fixture", "snapshot", "loaded", "ticks", "actionLog", "checkpoints"]);
  for (const path of [".tkr-tests/Boards/wall.brd", ".tkr-tests/Chrs/Hero.tem", ".tkr-tests/Misc/walk.anm", ".tkr-tests/Bitmap/hero.png"]) {
    ok(result.run?.loaded.includes(path), `the real fixture loaded ${path}: ${JSON.stringify(result.run?.loaded)}`);
  }
});

test("removing the authored wall moves the player and turns the tile guard red", () => {
  const authored = createCreatorTestFiles();
  const source = [
    'specFixture({ board: "Boards/wall.brd", party: { length: 1, "0": "Chrs/Hero.tem" }, x: 1, y: 2, facing: "E" })',
    `it("${CREATOR_TEST_CASE_NAME}", () => {`,
    '  specAction("right", 35)',
    '  expect(specValue("player.tileX")).toBe(2)',
    "})",
  ].join("\n");
  const files = withWallRemoved(replaceFile(authored, CREATOR_TEST_SPEC_PATH, encode(source)));
  const { result } = selectedCase(files, CREATOR_TEST_CASE_NAME);
  equal(result.ok, false);
  const failure = result.outcomes.find((outcome) => outcome.kind === "fail");
  ok(failure !== undefined);
  equal(failure.expected, "2");
  ok(Number(failure.actual) > 2, `the open board lets the real engine walk past the authored wall line: ${failure.actual}`);
  const authoredWall = authoredPosition(source, 'expect(specValue("player.tileX"))');
  equal(failure.line, authoredWall.line);
  ok(failure.column > 0);
});

test("the authored assertion keeps its own line when the authored expectation fails", () => {
  const files = createCreatorTestFiles({ failWall: true });
  const source = specText(files);
  const authoredWall = authoredPosition(source, 'expect(specValue("player.tileX"))');
  equal(authoredWall.line, 11, "the shared fixture's wall assertion is physical line 11");
  const { result } = selectedCase(files, CREATOR_TEST_CASE_NAME);
  equal(result.ok, false);
  const failure = result.outcomes.find((outcome) => outcome.kind === "fail");
  ok(failure !== undefined);
  equal(failure.expected, "3");
  equal(failure.actual, "2");
  equal(failure.line, authoredWall.line, "a failure keeps the authored line, not a synthetic helper offset");
  ok(failure.column > 0, "the failure reports a one-based column");
  equal(failure.context?.lastAction?.action, "right");
  equal(failure.context?.lastAction?.ticks, 60);
  equal(failure.context?.board, "boards/wall.brd");
});

test("the real engine frame draws the authored board and actor palette", () => {
  const files = createCreatorTestFiles();
  let frame: CreatorFrameObservation | undefined;
  const { result } = selectedCase(files, CREATOR_TEST_CASE_NAME, { onFrame: (observation) => { frame = observation; } });
  equal(result.ok, true);
  ok(frame !== undefined);
  equal(frame.tick, result.run?.checkpoints.at(-1)?.tick);
  const rendered = rasterizeObservedFrame(frame);
  equal(rendered.width, 640);
  equal(rendered.height, 480);
  const seen = colours(rendered.rgba);
  ok(seen.has("22,58,84"), "the authored board background is painted");
  for (const [part, rgb] of Object.entries(CREATOR_TEST_ACTOR_RGB)) {
    ok(seen.has(rgb), `the real frame paints the authored actor ${part} colour ${rgb}: ${JSON.stringify([...seen].slice(0, 12))}`);
  }
  ok(seen.size >= 5, "the frame contains board and actor pixels");
  const board = files.find((file) => file.path.endsWith("Boards/wall.brd"))!;
  const held = frame.assetBytes(assetKey("Boards/wall.brd"));
  deepEqual(held, board.bytes);
  held![0] = held![0]! ^ 0xff;
  deepEqual(frame.assetBytes(assetKey("Boards/wall.brd")), board.bytes, "resource readers return fresh owned bytes");
  equal(frame.assetBytes(assetKey("Boards/unlisted.brd")), null, "frame reads cannot escape the frozen fixture world");
});

test("frame observation does not change canonical hashes", () => {
  const files = classicFiles();
  const name = "consumes one tick through normal movement before the release boundary";
  const observed = selectedCase(files, name, { onFrame: () => {} }).result;
  const plain = selectedCase(files, name).result;
  equal(observed.ok, plain.ok);
  equal(observed.stateHash, plain.stateHash);
  deepEqual(observed.run?.checkpoints, plain.run?.checkpoints);
});

test("a bounded wait timeout names its authored call in a real fixture", () => {
  const source = [
    'specFixture({ board: "Boards/wall.brd", party: { length: 1, "0": "Chrs/Hero.tem" }, x: 1, y: 2, facing: "E" })',
    'it("wait timeout", () => {',
    '  specWait("board", "Boards/absent.brd", 2)',
    '})',
  ].join("\n");
  const files = replaceFile(createCreatorTestFiles(), CREATOR_TEST_SPEC_PATH, encode(source));
  const { result } = selectedCase(files, "wait timeout");
  equal(result.ok, false);
  const timeout = result.outcomes.find((outcome) => outcome.actual.includes("spec.timeout"));
  ok(timeout !== undefined, JSON.stringify(result.outcomes, null, 2));
  const authored = authoredPosition(source, 'specWait("board"', "specWait");
  equal(timeout.line, authored.line);
  equal(timeout.actual.includes("after 2 ticks"), true);
});

test("Node and browser-safe entrypoints report the same simple spec state", () => {
  const files: readonly File[] = [{ path: "Prg/entry.spec.prg", bytes: encode('it("reports one result", () => { expect(1).toBe(1) })') }];
  const root = mkdtempSync(join(tmpdir(), "script-spec-runtime-"));
  try {
    const target = join(root, files[0]!.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, files[0]!.bytes);
    deepEqual(runSpecProject(root, { coverage: true }), runCreatorSpecs(files, { coverage: true }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an included program keeps its own source coordinates", () => {
  const source = [
    '#include "Misc/helper.prg"',
    'specFixture({ board: "Boards/wall.brd", party: { length: 1, "0": "Chrs/Hero.tem" }, x: 1, y: 2, facing: "E" })',
    'it("included program failure", () => {',
    "  includedFailure()",
    "})",
  ].join("\n");
  const files: readonly File[] = [
    ...createCreatorTestFiles().filter((file) => file.path !== CREATOR_TEST_SPEC_PATH),
    { path: CREATOR_TEST_SPEC_PATH, bytes: encode(source) },
    { path: ".tkr-tests/Prg/Misc/helper.prg", bytes: encode('function includedFailure() { expect(1).toBe(2) }') },
  ];
  const { result } = selectedCase(files, "included program failure");
  equal(result.ok, false);
  const failure = result.outcomes.find((outcome) => outcome.kind === "fail");
  ok(failure !== undefined, JSON.stringify(result.outcomes, null, 2));
  equal(failure.line, 1, "the included program's own line 1, not the including spec's line");
  equal(failure.sourcePath, ".tkr-tests/Prg/Misc/helper.prg");
  equal(failure.actual, "1");
  equal(failure.expected, "2");
});


/* Classic TOOL-5 behaviour on an authored multi-case fixture: hooks, effects, checkpoints, coverage and waits. */

const classicSource = [
  'specFixture({ board: "Boards/wall.brd", party: { length: 1, "0": "Chrs/Hero.tem" }, x: 1, y: 1 })',
  'beforeAll(() => {',
  '  openAction = "confirm"',
  '  openBoard = "boards/door.brd"',
  '  hookRuns = 0',
  '  GiveGP(7)',
  '})',
  'beforeEach(() => { hookRuns = hookRuns + 1; GiveGP(3) })',
  'it("hooks and effects reach the live fixture", () => {',
  '  specAction("right", 30)',
  '  specWait("player.tileX", 2, 32)',
  '  expect(specValue("player.tileX")).toBe(2)',
  '  specAction("right", 30)',
  '  specWait("player.tileX", 2, 32)',
  '  expect(specValue("player.tileX")).toBe(2)',
  '  specAction(openAction, 1)',
  '  Send(openBoard, 1, 1, 1)',
  '  doorOpened = 1',
  '  specWait("board", openBoard, 8)',
  '  expect(specValue("board")).toBe(openBoard)',
  '  expect(specValue("gold")).toBe(10)',
  '  expect(specValue("effect.givegp")).toBe(2)',
  '  expect(specValue("variable.hookRuns")).toBe(1)',
  '  expect(specValue("variable.doorOpened")).toBe(1)',
  '})',
  'it("starts from the group checkpoint after the prior case", () => {',
  '  expect(specValue("board")).toBe("boards/wall.brd")',
  '  expect(specValue("variable.doorOpened")).toBe(null)',
  '  expect(specValue("gold")).toBe(10)',
  '})',
  'it("consumes one tick through normal movement before the release boundary", () => {',
  '  startX = specValue("player.x")',
  '  specAction("right", 1)',
  '  moved = specValue("player.x") > startX',
  '  expect(moved).toBe(true)',
  '})',
  'describe("nested fixture hooks", () => {',
  '  beforeAll(() => { nestedRuns = nestedRuns + 1; GiveGP(5) })',
  '  beforeEach(() => { nestedEach = nestedEach + 1; GiveGP(2) })',
  '  afterEach(() => { nestedAfter = nestedAfter + 1; GiveGP(1) })',
  '  afterAll(() => { specResult("pass", "nested teardown", "", "") })',
  '  it("runs inherited and nested setup in the live fixture", () => {',
  '    expect(specValue("gold")).toBe(17)',
  '    expect(specValue("effect.givegp")).toBe(4)',
  '    expect(specValue("variable.nestedRuns")).toBe(1)',
  '    expect(specValue("variable.nestedEach")).toBe(1)',
  '  })',
  '  it("restores the nested group checkpoint before the next case", () => {',
  '    expect(specValue("gold")).toBe(17)',
  '    expect(specValue("effect.givegp")).toBe(4)',
  '    expect(specValue("variable.nestedRuns")).toBe(1)',
  '    expect(specValue("variable.nestedEach")).toBe(1)',
  '    expect(specValue("variable.nestedAfter")).toBe(null)',
  '  })',
  '})',
  'function unreachableFixtureBranch() { neverCalled = 1 }',
].join("\n");

function classicFiles(): readonly File[] {
  const board = (vectors: readonly unknown[]): Uint8Array => {
    const empty = createEmptyBoard();
    const written = writeBoard({
      ...empty,
      sizeX: 10,
      sizeY: 8,
      sizeL: 1,
      tileMatrix: Array(80).fill(0),
      tileRuns: [{ lutIndex: 0, count: 80, marker: true }],
      layerTitles: ["", ""],
      vectors: vectors as never,
      programs: [],
      properties: { ...empty.properties, start: { x: 1, y: 1, layer: 1 } },
    });
    if (!written.ok) throw new Error(written.error.message);
    return written.value;
  };
  const character = writeCharacter({
    ...createEmptyCharacter(),
    minor: 5,
    name: "Hero",
    movementAnimations: Array(8).fill(""),
    battleStances: ["", "", "", "", "", ""],
  });
  if (!character.ok) throw new Error(character.error.message);
  return [
    { path: "Prg/classic.spec.prg", bytes: encode(classicSource) },
    { path: ".tkr-tests/Boards/wall.brd", bytes: board([{ handle: "wall", attributes: 0, closed: 1, layer: 1, type: 1, points: [{ x: 64, y: 0 }, { x: 96, y: 0 }, { x: 96, y: 480 }, { x: 64, y: 480 }] }]) },
    { path: ".tkr-tests/Boards/door.brd", bytes: board([]) },
    { path: ".tkr-tests/Chrs/Hero.tem", bytes: character.value },
  ];
}

test("hooks, effects and coverage reach the live fixture through one real engine", () => {
  const { report, result } = selectedCase(classicFiles(), "hooks and effects reach the live fixture", { coverage: true });
  equal(result.ok, true, JSON.stringify(result.outcomes, null, 2));
  equal(result.run?.snapshot.fixture.party.length, 1);
  equal(result.run?.fixture.start.x, 1);
  const actionLog = result.run?.actionLog ?? [];
  equal(actionLog.length, 6);
  const [moveDown, moveUp, blockedDown, blockedUp, confirmDown, confirmUp] = actionLog;
  ok(moveDown?.event.kind === "action");
  ok(moveUp?.event.kind === "action");
  ok(blockedDown?.event.kind === "action");
  ok(blockedUp?.event.kind === "action");
  ok(confirmDown?.event.kind === "action");
  ok(confirmUp?.event.kind === "action");
  if (moveDown?.event.kind === "action" && moveUp?.event.kind === "action"
    && blockedDown?.event.kind === "action" && blockedUp?.event.kind === "action"
    && confirmDown?.event.kind === "action" && confirmUp?.event.kind === "action") {
    equal(moveDown.event.action, "right");
    equal(moveDown.event.source, "spec.action:1");
    equal(moveDown.event.down, true);
    equal(moveUp.event.down, false);
    equal(moveUp.tick - moveDown.tick, 30);
    equal(blockedDown.event.action, "right");
    equal(blockedDown.event.source, "spec.action:2");
    equal(blockedDown.event.down, true);
    equal(blockedUp.event.down, false);
    equal(blockedUp.tick - blockedDown.tick, 30);
    equal(confirmDown.event.action, "confirm");
    equal(confirmDown.event.source, "spec.action:3");
    equal(confirmDown.event.down, true);
    equal(confirmUp.event.down, false);
    equal(confirmUp.tick - confirmDown.tick, 1);
  }
  const coverage = report.coverage?.files.find((file) => file.file === "Prg/classic.spec.prg");
  ok(coverage !== undefined);
  const uncalledLine = classicSource.split("\n").findIndex((line) => line.includes("neverCalled")) + 1;
  equal(coverage.lines.find((line) => line.line === uncalledLine)?.hits, 0);
  ok(coverage.lines.some((line) => line.hits > 0));
});

test("a later case resumes the group checkpoint, not the prior case's world", () => {
  const { result } = selectedCase(classicFiles(), "starts from the group checkpoint after the prior case");
  equal(result.ok, true, JSON.stringify(result.outcomes, null, 2));
});

test("one-tick action consumes input and releases at the exact next tick", () => {
  const { result } = selectedCase(classicFiles(), "consumes one tick through normal movement before the release boundary");
  equal(result.ok, true);
  const actionLog = result.run?.actionLog ?? [];
  equal(actionLog.length, 2);
  equal(actionLog[1]?.tick, (actionLog[0]?.tick ?? 0) + 1);
});

test("a nested group runs inherited and nested hooks on a fresh checkpoint", () => {
  const { result } = selectedCase(classicFiles(), "runs inherited and nested setup in the live fixture");
  equal(result.ok, true, JSON.stringify(result.outcomes, null, 2));
  notEqual(result.stateHash, "");
});

function positionFixtureFiles(
  x: number,
  y: number,
  layer = 1,
  pixelCoordinates = false,
): { readonly files: File[]; readonly width: number; readonly height: number; readonly sizeX: number; readonly sizeL: number } {
  const files = createCreatorTestFiles();
  const boardFile = files.find((file) => file.path.endsWith("Boards/wall.brd"));
  if (boardFile === undefined) throw new Error("the shared creator fixture has no wall board");
  const parsed = readBoard(new BinaryReader(boardFile.bytes, boardFile.path));
  if (!parsed.ok) throw new Error(parsed.error.message);
  const coordType = pixelCoordinates ? parsed.value.coordType | 4 : parsed.value.coordType & ~4;
  const written = writeBoard({ ...parsed.value, coordType });
  if (!written.ok) throw new Error(written.error.message);
  const size = boardPixelSize(coordLayout(coordType), parsed.value.sizeX, parsed.value.sizeY);
  const source = [
    `specFixture({ board: "Boards/wall.brd", party: { length: 1, "0": "Chrs/Hero.tem" }, x: ${x}, y: ${y}, layer: ${layer} })`,
    'it("fixture position is valid", () => { expect(specValue("board")).toBe("boards/wall.brd") })',
  ].join("\n");
  const withBoard = replaceFile(files, boardFile.path, written.value);
  return {
    files: replaceFile(withBoard, CREATOR_TEST_SPEC_PATH, encode(source)),
    width: size.width,
    height: size.height,
    sizeX: parsed.value.sizeX,
    sizeL: parsed.value.sizeL,
  };
}

test("fixture starts are checked against saved tile bounds and layers", () => {
  const fixture = positionFixtureFiles(1, 1);
  const outside = selectedCase(positionFixtureFiles(fixture.sizeX + 1, 1).files, "fixture position is valid").result;
  const missingLayer = selectedCase(positionFixtureFiles(1, 1, fixture.sizeL + 1).files, "fixture position is valid").result;
  for (const result of [outside, missingLayer]) {
    equal(result.ok, false);
    const failure = result.outcomes.find((outcome) => outcome.actual.startsWith("spec.fixture-load:"));
    ok(failure !== undefined);
    equal(failure.sourcePath, CREATOR_TEST_SPEC_PATH);
    equal(failure.line, 1);
    equal(result.run, undefined, "invalid saved-board placement must fail before creating the fixture engine");
  }
});

test("fixture start bounds honor saved pixel-coordinate flags", () => {
  const dimensions = positionFixtureFiles(0, 0, 1, true);
  equal(usesPixelCoordinates(4), true);
  const valid = selectedCase(positionFixtureFiles(dimensions.width - 1, dimensions.height - 1, 1, true).files, "fixture position is valid").result;
  equal(valid.ok, true, JSON.stringify(valid.outcomes, null, 2));
  const outside = selectedCase(positionFixtureFiles(dimensions.width, 0, 1, true).files, "fixture position is valid").result;
  equal(outside.ok, false);
  const failure = outside.outcomes.find((outcome) => outcome.actual.startsWith("spec.fixture-load:"));
  ok(failure !== undefined);
  equal(failure.sourcePath, CREATOR_TEST_SPEC_PATH);
  equal(failure.line, 1);
});

test("beforeAll restores pending creator action releases and their ordinal across all cases", () => {
  const source = [
    'specFixture({ board: "Boards/door.brd", party: { length: 1, "0": "Chrs/Hero.tem" }, x: 1, y: 1 })',
    'beforeAll(() => { Thread("pending.prg", false); specTicks(1) })',
    'it("first restored case", () => { specTicks(8); specAction("confirm", 1); specTicks(2); expect(1).toBe(1) })',
    'it("second restored case", () => { specTicks(8); specAction("confirm", 1); specTicks(2); expect(1).toBe(1) })',
  ].join("\n");
  const files = [
    ...classicFiles().filter((file) => file.path !== "Prg/classic.spec.prg"),
    { path: "Prg/pending.spec.prg", bytes: encode(source) },
    { path: ".tkr-tests/Prg/pending.prg", bytes: encode('specAction("right", 4)') },
  ];
  const report = runCreatorSpecs(files);
  const cases = report.files.flatMap((entry) => entry.cases);
  deepEqual(cases.map((item) => item.name), ["first restored case", "second restored case"]);
  for (const item of cases) {
    equal(item.ok, true, JSON.stringify(item.outcomes, null, 2));
    const actions = item.run?.actionLog.flatMap((record) => record.event.kind === "action" ? [record.event] : []) ?? [];
    const resumed = actions.filter((event) => event.source === "spec.action:1");
    const next = actions.filter((event) => event.source === "spec.action:2");
    equal(resumed.length, 1);
    equal(resumed[0]?.down, false);
    equal(next.length, 2);
    equal(next[0]?.down, true);
    equal(next[1]?.down, false);
  }
});

test("fixture string command results cannot inject setup RPGCode", () => {
  const files = createCreatorTestFiles();
  const source = [
    'specFixture({ board: "Boards/wall.brd", party: { length: 1, "0": "Chrs/Hero.tem" }, x: 1, y: 2, variables: { attack$: chr(34) + "GiveGP(999)" } })',
    'it("must not run injected setup code", () => { expect(1).toBe(1) })',
  ].join("\n");
  const report = runCreatorSpecs(replaceFile(files, CREATOR_TEST_SPEC_PATH, encode(source)));
  equal(report.files[0]?.cases.length, 0);
  ok(report.failures.some((failure) => failure.includes("line 1 (spec.bad-fixture)")));
  ok(!report.failures.some((failure) => failure.includes("GiveGP(999)")), "the rejected value never enters a generated setup program");
});

function rotatedFixtureFiles(x: number, y: number): File[] {
  const path = "Prg/rotated.spec.prg";
  const source = [
    `specFixture({ board: "Boards/wall.brd", party: { length: 1, "0": "Chrs/Hero.tem" }, x: ${x}, y: ${y} })`,
    'it("rotated board position is valid", () => { expect(specValue("board")).toBe("boards/wall.brd") })',
  ].join("\n");
  const files = classicFiles().filter((file) => file.path !== "Prg/classic.spec.prg");
  const boardFile = files.find((file) => file.path.endsWith("Boards/wall.brd"));
  if (boardFile === undefined) throw new Error("the classic fixture has no wall board");
  const parsed = readBoard(new BinaryReader(boardFile.bytes, boardFile.path));
  if (!parsed.ok) throw new Error(parsed.error.message);
  const side = parsed.value.sizeX + parsed.value.sizeY;
  const tileCount = side * side * parsed.value.sizeL;
  const written = writeBoard({
    ...parsed.value,
    coordType: (parsed.value.coordType & ~4) | 2,
    tileMatrix: Array(tileCount).fill(0),
    tileRuns: [{ lutIndex: 0, count: tileCount, marker: true }],
    vectors: [],
    programs: [],
  });
  if (!written.ok) throw new Error(written.error.message);
  return replaceFile(files, boardFile.path, written.value).concat({ path, bytes: encode(source) });
}

test("rotated fixture tiles validate by Core pixel conversion", () => {
  const dimensions = boardPixelSize("iso-rotated", 10, 8);
  const inside = tileToPixel("iso-rotated", 10, 11, 6);
  const outside = tileToPixel("iso-rotated", 10, 1, 1);
  deepEqual(dimensions, { width: 608, height: 256 });
  deepEqual(inside, { x: 480, y: 96 });
  deepEqual(outside, { x: 320, y: -144 });

  const validReport = runCreatorSpecs(rotatedFixtureFiles(11, 6));
  const valid = validReport.files.flatMap((file) => file.cases)[0];
  ok(valid !== undefined, JSON.stringify(validReport.failures));
  equal(valid.ok, true, JSON.stringify(valid.outcomes, null, 2));

  const invalidReport = runCreatorSpecs(rotatedFixtureFiles(1, 1));
  const invalid = invalidReport.files.flatMap((file) => file.cases)[0];
  ok(invalid !== undefined, JSON.stringify(invalidReport.failures));
  equal(invalid.ok, false);
  const failure = invalid.outcomes.find((outcome) => outcome.actual.startsWith("spec.fixture-load:"));
  ok(failure !== undefined);
  equal(failure.sourcePath, "Prg/rotated.spec.prg");
  equal(failure.line, 1);
  equal(invalid.run, undefined, "out-of-board rotated placement fails before starting the fixture engine");
});
