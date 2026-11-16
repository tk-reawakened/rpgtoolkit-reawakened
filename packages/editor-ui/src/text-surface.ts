import type { ProgramPreferences } from "@tk-reawakened/editor-model";

/**
 * The text surface the program view edits through (docs/spec/engine/rpgcode-tooling.md#tool-10-text). A surface shows
 * text and reports what the author did to it; it is never the owner of the text. The program document is, so every
 * change a surface reports becomes a command to the document, and a change to the document is given back to the surface
 * with `setText`.
 *
 * Offsets are UTF-16 code units of text with `LF` line breaks only, which is also what the document holds.
 */

/** One replacement. A list of them applies in order, each in the coordinates the previous one left. */
export interface TextChange {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export interface TextSelection {
  readonly from: number;
  readonly to: number;
}

/** One diagnostic the language server published, in LSP positions (0-based line and character). */
export interface SurfaceDiagnostic {
  readonly range: { readonly start: { readonly line: number; readonly character: number }; readonly end: { readonly line: number; readonly character: number } };
  /** LSP severity: 1 error, 2 warning, 3 information, 4 hint. */
  readonly severity?: number;
  readonly message: string;
  readonly code?: string | number;
}

/** What a surface needs to reach the language server for the one document it shows; no method here changes the document. */
export interface LanguageFeatures {
  /** Send an LSP request for this document; rejects when the server is gone or answers an error. */
  request<T>(method: string, params: Readonly<Record<string, unknown>>): Promise<T>;
  /** The document's identity for the server: `{ textDocument: { uri } }` goes in every request. */
  readonly uri: string;
  /** What the server said it can do (the `capabilities` of its `initialize` answer): which features to offer, and their triggers. */
  readonly capabilities: Readonly<Record<string, unknown>>;
}

/** Everything a surface is given when it is made, and the callbacks it reports to. */
export interface TextSurfaceHost {
  readonly text: string;
  readonly readOnly: boolean;
  /** A unique name for the document inside this page; not the language server's URI. */
  readonly name: string;
  readonly preferences: ProgramPreferences;
  /** The author changed the text. Never called for `setText`. */
  onChange(changes: readonly TextChange[]): void;
  /**
   * The author asked to undo or redo. The document owns history, so a host that has it answers `true` and the surface
   * undoes nothing itself; `false` leaves the surface's own undo to run, and what it changes arrives as ordinary edits.
   */
  onUndo(): boolean;
  onRedo(): boolean;
  /** The author asked to save (Ctrl+S / Cmd+S). */
  onSave(): void;
  /** The surface lost focus: a burst of typing is finished. */
  onBlur(): void;
  /** Escape was pressed with nothing for the surface to do with it. */
  onEscape(): void;
}

export interface TextSurface {
  setText(text: string): void;
  getText(): string;
  getSelection(): TextSelection;
  /** Select `from`-`to`, bring it into view and focus the surface. */
  select(from: number, to: number): void;
  /** Put the cursor at the start of the 0-based `line` and bring it into view. */
  revealLine(line: number): void;
  setReadOnly(readOnly: boolean): void;
  setPreferences(preferences: ProgramPreferences): void;
  /** Show the server's diagnostics; an empty list clears them. */
  setDiagnostics(diagnostics: readonly SurfaceDiagnostic[]): void;
  /** Connect (or, with `null`, disconnect) the language features. A plain surface has none and ignores this. */
  setLanguage(features: LanguageFeatures | null): void;
  focus(): void;
  dispose(): void;
}

/** Make a surface in `element`. A host without a code editor gives none and the view uses `createPlainTextSurface`. */
export type TextSurfaceFactory = (element: HTMLElement, host: TextSurfaceHost) => TextSurface;

/** The offsets that differ between `before` and `after`, as one change; `null` when they are equal. */
export function diffText(before: string, after: string): TextChange | null {
  if (before === after) return null;
  const shared = Math.min(before.length, after.length);
  let start = 0;
  while (start < shared && before.charCodeAt(start) === after.charCodeAt(start)) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) {
    endBefore -= 1;
    endAfter -= 1;
  }
  return { from: start, to: endBefore, text: after.slice(start, endAfter) };
}

/**
 * The surface a page without Monaco uses: a plain `<textarea>`. It has no colouring and no language features, but it edits
 * through the same contract, so a failed or absent code editor never stops an author from typing and saving.
 */
export const createPlainTextSurface: TextSurfaceFactory = (element, host) => {
  const doc = element.ownerDocument;
  const area = doc.createElement("textarea");
  area.className = "tkr-program-plain";
  area.spellcheck = false;
  area.setAttribute("aria-label", "Program text");
  area.setAttribute("wrap", "off");
  area.value = host.text;
  area.readOnly = host.readOnly;
  element.append(area);
  let shown = host.text;
  const onInput = (): void => {
    const change = diffText(shown, area.value);
    shown = area.value;
    if (change !== null) host.onChange([change]);
  };
  const onKey = (event: KeyboardEvent): void => {
    const command = (event.ctrlKey || event.metaKey) && !event.altKey;
    const key = event.key.toLowerCase();
    if (command && key === "s") {
      event.preventDefault();
      host.onSave();
    } else if (command && key === "z") {
      if ((event.shiftKey ? host.onRedo() : host.onUndo())) event.preventDefault();
    } else if (command && key === "y") {
      if (host.onRedo()) event.preventDefault();
    } else if (event.key === "Escape") {
      host.onEscape();
    }
  };
  area.addEventListener("input", onInput);
  area.addEventListener("keydown", onKey);
  area.addEventListener("blur", host.onBlur);
  const lineStart = (line: number): number => {
    let offset = 0;
    for (let index = 0; index < line; index += 1) {
      const next = shown.indexOf("\n", offset);
      if (next === -1) return shown.length;
      offset = next + 1;
    }
    return offset;
  };
  return {
    setText(text) {
      shown = text;
      area.value = text;
    },
    getText: () => area.value,
    getSelection: () => ({ from: area.selectionStart, to: area.selectionEnd }),
    select(from, to) {
      area.focus();
      area.setSelectionRange(from, to);
    },
    revealLine(line) {
      const offset = lineStart(line);
      area.focus();
      area.setSelectionRange(offset, offset);
    },
    setReadOnly(readOnly) {
      area.readOnly = readOnly;
    },
    setPreferences: () => undefined,
    setDiagnostics: () => undefined,
    setLanguage: () => undefined,
    focus: () => area.focus(),
    dispose() {
      area.removeEventListener("input", onInput);
      area.removeEventListener("keydown", onKey);
      area.removeEventListener("blur", host.onBlur);
      area.remove();
    },
  };
};
