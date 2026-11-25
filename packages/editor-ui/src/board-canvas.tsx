import type { Colorref } from "@tk-reawakened/core";
import {
  cellCentre,
  cellsBetween,
  lightNodeAt,
  moveLightNode,
  paintShade,
  floodShade,
  rectangleShade,
  rectangleRegion,
  shadeAt,
  type BoardCommand,
  cellOnBoard,
  cellOutline,
  cellsInRect,
  pendingCells,
  pixelToCell,
  rectangleObjectPoints,
  screenToBoard,
  translatedObject,
  zoomOf,
  type BoardDocumentSnapshot,
  type BoardEditor,
  type BoardEditorState,
  type BoardPicture,
  type Cell,
  type Modifiers,
  type Pixel,
  type Stamp,
} from "@tk-reawakened/editor-model";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ShadeUi } from "./board-lighting-view.tsx";

/** The most cells outlined in one frame, so a very zoomed-out view of a huge board stays quick. */
const MAX_OUTLINED = 20_000;

const COLOURS = {
  background: "#1e1e1e",
  grid: "rgba(255, 255, 255, 0.28)",
  selection: "#00b7ff",
  pending: "rgba(0, 183, 255, 0.4)",
  cursor: "#ffd400",
  hover: "rgba(255, 255, 255, 0.9)",
} as const;

export interface BoardCanvasProps {
  readonly editor: BoardEditor;
  readonly state: BoardEditorState;
  readonly board: BoardDocumentSnapshot;
  readonly picture: BoardPicture | null;
  readonly stamp: Stamp | null;
  readonly startPicking?: boolean;
  readonly startMarker?: { readonly x: number; readonly y: number; readonly layer: number } | null;
  readonly onStartCell?: (cell: Cell) => void;
  readonly colourPicking?: boolean;
  readonly onColourPixel?: (colour: Colorref) => void;
  /** Shading and lighting on the canvas: while its mode is not `off`, the pointer paints shade cells or moves light nodes. */
  readonly shade?: {
    readonly ui: ShadeUi;
    readonly onUi: (next: ShadeUi) => void;
    readonly submit: (command: BoardCommand) => Promise<boolean>;
    readonly onMessage: (text: string | null) => void;
    readonly disabled: boolean;
  };
}

/** A shading or lighting gesture in progress on the canvas. */
type ShadeGesture =
  | { readonly kind: "stroke"; readonly cells: readonly Cell[]; readonly erase: boolean; readonly last: Pixel }
  | { readonly kind: "rectangle"; readonly anchor: Cell; readonly current: Cell; readonly filled: boolean }
  | { readonly kind: "node"; readonly light: number; readonly node: number; readonly current: Pixel };

/** How near, in screen pixels, the pointer must be to grab a light's node. */
const NODE_GRAB = 9;

function outline(context: CanvasRenderingContext2D, board: BoardDocumentSnapshot, cell: Cell): void {
  const corners = cellOutline(board, cell.x, cell.y);
  context.beginPath();
  corners.forEach((corner, index) => (index === 0 ? context.moveTo(corner.x, corner.y) : context.lineTo(corner.x, corner.y)));
  context.closePath();
}

function regionPath(context: CanvasRenderingContext2D, points: readonly Pixel[], closed: boolean): void {
  context.beginPath();
  points.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y));
  if (closed) context.closePath();
}

