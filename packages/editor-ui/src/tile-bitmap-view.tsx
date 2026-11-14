import {
  colourOfShade,
  lightnessOfShade,
  shadeOfColour,
  shadeWithLightness,
  tileBitmapCellAt,
  TILE_BITMAP_MAX_TILES,
  TILE_BITMAP_MIN_TILES,
  TILE_SHADE_MAX,
  TILE_SHADE_MIN,
  type ApplyResult,
  type ConflictChoice,
  type SaveFailure,
  type TileBitmapCommand,
  type TileBitmapPicture,
  type TileShade,
} from "@tk-reawakened/editor-model";
import type { Capabilities, DocumentEdited } from "@tk-reawakened/platform-services";
import { useEffect, useRef, useState } from "preact/hooks";
import type { BrowserSelection } from "./brush.ts";
import type { TileBitmapViewDocument } from "./mount.ts";
import { TilesetBrowser, type TilesetBrowserContext } from "./tileset-browser.tsx";
import { useDocumentSnapshot } from "./use-document.ts";

/** How many views have been given ids (ids must be unique in the page; see `SettingsView`). */
let viewsMade = 0;

/** A cell is 32 pixels square in the picture (`docs/spec/formats/tiles.md#tile-bitmap-tbm`). */
const CELL_PIXELS = 32;

type Tool = "select" | "draw" | "erase";

export interface TileBitmapViewProps {
  readonly doc: TileBitmapViewDocument;
  readonly capabilities: Capabilities;
  readonly onEdited: (event: DocumentEdited) => void;
  readonly browser?: TilesetBrowserContext;
}

function cellText(tile: string): string {
  return tile === "" ? "·" : tile;
}

function shadeText(shade: TileShade): string {
  return `${shade.r}, ${shade.g}, ${shade.b}`;
}

/**
 * The tile bitmap editor (story 12.8, T-62): the grid of cells, one selected cell with its shade, the picture the engine
 * composes from the cells with an optional grid, and the shared tileset browser as the tile palette. Choosing a source
 * in the browser changes no bitmap: the Draw tool puts the chosen tile on a cell only when that cell is clicked or
 * activated from the keyboard. Every action is reachable from the keyboard: the grid is one tab stop and moves with the
 * arrow keys. Only classes and ARIA attributes are used, never a `style` attribute (ADR 0025 decision 6).
 */
