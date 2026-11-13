// The host conformance suite of story 11.3 (ADR 0022 D3; docs/editor-features.md T-01, T-06). One list of cases, each
// written once against `ConformanceHost`, and every host runs all of them: the browser host and the VS Code host, in
// its desktop and its browser form. A driver maps each user action to the host's own mechanism (the browser host's
// workspace and page dialogs; VS Code's workbench calling the custom editor provider), and reads back what the mounted
// `editor-ui` view shows. The cases import no test framework and no Node module.
import { createDocumentIdentity, createMainDocument, type MainDocument } from "@tk-reawakened/editor-model";
import type { Capabilities } from "@tk-reawakened/platform-services";

/** The fixture project every host is built over: two main files with distinct titles. */
export const GAME = "Main/example.gam";
export const SECOND = "Main/second.gam";

/** A user's answer to "save before closing?" (both hosts ask it with these three answers). */
export type CloseAnswer = "save" | "discard" | "cancel";

/** One editor tab with its mounted view. */
export interface ConformanceEditor {
  /** The document's path as the host opened it. */
  readonly path: string;
  /** The authoritative model: the browser workspace's, or the VS Code extension host's. */
  readonly model: MainDocument;
  /** The title the mounted view shows (its field's value). */
  title(): string;
  /** The view's save state: "All changes saved", "Unsaved changes" or "Saving…". */
  status(): string;
  /** The text of every alert the view shows. */
  alerts(): readonly string[];
  /** All the text the view shows. */
  text(): string;
  /** Whether the view shows the changed-on-disk choice (ADR 0022 D3.5). */
  conflictShown(): boolean;
  /** The host's own dirty marker: VS Code's working copy, or the browser workspace's document. */
  hostDirty(): boolean;
  /** Type a title in the view and press Enter: one accepted command. */
  type(title: string): Promise<void>;
  /** Press the view's Save and wait until the save settles. */
  save(): Promise<void>;
  /** The host's Undo and Redo. */
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** Close the tab, answering the host's question if it asks one; true when the tab closed. */
  close(answer: CloseAnswer): Promise<boolean>;
  /** Revert to the file on disk; `cancel` is the user backing out of it. True when the document was reverted. */
  revert(answer: "revert" | "cancel"): Promise<boolean>;
  /** Save As to `path`, confirming a replace when asked; the new tab, or `null` when nothing was saved. */
  saveAs(path: string): Promise<ConformanceEditor | null>;
  /** Press one of the view's changed-on-disk buttons and wait for the outcome. */
  choose(button: "Save my version" | "Use the version on disk"): Promise<void>;
  /** Hide the tab (its webview or view is destroyed) and show it again. */
  hide(): Promise<void>;
  show(): Promise<void>;
}

export interface DeferredRead {
  /** Resolves as soon as the held read reaches the filesystem adapter. */
  readonly whenStarted: Promise<void>;
  wasStarted(): boolean;
  release(): void;
  dispose(): void;
}

export interface ConformanceHost {
  readonly name: string;
  /** What the host declares to `editor-ui` (AD-20). */
  readonly capabilities: Capabilities;
  /** Open a tab on `path` (or another tab on an open document). Rejects when the host refuses to open it. */
  open(path: string): Promise<ConformanceEditor>;
  /** Save All; per path, whether that document saved. */
  saveAll(): Promise<ReadonlyMap<string, boolean>>;
  /** The file's bytes read behind the editor's back; `null` when there is no such file. */
  disk(path: string): Promise<Uint8Array | null>;
  /** Change, create or delete the file as another program would. */
  writeOutside(path: string, bytes: Uint8Array | null): Promise<void>;
  /** Make the host refuse every write, or accept them again. */
  refuseWrites(refuse: boolean): void;
  /** Hold every later write until the returned function is called. */
  holdWrites(): () => void;
  /** Hold the next file read for a path, for deterministic editor-switch race proofs. */
  deferNextRead?(path: string): DeferredRead;
  /** Number of active-editor Revert File command dispatches observed by this host. */
  workbenchRevertCommandCount?(): number;
  /** Let pending messages, events and writes run. */
  settle(): Promise<void>;
  /** Restart from the host's backup, if one is available. */
  restartFromBackup(path: string): Promise<ConformanceEditor | null>;
  /** Restart after capturing a hot-exit backup, changing the file while closed, then opening the backed-up document. */
  restartFromBackupAfterDiskChange?(path: string, bytes: Uint8Array): Promise<ConformanceEditor | null>;
  /** How many document models the host holds. */
  modelsOpen(): number;
}

