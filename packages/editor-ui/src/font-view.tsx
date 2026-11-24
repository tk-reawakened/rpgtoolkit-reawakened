import {
  createEditTracker,
  FONT_PREVIEW_MAX_SIZE,
  FONT_PREVIEW_MAX_TEXT,
  FONT_PREVIEW_MIN_SIZE,
  FONT_PREVIEW_SAMPLE,
  FONT_SLOTS,
  fontCharacterOf,
  fontGlyphRows,
  fontLinePixels,
  fontPixelOf,
  fontRowsAfter,
  fontRowsWithPixel,
  fontSlotName,
  inkedGlyphCount,
  previewFontText,
  type ApplyResult,
  type ConflictChoice,
  type FontPixelChange,
  type FontCommand,
  type FontDocumentSnapshot,
  type PendingEdits,
} from "@tk-reawakened/editor-model";
import type { Capabilities, DocumentEdited } from "@tk-reawakened/platform-services";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ViewDocument } from "./mount.ts";
import { useDocumentSnapshot } from "./use-document.ts";

/** How many views have been given ids (ids must be unique in the page; see `SettingsView`). */
let viewsMade = 0;

const GLYPH_SIDE = 8;
/** The strip is 16 slots wide: slot `n` is in row `n >> 4`, column `n & 15` (T-65). */
const STRIP_COLUMNS = 16;
const ZOOMS = [1, 2, 3, 4] as const;
const DEFAULT_SLOT = 65;

type Tool = "draw" | "erase";

/**
 * What the font view needs beyond the shared surface: the host's own undo and redo, when it has them. A host that leaves
 * them out owns history itself (VS Code's workbench), and the view then shows no Undo or Redo button.
 */
export type FontHistoryOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

export interface FontViewDocument extends ViewDocument<FontDocumentSnapshot, FontCommand> {
  /** The host's own undo and redo. It is the host's stack (VS Code's working copy, the browser workbench's), never a
   * second one here, so the host's dirty state and its own Undo stay in step. */
  undo?(): FontHistoryOutcome | Promise<FontHistoryOutcome>;
  redo?(): FontHistoryOutcome | Promise<FontHistoryOutcome>;
}

export interface FontViewProps {
  readonly doc: FontViewDocument;
  readonly capabilities: Capabilities;
  readonly onEdited: (event: DocumentEdited) => void;
  /** Where edits are reported until the document has answered, so the host's save and close wait for them (#2613). */
  readonly pendingEdits: PendingEdits;
}

/**
 * An unfinished pointer stroke: the glyph's rows as they were when it began, every cell it has passed, the last cell
 * (so a fast move interpolates the cells it jumped over), and the rows it would leave.
 */
interface Stroke {
  readonly pointerId: number;
  readonly glyph: number;
  /** The rows the stroke is drawn over: the glyph's rows when it began, and the rows that arrived under it (rebased). */
  base: readonly number[];
  readonly ink: boolean;
  readonly cells: Map<string, FontPixelChange>;
  lastX: number;
  lastY: number;
  rows: readonly number[];
}

const sameRows = (left: readonly number[], right: readonly number[]): boolean => left.length === right.length && left.every((row, index) => row === right[index]);

/**
 * The bitmap font editor (story 13.20, T-65): a 16 × 16 strip of the 256 character slots, the selected glyph as an 8 × 8
 * grid to draw or erase ink in, and a sample-text preview with bold, italics and underline. The strip and the grid are
 * each one tab stop and move with the arrow keys. A pointer stroke is previewed in the grid and committed when the
 * pointer is released as one edit; a keyboard action is one edit. The slot, tool, sample, size, styles and zoom are
 * view state only: they never reach the document. Only classes and ARIA attributes are used, never a `style` attribute
 * (ADR 0025 decision 6).
 */
