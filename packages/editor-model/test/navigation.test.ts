// Workspace navigation (story 11.4): the file tree, the Game list, tabs, the layout, and visits. Each is exercised over
// the real workspace and the in-memory host, with the refusals and the host failures the story's acceptance names.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { platformError } from "@tk-reawakened/platform-services";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createDocumentWorkspace, createLayoutModel, createProjectTree, createTabs, createVisits, listGame } from "../src/index.ts";
import { exampleBoard, exampleMain } from "./fixtures.ts";

const FILES = {
  "Main/example.gam": exampleMain(9),
  "Boards/village.brd": exampleBoard(4),
  "Boards/caves/mine.brd": exampleBoard(4),
  "Chrs/hero.tem": new Uint8Array([1]),
  "Misc/readme.txt": new Uint8Array([2]),
} as const;

function setup(capabilities?: readonly ("folderWrite" | "fileWatch" | "openExternal")[]) {
  const host = createMemoryPlatformServices({ files: FILES, ...(capabilities === undefined ? {} : { capabilities }) });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const tree = createProjectTree({ services: host, workspace });
  return { host, workspace, tree };
}

const paths = (tree: ReturnType<typeof setup>["tree"]): string[] => tree.getSnapshot().rows.map((row) => `${"  ".repeat(row.depth)}${row.name}${row.kind === "directory" ? "/" : ""}`);

test("the tree lists the project folders first, in ASCII-folded order, and expands and collapses folders", async () => {
  const { tree } = setup();
  await tree.refresh();
  deepEqual(paths(tree), ["Boards/", "Chrs/", "Main/", "Misc/"]);
  await tree.toggle("Boards");
  deepEqual(paths(tree), ["Boards/", "  caves/", "  village.brd", "Chrs/", "Main/", "Misc/"]);
  await tree.toggle("Boards/caves");
  equal(tree.getSnapshot().rows.some((row) => row.path === "Boards/caves/mine.brd" && row.depth === 2), true);
  tree.collapseAll();
  deepEqual(paths(tree), ["Boards/", "Chrs/", "Main/", "Misc/"]);
  await tree.toggle("Boards");
  await tree.toggle("Boards");
  deepEqual(paths(tree), ["Boards/", "Chrs/", "Main/", "Misc/"]);
});

test("a file's route says what opening it does: an editor, the OS, or an explanation", async () => {
  const withShell = setup(["folderWrite", "openExternal"]);
  await withShell.tree.refresh();
  await withShell.tree.toggle("Boards");
  await withShell.tree.toggle("Misc");
  const row = (path: string) => withShell.tree.getSnapshot().rows.find((entry) => entry.path === path);
  deepEqual([row("Boards/village.brd")?.route, row("Boards/village.brd")?.documentKind], ["document", "board"]);
  deepEqual([row("Misc/readme.txt")?.route, row("Misc/readme.txt")?.documentKind], ["external", null]);
  const without = setup(["folderWrite"]);
  await without.tree.refresh();
  await without.tree.toggle("Misc");
  equal(without.tree.getSnapshot().rows.find((entry) => entry.path === "Misc/readme.txt")?.route, "unavailable");
});

test("opening a Toolkit file opens its document; any other file goes to the OS only where the host can", async () => {
  const { host, tree, workspace } = setup(["folderWrite", "openExternal"]);
  await tree.refresh();
  const board = await tree.open("Boards/village.brd");
  ok(board.ok && board.via === "document");
  equal(board.document.kind, "board");
  equal(workspace.documents().length, 1);
  const external = await tree.open("Misc/readme.txt");
  ok(external.ok && external.via === "external");
  deepEqual(host.openedExternally, ["Misc/readme.txt"]);
  const vanished = await tree.open("Misc/gone.txt");
  ok(!vanished.ok);
  ok(tree.getSnapshot().message?.includes("could not be opened in another application"));

  const plain = setup(["folderWrite"]);
  const refused = await plain.tree.open("Misc/readme.txt");
  ok(!refused.ok && refused.error.kind === "unavailable");
  ok(plain.tree.getSnapshot().message?.includes("this host cannot open it in another application"));
  deepEqual(plain.host.openedExternally, []);
  const corrupt = createMemoryPlatformServices({ files: { "Boards/bad.brd": new Uint8Array([1, 2, 3]) } });
  const badTree = createProjectTree({ services: corrupt, workspace: createDocumentWorkspace({ projectId: "memory-project", services: corrupt }) });
  const bad = await badTree.open("Boards/bad.brd");
  ok(!bad.ok);
  ok(badTree.getSnapshot().message?.includes("Boards/bad.brd"));
});

