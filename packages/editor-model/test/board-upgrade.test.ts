import { deepEqual, equal, match, ok } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { boardGrid, coordLayout, decodeBoard, stackedToRotated, tileToPixel } from "@tk-reawakened/core";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createBoardCoordinateUpgradeCommand, createDocumentIdentity, openBoardDocument, planBoardCoordinateUpgrade, upgradeBoardCopy } from "../src/index.ts";
import { exampleBoard } from "./fixtures.ts";

const sourcePath = "Boards/Entry.brd";
const copyPath = "Boards/Entry.upgraded.brd";

function decoded(bytes: Uint8Array) {
  const result = decodeBoard(bytes);
  ok(result.ok, result.ok ? "" : result.error.message);
  return result.value;
}
function expandedShade(records: readonly { readonly runCount: number; readonly r: number; readonly g: number; readonly b: number }[], cells: number) {
  const result: { r: number; g: number; b: number }[] = [];
  for (const record of records) {
    const count = record.runCount > 1 ? record.runCount : 1;
    for (let i = 0; i < count && result.length < cells; i += 1) result.push({ r: record.r, g: record.g, b: record.b });
  }
  return result;
}


test("a coordinate upgrade is one undoable edit after reopening a preserved copy", async () => {
  const original = exampleBoard(4);
  const host = createMemoryPlatformServices({ files: { [sourcePath]: original } });
  host.answerQuestions("preview");
  host.answerSavePaths(copyPath);
  const copied = await upgradeBoardCopy({
    fs: host.fs, dialogs: host.dialogs, projectId: "memory-project", boardPath: sourcePath,
    operation: "tile-to-pixel", hasPendingEdits: () => false,
    createExclusive: null,
  });
  deepEqual(copied, { ok: true, value: copyPath });
  deepEqual(host.bytesOf(sourcePath), original);
  deepEqual(host.bytesOf(copyPath), original, "the new file starts as an exact copy");

  const identity = createDocumentIdentity("memory-project", copyPath);
  const opened = await openBoardDocument(host.fs, identity);
  ok(opened.ok);
  const doc = opened.document;
  const command = createBoardCoordinateUpgradeCommand(doc.serialize(), "tile-to-pixel");
  ok(command.ok, command.ok ? "" : command.message);
  const applied = doc.apply(command.value);
  ok(applied.ok, applied.ok ? "" : applied.rejection.message);
  equal(doc.getSnapshot().edits.length, 1);
  equal(doc.getSnapshot().edits[0]?.label, "Convert board coordinates");
  equal(decoded(doc.serialize()).board.coordType & 4, 4);
  deepEqual(doc.undo(applied.editId), { ok: true, editId: applied.editId });
  deepEqual(doc.serialize(), original, "one undo restores the untouched copied bytes");
  equal(doc.getSnapshot().canRedo, true);
  deepEqual(doc.redo(applied.editId), { ok: true, editId: applied.editId });
  ok((await doc.save()).ok);

  const reopened = await openBoardDocument(host.fs, identity);
  ok(reopened.ok);
  equal(decoded(reopened.document.serialize()).board.coordType & 4, 4);
  deepEqual(host.bytesOf(sourcePath), original);
});

