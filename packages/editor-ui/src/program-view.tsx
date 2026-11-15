import {
  commandReference,
  createEditTracker,
  DEFAULT_PROGRAM_PREFERENCES,
  filterCommandReference,
  insertCommandEdit,
  insertHeaderCommand,
  type CommandReferenceEntry,
  type ConflictChoice,
  type ConflictResult,
  type EditTextCommand,
  type HistoryResult,
  type PendingEditWork,
  type PendingEdits,
  type ProgramCommand,
  type ProgramDocumentSnapshot,
  type ProgramPreferences,
  type SaveResult,
} from "@tk-reawakened/editor-model";
import type { Capabilities, DocumentEdited, LanguageConnectOptions, LanguageService } from "@tk-reawakened/platform-services";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { leaseLanguageClient, type LanguageClient, type LanguageLease } from "./language-client.ts";
import { createPlainTextSurface, type SurfaceDiagnostic, type TextChange, type TextSurface, type TextSurfaceFactory } from "./text-surface.ts";
import { useDocumentSnapshot } from "./use-document.ts";
import type { ViewDocument } from "./mount.ts";

/** The program document a view binds to. A host whose workbench owns history leaves `undo`/`redo` out. */
export interface ProgramViewDocument extends ViewDocument<ProgramDocumentSnapshot, ProgramCommand> {
  undo?(): HistoryResult | Promise<HistoryResult>;
  redo?(): HistoryResult | Promise<HistoryResult>;
}

/** The program-editor preferences in force, read by the view and told when they change. */
export interface ProgramPreferencesSource {
  get(): ProgramPreferences;
  subscribe(listener: () => void): () => void;
}

export interface ProgramViewProps {
  readonly doc: ProgramViewDocument;
  readonly capabilities: Capabilities;
  readonly onEdited: (event: DocumentEdited) => void;
  /** Where the view reports typing it has buffered, so Save, close and revert wait for it (#2613). */
  readonly pendingEdits?: PendingEdits;
  /** The code editor; a plain text area when the host gives none or it fails to start. */
  readonly createSurface?: TextSurfaceFactory;
  /** The host's language server door; the view edits without language features when absent. */
  readonly language?: LanguageService;
  /** The running project's main file, so the server can read the project; `null` leaves documents unassessed. */
  readonly project?: LanguageConnectOptions["project"];
  readonly preferences?: ProgramPreferencesSource;
  /** The quick reference; every first-party command by default. */
  readonly reference?: readonly CommandReferenceEntry[];
  /** How long, in milliseconds, a burst of typing may pause before it becomes one edit. */
  readonly settleMs?: number;
}

interface BookmarkRow {
  readonly name: string;
  readonly kind: string;
  readonly line: number;
}

/** LSP symbol kinds the bookmark list names (docs/spec/engine/rpgcode-tooling.md#tool-10). */
const SYMBOL_KINDS: Readonly<Record<number, string>> = { 5: "Class", 6: "Method", 8: "Field", 12: "Function", 15: "Comment", 20: "Label" };

interface SymbolNode {
  readonly name: string;
  readonly kind: number;
  readonly range: { readonly start: { readonly line: number } };
  readonly children?: readonly SymbolNode[];
}

function flatten(symbols: readonly SymbolNode[]): BookmarkRow[] {
  const rows: BookmarkRow[] = [];
  const visit = (nodes: readonly SymbolNode[]): void => {
    for (const node of nodes) {
      rows.push({ name: node.name, kind: SYMBOL_KINDS[node.kind] ?? "Symbol", line: node.range.start.line });
      if (node.children !== undefined) visit(node.children);
    }
  };
  visit(symbols);
  return rows.sort((left, right) => left.line - right.line);
}
interface TextRun {
  readonly chunks: string[];
  length: number;
}

const TEXT_RUN_CHUNK = 1024;

interface TextPiece {
  readonly id: number;
  readonly source: TextRun;
  readonly from: number;
  readonly to: number;
}

interface TrackedText {
  readonly text: string;
  readonly pieces: readonly TextPiece[];
}

interface PendingText {
  base: TrackedText;
  current: TrackedText;
}

interface PieceRange {
  readonly from: number;
  readonly to: number;
}

interface PiecePosition extends PieceRange {
  readonly index: number;
  readonly start: number;
}

function textRun(text: string): TextRun {
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += TEXT_RUN_CHUNK) {
    chunks.push(text.slice(offset, offset + TEXT_RUN_CHUNK));
  }
  return { chunks, length: text.length };
}

function appendTextRun(run: TextRun, text: string): void {
  let offset = 0;
  while (offset < text.length) {
    const lastIndex = run.chunks.length - 1;
    const last = run.chunks[lastIndex];
    if (last !== undefined && last.length < TEXT_RUN_CHUNK) {
      const count = Math.min(TEXT_RUN_CHUNK - last.length, text.length - offset);
      run.chunks[lastIndex] = last + text.slice(offset, offset + count);
      offset += count;
    } else {
      const end = Math.min(offset + TEXT_RUN_CHUNK, text.length);
      run.chunks.push(text.slice(offset, end));
      offset = end;
    }
  }
  run.length += text.length;
}

function sliceTextRun(run: TextRun, from: number, to: number): string {
  if (from === to) return "";
  const parts: string[] = [];
  let offset = 0;
  for (const chunk of run.chunks) {
    const end = offset + chunk.length;
    if (end > from && offset < to) parts.push(chunk.slice(Math.max(from, offset) - offset, Math.min(to, end) - offset));
    offset = end;
    if (offset >= to) break;
  }
  return parts.join("");
}

function trackedText(text: string, allocate: () => number): TrackedText {
  if (text.length === 0) return { text, pieces: [] };
  return { text, pieces: [{ id: allocate(), source: textRun(text), from: 0, to: text.length }] };
}

