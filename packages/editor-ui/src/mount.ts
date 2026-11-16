import { CheckpointView } from "./checkpoint-view.tsx";
import type { AnimationAuthoring } from "@tk-reawakened/editor-model";
import {
  createPendingEdits,
  type ApplyResult,
  type BoardCommand,
  type BoardDocumentSnapshot,
  type BoardPicture,
  type BoardPreviewRequest,
  type ConflictChoice,
  type ConflictResult,
  type EditorPreferences,
  type HistoryResult,
  type MainCommand,
  type MainDocument,
  type MainDocumentSnapshot,
  type ProgramCommand,
  type ProgramDocumentSnapshot,
  type SaveResult,
  type TileBitmapCommand,
  type TileBitmapDocumentSnapshot,
  type TileBitmapPicture,
  type PendingEdits,
  type TilesetArtCommand,
  type TilesetArtSnapshot,
} from "@tk-reawakened/editor-model";
import type { PlatformResult, PlatformServices } from "@tk-reawakened/platform-services";
import { createElement, Fragment, render } from "preact";
import { AssetPickerView, type AssetPickerViewProps } from "./asset-picker-view.tsx";
import { EmptyExplorerView, type EmptyExplorerViewProps } from "./empty-explorer-view.tsx";
import { Shell, type ShellProps } from "./shell.tsx";
import { RunView, type RunViewProps } from "./run-view.tsx";
import { BoardView } from "./board-view.tsx";
import { NewBoardView, type NewBoardViewProps } from "./new-board-view.tsx";
import { NewProjectView, type NewProjectViewProps } from "./new-project-view.tsx";
import { PreferencesView, type PreferencesViewProps } from "./preferences-view.tsx";
import { SettingsView } from "./settings-view.tsx";
import { TileBitmapView } from "./tile-bitmap-view.tsx";
import { SpriteView, type SpriteViewDocument } from "./sprite-view.tsx";
import { CharacterAuthoringView, type CharacterAuthoringViewProps } from "./character-authoring-view.tsx";
import type { TilesetBrowserContext } from "./tileset-browser.tsx";
import { TilesetArtView } from "./tileset-art-view.tsx";
import { AnimationView, type AnimationViewDocument } from "./animation-view.tsx";
import { ProgramView, type ProgramPreferencesSource, type ProgramViewDocument } from "./program-view.tsx";
import type { TextSurfaceFactory } from "./text-surface.ts";

/** The snapshot/save surface plus a command action; an adapter may acknowledge a command asynchronously. */
export interface ViewDocument<Snapshot = MainDocumentSnapshot, Command = MainCommand> {
  /** The registered kind of the document (ADR 0026 decision 1); `mount` picks the view by it. */
  readonly kind: string;
  readonly identity: MainDocument["identity"];
  getSnapshot(): Snapshot;
  subscribe(listener: () => void): () => void;
  apply(command: Command): ApplyResult | Promise<ApplyResult>;
  save(): Promise<SaveResult>;
  /** Settle a change made on disk by another program (ADR 0022 D3.5). */
  resolveConflict(choice: ConflictChoice): ConflictResult | Promise<ConflictResult>;
}

/** What a board view needs beyond the shared surface: a picture of the board as the engine draws it (AD-29). */
export interface BoardViewDocument extends ViewDocument<BoardDocumentSnapshot, BoardCommand> {
  /**
   * Compose the board as it is now, saved or not, with only the layers and background `request` asks for (every layer
   * and the background when it asks for nothing). The promise never rejects: failure is a value with a reason.
   */
  preview(request?: BoardPreviewRequest): Promise<BoardPicture>;
  /**
   * Undo and redo the latest edit. A host whose workbench owns the undo stack (VS Code's custom editors) leaves these out:
   * the view then shows no Undo or Redo button and says to use the host's own Undo.
   */
  undo?(): HistoryResult | Promise<HistoryResult>;
  redo?(): HistoryResult | Promise<HistoryResult>;
}

/** The board-editor preferences in force (T-33), read by the board view and told when they change. */
export interface BoardPreferencesSource {
  get(): EditorPreferences;
  subscribe(listener: () => void): () => void;
}