export interface ConformanceCase {
  readonly name: string;
  run(host: ConformanceHost, fixture: Uint8Array): Promise<void>;
}

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function same<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function sameBytes(actual: Uint8Array | null, expected: Uint8Array | null, message: string): void {
  const equal = actual === null || expected === null
    ? actual === expected
    : actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);
  if (!equal) throw new Error(`${message}: the bytes differ`);
}

/** `bytes` with only the game title changed, written by the real model (the oracle the adapters' byte tests use). */
export function retitled(bytes: Uint8Array, title: string): Uint8Array {
  const storage = { readProject: async () => { throw new Error("unused"); }, writeProject: async () => { throw new Error("unused"); } };
  const opened = createMainDocument(storage, createDocumentIdentity("fixture", GAME), bytes);
  if (!opened.ok) throw new Error("the fixture is not a main file");
  const edited = opened.document.apply({ type: "set-game-title", title });
  if (!edited.ok) throw new Error(edited.rejection.message);
  return opened.document.serialize();
}

async function titleOnDisk(host: ConformanceHost, path: string): Promise<string | null> {
  const bytes = await host.disk(path);
  if (bytes === null) return null;
  const storage = { readProject: async () => { throw new Error("unused"); }, writeProject: async () => { throw new Error("unused"); } };
  const opened = createMainDocument(storage, createDocumentIdentity("fixture", path), bytes);
  return opened.ok ? opened.document.getSnapshot().gameTitle : null;
}

const UNSAVED = "Unsaved changes";
const SAVED = "All changes saved";

