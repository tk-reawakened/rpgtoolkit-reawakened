import { deepEqual, equal, match, ok } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { boardGrid, coordLayout, decodeBoard, stackedToRotated, tileToPixel, writeBoard } from "@tk-reawakened/core";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { boardCodec, createBoardCoordinateUpgradeCommand, createBoardFile, createDocumentIdentity, openBoardDocument, planBoardCoordinateUpgrade, upgradeBoardCopy } from "../src/index.ts";
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
  ok(copied.ok, copied.ok ? "" : copied.error.message);
  ok(copied.value !== null);
  equal(copied.value.destination, copyPath);
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
  match(result.value.preview, /L\d+ \(\d+,\d+\) tile \d+ → \(\d+,\d+\)/);
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
  match(result.value.preview, /Coordinate flag \d+ → \d+/);
  const alreadyPixels = planBoardCoordinateUpgrade(result.value.board, "tile-to-pixel");
  ok(!alreadyPixels.ok);
});
void test("stacked-to-rotated refuses destination grids beyond board limits", () => {
  const template = decoded(exampleBoard(4)).board;
  const oversized = planBoardCoordinateUpgrade({
    ...template,
    sizeX: 2048,
    sizeY: 2047,
    sizeL: 1,
    coordType: (template.coordType & 4) | 1,
  }, "stacked-to-rotated");
  ok(!oversized.ok);
  match(oversized.message, /board limit/);

  const zeroLayers = planBoardCoordinateUpgrade({
    ...template,
    sizeX: 2048,
    sizeY: 2048,
    sizeL: 0,
    coordType: (template.coordType & 4) | 1,
    tileMatrix: [],
  }, "stacked-to-rotated");
  ok(!zeroLayers.ok);
  match(zeroLayers.message, /per-layer grid exceeds/);
});

void test("stacked-to-rotated saves and reopens more than 32,768 single-cell runs", () => {
  const template = decoded(exampleBoard(4)).board;
  const planned = planBoardCoordinateUpgrade({
    ...template,
    sizeX: 256,
    sizeY: 256,
    sizeL: template.sizeL,
    coordType: (template.coordType & 4) | 1,
    tileMatrix: Array.from({ length: 256 * 256 * template.sizeL }, (_, index) => index % 2),
    shadeLayers: [],
  }, "stacked-to-rotated");
  ok(planned.ok, planned.ok ? "" : planned.message);
  ok(planned.value.board.tileRuns.length > 32_768);
  ok(planned.value.board.tileRuns.every((run) => run.count <= 32_768));
  const encoded = writeBoard(planned.value.board);
  ok(encoded.ok, encoded.ok ? "" : encoded.error.message);
  const reopened = decodeBoard(encoded.value);
  ok(reopened.ok, reopened.ok ? "" : reopened.error.message);
  equal(reopened.value.board.tileRuns.length, planned.value.board.tileRuns.length);
  deepEqual(reopened.value.board.tileMatrix, planned.value.board.tileMatrix);
});

void test("tile-run command validation does not confuse record count with LUT capacity", () => {
  const runs = Array.from({ length: 32_769 }, () => ({ lutIndex: 0, count: 1, marker: false }));
  ok(boardCodec.isCommand({ type: "set-board-fields", fields: { tileRuns: runs } }));
});


