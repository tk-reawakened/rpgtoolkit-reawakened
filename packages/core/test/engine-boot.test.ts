// Boot and `send` on the engine loop (ticket 4.20; docs/spec/engine/main-loop-and-startup.md#e-02,
// docs/spec/engine/main-loop-and-startup.md#reawakened-boot-sequence, #reawakened-board-entry and
// docs/spec/engine/movement-and-collision.md#reawakened-send-board).
//
// The games are authored here from the format layouts (G7). The test doubles stand in for
// movement-triggers (first player, presence, camera target) and menu-party-save (saved games)
// until those epics register the real owners.
import { test } from "node:test";
import { deepEqual, equal } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TextEncoder } from "node:util";
import {
  actorFromSource,
  addActor,
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  COMPILER_VERSION,
  createEmptyMainFile,
  createEngine,
  PACKAGE_ROOT,
  writeBoard,
  writeMainFile,
  startProgram,
} from "../src/index.ts";
import { engineEffect, resolveManifestPlugins } from "../src/engine/boot.ts";
import type { AssetIndex, AssetRoot, Engine, EffectRecord, EngineInit, GameState, InputRecord, PackageCatalogueEntry, PlainData, TickReport } from "../src/index.ts";
import type { MainFileAudioSettings } from "../src/formats/main-file/model.ts";
import type { AudioCue } from "../src/ports/audio.ts";
import { BUILTIN_TRACKS } from "../src/audio/model.ts";
import { createAudioRuntime } from "../src/audio/runtime.ts";
import { queueNativeEvent } from "../src/events/emitter.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const encoder = new TextEncoder();

type Files = Map<string, Uint8Array>;
type BoardSpec = { readonly music?: string; readonly enter?: string; readonly threads?: readonly string[]; readonly tiles?: readonly [number, number]; readonly start?: readonly [number, number] };
type GameSpec = {
  readonly startup?: string;
  readonly initChar?: string;
  readonly initBoard?: string;
  readonly boards: Readonly<Record<string, BoardSpec>>;
  readonly programs: Readonly<Record<string, string>>;
  readonly fonts?: Readonly<Record<string, Uint8Array>>;
  readonly plugins?: readonly string[];
  /** The TKR package names of the main file's package-list extension, in order. */
  readonly packages?: readonly string[];
  readonly audioSettings?: MainFileAudioSettings | null;
  readonly soundFonts?: readonly string[];
  /** Lay the game out as a game folder (`Main/` plus `Game/<project>/`) instead of a package. */
  readonly project?: string;
};

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function boardBytes(spec: BoardSpec): Uint8Array {
  const [sizeX, sizeY] = spec.tiles ?? [40, 30];
  const cells = sizeX * sizeY;
  const empty = createEmptyBoard();
  return unwrap(writeBoard({
    ...empty,
    sizeX,
    sizeY,
    sizeL: 1,
    tileMatrix: Array.from({ length: cells }, () => 0),
    tileRuns: [{ lutIndex: 0, count: cells, marker: true }],
    threads: [...(spec.threads ?? [])],
    layerTitles: ["", ""],
    properties: {
      ...empty.properties,
      backgroundMusic: spec.music ?? "",
      enterPrg: spec.enter ?? "",
      start: { x: spec.start?.[0] ?? 64, y: spec.start?.[1] ?? 64, layer: 1 },
    },
  }));
}

type AuthoredGame = { readonly files: Files; readonly index: AssetIndex; readonly main: string; readonly root: AssetRoot };

/** Author a package-rooted game: its files by canonical key and the index over their paths. */
function authorGame(spec: GameSpec): AuthoredGame {
  const prefix = spec.project === undefined ? "" : `Game/${spec.project}/`;
  const mainPath = spec.project === undefined ? "main.gam" : "Main/test.gam";
  const paths: string[] = [mainPath];
  const files: Files = new Map();
  const add = (path: string, bytes: Uint8Array): void => {
    paths.push(`${prefix}${path}`);
    files.set(assetKey(`${prefix}${path}`), bytes);
  };
  const main = {
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    projectPath: spec.project ?? "",
    startupPrg: spec.startup ?? "",
    initBoard: spec.initBoard ?? "start.brd",
    initChar: spec.initChar ?? "",
    plugins: (spec.plugins ?? []).map((pluginFile) => ({ enabled: 0, pluginFile })),
    audioSettings: spec.audioSettings ?? null,
    ...(spec.packages === undefined ? {} : { packagePlugins: spec.packages }),
  };
  files.set(assetKey(mainPath), unwrap(writeMainFile(main)));
  for (const [name, board] of Object.entries(spec.boards)) add(`Boards/${name}`, boardBytes(board));
  for (const [name, text] of Object.entries(spec.programs)) add(`Prg/${name}`, encoder.encode(text));
  for (const [name, bytes] of Object.entries(spec.fonts ?? {})) add(`Font/${name}`, bytes);
  if (spec.initChar !== undefined && spec.initChar !== "") add(`Chrs/${spec.initChar}`, new Uint8Array([0]));
  for (const media of ["theme.mid", "other.mid"]) add(`Media/${media}`, new Uint8Array([0]));
  for (const name of spec.soundFonts ?? []) add(`Media/${name}`, new Uint8Array([0]));
  const root: AssetRoot = spec.project === undefined ? PACKAGE_ROOT : { kind: "game", projectPath: "" };
  return { files, index: createAssetIndex(paths), main: mainPath, root };
}

type Doubles = {
  readonly players: PlainData[];
  readonly sprites: EffectRecord[];
  readonly triggers: EffectRecord[];
  readonly audio: EffectRecord[];
  readonly options: Pick<EngineInit, "effectAppliers" | "cameraTarget" | "phaseRegistrations">;
  readonly startup: { readonly presence: { hasPlayer(): boolean }; readonly savedGame: { load(): { readonly kind: "missing" }; restored(): boolean } };
  state(): GameState;
};

