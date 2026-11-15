// Story 11.10 (T-04, T-05): the new-project model. A blank project is valid, starter contents are explicit and rights-
// cleared, nothing is ever replaced, a failure keeps what it wrote and says what is pending, and every stored reference
// resolves through the reserved folders. Each case runs on real bytes against the in-memory double.
import { test } from "node:test";
import { deepEqual, equal, match, notEqual, ok } from "node:assert/strict";
import { ASSET_FOLDERS, BinaryReader, parse, readBoard, readCharacter, readMainFile, tokenize, writeMainFile, type AssetKind, type MainFile } from "@tk-reawakened/core";
import { createMemoryPlatformServices, type MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { bindProjectFileSystem, platformError } from "@tk-reawakened/platform-services";
import {
  STARTER_DEFINITIONS,
  STARTER_ITEMS,
  createDocumentWorkspace,
  createNewProject,
  folderSafeName,
  mainFileName,
  planNewProject,
  projectLayoutOfMain,
  referencePath,
  reservedFolder,
  suggestedMainFile,
  validateNewProject,
  type NewProjectSettings,
  type StarterDefinition,
} from "../src/index.ts";

const AVAILABLE = STARTER_ITEMS.filter((item) => item.unavailable === null).map((item) => item.id);
const settings = (overrides: Partial<NewProjectSettings> = {}): NewProjectSettings => ({ gameName: "My Quest", mainFile: "MyQuest.gam", starters: [], ...overrides });

function mainOf(bytes: Uint8Array | undefined): MainFile {
  if (bytes === undefined) throw new Error("no main file");
  const read = readMainFile(new BinaryReader(bytes, "Main/MyQuest.gam"));
  if (!read.ok) throw new Error(read.error.message);
  return read.value;
}

test("names: the folder-safe form drops the legacy characters and the main file gets .gam", () => {
  equal(folderSafeName("My Quest: Part 1."), "MyQuestPart1");
  equal(suggestedMainFile("My Quest"), "MyQuest.gam");
  equal(suggestedMainFile(" . "), "");
  equal(mainFileName("quest"), "quest.gam");
  equal(mainFileName("quest.GAM"), "quest.GAM");
});

test("validation names the field to blame and refuses unusable names", () => {
  deepEqual(validateNewProject(settings()), []);
  const fields = (overrides: Partial<NewProjectSettings>) => validateNewProject(settings(overrides)).map((problem) => problem.field);
  deepEqual(fields({ gameName: "  " }), ["gameName"]);
  deepEqual(fields({ gameName: "x".repeat(101) }), ["gameName"]);
  deepEqual(fields({ gameName: "..:/ " }), ["gameName"], "a name with nothing left for the folder name");
  deepEqual(fields({ gameName: "two\nlines" }), ["gameName"]);
  deepEqual(fields({ mainFile: "" }), ["mainFile"]);
  deepEqual(fields({ mainFile: "a/b.gam" }), ["mainFile"]);
  deepEqual(fields({ mainFile: "a\\b.gam" }), ["mainFile"]);
  deepEqual(fields({ mainFile: ".gam" }), ["mainFile"]);
  deepEqual(fields({ mainFile: "what?.gam" }), ["mainFile"]);
  deepEqual(fields({ mainFile: "quest .gam" }), ["mainFile"]);
  deepEqual(fields({ mainFile: "quest..gam" }), ["mainFile"]);
  deepEqual(fields({ starters: ["nope"] }), ["starters"]);
  deepEqual(fields({ starters: ["start-program", "start-program"] }), ["starters"]);
});

test("the catalogue lists every item with provenance, and the unavailable ones with their reason and nothing to build", () => {
  deepEqual(STARTER_ITEMS.map((item) => item.id), ["start-program", "start-board", "start-character", "builtin-menu-battle", "tiles", "system-programs", "music"]);
  for (const item of STARTER_ITEMS) {
    ok(item.provenance.length > 0, `${item.id} states its provenance`);
    ok(item.writes.length > 0 && item.description.length > 0 && item.label.length > 0);
  }
  deepEqual(AVAILABLE, ["start-program", "start-board", "start-character", "builtin-menu-battle"]);
  for (const definition of STARTER_DEFINITIONS) equal(definition.unavailable === null, definition.contribute !== null, `${definition.id}: available exactly when it can build`);
  const refused = validateNewProject(settings({ starters: ["tiles", "music"] }));
  deepEqual(refused.map((problem) => problem.field), ["starters", "starters"]);
  match(refused[0]!.message, /Default tiles is not available: No rights-cleared tile art/);
  match(refused[1]!.message, /Music pack is not available/);
  const plan = planNewProject(settings({ starters: ["tiles"] }));
  equal(plan.ok, false, "an unavailable item is refused, never dropped or replaced");
});

test("a blank project plans the 14 folders and Main, and only a main file", () => {
  const planned = planNewProject(settings());
  ok(planned.ok);
  const { plan } = planned;
  deepEqual(plan.folders, [...Object.values(ASSET_FOLDERS), "Main"]);
  equal(plan.folders.length, 15);
  deepEqual(plan.files.map((file) => [file.path, file.role]), [["Main/MyQuest.gam", "main"]]);
  equal(plan.mainPath, "Main/MyQuest.gam");
  equal(plan.reservedGameFolder, "Game/MyQuest");
  const main = mainOf(plan.files[0]!.bytes);
  equal(main.minor, 9);
  equal(main.gameTitle, "My Quest");
  equal(main.projectPath, "Game\\MyQuest\\");
  for (const field of ["startupPrg", "initBoard", "initChar", "menuPlugin", "fightPlugin"] as const) equal(main[field], "", `${field} is empty without starter contents`);
  equal(main.menuKey, 13);
  equal(main.movementControls, 5);
  equal(main.inputSettings, null);
  // The stored bytes are what the writer re-emits: the file round-trips.
  const rewritten = writeMainFile(main);
  ok(rewritten.ok);
  deepEqual(rewritten.value, plan.files[0]!.bytes);
  deepEqual(rewritten.warnings, [], "the writer has nothing to say about a new project's main file");
});

test("starter contents are explicit: each chosen item adds its files and its stored references, in catalogue order, main file last", () => {
  const planned = planNewProject(settings({ starters: [...AVAILABLE].reverse() }));
  ok(planned.ok);
  deepEqual(planned.plan.files.map((file) => file.path), ["Prg/start.prg", "Boards/start.brd", "Chrs/start.tem", "Main/MyQuest.gam"]);
  const main = mainOf(planned.plan.files.at(-1)!.bytes);
  deepEqual([main.startupPrg, main.initBoard, main.initChar, main.menuPlugin, main.fightPlugin], ["start.prg", "start.brd", "start.tem", "tk3menu.dll", "tk3fight.dll"]);

  const board = readBoard(new BinaryReader(planned.plan.files[1]!.bytes, "Boards/start.brd"));
  ok(board.ok, board.ok ? "" : board.error.message);
  deepEqual([board.value.sizeX, board.value.sizeY, board.value.sizeL, board.value.coordType], [20, 15, 2, 0]);
  const character = readCharacter(new BinaryReader(planned.plan.files[2]!.bytes, "Chrs/start.tem"));
  ok(character.ok, character.ok ? "" : character.error.message);
  equal(character.value.name, "Hero");
  equal(character.value.minor, 8);
  const program = new TextDecoder("latin1").decode(planned.plan.files[0]!.bytes);
  ok(program.includes("\r\n") && program.endsWith("\r\n"));
  ok(parse(tokenize(program)), "the start-up program is RPGCode the parser accepts");

  // Choosing one item stores only that item's references.
  const only = planNewProject(settings({ starters: ["start-program"] }));
  ok(only.ok);
  deepEqual(only.plan.files.map((file) => file.path), ["Prg/start.prg", "Main/MyQuest.gam"]);
  const alone = mainOf(only.plan.files[1]!.bytes);
  deepEqual([alone.startupPrg, alone.initBoard, alone.initChar, alone.menuPlugin], ["start.prg", "", "", ""]);
});

test("two items that write the same path are refused", () => {
  const twin = (id: string): StarterDefinition => ({ id, label: id, description: "d", writes: "w", provenance: "p", unavailable: null, contribute: () => ({ files: [{ path: "Prg/start.prg", bytes: new Uint8Array([1]) }], main: {} }) });
  const planned = planNewProject(settings({ starters: ["a", "b"] }), [twin("a"), twin("b")]);
  equal(planned.ok, false);
});

async function folderKinds(host: MemoryPlatformServices): Promise<Record<string, string>> {
  const listed = await host.fs.list("");
  if (!listed.ok) throw new Error("root unreadable");
  return Object.fromEntries(listed.value.map((entry) => [entry.name, entry.kind]));
}

test("creating a blank project makes the 14 reserved folders empty, and the main file resolves", async () => {
  const host = createMemoryPlatformServices();
  const created = await createNewProject(host.fs, settings());
  deepEqual(created, { ok: true, mainPath: "Main/MyQuest.gam", written: ["Main/MyQuest.gam"], present: [] });
  const kinds = await folderKinds(host);
  for (const folder of Object.values(ASSET_FOLDERS)) equal(kinds[folder], "directory", `${folder} exists`);
  equal(kinds.Main, "directory");
  const empty = await host.fs.list("Boards");
  ok(empty.ok);
  deepEqual(empty.value, [], "an empty folder lists as empty");

  // The hosts' layout reading finds the type folders at the root, and every kind's folder resolves to a real folder.
  const layout = await projectLayoutOfMain(host.fs, "memory-project", "Main/MyQuest.gam");
  deepEqual(layout, { projectFolder: "" });
  for (const kind of Object.keys(ASSET_FOLDERS) as AssetKind[]) {
    const stat = await host.fs.stat(reservedFolder(layout, kind));
    ok(stat.ok && stat.value.kind === "directory", `${kind} resolves to ${reservedFolder(layout, kind)}`);
  }
});

test("a project with every available starter item opens, and each stored reference resolves to its file", async () => {
  const host = createMemoryPlatformServices();
  const created = await createNewProject(host.fs, settings({ starters: AVAILABLE }));
  ok(created.ok);
  deepEqual(created.written, ["Prg/start.prg", "Boards/start.brd", "Chrs/start.tem", "Main/MyQuest.gam"], "the main file is written last");
  const main = mainOf(host.bytesOf(created.mainPath));
  const layout = await projectLayoutOfMain(host.fs, "memory-project", created.mainPath);
  for (const [kind, reference] of [["programs", main.startupPrg], ["boards", main.initBoard], ["characters", main.initChar]] as const) {
    const stat = await host.fs.stat(referencePath(layout, kind, reference));
    ok(stat.ok && stat.value.kind === "file", `${kind}: ${reference} resolves to ${referencePath(layout, kind, reference)}`);
  }
  // The generated main file opens as a document in the workspace, as any main file does.
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: { fs: host.fs, dialogs: host.dialogs, capabilities: host.capabilities } });
  const opened = await workspace.open(created.mainPath);
  ok(opened.ok, opened.ok ? "" : JSON.stringify(opened));
  workspace.dispose();
});

