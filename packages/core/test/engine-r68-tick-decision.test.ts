// R-68 at the engine seam (docs/spec/engine/movement-and-collision.md#r-68, ADR 0041): the end-of-step
// decision is taken once per tick, at the movement phase, before runTriggersPhase starts any program. A
// counted blocked step whose destination region starts a blocking program must therefore still run its R-64
// destination battle check on that same tick. Driving the phase functions directly cannot prove this: the
// defect appears only when the engine has captured the decision and hands it to both later consumers.
// This file uses the real engine (scene mode, so no boot program can leave a blocking thread behind) with a
// real board, a real held key, a real step program started by the trigger phase, and the engine's own
// random-encounter evaluator registered where the engine's boot mode puts it — after the trigger phase.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  createAssetIndex,
  createEmptyBoard,
  createEngine,
  hydrateSprites,
  enqueueDirectionMove,
  movementPhaseRegistration,
  PACKAGE_ROOT,
  writeBoard,
  type Board,
  type Engine,
  type GameState,
  type InputRecord,
  type WorldBoard,
} from "../src/index.ts";
import { inputPhaseRegistration } from "../src/input/index.ts";
import { triggerPhaseRegistration } from "../src/triggers/runtime.ts";
import { randomEncounterPhaseRegistration } from "../src/sprites/encounters.ts";
import { pixelToTile, coordLayout } from "../src/world/coords.ts";

/** E-23's 32 px tile step and the party remainder's fixed-point scale. */
const TILE = 32;
const FP = 256;
const STEP_REMAINDER = TILE * FP;

const START = { x: 48, y: 63 };
/** The tile east of the hero: his collision base at x 80 spans 65..95. */
const EAST_TILE = [{ x: 64, y: 47 }, { x: 96, y: 47 }, { x: 96, y: 79 }, { x: 64, y: 79 }];
/** A solid wall between the hero and the east tile, so the pressed step is blocked before it advances (R-63). */
const WALL = [{ x: 76, y: 32 }, { x: 84, y: 32 }, { x: 84, y: 224 }, { x: 76, y: 224 }];

const BATTLE_CONFIG = { fightingDisabled: 0, enemies: [], fightType: 0, chances: 1, useCustomFightPrg: 0, customFightPrg: "" } as const;

/** A real board with the east-tile step region; `wall` selects the blocked-press variant. */
function authoredBoard(options: { readonly wall: boolean }): Uint8Array {
  const empty = createEmptyBoard();
  const region: Board["programs"][number] = {
    program: "region-0", graphic: "", initialVar: "", initialValue: "", finalVar: "", finalValue: "",
    activate: 0, activationType: 0, repeatDistance: 0, layer: 1, points: EAST_TILE, closed: 1, handle: "r0",
  };
  const board: Board = {
    ...empty,
    sizeX: 10,
    sizeY: 8,
    sizeL: 1,
    tileMatrix: Array.from({ length: 10 * 8 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 10 * 8, marker: true }],
    layerTitles: ["", ""],
    vectors: options.wall ? [{ points: WALL, attributes: 0, closed: 1, layer: 1, type: 1, handle: "wall" }] : [],
    programs: [region],
    properties: { ...empty.properties, allowBattles: 1, start: { x: START.x, y: START.y, layer: 1 } },
  };
  const encoded = writeBoard(board);
  if (!encoded.ok) throw new Error(encoded.error.message);
  return encoded.value;
}

type Rig = {
  readonly engine: Engine;
  readonly battleEffects: string[];
  readonly triggers: string[];
  /** The last state the engine finished a tick with (captured in the final phase). */
  state(): GameState;
  /** Advance exactly one tick, returning the tick it ran. */
  tick(inputs?: readonly InputRecord[]): number;
};

/**
 * The scene-mode engine with the movement owner, the input owner, the trigger owner and the battle test, in
 * the engine's own phase order. The step program is a real `wait()` that parks; whether it is live after the
 * trigger phase is exactly the question the tick's captured decision answers.
 */