void test("pre-vector upgrade writes a reopenable copy and retains the original bytes", async () => {
  const original = exampleBoard(3);
  const host = createMemoryPlatformServices({ files: { [sourcePath]: original } });
  host.answerQuestions("preview");
  host.answerSavePaths(copyPath);
  const result = await upgradeBoardCopy({
    fs: host.fs, dialogs: host.dialogs, projectId: "memory-project", boardPath: sourcePath,
    operation: "pre-vector", hasPendingEdits: () => false,
    createExclusive: null,
  });
  ok(result.ok, result.ok ? "" : result.error.message);
  ok(result.value !== null);
  equal(result.value.destination, copyPath);
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
  match(host.questions[0]!.detail, /Minor-4 output: .*vector 1 points/);
  match(host.questions[0]!.detail, /external process.*could replace/i);
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
  host.answerQuestions("preview");
  const changed = Uint8Array.of(0);
  const result = await upgradeBoardCopy({
    fs: host.fs,
    dialogs: {
      ask: async (question) => {
        await host.fs.writeProject("memory-project", sourcePath, changed);
        return host.dialogs.ask(question);
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
void test("pending edits are checked again after the final source read", async () => {
  const host = createMemoryPlatformServices({ files: { [sourcePath]: exampleBoard(3) } });
  host.answerQuestions("preview");
  host.answerSavePaths(copyPath);
  let readCount = 0;
  let pending = false;
  const fs = {
    ...host.fs,
    readProject: async (projectId: string, path: string) => {
      const result = await host.fs.readProject(projectId, path);
      readCount += 1;
      if (readCount === 3) pending = true;
      return result;
    },
  };
  const result = await upgradeBoardCopy({
    fs, dialogs: host.dialogs, projectId: "memory-project", boardPath: sourcePath,
    operation: "pre-vector", hasPendingEdits: () => pending, hasPendingEditsNow: () => pending, createExclusive: null,
  });
  ok(!result.ok);
  match(result.error.message, /pending edits/);
  equal(readCount, 3);
  equal(host.bytesOf(copyPath), undefined);
});
void test("destination is checked again after the final async pending-edit settle", async () => {
  const host = createMemoryPlatformServices({ files: { [sourcePath]: exampleBoard(3) } });
  host.answerQuestions("preview");
  host.answerSavePaths(copyPath);
  let settles = 0;
  const occupied = Uint8Array.of(77);
  const result = await upgradeBoardCopy({
    fs: host.fs, dialogs: host.dialogs, projectId: "memory-project", boardPath: sourcePath,
    operation: "pre-vector",
    hasPendingEdits: async () => {
      settles += 1;
      if (settles === 4) await host.fs.writeProject("memory-project", copyPath, occupied);
      return false;
    },
    createExclusive: null,
  });
  ok(!result.ok);
  equal(result.error.code, "already-exists");
  deepEqual(host.bytesOf(copyPath), occupied);
});
void test("New Board creation and upgrades serialize writes to one same-editor destination", async () => {
  const host = createMemoryPlatformServices({ files: { [sourcePath]: exampleBoard(3) } });
  let entered!: () => void;
  let release!: () => void;
  const reachedList = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fs = {
    ...host.fs,
    list: async (path: string) => {
      if (path === "Boards") {
        entered();
        await gate;
      }
      return host.fs.list(path);
    },
  };
  const creating = createBoardFile(
    fs,
    { projectFolder: "" },
    { name: "Entry.upgraded", coordSystem: "2d", pixelCoordinates: false, width: 4, height: 3, layers: 1, backgroundImage: "", template: null },
    undefined,
    "memory-project",
  );
  await reachedList;
  host.answerQuestions("preview");
  host.answerSavePaths(copyPath);
  const upgrading = upgradeBoardCopy({
    fs: host.fs, dialogs: host.dialogs, projectId: "memory-project", boardPath: sourcePath,
    operation: "pre-vector", hasPendingEdits: () => false, createExclusive: null,
  });
  release();
  const created = await creating;
  ok(created.ok);
  const result = await upgrading;
  ok(!result.ok);
  equal(result.error.code, "already-exists");
  ok(host.bytesOf(copyPath) !== undefined);
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

void test("already-open copies are refused, destination folders resolve their stored casing, and ancestor links are rejected", async () => {
  const original = exampleBoard(3);
  const openCopyHost = createMemoryPlatformServices({ files: { [sourcePath]: original } });
  openCopyHost.answerQuestions("preview");
  openCopyHost.answerSavePaths(copyPath);
  const openCopy = await upgradeBoardCopy({
    fs: openCopyHost.fs, dialogs: openCopyHost.dialogs, projectId: "memory-project", boardPath: sourcePath,
    operation: "pre-vector", hasPendingEdits: () => false, isDestinationOpen: () => true, createExclusive: null,
  });
  ok(!openCopy.ok);
  match(openCopy.error.message, /already open or cached/);
  equal(openCopyHost.bytesOf(copyPath), undefined);

  const foldedFolderHost = createMemoryPlatformServices({
    files: { [sourcePath]: original, "Boards/nested/existing.brd": Uint8Array.of(1) },
  });
  foldedFolderHost.answerQuestions("preview");
  foldedFolderHost.answerSavePaths("Boards/Nested/New.brd");
  const foldedFolder = await upgradeBoardCopy({
    fs: foldedFolderHost.fs, dialogs: foldedFolderHost.dialogs, projectId: "memory-project", boardPath: sourcePath,
    operation: "pre-vector", hasPendingEdits: () => false, createExclusive: null,
  });
  ok(foldedFolder.ok, foldedFolder.ok ? "" : foldedFolder.error.message);
  ok(foldedFolder.value !== null);
  equal(foldedFolder.value.destination, "Boards/nested/New.brd");
  equal(decoded(foldedFolderHost.bytesOf("Boards/nested/New.brd")!).board.minor, 4);

  const linkedHost = createMemoryPlatformServices({ files: { [sourcePath]: original } });
  linkedHost.answerQuestions("preview");
  linkedHost.answerSavePaths("Boards/Nested/New.brd");
  const linkedFs = {
    ...linkedHost.fs,
    listProject: async (projectId: string, path: string) => path === "Boards"
      ? { ok: true as const, value: [{ name: "Nested", kind: "link" as const }] }
      : linkedHost.fs.listProject(projectId, path),
  };
  const linked = await upgradeBoardCopy({
    fs: linkedFs, dialogs: linkedHost.dialogs, projectId: "memory-project", boardPath: sourcePath,
    operation: "pre-vector", hasPendingEdits: () => false, createExclusive: null,
  });
  ok(!linked.ok);
  equal(linked.error.code, "already-exists");
  match(linked.error.message, /conflicts with the destination/);
  equal(linkedHost.bytesOf("Boards/Nested/New.brd"), undefined);
  const ambiguousHost = createMemoryPlatformServices({ files: { [sourcePath]: original } });
  ambiguousHost.answerQuestions("preview");
  ambiguousHost.answerSavePaths("Boards/VILLAGE/New.brd");
  const ambiguousFs = {
    ...ambiguousHost.fs,
    listProject: async (projectId: string, path: string) => path === "Boards"
      ? { ok: true as const, value: [{ name: "Village", kind: "directory" as const }, { name: "village", kind: "directory" as const }] }
      : ambiguousHost.fs.listProject(projectId, path),
  };
  const ambiguous = await upgradeBoardCopy({
    fs: ambiguousFs, dialogs: ambiguousHost.dialogs, projectId: "memory-project", boardPath: sourcePath,
    operation: "pre-vector", hasPendingEdits: () => false, createExclusive: null,
  });
  ok(!ambiguous.ok);
  equal(ambiguous.error.code, "already-exists");
  match(ambiguous.error.message, /multiple case-folded entries/);
  equal(ambiguousHost.bytesOf("Boards/VILLAGE/New.brd"), undefined);
});

const literalScript = resolve("fixtures/legacy/Caoquest/Prg/aftercreeps.prg");
void test("real external script coordinate literals remain byte-for-byte unchanged by a board upgrade", {
  skip: existsSync(literalScript) ? false : "run pnpm fixtures:fetch",
}, async () => {
  const source = exampleBoard(3);
  const scriptBytes = new Uint8Array(readFileSync(literalScript));
  const scriptPath = "Prg/aftercreeps.prg";
  match(new TextDecoder().decode(scriptBytes), /#PutPlayer\("Koji",14,6,1\)/);
  const host = createMemoryPlatformServices({ files: { [sourcePath]: source, [scriptPath]: scriptBytes } });
  host.answerQuestions("preview");
  host.answerSavePaths(copyPath);
  const copied = await upgradeBoardCopy({
    fs: host.fs, dialogs: host.dialogs, projectId: "memory-project", boardPath: sourcePath,
    operation: "pre-vector", hasPendingEdits: () => false, createExclusive: null,
  });
  ok(copied.ok, copied.ok ? "" : copied.error.message);
  ok(copied.value !== null);
  equal(copied.value.destination, copyPath);
  deepEqual(host.bytesOf(sourcePath), source);
  deepEqual(host.bytesOf(scriptPath), scriptBytes);
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
  ok(result.ok, result.ok ? "" : result.error.message);
  ok(result.value !== null);
  equal(result.value.destination, copyPath);
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
  ok(copied.ok, copied.ok ? "" : copied.error.message);
  ok(copied.value !== null);
  equal(copied.value.destination, copyPath);
  deepEqual(host.bytesOf(sourcePath), original);
  const reopened = await openBoardDocument(host.fs, createDocumentIdentity("memory-project", copyPath));
  ok(reopened.ok);
  const upgraded = decoded(reopened.document.serialize()).board;
  deepEqual([upgraded.minor, upgraded.sizeX, upgraded.sizeY, upgraded.sizeL], [4, 19, 14, 8]);
  equal(upgraded.tileMatrix.length, 19 * 14 * 8);
  equal(upgraded.vectors.length, 32);
  equal(upgraded.programs.length, 24);
  deepEqual(upgraded.programs.map(({ program }) => program), source.board.programs.filter(({ program }) => program !== "").map(({ program }) => program));
  deepEqual(upgraded.sprites.map(({ itemFile }) => itemFile), source.board.sprites.filter(({ itemFile }) => itemFile !== "").map(({ itemFile }) => itemFile));
  equal(upgraded.shadeLayers.length, 1);
  deepEqual(upgraded.tileMatrix.slice(0, 12), source.board.tileMatrix.slice(0, 12));
  deepEqual(upgraded.vectors[0], source.board.vectors[0]);
  deepEqual(upgraded.programs[0], source.board.programs[0]);
  deepEqual(upgraded.sprites[0], source.board.sprites[0]);
  deepEqual(upgraded.shadeLayers[0], source.board.shadeLayers[0]);
  deepEqual(host.bytesOf(sourcePath), original);
});
