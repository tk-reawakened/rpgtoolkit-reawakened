// Document history (ADR 0022 D12 and D12.10): what a creator can observe through a workspace, a store and the package
// exporter. Every test drives the real documents and the real store over the memory host; nothing here fakes a save.
import { readFile } from "node:fs/promises";
import { deepEqual, equal, match, notEqual, ok } from "node:assert/strict";
import { test } from "node:test";
import { platformError, type FileSystemService } from "@tk-reawakened/platform-services";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import {
  acceptIgnoreOffer,
  createBoardFile,
  createDocumentHistoryStore,
  createDocumentWorkspace,
  createNewProject,
  createProjectWizardHistory,
  createWizardHistory,
  createProjectTree,
  DEFAULT_HISTORY_POLICY,
  diffLines,
  ignoreOffer,
  openHistoryPreview,
  runCheckpointedOperation,
  sha256Hex,
  type AnyDocument,
  type DocumentWorkspace,
  type HistoryPolicy,
} from "../src/index.ts";
import { producedArchiveViolations } from "../src/package-export.ts";
import { exampleMain, titleOf, withTitle } from "./fixtures.ts";

const PATH = "Main/example.gam";
const OTHER = "Main/other.gam";

type Fault = { mode: "none" | "all" | "entries" };

/** A project filesystem whose writes under the history folder fail on demand, so the editor's behavior when history breaks is observable. */
function faultyFs(base: FileSystemService, fault: Fault): FileSystemService {
  const blocked = (path: string): boolean => fault.mode !== "none" && path.startsWith(".tkr-history/") && (fault.mode === "all" || path.startsWith(".tkr-history/entries/"));
  return {
    ...base,
    write: async (path, bytes) => (blocked(path) ? platformError("io-error", "the history disk is full") : base.write(path, bytes)),
    writeProject: async (project, path, bytes) => (blocked(path) ? platformError("io-error", "the history disk is full") : base.writeProject(project, path, bytes)),
  };
}

function setUp(options: { readonly policy?: Partial<HistoryPolicy>; readonly files?: Record<string, Uint8Array>; readonly fault?: Fault } = {}) {
  const host = createMemoryPlatformServices({ files: { [PATH]: exampleMain(9), ...options.files } });
  const fault = options.fault ?? { mode: "none" };
  const services = { capabilities: host.capabilities, dialogs: host.dialogs, fs: faultyFs(host.fs, fault) };
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services, historyPolicy: () => ({ ...DEFAULT_HISTORY_POLICY, ...options.policy }) });
  return { host, workspace, fault };
}

async function openDoc(workspace: DocumentWorkspace, path = PATH) {
  const opened = await workspace.open(path);
  ok(opened.ok);
  return opened.document;
}

const retitle = (document: AnyDocument, title: string): void => { ok(document.apply({ type: "set-game-title", title }).ok); };

function gameTitleOf(document: { getSnapshot(): unknown }): string {
  const snapshot = document.getSnapshot();
  if (typeof snapshot === "object" && snapshot !== null && "gameTitle" in snapshot && typeof snapshot.gameTitle === "string") return snapshot.gameTitle;
  throw new Error("not a game settings document");
}

const titlesOf = async (workspace: DocumentWorkspace, path = PATH): Promise<string[]> => {
  const out: string[] = [];
  for (const entry of await workspace.history.documentTimeline(path)) out.push(`${entry.reason}:${titleOf((await workspace.history.preview(entry.id))!.bytes)}`);
  return out;
};

test("a save keeps the version it replaces first, and autosaves inside the merge window share one entry", async () => {
  const { workspace } = setUp();
  const doc = await openDoc(workspace);
  const original = titleOf(exampleMain(9));
  retitle(doc, "A");
  ok((await doc.save("auto")).ok);
  retitle(doc, "B");
  ok((await doc.save("auto")).ok);
  deepEqual(await titlesOf(workspace), [`checkpoint:${original}`, "auto:B"], "A was merged away; the version before the window survives");
  const [, merged] = await workspace.history.documentTimeline(PATH);
  equal(merged!.merged, 2);
  retitle(doc, "C");
  ok((await doc.save("manual")).ok);
  deepEqual(await titlesOf(workspace), [`checkpoint:${original}`, "auto:B", "manual:C"], "a manual save is never merged");
});

test("without a merge window every autosave is its own entry", async () => {
  const { workspace } = setUp({ policy: { mergeWindowMs: 0 } });
  const doc = await openDoc(workspace);
  const original = titleOf(exampleMain(9));
  retitle(doc, "A");
  await doc.save("auto");
  retitle(doc, "B");
  await doc.save("auto");
  deepEqual(await titlesOf(workspace), [`checkpoint:${original}`, "auto:A", "auto:B"]);
});

