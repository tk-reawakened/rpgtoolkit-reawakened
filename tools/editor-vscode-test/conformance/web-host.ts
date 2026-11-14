// The browser host under the conformance suite: the real `host-web` folder project, workspace and mounted view, over a
// case-sensitive in-memory folder in place of File System Access. The browser host is its own workbench, so every user
// action is the call its page makes (`openGameSettings`, `workspace.undo`, `workspace.close`, ...), and every question it
// asks goes through its `dialogs` service, answered here as the user would.
import { asMainDocument, previewBoard, previewTileBitmap, type BoardPicture, type MainDocument } from "@tk-reawakened/editor-model";
import type { DialogQuestion, DialogService } from "@tk-reawakened/platform-services";
import { createFolderProject, mountGameSettings, openEditor, openGameSettings, type GameSettingsOpenResult, type GameSettingsView, type WebProject } from "@tk-reawakened/host-web/testing";
import { GAME, SECOND, retitled, type CloseAnswer, type ConformanceEditor, type ConformanceHost } from "./suite.ts";
import { MemoryDirectory, type WriteControl } from "./memory-directory.ts";
import { MountedView, settle, type Act } from "./view.ts";

/** Answers for the next question and the next Save As destination; a question with no answer ready is dismissed. */
class ScriptedDialogs implements DialogService {
  answer: string | null = null;
  path: string | null = null;
  readonly asked: string[] = [];

  async ask<Id extends string>(question: DialogQuestion<Id>): Promise<Id> {
    this.asked.push(question.message);
    const chosen = question.choices.find((choice) => choice.id === this.answer);
    this.answer = null;
    return chosen?.id ?? question.cancel;
  }

  async pickSavePath(): Promise<string | null> {
    const path = this.path;
    this.path = null;
    return path;
  }
}

/** Wait until the view is no longer saving: the Save button's whole chain, through to the host's answer. */
async function untilSaved(view: MountedView, model: MainDocument, act: Act): Promise<void> {
  await settle(act, 2);
  for (let round = 0; round < 10_000 && (view.status() === "Saving…" || model.getSnapshot().saving); round += 1) await settle(act, 1);
  await settle(act, 2);
}

class WebEditor implements ConformanceEditor {
  readonly path: string;
  readonly model: MainDocument;
  readonly #project: WebProject;
  readonly #dialogs: ScriptedDialogs;
  readonly #act: Act;
  #view: MountedView;
  #handle: GameSettingsView | null;

  constructor(project: WebProject, dialogs: ScriptedDialogs, act: Act, model: MainDocument, view: MountedView, handle: GameSettingsView) {
    this.path = model.identity.path;
    this.model = model;
    this.#project = project;
    this.#dialogs = dialogs;
    this.#act = act;
    this.#view = view;
    this.#handle = handle;
  }

