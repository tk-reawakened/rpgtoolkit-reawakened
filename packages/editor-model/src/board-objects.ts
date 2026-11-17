/** The stored object families editable in a board document. */
export type BoardObjectKind = "vectors" | "programs" | "sprites" | "images";

/** A selected, zero-based stored slot in one board object family. */
export interface BoardObjectSelection {
  readonly kind: BoardObjectKind;
  readonly index: number;
}
