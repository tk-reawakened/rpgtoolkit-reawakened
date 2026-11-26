import type { ApplyResult } from "./binary-document.ts";
import type { PreferencesSnapshot } from "./preferences.ts";
import type { BoardCommand, BoardDocumentFields, BoardPrecondition, SetBoardFieldsCommand, TileGesture } from "./board-document.ts";
import { boardTileAt } from "./board-document.ts";
import {
  DEFAULT_ZOOM_INDEX,
  ZOOM_STEPS,
  cellInGrid,
  cellOnBoard,
  cellOutline,
  clampViewport,
  pixelToCell,
  revealCell,
  screenToBoard,
  zoomOf,
  zoomTo,
  type Cell,
  type Pixel,
  type Viewport,
} from "./board-geometry.ts";
import { autotileCells, paintAutotileStroke } from "./board-autotile.ts";
import {
  cellRect,
  cellsBetween,
  floodArea,
  moveCells,
  paintCells,
  rectContains,
  rectangleRegion,
  stampCells,
  type BoardTool,
  type CellRect,
  type Stamp,
  type ToolBoard,
  type ToolOutcome,
} from "./board-tools.ts";
import type { BoardObjectKind, BoardObjectSelection } from "./board-objects.ts";
import {
  defaultBoardObject,
  nearestObjectPoint,
  nearestObjectSegment,
  objectHitDistance,
  objectPoints,
  rectangleObjectPoints,
  snapObjectPoint,
  tileBasePoint,
  translatedObject,
  type BoardObject,
} from "./board-object-tools.ts";
import { clearRegion, copyObjects, copyRegion, parseClip, pasteObjects, pasteRegion, regionStillHolds, serializeClip, type BoardClip } from "./board-clipboard.ts";
import { sameStoredValue } from "./board-document.ts";
import type { ClipboardService } from "@tk-reawakened/platform-services";

/**
 * The state of the board canvas and the gestures that edit through it (`docs/editor-features.md`, "Reawakened rules for
 * the P0 board canvas and tile tools"). DOM-free: a view feeds it pointer and keyboard input in screen pixels and draws
 * what `getState()` says; the document is changed only through `options.apply`, once per finished gesture.
 *
 * Everything here except a finished tile gesture is view state: the tool, the current layer, which layers show, the
 * viewport and zoom, the cursor, the selection and a gesture in progress. None of it is a document edit, so none of it
 * makes the board dirty or appears in its history.
 */

export interface Modifiers {
  readonly shift?: boolean;
  readonly ctrl?: boolean;
  readonly alt?: boolean;
}

/** What Draw and Flood put: one tile, or a whole tile bitmap as a stamp. */
export type Brush =
  | { readonly kind: "tile"; readonly tile: string; readonly label: string; readonly autotileSource?: string }
  | { readonly kind: "stamp"; readonly stamp: Stamp };

export interface EditorPreferences {
  /** After a flood fill, switch back to Draw (`board.revertToDrawAfterFlood`). */
  readonly revertToDrawAfterFlood: boolean;
  readonly recursiveFlood: boolean;
  /** Show the player-start cross on the initial board only, or on every board. */
  readonly startLocationDisplay: "initial" | "every";
}

export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = { revertToDrawAfterFlood: true, recursiveFlood: false, startLocationDisplay: "initial" };

/** The board-editor preferences in force in a preferences snapshot (T-33); a value the catalogue does not have is the default. */
export function editorPreferencesFrom(snapshot: PreferencesSnapshot): EditorPreferences {
  const value = (id: string, fallback: boolean): boolean => {
    const effective = snapshot.rows.find((row) => row.entry.id === id)?.effective;
    return typeof effective === "boolean" ? effective : fallback;
  };
  const display = snapshot.rows.find((row) => row.entry.id === "board.startLocationDisplay")?.effective;
  return {
    revertToDrawAfterFlood: value("board.revertToDrawAfterFlood", DEFAULT_EDITOR_PREFERENCES.revertToDrawAfterFlood),
    recursiveFlood: value("board.recursiveFlood", DEFAULT_EDITOR_PREFERENCES.recursiveFlood),
    startLocationDisplay: display === "every" ? "every" : "initial",
  };
}

export interface BoardEditorOptions {
  /** The board as it is now. */
  board(): ToolBoard & Pick<BoardDocumentFields, BoardObjectKind | "shadeLayers">;
  /** Apply one command to the document. A host may answer later. */
  apply(command: BoardCommand): ApplyResult | Promise<ApplyResult>;
  /** The retained brush, or `null` when none is chosen. */
  brush(): Brush | null;
  /** Make `tile` the brush (the dropper). Answer `false` when it cannot be placed in a browser. */
  pickTile(tile: string): boolean;
  /** The board-editor preferences now in force. */
  preferences(): EditorPreferences;
  /** Whether legacy Draw and Erase gestures reshape neighbouring autotile sets. */
  autotileEnabled?(): boolean;
  /** The size of the canvas in screen pixels. */
  readonly viewSize?: { readonly width: number; readonly height: number };
  /** Actual graphic bounds when the preview has them; otherwise the documented 32×32 placeholder is selectable. */
  objectBounds?(kind: BoardObjectKind, index: number): { readonly left: number; readonly top: number; readonly width: number; readonly height: number } | null;
  /** The host's system clipboard (AD-20); without it copy, cut and paste say the host cannot reach the clipboard and change nothing. */
  readonly clipboard?: ClipboardService;
  /** Whether the user is working on lights, which cannot be copied, cut or pasted (T-28). */
  lightsActive?(): boolean;
}

/** A gesture that has begun and has not been committed. Nothing here has touched the document. */
export type PendingGesture =
  /** Draw or Erase: the cells the drag has crossed. */
  | { readonly kind: "stroke"; readonly cells: readonly Cell[] }
  /** Draw with a stamp: the cell the stamp's top-left is on. */
  | { readonly kind: "stamp"; readonly at: Cell }
  /** Flood or Dropper: the cell the pointer is on. */
  | { readonly kind: "point"; readonly cell: Cell }
  /** Rectangle or Select: two corners. `keyboard` marks one started with Space, which the next Space finishes. */
  | { readonly kind: "corner"; readonly anchor: Cell; readonly current: Cell; readonly filled: boolean; readonly keyboard: boolean }
  /** Select: the selected tiles are being dragged by `current − anchor` cells. */
  | { readonly kind: "move"; readonly anchor: Cell; readonly current: Cell; readonly copy: boolean }
  /** Scroll: the last screen position of the drag. */
  | { readonly kind: "pan"; readonly from: Pixel }
  | ObjectGesture;

type ObjectGesture =
  | { readonly kind: "object-path"; readonly points: readonly Pixel[]; readonly current: Pixel; readonly resume: number | null }
  | { readonly kind: "object-rectangle"; readonly anchor: Pixel; readonly current: Pixel; readonly keyboard: boolean }
  | { readonly kind: "object-box"; readonly anchor: Pixel; readonly current: Pixel }
  | { readonly kind: "object-move"; readonly anchor: Pixel; readonly delta: Pixel };

function isObjectGesture(pending: PendingGesture | null): pending is ObjectGesture {
  return pending !== null && (pending.kind === "object-path" || pending.kind === "object-rectangle"
    || pending.kind === "object-box" || pending.kind === "object-move");
}

export interface BoardSelection {
  readonly layer: number;
  readonly rect: CellRect;
}

export interface EditorMessage {
  readonly kind: "info" | "error";
  readonly text: string;
}

export interface BoardEditorState {
  readonly tool: BoardTool;
  readonly mode: "tiles" | BoardObjectKind;
  readonly objectSelection: BoardObjectSelection | null;
  readonly pointSelection: readonly number[];
  /** The objects selected as a whole (Select all), indices of the mode's family; empty when only `objectSelection` is selected. */
  readonly objectGroup: readonly number[];
  readonly hiddenObjectTypes: readonly (number | "program")[];
  /** The current layer, counted from 0. It is always visible. */
  readonly layer: number;
  /** The layers that are hidden, counted from 0. */
  readonly hidden: readonly number[];
  /** Whether the background image shows (`B` in the visible-layers list). */
  readonly showBackground: boolean;
  readonly grid: boolean;
  readonly viewport: Viewport;
  /** Which way the mouse wheel scrolls; a middle click toggles it. */
  readonly scrollAxis: "vertical" | "horizontal";
  /** The cell the keyboard acts on. */
  readonly cursor: Cell;
  /** The cell under the pointer. */
  readonly hover: Cell | null;
  readonly selection: BoardSelection | null;
  readonly pending: PendingGesture | null;
  readonly message: EditorMessage | null;
  /** A finished gesture is being applied. */
  readonly busy: boolean;
}

