// Shared test-only full-engine harness for stock battle cue acceptance.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder, TextEncoder } from "node:util";
import {
  addActor,
  assetKey,
  BATTLE_BACKGROUND_MAGIC,
  IR_VERSION,
  createAssetIndex,
  createEmptyBoard,
  createEmptyCharacter,
  createEmptyMainFile,
  createEngine,
  deriveGameId,
  enqueueDirectionMove,
  hashGameState,
  hydrateSprites,
  movementPhaseRegistration,
  nextUint32,
  PACKAGE_ROOT,
  registerActorObject,
  writeBattleBackground,
  writeBoard,
  writeCharacter,
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
export type AuthoredGameFiles = { readonly files: Map<string, Uint8Array>; readonly paths: string[] };

export function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
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

function authoredBoard(music = "board.mid", enterPrg = "enter.prg"): Uint8Array {
  const empty = createEmptyBoard();
  return unwrap(writeBoard({
    ...empty,
    sizeX: 40,
    sizeY: 30,
    sizeL: 1,
    tileMatrix: Array.from({ length: 40 * 30 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 40 * 30, marker: true }],
    layerTitles: ["", ""],
    properties: { ...empty.properties, backgroundMusic: music, enterPrg, start: { x: 64, y: 64, layer: 1 } },
  }));
}

/** The stock package exactly as the game's package list names it: the real manifest and the real program. */
export function stockBattleCatalogue(): readonly PackageCatalogueEntry[] {
  const folder = join(repoRoot, "stock", "stock_battle");
  const manifest = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8")) as { name: string; version: string; namespace: string; requests: PackageCatalogueEntry["requests"]; program: string };
  return [{
    name: manifest.name,
    version: manifest.version,
    namespace: manifest.namespace,
    requests: manifest.requests,
    definition: { id: manifest.name, version: manifest.version, commands: [] },
    startup: { kind: "inline", text: readFileSync(join(folder, manifest.program), "utf8"), ir: IR_VERSION, dialect: "tk3" },
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

export function authoredGame(
  enterProgram = ENTER_PROGRAM,
  startupProgram = "end()\n",
  battleBackground?: Uint8Array,
  editorMusic?: Uint8Array,
): AuthoredGameFiles {
  const files: Files = new Map();
  const paths: string[] = ["main.gam", "Boards/start.brd", "Boards/other.brd", "Chrs/hero.tem", "Prg/start.prg", "Prg/enter.prg", "Prg/other.prg", "Media/board.mid", "Media/other.mid", "Media/battle.mid", "Media/ready.wav", "Media/editor-proof-theme.mid"];
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
  files.set(assetKey("boards/other.brd"), authoredBoard("other.mid", "other.prg"));
  files.set(assetKey("chrs/hero.tem"), unwrap(writeCharacter({ ...createEmptyCharacter(), minor: 5, name: "Hero", movementAnimations: Array(8).fill(""), battleStances: ["", "", "", "", "", ""] })));
  files.set(assetKey("prg/start.prg"), encoder.encode(startupProgram));
  // Restore battle music after B's normal entry cue, so the later return must start B's track again.
  files.set(assetKey("prg/other.prg"), encoder.encode('mediaPlay("battle.mid", { track: "music", loop: 1 })\nend()'));
  files.set(assetKey("prg/enter.prg"), encoder.encode(enterProgram));
  files.set(assetKey("media/board.mid"), midi());
  files.set(assetKey("media/other.mid"), midi());
  files.set(assetKey("media/battle.mid"), midi());
  files.set(assetKey("media/ready.wav"), wav());
  files.set(assetKey("enemy/slime.ene"), authoredEnemy());
  files.set(assetKey("bkrounds/night.bkg"), battleBackground ?? authoredBackground());
  files.set(assetKey("media/editor-proof-theme.mid"), editorMusic ?? midi());
  return { files, paths };
}

type Played = {
  readonly cues: readonly AudioCue[];
  readonly hashes: readonly string[];
  readonly state: GameState;
  /** The tick at which each cue was reported, with the report's hash, for ordering checks. */
  readonly cueTicks: readonly number[];
  /** Every script `media.voice` object the audio phase saw, with the tick it appeared and the tick it was bound. */
  readonly voices: readonly ObservedVoice[];
};

/**
 * One `media.voice` object as the audio phase of a tick saw it (MEDIA-1): `firstTick` is the tick it first
 * appeared in, and `boundTick` the first tick it carried a track, a slot and a cue id together.
 */
type ObservedVoice = {
  readonly handle: number;
  readonly firstTick: number;
  readonly track: string | null;
  readonly slot: number | null;
  readonly cueId: number | null;
  readonly boundTick: number | null;
};

/** The members of a `media.voice` record, read the way MEDIA-1 defines them. */
function voiceObservation(record: { readonly handle: number; readonly members: { readonly [name: string]: unknown } }, tick: number, firstTick: number): ObservedVoice {
  const track = typeof record.members["track"] === "string" ? record.members["track"] : null;
  const slot = typeof record.members["slot"] === "number" && Number.isInteger(record.members["slot"]) ? record.members["slot"] : null;
  const cueId = typeof record.members["cueId"] === "number" && Number.isInteger(record.members["cueId"]) ? record.members["cueId"] : null;
  const bound = track !== null && slot !== null && cueId !== null;
  return { handle: record.handle, firstTick, track, slot, cueId, boundTick: bound ? tick : null };
}

/**
 * Host the game for `ticks` engine ticks, `CHUNK` ticks per `advance` call, answering every asset request.
 * `device` models a real runner: it answers each finished one-shot with the advisory `audio.ended` input. A null
 * runner records the same cues and never replies (docs/spec/engine/audio-media.md#audio-headless).
 */
export function play(
  ticks: number,
  device: boolean,
  switchBoard = false,
  cancelBoard = false,
  battleBackground?: Uint8Array,
  editorMusic?: Uint8Array,
  musicCueCount = switchBoard ? 5 : 3,
): Played {
  const listener = 'canceledEntry = 0\nmedia.on("beforePlay", (event) => { if (event.detail.source == "board" && canceledEntry == 0) { canceledEntry = 1; event.cancel() } })\n';
  const { files, paths } = authoredGame(cancelBoard ? listener + ENTER_PROGRAM : ENTER_PROGRAM, "end()\n", battleBackground, editorMusic);
  let latest = null as GameState | null;
  let seeded = false;
  let switched = false;
  let observedOutcome = false;
  // The audio phase runs after the applier binds a start and before the end-of-tick pass, so a voice object
  // that only a held effect keeps alive is visible here and nowhere later.
  const observedVoices = new Map<number, ObservedVoice>();
  const observeVoices = (state: GameState): void => {
    const tick = state.time.tick;
    for (let index = 0; index < state.vm.objects.length; index += 1) {
      const record = state.vm.objects[index];
      if (record === undefined || record.hostType !== "media.voice") continue;
      const previous = observedVoices.get(record.handle);
      if (previous === undefined) {
        observedVoices.set(record.handle, voiceObservation(record, tick, tick));
        continue;
      }
      if (previous.boundTick !== null) continue;
      const current = voiceObservation(record, tick, previous.firstTick);
      if (current.boundTick !== null) observedVoices.set(record.handle, current);
    }
  };
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
    // The authored main.gam has initChar; avoid an effect applier so surfaces remain batchable.
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    phaseRegistrations: [{
      phase: "events",
      run: (state) => {
        latest = state;
        if (switchBoard && !switched && state.battle !== null && state.battle.outcome === null && state.world.board) {
          equal(state.battle.boardKey, "boards/start.brd");
          equal(state.world.board.key, "boards/start.brd");
          // Schedule the engine's normal send transition, including hydration of the authored board B.
          state.engine.transition = { board: "other.brd", x: 2, y: 2, layer: 1 };
          equal(state.battle.boardKey, "boards/start.brd");
          switched = true;
        }
        if (switchBoard && state.battle !== null && state.battle.outcome !== null) {
          equal(state.battle.boardKey, "boards/start.brd", "the battle retains board A through its outcome");
          equal(state.world.board?.key, "boards/other.brd");
          observedOutcome = true;
        }
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
    }, {
      phase: "audio",
      run: (state) => { observeVoices(state); },
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
    if (musicStarts(cues).length >= musicCueCount) break;
  }
  if (latest === null) throw new Error("the engine never ran a tick");
  if (switchBoard) ok(observedOutcome, "board B is active while the won battle still names board A");
  return { cues, hashes, state: latest, cueTicks, voices: [...observedVoices.values()] };
}

/** Ticks per `advance` call; one state hash is taken per call. */
export const CHUNK = 5;

export const musicStarts = (cues: readonly AudioCue[]): string[] =>
  cues.filter((cue) => cue.kind === "media.play" && cue.track === "music").map((cue) => String(cue.asset));