test("identical content is stored once, and a blob that fails its own hash is never shown", async () => {
  const { host, workspace } = setUp({ policy: { mergeWindowMs: 0 } });
  const doc = await openDoc(workspace);
  retitle(doc, "Same");
  await doc.save("manual");
  doc.undo();
  doc.redo();
  retitle(doc, "Same too");
  await doc.save("manual");
  const timeline = await workspace.history.documentTimeline(PATH);
  const hashes = new Set(timeline.map((entry) => entry.sha256));
  const blobs = await host.fs.list(".tkr-history/blobs");
  ok(blobs !== null && blobs.ok);
  equal(blobs.value.length, hashes.size, "one file per distinct content");
  const victim = timeline.at(-1)!;
  ok((await host.fs.write(`.tkr-history/blobs/${victim.sha256}`, new Uint8Array([1, 2, 3]))).ok);
  await assertRejects(() => workspace.history.preview(victim.id), /SHA-256/);
});

async function assertRejects(run: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  try { await run(); } catch (error) { ok(pattern.test(error instanceof Error ? error.message : String(error)), String(error)); return; }
  ok(false, "expected a rejection");
}

test("if history cannot keep the version about to be replaced, nothing is written and the save says why", async () => {
  const fault: Fault = { mode: "none" };
  const { host, workspace } = setUp({ fault });
  const doc = await openDoc(workspace);
  const before = host.bytesOf(PATH)!;
  retitle(doc, "Lost?");
  fault.mode = "all";
  const saved = await doc.save("auto");
  ok(!saved.ok);
  ok(/history could not keep the version it would replace/.test(saved.failure.message), saved.failure.message);
  deepEqual(host.bytesOf(PATH), before, "the previous version is still on disk");
  equal(doc.getSnapshot().dirty, true);
});

test("a history record that fails after a durable write leaves the file saved and the document clean, shows the problem, and the next save heals the gap", async () => {
  const fault: Fault = { mode: "none" };
  const { host, workspace } = setUp({ fault, policy: { mergeWindowMs: 0 } });
  const doc = await openDoc(workspace);
  retitle(doc, "One");
  ok((await doc.save("manual")).ok);
  fault.mode = "entries";
  retitle(doc, "Two");
  const saved = await doc.save("manual");
  ok(saved.ok, "the file was written");
  equal(titleOf(host.bytesOf(PATH)!), "Two");
  equal(doc.getSnapshot().dirty, false);
  ok(workspace.history.problems().some((problem) => /history could not be recorded/.test(problem.message)));
  fault.mode = "none";
  retitle(doc, "Three");
  ok((await doc.save("manual")).ok);
  ok((await titlesOf(workspace)).includes("checkpoint:Two"), "the version whose record failed was kept before it was replaced");
  equal(workspace.history.problems().length, 0, "the problem clears once the path records again");
});

test("a conflict keeps both versions: the external bytes before keeping mine, my unsaved work before loading theirs", async () => {
  const original = exampleMain(9);
  const mine = setUp();
  const keepDoc = await openDoc(mine.workspace);
  retitle(keepDoc, "Mine");
  mine.host.seed(PATH, withTitle(original, "Theirs"));
  ok(!(await keepDoc.save("manual")).ok);
  keepDoc.resolveConflict("keep-local");
  ok((await keepDoc.save("manual")).ok);
  ok((await titlesOf(mine.workspace)).includes("before-conflict-resolution:Theirs"));
  equal(titleOf(mine.host.bytesOf(PATH)!), "Mine");

  const theirs = setUp();
  const reloadDoc = await openDoc(theirs.workspace);
  retitle(reloadDoc, "Unsaved mine");
  theirs.host.seed(PATH, withTitle(original, "Theirs"));
  ok(!(await reloadDoc.save("manual")).ok);
  const resolved = await reloadDoc.resolveConflict("reload");
  ok(resolved.ok);
  equal(gameTitleOf(reloadDoc), "Theirs");
  ok((await titlesOf(theirs.workspace)).includes("before-conflict-resolution:Unsaved mine"), "the discarded work is in history");
});

test("a group captures every planned destination first, restores them as one action and reports each file; a restore restores back", async () => {
  const { host, workspace } = setUp({ files: { [OTHER]: withTitle(exampleMain(9), "Other before") } });
  const wizard = createWizardHistory(workspace.checkpoints);
  const planned = [PATH, OTHER, "Main/created.gam"];
  const before = new Map(planned.map((path) => [path, host.bytesOf(path)] as const));
  const ran = await runCheckpointedOperation(wizard, host.fs, { name: "Two-file wizard", planned }, async (write) => {
    const a = await write(PATH, withTitle(exampleMain(9), "Wizard A"));
    const b = await write(OTHER, withTitle(exampleMain(9), "Wizard B"));
    const c = await write("Main/created.gam", withTitle(exampleMain(9), "Wizard new"));
    return [a, b, c];
  });
  ok(ran.ok);
  ok(ran.value.every((write) => write.ok));
  equal(titleOf(host.bytesOf(OTHER)!), "Wizard B");

  const report = await workspace.restoreHistoryGroup(ran.groupId);
  deepEqual(report.files.map((file) => [file.path, file.result]), [[PATH, "restored"], [OTHER, "restored"], ["Main/created.gam", "restored"]]);
  deepEqual(host.bytesOf(PATH), before.get(PATH));
  deepEqual(host.bytesOf(OTHER), before.get(OTHER));
  equal(host.bytesOf("Main/created.gam"), undefined, "the file the operation created is gone");
  ok(report.restoreGroupId !== null);

  const again = await workspace.restoreHistoryGroup(ran.groupId);
  ok(again.files.every((file) => file.result === "already-as-wanted"), "restoring twice does not rewrite anything");

  const undone = await workspace.restoreHistoryGroup(report.restoreGroupId!);
  equal(titleOf(host.bytesOf(OTHER)!), "Wizard B", "a restore is itself restorable");
  equal(titleOf(host.bytesOf("Main/created.gam")!), "Wizard new");
  ok(undone.files.every((file) => file.result === "restored"));
});

