// The VS Code host under the conformance suite: the real custom editor provider (`host-vscode`'s `custom-editor.ts`),
// its `workspace.fs` adapter, its webview bridge and the shared view, with VS Code's own parts played here. Those parts
// follow VS Code's custom-editor contract (https://code.visualstudio.com/api/extension-guides/custom-editors):
//
// * the workbench keeps the undo stack of fired edit events, a save point and the dirty marker; Undo and Redo call an
//   edit's own `undo`/`redo`; Save calls `saveCustomDocument` and, once it resolves, moves the save point to the latest
//   edit (a newer Save supersedes an older one, which then fails as cancelled); Revert calls `revertCustomDocument` and
//   drops the edits after the save point; closing a dirty tab asks Save / Don't Save / Cancel and, after Save, keeps the
//   tab only if it is still dirty; Save As calls `saveCustomDocumentAs`, then moves the source's save point to the latest
//   edit and replaces the source tab with the destination. This is `MainThreadCustomEditorModel.saveCustomEditor`,
//   `saveCustomEditorAs` and `EditorGroupView`'s close confirmation in VS Code's source;
// * a webview is a separate page that talks to the extension host only through asynchronous, structured-cloned
//   messages, and with `retainContextWhenHidden: false` a hidden tab's page is destroyed and loaded again when shown;
// * the desktop watcher reports every change below the folder, including the extension's own writes.
//
// The real-workbench proof (`web-proof.ts`, run in CI against `@vscode/test-web`) checks the same behaviours in VS Code
// itself; this driver lets every conformance case run in under a second.
import { posix } from "node:path";
import { asMainDocument, type BoardPicture, type MainDocument } from "@tk-reawakened/editor-model";
import { mount, type ViewContext, type ViewHandle } from "@tk-reawakened/editor-ui";
import type { Capability, DialogQuestion, DialogService, FileChange, OutsideFile } from "@tk-reawakened/platform-services";
import {
  createGameEditorProvider,
  createVscodeFileSystemWithPort,
  RemoteDocument,
  vscodeCapabilities,
  type BridgeMessage,
  type EditorHostRequest,
  type GameDocument,
  type GameEditEvent,
  type GameEditorProvider,
  type VscodeFileSystemPort,
} from "@tk-reawakened/host-vscode/testing";
import { GAME, SECOND, retitled, type CloseAnswer, type ConformanceEditor, type ConformanceHost, type DeferredRead, type HeldWrite } from "./suite.ts";
import { MountedView, settle, type Act } from "./view.ts";

interface Uri { readonly path: string }

const ROOT: Uri = { path: "/project" };
const FOLDER = { uri: ROOT, key: "file:///project" };

interface DeferredReadGate {
  readonly wait: Promise<void>;
  start(): void;
}

/** The next write to hold: it calls `start` when it begins, then waits for `wait`. */
interface WriteHold {
  readonly wait: Promise<void>;
  start(): void;
}

/** The files on disk, by absolute path, case-sensitive, with the desktop watcher's listeners. */
class Disk {
  readonly files = new Map<string, Uint8Array>();
  readonly watchers = new Set<{ readonly root: string; readonly onChange: (change: FileChange) => void }>();
  refuse = false;
  hold: WriteHold | null = null;
  readonly deferredReads = new Map<string, DeferredReadGate>();

  deferNextRead(path: string): DeferredRead {
    if (this.deferredReads.has(path)) throw new Error(`a read is already deferred for ${path}`);
    let release!: () => void;
    let markStarted!: () => void;
    let started = false;
    const whenStarted = new Promise<void>((resolve) => { markStarted = resolve; });
    const gate: DeferredReadGate = {
      wait: new Promise<void>((resolve) => { release = resolve; }),
      start: () => { started = true; markStarted(); },
    };
    this.deferredReads.set(path, gate);
    return {
      whenStarted,
      wasStarted: () => started,
      release,
      dispose: () => {
        if (this.deferredReads.get(path) === gate) this.deferredReads.delete(path);
      },
    };
  }