/** Movement-triggers and menu-party-save stand-ins: a one-player sprites owner, a presence port and a saved-game port. */
function makeDoubles(
  restored = false,
  extraPhases: NonNullable<EngineInit["phaseRegistrations"]> = [],
): Doubles {
  const players: PlainData[] = [];
  const sprites: EffectRecord[] = [];
  const triggers: EffectRecord[] = [];
  const audio: EffectRecord[] = [];
  let position: { x: number; y: number } | null = null;
  let latest: GameState | null = null;
  return {
    players,
    sprites,
    triggers,
    audio,
    options: {
      effectAppliers: [
        {
          section: "sprites",
          applier: (effect) => {
            sprites.push(effect);
            if (effect.name === "createplayer") players.push(effect.args[0] ?? null);
            if (effect.name === "placeplayer") {
              const [x, y, , unit] = effect.args as [number, number, number, string];
              position = unit === "tile" ? { x: (x - 1) * 32 + 16, y: (y - 1) * 32 + 31 } : { x, y };
            }
          },
        },
        { section: "triggers", applier: (effect) => triggers.push(effect) },
        { section: "audio", applier: (effect) => audio.push(effect) },
      ],
      cameraTarget: { getPlayerPosition: () => (players.length === 0 ? null : position), getEntityPosition: () => null },
      phaseRegistrations: [
        { phase: "audio", run: (state) => { latest = state; } },
        ...extraPhases,
      ],
    },
    startup: { presence: { hasPlayer: () => players.length > 0 }, savedGame: { load: () => ({ kind: "missing" }), restored: () => restored } },
    state: () => {
      if (latest === null) throw new Error("no tick has run yet");
      return latest;
    },
  };
}

type RunResult = { readonly report: TickReport; readonly cues: AudioCue[]; readonly requests: string[]; readonly diagnostics: { readonly code: string; readonly file: string; readonly line: number; readonly message: string }[]; readonly ticksRun: number };

/** Play the host: answer every asset request from `files` and keep advancing until `ticks` ran or the engine stops. */
function run(engine: Engine, files: Files, ticks: number, inputs: readonly InputRecord[] = []): RunResult {
  const requests: string[] = [];
  const cues: AudioCue[] = [];
  const diagnostics: RunResult["diagnostics"][number][] = [];
  let remaining = ticks;
  let ran = 0;
  let replies: InputRecord[] = [...inputs];
  for (let guard = 0; guard < 400; guard += 1) {
    const report = engine.advance(remaining, replies);
    replies = [];
    ran += report.ticksRun;
    remaining -= report.ticksRun;
    diagnostics.push(...report.diagnostics);
    cues.push(...report.audioCues);
    for (const request of report.requests) if (request.kind === "asset") requests.push(request.key);
    if (report.loading) {
      replies = report.requests.flatMap((request) => (request.kind === "asset" ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }] : []));
      continue;
    }
    if (remaining <= 0 || report.ticksRun === 0) return { report, cues, requests, diagnostics, ticksRun: ran };
  }
  throw new Error("the host loop did not settle");
}

function bootEngine(game: AuthoredGame, doubles: Doubles, packageCatalogue?: readonly PackageCatalogueEntry[]): Engine {
  return createEngine({
    seed: 11,
    assetIndex: game.index,
    assetRoot: game.root,
    mainFile: game.main,
    gameIdentity: "engine-boot-test",
    startup: doubles.startup,
    width: 320,
    height: 240,
    maxTicks: 600,
    ...(packageCatalogue === undefined ? {} : { packageCatalogue }),
    ...doubles.options,
  });
}

const liberation = new Uint8Array(readFileSync(join(repoRoot, "media", "fonts", "LiberationSans-Regular.ttf")));

const SCRIPTED: GameSpec = {
  startup: "start.prg",
  initChar: "hero.tem",
  fonts: { "Good.ttf": liberation, "Broken.ttf": new Uint8Array([1, 2, 3, 4]) },
  boards: {
    "start.brd": { music: "theme.mid", enter: "enter.prg", threads: ["bg.prg"], tiles: [40, 30] },
  },
  programs: {
    "start.prg": "started = 1\nsleep(1)\nstartdone = 1\nend()\n",
    "enter.prg": "entered = 1\nend()\n",
    "bg.prg": "threadsleep(getthreadid(), 0)\n",
  },
};

test("a scripted game boots from start.prg to its first board with the ruled effects and state", () => {
  const game = authorGame(SCRIPTED);
  const doubles = makeDoubles();
  const engine = bootEngine(game, doubles);
  const result = run(engine, game.files, 30);
  deepEqual(result.requests.slice(0, 1), ["main.gam"]);
  deepEqual(result.requests.filter((key) => key.startsWith("font/")), ["font/good.ttf", "font/broken.ttf"]);
  equal(result.requests.indexOf("prg/start.prg") > 0, true);
  equal(result.requests.includes("boards/start.brd"), true);
  deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), ["font.rejected"]);
  const state = doubles.state();
  equal(state.engine.boot?.stage, "running");
  deepEqual(state.engine.boot?.fonts, ["font/good.ttf"]);
  equal(state.world.board?.key, "boards/start.brd");
  deepEqual(doubles.players, ["chrs/hero.tem"]);
  equal(state.vm.globals.started, 1);
  equal(state.vm.globals.startdone, 1);
  equal(state.vm.globals.entered, 1);
  deepEqual(doubles.sprites.map((effect) => [effect.name, ...effect.args]), [["createplayer", "chrs/hero.tem"], ["placeplayer", 64, 64, 1, "pixel"]]);
  deepEqual(doubles.triggers.map((effect) => [effect.name, ...effect.args]), [["deactivateat", 64, 64, 1, "pixel"]]);
  deepEqual(doubles.audio.map((effect) => [effect.name, effect.kind, ...effect.args]), [["music.play", "draw-audio-cue", "media/theme.mid", true, null, "board"]]);
  deepEqual({ x: state.camera.x, y: state.camera.y }, { x: 0, y: 0 });
  equal(state.vm.threads.some((thread) => thread.kind === "board" && thread.status !== "finished"), true);
});
test("battleEnded dispatches before boardReturned and restores active board music before audio", () => {
  const game = authorGame({
    startup: "start.prg",
    initChar: "hero.tem",
    boards: { "start.brd": { music: "theme.mid" } },
    programs: {
      "start.prg": [
        'eventOrder = ""',
        'game.on("battleEnded", (event) => {',
        '  eventOrder = eventOrder + "B"',
        '  battleOutcome = event.detail.outcome',
        '})',
        'game.on("boardReturned", (event) => {',
        '  eventOrder = eventOrder + "R"',
        '  returnedBoard = event.detail["boardKey"]',
        '})',
        "listenerReady = 1",
        "end()",
      ].join("\n"),
    },
  });
  let queuedBattleEnd = false;
  let doubles!: Doubles;
  doubles = makeDoubles(false, [{
    phase: "events",
    run(state, postEffect) {
      if (queuedBattleEnd || state.vm.globals.listenerready !== 1) return;
      if (!doubles.audio.some((effect) => effect.name === "music.play" && effect.args[3] === "board")) return;
      queuedBattleEnd = true;
      postEffect?.("audio", engineEffect("audio", "music.play", [
        assetKey("media/other.mid"), true, false, "battle",
      ], "draw-audio-cue"));
      queueNativeEvent(state.vm, state.events, "game", "battleEnded", { outcome: 0 });
    },
  }]);
  const engine = bootEngine(game, doubles);
  const result = run(engine, game.files, 8);
  const state = doubles.state();
  equal(queuedBattleEnd, true);
  deepEqual(result.diagnostics, []);
  equal(state.vm.globals.eventorder, "BR");
  equal(state.vm.globals.battleoutcome, 0);
  equal(state.vm.globals.returnedboard, "boards/start.brd");
  deepEqual(doubles.audio.filter((effect) => effect.name === "music.play").map((effect) => effect.args), [
    [assetKey("media/theme.mid"), true, null, "board"],
    [assetKey("media/other.mid"), true, false, "battle"],
    [assetKey("media/theme.mid"), true, null, "board"],
  ]);
});

