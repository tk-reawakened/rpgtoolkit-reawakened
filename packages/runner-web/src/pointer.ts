/**
 * Pointer-event to logical-frame mapping for the shared live player pages.
 *
 * The engine consumes pointer events in logical integer pixels relative to the
 * top-left of the game's view (E-111). The canvas is scaled and letterboxed by
 * CSS, so screen coordinates must be converted through the canvas's own box,
 * not through window or device coordinates.
 */

export type LogicalPointer = { readonly x: number; readonly y: number };

/**
 * Convert a DOM pointer event into logical frame coordinates.
 *
 * - Uses `canvas.getBoundingClientRect()` so letterboxing offsets are included.
 * - Divides by the current CSS-to-logical scale derived from the canvas drawing
 *   buffer size vs. its laid-out CSS size.
 * - Clamps to the logical frame so a click on the black surround does not
 *   report a coordinate outside the game.
 */
export function pointerEventToLogical(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  viewSize: { readonly width: number; readonly height: number },
): LogicalPointer {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = Math.max(0, Math.min(viewSize.width - 1, (event.clientX - rect.left) * scaleX));
  const y = Math.max(0, Math.min(viewSize.height - 1, (event.clientY - rect.top) * scaleY));
  return { x: Math.floor(x), y: Math.floor(y) };
}