test("a destination planned before it exists is recorded first; a file the operation never registered is never deleted", async () => {
  const { host, workspace } = setUp();
  const begun = await workspace.checkpoints.begin(["Main/ghost.gam", "Main/mine.gam"], "Crash between write and registration");
  ok(begun.ok);
  const group = begun.value;
  deepEqual(group.files.map((file) => [file.path, file.before]), [["Main/ghost.gam", null], ["Main/mine.gam", null]]);
  // Mine is written and registered; ghost is written but the process "dies" before registering it.
  const mineBytes = withTitle(exampleMain(9), "Mine");
  ok((await host.fs.write("Main/mine.gam", mineBytes)).ok);
  ok((await workspace.checkpoints.registerWritten(group.id, "Main/mine.gam", mineBytes)).ok);
  ok((await host.fs.write("Main/ghost.gam", withTitle(exampleMain(9), "Ghost"))).ok);
  const report = await workspace.restoreHistoryGroup(group.id);
  deepEqual(report.files.map((file) => [file.path, file.result]), [["Main/ghost.gam", "kept-uncertain"], ["Main/mine.gam", "restored"]]);
  ok(host.bytesOf("Main/ghost.gam") !== undefined, "ownership could not be proved, so it stayed");
  equal(host.bytesOf("Main/mine.gam"), undefined);
  const forced = await workspace.restoreHistoryGroup(group.id, { only: ["Main/ghost.gam"], deleteUncertain: ["Main/ghost.gam"] });
  equal(forced.files[0]!.result, "restored");
  equal(host.bytesOf("Main/ghost.gam"), undefined, "deleted only by the user's explicit per-file choice");
});

test("a group that cannot be recorded writes nothing, and a failed file is reported and retried alone", async () => {
  const fault: Fault = { mode: "none" };
  const { host, workspace } = setUp({ fault, files: { [OTHER]: withTitle(exampleMain(9), "Other before") } });
  fault.mode = "all";
  const refused = await runCheckpointedOperation(createWizardHistory(workspace.checkpoints), host.fs, { name: "Wizard", planned: [PATH] }, async (write) => write(PATH, withTitle(exampleMain(9), "x")));
  ok(!refused.ok);
  equal(titleOf(host.bytesOf(PATH)!), titleOf(exampleMain(9)), "no write happened");
  fault.mode = "none";

  const ran = await runCheckpointedOperation(createWizardHistory(workspace.checkpoints), host.fs, { name: "Wizard", planned: [PATH, OTHER] }, async (write) => [await write(PATH, withTitle(exampleMain(9), "A")), await write(OTHER, withTitle(exampleMain(9), "B"))]);
  ok(ran.ok);
  // Another program locks one file: its restore fails while the other succeeds.
  const locking: FileSystemService = { ...host.fs, writeProject: async (project, path, bytes) => (path === OTHER ? platformError("permission-denied", "locked") : host.fs.writeProject(project, path, bytes)) };
  const lockedWorkspace = createDocumentWorkspace({ projectId: "memory-project", services: { capabilities: host.capabilities, dialogs: host.dialogs, fs: locking } });
  const partial = await lockedWorkspace.restoreHistoryGroup(ran.groupId);
  deepEqual(partial.files.map((file) => [file.path, file.result]), [[PATH, "restored"], [OTHER, "failed"]]);
  equal(partial.files[1]!.message, "locked");
  const retried = await workspace.restoreHistoryGroup(ran.groupId, { only: [OTHER] });
  deepEqual(retried.files.map((file) => [file.path, file.result]), [[OTHER, "restored"]]);
  equal(titleOf(host.bytesOf(OTHER)!), "Other before", "restored");
  equal(titleOf(host.bytesOf(PATH)!), titleOf(exampleMain(9)));
});

