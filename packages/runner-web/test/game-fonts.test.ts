// A project TrueType face reaches the live renderer (#1938). The core draw list names TrueType glyph IDs, which mean
// something only against the face that produced them; a renderer that held just the bundled faces replayed them against
// the bitmap fallback and drew different characters. This boots the real engine on a project that ships a font, runs the
// host's request loop and the live session's provider wiring, and compares the ink the renderer would draw.

import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyCharacter,
  createEmptyMainFile,
  createEngine,
  DEFAULT_FONT_ASSET,
  PACKAGE_ROOT,
  readTrueTypeFont,
  textInk,
  writeBoard,
  writeCharacter,
  writeMainFile,
  type AssetKey,
  type Engine,
  type GameState,
  type InputRecord,
  type TextCommand,
} from "@tk-reawakened/core";
import { fontProvider, gameFontProvider } from "../src/index.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const encoder = new TextEncoder();
const liberation = new Uint8Array(readFileSync(resolve(repoRoot, "media", "fonts", "LiberationSans-Regular.ttf")));
const bitmap = new Uint8Array(readFileSync(resolve(repoRoot, "media", "fonts", "tkr-8x8.fnt")));
// The bundled set holds only the bitmap face, so a TrueType glyph ID that reaches it is read as a character code.
const bundledFiles = new Map<string, Uint8Array>([[DEFAULT_FONT_ASSET, bitmap]]);

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** A 3.1 package whose start program draws `Hello` in the project's own font, with the files the host would serve. */
function project(fontBytes: Uint8Array): { readonly files: Map<AssetKey, Uint8Array>; readonly paths: readonly string[] } {
  const files = new Map<AssetKey, Uint8Array>();
  const paths: string[] = [];
  const add = (path: string, bytes: Uint8Array): void => {
    paths.push(path);
    files.set(assetKey(path), bytes);
  };
  const empty = createEmptyBoard();
  add("main.gam", unwrap(writeMainFile({
    ...createEmptyMainFile(), major: 2, minor: 9, movementControls: 5, movementScanCodes: [0xcd, 0, 0xd0, 0, 0xcb, 0, 0xc8, 0],
    projectPath: "", startupPrg: "start.prg", initBoard: "start.brd", pixelMovement: 0, initChar: "hero.tem", plugins: [], audioSettings: null,
  })));
  add("Boards/start.brd", unwrap(writeBoard({
    ...empty, sizeX: 8, sizeY: 8, sizeL: 1, tileMatrix: Array.from({ length: 64 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 64, marker: true }], layerTitles: ["", ""],
    properties: { ...empty.properties, start: { x: 64, y: 64, layer: 1 } },
  })));
  add("Chrs/hero.tem", unwrap(writeCharacter({
    ...createEmptyCharacter(), minor: 5, name: "Hero", movementAnimations: Array(8).fill(""), battleStances: Array(6).fill(""),
  })));
  add("Prg/start.prg", encoder.encode('font("custom")\ntext(1, 1, "Hello")\nwait()\nend()'));
  add("Font/custom.ttf", fontBytes);
  return { files, paths };
}

/** Boot the engine the way `createLiveSession` does and serve its asset requests from `files`. */
function boot(files: ReadonlyMap<AssetKey, Uint8Array>, paths: readonly string[]): { readonly engine: Engine; readonly latest: () => GameState | null } {
  let latest: GameState | null = null;
  const engine = createEngine({
    seed: 0,
    assetIndex: createAssetIndex(paths),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "game-fonts-test",
    startup: { presence: { hasPlayer: () => false }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    width: 320,
    height: 240,
    maxTicks: 600,
    include: { shading: true, images: true, sprites: true },
    bundled: new Map([[assetKey(DEFAULT_FONT_ASSET), bitmap]]),
    effectAppliers: [
      { section: "sprites", applier: () => undefined },
      { section: "triggers", applier: () => undefined },
      { section: "audio", applier: () => undefined },
    ],
    phaseRegistrations: [{ phase: "audio", run: (state: GameState) => { latest = state; } }],
  });
  let replies: InputRecord[] = [];
  let remaining = 2;
  for (let guard = 0; guard < 400; guard += 1) {
    const report = engine.advance(remaining, replies);
    replies = [];
    remaining -= report.ticksRun;
    if (report.loading) {
      replies = report.requests.flatMap((request) => request.kind === "asset"
        ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }]
        : []);
      continue;
    }
    if (remaining <= 0 || report.ticksRun === 0) return { engine, latest: () => latest };
  }
  throw new Error("the host loop did not settle");
}

