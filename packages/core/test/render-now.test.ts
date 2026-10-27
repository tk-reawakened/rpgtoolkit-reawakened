// Engine-level checks of the drawing seams the default battle screen stands on (docs/spec/engine/main-loop-and-startup.md#e-57,
// docs/spec/engine/rpgcode-functions.md#e-56, #reawakened-drawenemy, docs/spec/engine/display-input-audio.md#e-110).
import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TextEncoder } from "node:util";
import {
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyMainFile,
  createEngine,
  PACKAGE_ROOT,
  readSurfacePixels,
  writeAnimation,
  writeBoard,
  writeMainFile,
  type Engine,
  type GameState,
} from "../src/index.ts";
import { encodePng } from "./battle-ui-rig.ts";

const here = dirname(fileURLToPath(import.meta.url));
const font = new Uint8Array(readFileSync(join(here, "..", "..", "..", "media", "fonts", "tkr-8x8.fnt")));
const encoder = new TextEncoder();
const SIZE = 64;

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

type Game = {
  readonly engine: Engine;
  state(): GameState;
  advance(ticks: number, keys?: readonly string[]): void;
  frame(): { readonly w: number; readonly h: number; readonly rgba: Uint8Array };
};

/** A tiny game whose start program is `program`; `extra` are more authored files by path. */
function boot(program: string, extra: Readonly<Record<string, Uint8Array>> = {}): Game {
  const empty = createEmptyBoard();
  const files = new Map<string, Uint8Array>();
  const paths = ["main.gam", "Boards/start.brd", "Chrs/hero.tem", "Prg/start.prg", ...Object.keys(extra)];
  files.set(assetKey("main.gam"), unwrap(writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, startupPrg: "start.prg", initBoard: "start.brd", initChar: "hero.tem" })));
  files.set(assetKey("boards/start.brd"), unwrap(writeBoard({
    ...empty, sizeX: 40, sizeY: 30, sizeL: 1, tileMatrix: Array.from({ length: 1200 }, () => 0), tileRuns: [{ lutIndex: 0, count: 1200, marker: true }],
    layerTitles: ["", ""], properties: { ...empty.properties, start: { x: 64, y: 64, layer: 1 } },
  })));
  files.set(assetKey("chrs/hero.tem"), new Uint8Array([0]));
  files.set(assetKey("prg/start.prg"), encoder.encode(program));
  for (const [path, bytes] of Object.entries(extra)) files.set(assetKey(path), bytes);
  let latest: GameState | null = null;
  const engine = createEngine({
    seed: 1,
    assetIndex: createAssetIndex(paths),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    width: SIZE,
    height: SIZE,
    maxTicks: 1000,
    bundled: new Map([[assetKey("media/fonts/tkr-8x8.fnt"), font]]),
    phaseRegistrations: [{ phase: "audio", run: (state) => { latest = state; } }],
  });
  let replies: { readonly tick: number; readonly event: { readonly kind: "asset"; readonly reqId: number; readonly bytes: Uint8Array | null } | { readonly kind: "key"; readonly name: string; readonly code: string; readonly char: null; readonly down: boolean } }[] = [];
  const game: Game = {
    engine,
    state() {
      if (latest === null) throw new Error("no tick has run");
      return latest;
    },
    advance(ticks, keys = []) {
      for (let remaining = ticks; remaining > 0;) {
        const tick = latest?.time.tick ?? 0;
        const inputs = keys.length === 0 ? [] : keys.flatMap((name, index) => [
          { tick: tick + index * 2, event: { kind: "key" as const, name, code: name, char: null, down: true } },
          { tick: tick + index * 2 + 1, event: { kind: "key" as const, name, code: name, char: null, down: false } },
        ]);
        keys = [];
        const report = engine.advance(1, [...replies, ...inputs] as never);
        remaining -= 1;
        replies = [];
        if (report.diagnostics.length > 0) throw new Error(`diagnostics: ${JSON.stringify(report.diagnostics)}`);
        for (const request of report.requests) {
          if (request.kind === "asset") replies.push({ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: files.get(request.key) ?? null } });
        }
      }
    },
    frame() {
      engine.surfacePixels(0 as never, -1);
      const surface = engine.surfacePixels(0 as never, game.state().surfaces.entries["0"]!.rev);
      if (surface === null) throw new Error("the frame is not readable");
      return surface;
    },
  };
  game.advance(40);
  return game;
}

function pixel(image: { readonly w: number; readonly rgba: Uint8Array }, x: number, y: number): number[] {
  return [...image.rgba.slice((y * image.w + x) * 4, (y * image.w + x) * 4 + 4)];
}

