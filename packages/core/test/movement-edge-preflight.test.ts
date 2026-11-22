// R-66 linked-edge preflight and E-138 selected-player-only edge order
// (docs/spec/engine/movement-and-collision.md#r-66, #e-138; ADR 0040).
import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  assetKey,
  createEmptyBoard,
  createGameState,
  enqueueDirectionMove,
  enqueueMove,
  hydrateSprites,
  runMovementPhase,
  runRandomEncounterPhase,
  type EdgePreflightOutcome,
  type EdgePreflightRequest,
  type GameState,
  type MovementEvent,
  type SpritesSection,
  type WorldBoard,
  type WorldProgram,
} from "../src/index.ts";
import { runTriggersPhase } from "../src/triggers/runtime.ts";

type Links = { readonly north: string; readonly south: string; readonly east: string; readonly west: string };

function board(links: Partial<Links> = {}, vectors: WorldBoard["vectors"] = []): WorldBoard {
  const empty = createEmptyBoard();
  const { residue: _residue, ...plain } = empty;
  return ({
    ...plain,
    width: 320,
    height: 320,
    sizeL: 2,
    coordType: 0,
    links: { north: "", south: "", east: "", west: "", ...links },
    vectors,
    items: [],
  } as unknown) as WorldBoard;
}

function playerState(currentBoard: WorldBoard, options: { x?: number; y?: number; controlled?: boolean } = {}) {
  return hydrateSprites({
    board: currentBoard,
    players: [{
      id: "hero",
      kind: "player",
      source: "hero.tem",
      x: options.x ?? 304,
      y: options.y ?? 95,
      layer: 1,
      controlled: options.controlled ?? true,
    }],
  });
}

function recorder(outcomes: readonly EdgePreflightOutcome[] = ["accepted"]) {
  const requests: EdgePreflightRequest[] = [];
  let index = 0;
  return {
    requests,
    preflightEdge: (request: EdgePreflightRequest): EdgePreflightOutcome => {
      requests.push(request);
      const outcome = outcomes[Math.min(index, outcomes.length - 1)] ?? "accepted";
      index += 1;
      return outcome;
    },
  };
}

function run(sprites: SpritesSection, currentBoard: WorldBoard, ticks: number, preflightEdge?: (request: EdgePreflightRequest) => EdgePreflightOutcome, pixelMovement = 0): MovementEvent[] {
  const events: MovementEvent[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    events.push(...runMovementPhase(sprites, currentBoard, tick, { pixelMovement, ...(preflightEdge === undefined ? {} : { preflightEdge }) }));
  }
  return events;
}

test("R-66: a linked-edge step preflights at step start and requests the crossing without advancing", () => {
  const currentBoard = board({ east: "east.brd" });
  // x = 290: the whole 32 px target (322) is off the board, but the first few 4 px advances are still
  // inside. A preflight at step start therefore asks before x moves; a first-advance check would move.
  const sprites = playerState(currentBoard, { x: 290 });
  const { requests, preflightEdge } = recorder();
  enqueueDirectionMove(sprites, "hero", "E");
  const events = run(sprites, currentBoard, 1, preflightEdge);
  deepEqual(requests, [{ actorId: "hero", direction: "E", link: "east.brd" }]);
  equal(sprites.players[0]?.x, 290, "no advance on the source board");
  deepEqual(sprites.players[0]?.movement.pendingExit, "E");
  equal(sprites.players[0]?.movement.active, null);
  equal(events.some((record) => record.type === "step-complete"), false);
  equal(sprites.players[0]?.movement.lastStepTick, null, "a crossing is a placement, not a completed step");
});

