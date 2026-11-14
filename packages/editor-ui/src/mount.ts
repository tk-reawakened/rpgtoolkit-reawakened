import type {
  ApplyResult,
  BoardCommand,
  BoardDocumentSnapshot,
  BoardPicture,
  ConflictChoice,
  ConflictResult,
  MainCommand,
  MainDocument,
  MainDocumentSnapshot,
  SaveResult,
  SpriteDocument,
} from "@tk-reawakened/editor-model";
import type { PlatformServices } from "@tk-reawakened/platform-services";
import { createElement, render } from "preact";
import { AssetPickerView, type AssetPickerViewProps } from "./asset-picker-view.tsx";
import { Shell, type ShellProps } from "./shell.tsx";
import { BoardView } from "./board-view.tsx";
import { PreferencesView, type PreferencesViewProps } from "./preferences-view.tsx";
import { SettingsView } from "./settings-view.tsx";
import { SpriteView } from "./sprite-view.tsx";

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
  /** Compose the board as it is now, saved or not. The promise never rejects: failure is a value with a reason. */
  preview(): Promise<BoardPicture>;
}

/** What a host gives a view when it mounts it (ADR 0025 decision 4). */
export interface ViewContext {
  /** The document the view shows and edits. The view never owns it. */
  readonly document: ViewDocument | BoardViewDocument | SpriteDocument;
  readonly services: Pick<PlatformServices, "document" | "capabilities" | "fs">;
}
/** The handle a host keeps to a mounted view. */
export interface ViewHandle {
  /** Remove the view from the page and everything it subscribed to. Calling it again does nothing. */
  dispose(): void;
}

function isBoardView(document: ViewContext["document"]): document is BoardViewDocument {
  return document.kind === "board";
}

function isSpriteView(document: ViewContext["document"]): document is SpriteDocument {
  return document.kind === "character" || document.kind === "item";
}

/** Render the view of the document's kind into `el` (ADR 0026 decision 2: views are registered here, models in `editor-model`). */
export function mount(el: HTMLElement, ctx: ViewContext): ViewHandle {
  const onEdited = (event: Parameters<PlatformServices["document"]["edited"]>[0]): void => ctx.services.document.edited(event);
  const capabilities = ctx.services.capabilities;
  const document = ctx.document;
  render(
    isBoardView(document)
      ? createElement(BoardView, { doc: document, capabilities, onEdited })
      : isSpriteView(document)
        ? createElement(SpriteView, { doc: document, fs: ctx.services.fs, onEdited })
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