/** Which layers and background the picture shows (`BoardPreviewRequest` of the preview, as plain JSON). */
export interface PictureRequest {
  readonly visibleLayers: readonly number[];
  readonly showBackground: boolean;
  readonly showSprites: boolean;
}

export interface BoardEditor {
  getState(): BoardEditorState;
  subscribe(listener: () => void): () => void;
  /** Bring the state in line with the board after it changed under the editor (an undo, a reload). */
  sync(): void;
  setTool(tool: BoardTool): void;
  setMode(mode: "tiles" | BoardObjectKind): void;
  selectObject(index: number | null): void;
  selectPoints(indices: readonly number[]): void;
  setObjectTypeVisible(type: number | "program", visible: boolean): void;
  createObject(): Promise<boolean>;
  /** Caller has obtained the explicit remove-and-renumber confirmation. */
  removeObject(): Promise<boolean>;
  reorderObject(index: number): Promise<boolean>;
  finishObjectPath(open: boolean): Promise<boolean>;
  resumeObjectPath(): void;
  subdivideObject(): Promise<boolean>;
  deletePoints(): Promise<boolean>;
  setLayer(layer: number): void;
  /** Show or hide a layer. The current layer cannot be hidden: answers `false`, and says so. */
  setLayerVisible(layer: number, visible: boolean): boolean;
  showOnlyCurrent(): void;
  showAll(): void;
  toggleBackground(): void;
  toggleGrid(): void;
  setViewSize(width: number, height: number): void;
  /** Scroll by screen pixels (positive moves the view right and down). */
  scrollBy(dx: number, dy: number): void;
  /** A wheel turn of `delta` (positive is down/away). Ctrl zooms, Shift or the toggled axis scrolls across. */
  wheel(delta: number, modifiers: Modifiers, focus: Pixel): void;
  toggleScrollAxis(): void;
  zoomIn(focus?: Pixel): void;
  zoomOut(focus?: Pixel): void;
  setZoomIndex(index: number, focus?: Pixel): void;
  pointerDown(screen: Pixel, modifiers: Modifiers, button?: number): void;
  pointerMove(screen: Pixel, modifiers: Modifiers): void;
  pointerUp(screen: Pixel, modifiers: Modifiers): Promise<void>;
  pointerCancel(): void;
  /** Move the keyboard cursor by whole cells; it stays on cells that are on the board. */
  moveCursor(dx: number, dy: number): void;
  setCursor(cell: Cell): void;
  /** Apply the current tool at the cursor (Space). */
  activate(modifiers: Modifiers): Promise<void>;
  /** Escape: drop a gesture in progress, else clear the selection. */
  cancel(): void;
  /** Select every cell of the board (tiles), or every visible object of the family on the current layer (an object mode). */
  selectAll(): void;
  /** Select every point of the selected region (an object mode). */
  selectAllPoints(): void;
  /**
   * Copy the selected region of cells, or the selected whole objects, to the system clipboard (T-28). A partial set of a
   * region's points and a light are refused with a message, and nothing is written. Answers whether it was copied.
   */
  copy(): Promise<boolean>;
  /**
   * Copy as `copy` does, then remove what was copied in one edit. Cutting objects renumbers the later slots, so
   * `confirmRemoval` is asked first and a "no" changes nothing, not even the clipboard.
   */
  cut(confirmRemoval: (removal: { readonly family: BoardObjectKind; readonly count: number }) => Promise<boolean>): Promise<boolean>;
  /** Paste the clipboard's board data: a region with its corner on the cursor, or whole objects appended to their family. */
  paste(): Promise<boolean>;
  eraseSelection(): Promise<void>;
  /** Move or copy the selection by whole columns and rows (the number alternative to dragging it). */
  moveSelectionBy(dx: number, dy: number, copy: boolean): Promise<void>;
  /** What the picture should show now. */
  pictureRequest(): PictureRequest;
}

const key = (cell: Cell): string => `${cell.x},${cell.y}`;

/** The first cell of the board that is on its picture, row by row; the corner cell when there is none (an empty board). */
function firstOnBoard(board: ToolBoard): Cell {
  for (let y = 0; y < board.grid.height; y += 1) for (let x = 0; x < board.grid.width; x += 1) if (cellOnBoard(board, x, y)) return { x, y };
  return { x: 0, y: 0 };
}

