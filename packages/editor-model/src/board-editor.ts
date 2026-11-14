import type { ApplyResult } from "./binary-document.ts";
import type { BoardCommand, TileGesture } from "./board-document.ts";
import { boardTileAt } from "./board-document.ts";
import {
  DEFAULT_ZOOM_INDEX,
  ZOOM_STEPS,
  cellInGrid,
  cellOnBoard,
  clampViewport,
  layoutOf,
  pixelToCell,
  revealCell,
  screenToBoard,
  zoomOf,
  zoomTo,
  type Cell,
  type Pixel,
  type Viewport,
} from "./board-geometry.ts";
import {
  cellRect,
  cellsBetween,
  floodFill,
  moveCells,
  paintCells,
  rectContains,
  rectangleCells,
  stampCells,
  type BoardTool,
  type CellRect,
  type Stamp,
  type ToolBoard,
  type ToolOutcome,
} from "./board-tools.ts";

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
  | { readonly kind: "tile"; readonly tile: string; readonly label: string }
  | { readonly kind: "stamp"; readonly stamp: Stamp };

export interface EditorPreferences {
  /** After a flood fill, switch back to Draw (`board.revertToDrawAfterFlood`). */
  readonly revertToDrawAfterFlood: boolean;
  /** A flood fill also continues to the same cell on every other layer (`board.recursiveFlood`). */
  readonly recursiveFlood: boolean;
}

export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = { revertToDrawAfterFlood: true, recursiveFlood: false };

export interface BoardEditorOptions {
  /** The board as it is now. */
  board(): ToolBoard;
  /** Apply one command to the document. A host may answer later. */
  apply(command: BoardCommand): ApplyResult | Promise<ApplyResult>;
  /** The retained brush, or `null` when none is chosen. */
  brush(): Brush | null;
  /** Make `tile` the brush (the dropper). Answer `false` when it cannot be placed in a browser. */
  pickTile(tile: string): boolean;
  /** The board-editor preferences now in force. */
  preferences(): EditorPreferences;
  /** The size of the canvas in screen pixels. */
  readonly viewSize?: { readonly width: number; readonly height: number };
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
  | { readonly kind: "pan"; readonly from: Pixel };

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
}

export interface BoardEditor {
  getState(): BoardEditorState;
  subscribe(listener: () => void): () => void;
  /** Bring the state in line with the board after it changed under the editor (an undo, a reload). */
  sync(): void;
  setTool(tool: BoardTool): void;
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
  selectAll(): void;
  eraseSelection(): Promise<void>;
  /** Move or copy the selection by whole columns and rows (the number alternative to dragging it). */
  moveSelectionBy(dx: number, dy: number, copy: boolean): Promise<void>;
  /** What the picture should show now. */
  pictureRequest(): PictureRequest;
}

const key = (cell: Cell): string => `${cell.x},${cell.y}`;