/** What the program editor needs from its host beyond the shared surface (story 11.7). */
export interface CodeEditorContext {
  /** The code editor (Monaco in the browser host). A plain text area when absent. */
  readonly createSurface?: TextSurfaceFactory;
  /** The running project's main file for the language server; `null` leaves documents unassessed. */
  readonly project?: { readonly main: string } | null;
  readonly preferences?: ProgramPreferencesSource;
}

/** The legacy tileset's pixel-editing surface, with history owned by its document. */
export type TilesetArtViewDocument = ViewDocument<TilesetArtSnapshot, TilesetArtCommand>;

/** What a tile bitmap view needs beyond the shared surface: a picture of the cells as the engine composes them, from the project's tiles. */
export interface TileBitmapViewDocument extends ViewDocument<TileBitmapDocumentSnapshot, TileBitmapCommand> {
  /** Compose the bitmap as it is now, saved or not. The promise never rejects: failure is a value with a reason. */
  preview(): Promise<TileBitmapPicture>;
}

/** What a host gives a view when it mounts it (ADR 0025 decision 4). */
export interface ViewContext {
  /** The document the view shows and edits. The view never owns it. */
  readonly document: ViewDocument | BoardViewDocument | TileBitmapViewDocument | SpriteViewDocument | TilesetArtViewDocument | AnimationViewDocument | ProgramViewDocument;
  /**
   * The host door: the view reports edits through `document.edited` (AD-19, AD-20) and reads `capabilities` to say
   * what the host cannot do instead of implying it can (ADR 0022 D3.5, D3.6).
   */
  readonly services: Pick<PlatformServices, "document" | "capabilities"> & { readonly fs?: Pick<PlatformServices["fs"], "readProject">; readonly language?: PlatformServices["language"] };
  /** Persistent wizard and recovery operations owned by the authoritative document host. */
  readonly animationAuthoring?: AnimationAuthoring;
  /** One project-bound browser service is shared across this workspace's views, never a module-global selection. */
  readonly browser?: TilesetBrowserContext;
  /** Workbench asset picking is available in full hosts, but not in standalone document mounts. */
  readonly navigation?: Pick<CharacterAuthoringViewProps, "pickAsset">;
  /**
   * Where views report edits they have accepted but not yet handed to the document, so the host's save, close and revert
   * wait for them (#2613). A mount with no host makes its own, which only the views sharing it wait for.
   */
  readonly pendingEdits?: PendingEdits;
  /** The board-editor preferences (flood behaviour); the defaults of the catalogue when the host gives none. */
  readonly boardPreferences?: BoardPreferencesSource;
  /** The program editor's code editor, running project and preferences. */
  readonly codeEditor?: CodeEditorContext;
}
/** The handle a host keeps to a mounted view. */
export interface ViewHandle {
  /** Remove the view from the page and everything it subscribed to. Calling it again does nothing. */
  dispose(): void;
}

function isBoardView(document: ViewContext["document"]): document is BoardViewDocument {
  return document.kind === "board";
}

function isTilesetArtView(document: ViewContext["document"]): document is TilesetArtViewDocument {
  return document.kind === "tileset";
}

function isTileBitmapView(document: ViewContext["document"]): document is TileBitmapViewDocument {
  return document.kind === "tile-bitmap";
}

function isProgramView(document: ViewContext["document"]): document is ProgramViewDocument {
  return document.kind === "program";
}

function isSpriteView(document: ViewContext["document"]): document is SpriteViewDocument {
  return document.kind === "character" || document.kind === "item";
}

function isAnimationView(document: ViewContext["document"]): document is AnimationViewDocument {
  return document.kind === "animation";
}