  notify(path: string, kind: FileChange["kind"]): void {
    for (const watcher of [...this.watchers]) {
      const prefix = `${watcher.root}/`;
      if (path.startsWith(prefix)) queueMicrotask(() => watcher.onChange({ kind, path: path.slice(prefix.length) }));
    }
  }
}

function fileSystemPort(disk: Disk): VscodeFileSystemPort<Uri> {
  const missing = (uri: Uri) => Object.assign(new Error(`${uri.path} was not found`), { code: "FileNotFound" });
  return {
    isDirectory: (type) => (type & 2) !== 0,
    joinPath: (base, ...parts) => ({ path: `${base.path}/${parts.join("/")}` }),
    parent: (uri) => ({ path: uri.path.slice(0, uri.path.lastIndexOf("/")) }),
    async readDirectory(uri) {
      const prefix = `${uri.path}/`;
      const entries = new Map<string, number>();
      for (const path of disk.files.keys()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf("/");
        entries.set(slash === -1 ? rest : rest.slice(0, slash), slash === -1 ? 1 : 2);
      }
      if (entries.size === 0) throw missing(uri);
      return [...entries];
    },
    async readFile(uri) {
      const deferred = disk.deferredReads.get(uri.path);
      if (deferred !== undefined) {
        disk.deferredReads.delete(uri.path);
        deferred.start();
        await deferred.wait;
      }
      const bytes = disk.files.get(uri.path);
      if (bytes === undefined) throw missing(uri);
      return bytes.slice();
    },
    async createDirectory() {},
    async writeFile(uri, bytes) {
      if (disk.refuse) throw Object.assign(new Error("the workspace refuses writes"), { code: "NoPermissions" });
      const held = disk.hold;
      if (held !== null) {
        disk.hold = null;
        held.start();
        await held.wait;
      }
      const kind = disk.files.has(uri.path) ? "changed" : "created";
      disk.files.set(uri.path, bytes.slice());
      disk.notify(uri.path, kind);
    },
    async stat(uri) {
      const bytes = disk.files.get(uri.path);
      if (bytes !== undefined) return { type: 1, size: bytes.length, mtime: 0 };
      if ([...disk.files.keys()].some((path) => path.startsWith(`${uri.path}/`))) return { type: 2, size: 0, mtime: 0 };
      throw missing(uri);
    },
    async delete(uri) {
      if (!disk.files.delete(uri.path)) throw missing(uri);
      disk.notify(uri.path, "deleted");
    },
    async rename() { throw new Error("not used"); },
    async watch(uri, onChange) {
      const watcher = { root: uri.path, onChange };
      disk.watchers.add(watcher);
      return { dispose: () => void disk.watchers.delete(watcher) };
    },
    errorCode: (error) => (typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined),
  };
}

/** VS Code's working copy of one custom document: its edit stack, save point and tabs. */
class WorkingCopy {
  readonly uri: Uri;
  readonly custom: GameDocument<Uri>;
  readonly tabs = new Set<VscodeEditor>();
  readonly #provider: GameEditorProvider<Uri>;
  #edits: GameEditEvent<Uri>[] = [];
  #index = -1;
  #savePoint = -1;
  /** The save whose completion may still move the save point; a newer Save cancels the older one. */
  #ongoingSave: { cancel(): void } | null = null;
  fromBackup = false;

  constructor(uri: Uri, custom: GameDocument<Uri>, provider: GameEditorProvider<Uri>) {
    this.uri = uri;
    this.custom = custom;
    this.#provider = provider;
  }

  get dirty(): boolean {
    return this.#index !== this.#savePoint || this.fromBackup;
  }

  record(event: GameEditEvent<Uri>): void {
    this.#edits.splice(this.#index + 1);
    this.#edits.push(event);
    this.#index += 1;
  }

  undo(): void {
    const edit = this.#edits[this.#index];
    if (edit === undefined) return;
    this.#index -= 1;
    edit.undo();
  }

  redo(): void {
    const edit = this.#edits[this.#index + 1];
    if (edit === undefined) return;
    this.#index += 1;
    edit.redo();
  }