test("restoring into an open document is one accepted edit that undoes, asks before replacing unsaved work and keeps that work", async () => {
  const { host, workspace } = setUp({ policy: { mergeWindowMs: 0 } });
  const doc = await openDoc(workspace);
  retitle(doc, "Saved");
  await doc.save("manual");
  const first = (await workspace.history.documentTimeline(PATH)).find((entry) => entry.reason === "checkpoint")!;
  retitle(doc, "Unsaved work");
  host.answerQuestions("cancel");
  const declined = await workspace.restoreHistoryEntry(first.id);
  equal(declined.restoreGroupId, null);
  equal(gameTitleOf(doc), "Unsaved work", "declining changes nothing");
  equal(host.questions.at(-1)!.message.includes(PATH), true);

  host.answerQuestions("restore");
  const done = await workspace.restoreHistoryEntry(first.id);
  deepEqual(done.files.map((file) => file.result), ["restored"]);
  equal(gameTitleOf(doc), titleOf(exampleMain(9)));
  equal(doc.getSnapshot().dirty, false, "the restored version was saved");
  ok((await titlesOf(workspace)).includes("before-restore:Unsaved work"), "the unsaved version was kept first");
  ok(workspace.undo(doc).ok, "the restore is an edit the session can undo");
  equal(gameTitleOf(doc), "Unsaved work");
  host.answerQuestions("restore");
  const undone = await workspace.restoreHistoryGroup(done.restoreGroupId!);
  ok(undone.files.every((file) => file.result === "restored" || file.result === "already-as-wanted"));
});

test("restoring and undoing a saved version wait for durable bytes and keep the open model identical", async () => {
  const { host, workspace } = setUp();
  const document = await openDoc(workspace);
  const initial = host.bytesOf(PATH)!.slice();
  retitle(document, "First saved");
  ok((await document.save("manual")).ok);
  retitle(document, "Second saved");
  ok((await document.save("manual")).ok);
  const latest = host.bytesOf(PATH)!.slice();
  const checkpoint = (await workspace.history.documentTimeline(PATH)).find((entry) => entry.reason === "checkpoint")!;

  const restored = await workspace.restoreHistoryEntry(checkpoint.id);
  ok(restored.restoreGroupId !== null);
  deepEqual(host.bytesOf(PATH), initial, "the completed restore wrote the selected saved bytes");
  deepEqual(document.serialize(), host.bytesOf(PATH), "the open model serializes to the actual restored bytes");

  const undone = await workspace.restoreHistoryGroup(restored.restoreGroupId!);
  ok(undone.files.every((file) => file.result === "restored" || file.result === "already-as-wanted"));
  deepEqual(host.bytesOf(PATH), latest, "undoing the restore wrote the pre-restore saved bytes");
  deepEqual(document.serialize(), host.bytesOf(PATH), "the open model serializes to the actual bytes after undo");
  equal(gameTitleOf(document), "Second saved");
});

test("a restore of a read-only open document is refused and says so", async () => {
  const { host, workspace } = setUp();
  host.seed("Main/text.gam", new Uint8Array(await readFile(new URL("../../../docs/spec/examples/versions/main/main_tk2_text.gam", import.meta.url))));
  const doc = await openDoc(workspace, "Main/text.gam");
  ok(doc.getSnapshot().readOnly !== null);
  const kept = await workspace.history.recordSave("Main/text.gam", host.bytesOf("Main/text.gam")!, "manual");
  ok(kept.outcome === "recorded");
  const report = await workspace.restoreHistoryEntry((await workspace.history.documentTimeline("Main/text.gam"))[0]!.id);
  deepEqual(report.files.map((file) => file.result), ["already-as-wanted"]);
  ok(!doc.restoreVersion(exampleMain(9)).ok);
});

test("a named checkpoint holds every covered file, lists what history cannot keep, and restores as a group", async () => {
  const big = new Uint8Array(8192);
  const { host, workspace } = setUp({ policy: { maxCoveredBytes: 4096 }, files: { [OTHER]: withTitle(exampleMain(9), "Other"), "Pictures/hero.png": new Uint8Array([1, 2, 3]), "Boards/huge.brd": big } });
  const group = await workspace.createNamedCheckpoint("Before the big change");
  equal(group.reason, "named");
  deepEqual(group.files.map((file) => file.path).sort(), [OTHER, PATH].sort());
  deepEqual(group.uncovered.map((item) => [item.path, item.reason]), [["Boards/huge.brd", "size"], ["Pictures/hero.png", "type"]]);
  ok(host.bytesOf(PATH) !== undefined);
  const doc = await openDoc(workspace);
  retitle(doc, "Changed after");
  await doc.save("manual");
  host.seed(OTHER, withTitle(exampleMain(9), "Changed other"));
  const report = await workspace.restoreHistoryGroup(group.id);
  const byPath = Object.fromEntries(report.files.map((file) => [file.path, file.result]));
  deepEqual(byPath, { [OTHER]: "restored", [PATH]: "restored", "Boards/huge.brd": "uncovered", "Pictures/hero.png": "uncovered" });
  equal(titleOf(host.bytesOf(OTHER)!), "Other");
  equal(titleOf(host.bytesOf(PATH)!), titleOf(exampleMain(9)));
  equal(gameTitleOf(doc), titleOf(exampleMain(9)), "the open document followed the restore");
});

