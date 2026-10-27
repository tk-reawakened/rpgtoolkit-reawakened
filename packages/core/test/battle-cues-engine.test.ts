// Entry 7.19 (#691), the whole-engine half: a real game boots with the authored `stock/stock_battle` package,
// starts a fight with `FightEnemy`, wins it, and the engine's own events return the board's music. Every cue is
// read from the engine's report, so this is the stream a runner receives (docs/spec/engine/audio-media.md#audio-headless).
// The cue inventory is docs/spec/engine/battle.md#bat-10-cue-inventory.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder, TextEncoder } from "node:util";
import { test } from "node:test";
import {
  addActor,
  assetKey,
  BATTLE_BACKGROUND_MAGIC,
  COMPILER_VERSION,
  createAssetIndex,
  createEmptyBoard,
  createEmptyMainFile,
  createEngine,
  deriveGameId,
  PACKAGE_ROOT,
  registerActorObject,
  writeBattleBackground,
  writeBoard,
  writeEnemy,
  writeMainFile,
  type AudioCue,
  type BattleBackground,
  type Engine,
  type Enemy,
  type GameState,
  type InputRecord,
  type PackageCatalogueEntry,
} from "../src/index.ts";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDirectory, "..", "..", "..");
const encoder = new TextEncoder();

type Files = Map<string, Uint8Array>;
type AuthoredGameFiles = { readonly files: Files; readonly paths: string[] };

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** A one-track Standard MIDI File that lasts five seconds (300 ticks). */
function midi(): Uint8Array {
  return new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 0x60,
    0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 12,
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
    0x87, 0x40, 0xff, 0x2f, 0x00,
  ]);
}

/** An 8-bit mono 8 kHz WAV of 4000 frames: half a second (30 ticks). */
function wav(): Uint8Array {
  const frames = 4000;
  const le32 = (value: number): number[] => [value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >> 24) & 255];
  const le16 = (value: number): number[] => [value & 255, (value >> 8) & 255];
  return new Uint8Array([
    ...encoder.encode("RIFF"), ...le32(36 + frames), ...encoder.encode("WAVE"),
    ...encoder.encode("fmt "), ...le32(16), ...le16(1), ...le16(1), ...le32(8000), ...le32(8000), ...le16(1), ...le16(8),
    ...encoder.encode("data"), ...le32(frames), ...new Array<number>(frames).fill(128),
  ]);
}

function authoredEnemy(): Uint8Array {
  const enemy: Enemy = {
    magic: "RPGTLKIT ENEMY",
    major: 2,
    minor: 1,
    name: "Slime",
    hp: 6,
    smp: 0,
    fp: 2,
    dp: 1,
    canRun: 1,
    criticalOn: 0,
    criticalBy: 0,
    specialMoves: [],
    weaknesses: [],
    strengths: [],
    aiLevel: 0,
    customAi: 0,
    aiProgram: "",
    experienceReward: 0,
    goldReward: 0,
    defeatProgram: "",
    runAwayProgram: "",
    stances: ["", "", "", "", "", ""],
    customStances: [],
    residue: new Uint8Array(),
  };
  return unwrap(writeEnemy(enemy));
}

function authoredBackground(): Uint8Array {
  const background: BattleBackground = {
    magic: BATTLE_BACKGROUND_MAGIC,
    major: 2,
    minor: 2,
    image: "",
    music: "battle.mid",
    menuMoveSound: "",
    menuChooseSound: "",
    readySound: "ready.wav",
    cantDoSound: "",
    residue: new Uint8Array(),
  };
  return unwrap(writeBattleBackground(background));
}

function authoredBoard(): Uint8Array {
  const empty = createEmptyBoard();
  return unwrap(writeBoard({
    ...empty,
    sizeX: 40,
    sizeY: 30,
    sizeL: 1,
    tileMatrix: Array.from({ length: 40 * 30 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 40 * 30, marker: true }],
    layerTitles: ["", ""],
    properties: { ...empty.properties, backgroundMusic: "board.mid", enterPrg: "enter.prg", start: { x: 64, y: 64, layer: 1 } },
  }));
}

/** The stock package exactly as the game's package list names it: the real manifest and the real program. */
function stockBattleCatalogue(): readonly PackageCatalogueEntry[] {
  const folder = join(repoRoot, "stock", "stock_battle");
  const manifest = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8")) as { name: string; version: string; namespace: string; requests: PackageCatalogueEntry["requests"]; program: string };
  return [{
    name: manifest.name,
    version: manifest.version,
    namespace: manifest.namespace,
    requests: manifest.requests,
    definition: { id: manifest.name, version: manifest.version, commands: [] },
    startup: { kind: "inline", text: readFileSync(join(folder, manifest.program), "utf8"), compiler: COMPILER_VERSION, dialect: "tk3" },
  }];
}

