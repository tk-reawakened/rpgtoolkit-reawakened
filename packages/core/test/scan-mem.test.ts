// scan and mem tile buffers (docs/spec/engine/rpgcode-functions.md#reawakened-scan-mem, GitHub #2157).
import { test } from "node:test";
import { deepEqual, equal, notEqual, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TextEncoder } from "node:util";
import {
  assetKey,
  blitSurface,
  createAssetIndex,
  createEmptyBoard,
  createEmptyCharacter,
  createEmptyMainFile,
  createEngine,
  createGameState,
  createSurfacesSection,
  GRAPHICS_PLUGIN,
  PACKAGE_ROOT,
  restoreGameState,
  snapshot,
  writeBoard,
  writeCharacter,
  writeMainFile,
  type CommandView,
  type GameState,
  type SurfaceId,
} from "../src/index.ts";
import type { Arg } from "../src/script/builtins.ts";
import { ScriptError } from "../src/script/errors.ts";
import { readSurfacePixels, SCRIPT_SCREEN } from "../src/raster/surfaces.ts";

const here = dirname(fileURLToPath(import.meta.url));
const font = new Uint8Array(readFileSync(join(here, "..", "..", "..", "media", "fonts", "tkr-8x8.fnt")));
const encoder = new TextEncoder();
/** Four 32x32 cells: (1,1), (2,1), (1,2) and (2,2). */
const SIZE = 64;

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** Run an RPGCode program on a real engine with a 64x64 screen and return the state once it has ended. */
function run(program: string): GameState {
  const empty = createEmptyBoard();
  const files = new Map<string, Uint8Array>();
  const paths = ["main.gam", "Boards/start.brd", "Chrs/hero.tem", "Prg/start.prg"];
  files.set(assetKey("main.gam"), unwrap(writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, startupPrg: "start.prg", initBoard: "start.brd", initChar: "hero.tem" })));
  files.set(assetKey("boards/start.brd"), unwrap(writeBoard({
    ...empty, sizeX: 40, sizeY: 30, sizeL: 1, tileMatrix: Array.from({ length: 1200 }, () => 0), tileRuns: [{ lutIndex: 0, count: 1200, marker: true }],
    layerTitles: ["", ""], properties: { ...empty.properties, start: { x: 64, y: 64, layer: 1 }, enterPrg: "" },
  })));
  files.set(assetKey("chrs/hero.tem"), unwrap(writeCharacter({ ...createEmptyCharacter(), minor: 5, name: "Hero", movementAnimations: Array(8).fill(""), battleStances: ["", "", "", "", "", ""] })));
  files.set(assetKey("prg/start.prg"), encoder.encode(program));
  let latest: GameState | null = null;
  const engine = createEngine({
    seed: 1,
    assetIndex: createAssetIndex(paths),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "scan-mem-test",
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    width: SIZE,
    height: SIZE,
    maxTicks: 1000,
    bundled: new Map([[assetKey("media/fonts/tkr-8x8.fnt"), font]]),
    phaseRegistrations: [{ phase: "audio", run: (state) => { latest = state; } }],
  });
  let replies: { readonly tick: number; readonly event: { readonly kind: "asset"; readonly reqId: number; readonly bytes: Uint8Array | null } }[] = [];
  for (let tick = 0; tick < 40; tick += 1) {
    const report = engine.advance(1, replies as never);
    replies = [];
    if (report.diagnostics.length > 0) throw new Error(`diagnostics: ${JSON.stringify(report.diagnostics)}`);
    for (const request of report.requests) {
      if (request.kind === "asset") replies.push({ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: files.get(request.key) ?? null } });
    }
  }
  engine.drawList();
  if (latest === null) throw new Error("no tick has run");
  return latest;
}

/** An RPGCode line that reads screen pixel (x, y) into `<name>r`, `<name>g` and `<name>b`. */
function px(x: number, y: number, name: string): string {
  return `getpixel(${x}, ${y}, ${name}r, ${name}g, ${name}b)`;
}