void test("stacked-to-rotated maps every tile and shade cell while keeping board-pixel objects", () => {
  const original = decoded(exampleBoard(4)).board;
  const stacked = { ...original, coordType: (original.coordType & 4) | 1 };
  const result = planBoardCoordinateUpgrade(stacked, "stacked-to-rotated");
  ok(result.ok, result.ok ? "" : result.message);
  const converted = result.value.board;
  equal(coordLayout(converted.coordType), "iso-rotated");
  equal(converted.sizeX, stacked.sizeX);
  equal(converted.sizeY, stacked.sizeY);
  const before = boardGrid(stacked.sizeX, stacked.sizeY, stacked.coordType);
  const after = boardGrid(converted.sizeX, converted.sizeY, converted.coordType);
  for (let layer = 0; layer < stacked.sizeL; layer += 1) {
    for (let y = 1; y <= before.height; y += 1) {
      for (let x = 1; x <= before.width; x += 1) {
        const mapped = stackedToRotated(x, y, stacked.sizeX);
        const previousIndex = layer * before.width * before.height + (y - 1) * before.width + x - 1;
        const nextIndex = layer * after.width * after.height + (mapped.y - 1) * after.width + mapped.x - 1;
        equal(converted.tileMatrix[nextIndex], stacked.tileMatrix[previousIndex], `tile ${x},${y},${layer}`);
        deepEqual(
          tileToPixel("iso-rotated", stacked.sizeX, mapped.x, mapped.y),
          tileToPixel("iso-stacked", stacked.sizeX, x, y),
          `pixel position ${x},${y}`,
        );
      }
    }
  }
  equal(converted.shadeLayers.length, stacked.shadeLayers.length);
  for (let index = 0; index < stacked.shadeLayers.length; index += 1) {
    const sourceLayer = stacked.shadeLayers[index]!;
    const convertedLayer = converted.shadeLayers[index]!;
    equal(convertedLayer.castLayer, sourceLayer.castLayer);
    const sourceShade = expandedShade(sourceLayer.records, before.width * before.height);
    const convertedShade = expandedShade(convertedLayer.records, after.width * after.height);
    equal(sourceShade.length, before.width * before.height);
    equal(convertedShade.length, after.width * after.height);
    for (let y = 1; y <= before.height; y += 1) {
      for (let x = 1; x <= before.width; x += 1) {
        const mapped = stackedToRotated(x, y, stacked.sizeX);
        deepEqual(
          convertedShade[(mapped.y - 1) * after.width + mapped.x - 1],
          sourceShade[(y - 1) * before.width + x - 1],
          `shade ${x},${y}`,
        );
      }
    }
  }
  deepEqual(converted.vectors, stacked.vectors);
  deepEqual(converted.programs, stacked.programs);
  deepEqual(converted.sprites, stacked.sprites);
  deepEqual(converted.images, stacked.images);
  deepEqual(converted.lights, stacked.lights);
  deepEqual(converted.properties, stacked.properties);
});

void test("tile-to-pixel marks the board and leaves object coordinates and script text untouched", () => {
  const board = decoded(exampleBoard(4)).board;
  const result = planBoardCoordinateUpgrade(board, "tile-to-pixel");
  ok(result.ok, result.ok ? "" : result.message);
  equal(result.value.board.coordType, board.coordType | 4);
  deepEqual({ ...result.value.board, coordType: board.coordType }, board);
  match(result.value.summary, /script.*literal text are unchanged/i);
  const alreadyPixels = planBoardCoordinateUpgrade(result.value.board, "tile-to-pixel");
  ok(!alreadyPixels.ok);
});
void test("stacked-to-rotated refuses destination grids and run streams beyond board limits", () => {
  const template = decoded(exampleBoard(4)).board;
  const oversized = planBoardCoordinateUpgrade({
    ...template,
    sizeX: 2048,
    sizeY: 2047,
    sizeL: 1,
    coordType: (template.coordType & 4) | 1,
  }, "stacked-to-rotated");
  ok(!oversized.ok);
  match(oversized.message, /beyond the board limit/);

  const alternating = planBoardCoordinateUpgrade({
    ...template,
    sizeX: 256,
    sizeY: 256,
    sizeL: 1,
    coordType: (template.coordType & 4) | 1,
    tileMatrix: Array.from({ length: 256 * 256 }, (_, index) => index % 2),
  }, "stacked-to-rotated");
  ok(!alternating.ok);
  match(alternating.message, /more run records/);
});


