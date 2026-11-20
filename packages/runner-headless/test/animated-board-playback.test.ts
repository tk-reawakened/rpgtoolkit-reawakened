import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyCharacter,
  createEmptyMainFile,
  createEngine,
  PACKAGE_ROOT,
  TILE_ANIMATION_MAGIC,
  writeBoard,
  writeCharacter,
  writeMainFile,
  writeTileAnimation,
  type AssetKey,
  type InputRecord,
} from "@tk-reawakened/core";
import { runClosingFrames, type ClosingGamePlan, type ClosingPlan } from "@tk-reawakened/runner-harness";

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function tileset(): Uint8Array {
  const bytes = new Uint8Array(6 + 32 * 32 * 3);
  bytes[0] = 20;
  bytes[2] = 1;
  bytes[4] = 1;
  bytes.fill(64, 6);
  return bytes;
}

function board(enterProgram = ""): Uint8Array {
  const empty = createEmptyBoard();
  return unwrap(writeBoard({
    ...empty,
    sizeX: 2,
    sizeY: 1,
    sizeL: 1,
    lut: ["", "water.tan"],
    tileMatrix: [1, 1],
    tileRuns: [{ lutIndex: 1, count: 2, marker: true }],
    layerTitles: ["", ""],
    properties: { ...empty.properties, enterPrg: enterProgram, start: { x: 16, y: 31, layer: 1 } },
  }));
}

function animationFiles(enterProgram = ""): Map<string, Uint8Array> {
  const main = unwrap(writeMainFile({
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    startupPrg: "",
    initBoard: "start.brd",
    initChar: "hero.tem",
  }));
  return new Map([
    ["main.gam", main],
    ["boards/start.brd", board(enterProgram === "" ? "" : "enter.prg")],
    ["tiles/water.tan", unwrap(writeTileAnimation({
      magic: TILE_ANIMATION_MAGIC,
      major: 2,
      minor: 0,
      speed: 5,
      frameCount: 3,
      frames: ["first.tst1", "", "second.tst1"],
    }))],
    ["tiles/first.tst", tileset()],
    ["tiles/second.tst", tileset()],
    ["chrs/hero.tem", unwrap(writeCharacter({
      ...createEmptyCharacter(),
      minor: 5,
      name: "Hero",
      movementAnimations: Array(8).fill(""),
      battleStances: Array(6).fill(""),
    }))],
    ...(enterProgram === "" ? [] : [["prg/enter.prg", new TextEncoder().encode(enterProgram)] as const]),
  ]);
}

type AnimationLaunch = {
  readonly draws: ReadonlyMap<number, readonly AssetKey[]>;
  readonly requestedAssets: readonly AssetKey[];
  readonly saveTick: number | null;
  readonly loadFound: boolean | null;
  readonly diagnostics: readonly string[];
};
function runAnimationLaunch(files: ReadonlyMap<string, Uint8Array>, blobs: Map<string, Uint8Array>): AnimationLaunch {
  const assets = new Map<AssetKey, Uint8Array>([...files].map(([path, bytes]) => [assetKey(path), bytes]));
  const engine = createEngine({
    seed: 5,
    assetIndex: createAssetIndex([...assets.keys()]),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "animated-board-save-load",
    width: 64,
    height: 32,
    maxTicks: 100,
    startup: {
      presence: { hasPlayer: () => true },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
  });
  const draws = new Map<number, readonly AssetKey[]>();
  const requestedAssets: AssetKey[] = [];
  const diagnostics: string[] = [];
  let saveTick: number | null = null;
  let loadFound: boolean | null = null;
  let replies: InputRecord[] = [];
  let tick = 0;
  let booting = true;
  for (let guard = 0; guard < 1000 && (booting || tick < 36 || replies.length > 0); guard += 1) {
    const report = engine.advance(booting ? 0 : 1, replies);
    tick = report.tickAfter;
    replies = [];
    diagnostics.push(...report.diagnostics.map((diagnostic) => `${diagnostic.code}:${diagnostic.file}:${diagnostic.message}`));
    draws.set(tick, engine.drawList().commands.flatMap((command) =>
      command.kind === "blit" && "asset" in command.source && command.source.tile !== null ? [command.source.asset] : [],
    ));
    for (const request of report.requests) {
      if (request.kind === "asset") {
        requestedAssets.push(request.key);
        replies.push({ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: assets.get(request.key) ?? null } });
      } else if (request.kind === "saveBlob") {
        saveTick = report.tickAfter;
        blobs.set(`${request.blob.area}:${request.blob.path}`, new Uint8Array(request.bytes));
        replies.push({ tick: report.tickAfter, event: { kind: "blob.saved", reqId: request.reqId, ok: true } });
      } else if (request.kind === "loadBlob") {
        const bytes = blobs.get(`${request.blob.area}:${request.blob.path}`) ?? null;
        loadFound = bytes !== null;
        replies.push({ tick: report.tickAfter, event: { kind: "blob.loaded", reqId: request.reqId, bytes } });
      } else if (request.kind === "listBlobs") {
        replies.push({ tick: report.tickAfter, event: { kind: "blob.listed", reqId: request.reqId, names: [] } });
      }
    }
    if (booting && !report.loading && replies.length === 0) booting = false;
  }
  return { draws, requestedAssets, saveTick, loadFound, diagnostics };
}

