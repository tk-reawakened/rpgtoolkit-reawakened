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
  type SaveResult,
  type TileBitmapCommand,
  type TileBitmapDocumentSnapshot,
  type TileBitmapPicture,
  type PendingEdits,
} from "@tk-reawakened/editor-model";
import type { PlatformServices } from "@tk-reawakened/platform-services";
import { createElement, Fragment, render } from "preact";
import { AssetPickerView, type AssetPickerViewProps } from "./asset-picker-view.tsx";
import { Shell, type ShellProps } from "./shell.tsx";
import { BoardView } from "./board-view.tsx";
import { NewBoardView, type NewBoardViewProps } from "./new-board-view.tsx";
import { PreferencesView, type PreferencesViewProps } from "./preferences-view.tsx";
import { SettingsView } from "./settings-view.tsx";
import { TileBitmapView } from "./tile-bitmap-view.tsx";
import { SpriteView, type SpriteViewDocument } from "./sprite-view.tsx";
import { CharacterAuthoringView, type CharacterAuthoringViewProps } from "./character-authoring-view.tsx";
import type { TilesetBrowserContext } from "./tileset-browser.tsx";

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

/** What a tile bitmap view needs beyond the shared surface: a picture of the cells as the engine composes them, from the project's tiles. */
export interface TileBitmapViewDocument extends ViewDocument<TileBitmapDocumentSnapshot, TileBitmapCommand> {
  /** Compose the bitmap as it is now, saved or not. The promise never rejects: failure is a value with a reason. */
  preview(): Promise<TileBitmapPicture>;
}

/** What a host gives a view when it mounts it (ADR 0025 decision 4). */
export interface ViewContext {
  /** The document the view shows and edits. The view never owns it. */
  readonly document: ViewDocument | BoardViewDocument | TileBitmapViewDocument | SpriteViewDocument;
  /**
   * The host door: the view reports edits through `document.edited` (AD-19, AD-20) and reads `capabilities` to say
   * what the host cannot do instead of implying it can (ADR 0022 D3.5, D3.6).
   */
  readonly services: Pick<PlatformServices, "document" | "capabilities"> & { readonly fs?: Pick<PlatformServices["fs"], "readProject"> };
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
}
/** The handle a host keeps to a mounted view. */
export interface ViewHandle {
  /** Remove the view from the page and everything it subscribed to. Calling it again does nothing. */
  dispose(): void;
}

function isBoardView(document: ViewContext["document"]): document is BoardViewDocument {
  return document.kind === "board";
}

function isTileBitmapView(document: ViewContext["document"]): document is TileBitmapViewDocument {
  return document.kind === "tile-bitmap";
}

function isSpriteView(document: ViewContext["document"]): document is SpriteViewDocument {
  return document.kind === "character" || document.kind === "item";
}

/** Render the view of the document's kind into `el` (ADR 0026 decision 2: views are registered here, models in `editor-model`). */
export function mount(el: HTMLElement, ctx: ViewContext): ViewHandle {
  const onEdited = (event: Parameters<PlatformServices["document"]["edited"]>[0]): void => ctx.services.document.edited(event);
  const capabilities = ctx.services.capabilities;
  const document = ctx.document;
  const fs = ctx.services.fs;
  if (isSpriteView(document) && fs === undefined) throw new Error("A sprite view requires project-file read access.");
  const browser = ctx.browser === undefined ? {} : { browser: ctx.browser };
  const pendingEdits = ctx.pendingEdits ?? createPendingEdits();
  render(
    isBoardView(document)
      ? createElement(BoardView, {
        doc: document,
        capabilities,
        onEdited,
        ...browser,
        ...(ctx.boardPreferences === undefined ? {} : { preferences: ctx.boardPreferences }),
      })
      : isTileBitmapView(document)
        ? createElement(TileBitmapView, { doc: document, capabilities, onEdited, ...browser })
        : isSpriteView(document)
          ? createElement(Fragment, null,
            createElement(SpriteView, { doc: document, fs: fs!, capabilities, onEdited, pendingEdits }),
            document.kind === "character" ? createElement(CharacterAuthoringView, { doc: document, fs: fs!, capabilities, onEdited, pendingEdits, ...ctx.navigation }) : null)
          : createElement(SettingsView, { doc: document, capabilities, onEdited }),
    el,
  );
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

/** Render the editor preferences into `el`. */
export function mountPreferences(el: HTMLElement, props: PreferencesViewProps): ViewHandle {
  return mountElement(el, createElement(PreferencesView, props));
}

/** Render the new-board questions into `el`. */
export function mountNewBoard(el: HTMLElement, props: NewBoardViewProps): ViewHandle {
  return mountElement(el, createElement(NewBoardView, props));
}