test("R-66: a refused crossing ends the step blocked, uncounted, and keeps the rest of the queue", () => {
  const currentBoard = board({ east: "east.brd" });
  const sprites = playerState(currentBoard);
  const { preflightEdge } = recorder(["refused"]);
  enqueueDirectionMove(sprites, "hero", "E");
  enqueueDirectionMove(sprites, "hero", "N");
  const events = run(sprites, currentBoard, 1, preflightEdge);
  const hero = sprites.players[0];
  equal(hero?.x, 304);
  equal(hero?.y, 95);
  equal(hero?.movement.pendingExit, null);
  equal(hero?.movement.active, null);
  equal(hero?.movement.lastStepTick, null, "no end-of-step processing for a refusal");
  deepEqual(hero?.queue.moves.map((move) => move.source === "direction" ? move.direction : move.source), ["N"]);
  const blocked = events.filter((record) => record.type === "blocked");
  deepEqual(blocked.map((record) => [record.edge, record.partyDistance256, record.blocked]), [["E", undefined, true]]);
  equal(events.some((record) => record.type === "step-complete"), false);
  equal(events.some((record) => record.type === "movement-complete"), false, "the queue still has the north step");
});

test("R-66: the next step asks again; nothing remembers the refusal", () => {
  const currentBoard = board({ east: "east.brd" });
  const sprites = playerState(currentBoard);
  const { requests, preflightEdge } = recorder(["refused", "refused"]);
  enqueueDirectionMove(sprites, "hero", "E");
  run(sprites, currentBoard, 1, preflightEdge);
  enqueueDirectionMove(sprites, "hero", "E");
  run(sprites, currentBoard, 3, preflightEdge);
  deepEqual(requests.map((request) => request.direction), ["E", "E"]);
  equal(sprites.players[0]?.x, 304);
});

test("R-66: a destination still loading leaves the step unstarted and unchanged", () => {
  const currentBoard = board({ east: "east.brd" });
  const sprites = playerState(currentBoard);
  const { requests, preflightEdge } = recorder(["pending", "accepted"]);
  enqueueDirectionMove(sprites, "hero", "E");
  run(sprites, currentBoard, 1, preflightEdge);
  deepEqual(sprites.players[0]?.queue.moves.map((move) => move.source === "direction" ? move.direction : move.source), ["E"]);
  equal(sprites.players[0]?.x, 304);
  equal(sprites.players[0]?.movement.pendingExit, null);
  run(sprites, currentBoard, 2, preflightEdge);
  deepEqual(requests.map((request) => request.direction), ["E", "E", "E"]);
  deepEqual(sprites.players[0]?.movement.pendingExit, "E");
});

test("E-138/R-64: a no-link edge is a solid block at step start, counted once for a direction tile step", () => {
  const currentBoard = board();
  const sprites = playerState(currentBoard);
  const { requests, preflightEdge } = recorder();
  enqueueDirectionMove(sprites, "hero", "E");
  const events = run(sprites, currentBoard, 1, preflightEdge);
  deepEqual(requests, [], "no link means no board preflight");
  const blocked = events.filter((record) => record.type === "blocked");
  deepEqual(blocked.map((record) => [record.edge, record.vector, record.partyDistance256]), [["E", undefined, 32 * 256]]);
  equal(sprites.players[0]?.x, 304, "no partial move");
  deepEqual(sprites.players[0]?.movement.lastStepTarget, { x: 336, y: 95 });
  equal(sprites.players[0]?.movement.lastStepTick, 0);
});

test("E-138: only the selected player is tested against the board edge", () => {
  const currentBoard = board({ east: "east.brd" });
  const sprites = playerState(currentBoard, { controlled: false });
  const { requests, preflightEdge } = recorder();
  enqueueDirectionMove(sprites, "hero", "E");
  const events = run(sprites, currentBoard, 30, preflightEdge);
  deepEqual(requests, []);
  equal(sprites.players[0]?.movement.pendingExit, null);
  equal(events.some((record) => record.type === "edge-exit"), false);
  equal((sprites.players[0]?.x ?? 0) > 320, true, "a non-selected player is not limited by the edge");
});

test("E-138: the edge result is combined with the vector result; a link never clears a solid", () => {
  const wall = { handle: "wall", attributes: 0, closed: 1, layer: 1, type: 1, points: [{ x: 320, y: 60 }, { x: 340, y: 60 }, { x: 340, y: 140 }, { x: 320, y: 140 }] };
  const currentBoard = board({ east: "east.brd" }, [wall]);
  const sprites = playerState(currentBoard);
  const { requests, preflightEdge } = recorder(["accepted"]);
  enqueueDirectionMove(sprites, "hero", "E");
  const events = run(sprites, currentBoard, 1, preflightEdge);
  deepEqual(requests, [], "the vector check runs before the edge check");
  deepEqual(events.filter((record) => record.type === "blocked").map((record) => record.vector), ["wall"]);
  equal(sprites.players[0]?.movement.pendingExit, null);
  equal(sprites.players[0]?.x, 304);
});