void test("pre-vector upgrade writes a reopenable copy and retains the original bytes", async () => {
  const original = exampleBoard(3);
  const host = createMemoryPlatformServices({ files: { [sourcePath]: original } });
  host.answerQuestions("preview");
  host.answerSavePaths(copyPath);
  const result = await upgradeBoardCopy({
    fs: host.fs, dialogs: host.dialogs, projectId: "memory-project", boardPath: sourcePath,
    operation: "pre-vector", hasPendingEdits: () => false,
    createExclusive: async (destination, bytes) => {
      const temporary = "Boards/.board-upgrade-test.tmp";
      const written = await host.fs.writeProject("memory-project", temporary, bytes);
      if (!written.ok) return written;
      const moved = await host.fs.rename(temporary, destination);
      if (!moved.ok) await host.fs.deleteProject("memory-project", temporary);
      return moved;
    },
  });
  deepEqual(result, { ok: true, value: copyPath });
  deepEqual(host.bytesOf(sourcePath), original);
  const copy = decoded(host.bytesOf(copyPath)!);
  equal(copy.layout, "vector");
  equal(copy.board.minor, 4);
  const converted = decoded(original).board;
  deepEqual(copy.board.tileMatrix, converted.tileMatrix);
  deepEqual(copy.board.vectors, converted.vectors);
  deepEqual(copy.board.programs, converted.programs);
  deepEqual(copy.board.shadeLayers, converted.shadeLayers);
  deepEqual(copy.board.sprites, converted.sprites);
  deepEqual(copy.board.properties.start, converted.properties.start);
  equal(host.questions.length, 1);
  match(host.questions[0]!.detail, /original .* is retained/i);
});
void test("exclusive destination creation refuses a file created after the preflight check", async () => {
  const original = exampleBoard(3);
  const external = Uint8Array.of(3, 1, 4);
  const host = createMemoryPlatformServices({ files: { [sourcePath]: original } });
  host.answerQuestions("preview");
  host.answerSavePaths(copyPath);
  const result = await upgradeBoardCopy({
    fs: host.fs, dialogs: host.dialogs, projectId: "memory-project", boardPath: sourcePath,
    operation: "pre-vector", hasPendingEdits: () => false,
    createExclusive: async (destination, bytes) => {
      await host.fs.writeProject("memory-project", destination, external);
      const temporary = "Boards/.board-upgrade-race.tmp";
      const written = await host.fs.writeProject("memory-project", temporary, bytes);
      if (!written.ok) return written;
      const moved = await host.fs.rename(temporary, destination);
      if (!moved.ok) await host.fs.deleteProject("memory-project", temporary);
      return moved;
    },
  });
  ok(!result.ok);
  deepEqual(host.bytesOf(copyPath), external);
  deepEqual(host.bytesOf(sourcePath), original);
  equal(host.bytesOf("Boards/.board-upgrade-race.tmp"), undefined);
});