/** Make the editor of one board canvas. */
export function createBoardEditor(options: BoardEditorOptions): BoardEditor {
  const listeners = new Set<() => void>();
  const view = options.viewSize ?? { width: 640, height: 384 };
  let lastPixel: Pixel | null = null;
  let strokeKeys = new Set<string>();
  /** The stroke cells that were pressed or crossed with Shift held, so a drag reshapes each cell by its own modifier. */
  let strokeShift = new Set<string>();
  let state: BoardEditorState = {
    tool: "draw",
    mode: "tiles",
    objectSelection: null,
    pointSelection: [],
    objectGroup: [],
    hiddenObjectTypes: [],
    layer: 0,
    hidden: [],
    showBackground: true,
    grid: true,
    viewport: clampViewport(options.board(), { x: 0, y: 0, zoomIndex: DEFAULT_ZOOM_INDEX, width: view.width, height: view.height }),
    scrollAxis: "vertical",
    cursor: firstOnBoard(options.board()),
    hover: null,
    selection: null,
    pending: null,
    message: null,
    busy: false,
  };

  const publish = (patch: Partial<BoardEditorState>): void => {
    // Choosing another object (or none) ends a group of selected objects unless the same change names the group.
    state = { ...state, ...("objectSelection" in patch && !("objectGroup" in patch) ? { objectGroup: [] } : {}), ...patch };
    for (const listener of [...listeners]) listener();
  };
  const info = (text: string): void => publish({ message: { kind: "info", text } });
  const error = (text: string): void => publish({ message: { kind: "error", text } });
  const viewportTo = (viewport: Viewport): void => publish({ viewport: clampViewport(options.board(), viewport) });

  /** Apply a finished gesture as one edit. Answers whether the document changed. */
  /** Apply one tile edit, publishing what happened; a no-op (the stored board already shows it) is information, not an error. */
  const applyTiles = async (gesture: TileGesture, outcome: ToolOutcome, precondition?: BoardPrecondition): Promise<ApplyResult> => {
    if (!outcome.ok) {
      publish({ pending: null, message: { kind: "error", text: outcome.message } });
      return { ok: false, rejection: { reason: "invalid", message: outcome.message } };
    }
    if (outcome.cells.length === 0 && (outcome.shades === undefined || outcome.shades.length === 0) && (outcome.shadeCells === undefined || outcome.shadeCells.length === 0)) {
      publish({ pending: null, message: { kind: "info", text: "Nothing changed: those cells already show that." } });
      return { ok: false, rejection: { reason: "invalid", message: "Those cells already show that.", unchanged: true } };
    }
    publish({ pending: null, busy: true, message: null });
    let result: ApplyResult;
    try {
      result = await options.apply({
        type: "set-tiles",
        gesture,
        ...(precondition === undefined ? {} : { precondition }),
        cells: outcome.cells,
        ...(outcome.shades === undefined || outcome.shades.length === 0 ? {} : { shades: outcome.shades }),
        ...(outcome.shadeCells === undefined || outcome.shadeCells.length === 0 ? {} : { shadeCells: outcome.shadeCells }),
      });
    } catch (thrown) {
      result = { ok: false, rejection: { reason: "invalid", message: thrown instanceof Error ? thrown.message : String(thrown) } };
    }
    if (!result.ok) {
      publish({ busy: false, message: result.rejection.unchanged === true ? { kind: "info", text: result.rejection.message } : { kind: "error", text: `Nothing was changed: ${result.rejection.message}` } });
      return result;
    }
    publish({ busy: false, message: null });
    return result;
  };
  const commit = async (gesture: TileGesture, outcome: ToolOutcome, precondition?: BoardPrecondition): Promise<boolean> =>
    (await applyTiles(gesture, outcome, precondition)).ok;

  const needTile = (): string | null => {
    const brush = options.brush();
    if (brush === null) {
      error("Choose a tile in the tileset browser first.");
      return null;
    }
    if (brush.kind !== "tile") {
      error("This tool needs a single tile. Choose a tile or an animated tile in the tileset browser.");
      return null;
    }
    return brush.tile;
  };

  /** The legacy-set mark the brush carries, if any, so a marked set reshapes like a named one. */
  const brushAutotileSource = (): string | undefined => {
    const brush = options.brush();
    return brush?.kind === "tile" ? brush.autotileSource : undefined;
  };

  const place = async (tool: BoardTool, cell: Cell, modifiers: Modifiers = {}): Promise<void> => {
    const board = options.board();
    const layer = state.layer;
    const enabled = options.autotileEnabled?.() === true;
    if (tool === "draw") {
      const brush = options.brush();
      if (brush === null) return error("Choose a tile in the tileset browser first.");
      if (brush.kind === "stamp") {
        await commit("stamp", stampCells(board, layer, brush.stamp, cell));
        return;
      }
      await commit("draw", { ok: true, cells: paintAutotileStroke(board, layer, [cell], brush.tile, enabled, modifiers.shift === true, brush.autotileSource) });
    } else if (tool === "erase") {
      await commit("erase", { ok: true, cells: paintAutotileStroke(board, layer, [cell], "", enabled, modifiers.shift === true, brushAutotileSource()) });
    } else if (tool === "flood") {
      const tile = needTile();
      if (tile === null) return;
      const area = floodArea(board, layer, cell, tile, options.preferences().recursiveFlood);
      if (!area.ok) return void commit("flood", area);
      // Autotiling reshapes the click's own layer only; a fill that continues on another layer paints it as stored.
      const others = new Map<number, Cell[]>();
      const own: Cell[] = [];
      for (const { layer: at, x, y } of area.cells) {
        if (at === layer) own.push({ x, y });
        else { const list = others.get(at) ?? []; list.push({ x, y }); others.set(at, list); }
      }
      const cells = [
        ...autotileCells(board, layer, own, tile, enabled, modifiers.shift === true, brushAutotileSource()),
        ...[...others].flatMap(([at, list]) => paintCells(board, at, list, tile)),
      ];
      const changed = await commit("flood", { ok: true, cells });
      if (changed && options.preferences().revertToDrawAfterFlood) publish({ tool: "draw" });
    } else if (tool === "dropper") {
      const tile = boardTileAt(board, layer, cell.x, cell.y);
      if (tile === null || tile === "") {
        publish({ pending: null, message: { kind: "info", text: "That cell is empty, so there is no tile to pick." } });
      } else if (options.pickTile(tile)) {
        publish({ pending: null, message: { kind: "info", text: `Picked ${tile} as the brush.` } });
      } else {
        publish({ pending: null, message: { kind: "error", text: `${tile} is not in a tileset the browser can show, so it cannot be the brush.` } });
      }
    }
  };

  const finishCorner = async (pending: Extract<PendingGesture, { kind: "corner" }>, current: Cell, modifiers: Modifiers): Promise<void> => {
    if (state.tool === "select") {
      publish({ pending: null, message: null, selection: { layer: state.layer, rect: cellRect(pending.anchor, current) } });
      return;
    }
    const tile = needTile();
    if (tile === null) {
      publish({ pending: null });
      return;
    }
    // Ctrl held when the rectangle is finished fills it (the modifier of the finishing click or Space).
    const board = options.board();
    const region = rectangleRegion(board, pending.anchor, current, modifiers.ctrl === true);
    await commit("rectangle", { ok: true, cells: autotileCells(board, state.layer, region, tile, options.autotileEnabled?.() === true, modifiers.shift === true, brushAutotileSource()) });
  };

  const startCorner = (cell: Cell, modifiers: Modifiers, keyboard: boolean): void => {
    publish({ pending: { kind: "corner", anchor: cell, current: cell, filled: modifiers.ctrl === true, keyboard }, message: null });
  };

  const moveSelection = async (dx: number, dy: number, copy: boolean): Promise<void> => {
    const selection = state.selection;
    if (selection === null) return error("Select some cells first.");
    const changed = await commit(copy ? "copy" : "move", moveCells(options.board(), selection.layer, selection.rect, dx, dy, copy));
    if (changed) {
      const { x0, y0, x1, y1 } = selection.rect;
      publish({ selection: { layer: selection.layer, rect: { x0: x0 + dx, y0: y0 + dy, x1: x1 + dx, y1: y1 + dy } } });
    }
  };

  const selectedObject = (): BoardObject | null => {
    const selected = state.objectSelection;
    return selected === null ? null : options.board()[selected.kind][selected.index] ?? null;
  };
  const objectFields = (kind: BoardObjectKind, records: readonly BoardObject[]): SetBoardFieldsCommand["fields"] =>
    ({ [kind]: records }) as SetBoardFieldsCommand["fields"];
  const commitObjects = async (fields: SetBoardFieldsCommand["fields"], selection = state.objectSelection, group: readonly number[] = [], precondition?: BoardPrecondition): Promise<boolean> => {
    if (state.busy) return false;
    publish({ busy: true, message: null });
    try {
      const result = await options.apply({ type: "set-board-fields", ...(precondition === undefined ? {} : { precondition }), fields });
      if (!result.ok) {
        error(`Nothing was changed: ${result.rejection.message}`);
        return false;
      }
      const kept = selection !== null && selection.kind === state.objectSelection?.kind && selection.index === state.objectSelection.index;
      publish({ pending: null, objectSelection: selection, objectGroup: group, pointSelection: kept ? state.pointSelection : [], message: null });
      return true;
    } catch (thrown) {
      error(thrown instanceof Error ? thrown.message : String(thrown));
      return false;
    } finally {
      publish({ busy: false });
    }
  };
  const replaceObject = (object: BoardObject): Promise<boolean> => {
    const selected = state.objectSelection;
    if (selected === null) return Promise.resolve(false);
    return commitObjects(objectFields(selected.kind, options.board()[selected.kind].map((record, index) => index === selected.index ? object : record)));
  };
  const appendObject = (kind: BoardObjectKind, at: Pixel, points: readonly Pixel[], closed = -1): Promise<boolean> => {
    const records = options.board()[kind];
    const object = defaultBoardObject(kind, state.layer + 1, at, points, closed);
    return commitObjects(objectFields(kind, [...records, object]), { kind, index: records.length });
  };
  const polygonMode = (): boolean => state.mode === "vectors" || state.mode === "programs";
  const objectVisible = (kind: BoardObjectKind, object: BoardObject): boolean =>
    object.layer === state.layer + 1 && !state.hidden.includes(object.layer - 1)
    && !(kind === "vectors" && "type" in object && state.hiddenObjectTypes.includes(object.type))
    && !(kind === "programs" && state.hiddenObjectTypes.includes("program"));
  const hitObject = (pixel: Pixel): number | null => {
    if (state.mode === "tiles") return null;
    let best = 16 / zoomOf(state.viewport);
    let found: number | null = null;
    options.board()[state.mode].forEach((object, index) => {
      if (!objectVisible(state.mode as BoardObjectKind, object)) return;
      const distance = objectHitDistance(object, pixel, options.objectBounds?.(state.mode as BoardObjectKind, index) ?? undefined);
      if (distance <= best) { best = distance; found = index; }
    });
    return found;
  };
  const snappedPlacement = (pixel: Pixel, modifiers: Modifiers): Pixel => {
    const board = options.board();
    if (state.mode === "sprites" && ((board.coordType & 4) === 0) !== (modifiers.ctrl === true)) {
      const cell = pixelToCell(board, pixel.x, pixel.y);
      if (cell !== null) return tileBasePoint(board, cell);
    }
    return snapObjectPoint(board, pixel, modifiers.ctrl === true);
  };
  const moveDelta = (pixel: Pixel, modifiers: Modifiers, anchor: Pixel): Pixel => {
    const object = selectedObject();
    if (object === null) return { x: 0, y: 0 };
    const points = objectPoints(object);
    const base = points[state.pointSelection[0] ?? 0] ?? { x: 0, y: 0 };
    const to = snappedPlacement({ x: base.x + pixel.x - anchor.x, y: base.y + pixel.y - anchor.y }, modifiers);
    return { x: to.x - base.x, y: to.y - base.y };
  };
  const moveObjectGesture = (pixel: Pixel, modifiers: Modifiers): void => {
    const pending = state.pending;
    if (!isObjectGesture(pending) || state.busy) return;
    if (pending.kind === "object-path") {
      publish({ pending: { ...pending, current: snapObjectPoint(options.board(), pixel, modifiers.ctrl === true, pending.points.at(-1), modifiers.shift === true) } });
    } else if (pending.kind === "object-move") {
      publish({ pending: { ...pending, delta: moveDelta(pixel, modifiers, pending.anchor) } });
    } else {
      publish({ pending: { ...pending, current: pending.kind === "object-box" ? pixel : snapObjectPoint(options.board(), pixel, modifiers.ctrl === true) } });
    }
  };
  const finishObjectGesture = async (pixel: Pixel, modifiers: Modifiers): Promise<void> => {
    const pending = state.pending;
    if (!isObjectGesture(pending) || state.busy || pending.kind === "object-path") return;
    if (pending.kind === "object-box") {
      const object = selectedObject();
      const left = Math.min(pending.anchor.x, pixel.x), right = Math.max(pending.anchor.x, pixel.x);
      const top = Math.min(pending.anchor.y, pixel.y), bottom = Math.max(pending.anchor.y, pixel.y);
      publish({ pending: null, pointSelection: object === null || !("points" in object) ? [] : object.points.flatMap((point, index) =>
        point.x >= left && point.x <= right && point.y >= top && point.y <= bottom ? [index] : []) });
    } else if (pending.kind === "object-move") {
      const object = selectedObject();
      const delta = moveDelta(pixel, modifiers, pending.anchor);
      if (object === null || (delta.x === 0 && delta.y === 0)) return publish({ pending: null });
      await replaceObject(translatedObject(object, delta, state.pointSelection));
    } else if (polygonMode()) {
      const to = snapObjectPoint(options.board(), pixel, modifiers.ctrl === true);
      const points = rectangleObjectPoints(options.board(), pending.anchor, to);
      if (points.every((point) => point.x === points[0]?.x && point.y === points[0]?.y)) return publish({ pending: null });
      await appendObject(state.mode as "vectors" | "programs", pending.anchor, points);
    }
  };
  const splitEdge = async (object: BoardObject, pixel: Pixel, modifiers: Modifiers): Promise<void> => {
    if (!("points" in object)) return;
    const edge = nearestObjectSegment(object.points, object.closed !== 0, pixel);
    if (edge === null) return;
    const point = snapObjectPoint(options.board(), edge.point, modifiers.ctrl === true);
    const points = [...object.points.slice(0, edge.index + 1), point, ...object.points.slice(edge.index + 1)];
    if (await replaceObject({ ...object, points })) publish({ pointSelection: [edge.index + 1] });
  };
  const objectPointerDown = (pixel: Pixel, modifiers: Modifiers, button: number, keyboard = false): void => {
    if (state.mode === "tiles") return;
    lastPixel = pixel;
    const cell = pixelToCell(options.board(), pixel.x, pixel.y);
    if (cell !== null) publish({ cursor: cell, hover: cell });
    if (button === 2) {
      if (polygonMode()) void editor.finishObjectPath(modifiers.ctrl === true);
      return;
    }
    if (button !== 0) return;
    const pending = state.pending;
    if (state.tool === "rectangle" && polygonMode()) {
      const at = snapObjectPoint(options.board(), pixel, modifiers.ctrl === true);
      publish({ pending: { kind: "object-rectangle", anchor: at, current: at, keyboard }, message: null });
      return;
    }
    if (state.tool === "draw" && polygonMode()) {
      if (pending?.kind === "object-path") {
        if (modifiers.alt === true) {
          const index = nearestObjectPoint(pending.points, pixel, 16 / zoomOf(state.viewport));
          if (index !== null) publish({ pending: { ...pending, points: pending.points.filter((_, at) => at !== index) } });
          return;
        }
        const at = snapObjectPoint(options.board(), pixel, modifiers.ctrl === true, pending.points.at(-1), modifiers.shift === true);
        const previous = pending.points.at(-1);
        if (previous?.x !== at.x || previous.y !== at.y) publish({ pending: { ...pending, points: [...pending.points, at], current: at } });
        return;
      }
      const selected = state.objectSelection;
      const object = selected?.kind === state.mode ? selectedObject() : null;
      const visible = object !== null && objectVisible(state.mode as BoardObjectKind, object);
      if (visible && selected !== null && object !== null && "points" in object) {
        const index = nearestObjectPoint(object.points, pixel, 16 / zoomOf(state.viewport));
        if (index !== null) {
          publish({ pointSelection: [index], pending: modifiers.alt === true ? null : { kind: "object-move", anchor: pixel, delta: { x: 0, y: 0 } } });
          if (modifiers.alt === true) void editor.deletePoints();
          return;
        }
        const edge = nearestObjectSegment(object.points, object.closed !== 0, pixel);
        if (modifiers.alt === true && edge !== null && edge.distance <= 16 / zoomOf(state.viewport)) {
          void splitEdge(object, pixel, modifiers);
          return;
        }
        if (modifiers.alt === true) {
          const at = snapObjectPoint(options.board(), pixel, modifiers.ctrl === true);
          const points = [...object.points, at];
          publish({ pending: { kind: "object-path", points, current: at, resume: selected.index }, pointSelection: [], message: null });
          return;
        }
      }
      const at = snapObjectPoint(options.board(), pixel, modifiers.ctrl === true);
      publish({ pending: { kind: "object-path", points: [at], current: at, resume: null }, objectSelection: null, pointSelection: [], message: null });
      return;
    }
    if (state.tool === "draw") {
      void appendObject(state.mode, snappedPlacement(pixel, modifiers), []);
      return;
    }
    const index = hitObject(pixel);
    const object = index === null ? selectedObject() : options.board()[state.mode][index]!;
    if (index === null) {
      if (object !== null && "points" in object) publish({ pending: { kind: "object-box", anchor: pixel, current: pixel } });
      else publish({ objectSelection: null, pointSelection: [], pending: null });
      return;
    }
    const same = state.objectSelection?.kind === state.mode && state.objectSelection.index === index;
    const vertex = object !== null && "points" in object ? nearestObjectPoint(object.points, pixel, 16 / zoomOf(state.viewport)) : null;
    let indices: readonly number[] = [];
    if (vertex !== null) {
      indices = same && state.pointSelection.includes(vertex) ? state.pointSelection : [vertex];
      if (modifiers.shift === true) {
        const previous = same ? state.pointSelection : [];
        indices = previous.includes(vertex) ? previous.filter((at) => at !== vertex) : [...previous, vertex];
      }
    }
    publish({ objectSelection: { kind: state.mode, index }, pointSelection: indices,
      pending: modifiers.shift === true ? null : { kind: "object-move", anchor: pixel, delta: { x: 0, y: 0 } }, message: null });
  };

  // Board clipboard (T-28): the system clipboard holds one versioned JSON document; nothing here keeps a private copy.
  const singular = (kind: BoardObjectKind): string => kind.slice(0, -1);
  const hostClipboard = (): ClipboardService | null => {
    if (options.clipboard === undefined) {
      error("This host cannot reach the system clipboard, so copy, cut and paste are not available here. The board is unchanged.");
      return null;
    }
    return options.clipboard;
  };
  const lightsRefused = (verb: string): boolean => {
    if (options.lightsActive?.() !== true) return false;
    error(`Lights cannot be ${verb}. Add or remove them in the Lights list, or convert a light to shading and use the shaded cells. Nothing was changed.`);
    return true;
  };
  type ClipSource = {
    readonly ok: true;
    readonly clip: BoardClip;
    readonly region: BoardSelection | null;
    readonly indices: readonly number[];
    /** What the stored board must still hold for the cut to apply, so a stale view cannot remove something else. */
    readonly precondition: BoardPrecondition;
  } | { readonly ok: false; readonly message: string };
  /** What copy or cut would take now: the selected region, or the selected whole objects. A partial set of points is refused. */
  const clipSource = (verb: string): ClipSource => {
    const board = options.board();
    if (state.mode === "tiles") {
      const selection = state.selection;
      if (selection === null) return { ok: false, message: "Select some cells first (the Select tool, or Select all)." };
      const made = copyRegion(board, selection.layer, selection.rect);
      if (!made.ok) return made;
      const cells: { layer: number; x: number; y: number; tile: string }[] = [];
      const shadeCells: { x: number; y: number; r: number; g: number; b: number }[] = [];
      for (let row = 0; row < made.value.height; row += 1) {
        for (let column = 0; column < made.value.width; column += 1) {
          const at = row * made.value.width + column;
          const tile = made.value.tiles[at];
          if (tile === null || tile === undefined) continue;
          const x = selection.rect.x0 + column;
          const y = selection.rect.y0 + row;
          cells.push({ layer: selection.layer, x, y, tile });
          const shade = made.value.shades?.[at];
          if (shade !== null && shade !== undefined) shadeCells.push({ x, y, r: shade[0], g: shade[1], b: shade[2] });
        }
      }
      return { ok: true, clip: made.value, region: selection, indices: [], precondition: { cells, ...(shadeCells.length === 0 ? {} : { shadeCells }) } };
    }
    const kind = state.mode;
    const selected = state.objectSelection;
    const indices = state.objectGroup.length > 0 ? state.objectGroup : selected === null ? [] : [selected.index];
    if (indices.length === 0) return { ok: false, message: `Select a whole ${singular(kind)} first (the Select tool, or Select all).` };
    const primary = selectedObject();
    if (primary !== null && "points" in primary && state.pointSelection.length > 0 && state.pointSelection.length < primary.points.length) {
      return { ok: false, message: `Only some of a ${singular(kind)}'s points are selected, and a partial set of points cannot be ${verb}. Select all of its points or none of them. Nothing was changed.` };
    }
    const made = copyObjects(board, kind, indices);
    if (!made.ok) return made;
    return { ok: true, clip: made.value, region: null, indices, precondition: { [kind]: board[kind] } as BoardPrecondition };
  };
  const describeClip = (clip: BoardClip, verb: string): string => {
    if (clip.kind === "objects") return `${verb} ${clip.objects.length} ${clip.objects.length === 1 ? singular(clip.family) : clip.family}.`;
    const cells = clip.tiles.filter((tile) => tile !== null).length;
    const shading = clip.shades !== null ? " with their shading" : options.board().shadeLayers.length > 1 ? " (this board has more than one shading layer, so only the tiles)" : "";
    return `${verb} ${cells} ${cells === 1 ? "cell" : "cells"}${shading}.`;
  };
  const copyToClipboard = async (): Promise<boolean> => {
    if (lightsRefused("copied")) return false;
    const made = clipSource("copied");
    if (!made.ok) { error(made.message); return false; }
    const service = hostClipboard();
    if (service === null) return false;
    const wrote = await service.writeText(serializeClip(made.clip));
    if (!wrote.ok) { error(`Nothing was copied: ${wrote.error.message}`); return false; }
    info(describeClip(made.clip, "Copied"));
    return true;
  };
  /** Whether the board still holds exactly what a cut took: the same slots with the same records, or the same tiles and shade. */
  const stillHolds = (source: ClipSource & { readonly ok: true }): boolean => {
    const board = options.board();
    if (source.clip.kind === "objects") {
      const records = board[source.clip.family];
      return source.indices.length === source.clip.objects.length
        && source.indices.every((index, at) => sameStoredValue(records[index], source.clip.kind === "objects" ? source.clip.objects[at] : undefined));
    }
    return source.region !== null && regionStillHolds(board, source.clip, source.region.layer, source.region.rect);
  };
  const cutToClipboard = async (confirmRemoval: (removal: { readonly family: BoardObjectKind; readonly count: number }) => Promise<boolean>): Promise<boolean> => {
    if (state.busy) return false;
    if (lightsRefused("cut")) return false;
    // The source is frozen here: what the question asks about, what the clipboard receives and what is removed are the same
    // selection, and a change that lands while the cut waits refuses the whole cut instead of cutting something else.
    const source = clipSource("cut");
    if (!source.ok) { error(source.message); return false; }
    const service = hostClipboard();
    if (service === null) return false;
    if (source.clip.kind === "objects") {
      const removal = { family: source.clip.family, count: source.clip.objects.length };
      if (!(await confirmRemoval(removal))) { info("Cut cancelled. Nothing was changed."); return false; }
      if (state.busy) return false;
      if (lightsRefused("cut")) return false;
      if (!stillHolds(source)) { error("The board changed while the cut was being asked about, so the copied selection is not the same any more. Nothing was cut. Select it again."); return false; }
    }
    const wrote = await service.writeText(serializeClip(source.clip));
    if (!wrote.ok) { error(`Nothing was cut: ${wrote.error.message}`); return false; }
    if (state.busy) return false;
    if (lightsRefused("cut")) return false;
    if (!stillHolds(source)) { error("The board changed while the cut was being written, so the copied selection is not the same any more. Nothing was cut. Select it again."); return false; }
    const board = options.board();
    if (source.clip.kind === "region" && source.region !== null) {
      const edit = clearRegion(board, source.region.layer, source.region.rect);
      const changed = await commit("cut", { ok: true, cells: edit.cells, shadeCells: edit.shadeCells }, source.precondition);
      if (changed) info(describeClip(source.clip, "Cut"));
      return changed;
    }
    if (source.clip.kind === "objects") {
      const family = source.clip.family;
      const taken = new Set(source.indices);
      const changed = await commitObjects(objectFields(family, board[family].filter((_, index) => !taken.has(index))), null, [], source.precondition);
      if (changed) {
        publish({ pointSelection: [] });
        info(`${describeClip(source.clip, "Cut")} Later ${family} were renumbered; undo restores them.`);
      }
      return changed;
    }
    return false;
  };
  const pasteFromClipboard = async (): Promise<boolean> => {
    if (state.busy) return false;
    if (lightsRefused("pasted")) return false;
    const service = hostClipboard();
    if (service === null) return false;
    const read = await service.readText();
    if (!read.ok) { error(`Nothing was pasted: ${read.error.message}`); return false; }
    // Reading the clipboard awaited: the user may have started something else, or turned to the lights.
    if (state.busy) { error("Another edit is being applied, so nothing was pasted."); return false; }
    if (lightsRefused("pasted")) return false;
    const parsed = parseClip(read.value);
    if (!parsed.ok) { error(`${parsed.message} Nothing was changed.`); return false; }
    const clip = parsed.value;
    const board = options.board();
    if (clip.kind === "region") {
      if (state.mode !== "tiles") { error("The clipboard holds a region of cells. Switch to Tiles (1) to paste it. Nothing was changed."); return false; }
      const { layer, cursor } = state;
      // The cursor is the anchor; a clip that cannot fit there (a rotated-isometric selection whose bounding box starts on a
      // cell with no place on the picture, or the whole grid) pastes where it was copied from instead.
      let anchor = cursor;
      let outcome = pasteRegion(board, layer, clip, cursor);
      const origin = clip.origin;
      if (!outcome.ok && origin !== null && (origin.x !== cursor.x || origin.y !== cursor.y)) {
        const atOrigin = pasteRegion(board, layer, clip, origin);
        if (atOrigin.ok) { anchor = origin; outcome = atOrigin; }
      }
      if (!outcome.ok) { error(origin === null ? `${outcome.message} The clipboard does not say where it was copied from, so it can only be pasted at the cursor.` : outcome.message); return false; }
      const result = await applyTiles("paste", { ok: true, cells: outcome.edit.cells, shadeCells: outcome.edit.shadeCells });
      // The stored board decides whether anything changed; a no-op paste still selects its destination, so "copy, paste,
      // copy again" takes the pasted cells. A refused paste selects nothing.
      const settled = result.ok || result.rejection.unchanged === true;
      // A copied region with gaps (a rotated-isometric bounding box) cannot be expressed by a rectangle, so selecting one
      // would let a following cut remove cells that were never pasted: the selection is cleared instead.
      const sparse = clip.tiles.some((tile) => tile === null);
      if (settled) publish({ selection: sparse ? null : { layer, rect: { x0: anchor.x, y0: anchor.y, x1: anchor.x + clip.width - 1, y1: anchor.y + clip.height - 1 } } });
      const moved = anchor.x !== cursor.x || anchor.y !== cursor.y;
      const where = `column ${anchor.x + 1}, row ${anchor.y + 1}`;
      const note = `${moved ? ` It did not fit at the cursor, so it went back where it was copied from (${where}).` : ""}${sparse ? " The copied region has gaps, so no cells are selected; select the cells you want to copy or cut." : ""}`;
      if (result.ok) info(`${describeClip(clip, "Pasted")}${note}`);
      else if (settled) info(`${moved ? `Nothing changed: those cells at ${where} already show that.` : "Nothing changed: those cells already show that."}${sparse ? " The copied region has gaps, so no cells are selected; select the cells you want to copy or cut." : ""}`);
      return result.ok;
    }
    if (state.mode !== clip.family) {
      const modes = ["tiles", "vectors", "programs", "sprites", "images"];
      error(`The clipboard holds ${clip.family}. Switch to ${clip.family[0]!.toUpperCase()}${clip.family.slice(1)} (${modes.indexOf(clip.family) + 1}) to paste them. Nothing was changed.`);
      return false;
    }
    const records = pasteObjects(board, clip);
    if (!records.ok) { error(records.message); return false; }
    const first = board[clip.family].length;
    const group = clip.objects.length > 1 ? clip.objects.map((_, index) => first + index) : [];
    // Appending to the family this editor read only: a stale copy must not overwrite what another view added meanwhile.
    const changed = await commitObjects(objectFields(clip.family, records.value), { kind: clip.family, index: first }, group, { [clip.family]: board[clip.family] } as BoardPrecondition);
    if (changed) info(`${describeClip(clip, "Pasted")} They keep their position and layer; use Select to move them.`);
    return changed;
  };

  const editor: BoardEditor = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    sync() {
      const board = options.board();
      const layer = Math.max(0, Math.min(state.layer, board.layers - 1));
      const hidden = state.hidden.filter((index) => index < board.layers && index !== layer);
      const cursor = cellOnBoard(board, state.cursor.x, state.cursor.y) ? state.cursor : firstOnBoard(board);
      const selection = state.selection !== null && state.selection.layer < board.layers
        && cellInGrid(board, state.selection.rect.x0, state.selection.rect.y0) && cellInGrid(board, state.selection.rect.x1, state.selection.rect.y1)
        ? state.selection
        : null;
      const objectSelection = state.objectSelection !== null && board[state.objectSelection.kind][state.objectSelection.index] !== undefined ? state.objectSelection : null;
      const object = objectSelection === null ? null : board[objectSelection.kind][objectSelection.index]!;
      const count = object !== null && "points" in object ? object.points.length : 0;
      const pointSelection = state.pointSelection.every((index) => index < count)
        ? state.pointSelection : state.pointSelection.filter((index) => index < count);
      const viewport = clampViewport(board, state.viewport);
      const grouped = objectSelection === null ? [] : state.objectGroup.filter((index) => board[objectSelection.kind][index] !== undefined);
      const objectGroup = grouped.length === state.objectGroup.length ? state.objectGroup : grouped;
      const same = layer === state.layer && hidden.length === state.hidden.length && cursor === state.cursor && selection === state.selection
        && objectSelection === state.objectSelection && pointSelection === state.pointSelection && objectGroup === state.objectGroup
        && viewport.x === state.viewport.x && viewport.y === state.viewport.y;
      if (!same) publish({ layer, hidden, cursor, selection, objectSelection, objectGroup, pointSelection, viewport });
    },
    setTool(tool) {
      if (tool === state.tool && state.pending === null) return;
      if (state.mode !== "tiles" && (tool === "flood" || tool === "erase" || tool === "dropper")) {
        return info("Flood fill, Erase and Dropper are tile tools. Use point actions or the object inspector in this mode.");
      }
      lastPixel = null;
      publish({ tool, pending: null, message: null });
    },
    setMode(mode) {
      if (state.busy || mode === state.mode) return;
      const tool = state.tool === "scroll" || state.tool === "zoom" || state.tool === "select" ? state.tool : "draw";
      publish({ mode, tool, pending: null, selection: null, objectSelection: null, pointSelection: [], message: null });
    },
    selectObject(index) {
      if (state.mode === "tiles" || state.busy) return;
      if (index !== null && (!Number.isInteger(index) || options.board()[state.mode][index] === undefined)) return;
      publish({ objectSelection: index === null ? null : { kind: state.mode, index }, pointSelection: [], pending: null, message: null });
    },
    selectPoints(indices) {
      const object = selectedObject();
      if (object === null || !("points" in object)) return;
      publish({ pointSelection: [...new Set(indices.filter((index) => Number.isInteger(index) && index >= 0 && index < object.points.length))], pending: null });
    },
    setObjectTypeVisible(type, visible) {
      publish({ hiddenObjectTypes: visible ? state.hiddenObjectTypes.filter((entry) => entry !== type)
        : state.hiddenObjectTypes.includes(type) ? state.hiddenObjectTypes : [...state.hiddenObjectTypes, type] });
    },
    async createObject() {
      if (state.mode === "tiles" || state.busy) return false;
      const board = options.board();
      const points = cellOutline(board, state.cursor.x, state.cursor.y);
      const at = state.mode === "sprites" ? tileBasePoint(board, state.cursor) : points[0]!;
      return appendObject(state.mode, at, polygonMode() ? points : []);
    },
    async removeObject() {
      const selected = state.objectSelection;
      if (selected === null) return false;
      const changed = await commitObjects(objectFields(selected.kind, options.board()[selected.kind].filter((_, index) => index !== selected.index)), null);
      if (changed) publish({ pointSelection: [] });
      return changed;
    },
    async reorderObject(index) {
      const selected = state.objectSelection;
      if (selected === null || !Number.isInteger(index)) return false;
      const records = [...options.board()[selected.kind]];
      if (index < 0 || index >= records.length || index === selected.index) return false;
      const [object] = records.splice(selected.index, 1);
      records.splice(index, 0, object!);
      return commitObjects(objectFields(selected.kind, records), { ...selected, index });
    },
    async finishObjectPath(open) {
      const pending = state.pending;
      if (pending?.kind !== "object-path" || !polygonMode()) return false;
      if (pending.points.length < 2) { error("A region needs at least two points. Add another point or press Escape."); return false; }
      const kind = state.mode as "vectors" | "programs";
      if (pending.resume === null) return appendObject(kind, pending.points[0]!, pending.points, open ? 0 : -1);
      const object = options.board()[kind][pending.resume];
      if (object === undefined) return false;
      return replaceObject({ ...object, points: pending.points, closed: open ? 0 : object.closed === 0 ? -1 : object.closed });
    },
    resumeObjectPath() {
      const object = selectedObject(), selected = state.objectSelection;
      if (object === null || selected === null || !("points" in object) || !polygonMode() || state.busy) return;
      const at = object.points.at(-1) ?? tileBasePoint(options.board(), state.cursor);
      publish({ tool: "draw", pending: { kind: "object-path", points: object.points, current: at, resume: selected.index }, message: null });
    },
    async subdivideObject() {
      const object = selectedObject();
      if (object === null || !("points" in object)) return false;
      const selected = state.pointSelection.length === 0 ? null : new Set(state.pointSelection);
      const points: Pixel[] = [];
      for (let index = 0; index < object.points.length; index += 1) {
        const point = object.points[index]!;
        points.push(point);
        const nextIndex = (index + 1) % object.points.length;
        if (nextIndex === 0 && object.closed === 0) continue;
        if (selected !== null && (!selected.has(index) || !selected.has(nextIndex))) continue;
        const next = object.points[nextIndex]!;
        points.push({ x: Math.round((point.x + next.x) / 2), y: Math.round((point.y + next.y) / 2) });
      }
      if (points.length === object.points.length) { info("Select both ends of a segment to subdivide it."); return false; }
      const changed = await replaceObject({ ...object, points });
      if (changed) publish({ pointSelection: [] });
      return changed;
    },
    async deletePoints() {
      const object = selectedObject();
      if (object === null || !("points" in object) || state.pointSelection.length === 0) {
        info("Select region points to delete, or use Remove slot and renumber in the inspector.");
        return false;
      }
      const selected = new Set(state.pointSelection);
      const points = object.points.filter((_, index) => !selected.has(index));
      if (points.length < 2) { error("Keep at least two region points. Use Remove slot and renumber to remove the object."); return false; }
      const changed = await replaceObject({ ...object, points });
      if (changed) publish({ pointSelection: [] });
      return changed;
    },
    setLayer(layer) {
      const board = options.board();
      const next = Math.max(0, Math.min(Math.trunc(layer), board.layers - 1));
      publish({ layer: next, hidden: state.hidden.filter((index) => index !== next), pending: null, message: null });
    },
    setLayerVisible(layer, visible) {
      if (!visible && layer === state.layer) {
        error("The current layer cannot be hidden. Choose another layer first.");
        return false;
      }
      const hidden = visible ? state.hidden.filter((index) => index !== layer) : state.hidden.includes(layer) ? state.hidden : [...state.hidden, layer].sort((a, b) => a - b);
      publish({ hidden, message: null });
      return true;
    },
    showOnlyCurrent() {
      const layers = options.board().layers;
      publish({ hidden: Array.from({ length: layers }, (_, index) => index).filter((index) => index !== state.layer), showBackground: false, message: null });
    },
    showAll() {
      publish({ hidden: [], showBackground: true, message: null });
    },
    toggleBackground() {
      publish({ showBackground: !state.showBackground });
    },
    toggleGrid() {
      publish({ grid: !state.grid });
    },
    setViewSize(width, height) {
      if (width === state.viewport.width && height === state.viewport.height) return;
      viewportTo({ ...state.viewport, width, height });
    },
    scrollBy(dx, dy) {
      const zoom = zoomOf(state.viewport);
      viewportTo({ ...state.viewport, x: state.viewport.x + dx / zoom, y: state.viewport.y + dy / zoom });
    },
    wheel(delta, modifiers, focus) {
      if (modifiers.ctrl === true) {
        if (delta < 0) editor.zoomIn(focus);
        else if (delta > 0) editor.zoomOut(focus);
        return;
      }
      const across = modifiers.shift === true ? state.scrollAxis === "vertical" : state.scrollAxis === "horizontal";
      if (across) editor.scrollBy(delta, 0);
      else editor.scrollBy(0, delta);
    },
    toggleScrollAxis() {
      publish({ scrollAxis: state.scrollAxis === "vertical" ? "horizontal" : "vertical" });
    },
    zoomIn(focus) {
      editor.setZoomIndex(state.viewport.zoomIndex + 1, focus);
    },
    zoomOut(focus) {
      editor.setZoomIndex(state.viewport.zoomIndex - 1, focus);
    },
    setZoomIndex(index, focus) {
      const bounded = Math.max(0, Math.min(ZOOM_STEPS.length - 1, index));
      if (bounded === state.viewport.zoomIndex) return;
      publish({ viewport: zoomTo(options.board(), state.viewport, bounded, focus) });
    },
    pointerDown(screen, modifiers, button = 0) {
      if (state.busy) return;
      if (button === 1) return editor.toggleScrollAxis();
      if (state.mode !== "tiles" && state.tool !== "scroll" && state.tool !== "zoom") {
        objectPointerDown(screenToBoard(state.viewport, screen.x, screen.y), modifiers, button);
        return;
      }
      if (button !== 0) return;
      const pixel = screenToBoard(state.viewport, screen.x, screen.y);
      const cell = pixelToCell(options.board(), pixel.x, pixel.y);
      lastPixel = pixel;
      const tool = state.tool;
      if (tool === "scroll") return publish({ pending: { kind: "pan", from: screen }, message: null });
      if (tool === "zoom") return modifiers.shift === true || modifiers.alt === true ? editor.zoomOut(screen) : editor.zoomIn(screen);
      if (cell === null) return publish({ message: { kind: "info", text: "That place is not on the board." } });
      publish({ cursor: cell, hover: cell });
      if (tool === "draw") {
        const brush = options.brush();
        if (brush === null) return error("Choose a tile in the tileset browser first.");
        if (brush.kind === "stamp") return publish({ pending: { kind: "stamp", at: cell }, message: null });
        strokeKeys = new Set([key(cell)]);
        strokeShift = modifiers.shift === true ? new Set([key(cell)]) : new Set();
        return publish({ pending: { kind: "stroke", cells: [cell] }, message: null });
      }
      if (tool === "erase") {
        strokeKeys = new Set([key(cell)]);
        strokeShift = modifiers.shift === true ? new Set([key(cell)]) : new Set();
        return publish({ pending: { kind: "stroke", cells: [cell] }, message: null });
      }
      if (tool === "flood" || tool === "dropper") return publish({ pending: { kind: "point", cell }, message: null });
      if (tool === "rectangle") return startCorner(cell, modifiers, false);
      const selection = state.selection;
      if (selection !== null && selection.layer === state.layer && rectContains(selection.rect, cell)) {
        return publish({ pending: { kind: "move", anchor: cell, current: cell, copy: modifiers.ctrl === true }, message: null });
      }
      startCorner(cell, modifiers, false);
    },
    pointerMove(screen, modifiers) {
      const pixel = screenToBoard(state.viewport, screen.x, screen.y);
      const cell = pixelToCell(options.board(), pixel.x, pixel.y);
      const hover = state.hover;
      const hoverChanged = (cell === null) !== (hover === null) || (cell !== null && hover !== null && key(cell) !== key(hover));
      const pending = state.pending;
      if (isObjectGesture(pending)) {
        moveObjectGesture(pixel, modifiers);
        if (hoverChanged) publish({ hover: cell });
        return;
      }
      if (pending === null) {
        if (hoverChanged) publish({ hover: cell });
        return;
      }
      if (pending.kind === "pan") {
        editor.scrollBy(pending.from.x - screen.x, pending.from.y - screen.y);
        publish({ pending: { kind: "pan", from: screen } });
      } else if (pending.kind === "stroke") {
        const from = lastPixel ?? pixel;
        const added = cellsBetween(options.board(), from, pixel).filter((crossed) => !strokeKeys.has(key(crossed)));
        lastPixel = pixel;
        for (const crossed of added) {
          strokeKeys.add(key(crossed));
          if (modifiers.shift === true) strokeShift.add(key(crossed));
        }
        publish({ hover: cell, ...(added.length === 0 ? {} : { pending: { kind: "stroke", cells: [...pending.cells, ...added] } }) });
      } else if (cell !== null) {
        if (pending.kind === "stamp") publish({ hover: cell, pending: { kind: "stamp", at: cell } });
        else if (pending.kind === "point") publish({ hover: cell, pending: { kind: "point", cell } });
        else if (pending.kind === "corner") publish({ hover: cell, pending: { ...pending, current: cell, filled: modifiers.ctrl === true } });
        else publish({ hover: cell, pending: { ...pending, current: cell, copy: modifiers.ctrl === true } });
      } else if (hoverChanged) {
        publish({ hover: null });
      }
    },
    async pointerUp(screen, modifiers) {
      if (isObjectGesture(state.pending)) {
        await finishObjectGesture(screenToBoard(state.viewport, screen.x, screen.y), modifiers);
        return;
      }
      const pending = state.pending;
      if (pending === null || pending.kind === "pan") {
        if (pending !== null) publish({ pending: null });
        return;
      }
      const pixel = screenToBoard(state.viewport, screen.x, screen.y);
      const at = pixelToCell(options.board(), pixel.x, pixel.y);
      const board = options.board();
      const layer = state.layer;
      if (pending.kind === "stroke") {
        const tool = state.tool;
        const tile = tool === "erase" ? "" : needTile();
        if (tile === null) return void publish({ pending: null });
        // The release position counts even when the pointer did not move after its last move event.
        const crossed = cellsBetween(board, lastPixel ?? pixel, pixel);
        for (const released of crossed) if (modifiers.shift === true) strokeShift.add(key(released));
        const stroke = [...pending.cells, ...crossed];
        const shiftedCells = new Set(stroke.filter((painted) => strokeShift.has(key(painted))).map((painted) => painted.y * board.grid.width + painted.x));
        await commit(tool === "erase" ? "erase" : "draw", { ok: true, cells: paintAutotileStroke(board, layer, stroke, tile, options.autotileEnabled?.() === true, shiftedCells, brushAutotileSource()) });
        strokeShift = new Set();
      } else if (pending.kind === "stamp") {
        const brush = options.brush();
        if (brush === null || brush.kind !== "stamp") return void publish({ pending: null });
        await commit("stamp", stampCells(board, layer, brush.stamp, at ?? pending.at));
      } else if (pending.kind === "point") {
        publish({ pending: null });
        await place(state.tool, at ?? pending.cell, modifiers);
      } else if (pending.kind === "corner") {
        await finishCorner(pending, at ?? pending.current, modifiers);
      } else {
        const to = at ?? pending.current;
        publish({ pending: null });
        await moveSelection(to.x - pending.anchor.x, to.y - pending.anchor.y, modifiers.ctrl === true || pending.copy);
      }
    },
    pointerCancel() {
      lastPixel = null;
      strokeShift = new Set();
      if (state.pending !== null) publish({ pending: null });
    },
    moveCursor(dx, dy) {
      const board = options.board();
      // Over a gap (cells of the stored grid that have no place on the picture) the cursor goes on to the next cell that has one.
      let to = { x: state.cursor.x + dx, y: state.cursor.y + dy };
      while ((dx !== 0 || dy !== 0) && cellInGrid(board, to.x, to.y) && !cellOnBoard(board, to.x, to.y)) to = { x: to.x + dx, y: to.y + dy };
      if (!cellOnBoard(board, to.x, to.y)) return;
      const pending = state.pending;
      if (isObjectGesture(pending)) {
        const point = tileBasePoint(board, to);
        if (pending.kind === "object-path" || (pending.kind === "object-rectangle" && pending.keyboard)) {
          publish({ pending: { ...pending, current: snapObjectPoint(board, point) } });
        }
      }
      publish({
        cursor: to,
        viewport: revealCell(board, state.viewport, to.x, to.y),
        ...(pending !== null && pending.kind === "corner" ? { pending: { ...pending, current: to } } : {}),
      });
    },
    setCursor(cell) {
      if (!cellOnBoard(options.board(), cell.x, cell.y)) return;
      publish({ cursor: cell, viewport: revealCell(options.board(), state.viewport, cell.x, cell.y) });
    },
    async activate(modifiers) {
      if (state.busy) return;
      if (state.mode !== "tiles" && state.tool !== "scroll" && state.tool !== "zoom") {
        const point = tileBasePoint(options.board(), state.cursor);
        if (state.pending?.kind === "object-rectangle" && state.pending.keyboard) {
          await finishObjectGesture(point, modifiers);
        } else {
          objectPointerDown(point, modifiers, 0, true);
          if (state.pending?.kind === "object-move" || state.pending?.kind === "object-box") await finishObjectGesture(point, modifiers);
        }
        return;
      }
      const cursor = state.cursor;
      const pending = state.pending;
      const tool = state.tool;
      if (tool === "rectangle" || tool === "select") {
        if (pending !== null && pending.kind === "corner" && pending.keyboard) await finishCorner(pending, cursor, modifiers);
        else startCorner(cursor, modifiers, true);
        return;
      }
      if (tool === "scroll") return info("The Scroll tool moves the view with the pointer; use the arrow keys on the cell grid to move around.");
      if (tool === "zoom") return modifiers.shift === true || modifiers.alt === true ? editor.zoomOut() : editor.zoomIn();
      await place(tool, cursor, modifiers);
    },
    cancel() {
      lastPixel = null;
      if (state.pending !== null) publish({ pending: null, message: null });
      else if (state.selection !== null) publish({ selection: null, message: null });
      else if (state.objectSelection !== null) publish({ objectSelection: null, pointSelection: [], message: null });
    },
    selectAll() {
      const board = options.board();
      if (state.mode !== "tiles") {
        const kind = state.mode;
        const indices = board[kind].flatMap((object, index) => objectVisible(kind, object) ? [index] : []);
        // Nothing to select clears what was selected: a hidden earlier selection must never be copied or cut by accident.
        if (indices.length === 0) {
          publish({ objectSelection: null, objectGroup: [], pointSelection: [], pending: null, message: { kind: "info", text: `There are no visible ${kind} on this layer, so nothing was selected.` } });
          return;
        }
        publish({ objectSelection: { kind, index: indices[0]! }, objectGroup: indices, pointSelection: [], pending: null, message: { kind: "info", text: `Selected ${indices.length} ${kind}.` } });
        return;
      }
      if (board.grid.width === 0 || board.grid.height === 0) return;
      publish({ selection: { layer: state.layer, rect: { x0: 0, y0: 0, x1: board.grid.width - 1, y1: board.grid.height - 1 } }, pending: null, message: null });
    },
    selectAllPoints() {
      const object = selectedObject();
      if (object !== null && "points" in object) publish({ pointSelection: object.points.map((_, index) => index), pending: null });
    },
    copy: copyToClipboard,
    cut: cutToClipboard,
    paste: pasteFromClipboard,
    async eraseSelection() {
      if (state.mode !== "tiles") {
        await editor.deletePoints();
        return;
      }
      const selection = state.selection;
      if (selection === null) return error("Select some cells first.");
      const board = options.board();
      const cells: Cell[] = [];
      for (let y = selection.rect.y0; y <= selection.rect.y1; y += 1) for (let x = selection.rect.x0; x <= selection.rect.x1; x += 1) cells.push({ x, y });
      await commit("erase", { ok: true, cells: paintCells(board, selection.layer, cells, "") });
    },
    moveSelectionBy: moveSelection,
    pictureRequest() {
      const board = options.board();
      const hidden = new Set(state.hidden);
      return {
        visibleLayers: Array.from({ length: board.layers }, (_, index) => index).filter((index) => !hidden.has(index)),
        showBackground: state.showBackground,
        showSprites: true,
      };
    },
  };
  return editor;
}