test("an existing project is never replaced: every conflict is listed and nothing at all is written", async () => {
  const existing = new Uint8Array([9, 9, 9]);
  const host = createMemoryPlatformServices({ files: { "Main/MyQuest.gam": existing, "Prg/start.prg": existing, Boards: existing, "Game/MyQuest/Boards/x.brd": existing, "notes.txt": existing } });
  const before = await folderKinds(host);
  const refused = await createNewProject(host.fs, settings({ starters: AVAILABLE }));
  ok(!refused.ok && refused.reason === "conflicts");
  deepEqual(refused.conflicts.map((conflict) => conflict.path).sort(), ["Boards", "Game/MyQuest", "Main/MyQuest.gam", "Prg/start.prg"]);
  match(refused.message, /Nothing was written/);
  deepEqual(await folderKinds(host), before, "no folder was made");
  for (const path of ["Main/MyQuest.gam", "Prg/start.prg", "Boards", "notes.txt"]) deepEqual(host.bytesOf(path), existing, `${path} is untouched`);
  equal(host.bytesOf("Chrs/start.tem"), undefined, "no starter file was written");
});

test("a conflicting main file alone stops creation, and a differently cased existing folder keeps its own spelling", async () => {
  const existing = new Uint8Array([1]);
  const clash = createMemoryPlatformServices({ files: { "main/myquest.GAM": existing } });
  const refused = await createNewProject(clash.fs, settings());
  ok(!refused.ok && refused.reason === "conflicts", "names compare ASCII-folded");
  deepEqual(clash.bytesOf("main/myquest.GAM"), existing);

  const host = createMemoryPlatformServices({ files: { "boards/keep.brd": existing, "notes.txt": existing } });
  const created = await createNewProject(host.fs, settings({ starters: ["start-board"] }));
  ok(created.ok);
  deepEqual(created.written, ["boards/start.brd", "Main/MyQuest.gam"], "written into the existing folder's own spelling, not a second Boards");
  const kinds = await folderKinds(host);
  equal(kinds.Boards, undefined);
  deepEqual(host.bytesOf("boards/keep.brd"), existing);
  deepEqual(host.bytesOf("notes.txt"), existing, "an unrelated file in the destination stays");
});

