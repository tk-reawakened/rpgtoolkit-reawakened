import { deepEqual } from "node:assert/strict";
import test from "node:test";
import { createEmptyBoard, writeBoard } from "@tk-reawakened/core";
import type { DirectoryEntry, FileSystemService } from "@tk-reawakened/platform-services";
import { resolveVisualFixtureBoardCoordinates } from "../src/visual-fixture-board.ts";

type FixtureFileSystem = Pick<FileSystemService, "list" | "read">;

function board(width: number, height: number): Uint8Array {
  const cells = width * height;
  const result = writeBoard({
    ...createEmptyBoard(),
    sizeX: width,
    sizeY: height,
    sizeL: 1,
    tileMatrix: new Array<number>(cells).fill(0),
    tileRuns: [{ lutIndex: 0, count: cells, marker: true }],
    layerTitles: ["", ""],
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function memoryFileSystem(files: readonly (readonly [string, Uint8Array])[]): FixtureFileSystem {
  const contents = new Map(files);
  return {
    async list(directory) {
      const prefix = directory === "" ? "" : `${directory}/`;
      const entries = new Map<string, DirectoryEntry>();
      for (const path of contents.keys()) {
        if (!path.startsWith(prefix)) continue;
        const remainder = path.slice(prefix.length);
        if (remainder === "") continue;
        const separator = remainder.indexOf("/");
        const name = separator === -1 ? remainder : remainder.slice(0, separator);
        entries.set(name, { name, kind: separator === -1 ? "file" : "directory" });
      }
      return { ok: true, value: [...entries.values()] };
    },
    async read(path) {
      const bytes = contents.get(path);
      return bytes === undefined
        ? { ok: false, error: { code: "not-found", message: "missing" } }
        : { ok: true, value: bytes };
    },
  };
}

test("visual fixture board bounds match the runner's case-insensitive overlay selection", async () => {
  const fs = memoryFileSystem([
    ["Boards/wall.brd", board(2, 2)],
    [".TKR-Tests/Boards/Other.brd", board(1, 1)],
    [".TKR-Tests/boards/WALL.brd", board(16, 9)],
    [".tkr-tests/boards/WALL.brd", board(32, 20)],
  ]);

  deepEqual(await resolveVisualFixtureBoardCoordinates(fs, "Boards/wall.brd"), {
    mode: "tile",
    width: 16,
    height: 9,
  });
});

test("visual fixture board bounds fall back to the project file when no overlay exists", async () => {
  const fs = memoryFileSystem([["Boards/wall.brd", board(7, 5)]]);

  deepEqual(await resolveVisualFixtureBoardCoordinates(fs, "Boards/wall.brd"), {
    mode: "tile",
    width: 7,
    height: 5,
  });
});