test("engine-backed dialogue displays through the message window and resumes on input", () => {
  const game = authorGame(SCRIPTED);
  const doubles = makeDoubles();
  const engine = bootEngine(game, doubles);
  run(engine, game.files, 30);
  const state = doubles.state();
  const board = state.world.board;
  if (board == null) throw new Error("boot did not load its first board");
  const actor = addActor(state.actors, {
    kind: "party",
    source: "hero.tem",
    stats: { hp: 12, maxHp: 12, smp: 4, maxSmp: 4, dp: 2, fp: 3, level: 1 },
    behaviour: "stock-rpg.hero",
  });
  const source = actorFromSource({
    id: "dialogue-player",
    kind: "player",
    source: "hero.tem",
    x: 64,
    y: 64,
    layer: 1,
    controlled: true,
  }, board, 0, null);
  state.sprites.players = [{ ...source, actorId: actor.id }];
  const thread = startProgram(state.vm, {
    kind: "inline",
    text: 'dialogue("Hello, <name>")',
    compiler: COMPILER_VERSION,
  });
  thread.source = source.id;
  state.vm.globals.name = "Ada";

  engine.advance(1, []);
  equal(state.ui.message.text, "Hello, Ada");
  equal(thread.status, "waiting");
  engine.advance(1, []);


  engine.advance(1, [{
    tick: state.time.tick,
    event: { kind: "key", name: "Enter", code: "Enter", char: null, down: true },
  }]);
  equal(thread.status, "finished");
});


test("boot is deterministic and independent of how ticks are batched", () => {
  const game = authorGame(SCRIPTED);
  const whole = bootEngine(game, makeDoubles());
  const wholeResult = run(whole, game.files, 30);
  const stepped = bootEngine(game, makeDoubles());
  let steppedHash = "";
  let ticks = 0;
  for (let step = 0; step < 30; step += 1) {
    const result = run(stepped, game.files, 1);
    ticks += result.ticksRun;
    steppedHash = result.report.stateHash;
  }
  equal(ticks, 30);
  equal(steppedHash, wholeResult.report.stateHash);
  const again = run(bootEngine(game, makeDoubles()), game.files, 30);
  equal(again.report.stateHash, wholeResult.report.stateHash);
});

test("a board whose thread list is the one empty string the editor writes starts no board thread and reports nothing", () => {
  // The sample games' start boards carry exactly this list (docs/spec/formats/board.md: an empty list is one empty string, empty entries ignored).
  const game = authorGame({ ...SCRIPTED, boards: { "start.brd": { music: "theme.mid", enter: "", threads: [""], tiles: [40, 30] } } });
  const doubles = makeDoubles();
  const result = run(bootEngine(game, doubles), game.files, 30);
  deepEqual(result.diagnostics.filter((diagnostic) => diagnostic.code === "program.missing"), []);
  equal(doubles.state().vm.threads.some((thread) => thread.kind === "board"), false);
  equal(doubles.state().engine.boot?.stage, "running");
});

test("a game with no player stops with the ruled diagnostic and runs no board", () => {
  const game = authorGame({ ...SCRIPTED, initChar: "" });
  const doubles = makeDoubles();
  const engine = bootEngine(game, doubles);
  const result = run(engine, game.files, 30);
  const stopped = result.diagnostics.find((diagnostic) => diagnostic.code === "startup.no-player");
  equal(stopped?.message, "an initial character must be defined");
  equal(result.requests.includes("boards/start.brd"), false);
  const next = engine.advance(5, []);
  equal(next.ticksRun, 0);
  equal(doubles.state().engine.boot?.stage, "stopped");
});

test("a restored saved game skips initBoard and its board entry", () => {
  const game = authorGame(SCRIPTED);
  const doubles = makeDoubles(true);
  const engine = bootEngine(game, doubles);
  const result = run(engine, game.files, 20);
  equal(result.requests.includes("boards/start.brd"), false);
  equal(doubles.state().engine.boot?.stage, "running");
  equal(doubles.audio.length, 0);
});

test("a legacy stock plugin row installs its package and an unmapped DLL is one located diagnostic", () => {
  const game = authorGame({ ...SCRIPTED, plugins: ["no-such-plugin.dll", "Plugin\\tk3fight.dll"] });
  const catalogue: readonly PackageCatalogueEntry[] = [{
    name: "stock_battle",
    version: "1.0.0",
    requests: [],
    definition: { id: "stock_battle", version: "1.0.0", commands: [] },
    startup: { kind: "inline", text: "packageStarted = 1\n", compiler: COMPILER_VERSION, dialect: "tk3" },
  }];
  const doubles = makeDoubles();
  const result = run(bootEngine(game, doubles, catalogue), game.files, 30);
  deepEqual(
    result.diagnostics.filter((diagnostic) => diagnostic.code === "plugin.legacy-unmapped").map((diagnostic) => [diagnostic.file, diagnostic.line]),
    [[game.main, 0]],
  );
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "plugin.unresolved"), false);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "manifest.package-name"), false);
  equal(doubles.state().vm.globals.packagestarted, 1);
  equal(doubles.state().engine.boot?.stage, "running");
});

