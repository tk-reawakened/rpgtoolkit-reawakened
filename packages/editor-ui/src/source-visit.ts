/**
 * The explicit contract for opening an artwork source in its own editor from a shared view (the tileset browser, an
 * animation's frame image, a terrain scene's owner). The path names the registered kind through the document-kind
 * registry, so a later editor adds its own target to this shape instead of a second host table or a kind-specific button.
 */
export interface SourceVisit {
  /** The project-relative path of the source file. */
  readonly path: string;
  /**
   * What the editor should select, in the registered kind's own numbering: a tileset's tile is one-based, as tile numbers
   * are everywhere in the editor. `null` selects nothing, for a whole-file source such as a tile bitmap.
   */
  readonly tile: number | null;
}