/** A storage that fails the nth write (counting from 1) and every one after it, to stop a creation part-way. */
function failingFrom(host: MemoryPlatformServices, nth: number) {
  let writes = 0;
  const failure = () => platformError("io-error", "the disk is full");
  const storage = bindProjectFileSystem("memory-project", {
    ...host.fs,
    write: async (path, bytes) => {
      writes += 1;
      return writes >= nth ? failure() : host.fs.write(path, bytes);
    },
  });
  return storage;
}

test("a failed creation keeps what it wrote, names what is pending, changes nothing that existed, and running again finishes it", async () => {
  const bystander = new Uint8Array([4, 2]);
  const host = createMemoryPlatformServices({ files: { "notes.txt": bystander } });
  const failed = await createNewProject(failingFrom(host, 3), settings({ starters: AVAILABLE }));
  ok(!failed.ok && failed.reason === "failed");
  deepEqual(failed.written, ["Prg/start.prg", "Boards/start.brd"]);
  deepEqual(failed.pending, ["Chrs/start.tem", "Main/MyQuest.gam"], "the failed item comes first, and the main file is still pending");
  match(failed.message, /Could not write Chrs\/start\.tem: the disk is full/);
  match(failed.message, /Written: Prg\/start\.prg, Boards\/start\.brd\./);
  match(failed.message, /Nothing that existed before was changed/);
  equal(host.bytesOf("Main/MyQuest.gam"), undefined, "no main file points at a half-written project");
  deepEqual(host.bytesOf("notes.txt"), bystander);

  const again = await createNewProject(host.fs, settings({ starters: AVAILABLE }));
  ok(again.ok, again.ok ? "" : again.message);
  deepEqual(again.present, ["Prg/start.prg", "Boards/start.brd"], "what the failed run wrote is recognised, not treated as a conflict");
  deepEqual(again.written, ["Chrs/start.tem", "Main/MyQuest.gam"]);
  notEqual(host.bytesOf("Main/MyQuest.gam"), undefined);
});