test("authored package board animation plays in sync through the headless engine", () => {
  const files = new Map<string, Uint8Array>([
    ["boards/start.brd", board()],
    ["tiles/water.tan", unwrap(writeTileAnimation({
      magic: TILE_ANIMATION_MAGIC,
      major: 2,
      minor: 0,
      speed: 5,
      frameCount: 3,
      frames: ["first.tst1", "", "second.tst1"],
    }))],
    ["tiles/first.tst", tileset()],
    ["tiles/second.tst", tileset()],
    ["chrs/hero.tem", unwrap(writeCharacter({
      ...createEmptyCharacter(),
      minor: 5,
      name: "Hero",
      movementAnimations: Array(8).fill(""),
      battleStances: Array(6).fill(""),
    }))],
  ]);
  const game: ClosingGamePlan = {
    name: "animated-board-authored",
    dialect: "tk3",
    main: { synthesised: { startupPrg: "", initBoard: "start.brd", initChar: "hero.tem" } },
    expect: { outcome: "boots" },
  };
  const plan: ClosingPlan = {
    schema: 1,
    seed: 5,
    width: 64,
    height: 32,
    maxTicks: 60,
    bundled: [],
    batches: [1],
    keys: [],
    frames: [0, 11, 12, 24, 36].map((tick) => ({ label: `tick-${tick}`, tick })),
    games: [game],
  };
  const run = runClosingFrames(plan, game, files, new Map());
  equal(run.stalled, false);
  equal(run.ticks, 36);
  equal(run.board, "boards/start.brd");
  equal(run.diagnostics.length, 0);
  const water = "tiles/first.tst" as AssetKey;
  const later = "tiles/second.tst" as AssetKey;
  const tileSources = (tick: number): AssetKey[] => {
    const frame = run.frames.find((candidate) => candidate.tick === tick);
    ok(frame !== undefined, `captured tick ${tick}`);
    return frame.drawList.commands.flatMap((command) => command.kind === "blit" && "asset" in command.source && command.source.tile !== null
      ? [command.source.asset]
      : []);
  };
  deepEqual(tileSources(0), [water, water]);
  deepEqual(tileSources(11), [water, water]);
  deepEqual(tileSources(12), []);
  deepEqual(tileSources(24), [later, later]);
  deepEqual(tileSources(36), [water, water]);
});
test("authored animated board preserves tick phase through real saveBlob/loadBlob continuation", () => {
  const script = [
    'load("slot")',
    "delay(0.2)",
    "marker = 4242",
    'saveOk = save("slot")',
    "delay(1)",
    "end()",
    "",
  ].join("\n");
  const files = animationFiles(script);
  const blobs = new Map<string, Uint8Array>();
  const saved = runAnimationLaunch(files, blobs);
  ok(saved.saveTick !== null && saved.saveTick > 0 && saved.saveTick < 36, `save captured during playback at tick ${String(saved.saveTick)}; diagnostics=${saved.diagnostics.join(",")}`);
  equal(saved.loadFound, false, "first real loadBlob request finds no prior save");
  deepEqual(saved.diagnostics, [], "save launch has no runtime diagnostics");

  const loaded = runAnimationLaunch(files, blobs);
  equal(loaded.loadFound, true, "second real loadBlob request restores the saved bytes");
  equal(loaded.saveTick, null, "restored script continues after Save rather than saving again");
  deepEqual(loaded.diagnostics, [], "load launch has no runtime diagnostics");
  ok(saved.requestedAssets.includes("tiles/second.tst" as AssetKey), "later animation asset is requested before the board finishes loading");
  const water = "tiles/first.tst" as AssetKey;
  const later = "tiles/second.tst" as AssetKey;
  const uninterruptedExpected = new Map<number, readonly AssetKey[]>([
    [11, [water, water]],
    [12, []],
    [24, [later, later]],
    [36, [water, water]],
  ]);
  for (const [tick, sources] of uninterruptedExpected) {
    deepEqual(saved.draws.get(tick), sources, `uninterrupted draw at tick ${tick}`);
  }
  const savedTick = saved.saveTick;
  if (savedTick === null) throw new Error("expected a saved animation tick");
  const firstRestoredTick = [...loaded.draws.keys()].filter((tick) => tick >= savedTick).sort((left, right) => left - right)[0];
  if (firstRestoredTick === undefined) throw new Error(`no draw captured after load restored save tick ${savedTick}`);
  ok(firstRestoredTick <= savedTick + 1, `load resumed at ${firstRestoredTick}, adjacent to saved tick ${savedTick}`);
  const compareTicks = [firstRestoredTick, ...[12, 24, 36].filter((tick) => tick > firstRestoredTick)];
  const expectedAt = (tick: number): readonly AssetKey[] => {
    const frame = tick % 36;
    return frame < 12 ? [water, water] : frame < 24 ? [] : [later, later];
  };
  for (const tick of compareTicks) {
    deepEqual(saved.draws.get(tick), expectedAt(tick), `uninterrupted draw at tick ${tick}`);
    deepEqual(loaded.draws.get(tick), expectedAt(tick), `restored draw at tick ${tick}`);
    deepEqual(loaded.draws.get(tick), saved.draws.get(tick), `save/load continuation matches uninterrupted playback at tick ${tick}`);
  }
});
