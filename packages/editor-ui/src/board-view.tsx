import { boardTileAt, type ApplyResult, type BoardPicture, type ConflictChoice, type SaveFailure } from "@tk-reawakened/editor-model";
import type { Capabilities, DocumentEdited } from "@tk-reawakened/platform-services";
import { useEffect, useRef, useState } from "preact/hooks";
import { getBrowserSelection, subscribeBrowserSelection, type BrowserSelection } from "./brush.ts";
import type { BoardViewDocument } from "./mount.ts";
import { useDocumentSnapshot } from "./use-document.ts";

/** How many views have been given ids (ids must be unique in the page; see `SettingsView`). */
let viewsMade = 0;

/** The cells shown across and down at once; a larger board scrolls the window with the selection (ARIA `rowindex`/`colindex` name each cell's place). */
const WINDOW = 16;

export interface BoardViewProps {
  readonly doc: BoardViewDocument;
  readonly capabilities: Capabilities;
  readonly onEdited: (event: DocumentEdited) => void;
}

/** The text on a cell: the tile's own name without its folder, `·` for the empty cell. */
function cellText(tile: string | null): string {
  return tile === null || tile === "" ? "·" : tile;
}

/**
 * The board view of the first P0 tracer (story 12.1): a picture of the board as the engine draws it, a tile grid, a tile
 * field, and the retained-context brush from story 12.2. Choosing a brush changes no document; the explicit paint action
 * applies it to one cell of this board. Every action is reachable from the keyboard: the grid is one tab stop and moves
 * with the arrow keys, and Enter on a cell goes to the tile field.
 * Only classes and ARIA attributes are used, never a `style` attribute (ADR 0025 decision 6).
 */