test("a failed folder creation writes no file and says so; an unreadable destination is a failure that changes nothing", async () => {
  const host = createMemoryPlatformServices();
  const folderFails = bindProjectFileSystem("memory-project", { ...host.fs, createFolder: async () => platformError("permission-denied", "read-only") });
  const failed = await createNewProject(folderFails, settings({ starters: ["start-program"] }));
  ok(!failed.ok && failed.reason === "failed");
  deepEqual(failed.written, []);
  deepEqual(failed.pending, ["Prg/start.prg", "Main/MyQuest.gam"]);
  match(failed.message, /Could not create the folder Tiles: read-only/);
  deepEqual(await folderKinds(host), {}, "nothing reached the destination");

  const unreadable = bindProjectFileSystem("memory-project", { ...host.fs, list: async () => platformError("permission-denied", "no access") });
  const refused = await createNewProject(unreadable, settings());
  ok(!refused.ok && refused.reason === "failed");
  match(refused.message, /Could not read the destination folder: no access/);
});

test("an invalid answer is refused before the destination is read", async () => {
  let reads = 0;
  const host = createMemoryPlatformServices();
  const watching = bindProjectFileSystem("memory-project", { ...host.fs, list: async (path) => { reads += 1; return host.fs.list(path); } });
  const refused = await createNewProject(watching, settings({ gameName: "" }));
  ok(!refused.ok && refused.reason === "invalid");
  equal(refused.problems[0]!.field, "gameName");
  equal(reads, 0);
});

test("an existing empty file is never replaced, and a failed write deletes nothing it cannot prove it owns", async () => {
  // The author's own empty file is data: it is a conflict, and it is still there afterwards.
  const host = createMemoryPlatformServices({ files: { "Main/MyQuest.gam": new Uint8Array(0), "Prg/start.prg": new Uint8Array(0) } });
  const refused = await createNewProject(host.fs, settings({ starters: ["start-program"] }));
  ok(!refused.ok && refused.reason === "conflicts");
  deepEqual(refused.conflicts.map((conflict) => conflict.path), ["Prg/start.prg", "Main/MyQuest.gam"]);
  match(refused.conflicts[0]!.message, /already exists and is empty; the editor never replaces an existing file/);
  match(refused.message, /Nothing was written/);
  deepEqual(host.bytesOf("Main/MyQuest.gam"), new Uint8Array(0), "the empty file is untouched");
  deepEqual(host.bytesOf("Prg/start.prg"), new Uint8Array(0));
  equal((await host.fs.stat("Boards")).ok, false, "no folder was made");
});