function copyTracked(text: TrackedText): TrackedText {
  return { text: text.text, pieces: text.pieces.slice() };
}

function textOfPieces(pieces: readonly TextPiece[]): string {
  return pieces.map((piece) => sliceTextRun(piece.source, piece.from, piece.to)).join("");
}

function compactPieces(pieces: TextPiece[]): void {
  let write = 0;
  for (const piece of pieces) {
    const previous = pieces[write - 1];
    if (previous !== undefined && previous.id === piece.id && previous.source === piece.source && previous.to === piece.from) {
      pieces[write - 1] = { ...previous, to: piece.to };
    } else {
      pieces[write] = piece;
      write += 1;
    }
  }
  pieces.length = write;
}

/** Split the piece at a UTF-16 offset and return the index immediately after that offset. */
function splitPiecesAt(pieces: TextPiece[], offset: number): number {
  let start = 0;
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index]!;
    const end = start + piece.to - piece.from;
    if (offset === start) return index;
    if (offset === end) return index + 1;
    if (offset > start && offset < end) {
      const split = piece.from + offset - start;
      pieces.splice(index, 1, { ...piece, to: split }, { ...piece, from: split });
      return index + 1;
    }
    start = end;
  }
  return pieces.length;
}

/** Apply sequential replacements without expanding unchanged text into per-character identities. */
function applyTrackedChanges(text: TrackedText, changes: readonly TextChange[], allocate: () => number, resultText?: string): TrackedText {
  const pieces = text.pieces.slice();
  for (const change of changes) {
    const from = splitPiecesAt(pieces, change.from);
    const to = splitPiecesAt(pieces, change.to);
    if (change.text.length > 0 && change.from === change.to && from > 0) {
      const previous = pieces[from - 1]!;
      if (previous.to === previous.source.length) {
        appendTextRun(previous.source, change.text);
        pieces[from - 1] = { ...previous, to: previous.source.length };
      } else {
        pieces.splice(from, to - from, { id: allocate(), source: textRun(change.text), from: 0, to: change.text.length });
      }
    } else if (change.text.length === 0) {
      pieces.splice(from, to - from);
    } else {
      pieces.splice(from, to - from, { id: allocate(), source: textRun(change.text), from: 0, to: change.text.length });
    }
    compactPieces(pieces);
  }
  let length = 0;
  for (const piece of pieces) length += piece.to - piece.from;
  if (resultText === undefined || length !== resultText.length) return trackedText(resultText ?? textOfPieces(pieces), allocate);
  return { text: resultText, pieces };
}

function rangesById(pieces: readonly TextPiece[]): Map<number, PieceRange[]> {
  const ranges = new Map<number, PieceRange[]>();
  for (const piece of pieces) {
    const same = ranges.get(piece.id);
    if (same === undefined) ranges.set(piece.id, [{ from: piece.from, to: piece.to }]);
    else same.push({ from: piece.from, to: piece.to });
  }
  return ranges;
}

function positionsById(pieces: readonly TextPiece[]): Map<number, PiecePosition[]> {
  const positions = new Map<number, PiecePosition[]>();
  let start = 0;
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index]!;
    const same = positions.get(piece.id);
    const position = { from: piece.from, to: piece.to, index, start };
    if (same === undefined) positions.set(piece.id, [position]);
    else same.push(position);
    start += piece.to - piece.from;
  }
  return positions;
}

