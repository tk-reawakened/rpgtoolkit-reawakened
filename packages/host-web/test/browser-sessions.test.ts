import { deepEqual, equal, notEqual } from "node:assert/strict";
import { test } from "node:test";
import { createFolderProject } from "../src/index.ts";

const emptyRoot = {
  kind: "directory",
  async *entries() {},
  async getDirectoryHandle() {
    throw new DOMException("Not found", "NotFoundError");
  },
  async getFileHandle() {
    throw new DOMException("Not found", "NotFoundError");
  },
} as unknown as FileSystemDirectoryHandle;

test("browser marks stay with the owning game while views switch and reopen in one project folder", () => {
  const project = createFolderProject(emptyRoot, { id: "web:shared-folder", name: "Shared folder" });

  const gameAView = project.browserSessionForGame("Games/A/main.gam");
  gameAView.update({ autotileMarks: ["Tiles/a.tst"] });
  const gameBView = project.browserSessionForGame("Games/B/main.gam");
  gameBView.update({ autotileMarks: ["Tiles/b.tst"] });

  notEqual(gameAView, gameBView, "distinct owning games get distinct sessions");
  deepEqual(gameAView.getSnapshot().autotileMarks, ["Tiles/a.tst"]);
  deepEqual(gameBView.getSnapshot().autotileMarks, ["Tiles/b.tst"]);

  const reopenedA = project.browserSessionForGame("Games/A/main.gam");
  equal(reopenedA, gameAView, "returning to a game reuses its session after the other view was active");
  deepEqual(reopenedA.getSnapshot().autotileMarks, ["Tiles/a.tst"], "closing and reopening a view retains that game's marks");
  equal(project.browserSessionForGame("Games/B/main.gam"), gameBView, "the other game's session also survives switching away");
  notEqual(project.browserSessionForGame(null), gameAView, "an ownerless view does not share a game's session");
});