/** Render the view of the document's kind into `el` (ADR 0026 decision 2: views are registered here, models in `editor-model`). */
export function mount(el: HTMLElement, ctx: ViewContext): ViewHandle {
  const onEdited = (event: Parameters<PlatformServices["document"]["edited"]>[0]): void => ctx.services.document.edited(event);
  const capabilities = ctx.services.capabilities;
  const document = ctx.document;
  const fs = ctx.services.fs;
  if ((isSpriteView(document) || isAnimationView(document)) && fs === undefined) throw new Error("A sprite view requires project-file read access.");
  const pendingEdits = ctx.pendingEdits ?? createPendingEdits();
  let view: Parameters<typeof render>[0];
  if (isBoardView(document)) {
    view = createElement(BoardView, {
      doc: document,
      capabilities,
      onEdited,
      ...(ctx.browser === undefined ? {} : { browser: ctx.browser }),
      ...(ctx.boardPreferences === undefined ? {} : { preferences: ctx.boardPreferences }),
    });
  } else if (isTilesetArtView(document)) {
    view = createElement(TilesetArtView, { doc: document, capabilities, onEdited });
  } else if (isTileBitmapView(document)) {
    view = createElement(TileBitmapView, {
      doc: document,
      capabilities,
      onEdited,
      ...(ctx.browser === undefined ? {} : { browser: ctx.browser }),
    });
  } else if (isSpriteView(document)) {
    view = createElement(Fragment, null,
      createElement(SpriteView, { doc: document, fs: fs!, capabilities, onEdited, pendingEdits }),
      document.kind === "character"
        ? createElement(CharacterAuthoringView, { doc: document, fs: fs!, capabilities, onEdited, pendingEdits, ...ctx.navigation })
        : null);
  } else if (isProgramView(document)) {
    const editor = ctx.codeEditor;
    view = createElement(ProgramView, {
      doc: document,
      capabilities,
      onEdited,
      pendingEdits,
      ...(editor?.createSurface === undefined ? {} : { createSurface: editor.createSurface }),
      ...(ctx.services.language === undefined ? {} : { language: ctx.services.language }),
      ...(editor?.project === undefined ? {} : { project: editor.project }),
      ...(editor?.preferences === undefined ? {} : { preferences: editor.preferences }),
    });
  } else if (isAnimationView(document)) {
    view = createElement(AnimationView, {
      doc: document,
      pendingEdits,
      fs: fs!,
      onEdited,
      ...(ctx.animationAuthoring === undefined ? {} : { authoring: ctx.animationAuthoring }),
      ...(ctx.browser === undefined ? {} : { browser: ctx.browser }),
    });
  } else if (document.kind === "main") {
    view = createElement(SettingsView, { doc: document, capabilities, onEdited });
  } else {
    throw new Error(`No editor view is registered for document kind "${document.kind}".`);
  }
  render(view, el);
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      render(null, el);
    },
  };
}

function mountElement(el: HTMLElement, vnode: Parameters<typeof render>[0]): ViewHandle {
  render(vnode, el);
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      render(null, el);
    },
  };
}

/** Render the browser and desktop shell (workbench, panels, tabs) into `el`. */
export function mountShell(el: HTMLElement, props: ShellProps): ViewHandle {
  return mountElement(el, createElement(Shell, props));
}

/** Render a folder-aware asset picker into `el`. */
export function mountAssetPicker(el: HTMLElement, props: AssetPickerViewProps): ViewHandle {
  return mountElement(el, createElement(AssetPickerView, props));
}

/** Render the Run panel (T-07, T-41) into `el`, for a host page that shows it without the shell. */
export function mountRun(el: HTMLElement, props: RunViewProps): ViewHandle {
  return mountElement(el, createElement(RunView, props));
}

/** Render the editor preferences into `el`. */
export function mountPreferences(el: HTMLElement, props: PreferencesViewProps): ViewHandle {
  return mountElement(el, createElement(PreferencesView, props));
}

/** Render the new-board questions into `el`. */
export function mountNewBoard(el: HTMLElement, props: NewBoardViewProps): ViewHandle {
  return mountElement(el, createElement(NewBoardView, props));
}

/** Render the new-project wizard into `el` (T-04). */
export function mountNewProject(el: HTMLElement, props: NewProjectViewProps): ViewHandle {
  return mountElement(el, createElement(NewProjectView, props));
}

/** Render the IDE "No Game Opened" Explorer panel into `el`. */
export function mountEmptyExplorer(el: HTMLElement, props: EmptyExplorerViewProps): ViewHandle {
  return mountElement(el, createElement(EmptyExplorerView, props));
}

/** Shared persistent project recovery, also available with every affected editor closed. */
export function mountCheckpoints(element: HTMLElement, groups: import("@tk-reawakened/editor-model").CheckpointGroups): ViewHandle {
  render(createElement(CheckpointView, { groups }), element);
  return { dispose: () => render(null, element) };
}