export const CONFORMANCE_CASES: readonly ConformanceCase[] = [
  {
    name: "undo and redo go through the host by editId, and dirty follows the commands in force",
    async run(host, fixture) {
      const editor = await host.open(GAME);
      const original = editor.title();
      await editor.type("First");
      await editor.type("Second");
      const ids = editor.model.getSnapshot().edits.map((edit) => edit.editId);
      same(ids.length, 2, "two accepted commands");
      check(new Set(ids).size === 2, "each command has its own editId");
      await editor.undo();
      same(editor.title(), "First", "undo takes back the latest command");
      same(editor.model.undo(ids[1]).ok, false, "an editId no longer in force is refused (stale)");
      same(editor.title(), "First", "a refused undo changes nothing");
      await editor.undo();
      same(editor.title(), original, "undo again shows the opened title");
      same(editor.model.getSnapshot().dirty, false, "back at what is on disk: clean");
      same(editor.hostDirty(), false, "the host agrees it is clean");
      same(editor.status(), SAVED, "and the view says so");
      await editor.redo();
      same(editor.title(), "First", "redo puts the first command back");
      same(editor.model.getSnapshot().edits[0]?.editId, ids[0], "redo restores the same editId");
      check(editor.hostDirty() && editor.model.getSnapshot().dirty, "redone work is dirty in the model and the host");
      sameBytes(await host.disk(GAME), fixture, "nothing was written");
    },
  },
  {
    name: "a save marks clean only what the host reports written; an edit made during the write stays dirty",
    async run(host, fixture) {
      const editor = await host.open(GAME);
      await editor.type("Written");
      const release = host.holdWrites();
      const saving = editor.save();
      await host.settle();
      same(editor.status(), "Saving…", "the view says it is saving while the write is held");
      same(editor.model.getSnapshot().dirty, true, "not clean before the host reports the write");
      sameBytes(await host.disk(GAME), fixture, "the held write has not reached the file");
      await editor.type("Later");
      release();
      await saving;
      await host.settle();
      same(await titleOnDisk(host, GAME), "Written", "the revision captured when Save was pressed is the one written");
      same(editor.title(), "Later", "the later edit is kept");
      check(editor.model.getSnapshot().dirty && editor.hostDirty(), "the later edit stays dirty in the model and the host");
      await editor.save();
      same(await titleOnDisk(host, GAME), "Later", "the next save writes it");
      check(!editor.model.getSnapshot().dirty && !editor.hostDirty(), "and then the document is clean");
      same(editor.status(), SAVED, "the view says it is saved");
    },
  },
  {
    name: "a failed write keeps the local work dirty and visible, names the document, and changes nothing on disk",
    async run(host, fixture) {
      const editor = await host.open(GAME);
      await editor.type("Not yet written");
      host.refuseWrites(true);
      await editor.save();
      same(editor.title(), "Not yet written", "the edit stays in the view");
      check(editor.model.getSnapshot().dirty && editor.hostDirty(), "the document stays dirty in the model and the host");
      same(editor.status(), UNSAVED, "the view does not claim it was saved");
      check(editor.alerts().some((alert) => alert.includes(GAME)), `an alert names ${GAME}: ${JSON.stringify(editor.alerts())}`);
      sameBytes(await host.disk(GAME), fixture, "the refused write changed nothing");
      host.refuseWrites(false);
      await editor.save();
      same(await titleOnDisk(host, GAME), "Not yet written", "the work is still there to save once the host accepts writes");
      check(!editor.hostDirty(), "and is then clean in the host");
    },
  },
  {
    name: "Save As writes a new identity, opens it clean, leaves the source file unchanged and refuses a destination outside the project",
    async run(host, fixture) {
      const editor = await host.open(GAME);
      await editor.type("Saved elsewhere");
      same(await editor.saveAs("../outside.gam"), null, "a destination outside the project is refused");
      same(await host.disk("../outside.gam").catch(() => null), null, "and nothing is written there");
      check(editor.model.getSnapshot().dirty, "the refused Save As leaves the source dirty");
      const copy = await editor.saveAs("Main/copy.gam");
      check(copy !== null, "Save As inside the project succeeds");
      same(copy.path, "Main/copy.gam", "the copy has the new path as its identity");
      check(copy.model !== editor.model, "the copy is a new document, not the source re-keyed");
      same(copy.title(), "Saved elsewhere", "the copy shows the edited title");
      check(!copy.model.getSnapshot().dirty && !copy.hostDirty(), "the copy is clean");
      same(await titleOnDisk(host, "Main/copy.gam"), "Saved elsewhere", "the copy's file holds the edit");
      sameBytes(await host.disk(GAME), fixture, "the source file is unchanged");
    },
  },
  {
    name: "Save All saves each dirty document on its own and reports each result",
    async run(host) {
      const first = await host.open(GAME);
      const second = await host.open(SECOND);
      await first.type("All one");
      await second.type("All two");
      const outside = retitled((await host.disk(SECOND))!, "Changed outside");
      await host.writeOutside(SECOND, outside);
      await host.settle();
      const results = await host.saveAll();
      same(results.get(GAME), true, "the first document saved");
      same(results.get(SECOND), false, "the second, changed on disk, did not");
      same(await titleOnDisk(host, GAME), "All one", "the saved document is on disk");
      same(await titleOnDisk(host, SECOND), "Changed outside", "the other program's version was not overwritten");
      check(!first.hostDirty() && second.hostDirty(), "each document's dirty state is its own");
      same(second.title(), "All two", "the unsaved work is kept");
    },
  },
  {
    name: "closing asks before losing work: cancel keeps everything, a failed save keeps the tab, discard drops the model",
    async run(host, fixture) {
      const editor = await host.open(GAME);
      await editor.type("Do not lose me");
      same(await editor.close("cancel"), false, "a cancelled close keeps the tab");
      same(editor.title(), "Do not lose me", "with its work");
      check(editor.model.getSnapshot().dirty && editor.hostDirty(), "still dirty");
      same(host.modelsOpen(), 1, "and its model");
      await editor.undo();
      await editor.redo();
      same(editor.title(), "Do not lose me", "and its undo history");
      host.refuseWrites(true);
      same(await editor.close("save"), false, "a close whose save fails keeps the tab");
      same(editor.title(), "Do not lose me", "the work is still there");
      host.refuseWrites(false);
      same(await editor.close("discard"), true, "Don't save closes it");
      same(host.modelsOpen(), 0, "and drops the model");
      sameBytes(await host.disk(GAME), fixture, "discarding wrote nothing");
      const reopened = await host.open(GAME);
      same(reopened.title(), (await titleOnDisk(host, GAME))!, "reopening reads the file again");
      await reopened.type("Saved on close");
      same(await reopened.close("save"), true, "save and close");
      same(await titleOnDisk(host, GAME), "Saved on close", "wrote the work first");
    },
  },
  {
    name: "revert is the user's choice: backing out keeps the work, reverting returns to the saved file and keeps the history before it",
    async run(host) {
      const editor = await host.open(GAME);
      const opened = editor.title();
      await editor.type("Saved revision");
      await editor.save();
      await editor.type("Thrown away");
      same(await editor.revert("cancel"), false, "backing out of revert");
      same(editor.title(), "Thrown away", "keeps the unsaved work");
      same(await editor.revert("revert"), true, "revert");
      same(editor.title(), "Saved revision", "shows the saved file");
      check(!editor.model.getSnapshot().dirty && !editor.hostDirty(), "and is clean in the model and the host");
      await editor.undo();
      same(editor.title(), opened, "the history before the save point is kept");
      check(editor.hostDirty(), "and undoing it is a change again");
    },
  },
  {
    name: "a backup is offered back only by a host that declares one",
    async run(host) {
      const editor = await host.open(GAME);
      await editor.type("Only in the backup");
      const recovered = await host.restartFromBackup(GAME);
      if (!host.capabilities.has("backup")) {
        same(recovered, null, `${host.name} keeps no backup and offers none`);
        check(!/backup|recover/i.test(editor.text()), "the view never implies a backup it does not have");
        return;
      }
      check(recovered !== null, `${host.name} declares backup, so the unsaved work comes back`);
      same(recovered.title(), "Only in the backup", "the recovered view shows the unsaved title");
      check(recovered.model.getSnapshot().dirty && recovered.hostDirty(), "recovered work is unsaved");
      check(recovered.conflictShown(), "the unknown backup baseline needs an explicit choice");
      await recovered.choose("Save my version");
      same(await titleOnDisk(host, GAME), "Only in the backup", "and the recovered work saves to the original file");
    },
  },
  {
    name: "a change on disk under unsaved work is never saved over: both versions wait for an explicit choice",
    async run(host, fixture) {
      const editor = await host.open(GAME);
      await editor.type("Mine");
      const theirs = retitled(fixture, "Theirs");
      await host.writeOutside(GAME, theirs);
      await host.settle();
      same(editor.conflictShown(), host.capabilities.has("fileWatch"), "the change is shown at once exactly when the host declares fileWatch");
      if (!host.capabilities.has("fileWatch")) {
        check(/cannot watch files/.test(editor.text()), "a host that cannot watch says so");
        await editor.save();
      }
      check(editor.conflictShown(), "by the save at the latest the change is shown");
      check(editor.text().includes("Mine") && editor.text().includes("Theirs"), "both titles are shown to compare");
      sameBytes(await host.disk(GAME), theirs, "the other program's version was not overwritten");
      check(editor.model.getSnapshot().dirty && editor.hostDirty(), "the local work is still unsaved");
      same(editor.title(), "Mine", "and still shown");
      await editor.choose("Use the version on disk");
      same(editor.title(), "Theirs", "the disk's version is loaded by choice");
      check(!editor.model.getSnapshot().dirty && !editor.hostDirty() && !editor.conflictShown(), "and it is clean");

      await editor.type("Mine again");
      await host.writeOutside(GAME, retitled(fixture, "Theirs again"));
      await host.settle();
      if (!editor.conflictShown()) await editor.save();
      check(editor.conflictShown(), "a second change waits for a choice too");
      await editor.choose("Save my version");
      same(await titleOnDisk(host, GAME), "Mine again", "keeping mine writes it, by choice");
      check(!editor.model.getSnapshot().dirty && !editor.hostDirty() && !editor.conflictShown(), "and it is clean");
    },
  },
  {
    name: "a clean document follows a change on disk where the host watches, and finds it at the next save where it cannot",
    async run(host, fixture) {
      const editor = await host.open(GAME);
      const opened = editor.title();
      await host.writeOutside(GAME, retitled(fixture, "Moved on"));
      await host.settle();
      if (host.capabilities.has("fileWatch")) {
        same(editor.title(), "Moved on", "a watching host shows the new version");
        check(!editor.conflictShown() && !editor.hostDirty(), "with nothing to choose, since nothing local was lost");
        return;
      }
      same(editor.title(), opened, "a host that cannot watch keeps showing what it read");
      await editor.type("Edited blind");
      await editor.save();
      check(editor.conflictShown(), "the save finds the change instead of writing over it");
      same(await titleOnDisk(host, GAME), "Moved on", "and the file keeps the other version");
    },
  },
  {
    name: "a hidden view loses nothing: the title, dirty state, undo history and a waiting change come back with it",
    async run(host, fixture) {
      const editor = await host.open(GAME);
      const opened = editor.title();
      await editor.type("Before hiding");
      await editor.hide();
      await host.writeOutside(GAME, retitled(fixture, "While hidden"));
      await host.settle();
      await editor.show();
      same(editor.title(), "Before hiding", "the re-created view shows the document's title");
      same(editor.status(), UNSAVED, "and that it is unsaved");
      same(editor.conflictShown(), host.capabilities.has("fileWatch"), "a change seen while hidden waits in the returning view where the host watches");
      await editor.undo();
      same(editor.title(), opened, "undo after showing again takes back the edit made before hiding");
    },
  },
  {
    name: "one model per document: two tabs share it, another spelling of its path never makes a second, and a case-only twin is refused",
    async run(host) {
      const first = await host.open(GAME);
      const second = await host.open(GAME);
      same(host.modelsOpen(), 1, "two tabs of one file hold one model");
      check(first.model === second.model, "the same model");
      await first.type("Typed in one tab");
      await host.settle();
      same(second.title(), "Typed in one tab", "the other tab shows the edit");
      const respelled = await host.open("main/EXAMPLE.GAM").catch(() => null);
      if (respelled !== null) check(respelled.model === first.model, "another spelling opens the same model");
      same(host.modelsOpen(), 1, "another spelling never makes a second model");
      await host.writeOutside("Main/SECOND.gam", (await host.disk(SECOND))!);
      const twin = await host.open(SECOND).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
      check(typeof twin === "string" && twin.includes("Main/SECOND.gam") && twin.includes("Main/second.gam"), `files that differ only in case are refused, naming both: ${String(twin)}`);
      same(host.modelsOpen(), 1, "and the refused file opens no model");
    },
  },
  {
    name: "capabilities are truthful: each one declared is backed by behaviour, and none other is claimed",
    async run(host, fixture) {
      for (const capability of host.capabilities) {
        check(["folderWrite", "fileWatch", "stableProjectHandle", "backup"].includes(capability), `${host.name} claims only what it does (${capability})`);
      }
      const editor = await host.open(GAME);
      await editor.type("Written through the host");
      await editor.save();
      same(
        (await titleOnDisk(host, GAME)) === "Written through the host",
        host.capabilities.has("folderWrite"),
        "folderWrite is declared exactly when a save reaches the project folder",
      );
      same(/cannot watch files/.test(editor.text()), !host.capabilities.has("fileWatch"), "the view says live change detection is missing exactly when fileWatch is");
      await host.writeOutside(GAME, retitled(fixture, "Seen live?"));
      await host.settle();
      same(editor.title() === "Seen live?", host.capabilities.has("fileWatch"), "fileWatch is declared exactly when an outside change reaches the view without a save");
      await editor.type("Unsaved before a restart");
      same((await host.restartFromBackup(GAME)) !== null, host.capabilities.has("backup"), "backup is declared exactly when a restart can offer unsaved work back");
    },
  },
  {
    name: "a recovered backup never overwrites a different title written while VS Code was closed",
    async run(host) {
      if (!host.capabilities.has("backup") || host.restartFromBackupAfterDiskChange === undefined) return;
      const external = retitled((await host.disk(GAME))!, "External while closed");
      const recovered = await host.restartFromBackupAfterDiskChange(GAME, external);
      check(recovered !== null, "the workbench reopens its backed-up document");
      same(recovered.title(), "Local backup", "the recovered editor shows the backed-up title");
      check(recovered.conflictShown(), "the unknown backup baseline requires a choice");
      check(recovered.text().includes("Local backup") && recovered.text().includes("External while closed"), "the view shows both versions");
      sameBytes(await host.disk(GAME), external, "the external bytes remain untouched before resolution");

      const saveResults = await host.saveAll();
      same(saveResults.get(GAME), false, "workbench Save All refuses before a recovery choice");
      same(recovered.title(), "Local backup", "a failed keep-local save retains the recovery");
      check(recovered.model.getSnapshot().dirty && recovered.hostDirty(), "a failed save retains dirty work");
      check(recovered.conflictShown(), "a failed save keeps the conflict unresolved");
      sameBytes(await host.disk(GAME), external, "a failed save does not overwrite external bytes");


      await recovered.choose("Save my version");
      same(await titleOnDisk(host, GAME), "Local backup", "an explicit successful keep-local choice writes the backup");
      check(!recovered.model.getSnapshot().dirty && !recovered.hostDirty(), "the resolved local version is clean");
    },
  },
  {
    name: "a recovered backup can explicitly reload the title written while VS Code was closed",
    async run(host) {
      if (!host.capabilities.has("backup") || host.restartFromBackupAfterDiskChange === undefined) return;
      const external = retitled((await host.disk(GAME))!, "External while closed");
      const recovered = await host.restartFromBackupAfterDiskChange(GAME, external);
      check(recovered !== null, "the workbench reopens its backed-up document");
      same(recovered.title(), "Local backup", "the recovered editor starts with the backed-up title");
      check(recovered.conflictShown(), "the unknown backup baseline requires a choice");
      sameBytes(await host.disk(GAME), external, "the external bytes remain untouched before resolution");
      await recovered.choose("Use the version on disk");
      same(recovered.title(), "External while closed", "reload shows the external title");
      check(!recovered.model.getSnapshot().dirty && !recovered.hostDirty() && !recovered.conflictShown(), "the reloaded version is clean and resolved");
      sameBytes(await host.disk(GAME), external, "reloading leaves the external bytes unchanged");
    },
  },
  {
    name: "a recovered reload fails closed without reading or reverting another dirty editor",
    async run(host) {
      const deferNextRead = host.deferNextRead;
      const getRevertCommandCount = host.workbenchRevertCommandCount;
      if (
        !host.capabilities.has("backup")
        || host.restartFromBackupAfterDiskChange === undefined
        || deferNextRead === undefined
        || getRevertCommandCount === undefined
      ) return;
      const external = retitled((await host.disk(GAME))!, "External while closed");
      const recovered = await host.restartFromBackupAfterDiskChange(GAME, external);
      check(recovered !== null, "the workbench reopens its backed-up document");
      const unrelated = await host.open(SECOND);
      await unrelated.type("Unrelated unsaved title");
      const read = deferNextRead.call(host, GAME);
      const revertCommands = getRevertCommandCount.call(host);
      const reloading = recovered.choose("Use the version on disk");
      try {
        await host.settle();
        if (read.wasStarted()) await read.whenStarted;
        await unrelated.type("Unrelated editor stays dirty");
        read.release();
        await reloading;

        check(!read.wasStarted(), "the unsupported reload is refused before reading disk");
        same(getRevertCommandCount.call(host), revertCommands, "the active-editor Revert File command was not dispatched");
        same(recovered.title(), "Local backup", "the recovered copy is retained");
        check(recovered.model.getSnapshot().dirty && recovered.hostDirty() && recovered.conflictShown(), "its model, workbench dirty marker and conflict stay coherent");
        same(unrelated.title(), "Unrelated editor stays dirty", "the other editor's content is untouched");
        check(unrelated.model.getSnapshot().dirty && unrelated.hostDirty(), "the other editor remains dirty in both model and workbench");
        same(unrelated.status(), UNSAVED, "the other editor keeps its unsaved status");
        sameBytes(await host.disk(GAME), external, "the external file remains unchanged");
      } finally {
        read.release();
        read.dispose();
      }
    },
  },
  {
    name: "workbench undo and redo retain user edits after the watcher has matched disk",
    async run(host, fixture) {
      if (!host.capabilities.has("fileWatch") || host.restartFromBackupAfterDiskChange === undefined) return;
      const editor = await host.restartFromBackupAfterDiskChange(GAME, fixture);
      check(editor !== null, "the workbench restores the backup");
      await editor.type("User edit after recovery");
      await host.writeOutside(GAME, retitled(fixture, "User edit after recovery"));
      await host.settle();
      await host.writeOutside(GAME, retitled(fixture, "User edit after recovery"));
      await host.settle();
      await editor.undo();
      same(editor.title(), "Local backup", "workbench undo returns to the recovered title");
      await editor.redo();
      same(editor.title(), "User edit after recovery", "workbench redo restores the user edit");
      sameBytes(await host.disk(GAME), retitled(fixture, "User edit after recovery"), "undo and redo do not write to disk");
    },
  },
];