export function FontView({ doc, capabilities, onEdited, pendingEdits }: FontViewProps) {
  const snapshot = useDocumentSnapshot(doc);
  const [ids] = useState(() => {
    viewsMade += 1;
    return `tkr-font-${viewsMade}`;
  });
  const submitted = useRef(createEditTracker());
  const queue = useRef(Promise.resolve());
  useEffect(() => pendingEdits.register(submitted.current), [pendingEdits]);

  const [slot, setSlot] = useState(DEFAULT_SLOT);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [tool, setTool] = useState<Tool>("draw");
  const [draft, setDraft] = useState<readonly number[] | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [sample, setSample] = useState(FONT_PREVIEW_SAMPLE);
  const [sizeText, setSizeText] = useState("8");
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [underline, setUnderline] = useState(false);
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(1);
  const [canvasIssue, setCanvasIssue] = useState<string | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const stroke = useRef<Stroke | null>(null);
  const endStroke = useRef<(() => void) | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const focusGrid = useRef(false);
  const focusStrip = useRef(false);

  const readOnly = snapshot.readOnly !== null;
  const conflict = snapshot.conflict;
  const canEdit = !readOnly && conflict === null;
  /** Glyph rows submitted and not yet answered, by character; a render reads them, and `answers` makes the render happen. */
  const inflight = useRef(new Map<number, { rows: readonly number[]; waiting: number }>());
  const [, setAnswers] = useState(0);
  const documentRows = useMemo(() => fontGlyphRows(snapshot.values, slot), [snapshot.values, slot]);
  const savedRows = inflight.current.get(slot)?.rows ?? documentRows;
  const rows = draft ?? savedRows;
  const glyphEmpty = savedRows.every((row) => row === 0);
  const inked = useMemo(() => inkedGlyphCount(snapshot.values), [snapshot.values]);
  const character = fontCharacterOf(slot);

  useEffect(() => {
    if (conflict === null) setDismissed(false);
  }, [conflict]);

  // The sample picture is the font as it is now (saved or not); a size outside the range keeps the last good picture and says why.
  const parsedSize = sizeText.trim() === "" ? Number.NaN : Number(sizeText);
  const sizeProblem = Number.isInteger(parsedSize) && parsedSize >= FONT_PREVIEW_MIN_SIZE && parsedSize <= FONT_PREVIEW_MAX_SIZE
    ? null
    : `The size is a whole number from ${FONT_PREVIEW_MIN_SIZE} to ${FONT_PREVIEW_MAX_SIZE} pixels.`;
  const lastSize = useRef(8);
  if (sizeProblem === null) lastSize.current = parsedSize;
  const size = lastSize.current;
  const picture = useMemo(
    () => previewFontText(snapshot.values, { text: sample, size, bold, italic, underline }),
    [snapshot.values, sample, size, bold, italic, underline],
  );

  useLayoutEffect(() => {
    const target = canvas.current;
    if (!picture.ok || target === null) return;
    if (typeof ImageData === "undefined") {
      setCanvasIssue("This host cannot build pixel buffers, so the sample text cannot be drawn.");
      return;
    }
    const context = target.getContext("2d");
    const source = document.createElement("canvas");
    source.width = picture.width;
    source.height = picture.height;
    const sourceContext = source.getContext("2d");
    if (context === null || sourceContext === null) {
      setCanvasIssue("This host has no 2D canvas, so the sample text cannot be drawn.");
      return;
    }
    sourceContext.putImageData(new ImageData(new Uint8ClampedArray(picture.rgba), picture.width, picture.height), 0, 0);
    // The backing canvas stays 1:1 (a phone refuses a canvas of a few thousand pixels on a side); the zoom is a CSS
    // enlargement with nearest-neighbour sampling, so the squares stay crisp and the picture is still the game's pixels.
    target.width = picture.width;
    target.height = picture.height;
    context.imageSmoothingEnabled = false;
    context.drawImage(source, 0, 0);
    setCanvasIssue(null);
  }, [picture, zoom]);

  useEffect(() => {
    if (focusGrid.current) {
      focusGrid.current = false;
      grid.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
    }
    if (focusStrip.current) {
      focusStrip.current = false;
      strip.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
    }
  });

  const run = (command: FontCommand): Promise<boolean> => {
    const finish = submitted.current.begin();
    // The rows this glyph will have once the queued commands land, built from the document as it is now plus every command
    // still unanswered; a second stroke starts from them, and another view's pixels of the same glyph are never overwritten.
    const pending = inflight.current.get(command.glyph) ?? { rows: fontGlyphRows(doc.getSnapshot().values, command.glyph), waiting: 0 };
    pending.rows = fontRowsAfter(pending.rows, command);
    pending.waiting += 1;
    inflight.current.set(command.glyph, pending);
    setAnswers((count) => count + 1);
    const operation = queue.current.then(async () => {
      try {
        const result: ApplyResult = await doc.apply(command);
        if (!result.ok) {
          setRefusal(result.rejection.message);
          return false;
        }
        setRefusal(null);
        const edit = doc.getSnapshot().edits.find((entry) => entry.editId === result.editId);
        onEdited({ document: doc.identity.key, editId: result.editId, label: edit?.label ?? "Edit the bitmap font" });
        return true;
      } catch (error) {
        setRefusal(error instanceof Error ? error.message : String(error));
        return false;
      } finally {
        pending.waiting -= 1;
        if (pending.waiting <= 0 && inflight.current.get(command.glyph) === pending) inflight.current.delete(command.glyph);
        setAnswers((count) => count + 1);
        finish();
      }
    });
    queue.current = operation.then(() => undefined);
    return operation;
  };
  const latest = useRef({ run, savedRows });
  latest.current = { run, savedRows };

  const cancelStroke = (): void => {
    endStroke.current?.();
    endStroke.current = null;
    if (stroke.current !== null) {
      stroke.current = null;
      setDraft(null);
    }
  };
  // A change that arrives under an unfinished stroke — another view of this glyph, an undo, a reload — is rebased onto:
  // the stroke's cells are applied to the rows that arrived, so the pointer keeps painting and the other view's pixels
  // survive. Only losing the right to edit (read-only, a conflict) drops the stroke.
  useLayoutEffect(() => {
    const current = stroke.current;
    if (current === null) return;
    if (!canEdit) {
      cancelStroke();
      return;
    }
    const incoming = savedRows;
    if (sameRows(current.base, incoming)) return;
    current.base = incoming;
    // Keep intent even for pixels the incoming revision happens to match: another revision may erase them before release.
    current.rows = fontRowsAfter(incoming, { type: "set-font-pixels", glyph: current.glyph, pixels: [...current.cells.values()] });
    setDraft(current.rows);
  }, [savedRows, canEdit]);
  useEffect(() => cancelStroke, []);

  const selectSlot = (next: number, fromKeyboard: boolean): void => {
    cancelStroke();
    setRefusal(null);
    setSlot(Math.max(0, Math.min(FONT_SLOTS - 1, next)));
    setCursor({ x: 0, y: 0 });
    if (fromKeyboard) focusStrip.current = true;
  };

  /** Put the tool's result on one pixel as one edit; a pixel that already is that is not an edit. */
  const toolAt = (x: number, y: number, which: Tool): void => {
    if (!canEdit) return;
    const ink = which === "draw";
    if (fontPixelOf(savedRows, x, y) === ink) return;
    void run({ type: "set-font-pixels", glyph: slot, pixels: [{ x, y, ink }] });
  };

  /** Paint every cell between the stroke's last cell and `(x, y)`, so a fast drag skips none of them. */
  const paint = (x: number, y: number): void => {
    const current = stroke.current;
    if (current === null) return;
    let changed = false;
    for (const cell of fontLinePixels(current.lastX, current.lastY, x, y)) {
      const key = `${cell.x},${cell.y}`;
      if (current.cells.has(key)) continue;
      current.cells.set(key, { x: cell.x, y: cell.y, ink: current.ink });
      changed = true;
    }
    current.lastX = x;
    current.lastY = y;
    if (!changed) return;
    const next = fontRowsAfter(current.base, { type: "set-font-pixels", glyph: current.glyph, pixels: [...current.cells.values()] });
    current.rows = next;
    setDraft(next);
  };

  const beginStroke = (pointerId: number, x: number, y: number): void => {
    stroke.current = { pointerId, glyph: slot, base: savedRows, ink: tool === "draw", cells: new Map(), lastX: x, lastY: y, rows: savedRows };
    setCursor({ x, y });
    setRefusal(null);
    paint(x, y);
    const finish = (commit: boolean): void => {
      const current = stroke.current;
      endStroke.current?.();
      endStroke.current = null;
      stroke.current = null;
      setDraft(null);
      if (commit && current !== null && current.cells.size > 0 && !sameRows(current.rows, current.base)) {
        void latest.current.run({ type: "set-font-pixels", glyph: current.glyph, pixels: [...current.cells.values()] });
      }
    };
    const up = (event: PointerEvent): void => { if (event.pointerId === pointerId) finish(true); };
    const abort = (event: PointerEvent): void => { if (event.pointerId === pointerId) finish(false); };
    const blur = (): void => finish(false);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", abort);
    window.addEventListener("blur", blur);
    endStroke.current = () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", abort);
      window.removeEventListener("blur", blur);
    };
  };

  /**
   * The host's undo or redo. It waits for this view's own queued edits to land first, so an answer that arrives late can
   * never make the host undo an earlier edit than the one the person just made; nothing happens without a host route.
   */
  const history = (direction: "undo" | "redo"): void => {
    const call = direction === "undo" ? doc.undo : doc.redo;
    if (call === undefined) return;
    setRefusal(null);
    const finish = submitted.current.begin();
    const operation = queue.current.then(async () => {
      try {
        const outcome = await call.call(doc);
        if (outcome !== undefined && !outcome.ok) setRefusal(outcome.message);
      } catch (error) {
        setRefusal(error instanceof Error ? error.message : String(error));
      } finally {
        finish();
      }
    });
    queue.current = operation.then(() => undefined);
    void operation;
  };

  const moveCursor = (dx: number, dy: number): void => {
    focusGrid.current = true;
    setCursor({ x: Math.max(0, Math.min(GLYPH_SIDE - 1, cursor.x + dx)), y: Math.max(0, Math.min(GLYPH_SIDE - 1, cursor.y + dy)) });
  };

  const resolve = (choice: ConflictChoice): void => {
    setResolving(true);
    setResolveError(null);
    void Promise.resolve()
      .then(() => doc.resolveConflict(choice))
      .then(async (result) => {
        if (!result.ok) {
          setResolveError(result.message);
          return;
        }
        if (choice === "keep-local" && capabilities.has("conflictAutoSave")) await doc.save().catch(() => undefined);
      })
      .catch((error: unknown) => setResolveError(error instanceof Error ? error.message : String(error)))
      .finally(() => setResolving(false));
  };

  // Undo must reach a stroke the host has not answered yet: it is enabled by this view's own queued edits too, and the
  // host call waits for them (never taking back an earlier edit than the one the person just made).
  const pendingOwn = inflight.current.size > 0;
  const failure = snapshot.saveError;
  const slotRow = slot >> 4;
  const slotColumn = slot & (STRIP_COLUMNS - 1);

  return (
    <section class="tkr-font" aria-label="Bitmap font">
      <div class="tkr-font-header-bar">
        <h2 class="tkr-font-heading">Bitmap font</h2>
        <p class="tkr-font-summary">{FONT_SLOTS} characters, 8 × 8 pixels each; {inked} drawn</p>
      </div>
      {snapshot.readOnly === null ? null : <p class="tkr-font-readonly" role="note">Read only: {snapshot.readOnly.message}</p>}
      {conflict === null ? null : (
        <div class="tkr-font-conflict" role="group" aria-label="Changed on disk">
          <p role="alert">{conflict.message}</p>
          {dismissed ? (
            <button type="button" class="tkr-font-review" onClick={() => setDismissed(false)}>Review conflict</button>
          ) : (
            <>
              <button type="button" class="tkr-font-keep" disabled={resolving || readOnly} onClick={() => resolve("keep-local")}>
                {capabilities.has("conflictAutoSave") ? "Save my version" : "Keep my version"}
              </button>
              {capabilities.has("conflictReload") && conflict.externalTitle !== null ? (
                <button type="button" class="tkr-font-reload" disabled={resolving} onClick={() => resolve("reload")}>Use the version on disk</button>
              ) : null}
              {!capabilities.has("conflictReload") ? (
                <p class="tkr-font-host-note" role="note">This host cannot safely reload the file in place. Both versions remain unchanged.</p>
              ) : null}
              <button type="button" class="tkr-font-cancel" disabled={resolving} onClick={() => setDismissed(true)}>Cancel</button>
            </>
          )}
          {resolveError === null ? null : <p class="tkr-font-error" role="alert">{resolveError}</p>}
        </div>
      )}

      <div class="tkr-font-workspace">
        <div class="tkr-font-strip-panel">
          <p id={`${ids}-strip-help`} class="tkr-font-help">Choose a character. Arrow keys move one slot or one row; Home and End go to the ends of the row; Ctrl+Home and Ctrl+End go to the first and last character.</p>
          <div
            ref={strip}
            class="tkr-font-strip"
            role="grid"
            aria-label="Characters of the font"
            aria-describedby={`${ids}-strip-help`}
            aria-rowcount={FONT_SLOTS / STRIP_COLUMNS}
            aria-colcount={STRIP_COLUMNS}
          >
            {Array.from({ length: FONT_SLOTS / STRIP_COLUMNS }, (_, row) => (
              <div key={row} role="row" aria-rowindex={row + 1}>
                {Array.from({ length: STRIP_COLUMNS }, (_, column) => {
                  const code = row * STRIP_COLUMNS + column;
                  const shown = fontCharacterOf(code);
                  const drawn = fontGlyphRows(snapshot.values, code).some((value) => value !== 0);
                  const slotName = fontSlotName(code);
                  const active = code === slot;
                  return (
                    <div key={code} role="gridcell" aria-colindex={column + 1} aria-selected={active}>
                      <button
                        type="button"
                        class={`tkr-font-slot${active ? " tkr-font-slot-selected" : ""}${drawn ? " tkr-font-slot-drawn" : ""}`}
                        tabIndex={active ? 0 : -1}
                        aria-label={`${slotName.charAt(0).toUpperCase()}${slotName.slice(1)}${drawn ? "" : ", empty"}`}
                        onClick={() => selectSlot(code, false)}
                        onKeyDown={(event) => {
                          if (event.altKey || event.shiftKey) return;
                          const target = event.key === "ArrowLeft" ? code - 1
                            : event.key === "ArrowRight" ? code + 1
                            : event.key === "ArrowUp" ? code - STRIP_COLUMNS
                            : event.key === "ArrowDown" ? code + STRIP_COLUMNS
                            : event.key === "Home" ? (event.ctrlKey || event.metaKey ? 0 : row * STRIP_COLUMNS)
                            : event.key === "End" ? (event.ctrlKey || event.metaKey ? FONT_SLOTS - 1 : row * STRIP_COLUMNS + STRIP_COLUMNS - 1)
                            : null;
                          if (target === null) return;
                          event.preventDefault();
                          if (target >= 0 && target < FONT_SLOTS) selectSlot(target, true);
                        }}
                      >
                        <span class="tkr-font-slot-code">{code}</span>
                        <span class="tkr-font-slot-char" aria-hidden="true">{shown ?? "·"}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div class="tkr-font-glyph-panel">
          <h3 class="tkr-font-glyph-heading">Glyph of {fontSlotName(slot)}</h3>
          <div class="tkr-font-row tkr-font-tools" role="group" aria-label="Tool">
            {(["draw", "erase"] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                class={`tkr-font-tool tkr-font-tool-${entry}`}
                aria-pressed={tool === entry}
                onClick={() => { cancelStroke(); setTool(entry); }}
              >
                {entry === "draw" ? "Draw" : "Erase"}
              </button>
            ))}
            <button type="button" class="tkr-font-clear" disabled={!canEdit || glyphEmpty} onClick={() => { cancelStroke(); void run({ type: "clear-font-glyph", glyph: slot }); }}>
              Clear glyph
            </button>
            {doc.undo === undefined || doc.redo === undefined ? null : (
              <>
                <button type="button" class="tkr-font-undo" aria-keyshortcuts="Control+Z Meta+Z" disabled={(!snapshot.canUndo && !pendingOwn) || !canEdit} onClick={() => history("undo")}>Undo</button>
                <button type="button" class="tkr-font-redo" aria-keyshortcuts="Control+Y Meta+Shift+Z" disabled={(!snapshot.canRedo && !pendingOwn) || !canEdit} onClick={() => history("redo")}>Redo</button>
              </>
            )}
          </div>
          <p id={`${ids}-grid-help`} class="tkr-font-help">Press and drag to draw or erase. From the keyboard, arrow keys move the cursor, Space or Enter uses the tool, Delete erases, and Escape cancels a stroke. Use Ctrl+Z and Ctrl+Y (Cmd+Z and Cmd+Shift+Z on macOS) to undo and redo.</p>
          <div
            ref={grid}
            class="tkr-font-grid"
            role="grid"
            aria-label={`Pixels of ${fontSlotName(slot)}, 8 by 8`}
            aria-describedby={`${ids}-grid-help`}
            aria-rowcount={GLYPH_SIDE}
            aria-colcount={GLYPH_SIDE}
            onPointerMove={(event) => {
              const current = stroke.current;
              if (current === null || current.pointerId !== event.pointerId || typeof document.elementFromPoint !== "function") return;
              const target = document.elementFromPoint(event.clientX, event.clientY);
              const pixel = target instanceof HTMLElement ? target.closest<HTMLElement>("[data-pixel]") : null;
              if (pixel === null || !grid.current?.contains(pixel)) return;
              const [x, y] = (pixel.dataset.pixel ?? "").split(",").map(Number);
              if (x !== undefined && y !== undefined && Number.isInteger(x) && Number.isInteger(y)) paint(x, y);
            }}
          >
            {Array.from({ length: GLYPH_SIDE }, (_, y) => (
              <div key={y} role="row" aria-rowindex={y + 1}>
                {Array.from({ length: GLYPH_SIDE }, (_, x) => {
                  const on = fontPixelOf(rows, x, y);
                  const active = x === cursor.x && y === cursor.y;
                  return (
                    <div key={x} role="gridcell" aria-colindex={x + 1} aria-selected={active}>
                      <button
                        type="button"
                        data-pixel={`${x},${y}`}
                        class={`tkr-font-pixel${on ? " tkr-font-pixel-on" : ""}${active ? " tkr-font-pixel-cursor" : ""}`}
                        tabIndex={active ? 0 : -1}
                        disabled={!canEdit}
                        aria-label={`Column ${x + 1}, row ${y + 1}: ${on ? "ink" : "empty"}`}
                        onPointerDown={(event) => {
                          if (!canEdit || event.button !== 0 || stroke.current !== null) return;
                          // A touch pointer is captured by the cell it landed on; releasing lets the other cells see it move.
                          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                          beginStroke(event.pointerId, x, y);
                        }}
                        onPointerEnter={(event) => {
                          const current = stroke.current;
                          if (current !== null && current.pointerId === event.pointerId) {
                            setCursor({ x, y });
                            paint(x, y);
                          }
                        }}
                        // A pointer press is the stroke above; its click only follows the release. A click with no pointer
                        // (the keyboard's Space or Enter, assistive technology) is the tool used once.
                        onClick={(event) => {
                          if (event.detail !== 0) return;
                          setRefusal(null);
                          setCursor({ x, y });
                          toolAt(x, y, tool);
                        }}
                        onKeyDown={(event) => {
                          // The host owns history; route the key once, after this view's accepted edits.
                          if (!event.defaultPrevented && (event.ctrlKey || event.metaKey) && !event.altKey && (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")) {
                            const redo = event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z");
                            if ((redo ? doc.redo : doc.undo) !== undefined) {
                              event.preventDefault();
                              // VS Code's webview forwards bubbling keys to its workbench even when default is prevented.
                              event.stopPropagation();
                              history(redo ? "redo" : "undo");
                            }
                            return;
                          }
                          if (event.ctrlKey || event.metaKey || event.altKey) return;
                          const step = event.key === "ArrowLeft" ? [-1, 0]
                            : event.key === "ArrowRight" ? [1, 0]
                            : event.key === "ArrowUp" ? [0, -1]
                            : event.key === "ArrowDown" ? [0, 1]
                            : null;
                          if (step !== null) {
                            event.preventDefault();
                            moveCursor(step[0]!, step[1]!);
                          } else if (event.key === "Home" || event.key === "End") {
                            event.preventDefault();
                            focusGrid.current = true;
                            setCursor({ x: event.key === "Home" ? 0 : GLYPH_SIDE - 1, y: cursor.y });
                          } else if (event.key === " " || event.key === "Enter") {
                            // The grid's cursor is the keyboard's position. The browser's own click would act on whichever
                            // pixel still holds focus while the move is being drawn, so the key acts here and no click follows.
                            event.preventDefault();
                            setRefusal(null);
                            toolAt(cursor.x, cursor.y, tool);
                          } else if (event.key === "Delete" || event.key === "Backspace") {
                            event.preventDefault();
                            setRefusal(null);
                            toolAt(cursor.x, cursor.y, "erase");
                          } else if (event.key === "Escape" && stroke.current !== null) {
                            event.preventDefault();
                            cancelStroke();
                          }
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <p class="tkr-font-glyph-note" role="status">
            {character === null ? `Slot ${slot} has no printable character.` : `Slot ${slot} is “${character}”.`} Row {slotRow + 1}, column {slotColumn + 1} of the strip.
          </p>
        </div>

        <div class="tkr-font-preview-panel">
          <h3 class="tkr-font-preview-heading">Sample text</h3>
          <div class="tkr-font-row">
            <label for={`${ids}-sample`}>Sample</label>
            <input
              id={`${ids}-sample`}
              class="tkr-font-sample"
              type="text"
              maxLength={FONT_PREVIEW_MAX_TEXT}
              value={sample}
              onInput={(event) => setSample(event.currentTarget.value)}
            />
          </div>
          <div class="tkr-font-row">
            <label for={`${ids}-size`}>Size in pixels</label>
            <input
              id={`${ids}-size`}
              class="tkr-font-size"
              type="number"
              min={FONT_PREVIEW_MIN_SIZE}
              max={FONT_PREVIEW_MAX_SIZE}
              step={1}
              value={sizeText}
              onInput={(event) => setSizeText(event.currentTarget.value)}
            />
            {([["Bold", bold, setBold], ["Italics", italic, setItalic], ["Underline", underline, setUnderline]] as const).map(([label, value, set]) => (
              <label key={label} class="tkr-font-style">
                <input type="checkbox" checked={value} onChange={(event) => set(event.currentTarget.checked)} />
                {label}
              </label>
            ))}
            <label for={`${ids}-zoom`}>Zoom</label>
            <select id={`${ids}-zoom`} class="tkr-font-zoom" value={String(zoom)} onChange={(event) => setZoom(Number(event.currentTarget.value) as (typeof ZOOMS)[number])}>
              {ZOOMS.map((entry) => <option key={entry} value={String(entry)}>{entry}×</option>)}
            </select>
          </div>
          {sizeProblem === null ? null : <p class="tkr-font-error" role="alert">{sizeProblem} The picture still shows {size} pixels.</p>}
          <div class="tkr-font-picture">
            {picture.ok ? (
              <canvas ref={canvas} class="tkr-font-canvas" data-zoom={String(zoom)} role="img" aria-label="The sample text as the game draws it" hidden={canvasIssue !== null} />
            ) : (
              <p class="tkr-font-preview-state" role="status">No picture: {picture.message}</p>
            )}
          </div>
          {canvasIssue === null ? null : <p class="tkr-font-preview-state" role="status">Picture unavailable: {canvasIssue}</p>}
          {picture.ok && picture.truncated ? <p class="tkr-font-preview-state" role="status">The sample is shown in part: the rest needs a picture larger than this editor draws.</p> : null}
          <p class="tkr-font-help">The sample, size, styles and zoom are only for looking. They are not saved and never change the font.</p>
        </div>
      </div>

      {refusal === null ? null : (
        <p class="tkr-font-error" role="alert">The font was not changed: {refusal}</p>
      )}
      <p id={`${ids}-state`} class="tkr-font-state" role="status">
        {snapshot.saving || savePending ? "Saving…" : snapshot.dirty ? "Unsaved changes" : "All changes saved"}
      </p>
      <button
        type="button"
        data-editor-save="true"
        class="tkr-font-save"
        disabled={readOnly || savePending || snapshot.saving || conflict !== null || !snapshot.dirty}
        onClick={() => {
          setSavePending(true);
          void pendingEdits.settle().then(() => doc.save()).catch(() => undefined).finally(() => setSavePending(false));
        }}
      >
        Save
      </button>
      {failure === null || (failure.kind === "conflict" && conflict !== null) ? null : (
        <p class="tkr-font-error" role="alert">{failure.message}</p>
      )}
    </section>
  );
}
