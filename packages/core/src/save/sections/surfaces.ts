/**
 * Persistent core-owned bitmaps (AD-27).
 *
 * Save state stores straight RGBA as a tagged base64 payload. Decoded bytes
 * belong to the raster cache and are never placed in this section.
 */
import type { SurfaceId } from "../../ports/keys.ts";

export type RgbaSnapshot = {
  readonly t: "rgba";
  readonly w: number;
  readonly h: number;
  readonly b64: string;
};

export type SurfaceState = {
  id: SurfaceId;
  rev: number;
  bitmap: RgbaSnapshot;
};

export type SurfacesSection = {
  nextId: number;
  entries: Record<string, SurfaceState>;
  slots: Record<string, SurfaceId>;
  colours: Record<string, SurfaceId>;
  /** Reserved `renderNow` overlay canvas handle: 0 or absent until `rendernow(true)` first creates it, then persistent (E-57). */
  renderNow?: SurfaceId;
  /** Whether the reserved canvas is drawn. Absent in a save written before the flag existed, where a named handle meant "on". */
  renderNowOn?: boolean;
  /**
   * The persistent script-screen layer: what a script draws when it draws to the screen. Surface 0 is the derived
   * presented frame — board composite, this layer, then the overlay — so a rebuild never loses script drawing
   * (docs/spec/engine/runners.md#surface-read-and-state-hash).
   */
  scriptScreen?: SurfaceId;
};