test("a document reached from the tree and from the Game list is one model, and the tree marks it open", async () => {
  const { host, tree, workspace } = setup();
  await tree.refresh();
  await tree.toggle("Boards");
  const game = await listGame(host.fs, { projectFolder: "" });
  deepEqual(game.groups.map((group) => group.label), ["Boards", "Characters", "Animations"], "Misc is the animations folder, so its readme is listed there, as not openable");
  equal(game.groups[2]!.files[0]?.openable, false);
  const boards = game.groups[0]!;
  deepEqual(boards.files.map((file) => [file.path, file.openable]), [["Boards/caves/mine.brd", true], ["Boards/village.brd", true]]);
  equal(game.groups[1]!.files[0]?.openable, false, "a .tem has no editor yet: the Game list says so instead of offering it");
  const viaFiles = await tree.open("Boards/village.brd");
  const viaGame = await tree.open(boards.files[1]!.path);
  ok(viaFiles.ok && viaGame.ok && viaFiles.via === "document" && viaGame.via === "document");
  equal(viaFiles.document, viaGame.document, "one document from two routes");
  equal(workspace.documents().length, 1);
  equal(tree.getSnapshot().rows.find((row) => row.path === "Boards/village.brd")?.open, true);
});

test("rename and delete refuse while a document under the path is open, and delete asks first", async () => {
  const { host, tree, workspace } = setup();
  await tree.refresh();
  await tree.toggle("Boards");
  const opened = await tree.open("Boards/village.brd");
  ok(opened.ok && opened.via === "document");

  const renameOpen = await tree.rename("Boards/village.brd", "town.brd");
  ok(!renameOpen.ok && renameOpen.reason === "refused");
  const renameFolder = await tree.rename("Boards", "Maps");
  ok(!renameFolder.ok && renameFolder.reason === "refused", "a folder holding an open document is refused too");
  equal(host.bytesOf("Boards/village.brd") !== undefined, true);
  const deleteOpen = await tree.remove("Boards/village.brd");
  ok(!deleteOpen.ok && deleteOpen.reason === "refused");
  equal(host.questions.length, 0, "a refusal asks nothing");

  await workspace.close(opened.document);
  const renamed = await tree.rename("Boards/village.brd", "town.brd");
  ok(renamed.ok);
  equal(host.bytesOf("Boards/village.brd"), undefined);
  ok(host.bytesOf("Boards/town.brd") !== undefined);
  ok(tree.getSnapshot().rows.some((row) => row.path === "Boards/town.brd"));

  const cancelled = await tree.remove("Boards/town.brd");
  ok(!cancelled.ok && cancelled.reason === "cancelled", "no answer is queued, so the question is dismissed");
  ok(host.bytesOf("Boards/town.brd") !== undefined);
  host.answerQuestions("delete");
  ok((await tree.remove("Boards/town.brd")).ok);
  equal(host.bytesOf("Boards/town.brd"), undefined);
  host.answerQuestions("delete");
  ok((await tree.remove("Boards/caves")).ok);
  equal(host.bytesOf("Boards/caves/mine.brd"), undefined);
  ok(host.questions.at(-1)?.message.includes("and everything in it"));
});