/**
 * The cells a gesture in progress would touch, for the canvas to outline before anything is committed: the cells a drag
 * has crossed, the corners' rectangle (hollow for Rectangle unless Ctrl fills it), the selection moved by the drag, or the
 * footprint of a stamp. Only cells on the board are named.
 */
export function pendingCells(board: ToolBoard, state: BoardEditorState, stamp: Stamp | null): Cell[] {
  const pending = state.pending;
  if (pending === null || isObjectGesture(pending)) return [];
  const onBoard = (cells: readonly Cell[]): Cell[] => cells.filter((cell) => cellOnBoard(board, cell.x, cell.y));
  switch (pending.kind) {
    case "stroke":
      return onBoard(pending.cells);
    case "point":
      return onBoard([pending.cell]);
    case "pan":
      return [];
    case "stamp": {
      if (stamp === null) return onBoard([pending.at]);
      const cells: Cell[] = [];
      for (let y = 0; y < stamp.height; y += 1) for (let x = 0; x < stamp.width; x += 1) cells.push({ x: pending.at.x + x, y: pending.at.y + y });
      return onBoard(cells);
    }
    case "corner": {
      if (state.tool === "rectangle") return rectangleRegion(board, pending.anchor, pending.current, pending.filled);
      const rect = cellRect(pending.anchor, pending.current);
      const cells: Cell[] = [];
      for (let y = rect.y0; y <= rect.y1; y += 1) for (let x = rect.x0; x <= rect.x1; x += 1) cells.push({ x, y });
      return onBoard(cells);
    }
    case "move": {
      const selection = state.selection;
      if (selection === null) return [];
      const dx = pending.current.x - pending.anchor.x;
      const dy = pending.current.y - pending.anchor.y;
      const cells: Cell[] = [];
      for (let y = selection.rect.y0; y <= selection.rect.y1; y += 1) for (let x = selection.rect.x0; x <= selection.rect.x1; x += 1) cells.push({ x: x + dx, y: y + dy });
      return onBoard(cells);
    }
  }
}