/** Make the editor of one board canvas. */
export function createBoardEditor(options: BoardEditorOptions): BoardEditor {
  const listeners = new Set<() => void>();
  const view = options.viewSize ?? { width: 640, height: 384 };
  let lastPixel: Pixel | null = null;
  let strokeKeys = new Set<string>();
  let state: BoardEditorState = {
    tool: "draw",
    layer: 0,
    hidden: [],
    showBackground: true,
    grid: true,
    viewport: clampViewport(options.board(), { x: 0, y: 0, zoomIndex: DEFAULT_ZOOM_INDEX, width: view.width, height: view.height }),
    scrollAxis: "vertical",
    cursor: { x: 0, y: 0 },
    hover: null,
    selection: null,
    pending: null,
    message: null,
    busy: false,
  };

  const publish = (patch: Partial<BoardEditorState>): void => {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  };
  const info = (text: string): void => publish({ message: { kind: "info", text } });
  const error = (text: string): void => publish({ message: { kind: "error", text } });
  const viewportTo = (viewport: Viewport): void => publish({ viewport: clampViewport(options.board(), viewport) });

  /** Apply a finished gesture as one edit. Answers whether the document changed. */
  const commit = async (gesture: TileGesture, outcome: ToolOutcome): Promise<boolean> => {
    if (!outcome.ok) {
      publish({ pending: null, message: { kind: "error", text: outcome.message } });
      return false;
    }
    if (outcome.cells.length === 0) {
      publish({ pending: null, message: { kind: "info", text: "Nothing changed: those cells already show that." } });
      return false;
    }
    publish({ pending: null, busy: true, message: null });
    let result: ApplyResult;
    try {
      result = await options.apply({ type: "set-tiles", gesture, cells: outcome.cells });
    } catch (thrown) {
      result = { ok: false, rejection: { reason: "invalid", message: thrown instanceof Error ? thrown.message : String(thrown) } };
    }
    if (!result.ok) {
      publish({ busy: false, message: { kind: "error", text: `Nothing was changed: ${result.rejection.message}` } });
      return false;
    }
    publish({ busy: false, message: null });
    return true;
  };

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

  const place = async (tool: BoardTool, cell: Cell): Promise<void> => {
    const board = options.board();
    const layer = state.layer;
    if (tool === "draw") {
      const brush = options.brush();
      if (brush === null) return error("Choose a tile in the tileset browser first.");
      if (brush.kind === "stamp") {
        await commit("stamp", stampCells(board, layer, brush.stamp, cell));
        return;
      }
      await commit("draw", { ok: true, cells: paintCells(board, layer, [cell], brush.tile) });
    } else if (tool === "erase") {
      await commit("erase", { ok: true, cells: paintCells(board, layer, [cell], "") });
    } else if (tool === "flood") {
      const tile = needTile();
      if (tile === null) return;
      const changed = await commit("flood", floodFill(board, layer, cell, tile, options.preferences().recursiveFlood));
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

  const finishCorner = async (pending: Extract<PendingGesture, { kind: "corner" }>, current: Cell): Promise<void> => {
    if (state.tool === "select") {
      publish({ pending: null, message: null, selection: { layer: state.layer, rect: cellRect(pending.anchor, current) } });
      return;
    }
    const tile = needTile();
    if (tile === null) {
      publish({ pending: null });
      return;
    }
    await commit("rectangle", rectangleCells(options.board(), state.layer, pending.anchor, current, pending.filled, tile));
  };

  const startCorner = (cell: Cell, modifiers: Modifiers, keyboard: boolean): void => {
    if (state.tool === "rectangle" && layoutOf(options.board()) === "iso-stacked") {
      error("The rectangle tool is not available on an iso-stacked board; draw or flood fill instead.");
      return;
    }
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
      const cursor = cellInGrid(board, state.cursor.x, state.cursor.y) ? state.cursor : { x: 0, y: 0 };
      const selection = state.selection !== null && state.selection.layer < board.layers
        && cellInGrid(board, state.selection.rect.x0, state.selection.rect.y0) && cellInGrid(board, state.selection.rect.x1, state.selection.rect.y1)
        ? state.selection
        : null;
      const viewport = clampViewport(board, state.viewport);
      const same = layer === state.layer && hidden.length === state.hidden.length && cursor === state.cursor && selection === state.selection
        && viewport.x === state.viewport.x && viewport.y === state.viewport.y;
      if (!same) publish({ layer, hidden, cursor, selection, viewport });
    },
    setTool(tool) {
      if (tool === state.tool && state.pending === null) return;
      lastPixel = null;
      publish({ tool, pending: null, message: null });
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
        return publish({ pending: { kind: "stroke", cells: [cell] }, message: null });
      }
      if (tool === "erase") {
        strokeKeys = new Set([key(cell)]);
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
        for (const crossed of added) strokeKeys.add(key(crossed));
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
        await commit(tool === "erase" ? "erase" : "draw", { ok: true, cells: paintCells(board, layer, pending.cells, tile) });
      } else if (pending.kind === "stamp") {
        const brush = options.brush();
        if (brush === null || brush.kind !== "stamp") return void publish({ pending: null });
        await commit("stamp", stampCells(board, layer, brush.stamp, at ?? pending.at));
      } else if (pending.kind === "point") {
        publish({ pending: null });
        await place(state.tool, at ?? pending.cell);
      } else if (pending.kind === "corner") {
        await finishCorner(pending, at ?? pending.current);
      } else {
        const to = at ?? pending.current;
        publish({ pending: null });
        await moveSelection(to.x - pending.anchor.x, to.y - pending.anchor.y, modifiers.ctrl === true || pending.copy);
      }
    },
    pointerCancel() {
      lastPixel = null;
      if (state.pending !== null) publish({ pending: null });
    },
    moveCursor(dx, dy) {
      const board = options.board();
      const to = { x: state.cursor.x + dx, y: state.cursor.y + dy };
      if (!cellOnBoard(board, to.x, to.y)) return;
      const pending = state.pending;
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
      const cursor = state.cursor;
      const pending = state.pending;
      const tool = state.tool;
      if (tool === "rectangle" || tool === "select") {
        if (pending !== null && pending.kind === "corner" && pending.keyboard) await finishCorner(pending, cursor);
        else startCorner(cursor, modifiers, true);
        return;
      }
      if (tool === "scroll") return info("The Scroll tool moves the view with the pointer; use the arrow keys on the cell grid to move around.");
      if (tool === "zoom") return modifiers.shift === true || modifiers.alt === true ? editor.zoomOut() : editor.zoomIn();
      await place(tool, cursor);
    },
    cancel() {
      lastPixel = null;
      if (state.pending !== null) publish({ pending: null, message: null });
      else if (state.selection !== null) publish({ selection: null, message: null });
    },
    selectAll() {
      const board = options.board();
      if (board.grid.width === 0 || board.grid.height === 0) return;
      publish({ selection: { layer: state.layer, rect: { x0: 0, y0: 0, x1: board.grid.width - 1, y1: board.grid.height - 1 } }, pending: null, message: null });
    },
    async eraseSelection() {
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
  if (pending === null) return [];
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
      const rect = cellRect(pending.anchor, pending.current);
      const cells: Cell[] = [];
      const hollow = state.tool === "rectangle" && !pending.filled;
      for (let y = rect.y0; y <= rect.y1; y += 1) {
        for (let x = rect.x0; x <= rect.x1; x += 1) if (!hollow || x === rect.x0 || x === rect.x1 || y === rect.y0 || y === rect.y1) cells.push({ x, y });
      }
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
