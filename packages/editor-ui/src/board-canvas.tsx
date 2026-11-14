import {
  cellOutline,
  cellsInRect,
  pendingCells,
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
import { useEffect, useRef } from "preact/hooks";

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
}

function outline(context: CanvasRenderingContext2D, board: BoardDocumentSnapshot, cell: Cell): void {
  const corners = cellOutline(board, cell.x, cell.y);
  context.beginPath();
  corners.forEach((corner, index) => (index === 0 ? context.moveTo(corner.x, corner.y) : context.lineTo(corner.x, corner.y)));
  context.closePath();
}

/** Draw the picture, the grid, the selection, the gesture in progress and the cursor. */
function paint(context: CanvasRenderingContext2D, source: CanvasImageSource | null, picture: { readonly width: number; readonly height: number } | null, props: BoardCanvasProps): void {
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
    paint(context, source.current?.image ?? null, source.current, props);
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

  return (
    <canvas
      ref={canvas}
      class="tkr-board-canvas"
      role="img"
      aria-label="The board as the engine draws it"
      width={state.viewport.width}
      height={state.viewport.height}
      onPointerDown={(event) => {
        if (event.button === 1) event.preventDefault();
        canvas.current?.setPointerCapture?.(event.pointerId);
        editor.pointerDown(position(event), modifiers(event), event.button);
      }}
      onPointerMove={(event) => editor.pointerMove(position(event), modifiers(event))}
      onPointerUp={(event) => {
        canvas.current?.releasePointerCapture?.(event.pointerId);
        void editor.pointerUp(position(event), modifiers(event));
      }}
      onPointerCancel={() => editor.pointerCancel()}
      onWheel={(event) => {
        event.preventDefault();
        editor.wheel(event.deltaY !== 0 ? event.deltaY : event.deltaX, modifiers(event), position(event));
      }}
      onContextMenu={(event) => event.preventDefault()}
    />
  );
}