test("R-66: point-style steps are preflighted too", () => {
  const currentBoard = board({ east: "east.brd" });
  const sprites = playerState(currentBoard, { x: 290 });
  const { requests, preflightEdge } = recorder(["refused"]);
  enqueueMove(sprites, "hero", { source: "points", target: { x: 322, y: 95 }, facing: "E", provenance: { kind: "script", thread: 0 } });
  run(sprites, currentBoard, 1, preflightEdge);
  deepEqual(requests, [{ actorId: "hero", direction: "E", link: "east.brd" }]);
  equal(sprites.players[0]?.x, 290, "the point-style step is refused at its start, not after advancing");
  deepEqual(sprites.players[0]?.queue.moves, []);
});

test("E-48: a program link is not preflighted and keeps the finished-step record and queue event", () => {
  const currentBoard = board({ east: "gate.prg" });
  const sprites = playerState(currentBoard);
  const { requests, preflightEdge } = recorder();
  enqueueDirectionMove(sprites, "hero", "E");
  const events = run(sprites, currentBoard, 30, preflightEdge);
  deepEqual(requests, []);
  deepEqual(events.filter((record) => record.type === "edge-exit").map((record) => record.direction), ["E"]);
  deepEqual(events.filter((record) => record.type === "movement-complete").map((record) => [record.tick, record.blocked]), [[0, true]]);
  equal(events.some((record) => record.type === "step-complete"), false);
  equal(sprites.players[0]?.movement.pendingExit, "E");
  equal(sprites.players[0]?.movement.lastStepTick, 0, "E-48 keeps the step record so step regions still run");
  equal(sprites.players[0]?.movement.lastStepBlocked, true);
});

test("R-66: a point-style step ignores source vectors but still preflights its linked edge at step start", () => {
  // E-22: a point step ignores board vectors, so the vector is not a reason to skip the edge check.
  // R-66 item 1/3: the refusal must leave the player at the step-start position with the queue kept.
  const wall = { handle: "edge-wall", attributes: 0, closed: 1, layer: 1, type: 1, points: [{ x: 320, y: 60 }, { x: 340, y: 60 }, { x: 340, y: 140 }, { x: 320, y: 140 }] };
  const currentBoard = board({ east: "east.brd" }, [wall]);
  const sprites = playerState(currentBoard, { x: 290 });
  const { requests, preflightEdge } = recorder(["refused"]);
  enqueueMove(sprites, "hero", { source: "points", target: { x: 322, y: 95 }, facing: "E", provenance: { kind: "script", thread: 0 } });
  enqueueDirectionMove(sprites, "hero", "N");
  const events = run(sprites, currentBoard, 1, preflightEdge);
  deepEqual(requests, [{ actorId: "hero", direction: "E", link: "east.brd" }]);
  equal(sprites.players[0]?.x, 290, "no advance before the refusal");
  deepEqual(sprites.players[0]?.queue.moves.map((move) => move.source === "direction" ? move.direction : move.source), ["N"], "the rest of the queue is kept");
  deepEqual(events.filter((record) => record.type === "blocked").map((record) => record.edge), ["E"]);
  equal(sprites.players[0]?.movement.lastStepTick, null);
});