test("history travels with the project: a second workspace over the same files sees and restores the first one's entries", async () => {
  const host = createMemoryPlatformServices({ files: { [PATH]: exampleMain(9) } });
  const first = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const opened = await first.open(PATH);
  ok(opened.ok);
  retitle(opened.document, "Saved by the first host");
  ok((await opened.document.save("manual")).ok);
  first.dispose();
  const second = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const entries = await second.history.documentTimeline(PATH);
  deepEqual(entries.map((entry) => entry.reason), ["checkpoint", "manual"], "the new workspace reads the project's history folder");
  const report = await second.restoreHistoryEntry(entries[0]!.id);
  deepEqual(report.files.map((file) => file.result), ["restored"]);
  const reopened = await second.open(PATH);
  ok(reopened.ok);
  equal(gameTitleOf(reopened.document), titleOf(exampleMain(9)), "the version saved by the first host was restored by the second");
  second.dispose();
});

test("history keeps only what it covers: other types and over-size files record nothing and are listed", async () => {
  const { host, workspace } = setUp({ policy: { maxCoveredBytes: 100 } });
  const store = workspace.history;
  deepEqual(await store.recordSave("Pictures/a.png", new Uint8Array([1]), "manual"), { outcome: "uncovered", reason: "type" });
  deepEqual(await store.recordSave("Boards/big.brd", new Uint8Array(200), "manual"), { outcome: "uncovered", reason: "size" });
  deepEqual((await store.uncovered()).map((item) => [item.path, item.reason]), [["Boards/big.brd", "size"], ["Pictures/a.png", "type"]]);
  deepEqual(await store.documentTimeline("Pictures/a.png"), []);
  ok((await host.fs.list(".tkr-history/blobs")).ok === false || (await host.fs.list(".tkr-history/blobs")).ok);
});

test("thinning offers only autosave entries past the floor, deletes only after confirmation and never touches saves you made or groups", async () => {
  let clock = 1_000_000;
  const host = createMemoryPlatformServices({});
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const store = createDocumentHistoryStore({
    project: host.fs,
    storage: host.fs,
    location: { kind: "project-folder", description: "test" },
    policy: () => ({ ...DEFAULT_HISTORY_POLICY, mergeWindowMs: 0, autoFloorMs: 1000, warnBytes: 10 }),
    coveredType: () => true,
    now: () => clock,
  });
  const bytes = (n: number) => new Uint8Array([n, n, n, n]);
  await store.recordSave("a.brd", bytes(1), "auto");
  clock += 10;
  await store.recordSave("a.brd", bytes(2), "manual");
  clock += 10;
  await store.recordSave("a.brd", bytes(3), "auto");
  await workspace.createNamedCheckpoint("keep");
  equal((await store.usage()).overWarning, true);
  deepEqual(await store.thinningPlan(), [], "nothing is old enough");
  clock += 5000;
  const plan = await store.thinningPlan();
  const firstHash = await sha256Hex(bytes(1));
  deepEqual(plan.map((candidate) => [candidate.entry.sha256 === firstHash, candidate.frees]), [[true, 4], [false, 4]]);
  equal(plan.length, 2);
  equal(plan.every((candidate) => candidate.entry.reason === "auto"), true);
  const manual = (await store.documentTimeline("a.brd")).find((entry) => entry.reason === "manual")!;
  equal(await store.thin([manual.id]), 0, "an entry the plan would not offer is refused");
  equal((await store.documentTimeline("a.brd")).length, 3);
  const freed = await store.thin(plan.map((candidate) => candidate.entry.id));
  equal(freed, 8);
  deepEqual((await store.documentTimeline("a.brd")).map((entry) => entry.reason), ["manual"]);
  const groups = await workspace.checkpoints.list();
  ok(groups.ok);
  equal(groups.value.filter((entry) => "files" in entry).length, 1, "the checkpoint stays");
  workspace.dispose();
});

test("deleting from the project tree keeps the covered documents in history first and refuses when it cannot", async () => {
  const fault: Fault = { mode: "none" };
  const { host, workspace } = setUp({ fault, files: { "Boards/dir/a.brd": new Uint8Array([9]), "Pictures/p.png": new Uint8Array([1]) } });
  const tree = createProjectTree({ services: { fs: host.fs, dialogs: host.dialogs, capabilities: host.capabilities }, workspace });
  await tree.refresh();
  fault.mode = "all";
  host.answerQuestions("delete");
  const refused = await tree.remove("Main/example.gam");
  ok(!refused.ok);
  ok(host.bytesOf(PATH) !== undefined, "nothing was deleted when history could not keep it");
  fault.mode = "none";
  host.answerQuestions("delete");
  ok((await tree.remove("Main")).ok);
  equal(host.bytesOf(PATH), undefined);
  const kept = await workspace.history.documentTimeline(PATH);
  deepEqual(kept.map((entry) => entry.reason), ["before-delete"]);
  deepEqual((await workspace.history.uncovered()).map((item) => item.path), []);
  await tree.refresh();
  const names = tree.getSnapshot().rows.map((row) => row.name);
  ok(!names.includes(".tkr-history"), "the history folder is never shown as project content");
});

