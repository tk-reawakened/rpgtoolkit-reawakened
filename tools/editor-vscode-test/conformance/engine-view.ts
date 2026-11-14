// What the real engine draws for a board: its `viewbrd` preview over the project's own files. The editor's picture of a
// board (AD-29) must equal these pixels. (The editor-model tests run the same comparison against the model; a tool test
// cannot import another package's test files, so this is its own copy of the driver.)
import { ok } from "node:assert/strict";
import {
  PACKAGE_ROOT,
  SCRIPT_SCREEN,
  createAssetIndex,
  createEngine,
  type EnginePhaseRegistration,
  type GameState,
} from "@tk-reawakened/core";

/** The RGBA pixels of `viewbrd("village.brd", 0, 0, canvas)` over `files` (project-relative path → bytes), on a `size`² canvas. */
export function engineBoardView(files: Readonly<Record<string, Uint8Array>>, boardPath: string, size: number): Uint8Array {
  const byKey = new Map<string, Uint8Array>(Object.entries(files).map(([path, bytes]) => [path.toLowerCase(), bytes]));
  let latest: GameState | undefined;
  const registration: EnginePhaseRegistration = { phase: "events", run: (state) => { latest = state; } };
  const name = boardPath.slice(boardPath.lastIndexOf("/") + 1);
  const engine = createEngine({
    seed: 19,
    assetIndex: createAssetIndex(Object.keys(files)),
    assetRoot: PACKAGE_ROOT,
    initialBoard: name,
    width: size,
    height: size,
    maxTicks: 20,
    program: `createcanvas(${size}, ${size}, c)\nviewbrd("${name}", 0, 0, c)\nend()\n`,
    phaseRegistrations: [registration],
  });
  let result = engine.advance(0, []);
  for (let step = 0; step < 10; step += 1) {
    const events = result.requests
      .filter((request) => request.kind === "asset")
      .map((request) => ({ tick: result.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: byKey.get(request.key) ?? new Uint8Array() } }));
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