function rgb(state: GameState, name: string): number[] {
  const globals = state.vm.globals as Record<string, unknown>;
  return [globals[`${name}r`], globals[`${name}g`], globals[`${name}b`]] as number[];
}

const RED = [255, 0, 0];
const BLUE = [0, 0, 255];

test("scan files each cell under its own pos and mem paints each back at a new cell", () => {
  const state = run([
    "colorrgb(255, 0, 0)",
    "fillrect(3, 4, 5, 6)",
    "colorrgb(0, 0, 255)",
    "fillrect(40, 10, 42, 12)",
    px(60, 60, "base"),
    "scan(1, 1, 0)",
    "scan(2, 1, 7)",
    "clear()",
    px(4, 5, "gone"),
    "mem(1, 2, 0)",
    "mem(2, 2, 7)",
    px(4, 37, "a"),
    px(41, 43, "b"),
    px(41, 37, "cross"),
    px(4, 43, "crossb"),
    "end()",
  ].join("\n"));
  const base = rgb(state, "base");
  notEqual(base.join(), RED.join(), "the empty screen is not red");
  deepEqual(rgb(state, "gone"), base, "clear() removed the original drawing, so only mem can bring it back");
  deepEqual(rgb(state, "a"), RED, "pos 0 painted its red mark at cell (1,2): pixel (3,4) in the cell is (4,37) on screen");
  deepEqual(rgb(state, "b"), BLUE, "pos 7 painted its blue mark at cell (2,2): pixel (8,10) in the cell is (41,43) on screen");
  deepEqual(rgb(state, "cross"), base, "pos 7's blue mark did not appear where only pos 0's cell lies");
  deepEqual(rgb(state, "crossb"), base, "pos 0's cell has none of pos 7's pixels");
});

test("mem replaces the pixels it lands on, and a later scan to the same pos replaces the buffer", () => {
  const state = run([
    "colorrgb(255, 0, 0)",
    "fillrect(3, 4, 5, 6)",
    px(60, 60, "base"),
    "scan(1, 1, 3)",
    "colorrgb(0, 0, 255)",
    "fillrect(0, 32, 31, 63)",
    px(20, 50, "before"),
    "mem(1, 2, 3)",
    px(20, 50, "replaced"),
    px(4, 37, "mark"),
    "clear()",
    "colorrgb(0, 255, 0)",
    "fillrect(3, 4, 5, 6)",
    "scan(1, 1, 3)",
    "clear()",
    "mem(2, 2, 3)",
    px(36, 37, "second"),
    px(4, 5, "empty"),
    "end()",
  ].join("\n"));
  const base = rgb(state, "base");
  deepEqual(rgb(state, "before"), BLUE, "the destination cell was blue before mem");
  deepEqual(rgb(state, "replaced"), base, "mem put back the scanned background over the blue; it did not blend with it");
  deepEqual(rgb(state, "mark"), RED, "the scanned mark came back");
  deepEqual(rgb(state, "second"), [0, 255, 0], "scanning pos 3 again replaced the earlier picture");
  deepEqual(rgb(state, "empty"), base, "mem did not draw into the cell it was not asked for");
});

test("tile buffers are kept in saved state apart from savescreen slots and survive a save and load", () => {
  const state = run([
    "colorrgb(255, 0, 0)",
    "fillrect(3, 4, 5, 6)",
    "slot = savescreen(0)",
    "scan(1, 1, 0)",
    "end()",
  ].join("\n"));
  const surfaces = state.surfaces;
  const tile = surfaces.slots["tile:0"];
  const screen = surfaces.slots["0"];
  ok(typeof tile === "number", "the tile buffer is filed under its own tile: key");
  ok(typeof screen === "number", "the numbered savescreen slot is still there");
  notEqual(tile, screen, "scan and savescreen never share a surface");
  const filed = surfaces.entries[String(tile)]!;
  deepEqual([filed.bitmap.w, filed.bitmap.h], [32, 32], "a tile buffer holds exactly one 32 by 32 cell");

  const restored = restoreGameState(snapshot(state));
  const reloaded = restored.surfaces.slots["tile:0"];
  ok(typeof reloaded === "number", "the buffer is read back from the save");
  const pixels = (s: GameState, id: number) => readSurfacePixels(s.surfaces, id as SurfaceId, s.surfaces.entries[String(id)]!.rev)!.rgba;
  deepEqual(pixels(restored, reloaded), pixels(state, tile), "the restored buffer has the same pixels");
});