test("the main file's package names feed the manifest in stored order, and a name with no definition is a located diagnostic", () => {
  const game = authorGame({ ...SCRIPTED, plugins: ["no-such-plugin.dll"], packages: ["weather", "quests"] });
  const result = run(bootEngine(game, makeDoubles()), game.files, 10);
  const unresolved = result.diagnostics.filter((diagnostic) => diagnostic.code === "plugin.unresolved");
  deepEqual(unresolved.map((diagnostic) => diagnostic.message.includes("weather") ? "weather" : diagnostic.message.includes("quests") ? "quests" : "other"), ["weather", "quests"]);
  equal(unresolved.every((diagnostic) => diagnostic.file === game.main), true);
  deepEqual(unresolved.map((diagnostic) => diagnostic.line), [0, 1]);
});
test("a host catalogue resolves the listed package and runs its owned startup before main startup", () => {
  const game = authorGame({
    ...SCRIPTED,
    startup: "start.prg",
    packages: ["WEATHER"],
    programs: { ...SCRIPTED.programs, "start.prg": 'result = packagecmd()\ngame.emit("ping")\nobserved = packageStarted\nend()\n' },
  });
  const catalogue: readonly PackageCatalogueEntry[] = [{
    name: "Weather",
    version: "1.2",
    namespace: "climate",
    requests: ["asset"],
    definition: {
      id: "weather",
      version: "1.2",
      commands: [
        { name: "packagecmd", aliases: [], params: [], call: () => ({ value: 42 }) },
        { name: "packagelistener", aliases: [], params: [{ name: "event", optional: false, byRef: false, variadic: false }], call: (view) => { const state = view.state; if (state === undefined) return { value: 0 }; state.vm.globals.packageEvents = Number(state.vm.globals.packageEvents ?? 0) + 1; return { value: 0 }; } },
      ],
      listeners: [{ emitter: "game", type: "ping", command: "packagelistener" }],
    },
    startup: { kind: "inline", text: "packageStarted = 1\nend()\n", compiler: COMPILER_VERSION, dialect: "tk3" },
  }];
  const doubles = makeDoubles();
  const result = run(bootEngine(game, doubles, catalogue), game.files, 10);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "plugin.unresolved"), false);
  equal(doubles.state().vm.globals.result, 42);
  equal(doubles.state().vm.globals.observed, 1);
  equal(doubles.state().vm.globals.packageEvents, 1);
});

test("selected package audio tracks append in package order and duplicate names keep the larger voice count", () => {
  const game = authorGame({
    ...SCRIPTED,
    packages: ["weather", "climate"],
    audioSettings: {
      tracks: [
        { name: "music", voiceCount: 1 },
        { name: "sfx", voiceCount: 1 },
        { name: "ambience", voiceCount: 4 },
        { name: "voice", voiceCount: 2 },
        { name: "ui", voiceCount: 4 },
        { name: "rain", voiceCount: 2 },
      ],
      voiceCap: 32,
      defaultSoundFont: null,
    },
  });
  const catalogue: readonly PackageCatalogueEntry[] = [
    {
      name: "weather",
      version: "1.0.0",
      requests: [],
      definition: {
        id: "weather",
        version: "1.0.0",
        commands: [],
        audioTracks: [{ name: "cloud" }, { name: "Rain", voiceCount: 3 }, { name: "mist" }],
      },
    },
    {
      name: "climate",
      version: "1.0.0",
      requests: [],
      definition: {
        id: "climate",
        version: "1.0.0",
        commands: [],
        audioTracks: [{ name: "CLOUD", voiceCount: 2 }, { name: "rain", voiceCount: 2 }],
      },
    },
  ];
  const doubles = makeDoubles();
  const result = run(bootEngine(game, doubles, catalogue), game.files, 10);
  const tracks = doubles.state().audio.tracks;
  deepEqual(tracks.map(({ name, voiceCount }) => [name, voiceCount]), [
    ["music", 1],
    ["sfx", 1],
    ["ambience", 4],
    ["voice", 2],
    ["ui", 4],
    ["rain", 3],
    ["cloud", 2],
    ["mist", 1],
  ]);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "media.package-track"), false);
});

test("package audio declarations reject only invalid entries and retain later valid tracks", () => {
  const game = authorGame({ ...SCRIPTED, packages: ["weather"] });
  const catalogue: readonly PackageCatalogueEntry[] = [{
    name: "weather",
    version: "1.0.0",
    requests: [],
    definition: {
      id: "weather",
      version: "1.0.0",
      commands: [],
      audioTracks: [{ name: "bad name" }, { name: "silent", voiceCount: 0 }, { name: "hail" }],
    },
  }];
  const doubles = makeDoubles();
  const result = run(bootEngine(game, doubles, catalogue), game.files, 10);
  deepEqual(
    doubles.state().audio.tracks.slice(5).map(({ name, voiceCount }) => [name, voiceCount]),
    [["hail", 1]],
  );
  const rejected = result.diagnostics.filter((diagnostic) => diagnostic.code === "media.package-track");
  equal(rejected.length, 2);
  equal(rejected.every((diagnostic) => diagnostic.file === game.main && diagnostic.line === 0), true);
  equal(rejected[0]?.message.includes('audioTracks[0]'), true);
  equal(rejected[1]?.message.includes('audioTracks[1]'), true);
});

test("package audio cap failures preserve prior tracks and continue with later declarations", () => {
  const game = authorGame({
    ...SCRIPTED,
    packages: ["weather", "climate"],
    audioSettings: {
      tracks: [
        { name: "music", voiceCount: 1 },
        { name: "sfx", voiceCount: 1 },
        { name: "ambience", voiceCount: 4 },
        { name: "voice", voiceCount: 2 },
        { name: "ui", voiceCount: 4 },
        { name: "rain", voiceCount: 1 },
      ],
      voiceCap: 16,
      defaultSoundFont: null,
    },
  });
  const catalogue: readonly PackageCatalogueEntry[] = [
    {
      name: "weather",
      version: "1.0.0",
      requests: [],
      definition: {
        id: "weather",
        version: "1.0.0",
        commands: [],
        audioTracks: [{ name: "storm", voiceCount: 4 }, { name: "breeze", voiceCount: 2 }],
      },
    },
    {
      name: "climate",
      version: "1.0.0",
      requests: [],
      definition: {
        id: "climate",
        version: "1.0.0",
        commands: [],
        audioTracks: [{ name: "rain", voiceCount: 4 }, { name: "wind" }],
      },
    },
  ];
  const doubles = makeDoubles();
  const result = run(bootEngine(game, doubles, catalogue), game.files, 10);
  deepEqual(doubles.state().audio.tracks.map(({ name, voiceCount }) => [name, voiceCount]), [
    ["music", 1],
    ["sfx", 1],
    ["ambience", 4],
    ["voice", 2],
    ["ui", 4],
    ["rain", 1],
    ["breeze", 2],
    ["wind", 1],
  ]);
  const rejected = result.diagnostics.filter((diagnostic) => diagnostic.code === "media.package-track");
  equal(rejected.length, 2);
  equal(rejected.every((diagnostic) => diagnostic.file === game.main), true);
  equal(rejected[0]?.message.includes('package "weather" audioTracks[0]'), true);
  equal(rejected[1]?.message.includes('package "climate" audioTracks[0]'), true);
});

