import type { Colorref } from "@tk-reawakened/core";
import {
    BOARD_TOOLS,
    DEFAULT_EDITOR_PREFERENCES,
    ZOOM_STEPS,
    boardTileAt,
    cellOnBoard,
    createBoardEditor,
    createDocumentIdentity,
    createEditTracker,
    referencePath,
    stampFromBitmap,
    tileBasePoint,
    tileSourceOf,
    zoomOf,
    type ApplyResult,
    type BoardEditor,
    type BoardEditorState,
    type BoardPicture,
    type BoardTool,
    type Brush,
    type ConflictChoice,
    type PendingEdits,
    type SaveFailure,
    type Stamp
} from "@tk-reawakened/editor-model";
import type { Capabilities, DocumentEdited } from "@tk-reawakened/platform-services";
import { useEffect, useRef, useState } from "preact/hooks";
import { BoardCanvas } from "./board-canvas.tsx";
import { BoardObjectsView, type BoardObjectsNavigation } from "./board-objects-view.tsx";
import { BoardPropertiesView, type BoardPropertiesNavigation } from "./board-properties-view.tsx";
import type { BrowserSelection } from "./brush.ts";
import type { CharacterAuthoringViewProps } from "./character-authoring-view.tsx";
import { IconAction } from "./icon-action.tsx";
import type { BoardPreferencesSource, BoardViewDocument } from "./mount.ts";
import type { TilesetBrowserContext } from "./tileset-browser.tsx";
import { TilesetBrowser } from "./tileset-browser.tsx";
import { useDocumentSnapshot } from "./use-document.ts";

/** How many views have been given ids (ids must be unique in the page; see `SettingsView`). */
let viewsMade = 0;

/** The cells shown across and down at once in the grid; a larger board scrolls the window with the cursor (ARIA `rowindex`/`colindex` name each cell's place). */
const WINDOW = 16;

export interface BoardViewProps {
  readonly doc: BoardViewDocument;
  readonly capabilities: Capabilities;
  readonly onEdited: (event: DocumentEdited) => void;
  readonly browser?: TilesetBrowserContext;
  readonly preferences?: BoardPreferencesSource;
  readonly navigation?: BoardPropertiesNavigation & Pick<CharacterAuthoringViewProps, "pickAsset">;
  readonly pendingEdits: PendingEdits;
}

const TOOL_LABELS: Readonly<Record<BoardTool, { readonly label: string; readonly key: string }>> = {
  draw: { label: "Draw", key: "D" },
  select: { label: "Select", key: "S" },
  flood: { label: "Flood fill", key: "F" },
  erase: { label: "Erase", key: "E" },
  rectangle: { label: "Rectangle", key: "R" },
  dropper: { label: "Dropper", key: "I" },
  scroll: { label: "Scroll", key: "H" },
  zoom: { label: "Zoom", key: "Z" },
};

const KEY_TOOLS = new Map<string, BoardTool>(BOARD_TOOLS.map((tool) => [TOOL_LABELS[tool].key.toLowerCase(), tool]));

/** The text on a cell: the tile's own name without its folder, `·` for the empty cell. */
function cellText(tile: string | null): string {
  return tile === null || tile === "" ? "·" : tile;
}

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA" || target.isContentEditable);
}

/** The brush the retained selection makes: a tile or animation, or a loaded tile bitmap stamp. */
function brushFor(selection: BrowserSelection | null, stamp: { readonly path: string; readonly value: Stamp } | null): Brush | null {
  if (selection === null) return null;
  if (selection.boardTile !== null) return { kind: "tile", tile: selection.boardTile, label: selection.label };
  if (selection.kind === "bitmaps" && stamp !== null && stamp.path === selection.path) return { kind: "stamp", stamp: stamp.value };
  return null;
}

/**
 * The board view (stories 12.1, 12.2 and 12.10): the engine's picture of the board on a canvas that pans and zooms, the
 * tile tools (Draw, Select, Flood fill, Erase, Rectangle, Dropper, Scroll, Zoom), layer visibility, undo and redo, a tile
 * grid, a tile field, and the retained brush of the shared tileset browser. Choosing a brush, selecting, panning, zooming
 * and showing or hiding layers change no document; only a finished tile gesture is an edit, and one gesture is one edit.
 * Every action is reachable from the keyboard: the grid is one tab stop that moves with the arrow keys, Space applies the
 * tool at the cell, Enter goes to the tile field, and the tools have single-key shortcuts.
 * Only classes and ARIA attributes are used, never a `style` attribute (ADR 0025 decision 6).
 */