/** The board's enter program starts the fight; the hero wins on a later turn, so the sequence runs unattended. */
const ENTER_PROGRAM = [
  "stockBattle.turn = (party, index) => {",
  "  turns = turns + 1",
  "  if (party == 1 && turns > 2) {",
  "    physical({ source: battle.fighter(1, index), target: battle.fighter(0, 0), amount: 99 })",
  "  }",
  "  return 0",
  "}",
  "turns = 0",
  "sleep(2)",
  'game.on("battleEnded", (event) => { endedOutcome = event.detail.outcome; endedAfterTurns = turns })',
  'game.on("boardReturned", (event) => { returnedBoard = event.detail["boardKey"] })',
  'FightEnemy("slime", "night.bkg")',
  "fightReturned = 1",
  "end()",
].join("\n");

function authoredGame(enterProgram = ENTER_PROGRAM, startupProgram = "end()\n"): AuthoredGameFiles {
  const files: Files = new Map();
  const paths: string[] = ["main.gam", "Boards/start.brd", "Chrs/hero.tem", "Prg/start.prg", "Prg/enter.prg", "Media/board.mid", "Media/battle.mid", "Media/ready.wav"];
  const main = {
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    startupPrg: "start.prg",
    initBoard: "start.brd",
    initChar: "hero.tem",
    packagePlugins: ["stock_battle"],
  };
  files.set(assetKey("main.gam"), unwrap(writeMainFile(main)));
  files.set(assetKey("boards/start.brd"), authoredBoard());
  files.set(assetKey("chrs/hero.tem"), new Uint8Array([0]));
  files.set(assetKey("prg/start.prg"), encoder.encode(startupProgram));
  files.set(assetKey("prg/enter.prg"), encoder.encode(enterProgram));
  files.set(assetKey("media/board.mid"), midi());
  files.set(assetKey("media/battle.mid"), midi());
  files.set(assetKey("media/ready.wav"), wav());
  files.set(assetKey("enemy/slime.ene"), authoredEnemy());
  files.set(assetKey("bkrounds/night.bkg"), authoredBackground());
  return { files, paths };
}

type Played = {
  readonly cues: readonly AudioCue[];
  readonly hashes: readonly string[];
  readonly state: GameState;
  /** The tick at which each cue was reported, with the report's hash, for ordering checks. */
  readonly cueTicks: readonly number[];
};

/**
 * Host the game for `ticks` engine ticks, `CHUNK` ticks per `advance` call, answering every asset request.
 * `device` models a real runner: it answers each finished one-shot with the advisory `audio.ended` input. A null
 * runner records the same cues and never replies (docs/spec/engine/audio-media.md#audio-headless).
 */
function play(ticks: number, device: boolean): Played {
  const { files, paths } = authoredGame();
  let latest = null as GameState | null;
  let hasPlayer = false;
  let seeded = false;
  const engine: Engine = createEngine({
    seed: 23,
    assetIndex: createAssetIndex(paths),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "battle-cues-test",
    width: 320,
    height: 240,
    maxTicks: ticks + 600,
    packageCatalogue: stockBattleCatalogue(),
    startup: { presence: { hasPlayer: () => hasPlayer }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    effectAppliers: [{ section: "sprites", applier: (effect) => { if (effect.name === "createplayer") hasPlayer = true; } }],
    phaseRegistrations: [{
      phase: "events",
      run: (state) => {
        latest = state;
        if (seeded || state.engine.boot?.stage !== "running") return;
        seeded = true;
        const hero = addActor(state.actors, {
          kind: "party",
          source: "hero.tem",
          name: "Hero",
          stats: { hp: 20, maxHp: 20, smp: 4, maxSmp: 4, dp: 2, fp: 4, level: 1 },
        });
        registerActorObject(state.vm, state.events, state.actors, hero.id);
        state.party.members = [hero.id];
        state.party.selected = hero.id;
      },
    }],
  });
  const cues: AudioCue[] = [];
  const cueTicks: number[] = [];
  const hashes: string[] = [];
  const finishing = new Map<number, number[]>();
  let replies: InputRecord[] = [];
  let elapsed = 0;
  for (let guard = 0; guard < ticks * 40 && elapsed < ticks; guard += 1) {
    const due: number[] = [];
    if (device && latest !== null) {
      for (const [tick, ids] of finishing) {
        if (tick > latest.time.tick) continue;
        due.push(...ids);
        finishing.delete(tick);
      }
    }
    const inputs: InputRecord[] = [...replies, ...due.map((cueId): InputRecord => ({ tick: latest?.time.tick ?? 0, event: { kind: "audio.ended", cueId } }))];
    replies = [];
    const report = engine.advance(CHUNK, inputs);
    elapsed += report.ticksRun;
    for (const cue of report.audioCues) {
      cues.push(cue);
      cueTicks.push(report.tickAfter);
      if (device && cue.kind === "media.play" && cue.loop === false && cue.asset !== null) {
        const finished = cue.asset === "media/ready.wav" ? cue.tick + 30 : null;
        if (finished !== null) finishing.set(finished, [...(finishing.get(finished) ?? []), cue.cueId]);
      }
    }
    if (report.ticksRun > 0) hashes.push(report.stateHash);
    if (report.loading) {
      replies = report.requests.flatMap((request) => (request.kind === "asset"
        ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }]
        : []));
    }
  }
  if (latest === null) throw new Error("the engine never ran a tick");
  return { cues, hashes, state: latest, cueTicks };
}