test("package audio declarations respect the 16-track limit without removing game tracks", () => {
  const game = authorGame({
    ...SCRIPTED,
    packages: ["weather"],
    audioSettings: {
      tracks: [
        { name: "music", voiceCount: 1 },
        { name: "sfx", voiceCount: 1 },
        { name: "ambience", voiceCount: 4 },
        { name: "voice", voiceCount: 2 },
        { name: "ui", voiceCount: 4 },
        ...Array.from({ length: 11 }, (_, index) => ({ name: `game${index}`, voiceCount: 1 })),
      ],
      voiceCap: 32,
      defaultSoundFont: null,
    },
  });
  const catalogue: readonly PackageCatalogueEntry[] = [{
    name: "weather",
    version: "1.0.0",
    requests: [],
    definition: { id: "weather", version: "1.0.0", commands: [], audioTracks: [{ name: "overflow" }] },
  }];
  const doubles = makeDoubles();
  const result = run(bootEngine(game, doubles, catalogue), game.files, 10);
  equal(doubles.state().audio.tracks.length, 16);
  equal(doubles.state().audio.tracks.some(({ name }) => name === "overflow"), false);
  equal(result.diagnostics.filter((diagnostic) => diagnostic.code === "media.package-track").length, 1);
  equal(result.diagnostics.find((diagnostic) => diagnostic.code === "media.package-track")?.message.includes("track-limit"), true);
});

test("manifest package lookup folds ASCII package identity", () => {
  const resolved = resolveManifestPlugins(
    [{ id: "WEATHER", version: "1.2" }],
    "main.gam",
    [{
      name: "Weather",
      version: "1.2",
      requests: [],
      definition: { id: "weather", version: "1.2", commands: [] },
      startup: { kind: "inline", text: "end()\n", compiler: COMPILER_VERSION, dialect: "tk3" },
    }],
  );
  equal(resolved.diagnostics.length, 0);
  equal(resolved.plugins[0]?.package?.name, "weather");
  equal(resolved.plugins[0]?.startup?.owner, "weather");
});
test("a package startup that waits is rejected by the lifecycle clock guard", () => {
  const game = authorGame({ ...SCRIPTED, packages: ["weather"] });
  const catalogue: readonly PackageCatalogueEntry[] = [{
    name: "weather",
    version: "1.2",
    requests: [],
    definition: { id: "weather", version: "1.2", commands: [] },
    startup: { kind: "inline", text: "sleep(1)\n", compiler: COMPILER_VERSION, dialect: "tk3" },
  }];
  const result = run(bootEngine(game, makeDoubles(), catalogue), game.files, 10);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "package.startup-unfinished"), true);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "startup.no-player"), false);
});
test("a package startup that consumes randomness is rejected by the lifecycle guard", () => {
  const game = authorGame({ ...SCRIPTED, packages: ["weather"] });
  const catalogue: readonly PackageCatalogueEntry[] = [{
    name: "weather",
    version: "1.2",
    requests: [],
    definition: { id: "weather", version: "1.2", commands: [] },
    startup: { kind: "inline", text: "random(3)\nend()\n", compiler: COMPILER_VERSION, dialect: "tk3" },
  }];
  const result = run(bootEngine(game, makeDoubles(), catalogue), game.files, 10);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "package.startup-forbidden"), true);
});
test("a package startup cannot read gametime through the virtual variable", () => {
  const game = authorGame({ ...SCRIPTED, packages: ["weather"] });
  const catalogue: readonly PackageCatalogueEntry[] = [{
    name: "weather",
    version: "1.2",
    requests: [],
    definition: { id: "weather", version: "1.2", commands: [] },
    startup: { kind: "inline", text: "observed = gametime\nend()\n", compiler: COMPILER_VERSION, dialect: "tk3" },
  }];
  const result = run(bootEngine(game, makeDoubles(), catalogue), game.files, 10);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "package.startup-forbidden"), true);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "package.startup-forbidden" && diagnostic.message.includes('package "weather"') && diagnostic.message.includes("simulation clock")), true);
});


test("a direct package command cannot consume RNG during startup", () => {
  const game = authorGame({ ...SCRIPTED, packages: ["weather"] });
  const catalogue: readonly PackageCatalogueEntry[] = [{
    name: "weather",
    version: "1.2",
    requests: [],
    definition: {
      id: "weather",
      version: "1.2",
      commands: [{ name: "directrng", aliases: [], params: [], call: (view) => { try { Object.assign(view, { packageStartup: false, rng: { nextUint32: () => 1 } }); } catch { /* frozen command view */ } try { Object.defineProperty(view, "rng", { value: { nextUint32: () => 1 } }); } catch { /* frozen command view */ } try { Object.defineProperty(view.rng, "nextUint32", { value: () => 1 }); } catch { /* frozen RNG port */ } view.rng.nextUint32(); return { value: null }; } }],
    },
    startup: { kind: "inline", text: "directrng()\nend()\n", compiler: COMPILER_VERSION, dialect: "tk3" },
  }];
  const result = run(bootEngine(game, makeDoubles(), catalogue), game.files, 10);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "package.startup-forbidden"), true);
});

test("a direct package command cannot consume the simulation clock during startup", () => {
  const game = authorGame({ ...SCRIPTED, packages: ["weather"] });
  const catalogue: readonly PackageCatalogueEntry[] = [{
    name: "weather",
    version: "1.2",
    requests: [],
    definition: {
      id: "weather",
      version: "1.2",
      commands: [{ name: "directclock", aliases: [], params: [], call: (view) => { view.clock.tick(); return { value: null }; } }],
    },
    startup: { kind: "inline", text: "directclock()\nend()\n", compiler: COMPILER_VERSION, dialect: "tk3" },
  }];
  const result = run(bootEngine(game, makeDoubles(), catalogue), game.files, 10);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "package.startup-forbidden"), true);
});