test("a rename refuses a bad name or a taken name (compared without A-Z case) and a failed host call is reported", async () => {
  const { host, tree } = setup();
  await tree.refresh();
  await tree.toggle("Boards");
  for (const name of ["", "..", "a/b.brd", "x\u0000.brd"]) {
    const result = await tree.rename("Boards/village.brd", name);
    ok(!result.ok && result.reason === "refused", JSON.stringify(name));
  }
  const taken = await tree.rename("Boards/village.brd", "CAVES");
  ok(!taken.ok && taken.reason === "refused" && taken.message.includes("already exists"));
  const sameSpelling = await tree.rename("Boards/village.brd", "Village.brd");
  ok(sameSpelling.ok, "changing only the case of its own name is allowed");
  const failing = { ...host, fs: { ...host.fs, rename: () => Promise.resolve(platformError("permission-denied", "the folder is read-only")) } };
  const stuck = createProjectTree({ services: failing, workspace: createDocumentWorkspace({ projectId: "memory-project", services: host }) });
  await stuck.refresh();
  const refused = await stuck.rename("Misc/readme.txt", "notes.txt");
  ok(!refused.ok && refused.reason === "failed" && refused.message.includes("the folder is read-only"));
  equal(stuck.getSnapshot().message, refused.message);
});

test("a folder the host cannot list is named in the snapshot, not shown as quietly empty", async () => {
  const host = createMemoryPlatformServices({ files: FILES });
  const fs = { ...host.fs, list: (path: string) => (path === "Misc" ? Promise.resolve(platformError("permission-denied", "no access")) : host.fs.list(path)) };
  const tree = createProjectTree({ services: { ...host, fs }, workspace: createDocumentWorkspace({ projectId: "memory-project", services: host }) });
  await tree.refresh();
  await tree.toggle("Misc");
  deepEqual(tree.getSnapshot().failures.map((failure) => failure.path), ["Misc"]);
});

test("tabs hold one tab per document, wrap with next and previous, reorder, and ask before closing unsaved work", async () => {
  const { host, tree, workspace } = setup();
  const tabs = createTabs(workspace);
  await tree.refresh();
  const a = await tree.open("Boards/village.brd");
  const b = await tree.open("Boards/caves/mine.brd");
  ok(a.ok && a.via === "document" && b.ok && b.via === "document");
  tabs.open(a.document);
  tabs.open(b.document);
  tabs.open(a.document);
  deepEqual(tabs.getSnapshot().tabs.map((tab) => tab.path), ["Boards/village.brd", "Boards/caves/mine.brd"], "the same document opened twice is one tab");
  equal(tabs.getSnapshot().active, a.document.identity.key);
  tabs.next();
  equal(tabs.getSnapshot().active, b.document.identity.key);
  tabs.next();
  equal(tabs.getSnapshot().active, a.document.identity.key, "next wraps round");
  tabs.previous();
  equal(tabs.getSnapshot().active, b.document.identity.key);
  tabs.move(b.document.identity.key, 0);
  deepEqual(tabs.getSnapshot().tabs.map((tab) => tab.path), ["Boards/caves/mine.brd", "Boards/village.brd"]);

  ok(a.document.apply({ type: "set-tile", layer: 0, x: 0, y: 0, tile: "village.tst2" }).ok);
  equal(tabs.getSnapshot().tabs.find((tab) => tab.key === a.document.identity.key)?.dirty, true, "a tab shows its document's unsaved state");
  const kept = await tabs.close(a.document.identity.key);
  deepEqual(kept, { closed: false, reason: "cancelled" });
  equal(tabs.getSnapshot().tabs.length, 2, "a cancelled close keeps the tab and the work");
  host.answerQuestions("discard");
  deepEqual(await tabs.close(a.document.identity.key), { closed: true });
  deepEqual(tabs.getSnapshot().tabs.map((tab) => tab.path), ["Boards/caves/mine.brd"]);
  equal(tabs.getSnapshot().active, b.document.identity.key);
  equal(workspace.documents().length, 1, "the discarded document's model is gone");
  deepEqual(await tabs.close(b.document.identity.key), { closed: true });
  equal(tabs.getSnapshot().active, null);
  tabs.dispose();
});

