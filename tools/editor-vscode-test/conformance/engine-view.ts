// What the real engine does with a project's files: its `viewbrd` preview of a board, and a boot from the main file. The
// editor's picture of a board (AD-29) must equal these pixels, and a main file the editor saved must boot. (The
// editor-model tests run the same comparison against the model; a tool test cannot import another package's test files,
// so this is its own copy of the driver.)
import { ok } from "node:assert/strict";
import {
  PACKAGE_ROOT,
  SCRIPT_SCREEN,
  assetKey,
  createAssetIndex,
  createEngine,
  placeplayerPixel,
  type EffectRecord,
  type EnginePhaseRegistration,
  type GameState,
  type InputRecord,
  type TickReport,
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

/** What a boot reached: its stage, the board it entered, and every diagnostic it reported. */
export interface EngineBoot {
  readonly stage: string | null;
  readonly board: string | null;
  readonly diagnostics: readonly string[];
}

/**
 * Boot the game whose main file is `mainPath` from a game folder (`files`: paths relative to the Toolkit folder, so the
 * main file's `projectPath` locates the project), the way the core boot tests do (E-02): every asset request is answered
 * from `files`, and one Enter press at `pressAt` lets a start-up `wait()` finish.
 */
export function engineBoot(files: Readonly<Record<string, Uint8Array>>, mainPath: string, ticks: number, pressAt: number): EngineBoot {
  const byKey = new Map<string, Uint8Array>(Object.entries(files).map(([path, bytes]) => [assetKey(path), bytes]));
  let latest: GameState | undefined;
  let hasPlayer = false;
  let position: { x: number; y: number } | null = null;
  const sprites = (effect: EffectRecord): void => {
    if (effect.name === "createplayer") hasPlayer = true;
    if (effect.name === "placeplayer") {
      const [x, y, , unit, coordType, sizeX] = effect.args as [number, number, number, string, number, number];
      position = placeplayerPixel(x, y, unit, coordType, sizeX);
    }
  };
  const engine = createEngine({
    seed: 3,
    assetIndex: createAssetIndex(Object.keys(files)),
    assetRoot: { kind: "game", projectPath: "" },
    mainFile: mainPath,
    gameIdentity: "editor-settings-proof",
    startup: { presence: { hasPlayer: () => hasPlayer }, savedGame: { load: () => ({ kind: "missing" as const }), restored: () => false } },
    width: 320,
    height: 240,
    maxTicks: ticks,
    effectAppliers: [{ section: "sprites", applier: sprites }, { section: "triggers", applier: () => undefined }, { section: "audio", applier: () => undefined }],
    cameraTarget: { getPlayerPosition: () => position, getEntityPosition: () => null },
    phaseRegistrations: [{ phase: "audio", run: (state) => { latest = state; } }],
  });
  const diagnostics: string[] = [];
  const answer = (report: TickReport): InputRecord[] =>
    report.requests.flatMap((request) => (request.kind === "asset" ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: byKey.get(request.key) ?? null } }] : []));
  /** Advance `count` ticks, answering asset requests as a host does. */
  const run = (count: number, first: InputRecord[]): void => {
    let remaining = count;
    let replies = first;
    for (let guard = 0; guard < 1000; guard += 1) {
      const report = engine.advance(remaining, replies);
      remaining -= report.ticksRun;
      diagnostics.push(...report.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`));
      replies = report.loading ? answer(report) : [];
      if (!report.loading && (remaining <= 0 || report.ticksRun === 0)) return;
    }
    throw new Error("the host loop did not settle");
  };
  run(pressAt, []);
  const press = (down: boolean): InputRecord => ({ tick: pressAt, event: { kind: "key", name: "ENTER", code: "Enter", char: null, down } });
  run(ticks - pressAt, [press(true), press(false)]);
  return { stage: latest?.engine.boot?.stage ?? null, board: latest?.world.board?.key ?? null, diagnostics };
}