export function TileBitmapView({ doc, capabilities, onEdited, browser }: TileBitmapViewProps) {
  const snapshot = useDocumentSnapshot(doc);
  const [ids] = useState(() => {
    viewsMade += 1;
    return `tkr-bitmap-${viewsMade}`;
  });
  const [selected, setSelected] = useState({ x: 0, y: 0 });
  const [tool, setTool] = useState<Tool>("select");
  const [tileDraft, setTileDraft] = useState("");
  const [shadeDraft, setShadeDraft] = useState({ r: "0", g: "0", b: "0" });
  const [sizeDraft, setSizeDraft] = useState({ width: "", height: "" });
  const [refusal, setRefusal] = useState<string | null>(null);
  const [picture, setPicture] = useState<TileBitmapPicture | null>(null);
  const [redraws, setRedraws] = useState(0);
  const [showGrid, setShowGrid] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [brush, setBrush] = useState<BrowserSelection | null>(browser?.session.getSnapshot().selection ?? null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const focusCell = useRef(false);
  useEffect(() => browser?.session.subscribe(() => setBrush(browser.session.getSnapshot().selection)) ?? undefined, [browser]);

  const { width, height } = snapshot;
  const readOnly = snapshot.readOnly !== null;
  const conflict = snapshot.conflict;
  const x = Math.min(selected.x, Math.max(0, width - 1));
  const y = Math.min(selected.y, Math.max(0, height - 1));
  const current = tileBitmapCellAt(snapshot, x, y);

  // The fields follow the selected cell, and a change the document made under them (undo, a reload) replaces a draft.
  // A refusal stays until the next action: it is cleared where a person moves or acts, not here.
  // Each field is replaced on its own, and only when it is not mid-edit: a field that still shows what it last showed
  // follows the document (an acknowledged edit, undo, a reload), and a field the person has typed into keeps its text.
  // A field is never replaced because a *different* field's edit was acknowledged. Moving to another cell replaces all.
  const shown = useRef({ x: -1, y: -1, tile: "", r: 0, g: 0, b: 0 });
  useEffect(() => {
    const last = shown.current;
    const next = { x, y, tile: current?.tile ?? "", r: current?.r ?? 0, g: current?.g ?? 0, b: current?.b ?? 0 };
    const moved = last.x !== x || last.y !== y;
    shown.current = next;
    setTileDraft((draft) => (moved || draft === last.tile ? next.tile : draft));
    setShadeDraft((draft) => ({
      r: moved || draft.r === String(last.r) ? String(next.r) : draft.r,
      g: moved || draft.g === String(last.g) ? String(next.g) : draft.g,
      b: moved || draft.b === String(last.b) ? String(next.b) : draft.b,
    }));
  }, [x, y, current?.tile, current?.r, current?.g, current?.b]);
  useEffect(() => setSizeDraft({ width: String(width), height: String(height) }), [width, height]);

  useEffect(() => {
    if (conflict === null) setDismissed(false);
  }, [conflict]);

  // The picture is the document's own composition of the cells as they are now; a newer change replaces an older answer.
  useEffect(() => {
    let live = true;
    void doc.preview().then(
      (next) => { if (live) setPicture(next); },
      (error: unknown) => { if (live) setPicture({ ok: false, message: error instanceof Error ? error.message : String(error) }); },
    );
    return () => { live = false; };
  }, [doc, snapshot.cells, snapshot.width, snapshot.height, redraws]);

  useEffect(() => {
    const target = canvas.current;
    if (picture === null || !picture.ok || target === null || typeof ImageData === "undefined") return;
    const context = target.getContext("2d");
    if (context === null) return;
    target.width = picture.width;
    target.height = picture.height;
    context.putImageData(new ImageData(new Uint8ClampedArray(picture.rgba), picture.width, picture.height), 0, 0);
    if (!showGrid) return;
    context.fillStyle = "rgba(0, 0, 0, 0.7)";
    for (let line = 0; line <= picture.width; line += CELL_PIXELS) context.fillRect(Math.min(line, picture.width - 1), 0, 1, picture.height);
    for (let line = 0; line <= picture.height; line += CELL_PIXELS) context.fillRect(0, Math.min(line, picture.height - 1), picture.width, 1);
  }, [picture, showGrid]);

  useEffect(() => {
    if (!focusCell.current) return;
    focusCell.current = false;
    grid.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  });

  const move = (dx: number, dy: number): void => {
    focusCell.current = true;
    setRefusal(null);
    setSelected({ x: Math.max(0, Math.min(width - 1, x + dx)), y: Math.max(0, Math.min(height - 1, y + dy)) });
  };

  const run = (command: TileBitmapCommand): Promise<boolean> => {
    const failed = (message: string): boolean => {
      setRefusal(message);
      return false;
    };
    const finish = (accepted: ApplyResult): boolean => {
      if (!accepted.ok) return failed(accepted.rejection.message);
      setRefusal(null);
      const edit = doc.getSnapshot().edits.find((entry) => entry.editId === accepted.editId);
      onEdited({ document: doc.identity.key, editId: accepted.editId, label: edit?.label ?? "Edit the tile bitmap" });
      return true;
    };
    try {
      return Promise.resolve(doc.apply(command)).then(finish, (error: unknown) => failed(error instanceof Error ? error.message : String(error)));
    } catch (error) {
      return Promise.resolve(failed(error instanceof Error ? error.message : String(error)));
    }
  };

  /** Apply the current tool to the cell at `(cx, cy)`. A cell that already holds the result is not an error here: the person asked for what is already true. */
  const applyTool = (cx: number, cy: number, which: Tool = tool): void => {
    if (which === "select" || readOnly) return;
    const here = tileBitmapCellAt(snapshot, cx, cy);
    if (which === "erase") {
      if (here !== null && here.tile !== "") void run({ type: "set-bitmap-cell", x: cx, y: cy, tile: "" });
      return;
    }
    if (brush === null) {
      setRefusal("Choose a tile in the tileset browser first.");
    } else if (brush.boardTile === null) {
      setRefusal(brush.stamp === null
        ? `${brush.label} is not a single tile, so it cannot be drawn on a cell.`
        : `${brush.label} is a whole stamp, not a single tile. Choose one tile in the tileset browser to draw with.`);
    } else if (here === null || here.tile !== brush.boardTile) {
      void run({ type: "set-bitmap-cell", x: cx, y: cy, tile: brush.boardTile });
    }
  };

  // The shade the next shade edit starts from: the latest one sent for this cell while an earlier edit is still waiting
  // for the host's answer (so a second channel's edit never undoes the first), otherwise what the document shows.
  const sent = useRef<{ x: number; y: number; shade: TileShade; waiting: number } | null>(null);
  const baseShade = (): TileShade => (sent.current !== null && sent.current.x === x && sent.current.y === y ? sent.current.shade : shade);
  const commitShade = (next: TileShade): void => {
    const base = baseShade();
    if (current === null || (next.r === base.r && next.g === base.g && next.b === base.b)) return;
    const waiting = sent.current !== null && sent.current.x === x && sent.current.y === y ? sent.current.waiting + 1 : 1;
    sent.current = { x, y, shade: next, waiting };
    const mine = sent.current;
    void run({ type: "set-bitmap-shade", x, y, r: next.r, g: next.g, b: next.b }).finally(() => {
      mine.waiting -= 1;
      if (mine.waiting <= 0 && sent.current === mine) sent.current = null;
    });
  };
  /** Send the edit of one channel from its field's text, leaving the other two channels as they are. */
  const commitChannel = (channel: "r" | "g" | "b"): void => {
    const text = shadeDraft[channel];
    const value = text.trim() === "" ? Number.NaN : Number(text);
    if (!Number.isFinite(value)) {
      setRefusal(`Each shade is a number from ${TILE_SHADE_MIN} to ${TILE_SHADE_MAX}.`);
      return;
    }
    commitShade({ ...baseShade(), [channel]: value });
  };
  const commitSize = (): void => {
    const next = { width: Number(sizeDraft.width), height: Number(sizeDraft.height) };
    if (sizeDraft.width.trim() === "" || sizeDraft.height.trim() === "") {
      setRefusal(`A tile bitmap is ${TILE_BITMAP_MIN_TILES} to ${TILE_BITMAP_MAX_TILES} tiles wide and high, in whole tiles.`);
    } else if (next.width !== width || next.height !== height) {
      void run({ type: "set-bitmap-size", ...next });
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

  const failure: SaveFailure | null = snapshot.saveError;
  const shade: TileShade = { r: current?.r ?? 0, g: current?.g ?? 0, b: current?.b ?? 0 };
  const editable = !readOnly && current !== null;
  const brushText = brush === null
    ? "No brush chosen. Choose a tile in the tileset browser."
    : brush.boardTile !== null
      ? `Brush: ${brush.label}`
      : brush.stamp !== null
        ? `A whole stamp (${brush.stamp.width} × ${brush.stamp.height} tiles) is chosen. Draw needs a single tile.`
        : `${brush.label} is chosen, but it is not a single tile.`;

  return (
    <section class="tkr-bitmap" aria-label="Tile bitmap">
      <h2 class="tkr-bitmap-heading">Tile bitmap</h2>
      <p class="tkr-bitmap-summary">
        {width} × {height} tiles, {width * CELL_PIXELS} × {height * CELL_PIXELS} pixels
      </p>
      {snapshot.readOnly === null ? null : <p class="tkr-bitmap-readonly" role="note">Read only: {snapshot.readOnly.message}</p>}
      {capabilities.has("fileWatch") ? null : (
        <p class="tkr-bitmap-host-note">
          This host cannot watch files, so a change another program makes to this file is found when you save, and is never saved over.
        </p>
      )}
      {conflict === null ? null : (
        <div class="tkr-bitmap-conflict" role="group" aria-label="Changed on disk">
          <p role="alert">{conflict.message}</p>
          {dismissed ? (
            <button type="button" class="tkr-bitmap-review" onClick={() => setDismissed(false)}>Review conflict</button>
          ) : (
            <>
              <button type="button" class="tkr-bitmap-keep" disabled={resolving || readOnly} onClick={() => resolve("keep-local")}>
                {capabilities.has("conflictAutoSave") ? "Save my version" : "Keep my version"}
              </button>
              {capabilities.has("conflictReload") && conflict.externalTitle !== null ? (
                <button type="button" class="tkr-bitmap-reload" disabled={resolving} onClick={() => resolve("reload")}>Use the version on disk</button>
              ) : null}
              {!capabilities.has("conflictReload") ? (
                <p class="tkr-bitmap-host-note" role="note">This host cannot safely reload the file in place. Both versions remain unchanged.</p>
              ) : null}
              <button type="button" class="tkr-bitmap-cancel" disabled={resolving} onClick={() => setDismissed(true)}>Cancel</button>
            </>
          )}
          {resolveError === null ? null : <p class="tkr-bitmap-error">{resolveError}</p>}
        </div>
      )}

      <div class="tkr-bitmap-row">
        <label for={`${ids}-width`}>Width in tiles</label>
        <input
          id={`${ids}-width`}
          class="tkr-bitmap-width"
          type="number"
          min={TILE_BITMAP_MIN_TILES}
          max={TILE_BITMAP_MAX_TILES}
          step={1}
          value={sizeDraft.width}
          readOnly={readOnly}
          onInput={(event) => setSizeDraft({ ...sizeDraft, width: event.currentTarget.value })}
          onChange={commitSize}
          onKeyDown={(event) => { if (event.key === "Enter") commitSize(); }}
        />
        <label for={`${ids}-height`}>Height in tiles</label>
        <input
          id={`${ids}-height`}
          class="tkr-bitmap-height"
          type="number"
          min={TILE_BITMAP_MIN_TILES}
          max={TILE_BITMAP_MAX_TILES}
          step={1}
          value={sizeDraft.height}
          readOnly={readOnly}
          onInput={(event) => setSizeDraft({ ...sizeDraft, height: event.currentTarget.value })}
          onChange={commitSize}
          onKeyDown={(event) => { if (event.key === "Enter") commitSize(); }}
        />
      </div>

      <div class="tkr-bitmap-row tkr-bitmap-tools" role="group" aria-label="Tool">
        {(["select", "draw", "erase"] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            class={`tkr-bitmap-tool tkr-bitmap-tool-${entry}`}
            aria-pressed={tool === entry}
            onClick={() => setTool(entry)}
          >
            {entry === "select" ? "Select" : entry === "draw" ? "Draw" : "Erase"}
          </button>
        ))}
        <span class="tkr-bitmap-brush" role="status">{brushText}</span>
      </div>

      {width === 0 || height === 0 ? (
        <p class="tkr-bitmap-empty">This tile bitmap has no cells. Give it a width and height to start drawing.</p>
      ) : (
        <div
          ref={grid}
          class="tkr-bitmap-grid"
          role="grid"
          aria-label="Tiles of the bitmap"
          aria-rowcount={height}
          aria-colcount={width}
        >
          {Array.from({ length: height }, (_, row) => (
            <div key={row} role="row" aria-rowindex={row + 1}>
              {Array.from({ length: width }, (_, column) => {
                const here = tileBitmapCellAt(snapshot, column, row);
                const active = column === x && row === y;
                const shaded = here !== null && (here.r !== 0 || here.g !== 0 || here.b !== 0);
                return (
                  <div key={column} role="gridcell" aria-colindex={column + 1} aria-selected={active}>
                    <button
                      type="button"
                      class={`tkr-bitmap-cell${active ? " tkr-bitmap-cell-selected" : ""}${shaded ? " tkr-bitmap-cell-shaded" : ""}`}
                      tabIndex={active ? 0 : -1}
                      aria-label={`Column ${column + 1}, row ${row + 1}: ${here === null || here.tile === "" ? "empty" : here.tile}${here !== null && shaded ? `, shade ${shadeText(here)}` : ""}`}
                      onClick={() => {
                        setRefusal(null);
                        setSelected({ x: column, y: row });
                        applyTool(column, row);
                      }}
                      onKeyDown={(event) => {
                        const step = event.key === "ArrowLeft" ? [-1, 0] : event.key === "ArrowRight" ? [1, 0] : event.key === "ArrowUp" ? [0, -1] : event.key === "ArrowDown" ? [0, 1] : null;
                        if (step !== null) {
                          event.preventDefault();
                          move(step[0]!, step[1]!);
                        } else if (event.key === "Delete" || event.key === "Backspace") {
                          event.preventDefault();
                          applyTool(column, row, "erase");
                        }
                      }}
                    >
                      {cellText(here?.tile ?? "")}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <div class="tkr-bitmap-row">
        <label for={`${ids}-tile`}>
          Tile for column {x + 1}, row {y + 1}
        </label>
        <input
          id={`${ids}-tile`}
          class="tkr-bitmap-tile"
          type="text"
          value={tileDraft}
          readOnly={!editable}
          onInput={(event) => setTileDraft(event.currentTarget.value)}
          onChange={() => { if (tileDraft !== (current?.tile ?? "")) void run({ type: "set-bitmap-cell", x, y, tile: tileDraft }); }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && tileDraft !== (current?.tile ?? "")) void run({ type: "set-bitmap-cell", x, y, tile: tileDraft });
          }}
        />
      </div>

      <fieldset class="tkr-bitmap-shading" disabled={!editable}>
        <legend>Shading for column {x + 1}, row {y + 1}</legend>
        {(["r", "g", "b"] as const).map((channel) => (
          <span key={channel} class="tkr-bitmap-channel">
            <label for={`${ids}-shade-${channel}`}>{channel === "r" ? "Red" : channel === "g" ? "Green" : "Blue"}</label>
            <input
              id={`${ids}-shade-${channel}`}
              class={`tkr-bitmap-shade tkr-bitmap-shade-${channel}`}
              type="number"
              min={TILE_SHADE_MIN}
              max={TILE_SHADE_MAX}
              step={1}
              value={shadeDraft[channel]}
              onInput={(event) => {
                const text = event.currentTarget.value;
                setShadeDraft((draft) => ({ ...draft, [channel]: text }));
              }}
              onChange={() => commitChannel(channel)}
              onKeyDown={(event) => { if (event.key === "Enter") commitChannel(channel); }}
            />
          </span>
        ))}
        <span class="tkr-bitmap-channel">
          <label for={`${ids}-hue`}>Hue picker</label>
          <input
            id={`${ids}-hue`}
            class="tkr-bitmap-hue"
            type="color"
            value={colourOfShade(shade)}
            onChange={(event) => {
              const picked = shadeOfColour(event.currentTarget.value);
              if (picked !== null) commitShade(picked);
            }}
          />
        </span>
        <span class="tkr-bitmap-channel">
          <label for={`${ids}-lightness`}>Lightness</label>
          <input
            id={`${ids}-lightness`}
            class="tkr-bitmap-lightness"
            type="range"
            min={TILE_SHADE_MIN}
            max={TILE_SHADE_MAX}
            step={1}
            value={lightnessOfShade(shade)}
            onChange={(event) => commitShade(shadeWithLightness(baseShade(), Number(event.currentTarget.value)))}
          />
        </span>
        <button type="button" class="tkr-bitmap-shade-reset" disabled={shade.r === 0 && shade.g === 0 && shade.b === 0} onClick={() => commitShade({ r: 0, g: 0, b: 0 })}>
          Remove shade
        </button>
      </fieldset>
      {refusal === null ? null : (
        <p class="tkr-bitmap-error" role="alert">
          The tile bitmap was not changed: {refusal}
        </p>
      )}

      <div class="tkr-bitmap-picture">
        <div class="tkr-bitmap-row">
          <label class="tkr-bitmap-grid-switch">
            <input type="checkbox" checked={showGrid} onChange={(event) => setShowGrid(event.currentTarget.checked)} />
            Show grid
          </label>
          <button type="button" class="tkr-bitmap-redraw" onClick={() => setRedraws(redraws + 1)}>Redraw</button>
        </div>
        {picture === null ? (
          <p class="tkr-bitmap-preview-state" role="status">Drawing the tile bitmap…</p>
        ) : picture.ok ? (
          <>
            <canvas ref={canvas} class="tkr-bitmap-canvas" role="img" aria-label="The tile bitmap as the engine draws it" />
            {picture.warnings.length === 0 ? null : (
              <ul class="tkr-bitmap-warnings" aria-label="Files the picture could not use">
                {picture.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            )}
          </>
        ) : (
          <p class="tkr-bitmap-preview-state" role="status">No picture: {picture.message}</p>
        )}
      </div>

      <p id={`${ids}-state`} class="tkr-bitmap-state" role="status">
        {snapshot.saving || savePending ? "Saving…" : snapshot.dirty ? "Unsaved changes" : "All changes saved"}
      </p>
      <button
        type="button"
        class="tkr-bitmap-save"
        disabled={readOnly || savePending || snapshot.saving || conflict !== null || !snapshot.dirty}
        onClick={() => {
          setSavePending(true);
          void doc.save().catch(() => undefined).finally(() => setSavePending(false));
        }}
      >
        Save
      </button>
      {failure === null || (failure.kind === "conflict" && conflict !== null) ? null : (
        <p class="tkr-bitmap-error" role="alert">{failure.message}</p>
      )}
      {browser === undefined ? null : <TilesetBrowser context={browser} />}
    </section>
  );
}