/** The provider `createLiveSession` builds over a session's installed fonts and byte cache. */
function liveProvider(files: ReadonlyMap<AssetKey, Uint8Array>, latest: () => GameState | null) {
  return gameFontProvider(
    fontProvider(bundledFiles),
    (key) => latest()?.engine.boot?.fonts.includes(key) === true ? files.get(key) ?? null : null,
  );
}

function textCommand(engine: Engine): TextCommand {
  const command = engine.drawList(0, { shading: true, images: true, sprites: true }).commands
    .find((candidate): candidate is TextCommand => candidate.kind === "text" && candidate.text === "Hello");
  if (command === undefined) throw new Error("the start program drew no Hello text");
  return command;
}

test("the live renderer receives the project's installed font that the draw list names", () => {
  const { files, paths } = project(liberation);
  const { engine, latest } = boot(files, paths);
  const command = textCommand(engine);
  const key = assetKey("Font/custom.ttf");
  equal(command.font.asset, key, "the explicit font() choice selects the project face");
  const face = unwrap(readTrueTypeFont(liberation));
  deepEqual(command.advances.map((advance) => advance.glyph), Array.from("Hello", (character) => face.charToGlyph(character).id), "the draw list carries the project face's glyph IDs");

  const provider = liveProvider(files, latest);
  const font = provider(key);
  ok(font !== undefined && !(font instanceof Uint8Array), "the renderer gets a decoded face, not bytes it would re-parse per command");
  equal(provider(key), font, "one decoded face is shared across frames");

  const drawn = textInk(command, font);
  const reference = textInk(command, face);
  ok(drawn !== null && reference !== null && reference.length > 0);
  deepEqual(drawn, reference, "the renderer's ink is the project face's ink");
  const bitmapOnly = textInk(command, fontProvider(bundledFiles).get(assetKey(DEFAULT_FONT_ASSET)));
  ok(JSON.stringify(drawn) !== JSON.stringify(bitmapOnly), "and not the bitmap fallback's reading of the same glyph IDs (the pre-fix result)");
});

test("only fonts the engine installed come from the project; others fall back to the bundled set", () => {
  const { files, paths } = project(new Uint8Array([1, 2, 3, 4]));
  const { engine, latest } = boot(files, paths);
  ok(engine.drawList(0).commands.some((candidate) => candidate.kind === "text" && candidate.text === "Hello"));
  const key = assetKey("Font/custom.ttf");
  // The engine rejected the broken face, so it is not installed and nothing decodes in its place.
  deepEqual(latest()?.engine.boot?.fonts, []);
  const provider = liveProvider(files, latest);
  equal(provider(key), undefined);
  ok(provider(assetKey(DEFAULT_FONT_ASSET)) !== undefined, "bundled faces still resolve");
});

test("a project face wins over a bundled face of the same key, and bytes that do not decode do not", () => {
  const key = assetKey("media/fonts/shared.ttf");
  const bundledFace = unwrap(readTrueTypeFont(liberation));
  const bundled = new Map([[key, bundledFace]]);
  const decoded = gameFontProvider(bundled, () => liberation)(key);
  ok(decoded !== undefined && decoded !== bundledFace, "the project's own decoded face is used");
  equal(gameFontProvider(bundled, () => new Uint8Array([1, 2, 3, 4]))(key), bundledFace, "an undecodable project buffer falls back to the bundled face");
});