void test("cancel, stale source, destination collision, and failed writes preserve the source and create no partial copy", async () => {
  const original = exampleBoard(3);
  const cancelled = createMemoryPlatformServices({ files: { [sourcePath]: original } });
  cancelled.answerQuestions("cancel");
  const cancel = await upgradeBoardCopy({
    fs: cancelled.fs, dialogs: cancelled.dialogs, projectId: "memory-project", boardPath: sourcePath,
    operation: "pre-vector", hasPendingEdits: () => false,
    createExclusive: null,
  });
  deepEqual(cancel, { ok: true, value: null });
  equal(cancelled.bytesOf(copyPath), undefined);
  deepEqual(cancelled.bytesOf(sourcePath), original);

  const occupied = createMemoryPlatformServices({ files: { [sourcePath]: original, [copyPath]: Uint8Array.of(9, 8) } });
  occupied.answerQuestions("preview");
  occupied.answerSavePaths(copyPath);
  const conflict = await upgradeBoardCopy({
    fs: occupied.fs, dialogs: occupied.dialogs, projectId: "memory-project", boardPath: sourcePath,
    operation: "pre-vector", hasPendingEdits: () => false,
    createExclusive: null,
  });
  ok(!conflict.ok);
  equal(conflict.error.code, "already-exists");
  deepEqual(occupied.bytesOf(copyPath), Uint8Array.of(9, 8));
  deepEqual(occupied.bytesOf(sourcePath), original);

  const failed = createMemoryPlatformServices({ files: { [sourcePath]: original } });
  failed.answerQuestions("preview");
  failed.answerSavePaths(copyPath);
  failed.failWrites({ code: "io-error", message: "disk full" });
  const writeFailure = await upgradeBoardCopy({
    fs: failed.fs, dialogs: failed.dialogs, projectId: "memory-project", boardPath: sourcePath,
    operation: "pre-vector", hasPendingEdits: () => false,
    createExclusive: null,
  });
  ok(!writeFailure.ok);
  match(writeFailure.error.message, /disk full/);
  equal(failed.bytesOf(copyPath), undefined);
  deepEqual(failed.bytesOf(sourcePath), original);
});
void test("pending edits and unsupported pre-vector layouts refuse before review or writing", async () => {
  const original = exampleBoard(3);
  const dirty = createMemoryPlatformServices({ files: { [sourcePath]: original } });
  const rejectedPending = await upgradeBoardCopy({
    fs: dirty.fs, dialogs: dirty.dialogs, projectId: "memory-project", boardPath: sourcePath,
    operation: "pre-vector", hasPendingEdits: () => true,
    createExclusive: null,
  });
  ok(!rejectedPending.ok);
  match(rejectedPending.error.message, /pending edits/);
  equal(dirty.questions.length, 0);
  equal(dirty.bytesOf(copyPath), undefined);
  deepEqual(dirty.bytesOf(sourcePath), original);

  const rotated = original.slice();
  rotated[0x10f] = 2;
  const unsupported = createMemoryPlatformServices({ files: { [sourcePath]: rotated } });
  const refused = await upgradeBoardCopy({
    fs: unsupported.fs, dialogs: unsupported.dialogs, projectId: "memory-project", boardPath: sourcePath,
    operation: "pre-vector", hasPendingEdits: () => false,
    createExclusive: null,
  });
  ok(!refused.ok);
  match(refused.error.message, /rotated|coordinate|unsupported/i);
  equal(unsupported.questions.length, 0);
  equal(unsupported.bytesOf(copyPath), undefined);
  deepEqual(unsupported.bytesOf(sourcePath), rotated);
});