export function BoardView({ doc, capabilities, onEdited, browser, preferences, navigation, pendingEdits }: BoardViewProps) {
  const snapshot = useDocumentSnapshot(doc);
  const [ids] = useState(() => {
    viewsMade += 1;
    return `tkr-board-${viewsMade}`;
  });
  const [draft, setDraft] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [picture, setPicture] = useState<BoardPicture | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [brushSelection, setBrushSelection] = useState<BrowserSelection | null>(browser?.session.getSnapshot().selection ?? null);
  const [stamp, setStamp] = useState<{ readonly path: string; readonly value: Stamp } | null>(null);
  const [stampError, setStampError] = useState<string | null>(null);
  const [historyNote, setHistoryNote] = useState<string | null>(null);
  const [moveBy, setMoveBy] = useState({ columns: "1", rows: "0" });
  const [pickingStart, setPickingStart] = useState(false);
  const [startMessage, setStartMessage] = useState<string | null>(null);
  const [colourPicker, setColourPicker] = useState<((colour: Colorref) => void) | null>(null);
  const pictureRef = useRef(picture);
  pictureRef.current = picture;
  const [canvasEdits] = useState(() => createEditTracker());
  useEffect(() => pendingEdits.register(canvasEdits), [pendingEdits]);
  const tileField = useRef<HTMLInputElement>(null);
  const [startEdit] = useState(() => createEditTracker());
  useEffect(() => pendingEdits.register(startEdit), [pendingEdits]);
  const grid = useRef<HTMLDivElement>(null);
  const browserRoot = useRef<HTMLDivElement>(null);
  const focusCell = useRef(false);
  const [, setPreferenceRevision] = useState(0);
  useEffect(() => preferences?.subscribe(() => setPreferenceRevision((value) => value + 1)) ?? undefined, [preferences]);

  // What the editor reads each time it acts is kept in refs, so one editor lives as long as the view.
  const latest = useRef({ snapshot, brush: null as Brush | null, preferences, browser, doc, onEdited });
  const brush = brushFor(brushSelection, stamp);
  latest.current = { snapshot, brush, preferences, browser, doc, onEdited };

  /** Apply a command and tell the host about the edit, once, as the one place that does. A host that answers at once is answered at once. */
  const applyAndReport = (command: Parameters<BoardViewDocument["apply"]>[0]): ApplyResult | Promise<ApplyResult> => {
    const { doc: document, onEdited: report } = latest.current;
    const finish = canvasEdits.begin();
    const settle = (result: ApplyResult): ApplyResult => {
      finish();
      if (result.ok) {
        const edit = document.getSnapshot().edits.find((entry) => entry.editId === result.editId);
        report({ document: document.identity.key, editId: result.editId, label: edit?.label ?? "Edit the board" });
      }
      return result;
    };
    try {
      const result = document.apply(command);
      return result instanceof Promise ? result.then(settle, (error: unknown) => { finish(); throw error; }) : settle(result);
    } catch (error) {
      finish();
      return { ok: false, rejection: { reason: "invalid", message: error instanceof Error ? error.message : String(error) } };
    }
  };
  const setPlayerStart = async (column: number, row: number, layer: number): Promise<boolean> => {
    const current = latest.current.snapshot;
    if (
      !Number.isInteger(column) || !Number.isInteger(row) || !Number.isInteger(layer)
      || column < 1 || column > current.grid.width
      || row < 1 || row > current.grid.height
      || layer < 1 || layer > current.layers || !cellOnBoard(current, column - 1, row - 1)
    ) {
      setStartMessage("Start column, row and layer must name a cell and layer on this board.");
      return false;
    }
    const end = startEdit.begin();
    try {
      const point = tileBasePoint(current, { x: column - 1, y: row - 1 });
      let result: ApplyResult;
      try {
        result = await Promise.resolve(applyAndReport({
          type: "set-board-fields",
          fields: { properties: { ...current.properties, start: { x: point.x, y: point.y, layer } } },
        }));
      } catch (error) {
        setStartMessage(error instanceof Error ? error.message : String(error));
        return false;
      }
      if (result.ok) {
        setPickingStart(false);
        setStartMessage(null);
        return true;
      }
      setStartMessage(result.rejection.message);
      return false;
    } finally {
      end();
    }
  };

  const [editor] = useState<BoardEditor>(() =>
    createBoardEditor({
      board: () => latest.current.snapshot,
      apply: (command) => applyAndReport(command),
      brush: () => latest.current.brush,
      // Read from the source when the gesture happens, so a preference changed since the last render is the one used.
      preferences: () => latest.current.preferences?.get() ?? DEFAULT_EDITOR_PREFERENCES,
      objectBounds: (kind, index) => {
        const current = pictureRef.current;
        return current?.ok ? current.objectBounds.find((bounds) => bounds.kind === kind && bounds.index === index) ?? null : null;
      },
      pickTile: (tile) => {
        const source = tileSourceOf(tile);
        const context = latest.current.browser;
        if (source === null || context === undefined) return false;
        const picked = {
          kind: "tiles" as const,
          path: referencePath(context.layout, "tiles", source.file),
          reference: tile,
          label: source.label,
          boardTile: tile,
          // The shared browser's selection says whether it is a stamp; a tile is not one.
          stamp: null,
        };
        context.session.update({ selection: picked });
        return true;
      },
    }),
  );
  const [editorSource] = useState(() => ({ getSnapshot: () => editor.getState(), subscribe: (listener: () => void) => editor.subscribe(listener) }));
  const state: BoardEditorState = useDocumentSnapshot(editorSource);
  const objectMode = useRef<Exclude<BoardEditorState["mode"], "tiles">>("vectors");
  if (state.mode !== "tiles") objectMode.current = state.mode;

  useEffect(() => browser?.session.subscribe(() => setBrushSelection(browser.session.getSnapshot().selection)) ?? undefined, [browser]);
  useEffect(() => editor.sync(), [editor, snapshot]);
  useEffect(() => { setColourPicker(null); setPickingStart(false); }, [state.mode, state.objectSelection?.index]);

  // A tile bitmap chosen in the browser is read once, and becomes the stamp whole-grid Draw places.
  useEffect(() => {
    setStampError(null);
    const selection = brushSelection;
    if (browser === undefined || selection === null || selection.boardTile !== null || selection.kind !== "bitmaps" || !/\.tbm$/i.test(selection.path)) return;
    let current = true;
    void browser.fs.read(selection.path).then((read) => {
      if (!current) return;
      if (!read.ok) return setStampError(`${selection.path} could not be read: ${read.error.message}`);
      const parsed = stampFromBitmap(read.value, selection.path, selection.label);
      if (!parsed.ok) return setStampError(`${selection.path} is not a tile bitmap this editor reads: ${parsed.error.message}`);
      setStamp({ path: selection.path, value: parsed.value });
    });
    return () => { current = false; };
  }, [browser, brushSelection]);

  const { grid: size, layers } = snapshot;
  const readOnly = snapshot.readOnly !== null;
  const conflict = snapshot.conflict;
  const currentLayer = Math.min(state.layer, Math.max(0, layers - 1));
  const x = Math.min(state.cursor.x, Math.max(0, size.width - 1));
  const y = Math.min(state.cursor.y, Math.max(0, size.height - 1));
  const tile = boardTileAt(snapshot, currentLayer, x, y);
  const request = editor.pictureRequest();
  const requestKey = JSON.stringify(request);

  // The text field follows the cursor cell, and a change the document made under it (undo, a reload) replaces a draft.
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
    void doc.preview(request).then(
      (next) => { if (current) setPicture(next); },
      (error: unknown) => { if (current) setPicture({ ok: false, message: error instanceof Error ? error.message : String(error) }); },
    );
    return () => { current = false; };
  // Object art and visual board data affect composition; region-only edits need no asset work.
  }, [doc, snapshot.tileMatrix, snapshot.lut, snapshot.shadeLayers, snapshot.sprites, snapshot.images, snapshot.properties.backgroundImage, snapshot.properties.backgroundDrawType, snapshot.properties.backgroundColour, snapshot.properties.ambient, requestKey]);

  useEffect(() => {
    if (!focusCell.current) return;
    focusCell.current = false;
    grid.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  });

  const put = (tileToPut = draft): Promise<boolean> => {
    if (tileToPut === tile) return Promise.resolve(true);
    const failed = (message: string): boolean => {
      setRefusal(message);
      return false;
    };
    return Promise.resolve(applyAndReport({ type: "set-tile", layer: currentLayer, x, y, tile: tileToPut })).then(
      (accepted) => {
        if (!accepted.ok) return failed(accepted.rejection.message);
        setRefusal(null);
        return true;
      },
      (error: unknown) => failed(error instanceof Error ? error.message : String(error)),
    );
  };

  const history = (which: "undo" | "redo"): void => {
    const run = which === "undo" ? doc.undo : doc.redo;
    if (run === undefined) return;
    setHistoryNote(null);
    void Promise.resolve(run.call(doc)).then(
      (result) => { if (!result.ok) setHistoryNote(`Nothing to ${which}.`); },
      (error: unknown) => setHistoryNote(error instanceof Error ? error.message : String(error)),
    );
  };
  const canHistory = doc.undo !== undefined && doc.redo !== undefined;

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

  const onShortcut = (event: KeyboardEvent): void => {
    if (typing(event.target) || event.defaultPrevented
      || (event.target instanceof Element && event.target.closest("dialog[open]") !== null)) return;
    const command = event.ctrlKey || event.metaKey;
    if (command && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === "z" && canHistory) {
        event.preventDefault();
        history(event.shiftKey ? "redo" : "undo");
      } else if (key === "y" && canHistory) {
        event.preventDefault();
        history("redo");
      } else if (key === "a") {
        event.preventDefault();
        editor.selectAll();
      }
      return;
    }
    if (event.altKey) return;
    const modeIndex = ["1", "2", "3", "4", "5"].indexOf(event.key);
    if (modeIndex >= 0) {
      event.preventDefault();
      editor.setMode((["tiles", "vectors", "programs", "sprites", "images"] as const)[modeIndex]!);
      return;
    }
    if ((state.mode === "vectors" || state.mode === "programs") && event.key.toLowerCase() === "z" && !event.shiftKey) {
      event.preventDefault();
      void editor.subdivideObject();
      return;
    }
    if ((state.mode === "vectors" || state.mode === "programs") && event.key.toLowerCase() === "x") {
      event.preventDefault();
      editor.resumeObjectPath();
      return;
    }
    if (state.pending?.kind === "object-path" && event.key === "Enter") {
      event.preventDefault();
      void editor.finishObjectPath(event.ctrlKey);
      return;
    }
    const tool = KEY_TOOLS.get(event.key.toLowerCase());
    if (tool !== undefined && !event.shiftKey) {
      event.preventDefault();
      editor.setTool(tool);
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      editor.zoomIn();
    } else if (event.key === "-") {
      event.preventDefault();
      editor.zoomOut();
    } else if (event.key.toLowerCase() === "g") {
      event.preventDefault();
      editor.toggleGrid();
    } else if (event.key === "Escape") {
      if (colourPicker !== null) setColourPicker(null);
      else if (pickingStart) {
        setPickingStart(false);
        setStartMessage(null);
      } else editor.cancel();
    } else if ((event.key === "Delete" || event.key === "Backspace") && (state.selection !== null || state.objectSelection !== null)) {
      event.preventDefault();
      void editor.eraseSelection();
    }
  };

  const originX = Math.max(0, Math.min(x - Math.floor(WINDOW / 2), size.width - WINDOW));
  const originY = Math.max(0, Math.min(y - Math.floor(WINDOW / 2), size.height - WINDOW));
  const columns = Math.min(WINDOW, size.width);
  const rows = Math.min(WINDOW, size.height);
  const title = snapshot.layerTitles[currentLayer + 1] ?? "";
  const failure: SaveFailure | null = snapshot.saveError;
  const selection = state.selection;
  const pending = state.pending;
  const zoomPercent = zoomOf(state.viewport) * 100;
  const brushText = brush === null
    ? stampError !== null ? stampError : "No brush chosen. Choose a tile, an animated tile or a tile bitmap in the tileset browser."
    : brush.kind === "tile" ? `Brush: ${brush.label}` : `Stamp: ${brush.stamp.name}, ${brush.stamp.width} × ${brush.stamp.height} cells`;
  const startLocationDisplay = preferences?.get().startLocationDisplay ?? DEFAULT_EDITOR_PREFERENCES.startLocationDisplay;
  const startMarker = startLocationDisplay === "every" || (navigation?.initialBoardPath !== undefined && createDocumentIdentity(doc.identity.projectId, navigation.initialBoardPath).key === doc.identity.key) ? snapshot.properties.start : null;
  const pick = navigation?.pickAsset;
  const open = navigation?.open;
  const objectNavigation: BoardObjectsNavigation | undefined = pick === undefined || open === undefined ? undefined : {
    open,
    pickAsset: async (kind) => {
      const request = kind === "program" ? { kind: "programs" as const, extensions: [".prg"], field: "program source" }
        : kind === "sprite" ? { kind: "items" as const, extensions: [".itm"], field: "item sprite definition" }
          : { kind: "bitmaps" as const, extensions: [".png", ".bmp", ".jpg", ".jpeg", ".gif", ".tbm"], field: "board image" };
      const outcome = await pick(request);
      return outcome.chosen ? outcome.reference : null;
    },
  };
  const polygonMode = state.mode === "vectors" || state.mode === "programs";

  return (
    <section class="tkr-board" aria-label="Board" onKeyDown={onShortcut}>
      <div class="tkr-board-workspace">
      <div class="tkr-board-main">
      {snapshot.readOnly === null ? null : <p class="tkr-board-readonly" role="note">Read only: {snapshot.readOnly.message}</p>}
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
      <BoardPropertiesView
        doc={doc}
        disabled={readOnly}
        onEdited={onEdited}
        {...(navigation === undefined ? {} : { navigation })}
        pendingEdits={pendingEdits}
        onChooseStart={() => { if (!readOnly) { editor.pointerCancel(); setColourPicker(null); setPickingStart(true); setStartMessage("Click a board cell to set the player start."); } }}
        onSetStart={setPlayerStart}
      />
      {pickingStart ? <p class="tkr-board-note" role="status">Choose a board cell for the player start, or press Escape to cancel.</p> : null}
      {startMessage === null ? null : <p class="tkr-board-note" role="status">{startMessage}</p>}
      {colourPicker === null ? null : <p class="tkr-board-note" role="status">Click a rendered colour to use it as this image's transparent colour, or press Escape to cancel. Apply in the inspector to keep it.</p>}
      <div class="tkr-board-toolbar" role="toolbar" aria-label="Board modes">
        {(["tiles", "vectors", "programs", "sprites", "images"] as const).map((mode, index) => (
          <button type="button" key={mode} aria-pressed={state.mode === mode} aria-keyshortcuts={String(index + 1)}
            disabled={state.busy} data-board-mode={mode} onClick={() => editor.setMode(mode)}>
            {mode[0]!.toUpperCase() + mode.slice(1)} ({index + 1})
          </button>
        ))}
      </div>
      <div class="tkr-board-controls">
      <div class="tkr-board-toolbar tkr-board-toolbar-tools" role="toolbar" aria-label="Board tools">
        {BOARD_TOOLS.filter((tool) => state.mode === "tiles" || tool === "draw" || tool === "select" || tool === "scroll" || tool === "zoom" || (polygonMode && tool === "rectangle")).map((tool) => (
          <IconAction
            icon={tool}
            label={TOOL_LABELS[tool].label}
            shortcut={TOOL_LABELS[tool].key}
            key={tool}
            type="button"
            class={state.tool === tool ? "tkr-board-tool tkr-board-tool-active" : "tkr-board-tool"}
            data-tool={tool}
            aria-pressed={state.tool === tool}
            onClick={() => editor.setTool(tool)}
          />
        ))}
      </div>
      <div class="tkr-board-toolbar tkr-board-toolbar-view" role="toolbar" aria-label="Board view">
        {canHistory ? (
          <>
            <IconAction icon="undo" label="Undo" shortcut="Control+Z" class="tkr-board-undo" disabled={!snapshot.canUndo || readOnly} onClick={() => history("undo")} />
            <IconAction icon="redo" label="Redo" shortcut="Control+Y" class="tkr-board-redo" disabled={!snapshot.canRedo || readOnly} onClick={() => history("redo")} />
          </>
        ) : (
          <span class="tkr-board-host-note">Use this editor's own Undo and Redo.</span>
        )}
        <IconAction icon="minus" label="Zoom out" shortcut="-" class="tkr-board-zoom-out" disabled={state.viewport.zoomIndex <= 0} onClick={() => editor.zoomOut()} />
        <span class="tkr-board-zoom">{zoomPercent}%</span>
        <IconAction icon="plus" label="Zoom in" shortcut="+" class="tkr-board-zoom-in" disabled={state.viewport.zoomIndex >= ZOOM_STEPS.length - 1} onClick={() => editor.zoomIn()} />
        <IconAction icon="grid" label="Grid" shortcut="G" class="tkr-board-grid-toggle" aria-pressed={state.grid} onClick={() => editor.toggleGrid()} />
      </div>
      {layers > 1 ? (
        <div class="tkr-board-row tkr-board-layer-row">
          <label for={`${ids}-layer`}>Layer</label>
          <select id={`${ids}-layer`} value={String(currentLayer)} onChange={(event) => editor.setLayer(Number(event.currentTarget.value))}>
            {Array.from({ length: layers }, (_, index) => (
              <option key={index} value={String(index)}>
                {index + 1}
                {snapshot.layerTitles[index + 1] ? ` – ${snapshot.layerTitles[index + 1]}` : ""}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      </div>
      {polygonMode ? <fieldset class="tkr-board-visibility"><legend>Visible regions</legend>
        {([[0, "Passable"], [1, "Solid"], [2, "Under"], [4, "Legacy type 4"], [8, "Stairs"], [16, "Waypoint"], ["program", "Programs"]] as const).map(([type, label]) => (
          <label key={type}><input type="checkbox" checked={!state.hiddenObjectTypes.includes(type)}
            onChange={(event) => editor.setObjectTypeVisible(type, event.currentTarget.checked)} />{label}</label>
        ))}
      </fieldset> : null}
      {polygonMode ? <div class="tkr-board-toolbar" role="toolbar" aria-label="Region actions">
        <button type="button" disabled={readOnly || state.busy || state.objectSelection === null} onClick={() => { void editor.subdivideObject(); }}>Subdivide segments (Z)</button>
        <button type="button" disabled={readOnly || state.busy || state.objectSelection === null} onClick={() => editor.resumeObjectPath()}>Resume drawing (X)</button>
        <button type="button" disabled={readOnly || state.busy || state.pointSelection.length === 0} onClick={() => { void editor.deletePoints(); }}>Delete selected points</button>
        {state.pending?.kind === "object-path" ? <>
          <button type="button" disabled={state.busy} onClick={() => { void editor.finishObjectPath(false); }}>Finish closed</button>
          <button type="button" disabled={state.busy} onClick={() => { void editor.finishObjectPath(true); }}>Finish open</button>
        </> : null}
      </div> : null}
      {historyNote === null ? null : <p class="tkr-board-note" role="status">{historyNote}</p>}
      <div class="tkr-board-info-row">
      <div class="tkr-board-header-bar">
        <h2 class="tkr-board-heading">Board</h2>
        <p class="tkr-board-summary">
          {size.width} × {size.height} cells, {layers} {layers === 1 ? "layer" : "layers"}
          {snapshot.coordType & 2 ? ", isometric (rotated)" : snapshot.coordType & 1 ? ", isometric (stacked)" : ""}
        </p>
      </div>
      {layers === 0 ? null : (
        <details class="tkr-board-layers-disclosure">
        <summary>Visible layers</summary>
        <fieldset class="tkr-board-visibility">
          <legend>Visible layers</legend>
          {Array.from({ length: layers }, (_, index) => {
            const current = index === currentLayer;
            return (
              <label key={index} class="tkr-board-visible">
                <input
                  type="checkbox"
                  checked={!state.hidden.includes(index)}
                  disabled={current}
                  aria-describedby={current ? `${ids}-current-note` : undefined}
                  onChange={(event) => { editor.setLayerVisible(index, event.currentTarget.checked); }}
                />
                {" "}Layer {index + 1}{snapshot.layerTitles[index + 1] ? ` – ${snapshot.layerTitles[index + 1]}` : ""}
              </label>
            );
          })}
          <label class="tkr-board-visible">
            <input
              type="checkbox"
              checked={state.showBackground && snapshot.backgroundImage !== ""}
              disabled={snapshot.backgroundImage === ""}
              aria-keyshortcuts="B"
              onChange={() => editor.toggleBackground()}
            />
            {" "}Background image (B){snapshot.backgroundImage === "" ? " – none" : ""}
          </label>
          <p id={`${ids}-current-note`} class="tkr-board-note">The current layer is always shown.</p>
          <button type="button" class="tkr-board-only-current" onClick={() => editor.showOnlyCurrent()}>Show only current</button>
          <button type="button" class="tkr-board-show-all" onClick={() => editor.showAll()}>Show all</button>
        </fieldset>
        </details>
      )}
      </div>
      <div class="tkr-board-picture">
        <BoardCanvas editor={editor} state={state} board={snapshot} picture={picture} stamp={brush?.kind === "stamp" ? brush.stamp : null}
          startPicking={pickingStart} startMarker={startMarker} onStartCell={(cell) => setPlayerStart(cell.x + 1, cell.y + 1, state.layer + 1)}
          colourPicking={colourPicker !== null} onColourPixel={(colour) => { colourPicker?.(colour); setColourPicker(null); }} />
        {picture === null ? (
          <p class="tkr-board-preview-state" role="status">Drawing the board…</p>
        ) : picture.ok ? (
          picture.warnings.length === 0 ? null : (
            <ul class="tkr-board-warnings" aria-label="Files the picture could not use">
              {picture.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          )
        ) : (
          <p class="tkr-board-preview-state" role="status">No picture: {picture.message}</p>
        )}
      </div>
      {state.mode === "tiles" ? <p class="tkr-board-brush-state">{brushText}</p> : <p class="tkr-board-note">
        {polygonMode ? "Click points, then right-click to close (Ctrl+right-click leaves open). Shift constrains; Ctrl reverses grid snapping; Alt removes a nearby point. Select to move points or drag a point-selection box." : "Draw places a default object. Select and drag to move it; use the inspector to choose its source and edit exact coordinates."}
      </p>}
      {pending !== null && pending.kind === "corner" && pending.keyboard ? (
        <p class="tkr-board-note" role="status">
          First corner at column {pending.anchor.x + 1}, row {pending.anchor.y + 1}. Move to the other corner and press Space, or Escape to cancel.
        </p>
      ) : null}
      {state.message === null ? null : (
        <p class="tkr-board-message" role={state.message.kind === "error" ? "alert" : "status"}>{state.message.text}</p>
      )}
      <details class="tkr-board-selection-disclosure" hidden={state.mode !== "tiles"} open={state.tool === "select" || selection !== null}>
        <summary>Selection actions</summary>
        <fieldset class="tkr-board-selection">
          <legend>Selection</legend>
          <p class="tkr-board-note" role="status">
            {selection === null
              ? "Nothing selected. Drag on the board, or press Space on two corners of the grid."
              : `Layer ${selection.layer + 1}, columns ${selection.rect.x0 + 1} to ${selection.rect.x1 + 1}, rows ${selection.rect.y0 + 1} to ${selection.rect.y1 + 1}.`}
          </p>
          <label for={`${ids}-move-columns`}>Columns</label>
          <input id={`${ids}-move-columns`} type="number" step="1" value={moveBy.columns} onInput={(event) => setMoveBy({ ...moveBy, columns: event.currentTarget.value })} />
          <label for={`${ids}-move-rows`}>Rows</label>
          <input id={`${ids}-move-rows`} type="number" step="1" value={moveBy.rows} onInput={(event) => setMoveBy({ ...moveBy, rows: event.currentTarget.value })} />
          <button type="button" class="tkr-board-move" disabled={readOnly || selection === null} onClick={() => { void editor.moveSelectionBy(Number(moveBy.columns), Number(moveBy.rows), false); }}>Move selection</button>
          <button type="button" class="tkr-board-copy" disabled={readOnly || selection === null} onClick={() => { void editor.moveSelectionBy(Number(moveBy.columns), Number(moveBy.rows), true); }}>Copy selection</button>
          <button type="button" class="tkr-board-erase-selection" disabled={readOnly || selection === null} onClick={() => { void editor.eraseSelection(); }}>Erase selection</button>
          <button type="button" class="tkr-board-select-all" onClick={() => editor.selectAll()}>Select all</button>
          <button type="button" class="tkr-board-clear-selection" disabled={selection === null} onClick={() => editor.cancel()}>Clear selection</button>
        </fieldset>
      </details>
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
                const on = cellOnBoard(snapshot, cx, cy);
                const selected = selection !== null && selection.layer === currentLayer && cx >= selection.rect.x0 && cx <= selection.rect.x1 && cy >= selection.rect.y0 && cy <= selection.rect.y1;
                return (
                  <div key={column} role="gridcell" aria-colindex={cx + 1} aria-selected={active || selected}>
                    <button
                      type="button"
                      class={active ? "tkr-board-cell tkr-board-cell-selected" : on ? "tkr-board-cell" : "tkr-board-cell tkr-board-cell-off"}
                      tabIndex={active ? 0 : -1}
                      aria-disabled={on ? undefined : true}
                      aria-keyshortcuts={active && browser !== undefined ? "L" : undefined}
                      aria-label={`Column ${cx + 1}, row ${cy + 1}: ${on ? (here === null || here === "" ? "empty" : here) : "off the board"}`}
                      onClick={() => editor.setCursor({ x: cx, y: cy })}
                      onKeyDown={(event) => {
                        const step = event.key === "ArrowLeft" ? [-1, 0] : event.key === "ArrowRight" ? [1, 0] : event.key === "ArrowUp" ? [0, -1] : event.key === "ArrowDown" ? [0, 1] : null;
                        if (step !== null) {
                          event.preventDefault();
                          focusCell.current = true;
                          editor.moveCursor(step[0]!, step[1]!);
                        } else if (event.key === "Enter") {
                          event.preventDefault();
                          tileField.current?.focus();
                        } else if (event.key === " ") {
                          event.preventDefault();
                          editor.setCursor({ x: cx, y: cy });
                          void editor.activate({ shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey, alt: event.altKey });
                        } else if (event.key.toLowerCase() === "l" && !event.ctrlKey && !event.metaKey && !event.altKey && browser !== undefined) {
                          event.preventDefault();
                          browserRoot.current?.querySelector<HTMLSelectElement>("select")?.focus();
                        }
                      }}
                    >
                      {on ? cellText(here) : "×"}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      <div class="tkr-board-row tkr-board-cell-row" hidden={state.mode !== "tiles"}>
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
        disabled={readOnly || layers === 0 || brushSelection === null || brushSelection.boardTile === null}
        onClick={() => { if (brushSelection !== null && brushSelection.boardTile !== null) void put(brushSelection.boardTile); }}
      >
        {brushSelection?.boardTile === null || brushSelection === null ? "No board brush selected" : `Paint ${brushSelection.label} here`}
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
        data-editor-save="true" class="tkr-board-save"
        disabled={readOnly || savePending || snapshot.saving || conflict !== null || (!snapshot.dirty && !pendingEdits.busy())}
        onClick={() => {
          setSavePending(true);
          void pendingEdits.settle().then(() => doc.save()).catch(() => undefined).finally(() => setSavePending(false));
        }}
      >
        Save
      </button>
      {failure === null || (failure.kind === "conflict" && conflict !== null) ? null : (
        <p class="tkr-board-error" role="alert">{failure.message}</p>
      )}
      </div>
      {state.mode === "tiles" && browser !== undefined
        ? <div ref={browserRoot} class="tkr-board-browser"><TilesetBrowser context={browser} /></div> : null}
      <div class="tkr-board-browser" hidden={state.mode === "tiles"}>
          <BoardObjectsView doc={doc} snapshot={snapshot} mode={objectMode.current}
            selection={state.objectSelection} pointSelection={state.pointSelection} disabled={readOnly || state.busy || state.mode === "tiles"}
            pendingEdits={pendingEdits} onEdited={onEdited} onSelect={(index) => editor.selectObject(index)}
            onReturnToDraft={(selection) => { editor.setMode(selection.kind); editor.selectObject(selection.index); }}
            onSelectPoints={(indices) => editor.selectPoints(indices)} onCreate={() => editor.createObject()}
            onDelete={() => editor.removeObject()} onReorder={(index) => editor.reorderObject(index)}
            onPickTransparent={(accept) => { editor.pointerCancel(); setPickingStart(false); setColourPicker(() => accept); }}
            {...(objectNavigation === undefined ? {} : { navigation: objectNavigation })} /></div>
      </div>
    </section>
  );
}
