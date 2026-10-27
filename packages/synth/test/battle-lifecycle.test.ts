// #691: paired null and real PCM-rendering runners for battle combat cues and music.
// Proves that when a real audio runner decodes authored WAV assets and renders PCM samples into a buffer
// (and feeds advisory `audio.ended` replies back to the engine), the core cue stream and per-tick state hashes
// remain bit-for-bit identical to those produced by a null audio runner rendering pure silence.
import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addActor,
  assetKey,
  BATTLE_BACKGROUND_MAGIC,
  COMPILER_VERSION,
  createAssetIndex,
  createEmptyBoard,
  createEmptyMainFile,
  createEngine,
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
} from "@tk-reawakened/core";
import { VoiceMachine, createNullAudioRegistry, createAudioSourceRegistry, createPcmSource } from "../src/index.ts";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDirectory, "..", "..", "..");
const wavBytes = readFileSync(join(testDirectory, "../../core/test/fixtures/audio/files/pcm8-mono-8000.wav"));

type Files = Map<string, Uint8Array>;

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
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
    music: "battle.wav",
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
    properties: { ...empty.properties, backgroundMusic: "board.wav", enterPrg: "enter.prg", start: { x: 64, y: 64, layer: 1 } },
  }));
}

function stockBattleCatalogue(): readonly PackageCatalogueEntry[] {
  const folder = join(repoRoot, "stock", "stock_battle");
  const manifest = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8")) as {
    name: string;
    version: string;
    namespace: string;
    requests: PackageCatalogueEntry["requests"];
    program: string;
  };
  return [{
    name: manifest.name,
    version: manifest.version,
    namespace: manifest.namespace,
    requests: manifest.requests,
    definition: { id: manifest.name, version: manifest.version, commands: [] },
    startup: { kind: "inline", text: readFileSync(join(folder, manifest.program), "utf8"), compiler: COMPILER_VERSION, dialect: "tk3" },
  }];
}

const ENTER_PROGRAM = [
  "stockBattle.turn = (party, index) => {",
  "  turns = turns + 1",
  "  return 0",
  "}",
  "turns = 0",
  "sleep(2)",
  'FightEnemy("slime", "night.bkg")',
  "fightReturned = 1",
  "end()",
].join("\n");

function authoredGame(): { readonly files: Files; readonly paths: string[] } {
  const files: Files = new Map();
  const paths: string[] = [
    "main.gam",
    "Boards/start.brd",
    "Chrs/hero.tem",
    "Prg/start.prg",
    "Prg/enter.prg",
    "Media/board.wav",
    "Media/battle.wav",
    "Media/ready.wav",
    "Enemy/slime.ene",
    "Bkrounds/night.bkg",
  ];
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
  files.set(assetKey("prg/start.prg"), new Uint8Array(Array.from("end()\n", (c) => c.charCodeAt(0))));
  files.set(assetKey("prg/enter.prg"), new Uint8Array(Array.from(ENTER_PROGRAM, (c) => c.charCodeAt(0))));
  files.set(assetKey("media/board.wav"), wavBytes);
  files.set(assetKey("media/battle.wav"), wavBytes);
  files.set(assetKey("media/ready.wav"), wavBytes);
  files.set(assetKey("enemy/slime.ene"), authoredEnemy());
  files.set(assetKey("bkrounds/night.bkg"), authoredBackground());
  return { files, paths };
}

const CHUNK = 5;

test("null and real PCM-rendering runners produce identical battle cue streams and per-tick state hashes", () => {
  function run(real: boolean) {
    const { files, paths } = authoredGame();
    let latest = null as GameState | null;
    let hasPlayer = false;
    let seeded = false;
    const engine: Engine = createEngine({
      seed: 31,
      assetIndex: createAssetIndex(paths),
      assetRoot: PACKAGE_ROOT,
      mainFile: "main.gam",
      gameIdentity: "synth-battle-lifecycle",
      width: 320,
      height: 240,
      maxTicks: 300,
      packageCatalogue: stockBattleCatalogue(),
      startup: {
        presence: { hasPlayer: () => hasPlayer },
        savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
      },
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
    const machine = new VoiceMachine(real ? createAudioSourceRegistry([createPcmSource()]) : createNullAudioRegistry(), { outputRateHz: 6000 });
    const slots = new Map<string, number>();
    const left = new Float32Array(100);
    const right = new Float32Array(100);
    const hashes: string[] = [];
    const cues: AudioCue[] = [];
    let inputs: InputRecord[] = [];
    let peak = 0;
    let elapsed = 0;
    for (let guard = 0; guard < 200 && elapsed < 180; guard += 1) {
      const report = engine.advance(CHUNK, inputs);
      elapsed += report.ticksRun;
      inputs = report.requests.flatMap((request) => request.kind === "asset"
        ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }] : []);
      for (const cue of report.audioCues) {
        cues.push(cue);
        const slot = `${cue.track}:${cue.voice}`;
        if (cue.kind === "media.play") {
          ok(cue.asset !== null && cue.track !== null);
          const loaded = machine.handle({ kind: "load", voice: cue.cueId, track: cue.track, asset: cue.asset, data: files.get(cue.asset)! });
          if (real) equal(loaded[0]?.kind, "ready", "real runner genuinely decodes authored audio asset");
          deepEqual(machine.handle({ kind: "play", voice: cue.cueId, cue: cue.cueId, loop: cue.loop!, volume: cue.volume!, positionTicks: cue.positionTicks! }), []);
          slots.set(slot, cue.cueId);
        } else if (cue.kind === "media.stop") {
          const voice = slots.get(slot);
          if (voice !== undefined) deepEqual(machine.handle({ kind: "stop", voice }), []);
        }
      }
      if (report.ticksRun > 0) hashes.push(report.stateHash);
      for (const event of machine.render(left, right, 100)) {
        if (event.kind === "ended") {
          inputs.push({ tick: report.tickAfter, event: { kind: "audio.ended", cueId: event.cue } });
        }
      }
      for (const sample of left) peak = Math.max(peak, Math.abs(sample));
    }
    const turns = Number(latest?.vm.globals.turns ?? 0);
    return { cues, hashes, peak, turns };
  }
  const silent = run(false);
  const pcm = run(true);
  equal(silent.peak, 0, "null runner renders pure silence");
  ok(pcm.peak > 0, "real runner renders non-silent audio samples from decoded battle audio");
  ok(silent.turns >= 2, "the fight executed turns");
  equal(pcm.turns, silent.turns, "both runners advance the battle to identical turns");
  ok(silent.cues.some((cue) => cue.track === "music" && cue.kind === "media.play"), "battle music was queued");
  ok(silent.cues.some((cue) => cue.track === "ui" && cue.kind === "media.play"), "readySound was queued");
  deepEqual(pcm.cues, silent.cues, "null and real runners receive identical audio cues");
  deepEqual(pcm.hashes, silent.hashes, "null and real runners produce identical state hashes on every tick");
});