test("a failed write never deletes a file another writer created at the same path after the preflight", async () => {
  const host = createMemoryPlatformServices();
  let failed = false;
  const concurrent = bindProjectFileSystem("memory-project", {
    ...host.fs,
    write: async (path, bytes) => {
      if (failed) return host.fs.write(path, bytes);
      failed = true;
      // Another writer puts its own empty file at the path after the preflight found none, then our write fails.
      host.seed(path, new Uint8Array(0));
      return platformError("io-error", "the disk is full");
    },
  });
  const result = await createNewProject(concurrent, settings({ starters: ["start-program"] }));
  ok(!result.ok && result.reason === "failed");
  deepEqual(host.bytesOf("Prg/start.prg"), new Uint8Array(0), "the other writer's file is still there");
  match(result.message, /An empty file is at Prg\/start\.prg; the editor deletes nothing here/);
  match(result.message, /Remove it yourself before running the wizard again/);
  equal(/was removed/.test(result.message), false, "the failure never claims to have deleted anything");
});

test("a failed write keeps partly written content and says so instead of deleting it", async () => {
  const host = createMemoryPlatformServices();
  let write = 0;
  const partial = bindProjectFileSystem("memory-project", {
    ...host.fs,
    write: async (path, bytes) => {
      write += 1;
      if (write !== 1) return host.fs.write(path, bytes);
      await host.fs.write(path, new Uint8Array([7]));
      return platformError("io-error", "the disk is full");
    },
  });
  const half = await createNewProject(partial, settings({ starters: ["start-program"] }));
  ok(!half.ok && half.reason === "failed");
  deepEqual(host.bytesOf("Prg/start.prg"), new Uint8Array([7]), "existing content is kept, never deleted");
  match(half.message, /A partly written file is at Prg\/start\.prg and is kept; the editor deletes nothing here/);
  deepEqual(half.written, []);
  deepEqual(half.pending, ["Prg/start.prg", "Main/MyQuest.gam"]);
});

test("an interrupted browser write leaves an empty file the author must remove; the retry then finishes", async () => {
  const host = createMemoryPlatformServices({ files: { "notes.txt": new Uint8Array([4, 2]) } });
  let attempts = 0;
  const createsThenFails = bindProjectFileSystem("memory-project", {
    ...host.fs,
    write: async (path, bytes) => {
      attempts += 1;
      if (attempts !== 2) return host.fs.write(path, bytes);
      // A browser creates the file before it commits any content, so a failed write leaves it empty.
      await host.fs.write(path, new Uint8Array(0));
      return platformError("io-error", "the disk is full");
    },
  });
  const failed = await createNewProject(createsThenFails, settings({ starters: ["start-program", "start-board"] }));
  ok(!failed.ok && failed.reason === "failed");
  deepEqual(failed.written, ["Prg/start.prg"]);
  deepEqual(failed.pending, ["Boards/start.brd", "Main/MyQuest.gam"]);
  deepEqual(host.bytesOf("Boards/start.brd"), new Uint8Array(0), "the empty file the failed write left stays: ownership is not provable");

  // Running it again reports that file as the conflict it is, and says what to do; the author removes it and tries again.
  const blocked = await createNewProject(host.fs, settings({ starters: ["start-program", "start-board"] }));
  ok(!blocked.ok && blocked.reason === "conflicts");
  deepEqual(blocked.conflicts.map((conflict) => conflict.path), ["Boards/start.brd"]);
  match(blocked.conflicts[0]!.message, /already exists and is empty; the editor never replaces an existing file\. Choose another folder or name, or remove it yourself\./);
  ok((await host.fs.delete("Boards/start.brd")).ok);
  const again = await createNewProject(host.fs, settings({ starters: ["start-program", "start-board"] }));
  ok(again.ok, again.ok ? "" : again.message);
  deepEqual(again.present, ["Prg/start.prg"], "the file the first run wrote is recognised, not treated as a conflict");
  deepEqual(again.written, ["Boards/start.brd", "Main/MyQuest.gam"]);
});