/** Editor guides are separate from the engine picture; missing art is a labelled box, never a fake decoded texture. */
function paintObjects(context: CanvasRenderingContext2D, props: BoardCanvasProps): void {
  const { board, state, picture } = props;
  const zoom = zoomOf(state.viewport);
  const selected = state.objectSelection;
  const pending = state.pending;
  const delta = pending?.kind === "object-move" ? pending.delta : null;
  const visible = (layer: number): boolean => layer >= 1 && layer <= board.layers && !state.hidden.includes(layer - 1);
  const bounds = picture?.ok ? picture.objectBounds : [
    ...board.sprites.map((sprite, index) => ({ kind: "sprites" as const, index, left: sprite.x - 16, top: sprite.y - 32, width: 32, height: 32, placeholder: true })),
    ...board.images.map((image, index) => ({ kind: "images" as const, index, left: image.left, top: image.top, width: 32, height: 32, placeholder: true })),
  ];
  for (const boundsOf of bounds) {
    const object = board[boundsOf.kind][boundsOf.index];
    if (object === undefined || !visible(object.layer)) continue;
    const active = selected?.kind === boundsOf.kind && selected.index === boundsOf.index;
    const grouped = state.mode === boundsOf.kind && state.objectGroup.includes(boundsOf.index);
    if (!boundsOf.placeholder && !active && !grouped && state.mode !== boundsOf.kind) continue;
    const left = boundsOf.left + (active ? delta?.x ?? 0 : 0);
    const top = boundsOf.top + (active ? delta?.y ?? 0 : 0);
    if (boundsOf.placeholder) {
      context.fillStyle = "#454545";
      context.fillRect(left, top, boundsOf.width, boundsOf.height);
      context.strokeStyle = "#b7b7b7";
      context.lineWidth = 1 / zoom;
      context.beginPath();
      context.moveTo(left, top);
      context.lineTo(left + boundsOf.width, top + boundsOf.height);
      context.moveTo(left + boundsOf.width, top);
      context.lineTo(left, top + boundsOf.height);
      context.stroke();
      context.fillStyle = "#fff";
      context.font = `${9 / zoom}px sans-serif`;
      context.fillText(`${boundsOf.kind === "sprites" ? "S" : "I"}${boundsOf.index}`, left + 2 / zoom, top + 10 / zoom);
    }
    context.lineWidth = (active || grouped ? 3 : 1) / zoom;
    context.strokeStyle = active || grouped ? COLOURS.selection : "#b7b7b7";
    context.setLineDash(active && delta !== null ? [4 / zoom, 3 / zoom] : []);
    context.strokeRect(left, top, boundsOf.width, boundsOf.height);
    context.setLineDash([]);
  }
  if (state.mode === "vectors" || state.mode === "programs") {
    const colours: Readonly<Record<number, string>> = { 0: "#aaa", 1: "#fff", 2: "#30dd78", 4: "#ffa34c", 8: "#4b9dff", 16: "#ff73d7" };
    for (const kind of ["vectors", "programs"] as const) {
      board[kind].forEach((object, index) => {
        const type = "type" in object ? object.type : "program";
        if (!visible(object.layer) || state.hiddenObjectTypes.includes(type)) return;
        const active = selected?.kind === kind && selected.index === index;
        const grouped = state.mode === kind && state.objectGroup.includes(index);
        const points = active && delta !== null ? translatedObject(object, delta, state.pointSelection).points : object.points;
        regionPath(context, points, object.closed !== 0);
        context.lineWidth = (active || grouped ? 3 : 1.5) / zoom;
        context.strokeStyle = active || grouped ? COLOURS.selection : type === "program" ? "#ffe14a" : colours[type] ?? "#aaa";
        context.stroke();
        if (active) {
          for (let at = 0; at < points.length; at += 1) {
            const point = points[at]!;
            context.fillStyle = state.pointSelection.includes(at) ? "#fff" : COLOURS.selection;
            context.fillRect(point.x - 3 / zoom, point.y - 3 / zoom, 6 / zoom, 6 / zoom);
          }
          if (points.length > 0) {
            const xs = points.map((point) => point.x), ys = points.map((point) => point.y);
            context.lineWidth = 1 / zoom;
            context.setLineDash([4 / zoom, 3 / zoom]);
            context.strokeRect(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
            context.setLineDash([]);
          }
        }
      });
    }
  }
  if (pending?.kind === "object-path") {
    regionPath(context, [...pending.points, pending.current], false);
    context.strokeStyle = COLOURS.selection;
    context.lineWidth = 2 / zoom;
    context.stroke();
    for (const point of pending.points) {
      context.fillStyle = "#fff";
      context.fillRect(point.x - 3 / zoom, point.y - 3 / zoom, 6 / zoom, 6 / zoom);
    }
  } else if (pending?.kind === "object-rectangle") {
    regionPath(context, rectangleObjectPoints(board, pending.anchor, pending.current), true);
    context.strokeStyle = COLOURS.selection;
    context.lineWidth = 2 / zoom;
    context.stroke();
  } else if (pending?.kind === "object-box") {
    context.strokeStyle = COLOURS.selection;
    context.lineWidth = 1 / zoom;
    context.strokeRect(pending.anchor.x, pending.anchor.y, pending.current.x - pending.anchor.x, pending.current.y - pending.anchor.y);
  }
}


/** The lights' nodes (with their numbers) and the cells a shading gesture in progress would set. */
function paintShadeOverlay(context: CanvasRenderingContext2D, props: BoardCanvasProps, gesture: ShadeGesture | null, stroke: (cells: readonly Cell[], style: string, width: number, fill?: string) => void): void {
  const shade = props.shade;
  if (shade === undefined || shade.ui.mode === "off") return;
  const { board, state } = props;
  const zoom = zoomOf(state.viewport);
  if (gesture?.kind === "stroke") stroke(gesture.cells.filter((cell) => cellOnBoard(board, cell.x, cell.y)), gesture.erase ? "#ff6b6b" : COLOURS.selection, 2, COLOURS.pending);
  if (gesture?.kind === "rectangle") stroke(rectangleRegion(board, gesture.anchor, gesture.current, gesture.filled), COLOURS.selection, 2, COLOURS.pending);
  board.lights.forEach((light, index) => {
    const nodes = gesture?.kind === "node" && gesture.light === index ? light.nodes.map((node, at) => at === gesture.node ? gesture.current : node) : light.nodes;
    context.lineWidth = 1.5 / zoom;
    context.strokeStyle = "#ffd400";
    context.beginPath();
    nodes.forEach((node, at) => at === 0 ? context.moveTo(node.x, node.y) : context.lineTo(node.x, node.y));
    context.stroke();
    nodes.forEach((node, at) => {
      context.fillStyle = "#ffd400";
      context.fillRect(node.x - 4 / zoom, node.y - 4 / zoom, 8 / zoom, 8 / zoom);
      context.fillStyle = "#fff";
      context.font = `${11 / zoom}px sans-serif`;
      context.fillText(`${index + 1}.${at + 1}`, node.x + 6 / zoom, node.y - 6 / zoom);
    });
  });
}

/** Draw the picture, the grid, the selection, the gesture in progress and the cursor. */
function paint(context: CanvasRenderingContext2D, source: CanvasImageSource | null, picture: { readonly width: number; readonly height: number } | null, props: BoardCanvasProps, gesture: ShadeGesture | null): void {
  const { board, state, stamp } = props;
  const viewport = state.viewport;
  const zoom = zoomOf(viewport);
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = COLOURS.background;
  context.fillRect(0, 0, viewport.width, viewport.height);
  context.setTransform(zoom, 0, 0, zoom, -viewport.x * zoom, -viewport.y * zoom);
  context.imageSmoothingEnabled = false;
  if (source !== null && picture !== null) context.drawImage(source, 0, 0, picture.width, picture.height);
  const visible = cellsInRect(board, viewport.x, viewport.y, viewport.x + viewport.width / zoom, viewport.y + viewport.height / zoom);
  const stroke = (cells: readonly Cell[], style: string, width: number, fill?: string): void => {
    context.lineWidth = width / zoom;
    context.strokeStyle = style;
    for (const cell of cells.slice(0, MAX_OUTLINED)) {
      outline(context, board, cell);
      if (fill !== undefined) {
        context.fillStyle = fill;
        context.fill();
      }
      context.stroke();
    }
  };
  if (state.grid) stroke(visible, COLOURS.grid, 1);
  const selection = state.selection;
  if (selection !== null && selection.layer === state.layer) {
    stroke(visible.filter((cell) => cell.x >= selection.rect.x0 && cell.x <= selection.rect.x1 && cell.y >= selection.rect.y0 && cell.y <= selection.rect.y1), COLOURS.selection, 2);
  }
  stroke(pendingCells(board, state, stamp), COLOURS.selection, 2, COLOURS.pending);
  if (state.hover !== null) stroke([state.hover], COLOURS.hover, 1);
  stroke([state.cursor], COLOURS.cursor, 2);
  paintObjects(context, props);
  paintShadeOverlay(context, props, gesture, stroke);
  if (props.startMarker !== null && props.startMarker !== undefined && props.startMarker.layer === state.layer + 1) {
    const cell = pixelToCell(board, props.startMarker.x, props.startMarker.y);
    if (cell !== null && cellOnBoard(board, cell.x, cell.y)) {
      const point = cellCentre(board, cell.x, cell.y);
      context.lineWidth = 4 / zoom;
      context.strokeStyle = "#101010";
      context.beginPath();
      context.moveTo(point.x - 7, point.y);
      context.lineTo(point.x + 7, point.y);
      context.moveTo(point.x, point.y - 7);
      context.lineTo(point.x, point.y + 7);
      context.stroke();
      context.lineWidth = 2 / zoom;
      context.strokeStyle = "#fff200";
      context.stroke();
    }
  }
}

/**
 * The canvas of the board editor: the engine's picture of the board at the view's zoom, with the grid and the tools'
 * overlays drawn over it (story 12.10). It turns the pointer into the editor's screen positions and nothing else; what a
 * gesture does is the editor's. The picture is a `role="img"`: the cell grid below it is the keyboard and screen-reader
 * way to do everything the pointer can. Size is the canvas's own `width` and `height`, never a style attribute (ADR 0025
 * decision 6).
 */
export function BoardCanvas(props: BoardCanvasProps) {
  const { editor, state, picture } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<ShadeGesture | null>(null);
  const [, redraw] = useState(0);
  const setGesture = (next: ShadeGesture | null): void => { gesture.current = next; redraw((count) => count + 1); };
  // While a mode other than `off` is on, the pointer belongs to shading or lighting, except for the Scroll and Zoom tools.
  const shadeActive = props.shade !== undefined && props.shade.ui.mode !== "off" && state.tool !== "scroll" && state.tool !== "zoom";
  const source = useRef<{ readonly image: CanvasImageSource; readonly width: number; readonly height: number } | null>(null);

  // The picture is put on an off-screen canvas once, and drawn scaled from there for every frame.
  useEffect(() => {
    source.current = null;
    if (picture === null || !picture.ok || typeof ImageData === "undefined" || typeof document === "undefined") return;
    const off = document.createElement("canvas");
    off.width = picture.width;
    off.height = picture.height;
    const context = off.getContext("2d");
    if (context === null) return;
    context.putImageData(new ImageData(new Uint8ClampedArray(picture.rgba), picture.width, picture.height), 0, 0);
    source.current = { image: off, width: picture.width, height: picture.height };
  }, [picture]);

  useEffect(() => {
    const target = canvas.current;
    if (target === null) return;
    const context = target.getContext("2d");
    if (context === null) return;
    paint(context, source.current?.image ?? null, source.current, props, gesture.current);
  });

  const position = (event: PointerEvent | WheelEvent): Pixel => {
    const target = canvas.current;
    if (target === null) return { x: 0, y: 0 };
    const box = target.getBoundingClientRect();
    // The canvas may be shown larger or smaller than its own pixels; positions are in its pixels.
    const scaleX = box.width > 0 ? target.width / box.width : 1;
    const scaleY = box.height > 0 ? target.height / box.height : 1;
    return { x: (event.clientX - box.left) * scaleX, y: (event.clientY - box.top) * scaleY };
  };
  const modifiers = (event: PointerEvent | WheelEvent): Modifiers => ({ shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey, alt: event.altKey });

  const boardPixel = (at: Pixel): Pixel => screenToBoard(state.viewport, at.x, at.y);

  /** Start a shading or lighting gesture at a screen position; the work is done when the pointer is released. */
  const shadeDown = (at: Pixel, event: PointerEvent): void => {
    const shade = props.shade;
    if (shade === undefined || shade.disabled || state.busy) return;
    shade.onMessage(null);
    const pixel = boardPixel(at);
    if (shade.ui.mode === "lighting") {
      const hit = lightNodeAt(props.board.lights, pixel, NODE_GRAB / zoomOf(state.viewport));
      if (hit !== null && event.button === 0) setGesture({ kind: "node", ...hit, current: pixel });
      return;
    }
    const cell = pixelToCell(props.board, pixel.x, pixel.y);
    if (cell === null || !cellOnBoard(props.board, cell.x, cell.y)) return shade.onMessage("That place is not on the board.");
    const tool = shade.ui.tool;
    const erase = tool === "erase" || (tool === "draw" && event.button === 2);
    if (tool === "dropper") {
      shade.onUi({ ...shade.ui, brush: shadeAt(props.board, cell) });
    } else if (tool === "flood") {
      const outcome = floodShade(props.board, cell, shade.ui.brush);
      if (!outcome.ok) shade.onMessage(outcome.message);
      else if (outcome.cells.length === 0) shade.onMessage("Those cells already have that shade.");
      else void shade.submit({ type: "set-shade-cells", cells: outcome.cells });
    } else if (tool === "rectangle") {
      setGesture({ kind: "rectangle", anchor: cell, current: cell, filled: event.shiftKey });
    } else {
      setGesture({ kind: "stroke", cells: [cell], erase, last: pixel });
    }
  };
  const shadeMove = (at: Pixel, event: PointerEvent): void => {
    const current = gesture.current;
    if (current === null) return;
    const pixel = boardPixel(at);
    if (current.kind === "node") return setGesture({ ...current, current: { x: Math.round(pixel.x), y: Math.round(pixel.y) } });
    const cell = pixelToCell(props.board, pixel.x, pixel.y);
    if (current.kind === "rectangle") {
      if (cell !== null && cellOnBoard(props.board, cell.x, cell.y)) setGesture({ ...current, current: cell, filled: event.shiftKey });
      return;
    }
    const crossed = cellsBetween(props.board, current.last, pixel).filter((next) => !current.cells.some((seen) => seen.x === next.x && seen.y === next.y));
    if (crossed.length > 0) setGesture({ ...current, cells: [...current.cells, ...crossed], last: pixel });
  };
  const shadeUp = async (): Promise<void> => {
    const shade = props.shade;
    const current = gesture.current;
    setGesture(null);
    if (shade === undefined || current === null) return;
    const brush = shade.ui.brush;
    if (current.kind === "node") {
      const moved = moveLightNode(props.board, current.light, current.node, current.current);
      if (!moved.ok) return shade.onMessage(moved.message);
      const light = props.board.lights[current.light]?.nodes[current.node];
      if (light !== undefined && light.x === current.current.x && light.y === current.current.y) return;
      await shade.submit({ type: "set-board-fields", fields: { lights: moved.lights } });
      return;
    }
    const outcome = current.kind === "rectangle"
      ? rectangleShade(props.board, current.anchor, current.current, current.filled, brush)
      : paintShade(props.board, current.cells, current.erase ? { r: 0, g: 0, b: 0 } : brush);
    if (!outcome.ok) return shade.onMessage(outcome.message);
    const unchanged = outcome.cells.every((cell) => { const had = shadeAt(props.board, cell); return had.r === cell.r && had.g === cell.g && had.b === cell.b; });
    if (outcome.cells.length === 0 || unchanged) return shade.onMessage("Those cells already have that shade.");
    await shade.submit({ type: "set-shade-cells", cells: outcome.cells });
  };

  return (
    <canvas
      ref={canvas}
      class="tkr-board-canvas"
      role="img"
      aria-label="The board as the engine draws it"
      aria-busy={state.busy}
      // Focusable by pointer, not a tab stop: the cell grid is the keyboard way in. Clicking the canvas puts the focus in
      // the board, so tool shortcuts, Undo, Redo and Escape reach it instead of the page body.
      tabIndex={-1}
      width={state.viewport.width}
      height={state.viewport.height}
      onPointerDown={(event) => {
        if (event.button === 1) event.preventDefault();
        canvas.current?.focus({ preventScroll: true });
        canvas.current?.setPointerCapture?.(event.pointerId);
        const positionOnCanvas = position(event);
        if (props.colourPicking) {
          if (event.button !== 0 || picture === null || !picture.ok) return;
          const point = screenToBoard(state.viewport, positionOnCanvas.x, positionOnCanvas.y);
          const x = Math.floor(point.x), y = Math.floor(point.y);
          if (x < 0 || y < 0 || x >= picture.width || y >= picture.height) return;
          const offset = (y * picture.width + x) * 4;
          props.onColourPixel?.({ r: picture.rgba[offset]!, g: picture.rgba[offset + 1]!, b: picture.rgba[offset + 2]! });
          return;
        }
        if (props.startPicking) {
          const zoom = zoomOf(state.viewport);
          const cell = pixelToCell(props.board, state.viewport.x + positionOnCanvas.x / zoom, state.viewport.y + positionOnCanvas.y / zoom);
          if (cell !== null && cellOnBoard(props.board, cell.x, cell.y)) props.onStartCell?.(cell);
          return;
        }
        if (shadeActive && event.button !== 1) { shadeDown(positionOnCanvas, event); return; }
        editor.pointerDown(positionOnCanvas, modifiers(event), event.button);
      }}
      onKeyDown={(event) => { if (event.key === "Escape" && gesture.current !== null) { event.stopPropagation(); setGesture(null); } }}
      onPointerMove={(event) => {
        if (props.startPicking || props.colourPicking) return;
        if (shadeActive) shadeMove(position(event), event);
        else editor.pointerMove(position(event), modifiers(event));
      }}
      onPointerUp={(event) => {
        canvas.current?.releasePointerCapture?.(event.pointerId);
        if (props.startPicking || props.colourPicking) return;
        if (shadeActive) void shadeUp();
        else void editor.pointerUp(position(event), modifiers(event));
      }}
      onPointerCancel={() => { setGesture(null); editor.pointerCancel(); }}
      onWheel={(event) => {
        event.preventDefault();
        editor.wheel(event.deltaY !== 0 ? event.deltaY : event.deltaX, modifiers(event), position(event));
      }}
      onContextMenu={(event) => event.preventDefault()}
    />
  );
}