  title(): string { return this.#view.title(); }
  status(): string { return this.#view.status(); }
  alerts(): readonly string[] { return this.#view.alerts(); }
  text(): string { return this.#view.text(); }
  conflictShown(): boolean { return this.#view.conflictShown(); }
  hasButton(label: string): boolean { return this.#view.hasButton(label); }
  hostDirty(): boolean { return this.model.getSnapshot().dirty; }

  async type(title: string): Promise<void> {
    await this.#view.type(title);
    await settle(this.#act);
  }

  async save(): Promise<void> {
    await this.#view.click("Save");
    await untilSaved(this.#view, this.model, this.#act);
  }

  async undo(): Promise<void> {
    await this.#act(() => { this.#project.workspace.undo(this.model); });
    await settle(this.#act);
  }

  async redo(): Promise<void> {
    await this.#act(() => { this.#project.workspace.redo(this.model); });
    await settle(this.#act);
  }

  async close(answer: CloseAnswer): Promise<boolean> {
    this.#dialogs.answer = answer;
    const closed = await (this.#handle?.close() ?? this.#project.workspace.close(this.model));
    this.#dialogs.answer = null;
    if (closed.closed) this.#unmount();
    await settle(this.#act);
    return closed.closed;
  }

  async revert(answer: "revert" | "cancel"): Promise<boolean> {
    this.#dialogs.answer = answer;
    const reverted = await this.#project.workspace.revert(this.model);
    this.#dialogs.answer = null;
    await settle(this.#act);
    return reverted.ok;
  }

  async saveAs(path: string): Promise<ConformanceEditor | null> {
    this.#dialogs.path = path;
    this.#dialogs.answer = "replace";
    const saved = await this.#project.workspace.saveAs(this.model);
    this.#dialogs.answer = null;
    this.#dialogs.path = null;
    if (!saved.ok) return null;
    // The shell shows the copy in place of the source, whose document the workspace has closed (D1.3).
    this.#unmount();
    const element = document.createElement("div");
    document.body.append(element);
    let handle!: GameSettingsView;
    await this.#act(() => { handle = mountGameSettings(this.#project, saved.document, element); });
    await settle(this.#act);
    return new WebEditor(this.#project, this.#dialogs, this.#act, asMainDocument(saved.document), new MountedView(element, this.#act), handle);
  }

  async choose(button: "Save my version" | "Use the version on disk" | "Cancel"): Promise<void> {
    await this.#view.click(button);
    await untilSaved(this.#view, this.model, this.#act);
  }

  async hide(): Promise<void> {
    await this.#act(() => { this.#handle?.hide(); });
    this.#view.element.remove();
    await settle(this.#act);
  }

  async show(): Promise<void> {
    const element = document.createElement("div");
    document.body.append(element);
    await this.#act(() => { this.#handle?.show(element); });
    this.#view = new MountedView(element, this.#act);
    await settle(this.#act);
  }

  #unmount(): void {
    this.#handle?.dispose();
    this.#handle = null;
    this.#view.element.remove();
  }
}

/** A browser host over a fresh project holding the fixture as `GAME` and a retitled copy as `SECOND`. */
export function createWebConformanceHost(fixture: Uint8Array, act: Act): ConformanceHost {
  const control: WriteControl = { refuse: false, hold: null, tick: 0 };
  const root = new MemoryDirectory("project", control);
  root.put(GAME, fixture);
  root.put(SECOND, retitled(fixture, "Second game"));
  const dialogs = new ScriptedDialogs();
  const project = createFolderProject(root as unknown as FileSystemDirectoryHandle, { id: "web:conformance", name: "Conformance" }, { dialogs });
  const validPath = (path: string): boolean => !path.startsWith("/") && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");

  return {
    name: "browser host",
    capabilities: project.services.capabilities,
    saveWrites: 1,
    async open(path) {
      const element = document.createElement("div");
      document.body.append(element);
      let opened!: GameSettingsOpenResult;
      await act(async () => { opened = await openGameSettings(project, path, element); });
      if (!opened.ok) {
        element.remove();
        throw new Error(opened.error.kind === "case-conflict" || opened.error.kind === "unsupported" ? opened.error.message : `${opened.error.document}: ${opened.error.error.message}`);
      }
      await settle(act);
      return new WebEditor(project, dialogs, act, asMainDocument(opened.document), new MountedView(element, act), opened.view);
    },
    async saveAll() {
      const results = await project.workspace.saveAll();
      await settle(act);
      return new Map(results.map((entry) => [entry.document, entry.result.ok]));
    },
    disk: async (path) => (validPath(path) ? root.read(path) : null),
    async writeOutside(path, bytes) {
      root.put(path, bytes);
    },
    refuseWrites(refuse) {
      control.refuse = refuse;
    },
    holdNextWrite() {
      // The test project's lib floor is ES2022, so `Promise.withResolvers` is not available.
      let start!: () => void;
      let finish!: () => void;
      const started = new Promise<void>((resolve) => { start = resolve; });
      const hold = { wait: new Promise<void>((resolve) => { finish = resolve; }), start };
      control.hold = hold;
      return {
        started,
        release: () => {
          if (control.hold === hold) control.hold = null;
          finish();
        },
      };
    },
    settle: () => settle(act),
    restartFromBackup: async () => null,
    modelsOpen: () => project.workspace.documents().length,
  };
}

/** One open board tab in the browser host. */
export interface WebBoardTab {
  readonly element: HTMLElement;
  /** The document's own dirty state: the browser host is its own workbench. */
  workbenchDirty(): boolean;
  /** The picture of the file's bytes through the host's project files, as the view's own preview composes it. */
  picture(): Promise<BoardPicture>;
  close(): Promise<void>;
}

/** The browser host holding `files` besides a `.gam`, for the board proof of story 12.1. */
export function createWebBoardProofHost(gam: Uint8Array, files: Readonly<Record<string, Uint8Array>>, act: Act): {
  readonly name: string;
  open(path: string): Promise<WebBoardTab>;
  disk(path: string): Promise<Uint8Array | null>;
  settle(): Promise<void>;
} {
  const control: WriteControl = { refuse: false, hold: null, tick: 0 };
  const root = new MemoryDirectory("project", control);
  root.put(GAME, gam);
  for (const [path, bytes] of Object.entries(files)) root.put(path, bytes);
  const project = createFolderProject(root as unknown as FileSystemDirectoryHandle, { id: "web:board-proof", name: "Board proof" }, { dialogs: new ScriptedDialogs() });
  return {
    name: "browser host",
    async open(path) {
      const element = document.createElement("div");
      document.body.append(element);
      let opened!: Awaited<ReturnType<typeof openEditor>>;
      await act(async () => { opened = await openEditor(project, path, element); });
      if (!opened.ok) {
        element.remove();
        throw new Error(opened.error.kind === "case-conflict" || opened.error.kind === "unsupported" ? opened.error.message : `${opened.error.document}: ${opened.error.error.message}`);
      }
      const { document: model, view } = opened;
      await settle(act);
      return {
        element,
        workbenchDirty: () => model.getSnapshot().dirty,
        picture: async () => {
          if (model.kind === "tile-bitmap") return previewTileBitmap(project.services.fs, project.project.id, model.serialize());
          const preview = await previewBoard(project.services.fs, project.project.id, model.serialize());
          return preview.ok ? { ok: true, width: preview.width, height: preview.height, rgba: preview.rgba, warnings: preview.warnings } : preview;
        },
        close: async () => {
          await view.close();
          view.dispose();
          element.remove();
        },
      };
    },
    disk: async (path) => root.read(path),
    settle: () => settle(act),
  };
}