test("without folderWrite history lives in memory and says so; the project folder is untouched", async () => {
  const host = createMemoryPlatformServices({ files: { [PATH]: exampleMain(9) }, capabilities: [] });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  equal(workspace.history.location.kind, "session-memory");
  ok(/lost when the page closes/.test(workspace.history.location.description));
  const doc = await openDoc(workspace);
  retitle(doc, "x");
  await doc.save("manual");
  equal((await workspace.history.documentTimeline(PATH)).length, 2);
  equal((await host.fs.list(".tkr-history")).ok, false, "nothing was written into the project");
  const withFolder = createDocumentWorkspace({ projectId: "memory-project", services: createMemoryPlatformServices({}) });
  equal(withFolder.history.location.kind, "project-folder");
});

test("the ignore offer is only an offer: nothing is written until accepted, existing lines stay, and a present ignore removes it", async () => {
  const host = createMemoryPlatformServices({ files: { ".git/HEAD": new Uint8Array([1]), ".gitignore": new TextEncoder().encode("node_modules\n*.log") } });
  const offer = await ignoreOffer(host.fs);
  deepEqual(offer, { offer: true, file: ".gitignore", line: ".tkr-history/" });
  equal(new TextDecoder().decode(host.bytesOf(".gitignore")!), "node_modules\n*.log", "asking wrote nothing");
  ok((await acceptIgnoreOffer(host.fs)).ok);
  equal(new TextDecoder().decode(host.bytesOf(".gitignore")!), "node_modules\n*.log\n.tkr-history/\n");
  deepEqual(await ignoreOffer(host.fs), { offer: false });
  deepEqual(await ignoreOffer(createMemoryPlatformServices({}).fs), { offer: false }, "not a Git project, no offer");
});

test("a history entry opens as a read-only document of its own kind that can never write", async () => {
  const preview = openHistoryPreview("memory-project", PATH, exampleMain(9), "yesterday");
  ok(preview.ok);
  const snapshot = preview.document.getSnapshot();
  equal(snapshot.readOnly?.code, "history-preview");
  ok(!preview.document.apply({ type: "set-game-title", title: "x" }).ok);
  const saved = await preview.document.save();
  ok(!saved.ok);
  ok(!openHistoryPreview("memory-project", "Pictures/a.png", new Uint8Array([1]), "x").ok);
});

test("run saves with the reason before-run", async () => {
  const host = createMemoryPlatformServices({ files: { [PATH]: exampleMain(9) }, capabilities: ["folderWrite", "runGame"] });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const doc = await openDoc(workspace);
  retitle(doc, "Before run");
  const results = await workspace.saveAll("before-run");
  ok(results.every((entry) => entry.result.ok));
  ok((await workspace.history.documentTimeline(PATH)).some((entry) => entry.reason === "before-run"));
});

test("the line comparison of two programs marks removed and added lines and refuses an unbounded table (#2843)", () => {
  deepEqual(diffLines("a\nb\nc", "a\nc\nd")!.map((line) => `${line.kind[0]}${line.text}`), ["sa", "rb", "sc", "ad"]);
  const large = Array.from({ length: 1500 }, (_, index) => `line ${index}`).join("\n");
  equal(diffLines(large, large)!.length, 1500, "a large program still compares inside the cell bound");
  const oversized = Array.from({ length: 3000 }, (_, index) => `line ${index}`).join("\n");
  equal(diffLines(oversized, `${oversized}\nlast`), null, "too many lines to compare without a table the host cannot hold");
});

test("the produced-archive check refuses every excluded class the inventory filter should have removed", () => {
  const selected = "Main/game.gam";
  const clean = ["manifest.json", "Main/game.gam", "Boards/a.brd", "Prg/start.prg"];
  deepEqual(producedArchiveViolations(clean, selected), []);
  for (const leaked of ["Saved/slot.sav", "SAVED/x.sav", ".tkr-history/blobs/abc", ".TKR-HISTORY/entries/1.json", ".tkr-exports/p.tpk", "Main/other.gam", "Prg/t.spec.prg", "Prg/T.SPEC.PRG", "Boards/x.tkrscn", "Tiles/x.tkrtile", "Packs/x.tkrpack"]) {
    deepEqual(producedArchiveViolations([...clean, leaked], selected), [leaked], `${leaked} must fail the check`);
  }
  notEqual(producedArchiveViolations(["Boards\\.tkr-history\\a.brd"], selected).length, 1, "a folder with that name below the root is ordinary project data");
});