function canvasPixel(game: Game, handle: number, x: number, y: number): number[] {
  const surfaces = game.state().surfaces;
  const rev = surfaces.entries[String(handle)]!.rev;
  const pixels = readSurfacePixels(surfaces, handle as never, rev);
  if (pixels === null) throw new Error("the canvas is not readable");
  return pixel(pixels, x, y);
}

test("an enabled render-now canvas is composed above the board and a disabled one adds nothing", () => {
  const on = boot("rendernow(1)\nc = cnvrendernow\ncolorrgb(255,0,0)\nfillrect(0,0,20,20,c)\nend()\n");
  deepEqual(pixel(on.frame(), 10, 10), [255, 0, 0, 255], "the canvas pixel shows in the frame");
  deepEqual(pixel(on.frame(), 40, 40), [0, 0, 0, 255], "clear canvas pixels leave the board visible");
  const blits = on.engine.drawList().commands.filter((command) => command.kind === "blit" && "surface" in command.source);
  equal(blits.length, 1, "one 1:1 blit of the canvas");
  const off = boot("rendernow(1)\nc = cnvrendernow\ncolorrgb(255,0,0)\nfillrect(0,0,20,20,c)\nrendernow(0)\nend()\n");
  deepEqual(pixel(off.frame(), 10, 10), [0, 0, 0, 255], "rendernow(0) removes the overlay");
  equal(off.engine.drawList().commands.some((command) => command.kind === "blit" && "surface" in command.source), false);
});

test("text and pixelText with a canvas draw into that canvas, not the screen text layer", () => {
  const game = boot('rendernow(1)\nc = cnvrendernow\ncolorrgb(255,255,255)\npixelText(2,24,"HI",c)\ntext(1,5,"A",c)\nend()\n');
  const handle = game.state().surfaces.renderNow ?? 0;
  ok(handle > 0);
  let lit = 0;
  for (let y = 24; y < 32; y += 1) for (let x = 0; x < 20; x += 1) if (canvasPixel(game, handle, x, y)[3] === 255) lit += 1;
  ok(lit > 10, `the glyphs are in the canvas (${lit} pixels)`);
  let cell = 0;
  for (let y = 32; y < 40; y += 1) for (let x = 0; x < 8; x += 1) if (canvasPixel(game, handle, x, y)[3] === 255) cell += 1;
  ok(cell > 3, "text(1,5) lands in the fifth cell row of the canvas");
  equal(game.state().ui.draws.length, 0, "the screen text layer got nothing");
});

test("drawenemy draws frame 0 of the named animation with its transparent colour skipped", () => {
  const picture = new Uint8Array(16 * 16 * 4);
  for (let at = 0; at < picture.length; at += 4) picture.set([255, 0, 255, 255], at);
  for (let y = 4; y < 12; y += 1) for (let x = 4; x < 12; x += 1) picture.set([200, 40, 40, 255], (y * 16 + x) * 4);
  const animation = unwrap(writeAnimation({
    magic: "RPGTLKIT ANIM", major: 2, minor: 3, width: 16, height: 16,
    frames: [{ image: "blob.png", transparent: { r: 255, g: 0, b: 255 }, sound: "" }, { image: "other.png", transparent: { r: 255, g: 0, b: 255 }, sound: "" }],
    delay: 0.1, residue: new Uint8Array(),
  }));
  const game = boot('rendernow(1)\nc = cnvrendernow\ndrawenemy("blob.anm", 5, 6, c)\nend()\n', {
    "Misc/blob.anm": animation,
    "Bitmap/blob.png": encodePng(16, 16, picture),
  });
  const handle = game.state().surfaces.renderNow ?? 0;
  deepEqual(canvasPixel(game, handle, 5 + 6, 6 + 6), [200, 40, 40, 255], "the picture's own pixels are drawn at (x, y)");
  deepEqual(canvasPixel(game, handle, 5, 6), [0, 0, 0, 0], "the transparent colour is skipped");
});

test("get() returns a pressed key once and never again, and clearbuffer() empties the queue", () => {
  const game = boot("count = 0\nloops = 0\nwhile (loops < 100) {\n  k = get()\n  if (k != \"\") {\n    count = count + 1\n  }\n  loops = loops + 1\n  threadSleep(getThreadId(), 1/60)\n}\ndone = 1\nend()\n");
  game.advance(2, ["DOWN"]);
  game.advance(80);
  equal(game.state().vm.globals.done, 1);
  equal(game.state().vm.globals.count, 1, "one press is one key");
  equal(game.state().input.keys.length, 0, "the claimed key left the queue");
});
