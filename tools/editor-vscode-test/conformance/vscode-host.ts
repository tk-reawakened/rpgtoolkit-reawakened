// The VS Code host under the conformance suite: the real custom editor provider (`host-vscode`'s `custom-editor.ts`),
// its `workspace.fs` adapter, its webview bridge and the shared view, with VS Code's own parts played here. Those parts
// follow VS Code's custom-editor contract (https://code.visualstudio.com/api/extension-guides/custom-editors):
//
// * the workbench keeps the undo stack of fired edit events, a save point and the dirty marker; Undo and Redo call an
//   edit's own `undo`/`redo`; Save calls `saveCustomDocument` and moves the save point to the edit current when it
//   started; Revert calls `revertCustomDocument` and drops the edits after the save point; closing a dirty tab asks
//   Save / Don't Save / Cancel; Save As calls `saveCustomDocumentAs`, then opens the destination in place of the source;
// * a webview is a separate page that talks to the extension host only through asynchronous, structured-cloned
//   messages, and with `retainContextWhenHidden: false` a hidden tab's page is destroyed and loaded again when shown;
// * the desktop watcher reports every change below the folder, including the extension's own writes.
//
// The real-workbench proof (`web-proof.ts`, run in CI against `@vscode/test-web`) checks the same behaviours in VS Code
// itself; this driver lets every conformance case run in under a second.
import { posix } from "node:path";
import type { MainDocument } from "@tk-reawakened/editor-model";
import { mount, type ViewHandle } from "@tk-reawakened/editor-ui";
import type { Capability, DialogService, FileChange } from "@tk-reawakened/platform-services";
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
import { GAME, SECOND, retitled, type CloseAnswer, type ConformanceEditor, type ConformanceHost } from "./suite.ts";
import { MountedView, settle, type Act } from "./view.ts";

interface Uri { readonly path: string }

const ROOT: Uri = { path: "/project" };
const FOLDER = { uri: ROOT, key: "file:///project" };

/** The files on disk, by absolute path, case-sensitive, with the desktop watcher's listeners. */
class Disk {
  readonly files = new Map<string, Uint8Array>();
  readonly watchers = new Set<{ readonly root: string; readonly onChange: (change: FileChange) => void }>();
  refuse = false;
  hold: Promise<void> | null = null;

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
      const bytes = disk.files.get(uri.path);
      if (bytes === undefined) throw missing(uri);
      return bytes.slice();
    },
    async createDirectory() {},
    async writeFile(uri, bytes) {
      if (disk.refuse) throw Object.assign(new Error("the workspace refuses writes"), { code: "NoPermissions" });
      if (disk.hold !== null) await disk.hold;
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

  /** Save; rejects when the provider's save throws, as the workbench's save command does. */
  async save(): Promise<void> {
    const saving = this.#index;
    await this.#provider.saveCustomDocument(this.custom);
    this.#savePoint = saving;
    this.fromBackup = false;
  }

  async revert(): Promise<void> {
    if (!this.dirty) return;
    await this.#provider.revertCustomDocument(this.custom);
    this.#index = this.#savePoint;
    this.#edits.splice(this.#savePoint + 1);
    this.fromBackup = false;
  }

  /** After Save As the workbench treats the source as saved: its content now lives at the destination. */
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
      page.remote = new RemoteDocument(message.snapshot, { postMessage: (request) => this.#send(request), getState: () => undefined, setState: () => undefined });
      page.handle = mount(page.element, {
        document: page.remote,
        services: { document: { edited: () => undefined }, capabilities: new Set(message.capabilities) },
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
    const never: DialogService = {
      ask: () => Promise.reject(new Error("the provider asked a question; in VS Code the workbench asks")),
      pickSavePath: () => Promise.reject(new Error("the provider asked for a path; in VS Code the workbench asks")),
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
      executeCommand: async (command) => {
        const target = this.active?.copy;
        if (target === undefined) return;
        if (command === "workbench.action.files.save") await target.save();
        else await target.revert();
      },
    }, (event) => {
      for (const copy of this.copies.values()) if (copy.custom === event.document) copy.record(event);
    });
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
  readonly model: MainDocument;
  readonly #workbench: Workbench;
  readonly copy: WorkingCopy;
  readonly webview: Webview;

  constructor(workbench: Workbench, copy: WorkingCopy, webview: Webview) {
    this.#workbench = workbench;
    this.copy = copy;
    this.webview = webview;
    this.model = copy.custom.model;
    this.path = copy.custom.model.identity.path;
  }

  get #act(): Act { return this.#workbench.host.act; }

  title(): string { return this.webview.view.title(); }
  status(): string { return this.webview.view.status(); }
  alerts(): readonly string[] { return this.webview.view.alerts(); }
  text(): string { return this.webview.view.text(); }
  conflictShown(): boolean { return this.webview.view.conflictShown(); }
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

  async choose(button: "Save my version" | "Use the version on disk"): Promise<void> {
    this.#workbench.active = this;
    await this.webview.view.click(button);
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

class VscodeHost implements ConformanceHost {
  readonly name: string;
  readonly capabilities: ReadonlySet<Capability>;
  readonly drive = new Disk();
  readonly backups = new Map<string, Uint8Array>();
  readonly act: Act;
  #workbench: Workbench;

  constructor(desktop: boolean, fixture: Uint8Array, act: Act) {
    this.name = desktop ? "VS Code desktop" : "VS Code for the Web";
    const capabilities = vscodeCapabilities(desktop);
    this.capabilities = new Set(capabilities);
    this.act = act;
    this.drive.files.set(`${ROOT.path}/${GAME}`, fixture.slice());
    this.drive.files.set(`${ROOT.path}/${SECOND}`, retitled(fixture, "Second game"));
    this.#workbench = new Workbench(this, capabilities);
  }

  open(path: string): Promise<ConformanceEditor> {
    return this.#workbench.open(path);
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

  holdWrites(): () => void {
    let release!: () => void;
    this.drive.hold = new Promise<void>((resolve) => { release = resolve; });
    return () => {
      this.drive.hold = null;
      release();
    };
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
    }
    for (const copy of this.#workbench.copies.values()) for (const tab of copy.tabs) tab.webview.hide();
    this.drive.watchers.clear();
    this.#workbench = new Workbench(this, [...this.capabilities]);
    return this.#workbench.open(path, backups.get(posix.normalize(`${ROOT.path}/${path}`)));
  }

  modelsOpen(): number {
    return this.#workbench.copies.size;
  }
}

/** The VS Code host, as the desktop build (with live change detection) or the browser build (without it). */
export function createVscodeConformanceHost(desktop: boolean, fixture: Uint8Array, act: Act): ConformanceHost {
  return new VscodeHost(desktop, fixture, act);
}
