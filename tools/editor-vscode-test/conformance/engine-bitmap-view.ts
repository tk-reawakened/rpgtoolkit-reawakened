// What the real engine draws for a tile bitmap: its `bitmap(file, canvas)` command over the project's own files. The
// editor's picture of a tile bitmap (AD-29) must equal these pixels. (The engine needs a board to start; an empty one
// is supplied, and the program draws nothing else.)
import { ok } from "node:assert/strict";
import {
  PACKAGE_ROOT,
  SCRIPT_SCREEN,
  createAssetIndex,
  createEmptyBoard,
  createEngine,
  writeBoard,
  type EnginePhaseRegistration,
  type GameState,
} from "@tk-reawakened/core";

/** The RGBA pixels of `bitmap("<name>", canvas)` over `files` (project-relative path → bytes), on a `width` × `height` canvas. */
export function engineBitmapView(files: Readonly<Record<string, Uint8Array>>, bitmapPath: string, width: number, height: number): Uint8Array {
  const board = writeBoard(createEmptyBoard());
  if (!board.ok) throw new Error(board.error.message);
  const all: Record<string, Uint8Array> = { ...files, "Boards/blank.brd": board.value };
  const byKey = new Map<string, Uint8Array>(Object.entries(all).map(([path, bytes]) => [path.toLowerCase(), bytes]));
  let latest: GameState | undefined;
  const registration: EnginePhaseRegistration = { phase: "events", run: (state) => { latest = state; } };
  const name = bitmapPath.slice(bitmapPath.lastIndexOf("/") + 1);
  const engine = createEngine({
    seed: 19,
    assetIndex: createAssetIndex(Object.keys(all)),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "blank.brd",
    width,
    height,
    maxTicks: 20,
    program: `createcanvas(${width}, ${height}, c)\nbitmap("${name}", c)\nend()\n`,
    phaseRegistrations: [registration],
  });
  let result = engine.advance(0, []);
  for (let step = 0; step < 12; step += 1) {
    const events = result.requests
      .filter((request) => request.kind === "asset")
      .map((request) => ({ tick: result.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: byKey.get(request.key) ?? null } }));
    result = engine.advance(1, events);
    if (result.requests.length === 0 && !result.loading) break;
  }
  ok(latest !== undefined, "the engine ran");
  const canvas = Object.values(latest.surfaces.entries).find((entry) => entry.id !== (0 as never) && entry.id !== SCRIPT_SCREEN);
  ok(canvas !== undefined, "the program's canvas");
  const surface = engine.surfacePixels(canvas.id, canvas.rev);
  ok(surface !== null, "the canvas has pixels");
  return surface.rgba;
}