function rig(options: { readonly wall: boolean; readonly park?: boolean; readonly withTrigger?: boolean }): Rig {
  let latest: GameState | null = null;
  let seeded = false;
  const battleEffects: string[] = [];
  const triggers: string[] = [];
  const bytes = authoredBoard(options);
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    ...(options.park === true ? { program: "wait()\nend()" } : {}),
    width: 320,
    height: 240,
    maxTicks: 60,
    input: { bindings: { keys: { ArrowRight: "right" } } },
    effectAppliers: [{ section: "battle", applier: (effect) => { battleEffects.push(effect.name); } }],
    phaseRegistrations: [
      {
        // Seed the controlled player and the battle tracker before the input phase reads them.
        phase: "input",
        rank: -10,
        run(state) {
          if (!seeded) {
            seeded = true;
            const board = state.world.board as WorldBoard;
            state.sprites = hydrateSprites({
              board,
              players: [{ id: "hero", kind: "player", source: "hero.tem", x: START.x, y: START.y, layer: 1, facing: "S", controlled: true }],
            });
            const tile = pixelToTile(coordLayout(board.coordType), board.sizeX, START.x, START.y);
            state.sprites.randomEncounter = { boardKey: board.key, tile, tiles: 0 };
            if (options.park === true) {
              // The scene program's `wait()` owns the key queue, so the step is queued from here: a step a
              // program drove, still advancing under the movement owner while the script is live.
              enqueueDirectionMove(state.sprites, "hero", "E", 0);
            }
          }
          latest = state;
        },
      },
      inputPhaseRegistration({ pixelMovement: 0 }),
      movementPhaseRegistration(),
      ...(options.withTrigger === false ? [] : [triggerPhaseRegistration({
        rank: 0,
        onEvent: (event) => { if (event.type === "trigger-start") triggers.push(event.key); },
        programRef: () => ({ kind: "inline" as const, text: "wait()\nend()", ir: "1", dialect: "tk3" as const }),
      })]),
      randomEncounterPhaseRegistration({ rank: 10, config: BATTLE_CONFIG }),
      { phase: "time", run: (state) => { latest = state; } },
    ],
  });
  // Load the authored board through the ordinary asset request/reply seam.
  const first = engine.advance(0, []);
  const request = first.requests[0];
  if (request?.kind !== "asset") throw new Error("expected the initial board request");
  const loaded = engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes } }]);
  if (loaded.loading) throw new Error("the authored board did not load");
  return {
    engine,
    battleEffects,
    triggers,
    state: () => {
      if (latest === null) throw new Error("no tick has run");
      return latest;
    },
    tick(inputs = []) {
      const tick = latest === null ? 0 : latest.time.tick + 1;
      const records = inputs.map((record) => ({ ...record, tick }));
      engine.advance(1, records);
      return tick;
    },
  };
}

const keyDown: InputRecord = { tick: 0, event: { kind: "key", name: "RIGHT", code: "ArrowRight", char: null, down: true } };

test("engine: a blocked step's own blocking program cannot suppress its destination battle check", () => {
  const run = rig({ wall: true });
  const tick = run.tick([keyDown]);
  const state = run.state();
  // The trigger phase started a real step program that has not finished, so it is a live blocking thread.
  ok(state.vm.threads.some((thread) => thread.kind === "blocking" && thread.status !== "finished"), "the step program is live after the trigger phase");
  equal(run.triggers.includes("region:0"), true, "the destination region started its step program");
  equal(state.sprites.players[0]?.x, START.x, "the pressed step never moved the player");
  equal(state.sprites.players[0]?.movement.lastStepBlocked, true, "the step is the counted blocked step");
  equal(state.sprites.players[0]?.movement.lastStepTick, tick, "it belongs to this tick");
  equal(state.party.steps * STEP_REMAINDER + state.party.stepRemainder, STEP_REMAINDER, "the counted blocked step contributed exactly one 8192 step");
  deepEqual(run.battleEffects, ["battle.noEnemies"], "the R-64 destination battle check ran on the same tick");
  // The tracker stands on the source tile, so a draw can only have come from the attempted destination.
  const source = pixelToTile(coordLayout(state.world.board!.coordType), state.world.board!.sizeX, START.x, START.y);
  deepEqual(state.sprites.randomEncounter?.tile, source);
  const afterRoll = { ...state.rng };
  run.tick();
  deepEqual(run.state().rng, afterRoll, "the following tick does not re-roll the source tile");
  deepEqual(run.battleEffects, ["battle.noEnemies"], "no deferred draw");
});

test("engine: a step a live program drove is recorded, so no deferred roll happens on the tick it ends", () => {
  const run = rig({ wall: false, park: true, withTrigger: false });
  run.tick([keyDown]);
  let completionTick = -1;
  for (let guard = 0; guard < 40 && completionTick < 0; guard += 1) {
    const tick = run.tick();
    if (run.state().sprites.players[0]?.x === START.x + TILE) completionTick = tick;
  }
  ok(completionTick >= 0, "the script-owned step completed");
  const state = run.state();
  deepEqual(run.battleEffects, [], "the battle check is suppressed while the program is live");
  const reached = pixelToTile(coordLayout(state.world.board!.coordType), state.world.board!.sizeX, state.sprites.players[0]!.x, START.y);
  deepEqual(state.sprites.randomEncounter?.tile, reached, "the tile the program walked onto is recorded, not rolled for");
  const afterStep = { ...state.rng };
  // The program ends; the next tick must not roll for the tile it already recorded.
  state.vm = { ...state.vm, threads: state.vm.threads.map((thread) => ({ ...thread, status: "finished" as const, wait: null })) };
  run.tick();
  deepEqual(run.state().rng, afterStep, "no deferred roll on the tick the program ends");
  deepEqual(run.battleEffects, [], "no battle test for a tile reached while a script owned the player");
});
