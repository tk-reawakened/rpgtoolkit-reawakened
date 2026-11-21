import { deepEqual, equal, match, ok } from "node:assert/strict";
import { test } from "node:test";
import { utf8Decode } from "@tk-reawakened/core";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { buildNewBoard, importSavedBoardAsScene, readScene } from "../src/index.ts";
import { exampleBoard } from "./fixtures.ts";

const boardPath = "Boards/Village.brd";
const scenePath = "Boards/Village.tkrscn";
const authored = (width: number): Uint8Array => {
  const result = buildNewBoard({ name: "Village", coordSystem: "2d", pixelCoordinates: false, width, height: 2, layers: 1, backgroundImage: "", template: null });
  ok(result.ok);
  return result.bytes;
};

void test("review writes nothing until approval, then writes just the case-preserved native scene", async () => {
  const board = authored(2);
  const host = createMemoryPlatformServices({ files: { [boardPath]: board } });
  const options = { fs: host.fs, dialogs: host.dialogs, projectId: "review", boardPath: "boards/village.BRD", hasPendingEdits: () => false };
  deepEqual(await importSavedBoardAsScene(options), { ok: true, value: null });
  equal(host.bytesOf(scenePath), undefined);
  deepEqual(host.bytesOf(boardPath), board);
  match(host.questions[0]!.message, /Boards\/Village\.brd/);
  match(host.questions[0]!.detail, /Boards\/Village\.tkrscn.*separate approval.*(?:note|warning)/);

  host.answerQuestions("import");
  deepEqual(await importSavedBoardAsScene(options), { ok: true, value: scenePath });
  deepEqual(host.bytesOf(boardPath), board);
  const scene = readScene(utf8Decode(host.bytesOf(scenePath)!));
  ok(scene.ok);
  equal(scene.scene.metadata?.["source"], boardPath);
  equal(scene.scene.size.width, 2);
  deepEqual(await host.fs.list(""), { ok: true, value: [{ name: "Boards", kind: "directory" }] });
});

void test("pre-vector boards import through the existing converter under a nested game", async () => {
  const source = "Game/Demo/Boards/maps/Entry.brd";
  const destination = "Game/Demo/Boards/maps/Entry.tkrscn";
  const board = exampleBoard(3);
  const host = createMemoryPlatformServices({ files: { [source]: board } });
  host.answerQuestions("import");
  const result = await importSavedBoardAsScene({ fs: host.fs, dialogs: host.dialogs, projectId: "older-board", boardPath: source, hasPendingEdits: () => false });
  deepEqual(result, { ok: true, value: destination });
  deepEqual(host.bytesOf(source), board);
  const scene = readScene(utf8Decode(host.bytesOf(destination)!));
  ok(scene.ok);
  equal(scene.scene.metadata?.["source"], source);
  ok(scene.scene.floors[0]?.tiles?.length);
});

void test("dirty, refused and occupied sources never offer to write an import", async () => {
  const board = authored(2);
  const host = createMemoryPlatformServices({ files: { [boardPath]: board, "Boards/Corrupt.brd": Uint8Array.of(0) } });
  const options = { fs: host.fs, dialogs: host.dialogs, projectId: "refusals", boardPath, hasPendingEdits: () => true };
  const dirty = await importSavedBoardAsScene(options);
  ok(!dirty.ok);
  match(dirty.error.message, /pending edits/);
  const corrupt = await importSavedBoardAsScene({ ...options, boardPath: "Boards/Corrupt.brd", hasPendingEdits: () => false });
  ok(!corrupt.ok);
  match(corrupt.error.message, /Corrupt\.brd/);
  await host.fs.createFolder("Boards/VILLAGE.TKRSCN");
  const occupied = await importSavedBoardAsScene({ ...options, hasPendingEdits: () => false });
  ok(!occupied.ok);
  match(occupied.error.message, /VILLAGE\.TKRSCN already exists/);
  deepEqual(host.questions, []);
  equal(host.bytesOf(scenePath), undefined);
  deepEqual(host.bytesOf(boardPath), board);
});

void test("a changed source or new destination during review stops the import", async () => {
  for (const change of ["board", "destination", "dirty"] as const) {
    const board = authored(2);
    const changedBoard = authored(3);
    const occupying = Uint8Array.of(7, 3);
    const host = createMemoryPlatformServices({ files: { [boardPath]: board } });
    let dirty = false;
    const result = await importSavedBoardAsScene({
      fs: host.fs, projectId: `race-${change}`, boardPath, hasPendingEdits: () => dirty,
      dialogs: { async ask(question) {
        if (change === "board") ok((await host.fs.write(boardPath, changedBoard)).ok);
        else if (change === "destination") ok((await host.fs.write("Boards/VILLAGE.TKRSCN", occupying)).ok);
        else dirty = true;
        return question.choices[1]!.id;
      } },
    });
    ok(!result.ok);
    match(result.error.message, change === "board" ? /changed during import review/ : change === "destination" ? /already exists/ : /pending edits/);
    deepEqual(host.bytesOf(scenePath), change === "destination" ? occupying : undefined);
    deepEqual(host.bytesOf(boardPath), change === "board" ? changedBoard : board);
  }
});