function arg(value: unknown): Arg {
  return { value: value as never, ref: null };
}
function command(name: string) {
  const found = GRAPHICS_PLUGIN.commands.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`missing graphics command ${name}`);
  return found;
}
function view() {
  const state = createGameState({ seed: 1 });
  state.surfaces = createSurfacesSection(SIZE, SIZE);
  const refreshScreen = (): void => {
    if (state.surfaces.entries[String(SCRIPT_SCREEN)] === undefined) return;
    blitSurface(state.surfaces, SCRIPT_SCREEN, 0 as SurfaceId, 0, 0);
  };
  const commandView: CommandView = { state, rng: { nextUint32: () => 0 }, clock: { tick: () => 0 }, gameId: "test-game", refreshScreen };
  return { state, commandView };
}
const call = (v: CommandView, name: string, ...args: unknown[]) => command(name).call(v, args.map(arg), () => ({ value: null }));
const badArg = (error: unknown) => error instanceof ScriptError && error.code === "builtin.bad-arg";

test("scan rejects a cell not wholly on the screen, a negative pos and non-numbers, and changes nothing", () => {
  const { state, commandView } = view();
  const before = JSON.stringify(state.surfaces);
  throws(() => call(commandView, "scan", 3, 1, 0), badArg, "cell (3,1) starts at pixel 64, off a 64 pixel screen");
  throws(() => call(commandView, "scan", 1, 3, 0), badArg, "cell (1,3) is below the screen");
  throws(() => call(commandView, "scan", 0, 1, 0), badArg, "cells count from 1");
  throws(() => call(commandView, "scan", 1, 1, -1), badArg, "pos below 0");
  throws(() => call(commandView, "scan", "a", 1, 0), badArg, "x is not a number");
  throws(() => call(commandView, "scan", 1, 1, Number.NaN), badArg, "pos is not finite");
  equal(JSON.stringify(state.surfaces), before, "no refused scan changed the saved surfaces");
});

test("mem of a pos that was never scanned draws nothing; a bad pos or number is refused", () => {
  const { state, commandView } = view();
  call(commandView, "setpixel", 1, 1);
  const before = JSON.stringify(state.surfaces);
  call(commandView, "mem", 1, 1, 9);
  equal(JSON.stringify(state.surfaces), before, "an unscanned pos is a quiet no-op");
  throws(() => call(commandView, "mem", 1, 1, -1), badArg);
  throws(() => call(commandView, "mem", 1, Number.POSITIVE_INFINITY, 0), badArg);
});

test("whole-number arguments are cut toward zero, so cell 1.9 is cell 1", () => {
  const { state, commandView } = view();
  call(commandView, "setpixel", 1, 1);
  call(commandView, "scan", 1.9, 1.9, 2.7);
  ok(state.surfaces.slots["tile:2"] !== undefined, "pos 2.7 is filed as pos 2");
  call(commandView, "clear");
  call(commandView, "mem", 2, 2, 2);
  const layer = state.surfaces.entries[String(SCRIPT_SCREEN)]!;
  const pixels = readSurfacePixels(state.surfaces, SCRIPT_SCREEN, layer.rev)!.rgba;
  const at = (x: number, y: number) => pixels[(y * SIZE + x) * 4 + 3];
  equal(at(33, 33), 255, "the pixel scanned at (1,1) in cell (1,1) landed at (1,1) in cell (2,2)");
  equal(at(1, 1), 0, "and not back in cell (1,1)");
});