test("a direct package command cannot reach RNG through state during startup", () => {
  const game = authorGame({ ...SCRIPTED, packages: ["weather"] });
  const catalogue: readonly PackageCatalogueEntry[] = [{
    name: "weather",
    version: "1.2",
    requests: [],
    definition: {
      id: "weather",
      version: "1.2",
      commands: [{ name: "staterng", aliases: [], params: [], call: (view) => { Object.getOwnPropertyDescriptor(view.state!, "rng")?.value; return { value: null }; } }],
    },
    startup: { kind: "inline", text: "staterng()\nend()\n", compiler: COMPILER_VERSION, dialect: "tk3" },
  }];
  const result = run(bootEngine(game, makeDoubles(), catalogue), game.files, 10);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "package.startup-forbidden"), true);
});

test("a direct package command cannot reach the simulation clock through state during startup", () => {
  const game = authorGame({ ...SCRIPTED, packages: ["weather"] });
  const catalogue: readonly PackageCatalogueEntry[] = [{
    name: "weather",
    version: "1.2",
    requests: [],
    definition: {
      id: "weather",
      version: "1.2",
      commands: [{ name: "stateclock", aliases: [], params: [], call: (view) => { Object.getOwnPropertyDescriptor(view.state!, "time")?.value; return { value: null }; } }],
    },
    startup: { kind: "inline", text: "stateclock()\nend()\n", compiler: COMPILER_VERSION, dialect: "tk3" },
  }];
  const result = run(bootEngine(game, makeDoubles(), catalogue), game.files, 10);
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "package.startup-forbidden"), true);
});



test("a game-folder root takes its project path from the main file", () => {
  const game = authorGame({ ...SCRIPTED, project: "Sample" });
  const doubles = makeDoubles();
  const result = run(bootEngine(game, doubles), game.files, 10);
  deepEqual(result.requests.slice(0, 1), ["main/test.gam"]);
  equal(result.requests.includes("game/sample/boards/start.brd"), true);
  equal(doubles.state().world.board?.key, "game/sample/boards/start.brd");
  equal(doubles.state().vm.globals.entered, 1);
});

const SEND_GAME: GameSpec = {
  startup: "start.prg",
  initChar: "hero.tem",
  boards: {
    "start.brd": { music: "theme.mid", enter: "enter.prg", threads: ["bg.prg"] },
    "other.brd": { music: "theme.mid", enter: "enter2.prg", threads: ["bg2.prg"], tiles: [50, 40] },
    "quiet.brd": { music: "other.mid", tiles: [50, 40] },
  },
  programs: {
    "start.prg": "end()\n",
    "enter.prg": 'thread("threadsleep(getthreadid(), 0)", 1)\nsend("other.brd", 30, 20, 1)\naftersend = 1\nend()\n',
    "enter2.prg": "entered2 = 1\nend()\n",
    "bg.prg": "threadsleep(getthreadid(), 0)\n",
    "bg2.prg": "threadsleep(getthreadid(), 0)\n",
    "again.prg": 'send("quiet.brd", 2, 3)\nend()\n',
    "missing.prg": 'send("nowhere.brd", 1, 1)\nmissingresumed = 1\nend()\n',
  },
};

function livePrograms(state: GameState): string {
  return state.vm.threads.filter((thread) => thread.status !== "finished").map((thread) => `${thread.kind}:${thread.owner}`).sort().join(",");
}

test("send leaves the ruled state: old board threads dead, a persistent thread alive, the camera re-aligned", () => {
  const game = authorGame(SEND_GAME);
  const doubles = makeDoubles();
  const engine = bootEngine(game, doubles);
  const result = run(engine, game.files, 12);
  const state = doubles.state();
  equal(state.world.board?.key, "boards/other.brd");
  deepEqual(result.diagnostics, []);
  equal(state.vm.globals.aftersend, 1);
  equal(state.vm.globals.entered2, 1);
  // The start board's bg.prg thread died; the persistent thread and the new board's thread live.
  equal(livePrograms(state), "board:world,persistent:script");
  equal(state.engine.transition, undefined);
  // Tile (30, 20) is pixel (944, 639) on a 2D board (E-11): the camera centres on it without smoothing.
  deepEqual({ x: state.camera.x, y: state.camera.y, prevX: state.camera.prevX, prevY: state.camera.prevY }, { x: 784, y: 519, prevX: 784, prevY: 519 });
  deepEqual(doubles.sprites.map((effect) => [effect.name, ...effect.args]).slice(-1), [["placeplayer", 30, 20, 1, "tile"]]);
  deepEqual(doubles.triggers.map((effect) => [effect.name, ...effect.args]).slice(-1), [["deactivateat", 30, 20, 1, "tile"]]);
  // Both boards name theme.mid and every arrival posts its music; the audio applier, not the engine, decides to carry on (E-16).
  deepEqual(doubles.audio.map((effect) => [effect.name, ...effect.args]), [
    ["music.play", "media/theme.mid", true, null, "board"],
    ["music.play", "media/theme.mid", true, null, "board"],
  ]);
});

test("send resumes the caller on the next tick and a different board music posts one replacement", () => {
  const game = authorGame({ ...SEND_GAME, programs: { ...SEND_GAME.programs, "enter.prg": 'send("quiet.brd", 2, 3)\naftersend = 1\nend()\n' } });
  const doubles = makeDoubles();
  const engine = bootEngine(game, doubles);
  // Tick 0 runs the start-up program and boot enters the board; tick 1 runs the enter program up to `send`, and the swap happens before tick 2.
  const first = run(engine, game.files, 2);
  equal(first.ticksRun, 2);
  equal(doubles.state().world.board?.key, "boards/quiet.brd");
  equal(doubles.state().vm.globals.aftersend, undefined);
  run(engine, game.files, 1);
  equal(doubles.state().vm.globals.aftersend, 1);
  deepEqual(doubles.audio.map((effect) => effect.args[0]), ["media/theme.mid", "media/other.mid"]);
  // Tile (2, 3) is pixel (48, 95): the camera clamps to the board corner.
  deepEqual({ x: doubles.state().camera.x, y: doubles.state().camera.y }, { x: 0, y: 0 });
});

test("send to a board that is not in the game reports a diagnostic, changes nothing and resumes the caller", () => {
  const game = authorGame({ ...SEND_GAME, programs: { ...SEND_GAME.programs, "enter.prg": 'send("nowhere.brd", 1, 1)\nmissingresumed = 1\nend()\n' } });
  const doubles = makeDoubles();
  const result = run(bootEngine(game, doubles), game.files, 6);
  const missing = result.diagnostics.find((diagnostic) => diagnostic.file === "nowhere.brd");
  equal(missing?.code, "asset.missing");
  equal(doubles.state().world.board?.key, "boards/start.brd");
  equal(doubles.state().vm.globals.missingresumed, 1);
});