/** Ticks per `advance` call; one state hash is taken per call. */
const CHUNK = 5;

const musicStarts = (cues: readonly AudioCue[]): string[] =>
  cues.filter((cue) => cue.kind === "media.play" && cue.track === "music").map((cue) => String(cue.asset));
type HostedEngine = { readonly engine: Engine; latest(): GameState | null };

function hostedEngine(game: AuthoredGameFiles): HostedEngine {
  let latest: GameState | null = null;
  let hasPlayer = false;
  let seeded = false;
  const engine = createEngine({
    seed: 23,
    assetIndex: createAssetIndex(game.paths),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "battle-cues-test",
    width: 320,
    height: 240,
    maxTicks: 1000,
    packageCatalogue: stockBattleCatalogue(),
    startup: { presence: { hasPlayer: () => hasPlayer }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    effectAppliers: [{ section: "sprites", applier: (effect) => { if (effect.name === "createplayer") hasPlayer = true; } }],
    phaseRegistrations: [{
      phase: "events",
      run: (state) => {
        latest = state;
        if (seeded || state.engine.boot?.stage !== "running") return;
        seeded = true;
        if (state.party.members.length > 0) return;
        const hero = addActor(state.actors, {
          kind: "party",
          source: "hero.tem",
          name: "Hero",
          stats: { hp: 20, maxHp: 20, smp: 4, maxSmp: 4, dp: 2, fp: 4, level: 1 },
        });
        registerActorObject(state.vm, state.events, state.actors, hero.id);
        state.party.members = [hero.id];
        state.party.selected = hero.id;
      },
    }],
  });
  return { engine, latest: () => latest };
}

const SAVE_ENTER_PROGRAM = [
  "stockBattle.turn = (party, index) => {",
  "  turns = turns + 1",
  "  if (saveBattle == 1) {",
  "    saveBattle = 0",
  '    Save("slot")',
  "  }",
  "  if (party == 1 && turns > 2) {",
  "    physical({ source: battle.fighter(1, index), target: battle.fighter(0, 0), amount: 99 })",
  "  }",
  "  return 0",
  "}",
  "turns = 0",
  "sleep(2)",
  'game.on("battleEnded", (event) => { endedOutcome = event.detail.outcome; endedAfterTurns = turns })',
  'game.on("boardReturned", (event) => { returnedBoard = event.detail["boardKey"] })',
  "saveBattle = 1",
  'FightEnemy("slime", "night.bkg")',
  "fightReturned = 1",
  "end()",
].join("\n");

test("a won fight returns the active board's music after the battle music, through the engine's own events", () => {
  const played = play(400, false);
  const globals = played.state.vm.globals;
  equal(globals.fightreturned, 1, "FightEnemy returned: the fight ran to its outcome");
  equal(globals.endedoutcome, 2, "battleEnded was announced with the won outcome");
  equal(globals.returnedboard, "boards/start.brd", "boardReturned named the active board");
  deepEqual(musicStarts(played.cues), ["media/board.mid", "media/battle.mid", "media/board.mid"], "board, battle, then the active board's own music again");
  const starts = played.cues.filter((cue) => cue.kind === "media.play" && cue.track === "music");
  ok(starts.every((cue) => cue.loop === true));
  ok(starts[1]!.tick < starts[2]!.tick, "the board request follows the battle music");
  equal(played.state.audio.tracks.find((track) => track.name === "music")?.file, "media/board.mid");
  const ready = played.cues.filter((cue) => cue.kind === "media.play" && cue.track === "ui" && cue.asset === "media/ready.wav");
  equal(ready.length, Number(globals.turns), "one readySound voice per full bar through the real engine");
  ok(ready.length >= 3);
  ok(!JSON.stringify(played.state.battle).match(/audio|music|media|\.mid|\.wav/i), "no audio in BattleState");
});

test("the null runner and a runner that answers audio.ended see equal cue streams and state hashes", () => {
  const nullRunner = play(400, false);
  const realRunner = play(400, true);
  ok(realRunner.cues.length > 4);
  deepEqual(realRunner.cues, nullRunner.cues, "equal cue streams");
  deepEqual(realRunner.hashes, nullRunner.hashes, "equal state hash after every tick");
  deepEqual(realRunner.cueTicks, nullRunner.cueTicks);
});

test("a full-engine save during battle resumes its parked thread and returns to board music after a real load", () => {
  const savingGame = authoredGame(SAVE_ENTER_PROGRAM);
  const saving = hostedEngine(savingGame);
  let replies: InputRecord[] = [];
  let savedBytes: Uint8Array | null = null;
  let savedPath = "";
  let savedArea = "";
  for (let guard = 0; guard < 10000 && savedBytes === null; guard += 1) {
    const report = saving.engine.advance(CHUNK, replies);
    replies = [];
    for (const request of report.requests) {
      if (request.kind === "saveBlob") {
        savedBytes = new Uint8Array(request.bytes);
        savedPath = request.blob.path;
        savedArea = request.blob.area;
      }
    }
    if (savedBytes !== null) break;
    if (report.loading) {
      replies = report.requests.flatMap((request): InputRecord[] => request.kind === "asset"
        ? [{ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: savingGame.files.get(request.key) ?? null } }]
        : []);
    }
  }
  ok(savedBytes !== null, "the real engine issued a saveBlob request during the fight");
  equal(savedArea, "saves");
  const expectedGameId = deriveGameId(savingGame.files.get(assetKey("main.gam")) ?? new Uint8Array(), "battle-cues-test");
  equal(savedPath, `${expectedGameId}/saved/slot.sav`, "the save area is keyed by the AD-17 GameId");
  const bytes = savedBytes as Uint8Array;
  const saved = JSON.parse(new TextDecoder().decode(bytes)) as {
    readonly battle: { readonly outcome: number | null } | null;
    readonly audio: { readonly tracks: readonly { readonly name: string; readonly file: string }[] };
    readonly vm: { readonly threads: readonly { readonly wait: { readonly kind: string; readonly reply: { readonly ok: boolean } | null } | null }[] };
  };
  ok(saved.battle !== null && saved.battle.outcome === null, "the canonical save includes the active battle");
  equal(saved.audio.tracks.find((track) => track.name === "music")?.file, "media/battle.mid", "the playback projection captures battle music");
  ok(saved.vm.threads.some((thread) => thread.wait?.kind === "blob" && thread.wait.reply?.ok === true), "the saved thread resumes after Save returns");

  const loadingGame = authoredGame(SAVE_ENTER_PROGRAM, 'Load("slot")\nend()\n');
  const loading = hostedEngine(loadingGame);
  const cues: AudioCue[] = [];
  let loadedPath = "";
  let loadedArea = "";
  for (let guard = 0; guard < 10000; guard += 1) {
    const report = loading.engine.advance(CHUNK, replies);
    replies = [];
    cues.push(...report.audioCues);
    if (report.loading) {
      replies = report.requests.flatMap((request): InputRecord[] => {
        if (request.kind === "asset") return [{ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: loadingGame.files.get(request.key) ?? null } }];
        if (request.kind === "loadBlob") {
          loadedPath = request.blob.path;
          loadedArea = request.blob.area;
          return [{ tick: report.tickAfter, event: { kind: "blob.loaded" as const, reqId: request.reqId, bytes: new Uint8Array(bytes) } }];
        }
        if (request.kind === "saveBlob") return [{ tick: report.tickAfter, event: { kind: "blob.saved", reqId: request.reqId, ok: true } }];
        return [];
      });
    }
    const state = loading.latest();
    if (state?.vm.globals.fightreturned === 1 && musicStarts(cues).at(-1) === "media/board.mid") break;
  }
  const resumed = loading.latest();
  ok(resumed !== null);
  equal(loadedArea, "saves");
  equal(loadedPath, savedPath);
  equal(resumed.vm.globals.fightreturned, 1, "FightEnemy returned after the loaded battle continued");
  equal(resumed.vm.globals.endedoutcome, 2, "the resumed battle reached its win outcome");
  const restartedBattleMusic = cues.find((cue) => cue.kind === "media.play" && cue.track === "music");
  equal(restartedBattleMusic?.positionTicks, 0, "music restarts at the beginning after load");
  equal(resumed.vm.globals.returnedboard, "boards/start.brd");
  deepEqual(musicStarts(cues), ["media/battle.mid", "media/board.mid"], "load restarts battle music and battle completion restores board music");
  equal(resumed.audio.tracks.find((track) => track.name === "music")?.file, "media/board.mid");
});