test("E-138: a point-style step into a no-link edge is blocked at start and consumed (pre-existing step drop)", () => {
  // Pre-existing behaviour: a blocked point-style step is consumed and not counted (R-64 item 4 counts
  // only the selected player's direction-style tile steps). R-66/E-138 now decide it at step start
  // instead of after walking to the edge, so the player never advances.
  const currentBoard = board();
  const sprites = playerState(currentBoard, { x: 290 });
  enqueueMove(sprites, "hero", { source: "points", target: { x: 322, y: 95 }, facing: "E", provenance: { kind: "script", thread: 0 } });
  const events = run(sprites, currentBoard, 1);
  equal(sprites.players[0]?.x, 290, "the step never starts");
  deepEqual(sprites.players[0]?.queue.moves, [], "the blocked point step is consumed");
  deepEqual(events.filter((record) => record.type === "blocked").map((record) => [record.edge, record.partyDistance256]), [["E", undefined]]);
  equal(events.some((record) => record.type === "step-complete"), false);
  equal(sprites.players[0]?.movement.lastStepTick, 0, "the finished blocked step keeps its record, uncounted");
  equal(sprites.players[0]?.movement.lastStepBlocked, true);
});


/** A runtime board for the trigger and battle phases (a real key, tile grid and battle setting). */
function runtimeBoard(links: Partial<Links> = {}, programs: WorldProgram[] = []): WorldBoard {
  return ({
    ...board(links),
    key: assetKey("boards/test.brd"),
    sizeX: 10,
    sizeY: 10,
    programs,
    allowBattles: 1,
  } as unknown) as WorldBoard;
}

/** A step-on region over the attempted destination base (x 321..351, y 112..127) but not the standing one. */
const DESTINATION_REGION: WorldProgram = {
  program: "edge-door", graphic: "", initialVar: "", initialValue: "", finalVar: "", finalValue: "",
  activate: 0, activationType: 0, repeatDistance: 0, layer: 1,
  points: [{ x: 320, y: 100 }, { x: 384, y: 100 }, { x: 384, y: 140 }, { x: 320, y: 140 }],
  closed: 1, handle: "edge-door",
};
/** A step-on region over the player's own base at (304, 95): x 289..319, y 80..95. */
const STANDING_REGION: WorldProgram = {
  program: "standing", graphic: "", initialVar: "", initialValue: "", finalVar: "", finalValue: "",
  activate: 0, activationType: 0, repeatDistance: 0, layer: 1,
  points: [{ x: 280, y: 70 }, { x: 320, y: 70 }, { x: 320, y: 100 }, { x: 280, y: 100 }],
  closed: 1, handle: "standing",
};

const BATTLE = { fightingDisabled: 0, enemies: [], fightType: 0, chances: 1, useCustomFightPrg: 1, customFightPrg: "fight.prg" } as const;
const programRef = () => ({ kind: "inline" as const, text: "wait()\nend()", ir: "1", dialect: "tk3" as const });

function stateFor(sprites: SpritesSection, currentBoard: WorldBoard): GameState {
  const state = createGameState({ seed: 1 });
  state.world = { ...state.world, board: currentBoard };
  state.sprites = sprites;
  // A previous tile distinct from both the standing tile (9,3) and the attempted one (10,3), so the battle
  // phase would roll if it were not suppressed.
  state.sprites.randomEncounter = { boardKey: currentBoard.key, tile: { x: 8, y: 3 }, tiles: 0 };
  return state;
}