test("send validates its arguments with a catchable script error", () => {
  const game = authorGame({ ...SEND_GAME, programs: { ...SEND_GAME.programs, "enter.prg": 'send("", 1, 1)\nend()\n' } });
  const result = run(bootEngine(game, makeDoubles()), game.files, 4);
  equal(result.diagnostics.some((diagnostic) => diagnostic.message.includes("send")), true, JSON.stringify(result.diagnostics));
});

// The sample games: their start.prg boots through the real engine with the doubles above.
const legacyRoot = join(repoRoot, "fixtures", "legacy");
const haveLegacy = existsSync(legacyRoot);

/** Every file under `root`, as `/`-separated paths relative to it (directories are skipped by their read failing). */
function listFiles(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { recursive: true }).map((path) => path.split("\\").join("/")).sort()) {
    try {
      readFileSync(join(root, entry));
      found.push(entry);
    } catch {
      // A directory: its files are listed on their own.
    }
  }
  return found;
}

function sampleGame(name: string): { readonly files: Files; readonly index: AssetIndex; readonly startup: string; readonly initBoard: string; readonly initChar: string } | null {
  const root = join(legacyRoot, name);
  if (!existsSync(root)) return null;
  const relativePaths = listFiles(root);
  const lower = (path: string): string => path.toLowerCase();
  const startup = relativePaths.find((path) => lower(path) === "prg/start.prg");
  const board = relativePaths.find((path) => lower(path) === "boards/start.brd") ?? relativePaths.find((path) => lower(path).startsWith("boards/") && lower(path).endsWith(".brd"));
  const character = relativePaths.find((path) => lower(path) === "chrs/start.tem") ?? relativePaths.find((path) => lower(path).startsWith("chrs/") && lower(path).endsWith(".tem"));
  if (startup === undefined || board === undefined || character === undefined) return null;
  const initBoard = board.slice("Boards/".length);
  const initChar = character.slice("Chrs/".length);
  const main = { ...createEmptyMainFile(), major: 2, minor: 9, startupPrg: "start.prg", initBoard, initChar };
  const files: Files = new Map();
  const paths = ["main.gam", ...relativePaths];
  files.set(assetKey("main.gam"), unwrap(writeMainFile(main)));
  for (const path of relativePaths) files.set(assetKey(path), new Uint8Array(readFileSync(join(root, path))));
  return { files, index: createAssetIndex(paths), startup: "start.prg", initBoard, initChar };
}

for (const name of ["demo", "Basic"]) {
  test(`the ${name} sample game's start.prg boots through the real engine`, { skip: haveLegacy ? false : "run pnpm fixtures:fetch" }, () => {
    const sample = sampleGame(name);
    if (sample === null) throw new Error(`fixtures/legacy/${name} has no start program, board and character`);
    const doubles = makeDoubles();
    const engine = createEngine({
      seed: 3,
      assetIndex: sample.index,
      assetRoot: PACKAGE_ROOT,
      mainFile: "main.gam",
      gameIdentity: "engine-boot-sample",
      startup: doubles.startup,
      width: 640,
      height: 480,
      maxTicks: 600,
      ...doubles.options,
    });
    const result = run(engine, sample.files, 20);
    // The title screen parks the start-up program on its cursor-map key wait: boot is correct and in progress.
    const state = doubles.state();
    equal(state.engine.boot?.stage, "startup");
    deepEqual(doubles.players, [`chrs/${sample.initChar.toLowerCase()}`]);
    const blocking = state.vm.threads.filter((thread) => thread.kind === "blocking" && thread.status !== "finished");
    equal(blocking.length, 1);
    equal(blocking[0]?.wait?.kind, "input.key");
    deepEqual(result.diagnostics.filter((diagnostic) => diagnostic.code.startsWith("asset.") || diagnostic.code.startsWith("startup.") || diagnostic.code.startsWith("program.")), []);
    // Releasing the wait with a key moves the program on without a script error.
    const key = { tick: result.report.tickAfter, event: { kind: "key" as const, name: "ENTER", code: "Enter", char: null, down: true } };
    const after = run(engine, sample.files, 5, [key]);
    deepEqual(after.diagnostics.filter((diagnostic) => diagnostic.code.startsWith("asset.") || diagnostic.code.startsWith("startup.")), []);
  });
}

test("a Toolkit 2 sample's start.prg reports a located syntax diagnostic instead of throwing", { skip: haveLegacy ? false : "run pnpm fixtures:fetch" }, () => {
  // Its `#command` programs belong to the TK2 dialect, which boot does not select (epic tk2-support).
  const sample = sampleGame("Caoquest");
  if (sample === null) throw new Error("fixtures/legacy/Caoquest has no start program, board and character");
  const doubles = makeDoubles();
  const engine = createEngine({ seed: 3, assetIndex: sample.index, assetRoot: PACKAGE_ROOT, mainFile: "main.gam", gameIdentity: "engine-boot-tk2", startup: doubles.startup, width: 640, height: 480, maxTicks: 600, ...doubles.options });
  const result = run(engine, sample.files, 5);
  const syntax = result.diagnostics.find((diagnostic) => diagnostic.code === "syntax.error");
  equal(syntax?.file, "prg/start.prg");
});

const AUTHORED_AUDIO: MainFileAudioSettings = {
  tracks: [
    { name: "Music", voiceCount: 2 },
    { name: "sfx", voiceCount: 2 },
    { name: "ambience", voiceCount: 2 },
    { name: "voice", voiceCount: 2 },
    { name: "ui", voiceCount: 2 },
    { name: "weather", voiceCount: 3 },
  ],
  voiceCap: 16,
  defaultSoundFont: "Media/town.sf2",
};

type AudioPhaseRun = NonNullable<EngineInit["phaseRegistrations"]>[number]["run"];
type ResetRun = NonNullable<EngineInit["resetRegistrations"]>[number]["reset"];
function audioBoot(game: AuthoredGame, onAudioPhase?: AudioPhaseRun, onReset?: ResetRun, replacementIndex: AssetIndex = game.index): { engine: Engine; state(): GameState } {
  let latest: GameState | null = null;
  const engine = createEngine({
    seed: 11, assetIndex: replacementIndex, assetRoot: game.root, mainFile: game.main, gameIdentity: "engine-boot-audio", maxTicks: 10,
    width: 320, height: 240,
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    defaultSoundFont: assetKey("media/ignored.sf2"),
    phaseRegistrations: [{ phase: "audio", run: (state, postEffect) => { latest = state; onAudioPhase?.(state, postEffect); } }],
    ...(onReset === undefined ? {} : { resetRegistrations: [{ section: "audio", reset: onReset }] }),
  });
  return { engine, state: () => {
    if (latest === null) throw new Error("boot did not tick");
    return latest;
  } };
}