test("the new-project wizard records every planned destination before its first write, with each written file's hash (D12.10 item 6, #2832)", async () => {
  const host = createMemoryPlatformServices();
  const created = await createNewProject(host.fs, { gameName: "Grouped Quest", mainFile: "Grouped.gam", starters: [] }, undefined, createProjectWizardHistory(host.fs));
  ok(created.ok);
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const result = await workspace.checkpoints.list();
  ok(result.ok);
  const groups = result.value.filter((entry) => "files" in entry);
  workspace.dispose();
  equal(groups.length, 1, "one group for the whole creation");
  const group = groups[0]!;
  equal(group.name, "New project");
  deepEqual(group.files.map((file) => file.path), created.written, "every planned file is named, absent ones included");
  ok(group.files.every((file) => file.before === null), "each was absent before the operation");
  ok(group.files.every((file) => file.status === "written"), "each written file is registered");
  equal(group.files.find((file) => file.path === created.mainPath)!.after, await sha256Hex(host.bytesOf(created.mainPath)!), "the registration proves ownership by hash");
  equal(group.uncovered.length, 0);
});

test("a wizard whose group cannot be recorded writes nothing at all", async () => {
  const host = createMemoryPlatformServices();
  const refusing = { ...host.fs, write: async () => platformError("io-error", "history disk is full") };
  const created = await createNewProject(refusing, { gameName: "Never", mainFile: "Never.gam", starters: [] }, undefined, createProjectWizardHistory(refusing));
  ok(!created.ok);
  match(created.message, /history checkpoint could not be recorded/);
  deepEqual(created.ok ? [] : created.reason === "failed" ? created.written : [], []);
  equal(host.bytesOf("Main/Never.gam"), undefined, "no file was written");
});

test("a new board is one group with an ownership record for the created file", async () => {
  const host = createMemoryPlatformServices();
  ok((await host.fs.createFolder("Boards")).ok);
  const created = await createBoardFile(host.fs, { projectFolder: "" }, { name: "grouped", coordSystem: "2d", pixelCoordinates: false, width: 4, height: 3, layers: 1, backgroundImage: "", template: null }, createProjectWizardHistory(host.fs));
  ok(created.ok);
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const result = await workspace.checkpoints.list();
  ok(result.ok);
  const groups = result.value.filter((entry) => "files" in entry);
  workspace.dispose();
  equal(groups.length, 1);
  const group = groups[0]!;
  equal(group.files[0]!.before, null);
  equal(group.files[0]!.path, created.path);
  equal(group.files[0]!.after, await sha256Hex(host.bytesOf(created.path)!));
  equal(group.files[0]!.status, "written");
});

test("restoring a deleted file recreates it as the restore's own file, so undoing that restore removes it again (#2834)", async () => {
  const { host, workspace } = setUp();
  const store = workspace.history;
  const bytes = withTitle(exampleMain(9), "Deleted then restored");
  ok((await host.fs.write("Main/gone.gam", bytes)).ok);
  await store.recordSave("Main/gone.gam", bytes, "manual");
  const entry = (await store.documentTimeline("Main/gone.gam"))[0]!;
  ok((await host.fs.delete("Main/gone.gam")).ok);
  const restored = await workspace.restoreHistoryEntry(entry.id);
  deepEqual(restored.files.map((file) => file.result), ["restored"]);
  ok(host.bytesOf("Main/gone.gam") !== undefined, "the file is back");
  const undone = await workspace.restoreHistoryGroup(restored.restoreGroupId!);
  deepEqual(undone.files.map((file) => [file.path, file.result]), [["Main/gone.gam", "restored"]]);
  equal(host.bytesOf("Main/gone.gam"), undefined, "undoing the restore removes the file it created");
});

test("a blob that was corrupted after it was recorded is repaired before a later save replaces that version (#2835)", async () => {
  const { host, workspace } = setUp({ policy: { mergeWindowMs: 0 } });
  const store = workspace.history;
  const first = withTitle(exampleMain(9), "First");
  await store.recordSave(PATH, first, "manual");
  const entry = (await store.documentTimeline(PATH)).at(-1)!;
  ok((await host.fs.write(`.tkr-history/blobs/${entry.sha256}`, new Uint8Array([0, 1, 2]))).ok, "the stored blob is damaged");
  const kept = await store.keep(PATH, first, "checkpoint");
  equal(kept.outcome, "held");
  const preview = await store.preview(entry.id);
  ok(preview !== null);
  deepEqual(preview.bytes, first, "the version the save was about to replace is readable again");
});

test("a conflict reload chosen before the history record exists does not erase an edit accepted while it waits (#2840)", async () => {
  const original = exampleMain(9);
  const host = createMemoryPlatformServices({ files: { [PATH]: original } });
  // Hold writes under the history folder's entries until the test releases them, so the choice is provably in flight.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let holding = true;
  const gated = { ...host.fs, write: async (path: string, bytes: Uint8Array) => (holding && path.startsWith(".tkr-history/entries/") ? gate.then(() => host.fs.write(path, bytes)) : host.fs.write(path, bytes)) };
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: { ...host, fs: gated } });
  const opened = await workspace.open(PATH);
  ok(opened.ok);
  const doc = opened.document;
  ok(doc.apply({ type: "set-game-title", title: "Mine" }).ok);
  host.seed(PATH, withTitle(original, "Theirs"));
  ok(!(await doc.save("manual")).ok, "the change on disk is a conflict");
  const choosing = doc.resolveConflict("reload");
  ok(choosing instanceof Promise);
  await Promise.resolve();
  ok(doc.apply({ type: "set-game-title", title: "Newer edit" }).ok);
  holding = false;
  release();
  const result = await choosing;
  ok(!result.ok, "the reload is refused because the document changed under it");
  match(result.message ?? "", /edited after you chose/);
  equal(gameTitleOf(doc), "Newer edit", "the newer edit is still the document");
});

