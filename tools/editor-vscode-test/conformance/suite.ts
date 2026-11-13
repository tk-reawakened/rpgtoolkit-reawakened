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

/** The next write the host starts, held at the point where its bytes would reach the file. */
export interface HeldWrite {
  /** Settles when that write has started and is waiting. */
  readonly started: Promise<void>;
  /** Let the held write finish; before it starts, stop holding it. */
  release(): void;
}

export interface ConformanceHost {
  readonly name: string;
  /** What the host declares to `editor-ui` (AD-20). */
  readonly capabilities: Capabilities;
  /**
   * How many writes one save makes while edits keep arriving during them: one where a later edit simply stays dirty,
   * more where the host writes it in the same save (ADR 0022 D14.6).
   */
  readonly saveWrites: number;
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
  /** Hold the next write the host starts (only that one) until it is released. */
  holdNextWrite(): HeldWrite;
  /** Let pending messages, events and writes run. */
  settle(): Promise<void>;
  /** Restart from the host's backups and reopen `path`; `null` when the host keeps no backup. */
  restartFromBackup(path: string): Promise<ConformanceEditor | null>;
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

/** `true` once `held` has started, `false` when `operation` finishes first (nothing reached the held write). */
function heldOrDone(held: HeldWrite, operation: Promise<unknown>): Promise<boolean> {
  return Promise.race([held.started.then(() => true), operation.then(() => false)]);
}

/** Wait until `held` has started; fail, rather than hang, when `operation` finishes without reaching it. */
async function heldWriteStarted(host: ConformanceHost, held: HeldWrite, operation: Promise<unknown>): Promise<void> {
  check(await heldOrDone(held, operation), `${host.name} finished before the held write started`);
  await host.settle();
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
    // Hosts complete a save differently (see `GameDocument.save` in host-vscode): the browser workspace marks clean only
    // the revision it wrote, so the later edit stays dirty; VS Code marks every edit it has heard of saved when the
    // provider resolves, so its provider writes the later edit too before resolving. In both drivers the edit is kept,
    // no failure is reported, and the host's dirty marker agrees with the model. The VS Code driver does not model an
    // edit or undo landing while the workbench records the save (ADR 0022 D14.6, #2225).
    name: "a save never claims an edit made during its write: it stays dirty or is written too, and no failure is reported",
    async run(host, fixture) {
      const editor = await host.open(GAME);
      await editor.type("Written");
      const held = host.holdNextWrite();
      const saving = editor.save();
      await heldWriteStarted(host, held, saving);
      same(editor.status(), "Saving…", "the view says it is saving while the write is held");
      same(editor.model.getSnapshot().dirty, true, "not clean before the host reports the write");
      sameBytes(await host.disk(GAME), fixture, "the held write has not reached the file");
      await editor.type("Later");
      held.release();
      await saving;
      await host.settle();
      same(editor.title(), "Later", "the later edit is kept");
      same(JSON.stringify(editor.alerts()), "[]", "a save whose captured revision was written is not reported as failed");
      const dirty = editor.model.getSnapshot().dirty;
      same(editor.hostDirty(), dirty, "the host's dirty marker agrees with the model");
      same(await titleOnDisk(host, GAME), dirty ? "Written" : "Later", "the file holds the captured revision while the later edit is dirty, or the later edit once clean");
      if (dirty) await editor.save();
      same(await titleOnDisk(host, GAME), "Later", "the latest edit reaches the file");
      check(!editor.model.getSnapshot().dirty && !editor.hostDirty(), "and then the document is clean");
      same(editor.status(), SAVED, "the view says it is saved");
    },
  },
  {
    name: "edits that keep outrunning a save stay unsaved and visible; a host that writes again gives up visibly",
    async run(host) {
      const editor = await host.open(GAME);
      await editor.type("Edit 0");
      let held = host.holdNextWrite();
      const saving = editor.save();
      let writes = 0;
      // Each write the save starts is held while one more edit arrives. The loop stops after one write more than any
      // host declares, so a host that kept writing fails the bound below instead of hanging.
      while (writes <= host.saveWrites && await heldOrDone(held, saving)) {
        writes += 1;
        await host.settle();
        await editor.type(`Edit ${writes}`);
        const next = host.holdNextWrite();
        held.release();
        held = next;
      }
      held.release();
      await saving;
      await host.settle();
      same(writes, host.saveWrites, `${host.name} writes exactly as many times as it declares before it stops (ADR 0022 D14.6)`);
      same(editor.title(), `Edit ${writes}`, "the latest edit is shown");
      check(editor.model.getSnapshot().dirty && editor.hostDirty(), "the latest edit is still unsaved in the model and the host");
      same(editor.status(), UNSAVED, "the view says so");
      same(await titleOnDisk(host, GAME), `Edit ${writes - 1}`, "the last write holds the revision it captured");
      same(
        editor.alerts().some((alert) => alert.includes(GAME)),
        host.saveWrites > 1,
        "a host that writes again for edits made during a save names the document when it gives up; a host that writes once reports nothing",
      );
      await editor.save();
      same(await titleOnDisk(host, GAME), `Edit ${writes}`, "the kept edit saves once the edits stop");
      check(!editor.model.getSnapshot().dirty && !editor.hostDirty(), "and then the document is clean");
    },
  },
  {
    name: "close with save never drops an edit made while the write is held",
    async run(host) {
      const editor = await host.open(GAME);
      await editor.type("Written on close");
      const held = host.holdNextWrite();
      const closing = editor.close("save");
      await heldWriteStarted(host, held, closing);
      same(editor.status(), "Saving…", "the close's save has reached the held write");
      await editor.type("Edited while closing");
      held.release();
      if (await closing) {
        same(await titleOnDisk(host, GAME), "Edited while closing", "a host that closes the tab wrote the newer edit first");
        same(host.modelsOpen(), 0, "and then released the model");
        return;
      }
      same(await titleOnDisk(host, GAME), "Written on close", "the held write captured the revision present when Save was answered");
      same(editor.title(), "Edited while closing", "the newer edit remains accessible in the source tab");
      same(editor.status(), UNSAVED, "the source still reports unsaved work");
      check(editor.model.getSnapshot().dirty && editor.hostDirty(), "the newer revision stays dirty in the model and host");
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
    name: "Save As during a held write copies its captured revision and keeps newer source edits",
    async run(host, fixture) {
      const editor = await host.open(GAME);
      await editor.type("Captured by Save As");
      const captured = retitled(fixture, "Captured by Save As");
      const destination = "Main/save-as-race.gam";
      const held = host.holdNextWrite();
      const saving = editor.saveAs(destination);
      await heldWriteStarted(host, held, saving);
      same(await titleOnDisk(host, destination), null, "the destination is not yet a complete file while the write is held");
      await editor.type("Edited during Save As");
      held.release();
      const copy = await saving;
      sameBytes(await host.disk(destination), captured, "the destination contains exactly the earlier captured revision");
      sameBytes(await host.disk(GAME), fixture, "Save As leaves the original source file unchanged");
      same(editor.title(), "Edited during Save As", "the newer source edit remains accessible");
      same(editor.status(), UNSAVED, "the source still reports unsaved work");
      check(editor.model.getSnapshot().dirty && editor.hostDirty(), "the source remains dirty in the model and host");
      same(copy, null, "the host reports partial completion rather than replacing the source with an older copy");
    },
  },
  {
    name: "Save As succeeds when a save of the same revision finishes during its write",
    async run(host) {
      const editor = await host.open(GAME);
      await editor.type("Copied and saved");
      const destination = "Main/save-as-saved.gam";
      const held = host.holdNextWrite();
      const saving = editor.saveAs(destination);
      await heldWriteStarted(host, held, saving);
      await editor.save();
      same(await titleOnDisk(host, GAME), "Copied and saved", "the plain save finished while Save As was writing");
      held.release();
      const copy = await saving;
      check(copy !== null, "finishing a save of the same revision is not a change that fails Save As");
      same(copy.title(), "Copied and saved", "the copy shows the revision written");
      same(await titleOnDisk(host, destination), "Copied and saved", "and its file holds it");
    },
  },
  {
    name: "Save As keeps the source when an undo and a new edit during its write leave the same number of edits",
    async run(host, fixture) {
      const editor = await host.open(GAME);
      await editor.type("Copied first");
      const destination = "Main/save-as-undo.gam";
      const held = host.holdNextWrite();
      const saving = editor.saveAs(destination);
      await heldWriteStarted(host, held, saving);
      await editor.undo();
      await editor.type("Replaced during Save As");
      same(editor.model.getSnapshot().edits.length, 1, "as many edits in force as when the copy was taken, but a different latest one");
      held.release();
      same(await saving, null, "the copy lacks the edit now in force, so Save As does not replace the source");
      same(await titleOnDisk(host, destination), "Copied first", "the destination holds the revision it captured");
      sameBytes(await host.disk(GAME), fixture, "the source file is unchanged");
      same(editor.title(), "Replaced during Save As", "the source keeps the new edit");
      check(editor.model.getSnapshot().dirty && editor.hostDirty(), "and it is unsaved in the model and the host");
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
      const opened = editor.title();
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
      await recovered.undo();
      same(recovered.title(), opened, "undoing the recovery shows the file as it is");
      await recovered.redo();
      await recovered.save();
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
    name: "closing one of two views preserves the shared model and prompts when the last closes",
    async run(host) {
      const first = await host.open(GAME);
      const second = await host.open(GAME);
      const original = first.title();
      await first.type("Shared unsaved work");
      same(await first.close("cancel"), true, "closing one view needs no loss confirmation");
      same(host.modelsOpen(), 1, "the remaining view still owns the model");
      const reopened = await host.open(GAME);
      check(reopened.model === second.model, "reopening reuses the model with the unsaved edit");
      same(reopened.title(), "Shared unsaved work", "the edit is visible in the reopened view");
      await second.undo();
      same(reopened.title(), original, "the shared undo history survives closing a view");
      await second.redo();
      same(reopened.title(), "Shared unsaved work", "the shared redo history survives too");
      same(await reopened.close("cancel"), true, "another non-final view closes");
      same(await second.close("cancel"), false, "the last dirty view asks and honours cancel");
      check(second.model.getSnapshot().dirty && second.hostDirty(), "the work remains dirty");
      same(await second.close("save"), true, "the last view can save and close");
      same(await titleOnDisk(host, GAME), "Shared unsaved work", "the work reached the file");
      same(host.modelsOpen(), 0, "the last close releases the model");
    },
  },
  {
    name: "a hidden second tab keeps the shared model and history after its sibling closes",
    async run(host) {
      const hidden = await host.open(GAME);
      const closing = await host.open(GAME);
      const original = hidden.title();
      check(hidden.model === closing.model, "both tabs share the same model before hiding");
      await hidden.type("Shared hidden edit");
      await hidden.hide();
      same(await closing.close("cancel"), true, "closing the other view needs no save prompt");
      same(host.modelsOpen(), 1, "the hidden view still owns the shared model");
      await hidden.show();
      check(hidden.model === closing.model, "showing the hidden view reuses the shared model");
      same(hidden.title(), "Shared hidden edit", "the hidden view shows the edit made in its sibling");
      await hidden.undo();
      same(hidden.title(), original, "the shared undo history survives hiding and closing its sibling");
      await hidden.redo();
      same(hidden.title(), "Shared hidden edit", "the shared redo history survives too");
      same(await hidden.close("cancel"), false, "the final dirty view prompts and honours cancel");
      check(hidden.model.getSnapshot().dirty && hidden.hostDirty(), "the last close leaves the edit dirty");
      same(await hidden.close("save"), true, "the final view can save and close");
      same(await titleOnDisk(host, GAME), "Shared hidden edit", "the final close saves the shared work");
      same(host.modelsOpen(), 0, "the last close releases the model");
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
];