function authoredBmp(): Uint8Array {
  const bytes = new Uint8Array(62);
  bytes[0] = 0x42; bytes[1] = 0x4d;
  const put32 = (at: number, value: number): void => {
    bytes[at] = value & 255; bytes[at + 1] = (value >>> 8) & 255; bytes[at + 2] = (value >>> 16) & 255; bytes[at + 3] = (value >>> 24) & 255;
  };
  const put16 = (at: number, value: number): void => { bytes[at] = value & 255; bytes[at + 1] = (value >>> 8) & 255; };
  put32(2, 62); put32(10, 54); put32(14, 40); put32(18, 2); put32(22, 1); put16(26, 1); put16(28, 24); put32(34, 8);
  bytes.set([0, 0, 255, 0, 255, 0, 0, 0], 54);
  return bytes;
}

test("same-tick setimage before Save waits for the asset reply so the saved state includes the applied image", () => {
  const prg = [
    "createcanvas(4, 2, c)",
    'setimage("pixel.bmp", 0, 0, 2, 1, c)',
    'Save("slot")',
    "end()",
  ].join("\n");
  const game = authoredGame(prg);
  game.paths.push("Bitmap/pixel.bmp");
  game.files.set(assetKey("bitmap/pixel.bmp"), authoredBmp());
  const host = hostedEngine(game);
  let replies: InputRecord[] = [];
  let assetReq: { reqId: number } | undefined;
  let saveReq2: { kind: "saveBlob"; bytes: Uint8Array } | undefined;
  for (let guard = 0; guard < 20; guard += 1) {
    const report = host.engine.advance(1, replies);
    replies = [];
    const pixelReq = report.requests.find((r) => r.kind === "asset" && r.key === "bitmap/pixel.bmp");
    if (pixelReq) {
      assetReq = { reqId: pixelReq.reqId };
      const prematureSave = report.requests.find((r) => r.kind === "saveBlob");
      equal(prematureSave, undefined, "saveBlob is NOT emitted while asset is pending");
    }
    const saveReq = report.requests.find((r) => r.kind === "saveBlob");
    if (saveReq && saveReq.kind === "saveBlob") {
      saveReq2 = saveReq;
      break;
    }
    if (report.loading) {
      replies = report.requests.flatMap((r): InputRecord[] => r.kind === "asset"
        ? [{ tick: report.tickAfter, event: { kind: "asset", reqId: r.reqId, bytes: game.files.get(r.key) ?? null } }]
        : []);
    }
  }
  ok(assetReq, "pixel.bmp was requested");
  ok(saveReq2, "saveBlob IS emitted once asset reply settles");
  const savedBytes = saveReq2.bytes;

  // Inspect the captured save bytes: surfaces section must have the image applied!
  const loadingGame = authoredGame(prg, 'Load("slot")\nend()\n');
  loadingGame.paths.push("Bitmap/pixel.bmp");
  loadingGame.files.set(assetKey("bitmap/pixel.bmp"), authoredBmp());
  const loaded = hostedEngine(loadingGame);
  replies = [];
  for (let guard = 0; guard < 20; guard += 1) {
    const report = loaded.engine.advance(1, replies);
    replies = [];
    if (report.loading) {
      replies = report.requests.flatMap((request): InputRecord[] => {
        if (request.kind === "asset") return [{ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: loadingGame.files.get(request.key) ?? null } }];
        if (request.kind === "loadBlob") return [{ tick: report.tickAfter, event: { kind: "blob.loaded", reqId: request.reqId, bytes: new Uint8Array(savedBytes) } }];
        return [];
      });
    }
    const state = loaded.latest();
    if (state && state.surfaces.entries["1"]) break;
  }
  const finalState = loaded.latest();
  ok(finalState, "loaded state exists");
  const surfaceEntry = finalState.surfaces.entries["1"];
  ok(surfaceEntry, "canvas 1 surface exists in restored state");
  const surface = loaded.engine.surfacePixels(1 as never, surfaceEntry.rev);
  ok(surface !== null, "surface pixels exist");
  equal(surface.rgba[0], 255, "red channel is 255 from pixel.bmp");
});