export function BoardView({ doc, capabilities, onEdited }: BoardViewProps) {
  const snapshot = useDocumentSnapshot(doc);
  const [ids] = useState(() => {
    viewsMade += 1;
    return `tkr-board-${viewsMade}`;
  });
  const [layer, setLayer] = useState(0);
  const [selected, setSelected] = useState({ x: 0, y: 0 });
  const [draft, setDraft] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [picture, setPicture] = useState<BoardPicture | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [brush, setBrush] = useState<BrowserSelection | null>(getBrowserSelection());
  const canvas = useRef<HTMLCanvasElement>(null);
  const tileField = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const focusCell = useRef(false);
  useEffect(() => subscribeBrowserSelection(() => setBrush(getBrowserSelection())), []);

  const { grid: size, layers } = snapshot;
  const readOnly = snapshot.readOnly !== null;
  const conflict = snapshot.conflict;
  const currentLayer = Math.min(layer, Math.max(0, layers - 1));
  const x = Math.min(selected.x, Math.max(0, size.width - 1));
  const y = Math.min(selected.y, Math.max(0, size.height - 1));
  const tile = boardTileAt(snapshot, currentLayer, x, y);

  // The text field follows the selected cell, and a change the document made under it (undo, a reload) replaces a draft.
  useEffect(() => {
    setDraft(tile ?? "");
    setRefusal(null);
  }, [currentLayer, x, y, tile]);

  useEffect(() => {
    if (conflict === null) setDismissed(false);
  }, [conflict]);

  // The picture is the document's own composition of the board as it is now; a newer change replaces an older answer.
  useEffect(() => {
    let current = true;
    void doc.preview().then(
      (next) => { if (current) setPicture(next); },
      (error: unknown) => { if (current) setPicture({ ok: false, message: error instanceof Error ? error.message : String(error) }); },
    );
    return () => { current = false; };
  }, [doc, snapshot.tileMatrix, snapshot.lut]);

  useEffect(() => {
    const target = canvas.current;
    if (picture === null || !picture.ok || target === null || typeof ImageData === "undefined") return;
    const context = target.getContext("2d");
    if (context === null) return;
    target.width = picture.width;
    target.height = picture.height;
    context.putImageData(new ImageData(new Uint8ClampedArray(picture.rgba), picture.width, picture.height), 0, 0);
  }, [picture]);

  useEffect(() => {
    if (!focusCell.current) return;
    focusCell.current = false;
    grid.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  });

  const move = (dx: number, dy: number): void => {
    focusCell.current = true;
    setSelected({ x: Math.max(0, Math.min(size.width - 1, x + dx)), y: Math.max(0, Math.min(size.height - 1, y + dy)) });
  };

  const put = (tileToPut = draft): Promise<boolean> => {
    if (tileToPut === tile) return Promise.resolve(true);
    const failed = (message: string): boolean => {
      setRefusal(message);
      return false;
    };
    const finish = (accepted: ApplyResult): boolean => {
      if (!accepted.ok) return failed(accepted.rejection.message);
      setRefusal(null);
      const edit = doc.getSnapshot().edits.find((entry) => entry.editId === accepted.editId);
      onEdited({ document: doc.identity.key, editId: accepted.editId, label: edit?.label ?? "Put a tile" });
      return true;
    };
    try {
      return Promise.resolve(doc.apply({ type: "set-tile", layer: currentLayer, x, y, tile: tileToPut })).then(finish, (error: unknown) =>
        failed(error instanceof Error ? error.message : String(error)));
    } catch (error) {
      return Promise.resolve(failed(error instanceof Error ? error.message : String(error)));
    }
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

  const originX = Math.max(0, Math.min(x - Math.floor(WINDOW / 2), size.width - WINDOW));
  const originY = Math.max(0, Math.min(y - Math.floor(WINDOW / 2), size.height - WINDOW));
  const columns = Math.min(WINDOW, size.width);
  const rows = Math.min(WINDOW, size.height);
  const title = snapshot.layerTitles[currentLayer] ?? "";
  const failure: SaveFailure | null = snapshot.saveError;

  return (
    <section class="tkr-board" aria-label="Board">
      <h2 class="tkr-board-heading">Board</h2>
      <p class="tkr-board-summary">
        {size.width} × {size.height} cells, {layers} {layers === 1 ? "layer" : "layers"}
        {snapshot.coordType === 0 ? "" : ", isometric"}
      </p>
      {snapshot.readOnly === null ? null : <p class="tkr-board-readonly" role="note">Read only: {snapshot.readOnly.message}</p>}
      {capabilities.has("fileWatch") ? null : (
        <p class="tkr-board-host-note">
          This host cannot watch files, so a change another program makes to this file is found when you save, and is never saved over.
        </p>
      )}
      {conflict === null ? null : (
        <div class="tkr-board-conflict" role="group" aria-label="Changed on disk">
          <p role="alert">{conflict.message}</p>
          {dismissed ? (
            <button type="button" class="tkr-board-review" onClick={() => setDismissed(false)}>Review conflict</button>
          ) : (
            <>
              <button type="button" class="tkr-board-keep" disabled={resolving || readOnly} onClick={() => resolve("keep-local")}>
                {capabilities.has("conflictAutoSave") ? "Save my version" : "Keep my version"}
              </button>
              {capabilities.has("conflictReload") && conflict.externalTitle !== null ? (
                <button type="button" class="tkr-board-reload" disabled={resolving} onClick={() => resolve("reload")}>Use the version on disk</button>
              ) : null}
              {!capabilities.has("conflictReload") ? (
                <p class="tkr-board-host-note" role="note">This host cannot safely reload the file in place. Both versions remain unchanged.</p>
              ) : null}
              <button type="button" class="tkr-board-cancel" disabled={resolving} onClick={() => setDismissed(true)}>Cancel</button>
            </>
          )}
          {resolveError === null ? null : <p class="tkr-board-error">{resolveError}</p>}
        </div>
      )}
      {layers > 1 ? (
        <div class="tkr-board-row">
          <label for={`${ids}-layer`}>Layer</label>
          <select id={`${ids}-layer`} value={String(currentLayer)} onChange={(event) => setLayer(Number(event.currentTarget.value))}>
            {Array.from({ length: layers }, (_, index) => (
              <option key={index} value={String(index)}>
                {index + 1}
                {snapshot.layerTitles[index] ? ` – ${snapshot.layerTitles[index]}` : ""}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div class="tkr-board-picture">
        {picture === null ? (
          <p class="tkr-board-preview-state" role="status">Drawing the board…</p>
        ) : picture.ok ? (
          <>
            <canvas ref={canvas} class="tkr-board-canvas" role="img" aria-label="The board as the engine draws it" />
            {picture.warnings.length === 0 ? null : (
              <ul class="tkr-board-warnings" aria-label="Files the picture could not use">
                {picture.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            )}
          </>
        ) : (
          <p class="tkr-board-preview-state" role="status">No picture: {picture.message}</p>
        )}
      </div>
      {size.width === 0 || size.height === 0 || layers === 0 ? (
        <p class="tkr-board-empty">This board has no cells.</p>
      ) : (
        <div
          ref={grid}
          class="tkr-board-grid"
          role="grid"
          aria-label={`Tiles on layer ${currentLayer + 1}${title === "" ? "" : `, ${title}`}`}
          aria-rowcount={size.height}
          aria-colcount={size.width}
        >
          {Array.from({ length: rows }, (_, row) => (
            <div key={row} role="row" aria-rowindex={originY + row + 1}>
              {Array.from({ length: columns }, (_, column) => {
                const cx = originX + column;
                const cy = originY + row;
                const here = boardTileAt(snapshot, currentLayer, cx, cy);
                const active = cx === x && cy === y;
                return (
                  <div key={column} role="gridcell" aria-colindex={cx + 1} aria-selected={active}>
                    <button
                      type="button"
                      class={active ? "tkr-board-cell tkr-board-cell-selected" : "tkr-board-cell"}
                      tabIndex={active ? 0 : -1}
                      aria-label={`Column ${cx + 1}, row ${cy + 1}: ${here === null || here === "" ? "empty" : here}`}
                      onClick={() => setSelected({ x: cx, y: cy })}
                      onKeyDown={(event) => {
                        const step = event.key === "ArrowLeft" ? [-1, 0] : event.key === "ArrowRight" ? [1, 0] : event.key === "ArrowUp" ? [0, -1] : event.key === "ArrowDown" ? [0, 1] : null;
                        if (step !== null) {
                          event.preventDefault();
                          move(step[0]!, step[1]!);
                        } else if (event.key === "Enter") {
                          event.preventDefault();
                          tileField.current?.focus();
                        }
                      }}
                    >
                      {cellText(here)}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      <div class="tkr-board-row">
        <label for={`${ids}-tile`}>
          Tile for column {x + 1}, row {y + 1}
        </label>
        <input
          id={`${ids}-tile`}
          ref={tileField}
          type="text"
          value={draft}
          readOnly={readOnly || layers === 0}
          aria-describedby={`${ids}-state${refusal === null ? "" : ` ${ids}-error`}`}
          aria-invalid={refusal === null ? undefined : true}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onChange={() => { void put(); }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void put();
          }}
        />
      <button
        type="button"
        class="tkr-board-brush"
        disabled={readOnly || layers === 0 || brush === null || brush.boardTile === null}
        onClick={() => { if (brush !== null && brush.boardTile !== null) void put(brush.boardTile); }}
      >
        {brush?.boardTile === null || brush === null ? "No board brush selected" : `Paint ${brush.label} here`}
      </button>
      <p class="tkr-board-brush-note" role="note">Choosing a brush only changes the retained selection. This action paints one cell on this board only.</p>
      </div>
      {refusal === null ? null : (
        <p id={`${ids}-error`} class="tkr-board-error" role="alert">
          The tile was not changed: {refusal}
        </p>
      )}
      <p id={`${ids}-state`} class="tkr-board-state" role="status">
        {snapshot.saving || savePending ? "Saving…" : snapshot.dirty ? "Unsaved changes" : "All changes saved"}
      </p>
      <button
        type="button"
        class="tkr-board-save"
        disabled={readOnly || savePending || snapshot.saving || conflict !== null || !snapshot.dirty}
        onClick={() => {
          setSavePending(true);
          void doc.save().catch(() => undefined).finally(() => setSavePending(false));
        }}
      >
        Save
      </button>
      {failure === null || (failure.kind === "conflict" && conflict !== null) ? null : (
        <p class="tkr-board-error" role="alert">{failure.message}</p>
      )}
    </section>
  );
}