test("boot applies authored tracks and SoundFont before emitting exactly one initial bank cue", () => {
  const game = authorGame({ boards: { "start.brd": {} }, programs: {}, audioSettings: AUTHORED_AUDIO, soundFonts: ["town.sf2"] });
  const host = audioBoot(game);
  const result = run(host.engine, game.files, 2);
  deepEqual(result.diagnostics, []);
  deepEqual(host.state().audio.tracks.map((track) => [track.name, track.voiceCount]), AUTHORED_AUDIO.tracks.map((track) => [track.name.toLowerCase(), track.voiceCount]));
  deepEqual(result.cues.filter((cue) => cue.kind === "soundfont.set").map((cue) => cue.asset), [assetKey("media/town.sf2")]);
});

test("reset preserves authored audio settings, active playback and runtime-added tracks", () => {
  const game = authorGame({ boards: { "start.brd": { music: "theme.mid" } }, programs: {}, audioSettings: AUTHORED_AUDIO });
  game.files.set(assetKey("media/theme.mid"), readFileSync(join(testDir, "fixtures", "audio", "files", "midi0-480-default-tempo.mid")));
  let resetRequested = false;
  let resets = 0;
  let playbackCueId = 0;
  const host = audioBoot(game, (state, postEffect) => {
    if (resetRequested) return;
    const voice = state.audio.tracks[0]?.voices[0];
    if (voice === undefined) return;
    playbackCueId = voice.cueId;
    const runtime = createAudioRuntime(state, { lookup: () => ({ kind: "known", lengthTicks: 120 }) });
    equal(runtime.configurePackageTrack("runtime", 2), null);
    state.audio.settings.masterVolume = 40;
    state.audio.soundFont = assetKey("media/other.sf2");
    resetRequested = true;
    postEffect?.("engine", { thread: 0, name: "reset", kind: "state-write", args: [], out: {}, result: null, patch: null, wait: null, request: null });
  }, () => { resets += 1; });
  run(host.engine, game.files, 5);
  equal(resets, 1);
  const audio = host.state().audio;
  deepEqual(audio.tracks.map(({ name, voiceCount }) => [name, voiceCount]), [
    ["music", 2], ["sfx", 2], ["ambience", 2], ["voice", 2], ["ui", 2], ["weather", 3], ["runtime", 2],
  ]);
  equal(audio.tracks[0]?.state, "playing");
  equal(audio.tracks[0]?.voices[0]?.cueId, playbackCueId);
  equal(audio.tracks[0]?.voices[0]?.file, assetKey("media/theme.mid"));
  equal(audio.settings.masterVolume, 40);
  equal(audio.soundFont, assetKey("media/other.sf2"));
});

test("replacing the main file without audio settings restores built-in tracks", () => {
  const game = authorGame({ boards: { "start.brd": {} }, programs: {}, audioSettings: AUTHORED_AUDIO });
  const files = new Map(game.files);
  files.set(assetKey("replacement.gam"), unwrap(writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, projectPath: "", initBoard: "start.brd" })));
  const switchedIndex = createAssetIndex([...files.keys()]);
  let replacementRequested = false;
  let resets = 0;
  const host = audioBoot(game, (state, postEffect) => {
    if (replacementRequested) return;
    if (!state.audio.tracks.some(({ name }) => name === "weather")) return;
    const runtime = createAudioRuntime(state, { lookup: () => ({ kind: "known", lengthTicks: 120 }) });
    equal(runtime.configurePackageTrack("runtime", 2), null);
    replacementRequested = true;
    postEffect?.("engine", { thread: 0, name: "mainFile", kind: "state-write", args: [null, "replacement.gam"], out: {}, result: null, patch: null, wait: null, request: null });
  }, () => { resets += 1; }, switchedIndex);
  run(host.engine, files, 5);
  equal(replacementRequested, true);
  equal(resets, 1);
  deepEqual(host.state().audio.tracks.map(({ name, voiceCount }) => [name, voiceCount]), BUILTIN_TRACKS);
});


test("boot without an audio block uses Epic 6 defaults and ignores the startup-only bank", () => {
  const game = authorGame({ boards: { "start.brd": {} }, programs: {} });
  const host = audioBoot(game);
  const result = run(host.engine, game.files, 2);
  deepEqual(result.diagnostics, []);
  deepEqual(host.state().audio.tracks.map((track) => [track.name, track.voiceCount]), [["music", 1], ["sfx", 1], ["ambience", 4], ["voice", 2], ["ui", 4]]);
  deepEqual(result.cues.filter((cue) => cue.kind === "soundfont.set").map((cue) => cue.asset), [null]);
});

test("boot recovers over-cap tracks once at the first offending track and retains the independent bank", () => {
  const game = authorGame({ boards: { "start.brd": {} }, programs: {}, audioSettings: { ...AUTHORED_AUDIO, voiceCap: 9 }, soundFonts: ["town.sf2"] });
  const host = audioBoot(game);
  const result = run(host.engine, game.files, 2);
  deepEqual(result.diagnostics.map(({ code, file, line }) => ({ code, file, line })), [{ code: "media.voice-cap", file: "main.gam", line: 4 }]);
  deepEqual(host.state().audio.tracks.map((track) => [track.name, track.voiceCount]), [["music", 1], ["sfx", 1], ["ambience", 4], ["voice", 2], ["ui", 4]]);
  deepEqual(result.cues.filter((cue) => cue.kind === "soundfont.set").map((cue) => cue.asset), [assetKey("media/town.sf2")]);
});

test("boot diagnoses a missing authored bank once and emits null without refusing the game", () => {
  const game = authorGame({ boards: { "start.brd": {} }, programs: {}, audioSettings: AUTHORED_AUDIO });
  const host = audioBoot(game);
  const result = run(host.engine, game.files, 2);
  deepEqual(result.diagnostics.map(({ code, file }) => ({ code, file })), [{ code: "media.soundfont-missing", file: "media/town.sf2" }]);
  deepEqual(result.cues.filter((cue) => cue.kind === "soundfont.set").map((cue) => cue.asset), [null]);
});