test("the layout shows, hides, resizes within limits, docks, and round-trips by identifiers only", () => {
  const layout = createLayoutModel([
    { id: "files", title: "Files", side: "left", visible: true, size: 240, minSize: 120, maxSize: 480 },
    { id: "game", title: "Game", side: "left", visible: false, size: 240, minSize: 120, maxSize: 480 },
    { id: "help", title: "Help", side: "bottom", visible: true, size: 160, minSize: 80, maxSize: 400 },
  ]);
  let changes = 0;
  layout.subscribe(() => { changes += 1; });
  layout.toggle("game");
  layout.hide("files");
  layout.hide("files");
  equal(changes, 2, "hiding a hidden panel is not a change");
  layout.resize("help", 1000);
  layout.resize("help", -1000);
  deepEqual(layout.getPanels().find((panel) => panel.id === "help")?.size, 80, "resize is clamped to the panel's limits");
  layout.move("help", "right");
  layout.resize("game", 33.9);
  const saved = layout.save();
  deepEqual(saved.panels.map((panel) => Object.keys(panel).sort()), saved.panels.map(() => ["id", "side", "size", "visible"]));
  const fresh = createLayoutModel([
    { id: "files", title: "Files", side: "left", visible: true, size: 240, minSize: 120, maxSize: 480 },
    { id: "game", title: "Game", side: "left", visible: false, size: 240, minSize: 120, maxSize: 480 },
    { id: "help", title: "Help", side: "bottom", visible: true, size: 160, minSize: 80, maxSize: 400 },
  ]);
  fresh.restore(JSON.parse(JSON.stringify(saved)));
  deepEqual(fresh.save(), saved);
  fresh.restore({ panels: [{ id: "gone", side: "left", visible: true, size: 10 }, { id: "files", side: "diagonal", visible: "yes", size: 99999 }, "x", null] });
  const files = fresh.getPanels().find((panel) => panel.id === "files");
  deepEqual([files?.side, files?.visible, files?.size], ["left", false, 480], "a panel this build does not have is ignored; bad values are clamped or ignored");
  fresh.restore("not a layout");
  equal(fresh.getPanels().length, 3);
});

test("a visit opens the linked document and returns to its origin; a closed origin reopens from its file and says so", async () => {
  const { host, tree, workspace } = setup();
  const visits = createVisits(workspace);
  await tree.refresh();
  const origin = await tree.open("Boards/village.brd");
  ok(origin.ok && origin.via === "document");

  const visited = await visits.visit(origin.document, "Boards/caves/mine.brd");
  ok(visited.ok);
  equal(visited.document.identity.path, "Boards/caves/mine.brd");
  deepEqual(visits.getSnapshot().stack, [{ originPath: "Boards/village.brd", targetPath: "Boards/caves/mine.brd" }]);
  const again = await visits.visit(origin.document, "boards/CAVES/mine.brd");
  ok(again.ok);
  equal(again.document, visited.document, "the same document by another spelling is the same model");
  equal(visits.getSnapshot().stack.length, 1, "visiting the same link twice is one visit");

  const back = await visits.returnFromVisit();
  ok(back.ok && !back.reopened);
  equal(back.document, origin.document);
  equal(visits.getSnapshot().canReturn, false);
  deepEqual(await visits.returnFromVisit(), { ok: false, reason: "nothing-to-return-to", message: "There is no visit to return from." });

  await visits.visit(origin.document, "Boards/caves/mine.brd");
  await workspace.close(origin.document);
  const reopened = await visits.returnFromVisit();
  ok(reopened.ok && reopened.reopened);
  equal(reopened.document.identity.path, "Boards/village.brd");
  ok(reopened.message?.includes("opened again from its file"));

  await visits.visit(reopened.document, "Boards/caves/mine.brd");
  await workspace.close(reopened.document);
  await host.fs.delete("Boards/village.brd");
  const lost = await visits.returnFromVisit();
  ok(!lost.ok && lost.reason === "origin-lost");
  ok(lost.message.includes("Nothing was changed"));
  equal(host.bytesOf("Boards/village.brd"), undefined, "a return never recreates a deleted file");
  equal(visits.getSnapshot().canReturn, false);

  const missing = await visits.visit(reopened.document, "Boards/nowhere.brd");
  ok(!missing.ok);
  equal(visits.getSnapshot().stack.length, 0, "a visit that did not open is not recorded");
});