test("R-66/R-68: a no-link edge block under suppression is uncounted and runs no end-of-step processing", () => {
  const currentBoard = runtimeBoard({}, [DESTINATION_REGION]);
  // Suppressed: uncounted, the step record is written but the party remainder and step processing are not.
  const suppressed = playerState(currentBoard, { x: 304, y: 127 });
  enqueueDirectionMove(suppressed, "hero", "E");
  const suppressedEvents = runMovementPhase(suppressed, currentBoard, 0, { endOfStepProcessing: false });
  deepEqual(suppressedEvents.filter((record) => record.type === "blocked").map((record) => [record.edge, record.partyDistance256, record.blocked]), [["E", undefined, true]]);
  const hero = suppressed.players[0];
  equal(hero?.movement.lastStepTick, 0);
  equal(hero?.movement.lastStepTarget, null);
  equal(hero?.movement.lastStepBlocked, true);
  deepEqual(hero?.queue.moves, []);
  equal(hero?.state, "waiting");
  const state = stateFor(suppressed, currentBoard);
  const started: string[] = [];
  runTriggersPhase(state, { endOfStepSuppressed: true, programRef, onEvent: (event) => { if (event.type === "trigger-start") started.push(event.key); } });
  deepEqual(started, [], "no step-triggered program under suppression");
  const posted: string[] = [];
  runRandomEncounterPhase(state, BATTLE, (_section, effect) => posted.push(effect.name), true);
  deepEqual(posted, [], "no battle check under suppression");
  // Control: the same state with end-of-step processing on counts the tile and fires the destination region.
  const control = playerState(currentBoard, { x: 304, y: 127 });
  enqueueDirectionMove(control, "hero", "E");
  const controlEvents = runMovementPhase(control, currentBoard, 0, { endOfStepProcessing: true });
  deepEqual(controlEvents.filter((record) => record.type === "blocked").map((record) => [record.edge, record.partyDistance256]), [["E", 32 * 256]]);
  const controlState = stateFor(control, currentBoard);
  const fired: string[] = [];
  runTriggersPhase(controlState, { endOfStepSuppressed: false, programRef, onEvent: (event) => { if (event.type === "trigger-start") fired.push(event.key); } });
  deepEqual(fired, ["region:0"], "the attempted-tile region fires when the step is counted");
  const controlPosted: string[] = [];
  runRandomEncounterPhase(controlState, BATTLE, (_section, effect) => controlPosted.push(effect.name), false);
  deepEqual(controlPosted, ["battle.customFight"], "the control's battle check is live");
});

test("R-66/R-68: a linked refusal under suppression still preflights and keeps the rest of the queue", () => {
  const currentBoard = board({ east: "east.brd" });
  const sprites = playerState(currentBoard, { x: 304, y: 127 });
  const { requests, preflightEdge } = recorder(["refused"]);
  enqueueDirectionMove(sprites, "hero", "E");
  enqueueDirectionMove(sprites, "hero", "N");
  const events = runMovementPhase(sprites, currentBoard, 0, { endOfStepProcessing: false, preflightEdge });
  deepEqual(requests, [{ actorId: "hero", direction: "E", link: "east.brd" }], "the preflight still ran");
  const hero = sprites.players[0];
  deepEqual(events.filter((record) => record.type === "blocked").map((record) => [record.edge, record.partyDistance256]), [["E", undefined]]);
  equal(hero?.movement.lastStepTick, null, "a refusal is uncounted");
  equal(hero?.movement.lastStepTarget, null);
  deepEqual(hero?.queue.moves.map((move) => move.source === "direction" ? move.direction : move.source), ["N"], "the rest of the queue is kept");
  equal(hero?.movement.pendingExit, null);
});

test("E-48/R-68: a program-link exit under suppression keeps its finished-step record and runs no step processing", () => {
  const currentBoard = runtimeBoard({ east: "gate.prg" }, [STANDING_REGION]);
  const sprites = playerState(currentBoard, { x: 304, y: 95 });
  enqueueDirectionMove(sprites, "hero", "E");
  const events = runMovementPhase(sprites, currentBoard, 0, { endOfStepProcessing: false });
  deepEqual(events.filter((record) => record.type === "edge-exit").map((record) => [record.tick, record.direction]), [[0, "E"]]);
  deepEqual(events.filter((record) => record.type === "movement-complete").map((record) => [record.tick, record.blocked]), [[0, true]]);
  const hero = sprites.players[0];
  equal(hero?.movement.lastStepTick, 0, "E-48 still writes the finished-step record");
  equal(hero?.movement.lastStepBlocked, true);
  equal(hero?.movement.pendingExit, "E");
  deepEqual(hero?.queue.moves, []);
  const state = stateFor(sprites, currentBoard);
  const started: string[] = [];
  runTriggersPhase(state, { endOfStepSuppressed: true, programRef, onEvent: (event) => { if (event.type === "trigger-start") started.push(event.key); } });
  deepEqual(started, [], "no step trigger under suppression");
  deepEqual(state.triggers.repeat, {}, "no repeat accounting under suppression");
  const posted: string[] = [];
  runRandomEncounterPhase(state, BATTLE, (_section, effect) => posted.push(effect.name), true);
  deepEqual(posted, [], "no battle check under suppression");
});