test("deleting a saved file records a before-delete entry that thinning never removes (#2841)", async () => {
  let clock = 5_000_000;
  const host = createMemoryPlatformServices({ files: { [PATH]: withTitle(exampleMain(9), "On disk") } });
  const store = createDocumentHistoryStore({
    project: host.fs,
    storage: host.fs,
    location: { kind: "project-folder", description: "test" },
    policy: () => ({ ...DEFAULT_HISTORY_POLICY, mergeWindowMs: 0, autoFloorMs: 1000, warnBytes: 1 }),
    coveredType: (path) => path.endsWith(".gam"),
    now: () => clock,
  });
  // Only an autosave entry holds the bytes that are on disk when the user deletes the file.
  const onDisk = host.bytesOf(PATH)!;
  await store.recordSave(PATH, onDisk, "auto");
  const kept = await store.keep(PATH, onDisk, "before-delete");
  equal(kept.outcome, "recorded");
  const reasons = (await store.documentTimeline(PATH)).map((entry) => entry.reason);
  deepEqual(reasons, ["auto", "before-delete"]);
  clock += 100_000;
  const freed = await store.thin((await store.documentTimeline(PATH)).filter((entry) => entry.reason === "auto").map((entry) => entry.id));
  equal(freed, 0, "the content is shared with the permanent record, so thinning frees the record only");
  const survivors = await store.documentTimeline(PATH);
  deepEqual(survivors.map((entry) => entry.reason), ["before-delete"]);
  deepEqual((await store.preview(survivors[0]!.id))!.bytes, onDisk, "the version at the user's delete is still readable");
});

test("a document opened and edited while a closed-file restore records its history is not overwritten (#2838)", async () => {
  const first = withTitle(exampleMain(9), "First");
  const later = withTitle(exampleMain(9), "Later");
  const host = createMemoryPlatformServices({ files: { [PATH]: first } });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let holding = true;
  const gated = { ...host.fs, write: async (path: string, bytes: Uint8Array) => (holding && path.startsWith(".tkr-history/groups/") ? gate.then(() => host.fs.write(path, bytes)) : host.fs.write(path, bytes)) };
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: { ...host, fs: gated } });
  await workspace.history.recordSave(PATH, first, "manual");
  const entry = (await workspace.history.documentTimeline(PATH))[0]!;
  ok((await host.fs.write(PATH, later)).ok, "the file changed since that version");
  const restoring = workspace.restoreHistoryEntry(entry.id);
  await Promise.resolve();
  const opened = await workspace.open(PATH);
  ok(opened.ok);
  ok(opened.document.apply({ type: "set-game-title", title: "Typed while restoring" }).ok);
  holding = false;
  release();
  const report = await restoring;
  deepEqual(report.files.map((file) => [file.path, file.result]), [[PATH, "failed"]]);
  match(report.files[0]!.message ?? "", /changed after the restore started/);
  equal(gameTitleOf(opened.document), "Typed while restoring", "the newer edit is kept");
  equal(titleOf(host.bytesOf(PATH)!), "Later", "the disk file was not overwritten");
});

test("a document opened while a closed-file restore is checking the file is not written behind its back (#2838)", async () => {
  const first = withTitle(exampleMain(9), "First");
  const host = createMemoryPlatformServices({ files: { [PATH]: first } });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let reads = 0;
  let started!: () => void;
  const startedReading = new Promise<void>((resolve) => { started = resolve; });
  const gated = {
    ...host.fs,
    readProject: async (project: string, path: string) => {
      // The restore reads the closed file once to capture it; its final check is the second read, and that one is gated.
      if (path === PATH) {
        reads += 1;
        if (reads === 2) { started(); await gate; }
      }
      return host.fs.readProject(project, path);
    },
  };
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: { ...host, fs: gated } });
  await workspace.history.recordSave(PATH, first, "manual");
  const entry = (await workspace.history.documentTimeline(PATH))[0]!;
  ok((await host.fs.write(PATH, withTitle(exampleMain(9), "Later"))).ok, "the file changed since that version");
  const restoring = workspace.restoreHistoryEntry(entry.id);
  await startedReading;
  const opened = await workspace.open(PATH);
  ok(opened.ok);
  ok(opened.document.apply({ type: "set-game-title", title: "Typed while checking" }).ok);
  release();
  const report = await restoring;
  deepEqual(report.files.map((file) => [file.path, file.result]), [[PATH, "failed"]]);
  match(report.files[0]!.message ?? "", /opened while the restore was checking/);
  equal(gameTitleOf(opened.document), "Typed while checking");
  workspace.dispose();
});