function firstRangeEndingAfter(ranges: readonly PieceRange[], offset: number): number {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (ranges[middle]!.to <= offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

function piecePosition(piece: TextPiece, positions: ReadonlyMap<number, readonly PiecePosition[]>): number | null {
  const same = positions.get(piece.id);
  if (same === undefined) return null;
  for (let index = firstRangeEndingAfter(same, piece.from); index < same.length; index += 1) {
    const match = same[index]!;
    if (match.from >= piece.to) break;
    const from = Math.max(piece.from, match.from);
    if (from < Math.min(piece.to, match.to)) return match.start + from - match.from;
  }
  return null;
}

function intersectPieces(piece: TextPiece, ranges: readonly PieceRange[], output: TextPiece[]): void {
  for (let index = firstRangeEndingAfter(ranges, piece.from); index < ranges.length; index += 1) {
    const range = ranges[index]!;
    if (range.from >= piece.to) break;
    const from = Math.max(piece.from, range.from);
    const to = Math.min(piece.to, range.to);
    if (from < to) output.push({ ...piece, from, to });
  }
}

function missingPieceRanges(piece: TextPiece, present: readonly PieceRange[] | undefined): PieceRange[] {
  if (present === undefined || present.length === 0) return [{ from: piece.from, to: piece.to }];
  const missing: PieceRange[] = [];
  let cursor = piece.from;
  for (let index = firstRangeEndingAfter(present, piece.from); index < present.length; index += 1) {
    const range = present[index]!;
    if (range.from >= piece.to) break;
    if (range.from > cursor) missing.push({ from: cursor, to: Math.min(range.from, piece.to) });
    cursor = Math.max(cursor, range.to);
    if (cursor >= piece.to) break;
  }
  if (cursor < piece.to) missing.push({ from: cursor, to: piece.to });
  return missing;
}

/**
 * Merge edits made against a stale surface onto the current document. Piece identities distinguish repeated text and
 * preserve unchanged islands; history-inserted pieces survive unless the surface explicitly deleted their identity.
 */
function mergePendingText(document: TrackedText, pending: PendingText): TrackedText {
  const baseRanges = rangesById(pending.base.pieces);
  const currentRanges = rangesById(pending.current.pieces);
  const pieces: TextPiece[] = [];
  for (const piece of document.pieces) {
    const base = baseRanges.get(piece.id);
    if (base === undefined) pieces.push(piece);
    else intersectPieces(piece, currentRanges.get(piece.id) ?? [], pieces);
  }
  compactPieces(pieces);

  const targetPositions = positionsById(pieces);
  const targetRanges = rangesById(pieces);
  const nextAnchor = new Array<number | null>(pending.current.pieces.length);
  let next: number | null = null;
  for (let index = pending.current.pieces.length - 1; index >= 0; index -= 1) {
    nextAnchor[index] = next;
    const at = piecePosition(pending.current.pieces[index]!, targetPositions);
    if (at !== null) next = at;
  }

  let targetLength = 0;
  for (const piece of pieces) targetLength += piece.to - piece.from;
  const additions = new Map<number, TextPiece[]>();
  for (let index = 0; index < pending.current.pieces.length; index += 1) {
    const piece = pending.current.pieces[index]!;
    const candidates = missingPieceRanges(piece, baseRanges.get(piece.id));
    for (const candidate of candidates) {
      const addition = { ...piece, from: candidate.from, to: candidate.to };
      const missing = missingPieceRanges(addition, targetRanges.get(piece.id));
      if (missing.length === 0) continue;
      const at = nextAnchor[index] ?? targetLength;
      let atPieces = additions.get(at);
      if (atPieces === undefined) {
        atPieces = [];
        additions.set(at, atPieces);
      }
      for (const range of missing) atPieces.push({ ...piece, from: range.from, to: range.to });
    }
  }

  const anchors = [...additions.keys()].sort((left, right) => left - right);
  const merged: TextPiece[] = [];
  let anchorIndex = 0;
  let offset = 0;
  for (const piece of pieces) {
    const end = offset + piece.to - piece.from;
    let cursor = offset;
    while (anchorIndex < anchors.length && anchors[anchorIndex]! <= end) {
      const anchor = anchors[anchorIndex]!;
      const at = Math.max(anchor, offset);
      if (at > cursor) merged.push({ ...piece, from: piece.from + cursor - offset, to: piece.from + at - offset });
      for (const addition of additions.get(anchor)!) merged.push(addition);
      cursor = at;
      anchorIndex += 1;
    }
    if (cursor < end) merged.push({ ...piece, from: piece.from + cursor - offset, to: piece.to });
    offset = end;
  }
  while (anchorIndex < anchors.length) {
    for (const addition of additions.get(anchors[anchorIndex]!)!) merged.push(addition);
    anchorIndex += 1;
  }
  compactPieces(merged);
  return { text: textOfPieces(merged), pieces: merged };
}

/** Return compact, right-to-left replacements between two piece-identified revisions. */
function trackedTextChanges(before: TrackedText, after: TrackedText): TextChange[] {
  if (before.text === after.text) return [];
  const targetPositions = new Map<number, Array<PiecePosition & { readonly start: number }>>();
  let targetOffset = 0;
  for (let index = 0; index < after.pieces.length; index += 1) {
    const piece = after.pieces[index]!;
    const same = targetPositions.get(piece.id);
    const position = { from: piece.from, to: piece.to, index, start: targetOffset };
    if (same === undefined) targetPositions.set(piece.id, [position]);
    else same.push(position);
    targetOffset += piece.to - piece.from;
  }

  const matches: Array<{ readonly from: number; readonly to: number; readonly length: number }> = [];
  let sourceOffset = 0;
  for (const piece of before.pieces) {
    const same = targetPositions.get(piece.id);
    if (same !== undefined) {
      for (let index = firstRangeEndingAfter(same, piece.from); index < same.length; index += 1) {
        const position = same[index]!;
        if (position.from >= piece.to) break;
        const from = Math.max(piece.from, position.from);
        const to = Math.min(piece.to, position.to);
        if (from >= to) continue;
        const match = {
          from: sourceOffset + from - piece.from,
          to: position.start + from - position.from,
          length: to - from,
        };
        const previous = matches.at(-1);
        if (previous !== undefined && previous.from + previous.length === match.from && previous.to + previous.length === match.to) {
          matches[matches.length - 1] = { ...previous, length: previous.length + match.length };
        } else {
          matches.push(match);
        }
      }
    }
    sourceOffset += piece.to - piece.from;
  }

  const gaps: Array<{ readonly from: number; readonly to: number; readonly targetFrom: number; readonly targetTo: number }> = [];
  let from = 0;
  let to = 0;
  for (const match of matches) {
    if (match.from < from || match.to < to) continue;
    if (match.from > from || match.to > to) gaps.push({ from, to: match.from, targetFrom: to, targetTo: match.to });
    from = match.from + match.length;
    to = match.to + match.length;
  }
  if (from < before.text.length || to < after.text.length) {
    gaps.push({ from, to: before.text.length, targetFrom: to, targetTo: after.text.length });
  }
  return gaps.reverse().map((gap) => ({
    from: gap.from,
    to: gap.to,
    text: after.text.slice(gap.targetFrom, gap.targetTo),
  }));
}

/** Recover the inverse of a sequential text command while its pre-undo text is available. */
function inverseTextEdits(base: string, expected: string, command: EditTextCommand): TextChange[] | null {
  let text = base;
  const removed: string[] = [];
  for (const edit of command.edits) {
    if (edit.from < 0 || edit.to < edit.from || edit.to > text.length) return null;
    removed.push(text.slice(edit.from, edit.to));
    text = text.slice(0, edit.from) + edit.text + text.slice(edit.to);
  }
  if (text !== expected) return null;
  const inverse: TextChange[] = [];
  for (let index = command.edits.length - 1; index >= 0; index -= 1) {
    const edit = command.edits[index]!;
    inverse.push({ from: edit.from, to: edit.from + edit.text.length, text: removed[index]! });
  }
  return inverse;
}


/** The typing a burst may last before it is applied even with no pause, so the dirty mark and undo stay close to the text. */
const MAX_BURST_MS = 3000;
const SETTLE_MS = 600;
const BOOKMARK_MS = 300;

/** One LSP document is opened once, even when several editor views lease it. */
interface OpenLanguageDocument {
  refs: number;
  version: number;
  sent: string;
  bookmarkRefreshers: Set<() => void>;
}

const openLanguageDocuments = new WeakMap<LanguageClient, Map<string, OpenLanguageDocument>>();

function acquireLanguageDocument(client: LanguageClient, uri: string, text: string): OpenLanguageDocument {
  let documents = openLanguageDocuments.get(client);
  if (documents === undefined) {
    documents = new Map();
    openLanguageDocuments.set(client, documents);
  }
  const existing = documents.get(uri);
  if (existing !== undefined) {
    existing.refs += 1;
    return existing;
  }
  const opened: OpenLanguageDocument = { refs: 1, version: 1, sent: text, bookmarkRefreshers: new Set() };
  documents.set(uri, opened);
  client.notify("textDocument/didOpen", { textDocument: { uri, languageId: "rpgcode", version: 1, text } });
  return opened;
}

function releaseLanguageDocument(client: LanguageClient, uri: string): void {
  const documents = openLanguageDocuments.get(client);
  const opened = documents?.get(uri);
  if (documents === undefined || opened === undefined) return;
  opened.refs -= 1;
  if (opened.refs > 0) return;
  documents.delete(uri);
  if (documents.size === 0) openLanguageDocuments.delete(client);
  try {
    client.notify("textDocument/didClose", { textDocument: { uri } });
  } catch {
    // The server is already gone.
  }
}

interface QueuedSaveStage {
  readonly pending: PendingText | null;
}

interface Control {
  surface: TextSurface | null;
  document: TrackedText;
  visible: TrackedText;
  pending: PendingText | null;
  nextTextId: number;
  documentKey: string;
  burstStart: number;
  timer: ReturnType<typeof setTimeout> | null;
  bookmarkTimer: ReturnType<typeof setTimeout> | null;
  bookmarkRequest: number;
  lsp: { readonly client: LanguageClient; readonly uri: string; readonly document: OpenLanguageDocument } | null;
}

let viewsMade = 0;
/** window/showMessage has no document URI. Attribute a refusal only when one view is formatting. */
const formattingRequests = new WeakMap<LanguageClient, Set<object>>();

/**
 * The RPGCode program editor (T-40, story 11.7). The document is the one copy of the text; the code editor is a surface
 * that shows it. Typing is buffered into one edit per burst and handed to the document; undo, redo, the header and the
 * command insertion go to the document and come back to the surface. The language server is a helper: if it is absent or
 * stops, the text still edits, undoes, saves and reopens (docs/spec/engine/rpgcode-tooling.md#tool-10).
 */
export function ProgramView({ doc, capabilities, onEdited, pendingEdits, createSurface, language, project, preferences, reference, settleMs }: ProgramViewProps) {
  const snapshot = useDocumentSnapshot(doc);
  const [ids] = useState(() => {
    viewsMade += 1;
    return `tkr-program-${viewsMade}`;
  });
  const [initialControl] = useState<Control>(() => {
    let nextTextId = 1;
    const initial = trackedText(snapshot.text, () => nextTextId++);
    return {
      surface: null,
      document: initial,
      visible: initial,
      pending: null,
      nextTextId,
      documentKey: doc.identity.key,
      burstStart: 0,
      timer: null,
      bookmarkTimer: null,
      bookmarkRequest: 0,
      lsp: null,
    };
  });
  const control = useRef(initialControl);
  const host = useRef<HTMLDivElement>(null);
  const tracker = useMemo(() => createEditTracker(), []);
  const commandQueue = useRef<Promise<void>>(Promise.resolve());
  const queuedCommands = useRef(0);
  const queuedSaveBoundaries = useRef(0);
  const queuedHistoryCommands = useRef(0);
  const historyQueued = useRef(false);
  const queuedSaveStages = useRef<QueuedSaveStage[]>([]);
  const enqueueCommand = <T,>(operation: () => Promise<T>): Promise<T> => {
    queuedCommands.current += 1;
    const result = commandQueue.current.then(operation);
    commandQueue.current = result.then(
      () => { queuedCommands.current -= 1; },
      () => { queuedCommands.current -= 1; },
    );
    return result;
  };
  const latest = useRef({ doc, snapshot, onEdited });
  latest.current = { doc, snapshot, onEdited };

  const [prefs, setPrefs] = useState<ProgramPreferences>(() => preferences?.get() ?? DEFAULT_PROGRAM_PREFERENCES);
  const [message, setMessage] = useState<string | null>(null);
  const [languageNote, setLanguageNote] = useState<string | null>(null);
  const [languageStatus, setLanguageStatus] = useState<string | null>(null);
  const [surfaceNote, setSurfaceNote] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [bookmarks, setBookmarks] = useState<readonly BookmarkRow[]>([]);
  const [problems, setProblems] = useState(0);
  const [showReference, setShowReference] = useState(true);
  const [showBookmarks, setShowBookmarks] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<CommandReferenceEntry | null>(null);
  const [resolving, setResolving] = useState(false);
  const entries = useMemo(() => reference ?? commandReference(), [reference]);
  const visible = useMemo(() => filterCommandReference(entries, query), [entries, query]);
  const readOnly = snapshot.readOnly !== null;
  const settle = settleMs ?? SETTLE_MS;

  // --- text identity: the surface follows the document, and typing becomes commands -----------------------------------

  const sendToServer = (): void => {
    const lsp = control.current.lsp;
    const surface = control.current.surface;
    if (lsp === null || surface === null) return;
    const text = surface.getText();
    const document = lsp.document;
    if (text === document.sent) return;
    document.version += 1;
    document.sent = text;
    lsp.client.notify("textDocument/didChange", { textDocument: { uri: lsp.uri, version: document.version }, contentChanges: [{ text }] });
    for (const refresh of document.bookmarkRefreshers) refresh();
  };

  const refreshBookmarks = (): void => {
    const lsp = control.current.lsp;
    if (lsp === null) return;
    const request = ++control.current.bookmarkRequest;
    void lsp.client
      .request<readonly SymbolNode[] | null>("textDocument/documentSymbol", { textDocument: { uri: lsp.uri } })
      .then(
        (symbols) => {
          if (control.current.lsp === lsp && control.current.bookmarkRequest === request) {
            setBookmarks(flatten(symbols ?? []));
          }
        },
        (error: unknown) => {
          if (control.current.lsp === lsp && control.current.bookmarkRequest === request) {
            setBookmarks([]);
            setLanguageStatus(`Language request textDocument/documentSymbol failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        },
      );
  };

  /** After typing the outline is asked for once the typing pauses; the server has the new text already. */
  const scheduleBookmarks = (): void => {
    const ctl = control.current;
    if (ctl.lsp === null) return;
    clearTimeout(ctl.bookmarkTimer ?? undefined);
    ctl.bookmarkTimer = setTimeout(() => {
      ctl.bookmarkTimer = null;
      refreshBookmarks();
    }, BOOKMARK_MS);
  };

  /** Give the surface the document's text when the surface is not holding typing the document has yet to take. */
  const allocateTextId = (): number => {
    const ctl = control.current;
    const id = ctl.nextTextId;
    ctl.nextTextId += 1;
    return id;
  };

  const setVisibleText = (text: TrackedText): void => {
    const ctl = control.current;
    ctl.visible = text;
    if (ctl.surface !== null && ctl.surface.getText() !== text.text) ctl.surface.setText(text.text);
    sendToServer();
  };

  const alignDocumentTrack = (): void => {
    const ctl = control.current;
    const current = latest.current.doc.getSnapshot();
    if (ctl.documentKey !== latest.current.doc.identity.key || ctl.document.text !== current.text) {
      ctl.document = trackedText(current.text, allocateTextId);
      ctl.documentKey = latest.current.doc.identity.key;
    }
  };

  const rebasePendingToDocument = (): void => {
    const ctl = control.current;
    if (ctl.pending === null) {
      setVisibleText(copyTracked(ctl.document));
      return;
    }
    const current = mergePendingText(ctl.document, ctl.pending);
    ctl.pending.base = copyTracked(ctl.document);
    ctl.pending.current = current;
    setVisibleText(current);
  };

  /** Give the surface the document's text when the surface is not holding typing the document has yet to take. */
  const syncFromDocument = (force: boolean): void => {
    const ctl = control.current;
    if (ctl.surface === null) return;
    if (!force && (ctl.pending !== null || tracker.busy() || queuedSaveBoundaries.current > 0)) return;
    alignDocumentTrack();
    if (ctl.pending === null) setVisibleText(copyTracked(ctl.document));
    else rebasePendingToDocument();
    ctl.surface.setReadOnly(latest.current.doc.getSnapshot().readOnly !== null);
  };


  const applyPendingText = async (pending: PendingText): Promise<boolean> => {
    const ctl = control.current;
    alignDocumentTrack();
    const merged = mergePendingText(ctl.document, pending);
    const edits = trackedTextChanges(ctl.document, merged);
    if (edits.length === 0) return true;

    const end = tracker.begin();
    try {
      const result = await latest.current.doc.apply({ type: "edit-text", edits, label: "Typing" });
      if (!result.ok) {
        setMessage(result.rejection.message);
        return false;
      }
      const current = latest.current.doc.getSnapshot();
      ctl.document = merged.text === current.text ? merged : trackedText(current.text, allocateTextId);
      ctl.documentKey = latest.current.doc.identity.key;
      setMessage(null);
      latest.current.onEdited({ document: latest.current.doc.identity.key, editId: result.editId, label: "Typing" });
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      end();
    }
  };

  /** Hand the buffered typing to the document as one edit. Tracking starts now, so Save and close wait for the answer. */
  const flush = (): void => {
    if (historyQueued.current || queuedSaveBoundaries.current > 0) return;
    const ctl = control.current;
    clearTimeout(ctl.timer ?? undefined);
    ctl.timer = null;
    const pending = ctl.pending;
    if (pending === null) return;
    ctl.pending = null;
    void applyPendingText(pending)
      .then((accepted) => {
        if (accepted) return;
        if (control.current.pending === null) syncFromDocument(true);
        else rebasePendingToDocument();
      })
      .finally(() => setTyping(control.current.pending !== null));
  };

  const work = useMemo<PendingEditWork>(() => ({
    busy: () => control.current.pending !== null || tracker.busy() || queuedCommands.current > 0,
    idle: async () => {
      await commandQueue.current;
      flush();
      await tracker.idle();
    },
  }), [tracker]);
  useEffect(() => pendingEdits?.register(work), [pendingEdits, work]);

  /** Apply a command made by the view itself (header, command insertion) after the typing before it. */
  const applyTextCommand = async (command: EditTextCommand): Promise<boolean> => {
    const ctl = control.current;
    const end = tracker.begin();
    try {
      const result = await latest.current.doc.apply(command);
      if (!result.ok) {
        setMessage(result.rejection.message);
        return false;
      }
      const current = latest.current.doc.getSnapshot();
      const changed = applyTrackedChanges(ctl.document, command.edits, allocateTextId, current.text);
      ctl.document = changed;
      ctl.documentKey = latest.current.doc.identity.key;
      setMessage(null);
      latest.current.onEdited({ document: latest.current.doc.identity.key, editId: result.editId, label: command.label ?? "Edit text" });
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      end();
    }
  };

  const history = (which: "undo" | "redo"): Promise<void> => {
    // Establish the edit boundary at the user's action, not after an earlier queued save finishes.
    flush();
    queuedHistoryCommands.current += 1;
    historyQueued.current = true;
    return enqueueCommand(async () => {
      try {
        await tracker.idle();
        const document = latest.current.doc;
        const step = which === "undo" ? document.undo : document.redo;
        if (step === undefined) return;
        const beforeSnapshot = document.getSnapshot();
        const ctl = control.current;
        if (ctl.document.text !== beforeSnapshot.text) ctl.document = trackedText(beforeSnapshot.text, allocateTextId);
        let result: HistoryResult | null = null;
        try {
          result = await step.call(document);
          setMessage(result.ok ? null : `Nothing to ${which}.`);
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error));
        }
        const afterSnapshot = document.getSnapshot();
        if (result?.ok) {
          const record = (which === "undo" ? beforeSnapshot.edits : afterSnapshot.edits).find((edit) => edit.editId === result!.editId);
          if (record !== undefined) {
            const changes = which === "undo"
              ? inverseTextEdits(afterSnapshot.text, beforeSnapshot.text, record.command)
              : record.command.edits;
            if (changes !== null) {
              const changed = applyTrackedChanges(ctl.document, changes, allocateTextId, afterSnapshot.text);
              ctl.document = changed;
            } else {
              ctl.document = trackedText(afterSnapshot.text, allocateTextId);
            }
          } else {
            ctl.document = trackedText(afterSnapshot.text, allocateTextId);
          }
          ctl.documentKey = document.identity.key;
        }
        if (queuedSaveStages.current.length === 0) {
          if (ctl.pending !== null) {
            const current = mergePendingText(ctl.document, ctl.pending);
            ctl.pending.base = copyTracked(ctl.document);
            ctl.pending.current = current;
            setVisibleText(current);
          } else {
            setVisibleText(copyTracked(ctl.document));
          }
          ctl.surface?.setReadOnly(afterSnapshot.readOnly !== null);
        }
      } finally {
        queuedHistoryCommands.current -= 1;
        historyQueued.current = queuedHistoryCommands.current > 0;
        if (queuedHistoryCommands.current === 0 && queuedSaveBoundaries.current === 0 && queuedSaveStages.current.length === 0) {
          if (control.current.pending !== null) {
            flush();
            await tracker.idle();
          } else {
            syncFromDocument(true);
          }
        }
      }
    });
  };

  const save = (): Promise<SaveResult | null> => {
    // A save behind queued history owns only the typing that existed when it was requested.
    // Keep later typing buffered until that captured revision has been applied and saved.
    if (historyQueued.current || queuedSaveBoundaries.current > 0) {
      const ctl = control.current;
      clearTimeout(ctl.timer ?? undefined);
      ctl.timer = null;
      const stage: QueuedSaveStage = {
        pending: ctl.pending === null
          ? null
          : {
              base: copyTracked(ctl.pending.base),
              current: copyTracked(ctl.pending.current),
            },
      };
      ctl.pending = null;
      queuedSaveStages.current.push(stage);
      queuedSaveBoundaries.current += 1;
      return enqueueCommand(async () => {
        try {
          await tracker.idle();
          if (stage.pending !== null) await applyPendingText(stage.pending);
          await tracker.idle();
          const result = await latest.current.doc.save();
          if (!result.ok) setMessage(result.failure.message);
          else setMessage(null);
          return result;
        } finally {
          const index = queuedSaveStages.current.indexOf(stage);
          if (index !== -1) queuedSaveStages.current.splice(index, 1);
          queuedSaveBoundaries.current -= 1;
          if (queuedHistoryCommands.current === 0 && queuedSaveBoundaries.current === 0 && queuedSaveStages.current.length === 0) {
            if (control.current.pending !== null) {
              rebasePendingToDocument();
              flush();
              await tracker.idle();
            } else {
              syncFromDocument(true);
            }
          }
        }
      });
    }
    // The document fixes the bytes for this invocation immediately, even when an earlier save is still in flight.
    flush();
    const saving = latest.current.doc.save();
    return enqueueCommand(async () => {
      await tracker.idle();
      const result = await saving;
      if (!result.ok) setMessage(result.failure.message);
      else setMessage(null);
      return result;
    });
  };

  // --- the code editor --------------------------------------------------------------------------------------------------

  useEffect(() => {
    const element = host.current;
    if (element === null) return undefined;
    const ctl = control.current;
    const start = latest.current.snapshot;
    if (ctl.documentKey !== latest.current.doc.identity.key || (ctl.pending === null && ctl.document.text !== start.text)) {
      ctl.document = trackedText(start.text, () => ctl.nextTextId++);
      ctl.visible = copyTracked(ctl.document);
      ctl.documentKey = latest.current.doc.identity.key;
    }
    const surfaceHost = {
      text: start.text,
      readOnly: start.readOnly !== null,
      name: `${ids}/${latest.current.doc.identity.path}`,
      preferences: prefs,
      onChange(changes: readonly TextChange[]) {
        if (ctl.pending === null) {
          ctl.burstStart = Date.now();
          const base = copyTracked(ctl.visible);
          ctl.pending = { base, current: copyTracked(base) };
        }
        const actual = ctl.surface?.getText();
        ctl.pending.current = applyTrackedChanges(ctl.pending.current, changes, () => ctl.nextTextId++, actual);
        ctl.visible = ctl.pending.current;
        setTyping(true);
        sendToServer();
        clearTimeout(ctl.timer ?? undefined);
        ctl.timer = setTimeout(() => flush(), Date.now() - ctl.burstStart >= MAX_BURST_MS ? 0 : settle);
      },
      onUndo() {
        if (latest.current.doc.undo === undefined) return false;
        void history("undo");
        return true;
      },
      onRedo() {
        if (latest.current.doc.redo === undefined) return false;
        void history("redo");
        return true;
      },
      onSave() {
        void save();
      },
      onBlur: flush,
      onEscape() {
        setFocusMode(false);
      },
    };
    let surface: TextSurface;
    try {
      surface = (createSurface ?? createPlainTextSurface)(element, surfaceHost);
    } catch (error) {
      // A code editor that cannot start leaves a plain text area: editing never depends on it.
      setSurfaceNote(`The code editor could not start (${error instanceof Error ? error.message : String(error)}), so a plain text area is shown. Colouring and call tips are unavailable.`);
      element.replaceChildren();
      surface = createPlainTextSurface(element, surfaceHost);
    }
    ctl.surface = surface;
    if (surface.getText() !== ctl.visible.text) surface.setText(ctl.visible.text);
    return () => {
      clearTimeout(ctl.timer ?? undefined);
      ctl.timer = null;
      // Typing buffered at disposal still reaches the document: closing a view never discards text (ADR 0022 D3.7).
      flush();
      surface.dispose();
      ctl.surface = null;
    };
  }, [doc, createSurface]);

  // The document changed (undo, revert, an external reload, our own edit): the surface follows.
  useEffect(() => {
    syncFromDocument(false);
  }, [snapshot.text, snapshot.readOnly]);

  useEffect(() => {
    if (preferences === undefined) return undefined;
    const apply = (): void => {
      const next = preferences.get();
      setPrefs(next);
      control.current.surface?.setPreferences(next);
    };
    apply();
    return preferences.subscribe(apply);
  }, [preferences]);

  // --- the language server ----------------------------------------------------------------------------------------------

  useEffect(() => {
    setLanguageStatus(null);
    if (language === undefined) {
      setLanguageNote("Language features are not available in this host. You can still edit and save.");
      return undefined;
    }
    setLanguageNote(null);
    const ctl = control.current;
    let cancelled = false;
    let lease: LanguageLease | null = null;
    const stops: Array<() => void> = [];
    let bookmarkRefresh: (() => void) | null = null;
    void leaseLanguageClient(language, project ?? null).then((leased) => {
      const surface = ctl.surface;
      if (cancelled || surface === null) {
        if (leased.ok) leased.lease.release();
        return;
      }
      if (!leased.ok) {
        setLanguageNote(`Language features are unavailable: ${leased.message} You can still edit and save.`);
        return;
      }
      lease = leased.lease;
      const client = leased.lease.client;
      const uri = client.uriOf(latest.current.doc.identity.path);
      const text = surface.getText();
      const document = acquireLanguageDocument(client, uri, text);
      ctl.lsp = { client, uri, document };
      bookmarkRefresh = scheduleBookmarks;
      document.bookmarkRefreshers.add(bookmarkRefresh);
      const viewToken = {};
      const request = <T,>(method: string, params: Readonly<Record<string, unknown>>): Promise<T> => {
        const formatting = method === "textDocument/formatting" || method === "textDocument/rangeFormatting" || method === "textDocument/onTypeFormatting";
        if (formatting) {
          let active = formattingRequests.get(client);
          if (active === undefined) {
            active = new Set();
            formattingRequests.set(client, active);
          }
          active.add(viewToken);
        }
        return client.request<T>(method, { textDocument: { uri }, ...params }).then(
          (result) => result,
          (error: unknown) => {
            setLanguageStatus(`Language request ${method} failed: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
          },
        ).finally(() => {
          if (!formatting) return;
          const active = formattingRequests.get(client);
          active?.delete(viewToken);
          if (active?.size === 0) formattingRequests.delete(client);
        });
      };
      stops.push(client.onNotification("window/showMessage", (params) => {
        const message = params as { readonly type?: number; readonly message?: string };
        const active = formattingRequests.get(client);
        if (active?.size !== 1 || !active.has(viewToken) || (message.type !== 1 && message.type !== 2) || !message.message) return;
        setLanguageStatus(message.message);
      }));
      surface.setLanguage({ uri, capabilities: client.capabilities, request });
      stops.push(client.onNotification("textDocument/publishDiagnostics", (params) => {
        const published = params as { readonly uri?: string; readonly diagnostics?: readonly SurfaceDiagnostic[] };
        if (published.uri !== uri) return;
        setProblems(published.diagnostics?.filter((item) => item.severity === undefined || item.severity <= 2).length ?? 0);
        ctl.surface?.setDiagnostics(published.diagnostics ?? []);
      }));
      stops.push(client.onClose((reason) => {
        ctl.lsp = null;
        ctl.surface?.setLanguage(null);
        ctl.surface?.setDiagnostics([]);
        setBookmarks([]);
        setProblems(0);
        setLanguageStatus(null);
        setLanguageNote(`Language features stopped: ${reason} You can still edit and save.`);
      }));
      sendToServer();
      refreshBookmarks();
    });
    return () => {
      cancelled = true;
      clearTimeout(ctl.bookmarkTimer ?? undefined);
      ctl.bookmarkTimer = null;
      const lsp = ctl.lsp;
      ctl.lsp = null;
      if (lsp !== null && bookmarkRefresh !== null) lsp.document.bookmarkRefreshers.delete(bookmarkRefresh);
      for (const stop of stops) stop();
      if (lsp !== null) releaseLanguageDocument(lsp.client, lsp.uri);
      ctl.bookmarkRequest += 1;
      ctl.surface?.setLanguage(null);
      ctl.surface?.setDiagnostics([]);
      lease?.release();
    };
  }, [language, project?.main ?? null, doc, createSurface]);

  // --- commands ---------------------------------------------------------------------------------------------------------

  const insertHeader = (): void => {
    const command = insertHeaderCommand(prefs.headerTemplate, latest.current.doc.identity.path);
    if (command === null) {
      setMessage("The header template is empty, so there is nothing to insert. Change it in the editor preferences.");
      return;
    }
    void enqueueCommand(async () => {
      flush();
      await tracker.idle();
      return applyTextCommand(command);
    }).then((done) => {
      if (done) syncFromDocument(true);
    });
  };

  const insertCommand = (entry: CommandReferenceEntry): void => {
    const surface = control.current.surface;
    const selection = surface?.getSelection() ?? { from: 0, to: 0 };
    const { command, select } = insertCommandEdit(entry, selection.from, selection.to);
    void enqueueCommand(async () => {
      flush();
      await tracker.idle();
      if (await applyTextCommand(command)) {
        syncFromDocument(true);
        control.current.surface?.select(select.from, select.to);
      }
    });
  };

  const resolve = (choice: ConflictChoice): void => {
    setResolving(true);
    void Promise.resolve()
      .then(() => latest.current.doc.resolveConflict(choice))
      .then(async (result: ConflictResult) => {
        if (!result.ok) {
          setMessage(result.message);
          return;
        }
        setMessage(null);
        if (choice === "keep-local" && capabilities.has("conflictAutoSave")) await latest.current.doc.save().catch(() => undefined);
      })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)))
      .finally(() => setResolving(false));
  };

  const conflict = snapshot.conflict;
  const stateText = snapshot.saving ? "Saving…" : snapshot.dirty || typing ? "Unsaved changes" : "All changes saved";
  const bookmarkId = `${ids}-bookmarks`;
  const referenceId = `${ids}-reference`;

  return (
    <section class={`tkr-program${focusMode ? " tkr-program--focus" : ""}`} aria-label={`Program ${snapshot.identity.path}`}>
      {focusMode ? (
        <button type="button" class="tkr-program-exit-focus" onClick={() => setFocusMode(false)}>
          Exit distraction-free mode (Esc)
        </button>
      ) : (
        <>
          <h2 class="tkr-program-heading">{snapshot.identity.path}</h2>
          <div class="tkr-program-toolbar" role="toolbar" aria-label="Program tools">
            <button type="button" class="tkr-program-save" disabled={readOnly} onClick={() => void save()}>Save</button>
            <button type="button" class="tkr-program-header" disabled={readOnly} onClick={insertHeader}>Insert header</button>
            <button type="button" class="tkr-program-toggle-bookmarks" aria-pressed={showBookmarks} aria-controls={bookmarkId} onClick={() => setShowBookmarks(!showBookmarks)}>Bookmarks</button>
            <button type="button" class="tkr-program-toggle-reference" aria-pressed={showReference} aria-controls={referenceId} onClick={() => setShowReference(!showReference)}>Command reference</button>
            <button type="button" class="tkr-program-focus" onClick={() => { setFocusMode(true); control.current.surface?.focus(); }}>Distraction-free</button>
          </div>
          {snapshot.readOnly === null ? null : <p class="tkr-program-readonly" role="note">Read only: {snapshot.readOnly.message}</p>}
          {capabilities.has("fileWatch") ? null : (
            <p class="tkr-program-host-note">This host cannot watch files, so a change another program makes to this file is found when you save, and is never saved over.</p>
          )}
          {conflict === null ? null : (
            <div class="tkr-program-conflict" role="group" aria-label="Changed on disk">
              <p role="alert">{conflict.message}</p>
              <button type="button" disabled={resolving || readOnly} onClick={() => resolve("keep-local")}>
                {capabilities.has("conflictAutoSave") ? "Save my version" : "Keep my version"}
              </button>
              {capabilities.has("conflictReload") && conflict.externalTitle !== null ? (
                <button type="button" disabled={resolving} onClick={() => resolve("reload")}>Use the version on disk</button>
              ) : null}
            </div>
          )}
          <p class="tkr-program-state" role="status">
            {stateText}
            {problems > 0 ? ` · ${problems} ${problems === 1 ? "problem" : "problems"}` : ""}
          </p>
          {message === null ? null : <p class="tkr-program-message" role="alert">{message}</p>}
          {surfaceNote === null && languageNote === null && languageStatus === null ? null : (
            <p class="tkr-program-language-note" role="status">{surfaceNote ?? ""} {languageNote ?? ""} {languageStatus ?? ""}</p>
          )}
        </>
      )}
      <div class="tkr-program-body">
        {focusMode || !showBookmarks ? null : (
          <nav id={bookmarkId} class="tkr-program-bookmarks" aria-label="Bookmarks: functions, labels and comments">
            {bookmarks.length === 0 ? (
              <p class="tkr-program-empty">{languageNote === null ? "No functions, labels or comments yet." : "Bookmarks need the language features."}</p>
            ) : (
              <ul>
                {bookmarks.map((row) => (
                  <li key={`${row.line}:${row.name}`}>
                    <button type="button" onClick={() => control.current.surface?.revealLine(row.line)}>
                      <span class="tkr-program-bookmark-kind">{row.kind}</span> {row.name} <span class="tkr-program-bookmark-line">line {row.line + 1}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>
        )}
        <div class="tkr-program-text" ref={host} />
        {focusMode || !showReference ? null : (
          <aside id={referenceId} class="tkr-program-reference" aria-label="Command reference">
            <label>
              Find a command
              <input type="search" value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
            </label>
            <p class="tkr-program-reference-hint">Double-click a command to insert it at the cursor.</p>
            <ul class="tkr-program-reference-list">
              {visible.map((entry) => (
                <li key={entry.name}>
                  <button
                    type="button"
                    aria-pressed={chosen?.name === entry.name}
                    disabled={readOnly}
                    title={entry.summary ?? entry.syntax}
                    onClick={() => setChosen(entry)}
                    onDblClick={() => insertCommand(entry)}
                  >
                    <code>{entry.syntax}</code>
                  </button>
                </li>
              ))}
            </ul>
            {chosen === null ? null : (
              <div class="tkr-program-reference-detail">
                <p><strong>{chosen.name}</strong>{chosen.aliasOf === null ? "" : ` (another spelling of ${chosen.aliasOf})`}</p>
                <p>{chosen.summary ?? "No description yet."}</p>
                <button type="button" class="tkr-program-insert" disabled={readOnly} onClick={() => insertCommand(chosen)}>Insert {chosen.name}</button>
              </div>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