void test("source changes during the preview are not copied", async () => {
  const original = exampleBoard(3);
  const host = createMemoryPlatformServices({ files: { [sourcePath]: original } });
  const changed = Uint8Array.of(0);
  const result = await upgradeBoardCopy({
    fs: host.fs,
    dialogs: {
      ask: async () => {
        await host.fs.writeProject("memory-project", sourcePath, changed);
        return "preview";
      },
      pickSavePath: async () => copyPath,
    },
    projectId: "memory-project", boardPath: sourcePath, operation: "pre-vector", hasPendingEdits: () => false,
    createExclusive: null,
  });
  ok(!result.ok);
  match(result.error.message, /changed while.*reviewed/i);
  equal(host.bytesOf(copyPath), undefined);
  deepEqual(host.bytesOf(sourcePath), changed);
});
void test("upgrade refuses cross-game destinations and case-folded collisions", async () => {
  const original = exampleBoard(3);
  const host = createMemoryPlatformServices({
    files: { [sourcePath]: original, "Boards/ENTRY.UPGRADED.BRD": Uint8Array.of(7) },
  });
  host.answerQuestions("preview");
  host.answerSavePaths("boards/entry.upgraded.brd");
  const collision = await upgradeBoardCopy({
    fs: host.fs, dialogs: host.dialogs, projectId: "memory-project", boardPath: sourcePath,
    operation: "pre-vector", hasPendingEdits: () => false,
    createExclusive: null,
  });
  ok(!collision.ok);
  equal(collision.error.code, "already-exists");
  deepEqual(host.bytesOf("Boards/ENTRY.UPGRADED.BRD"), Uint8Array.of(7));

  const otherGame = createMemoryPlatformServices({ files: { [sourcePath]: original } });
  otherGame.answerQuestions("preview");
  otherGame.answerSavePaths("Game/Elsewhere/Boards/Entry.upgraded.brd");
  const refused = await upgradeBoardCopy({
    fs: otherGame.fs, dialogs: otherGame.dialogs, projectId: "memory-project", boardPath: sourcePath,
    operation: "pre-vector", hasPendingEdits: () => false,
    createExclusive: null,
  });
  ok(!refused.ok);
  match(refused.error.message, /same game's Boards folder/i);
  equal(otherGame.bytesOf("Game/Elsewhere/Boards/Entry.upgraded.brd"), undefined);
});

const legacyTextBoard = resolve("fixtures/legacy/Caoquest/Boards/Cao's house.brd");
void test("upgrade refuses a real Toolkit 2 text board", {
  skip: existsSync(legacyTextBoard) ? false : "run pnpm fixtures:fetch",
}, async () => {
  const original = new Uint8Array(readFileSync(legacyTextBoard));
  const host = createMemoryPlatformServices({ files: { [sourcePath]: original } });
  const refused = await upgradeBoardCopy({
    fs: host.fs, dialogs: host.dialogs, projectId: "memory-project", boardPath: sourcePath,
    operation: "pre-vector", hasPendingEdits: () => false,
    createExclusive: null,
  });
  ok(!refused.ok);
  match(refused.error.message, /binary pre-vector board|text boards/i);
  equal(host.questions.length, 0);
  equal(host.bytesOf(copyPath), undefined);
});

const documentedMinor2Board = resolve("docs/spec/examples/versions/board/board_minor2.brd");
void test("documented minor-2 layout example upgrades using independent fields from its byte listing", async () => {
  const original = new Uint8Array(readFileSync(documentedMinor2Board));
  deepEqual([original[15], original[17]], [2, 2], "the spec example header pins major and minor");
  const host = createMemoryPlatformServices({ files: { [sourcePath]: original } });
  host.answerQuestions("preview");
  host.answerSavePaths(copyPath);
  const result = await upgradeBoardCopy({
    fs: host.fs, dialogs: host.dialogs, projectId: "memory-project", boardPath: sourcePath,
    operation: "pre-vector", hasPendingEdits: () => false,
    createExclusive: null,
  });
  deepEqual(result, { ok: true, value: copyPath });
  deepEqual(host.bytesOf(sourcePath), original);
  const reopened = await openBoardDocument(host.fs, createDocumentIdentity("memory-project", copyPath));
  ok(reopened.ok);
  const board = decoded(reopened.document.serialize()).board;
  deepEqual([board.minor, board.sizeX, board.sizeY, board.sizeL, board.coordType], [4, 4, 3, 2, 0]);
  deepEqual(board.lut, ["", "village.tst1", "village.tst8"]);
  deepEqual(board.tileMatrix, [...Array<number>(12).fill(1), 2, ...Array<number>(11).fill(0)]);
  equal(board.vectors.length, 1);
  deepEqual(
    board.vectors[0]!.points.map(({ x, y }) => `${x},${y}`).sort(),
    ["0,0", "0,32", "32,0", "32,32"],
    "the second layer's solid cell becomes the documented 32-pixel rectangle",
  );
  deepEqual(
    { attributes: board.vectors[0]!.attributes, closed: board.vectors[0]!.closed, layer: board.vectors[0]!.layer, type: board.vectors[0]!.type, handle: board.vectors[0]!.handle },
    { attributes: 0, closed: -1, layer: 2, type: 1, handle: "" },
  );
  const program = board.programs[0]!;
  deepEqual(
    { ...program, points: [] },
    {
      program: "note.prg", graphic: "", initialVar: "", initialValue: "", finalVar: "", finalValue: "",
      activate: 0, activationType: 4, repeatDistance: 0, layer: 1, points: [], closed: -1, handle: "",
    },
  );
  deepEqual(
    program.points.map(({ x, y }) => `${x},${y}`).sort(),
    ["32,64", "32,96", "64,64", "64,96"],
    "the tile at (2, 3) becomes a 32-pixel trigger polygon",
  );
  deepEqual(board.sprites[0], {
    itemFile: "chest.itm", activationPrg: "", multitaskPrg: "", initialVar: "", initialValue: "",
    finalVar: "", finalValue: "", loadingVar: "", loadingValue: "", activate: 0, activationType: 0,
    x: 80, y: 63, layer: 1, reserved: -1,
  });
  deepEqual(board.properties.start, { x: 48, y: 63, layer: 1 });
  equal(board.properties.backgroundImage, "sky.png");
  equal(board.properties.backgroundDrawType, 1);
  deepEqual(board.links.east, "forest.brd");
  deepEqual(board.layerTitles.slice(0, 2), ["ground", ""]);
  deepEqual(board.shadeLayers, []);
});

const realMinor2Board = resolve("fixtures/legacy/Caoquest/Boards/red.brd");
void test("real minor-2 Red board upgrades, reopens and preserves independent stored content", {
  skip: existsSync(realMinor2Board) ? false : "run pnpm fixtures:fetch",
}, async () => {
  const original = new Uint8Array(readFileSync(realMinor2Board));
  deepEqual([original[15], original[17]], [2, 2]);
  const source = decoded(original);
  equal(source.layout, "pre-vector");
  deepEqual([source.board.sizeX, source.board.sizeY, source.board.sizeL], [19, 14, 8]);
  equal(source.board.vectors.length, 32);
  equal(source.board.programs.length, 24);
  equal(source.board.sprites.length, 2);
  equal(source.board.shadeLayers.length, 1);
  deepEqual(source.board.tileMatrix.slice(0, 12), [1, 2, 6, 6, 6, 12, 2, 6, 6, 6, 12, 1]);
  deepEqual(source.board.vectors[0]?.points.map(({ x, y }) => `${x},${y}`), ["32,0", "352,0", "352,32", "32,32"]);
  deepEqual(source.board.programs[0]?.points.map(({ x, y }) => `${x},${y}`), ["512,128", "544,128", "544,160", "512,160"]);
  deepEqual(source.board.sprites[0], {
    itemFile: "gem.itm", activationPrg: "", multitaskPrg: "", initialVar: "", initialValue: "",
    finalVar: "", finalValue: "", loadingVar: "", loadingValue: "", activate: 0, activationType: 0,
    x: 528, y: 95, layer: 1, reserved: -1,
  });
  deepEqual(source.board.shadeLayers[0]?.records.slice(0, 2), [
    { runCount: 16, r: 0, g: 0, b: 0 },
    { runCount: 1, r: -26, g: -26, b: -26 },
  ]);

  const host = createMemoryPlatformServices({ files: { [sourcePath]: original } });
  host.answerQuestions("preview");
  host.answerSavePaths(copyPath);
  const copied = await upgradeBoardCopy({
    fs: host.fs, dialogs: host.dialogs, projectId: "memory-project", boardPath: sourcePath,
    operation: "pre-vector", hasPendingEdits: () => false, createExclusive: null,
  });
  deepEqual(copied, { ok: true, value: copyPath });
  deepEqual(host.bytesOf(sourcePath), original);
  const reopened = await openBoardDocument(host.fs, createDocumentIdentity("memory-project", copyPath));
  ok(reopened.ok);
  const upgraded = decoded(reopened.document.serialize()).board;
  deepEqual([upgraded.minor, upgraded.sizeX, upgraded.sizeY, upgraded.sizeL], [4, 19, 14, 8]);
  equal(upgraded.tileMatrix.length, 19 * 14 * 8);
  equal(upgraded.vectors.length, 32);
  equal(upgraded.programs.length, 24);
  equal(upgraded.sprites.length, 2);
  equal(upgraded.shadeLayers.length, 1);
  deepEqual(upgraded.tileMatrix.slice(0, 12), source.board.tileMatrix.slice(0, 12));
  deepEqual(upgraded.vectors[0], source.board.vectors[0]);
  deepEqual(upgraded.programs[0], source.board.programs[0]);
  deepEqual(upgraded.sprites[0], source.board.sprites[0]);
  deepEqual(upgraded.shadeLayers[0], source.board.shadeLayers[0]);
  deepEqual(host.bytesOf(sourcePath), original);
});