  /**
   * Save; rejects when the provider's save throws, as the workbench's save command does. When the provider resolves,
   * every edit heard of by then counts as saved, as in VS Code.
   */
  async save(): Promise<void> {
    this.#ongoingSave?.cancel();
    const ongoing = { cancel: () => {} };
    const cancelled = new Promise<never>((_, reject) => { ongoing.cancel = () => reject(new Error("Canceled")); });
    this.#ongoingSave = ongoing;
    try {
      await Promise.race([this.#provider.saveCustomDocument(this.custom), cancelled]);
      if (this.#ongoingSave === ongoing) {
        this.#savePoint = this.#index;
        this.fromBackup = false;
      }
    } finally {
      if (this.#ongoingSave === ongoing) this.#ongoingSave = null;
    }
  }

  async revert(): Promise<void> {
    if (!this.dirty) return;
    await this.#provider.revertCustomDocument(this.custom);
    this.#index = this.#savePoint;
    this.#edits.splice(this.#savePoint + 1);
    this.fromBackup = false;
  }

  /** After Save As the workbench treats the source as saved at its latest edit: its content now lives at the destination. */
  markSavedAs(): void {
    this.#savePoint = this.#index;
    this.fromBackup = false;
  }
}

interface Page {
  readonly element: HTMLElement;
  remote: RemoteDocument | null;
  handle: ViewHandle | null;
}

/** One webview page. A hidden page is destroyed; showing it loads the page again, which asks the extension for the document. */
class Webview {
  readonly #act: Act;
  readonly #listeners = new Set<(message: unknown) => unknown>();
  readonly #disposeListeners = new Set<() => void>();
  #page: Page | null = null;

  constructor(act: Act) {
    this.#act = act;
  }

  readonly port = {
    postMessage: (message: BridgeMessage): Promise<boolean> => {
      const page = this.#page;
      if (page === null) return Promise.resolve(false);
      const copy = structuredClone(message);
      setTimeout(() => void this.#act(() => this.#receive(page, copy)), 0);
      return Promise.resolve(true);
    },
    onDidReceiveMessage: (listener: (message: unknown) => unknown) => {
      this.#listeners.add(listener);
      return { dispose: () => void this.#listeners.delete(listener) };
    },
    onDidDispose: (listener: () => void) => {
      this.#disposeListeners.add(listener);
      return { dispose: () => void this.#disposeListeners.delete(listener) };
    },
  };

  get view(): MountedView {
    if (this.#page === null) throw new Error("the webview is hidden");
    return new MountedView(this.#page.element, this.#act);
  }

  /** The webview's document proxy, for a proof that drives what a view would call. */
  remoteDocument(): RemoteDocument {
    const remote = this.#page?.remote;
    if (remote === null || remote === undefined) throw new Error("the webview is not initialized");
    return remote;
  }

  /** The board's picture, asked for through the webview's own bridge as the board view asks for it. */
  async picture(): Promise<BoardPicture> {
    const remote = this.#page?.remote;
    if (remote === null || remote === undefined) throw new Error("the webview is not initialized");
    return remote.preview();
  }

  /** Send a hidden reload request as an old or compromised webview, through the real bridge. */
  async forgedReload(): Promise<void> {
    const remote = this.#page?.remote;
    if (remote === null || remote === undefined) throw new Error("the webview is not initialized");
    const result = await remote.resolveConflict("reload");
    if (result.ok || result.reason !== "cannot-reload") {
      throw new Error(`forged reload must be rejected with cannot-reload, got ${JSON.stringify(result)}`);
    }
  }

  /** Load the page: what `webview.tsx` does on load, with this page's own `acquireVsCodeApi()`. */
  show(): void {
    const element = document.createElement("div");
    document.body.append(element);
    this.#page = { element, remote: null, handle: null };
    this.#send({ type: "ready" });
  }

  hide(): void {
    const page = this.#page;
    this.#page = null;
    page?.handle?.dispose();
    page?.element.remove();
  }

  dispose(): void {
    this.hide();
    for (const listener of [...this.#disposeListeners]) listener();
  }

  #send(request: EditorHostRequest): void {
    const copy = structuredClone(request);
    setTimeout(() => { for (const listener of [...this.#listeners]) void listener(copy); }, 0);
  }

  #receive(page: Page, message: BridgeMessage): void {
    if (this.#page !== page) return;
    if (message.type === "initialize") {
      const remote = new RemoteDocument(message.kind, message.snapshot, message.browserState, {
        postMessage: (request) => this.#send(request),
        getState: () => undefined,
        setState: () => undefined,
      }, message.boardPreferences);
      page.remote = remote;
      page.handle = mount(page.element, {
        document: remote as unknown as ViewContext["document"],
        services: { document: { edited: () => undefined }, capabilities: new Set(message.capabilities) },
        browser: {
          session: remote.browserSession,
          fs: { list: (path) => remote.browserList(path), read: (path) => remote.browserRead(path) },
          layout: { projectFolder: "" },
        },
        boardPreferences: remote.boardPreferences,
      });
      return;
    }
    page.remote?.receive(message);
  }
}

async function untilSaved(view: MountedView, model: MainDocument, act: Act): Promise<void> {
  await settle(act, 2);
  for (let round = 0; round < 10_000 && (view.status() === "Saving…" || model.getSnapshot().saving); round += 1) await settle(act, 1);
  await settle(act, 2);
}

/** One VS Code instance's open documents and tabs; a restart replaces it with a fresh one over the same disk. */
class Workbench {
  readonly copies = new Map<string, WorkingCopy>();
  readonly provider: GameEditorProvider<Uri>;
  readonly host: VscodeHost;
  active: VscodeEditor | null = null;

  constructor(host: VscodeHost, capabilities: readonly Capability[]) {
    this.host = host;
    const script = host.script;
    const never: DialogService = {
      ask: async <Id extends string>(question: DialogQuestion<Id>): Promise<Id> => {
        const answer = script.answers.shift();
        if (answer === undefined) throw new Error("the provider asked a question; in VS Code the workbench asks");
        script.asked.push(question.message);
        const chosen = question.choices.find((choice) => choice.id === answer);
        if (chosen === undefined) throw new Error(`"${answer}" is not an answer to "${question.message}"`);
        return chosen.id;
      },
      pickSavePath: () => Promise.reject(new Error("the provider asked for a path; in VS Code the workbench asks")),
      pickFile: async () => script.files.shift() ?? null,
    };
    this.provider = createGameEditorProvider<Uri>({
      capabilities,
      folderOf: (uri) => (uri.path.startsWith(`${ROOT.path}/`) ? FOLDER : undefined),
      fileSystem: (folder) => createVscodeFileSystemWithPort(folder.uri, fileSystemPort(host.drive), folder.key),
      dialogs: () => never,
      readBackup: async (id) => {
        const bytes = host.backups.get(id);
        if (bytes === undefined) throw new Error(`no backup ${id}`);
        return bytes.slice();
      },
      writeBackup: async (destination, bytes) => {
        host.backups.set(destination.path, bytes.slice());
        return destination.path;
      },
      deleteBackup: async (destination) => void host.backups.delete(destination.path),
      uriFor: (_folder, path) => ({ path: posix.normalize(`${ROOT.path}/${path}`) }),
      // The workbench opens the editor for the file: it asks the provider for the custom document, as VS Code does.
      openEditor: async (uri) => {
        const path = posix.relative(ROOT.path, uri.path);
        script.opened.push(path);
        await this.focusOrOpen(path);
      },
      quickPick: async (items, placeholder) => {
        script.pickLists.push({ placeholder, labels: items.map((item) => item.label) });
        return script.picks.shift();
      },
      executeCommand: async (command) => {
        const target = this.active?.copy;
        if (target === undefined) return;
        if (command === "workbench.action.files.save") await target.save();
        else {
          this.host.revertCommands += 1;
          await target.revert();
        }
      },
    }, (event) => {
      for (const copy of this.copies.values()) if (copy.custom === event.document) copy.record(event);
    });
  }

  /** `vscode.open`: an editor already showing the file comes to the front; otherwise one opens. */
  async focusOrOpen(path: string): Promise<VscodeEditor> {
    const existing = this.copies.get(posix.normalize(`${ROOT.path}/${path}`))?.tabs.values().next().value;
    if (existing !== undefined) {
      this.active = existing;
      return existing;
    }
    return this.open(path);
  }

  async open(path: string, backupId?: string): Promise<VscodeEditor> {
    const uri = { path: posix.normalize(`${ROOT.path}/${path}`) };
    let copy = this.copies.get(uri.path);
    if (copy === undefined) {
      const custom = await this.provider.openCustomDocument(uri, backupId);
      copy = new WorkingCopy(uri, custom, this.provider);
      copy.fromBackup = backupId !== undefined;
      this.copies.set(uri.path, copy);
    }
    const webview = new Webview(this.host.act);
    this.provider.resolveCustomEditor(copy.custom, webview.port);
    const editor = new VscodeEditor(this, copy, webview);
    copy.tabs.add(editor);
    webview.show();
    this.active = editor;
    await settle(this.host.act);
    return editor;
  }

  /** Close a tab; the last tab of a document disposes the custom document. */
  closeTab(editor: VscodeEditor): void {
    editor.webview.dispose();
    editor.copy.tabs.delete(editor);
    if (editor.copy.tabs.size === 0) {
      this.copies.delete(editor.copy.uri.path);
      editor.copy.custom.dispose();
    }
    if (this.active === editor) this.active = null;
  }
}

class VscodeEditor implements ConformanceEditor {
  readonly path: string;
  readonly #workbench: Workbench;
  readonly copy: WorkingCopy;
  readonly webview: Webview;

  constructor(workbench: Workbench, copy: WorkingCopy, webview: Webview) {
    this.#workbench = workbench;
    this.copy = copy;
    this.webview = webview;
    this.path = copy.custom.model.identity.path;
  }

  /** The main-file model; asking for it on a board's tab is a mistake in the test, so it throws. */
  get model(): MainDocument { return asMainDocument(this.copy.custom.model); }

  get #act(): Act { return this.#workbench.host.act; }

  title(): string { return this.webview.view.title(); }
  status(): string { return this.webview.view.status(); }
  alerts(): readonly string[] { return this.webview.view.alerts(); }
  text(): string { return this.webview.view.text(); }
  conflictShown(): boolean { return this.webview.view.conflictShown(); }
  hasButton(label: string): boolean { return this.webview.view.hasButton(label); }
  hostDirty(): boolean { return this.copy.dirty; }

  async type(title: string): Promise<void> {
    this.#workbench.active = this;
    await this.webview.view.type(title);
    await settle(this.#act);
  }

  async save(): Promise<void> {
    this.#workbench.active = this;
    await this.webview.view.click("Save");
    await untilSaved(this.webview.view, this.model, this.#act);
  }

  async undo(): Promise<void> {
    this.#workbench.active = this;
    await this.#act(() => this.copy.undo());
    await settle(this.#act);
  }

  async redo(): Promise<void> {
    this.#workbench.active = this;
    await this.#act(() => this.copy.redo());
    await settle(this.#act);
  }

  async close(answer: CloseAnswer): Promise<boolean> {
    if (this.copy.tabs.size === 1 && this.copy.dirty) {
      if (answer === "cancel") return false;
      if (answer === "save") {
        this.#workbench.active = this;
        try {
          await this.copy.save();
        } catch {
          await settle(this.#act);
          return false;
        }
        // VS Code vetoes the close if the document is still dirty after the save.
        if (this.copy.dirty) {
          await settle(this.#act);
          return false;
        }
      }
    }
    this.#workbench.closeTab(this);
    await settle(this.#act);
    return true;
  }

  async revert(answer: "revert" | "cancel"): Promise<boolean> {
    if (answer === "cancel") return false;
    this.#workbench.active = this;
    try {
      await this.copy.revert();
    } catch {
      return false;
    }
    await settle(this.#act);
    return true;
  }

  async saveAs(path: string): Promise<ConformanceEditor | null> {
    const destination = { path: posix.normalize(`${ROOT.path}/${path}`) };
    try {
      await this.#workbench.provider.saveCustomDocumentAs(this.copy.custom, destination);
    } catch {
      await settle(this.#act);
      return null;
    }
    this.copy.markSavedAs();
    const copy = await this.#workbench.open(posix.relative(ROOT.path, destination.path));
    this.#workbench.closeTab(this);
    await settle(this.#act);
    return copy;
  }

  async choose(button: "Save my version" | "Use the version on disk" | "Cancel"): Promise<void> {
    const view = this.webview.view;
    if (button === "Use the version on disk" && !this.#workbench.host.capabilities.has("conflictReload")) {
      // Model an untrusted/old webview sending the hidden reload request through the bridge.
      await this.webview.forgedReload();
      await settle(this.#act);
      return;
    }
    const action = button === "Save my version" && !this.#workbench.host.capabilities.has("conflictAutoSave")
      ? "Keep my version"
      : button;
    if (action !== "Cancel" && !view.hasButton(action) && view.hasButton("Review conflict")) {
      await view.click("Review conflict");
      await settle(this.#act);
    }
    this.#workbench.active = this;
    await view.click(action);
    await untilSaved(this.webview.view, this.model, this.#act);
  }


  async hide(): Promise<void> {
    this.webview.hide();
    await settle(this.#act);
  }

  async show(): Promise<void> {
    this.webview.show();
    this.#workbench.active = this;
    await settle(this.#act);
  }
}

/**
 * VS Code's own questions and pick lists, answered here as a user would. With no answer queued a question is refused
 * loudly, as before: the provider must not ask by itself, because in VS Code the workbench asks (story 11.3).
 */
class ScriptedWorkbench {
  readonly answers: string[] = [];
  readonly files: (OutsideFile | null)[] = [];
  readonly picks: (string | undefined)[] = [];
  readonly asked: string[] = [];
  readonly pickLists: { readonly placeholder: string; readonly labels: readonly string[] }[] = [];
  /** The project-relative paths the provider asked the workbench to open, in order. */
  readonly opened: string[] = [];
}

class VscodeHost implements ConformanceHost {
  readonly name: string;
  readonly script = new ScriptedWorkbench();
  readonly capabilities: ReadonlySet<Capability>;
  /** The provider's bound, as ADR 0022 D14.6 states it (written here, not imported, so the test checks the provider). */
  readonly saveWrites = 3;
  readonly drive = new Disk();
  readonly backups = new Map<string, Uint8Array>();
  readonly #backupIdsByDocument = new Map<string, string>();
  revertCommands = 0;
  readonly act: Act;
  #workbench: Workbench;

  constructor(desktop: boolean, fixture: Uint8Array, act: Act, files: Readonly<Record<string, Uint8Array>> = {}) {
    this.name = desktop ? "VS Code desktop" : "VS Code for the Web";
    const capabilities = vscodeCapabilities(desktop);
    this.capabilities = new Set(capabilities);
    this.act = act;
    this.drive.files.set(`${ROOT.path}/${GAME}`, fixture.slice());
    this.drive.files.set(`${ROOT.path}/${SECOND}`, retitled(fixture, "Second game"));
    for (const [path, bytes] of Object.entries(files)) this.drive.files.set(`${ROOT.path}/${path}`, bytes.slice());
    this.#workbench = new Workbench(this, capabilities);
  }

  open(path: string): Promise<ConformanceEditor> {
    return this.#workbench.open(path);
  }

  /** What Explorer's open and the Game view's open do: `vscode.open`. */
  openLikeVscode(path: string): Promise<VscodeEditor> {
    return this.#workbench.focusOrOpen(path);
  }

  async saveAll(): Promise<ReadonlyMap<string, boolean>> {
    const results = new Map<string, boolean>();
    for (const copy of this.#workbench.copies.values()) {
      if (!copy.dirty) continue;
      try {
        await copy.save();
        results.set(copy.custom.model.identity.path, true);
      } catch {
        results.set(copy.custom.model.identity.path, false);
      }
    }
    await settle(this.act);
    return results;
  }

  async disk(path: string): Promise<Uint8Array | null> {
    return this.drive.files.get(posix.normalize(`${ROOT.path}/${path}`))?.slice() ?? null;
  }

  async writeOutside(path: string, bytes: Uint8Array | null): Promise<void> {
    const absolute = `${ROOT.path}/${path}`;
    const existed = this.drive.files.has(absolute);
    if (bytes === null) this.drive.files.delete(absolute);
    else this.drive.files.set(absolute, bytes.slice());
    this.drive.notify(absolute, bytes === null ? "deleted" : existed ? "changed" : "created");
  }

  refuseWrites(refuse: boolean): void {
    this.drive.refuse = refuse;
  }

  holdNextWrite(): HeldWrite {
    let start!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => { start = resolve; });
    const hold: WriteHold = { wait: new Promise<void>((resolve) => { finish = resolve; }), start };
    this.drive.hold = hold;
    return {
      started,
      release: () => {
        if (this.drive.hold === hold) this.drive.hold = null;
        finish();
      },
    };
  }
  deferNextRead(path: string): DeferredRead {
    return this.drive.deferNextRead(posix.normalize(`${ROOT.path}/${path}`));
  }

  workbenchRevertCommandCount(): number {
    return this.revertCommands;
  }
  recoveryBackupBytes(path: string): Uint8Array | null {
    const backupId = this.#backupIdsByDocument.get(posix.normalize(`${ROOT.path}/${path}`));
    return backupId === undefined ? null : this.backups.get(backupId)?.slice() ?? null;
  }


  settle(): Promise<void> {
    return settle(this.act);
  }

  /** Hot exit: back up every dirty document, end this VS Code, start a new one and reopen `path` from its backup. */
  async restartFromBackup(path: string): Promise<ConformanceEditor | null> {
    const backups = new Map<string, string>();
    let next = 0;
    for (const copy of this.#workbench.copies.values()) {
      if (!copy.dirty) continue;
      next += 1;
      const backup = await this.#workbench.provider.backupCustomDocument(copy.custom, { path: `/backups/${next}` });
      backups.set(copy.uri.path, backup.id);
      this.#backupIdsByDocument.set(copy.uri.path, backup.id);
    }
    for (const copy of this.#workbench.copies.values()) for (const tab of copy.tabs) tab.webview.hide();
    this.drive.watchers.clear();
    this.#workbench = new Workbench(this, [...this.capabilities]);
    return this.#workbench.open(path, backups.get(posix.normalize(`${ROOT.path}/${path}`)));
  }
  /** Capture a real provider backup, close the workbench, change disk with no watcher running, then recover it. */
  async restartFromBackupAfterDiskChange(path: string, bytes: Uint8Array): Promise<ConformanceEditor | null> {
    const editor = await this.open(path);
    await editor.type("Local backup");
    const key = posix.normalize(`${ROOT.path}/${path}`);
    const copy = this.#workbench.copies.get(key);
    if (copy === undefined || !copy.dirty) throw new Error(`no dirty workbench document for ${path}`);
    const backup = await this.#workbench.provider.backupCustomDocument(copy.custom, { path: "/backups/recovery-conflict" });
    this.#backupIdsByDocument.set(key, backup.id);
    for (const tab of copy.tabs) tab.webview.hide();
    this.drive.watchers.clear();

    // This write happens after the old workbench and its watchers have been stopped, before recovery opens.
    this.drive.files.set(key, bytes.slice());
    this.#workbench = new Workbench(this, [...this.capabilities]);
    return this.#workbench.open(path, backup.id);
  }


  modelsOpen(): number {
    return this.#workbench.copies.size;
  }

  /** The project-relative paths of the documents open now, in the order they were opened. */
  openPaths(): readonly string[] {
    return [...this.#workbench.copies.values()].map((copy) => copy.custom.model.identity.path);
  }
}

/** The VS Code host, as the desktop build (with live change detection) or the browser build (without it). */
export function createVscodeConformanceHost(desktop: boolean, fixture: Uint8Array, act: Act): ConformanceHost {
  return new VscodeHost(desktop, fixture, act);
}

/** One open board tab as a person sees it: the mounted view, VS Code's dirty marker, and the picture the bridge gives. */
export interface BoardProofTab {
  readonly element: HTMLElement;
  /** VS Code's working-copy dirty marker (the workbench's, not the model's). */
  workbenchDirty(): boolean;
  /** The picture the view asked the extension host for. */
  picture(): Promise<BoardPicture>;
  close(): Promise<void>;
}

export interface BoardProofHost {
  readonly name: string;
  open(path: string): Promise<BoardProofTab>;
  disk(path: string): Promise<Uint8Array | null>;
  settle(): Promise<void>;
}

/** The VS Code host holding `files` (project-relative paths) besides a `.gam`, for the board proof of story 12.1. */
export function createVscodeBoardProofHost(desktop: boolean, gam: Uint8Array, files: Readonly<Record<string, Uint8Array>>, act: Act): BoardProofHost {
  const host = new VscodeHost(desktop, gam, act, files);
  return {
    name: host.name,
    async open(path) {
      const editor = (await host.open(path)) as VscodeEditor;
      return {
        get element() { return editor.webview.view.element; },
        workbenchDirty: () => editor.copy.dirty,
        picture: () => editor.webview.picture(),
        close: async () => { await editor.close("discard"); },
      };
    },
    disk: (path) => host.disk(path),
    settle: () => host.settle(),
  };
}

/** One open editor tab, as a navigation proof sees it: the webview's own bridge, and the document's place in the workbench. */
export interface NavigationTab {
  readonly path: string;
  /** The webview's side of the bridge: what a view calls to follow a link or choose an asset. */
  remote(): { visit(path: string): Promise<import("@tk-reawakened/host-vscode/testing").VisitOutcome>; returnFromVisit(): Promise<import("@tk-reawakened/host-vscode/testing").ReturnOutcome>; pickAsset(request: import("@tk-reawakened/host-vscode/testing").AssetPickRequest): Promise<import("@tk-reawakened/editor-model").PickOutcome> };
  close(): Promise<void>;
}

export interface NavigationHost {
  readonly name: string;
  readonly script: ScriptedWorkbench;
  readonly capabilities: ReadonlySet<Capability>;
  /** Open `path` the way Explorer does: the workbench asks the provider for the file's custom document. */
  open(path: string): Promise<NavigationTab>;
  /** The files, case-sensitively, as `listGame` and the provider read them. */
  fileSystem(): ReturnType<typeof createVscodeFileSystemWithPort>;
  disk(path: string): Promise<Uint8Array | null>;
  /** How many documents (models) the workbench has open. */
  modelsOpen(): number;
  openPaths(): readonly string[];
  settle(): Promise<void>;
}

/** The VS Code host holding `files` besides a `.gam`, for the navigation proof of story 11.4. */
export function createVscodeNavigationHost(desktop: boolean, gam: Uint8Array, files: Readonly<Record<string, Uint8Array>>, act: Act): NavigationHost {
  const host = new VscodeHost(desktop, gam, act, files);
  const tabOf = (editor: VscodeEditor): NavigationTab => ({
    path: editor.path,
    remote: () => {
      const remote = editor.webview.remoteDocument();
      return remote;
    },
    close: async () => { await editor.close("discard"); },
  });
  return {
    name: host.name,
    script: host.script,
    capabilities: host.capabilities,
    async open(path) {
      return tabOf(await host.openLikeVscode(path));
    },
    fileSystem: () => createVscodeFileSystemWithPort(ROOT, fileSystemPort(host.drive), FOLDER.key),
    disk: (path) => host.disk(path),
    modelsOpen: () => host.modelsOpen(),
    openPaths: () => host.openPaths(),
    settle: () => host.settle(),
  };
}
