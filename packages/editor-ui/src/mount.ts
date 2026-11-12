import type { ApplyResult, MainCommand, MainDocument, MainDocumentSnapshot, SaveResult } from "@tk-reawakened/editor-model";
import type { PlatformServices } from "@tk-reawakened/platform-services";
import { createElement, render } from "preact";
import { SettingsView } from "./settings-view.tsx";

/** The snapshot/save surface plus a command action; an adapter may acknowledge a command asynchronously. */
export interface ViewDocument {
  readonly identity: MainDocument["identity"];
  getSnapshot(): MainDocumentSnapshot;
  subscribe(listener: () => void): () => void;
  apply(command: MainCommand): ApplyResult | Promise<ApplyResult>;
  save(): Promise<SaveResult>;
}

/** What a host gives a view when it mounts it (ADR 0025 decision 4). */
export interface ViewContext {
  /** The document the view shows and edits. The view never owns it. */
  readonly document: ViewDocument;
  /** The host door; the view uses only `document.edited` (AD-19, AD-20). */
  readonly services: Pick<PlatformServices, "document">;
}

/** The handle a host keeps to a mounted view. */
export interface ViewHandle {
  /** Remove the view from the page and everything it subscribed to. Calling it again does nothing. */
  dispose(): void;
}

/** Render the settings view into `el`. */
export function mount(el: HTMLElement, ctx: ViewContext): ViewHandle {
  render(createElement(SettingsView, { doc: ctx.document, onEdited: (event) => ctx.services.document.edited(event) }), el);
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      render(null, el);
    },
  };
}
