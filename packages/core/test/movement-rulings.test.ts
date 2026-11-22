// Owner rulings R-63, R-64 and R-65 (docs/spec/engine/movement-and-collision.md#r-63 to #r-65;
// ADR 0040). These are the contract tests for #1281's first slice: a tile direction step prechecks its
// whole destination, a blocked player step is consumed and counted, other actors retry, and queued
// directions are relative intent while point targets stay absolute.
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import {
  actorFromSource,
  advanceScriptTick,
  createEmptyBoard,
  createGameState,
  createScriptServices,
  drainDiagnostics,
  enqueueDirectionMove,
  hydrateSprites,
  IR_VERSION,
  movementPhaseRegistration,
  restoreGameState,
  runMovementPhase,
  runTriggersPhase,
  ScriptError,
  snapshot,
  startProgram,
  startThread,
  type Arg,
  type GameState,
  type MovementEvent,
  type WorldBoard,
  type WorldProgram,
} from "../src/index.ts";
import { runRandomEncounterPhase } from "../src/sprites/encounters.ts";
import { applySpriteEffect, MOVEMENT_PLUGIN } from "../src/script/packs/movement.ts";
import { enqueueMove } from "../src/sprites/runtime.ts";
import { pixelToTile, coordLayout } from "../src/world/coords.ts";

const HERO = { id: "hero", kind: "player" as const, source: "hero.tem", x: 48, y: 63, layer: 1, controlled: true };
const TILE = 32;

function board(vectors: WorldBoard["vectors"] = [], programs: WorldProgram[] = []): WorldBoard {
  const empty = createEmptyBoard();
  const { residue: _residue, ...plain } = empty;
  return ({
    ...plain,
    key: "test.brd",
    width: 320,
    height: 320,
    sizeX: 10,
    sizeY: 10,
    coordType: 0,
    vectors,
    programs,
    items: [],
  } as unknown) as WorldBoard;
}

function wall(left: number, right: number, handle = "wall"): NonNullable<WorldBoard["vectors"]>[number] {
  return { handle, attributes: 0, closed: 1, layer: 1, type: 1, points: [{ x: left, y: 32 }, { x: right, y: 32 }, { x: right, y: 224 }, { x: left, y: 224 }] };
}

function sprites(currentBoard: WorldBoard) {
  return hydrateSprites({ board: currentBoard, players: [HERO] });
}

function stateWith(currentBoard: WorldBoard, players = sprites(currentBoard).players): GameState {
  const state = createGameState({ seed: 7 });
  state.world = { ...state.world, board: currentBoard };
  state.sprites = { ...sprites(currentBoard), players };
  return state;
}

function region(points: WorldProgram["points"], activationType = 0): WorldProgram {
  return { program: "region-0", graphic: "", initialVar: "", initialValue: "", finalVar: "", finalValue: "", activate: 0, activationType, repeatDistance: 0, layer: 1, points, closed: 1, handle: "r0" };
}

const programRef = (name: string) => ({ kind: "inline" as const, text: `mark("${name}")\nend()`, ir: IR_VERSION, dialect: "tk3" as const });

// R-63 ---------------------------------------------------------------

test("R-63 prechecks the whole destination before the first advance", () => {
  const currentBoard = board([wall(76, 84)]);
  const current = sprites(currentBoard);
  enqueueDirectionMove(current, "hero", "E", 0);
  const events = runMovementPhase(current, currentBoard, 0);
  equal(current.players[0]?.x, 48, "a blocked destination never advances, not even by 4 px");
  equal(current.players[0]?.movement.active, null);
  equal(events.some((record) => record.type === "blocked" && record.vector === "wall"), true);
  equal(events.some((record) => record.type === "step-complete"), false, "no successful-step event");
});

test("R-63 ends an active tile step at the last safe position when a solid appears", () => {
  const clearBoard = board();
  const current = sprites(clearBoard);
  enqueueDirectionMove(current, "hero", "E", 0);
  runMovementPhase(current, clearBoard, 0);
  equal(current.players[0]?.x, 52, "the first advance is safe");
  const blockedBoard = board([wall(70, 74)]);
  const events: MovementEvent[] = [];
  for (let tick = 1; tick <= 5; tick += 1) events.push(...runMovementPhase(current, blockedBoard, tick));
  equal(current.players[0]?.x, 52, "the step stops at the last safe position");
  equal(events.some((record) => record.type === "step-complete"), false);
  equal(events.some((record) => record.type === "blocked"), true);
});

// R-64 ---------------------------------------------------------------

test("R-64 consumes and counts a blocked player direction step and fires its destination trigger", () => {
  const destination = { x: 64, y: 47 };
  const currentBoard = board([wall(76, 84)], [region([{ x: destination.x, y: destination.y }, { x: destination.x + TILE, y: destination.y }, { x: destination.x + TILE, y: destination.y + TILE }, { x: destination.x, y: destination.y + TILE }])]);
  const current = stateWith(currentBoard);
  enqueueDirectionMove(current.sprites, "hero", "E", 0);
  const events: MovementEvent[] = [];
  movementPhaseRegistration({ onEvent: (record) => events.push(record) }).run(current);
  equal(current.sprites.players[0]?.x, 48);
  equal(current.sprites.players[0]?.queue.moves.length, 0, "the blocked entry is consumed");
  equal(current.party.steps, 1, "a blocked player tile step counts one tile");
  equal(current.party.stepRemainder, 0);
  equal(events.some((record) => record.type === "step-complete"), false, "a blocked step never emits step-complete");
  equal(events.some((record) => record.type === "blocked" && record.partyDistance256 === TILE * 256), true);
  const triggers = runTriggersPhase(current, { programRef });
  equal(triggers.some((record) => record.type === "trigger-start" && record.key === "region:0"), true, "the region on the tile the player pressed into fires");
});

test("R-64 makes a blocked non-player retry the same entry with its queue waiting", () => {
  const currentBoard = board([wall(76, 84)]);
  const base = sprites(currentBoard);
  const npc = actorFromSource({ id: "npc", kind: "item", source: "npc.itm", x: 48, y: 63, layer: 1 }, currentBoard, 0, 0);
  const current = { ...base, items: [{ ...npc, queue: { moves: [{ source: "direction" as const, direction: "E" as const, distance: TILE }], waypoint: null } }] };
  const events: MovementEvent[] = [];
  for (let tick = 0; tick < 6; tick += 1) events.push(...runMovementPhase(current, currentBoard, tick));
  equal(current.items[0]?.x, 48, "the blocked item does not move");
  const pending = current.items[0]?.movement.active ?? current.items[0]?.queue.moves[0];
  equal(pending?.source, "direction", "the blocked entry is neither consumed nor dropped");
  equal(events.some((record) => record.type === "movement-complete"), false, "a retrying queue has not drained");
});

test("R-64 suppresses blocked-step processing while a program owns input", () => {
  const currentBoard = board([wall(76, 84)]);
  const current = stateWith(currentBoard);
  startThread(current.vm, { ref: programRef("driver"), kind: "blocking", owner: "script" });
  enqueueDirectionMove(current.sprites, "hero", "E", 0);
  enqueueDirectionMove(current.sprites, "hero", "N", 0);
  movementPhaseRegistration().run(current);
  equal(current.sprites.players[0]?.queue.moves.length, 1, "the blocked entry is still consumed");
  equal(current.party.steps, 0, "end-of-step processing is suppressed");
  equal(current.party.stepRemainder, 0);
  equal(current.sprites.players[0]?.movement.lastStepTarget, null, "no destination processing is recorded");
  // R-64 item 1 applies to an uncounted block too: the script-owned east block still leaves the queued north
  // entry to start on the following update, not one advance cadence later.
  current.time = { ...current.time, tick: current.time.tick + 1 };
  movementPhaseRegistration().run(current);
  equal(current.sprites.players[0]?.y, 63 - TILE / 8, "north advances one 4 px step on the update after the block");
});

test("R-64 keeps a key activation on the player's own shape when the blocked step is processed at its destination", () => {
  const destination = { x: 64, y: 47 };
  const keyRegion = region([{ x: destination.x, y: destination.y }, { x: destination.x + TILE, y: destination.y }, { x: destination.x + TILE, y: destination.y + TILE }, { x: destination.x, y: destination.y + TILE }], 1);
  const current = stateWith(board([wall(76, 84)], [keyRegion]));
  enqueueDirectionMove(current.sprites, "hero", "E", 0);
  movementPhaseRegistration().run(current);
  equal(current.sprites.players[0]?.x, 48, "the blocked east step never moves the player");
  equal(current.sprites.players[0]?.movement.lastStepBlocked, true, "the step is the counted blocked step");
  equal(current.party.steps, 1, "the blocked step counts one tile");
  // E-41: the key region fires only while the player is inside it. The player stands at (48, 63), whose
  // collision base spans x 33..63; the region starts at x 64, so only the destination shape could reach it.
  current.input.keys.push({ seq: 1, name: "ENTER", code: "Enter", char: "\n", action: null, resolvedActions: [] });
  const events = runTriggersPhase(current, { programRef });
  equal(current.triggers.active, null, "the key region on the tile the player pressed into does not fire");
  equal(events.some((record) => record.type === "trigger-start" && record.key === "region:0"), false);
});

test("R-64 runs the battle check at the blocked step's destination", () => {
  const battleBoard = { ...board([wall(76, 84)]), allowBattles: 1 } as WorldBoard;
  const current = stateWith(battleBoard);
  const sourceTile = pixelToTile(coordLayout(battleBoard.coordType), battleBoard.sizeX, 48, 63);
  current.sprites.randomEncounter = { boardKey: battleBoard.key, tile: sourceTile, tiles: 0 };
  enqueueDirectionMove(current.sprites, "hero", "E", 0);
  movementPhaseRegistration().run(current);
  const posts: string[] = [];
  runRandomEncounterPhase(current, { fightingDisabled: 0, enemies: [], fightType: 0, chances: 1, useCustomFightPrg: 0, customFightPrg: "" }, (_section, effect) => posts.push(effect.name));
  equal(posts.length > 0, true, "the encounter check observes the intended destination tile");
  deepEqual(current.sprites.randomEncounter?.tile, sourceTile, "progress keeps the actor's real tile");
  const rolls = posts.length;
  current.time = { ...current.time, tick: current.time.tick + 1 };
  runRandomEncounterPhase(current, { fightingDisabled: 0, enemies: [], fightType: 0, chances: 1, useCustomFightPrg: 0, customFightPrg: "" }, (_section, effect) => posts.push(effect.name));
  equal(posts.length, rolls, "the following tick does not re-check the source tile");
});

test("R-64 continues the queue one update after a mid-step block, not one cadence later", () => {
  // A mid-step block (R-63 item 2) stops a step already under way, so it is not the counted step: the
  // party remainder stays put. R-64 item 1 still consumes the entry and continues with the next queued
  // entry "on the following update", which is one tick after the block — not one advance cadence.
  const currentBoard = board();
  const current = stateWith(currentBoard);
  const cart = { ...actorFromSource({ id: "cart", kind: "item", source: "cart.itm", x: 96, y: 79, layer: 1 }, currentBoard, 0, 0), speed: 0.02 };
  current.sprites = { ...current.sprites, items: [cart] };
  enqueueDirectionMove(current.sprites, "hero", "E", 0);
  enqueueDirectionMove(current.sprites, "hero", "N", 0);
  enqueueDirectionMove(current.sprites, "cart", "N", 0);
  const events: MovementEvent[] = [];
  const heroYs: number[] = [];
  for (let tick = 0; tick <= 8; tick += 1) {
    events.push(...runMovementPhase(current.sprites, currentBoard, tick));
    heroYs.push(current.sprites.players[0]?.y ?? 0);
  }
  equal(current.sprites.players[0]?.x, 52, "the east step advanced once before anything blocked it");
  const blocked = events.find((record) => record.type === "blocked" && record.actor === "hero");
  // speed 0.05 is three ticks per advance: the first advance lands on tick 0 and the precheck runs again
  // on tick 3, by which time the cart (one 4 px advance per tick, speed 0.02) has walked into the
  // destination's collision area at (80, 63).
  equal(blocked?.tick, 3, "the cart enters the destination after the first advance");
  equal(blocked?.type === "blocked" ? blocked.blocker : null, "cart", "the destination precheck names the sprite");
  equal(events.some((record) => record.type === "step-complete" && record.actor === "hero"), false, "a blocked step never completes");
  equal(current.party.steps, 0, "a step stopped mid-way contributes nothing");
  equal(current.party.stepRemainder, 0);
  equal(heroYs.findIndex((y) => y !== 63), 4, "north starts on the update after the block (tick 3 + 1)");
});

// R-65 ---------------------------------------------------------------

test("R-65 recomputes a queued direction from where the actor actually stands", () => {
  const currentBoard = board([wall(76, 84)]);
  const current = sprites(currentBoard);
  enqueueDirectionMove(current, "hero", "E", 0);
  enqueueDirectionMove(current, "hero", "N", 0);
  for (let tick = 0; tick <= 30; tick += 1) runMovementPhase(current, currentBoard, tick);
  equal(current.players[0]?.x, 48, "the blocked east step never moves the actor");
  equal(current.players[0]?.y, 63 - TILE, "north starts from the last safe position, not a stale east target");
});

test("R-65 keeps a point target absolute and consumes it on a blocked attempt", () => {
  const currentBoard = board([wall(70, 74)]);
  const current = sprites(currentBoard);
  enqueueMove(current, "hero", { source: "path", target: { x: 80, y: 63 }, facing: null, pathMode: 1 });
  const events: MovementEvent[] = [];
  for (let tick = 0; tick <= 20; tick += 1) events.push(...runMovementPhase(current, currentBoard, tick));
  equal(current.players[0]?.x, 52, "the point ends at the last safe position and never grants passage");
  equal(current.players[0]?.queue.moves.length, 0, "the blocked point entry was consumed");
  equal(events.some((record) => record.type === "step-complete"), false);
});

test("R-65 preserves each entry's kind across save and restore", () => {
  const currentBoard = board();
  const current = stateWith(currentBoard);
  enqueueDirectionMove(current.sprites, "hero", "E", 0);
  enqueueDirectionMove(current.sprites, "hero", "N", 0);
  const restored = restoreGameState(snapshot(current));
  const moves = restored.sprites.players[0]?.queue.moves ?? [];
  deepEqual(moves.map((move) => move.source), ["direction", "direction"]);
  for (const move of moves) {
    equal("target" in move, false, "a direction entry never serializes an expanded target");
    equal(move.source === "direction" ? move.distance : undefined, TILE);
  }
  deepEqual(restored.sprites, current.sprites);
});

test("R-65 migrates a pre-v4 save's absolute direction target to relative intent", () => {
  const currentBoard = board();
  const current = stateWith(currentBoard);
  enqueueDirectionMove(current.sprites, "hero", "E", 0);
  const saved = JSON.parse(snapshot(current)) as { schema: { sprites: number }; sprites: { players: { queue: { moves: unknown[] } }[] } };
  saved.schema.sprites = 3;
  saved.sprites.players[0]!.queue.moves = [
    { source: "direction", target: { x: 80, y: 63 }, facing: "E" },
    { source: "direction", target: { x: 112, y: 31 }, facing: "N" },
  ];
  const restored = restoreGameState(JSON.stringify(saved));
  const moves = restored.sprites.players[0]?.queue.moves ?? [];
  const first = moves[0];
  ok(first !== undefined && first.source === "direction");
  equal(first.source === "direction" ? first.direction : null, "E");
  equal(first.source === "direction" ? first.distance : 0, TILE);
  equal("target" in first, false);
  // The legacy second target assumes the east step succeeded (112,31 is diagonal from 80,63); its stored
  // facing is authoritative, so migration keeps N rather than inventing NE.
  const second = moves[1];
  ok(second !== undefined && second.source === "direction");
  equal(second.source === "direction" ? second.direction : null, "N");
  equal(second.source === "direction" ? second.distance : 0, TILE);
  equal("target" in second, false);
});

test("R-65 revalidates a restored active step against its destination", () => {
  const clearBoard = board();
  const current = stateWith(clearBoard);
  enqueueDirectionMove(current.sprites, "hero", "E", 0);
  runMovementPhase(current.sprites, clearBoard, 0);
  equal(current.sprites.players[0]?.x, 52);
  const saved = snapshot(current);
  const restored = restoreGameState(saved);
  const blockedBoard = board([wall(76, 84)]);
  const events: MovementEvent[] = [];
  for (let tick = 1; tick <= 3; tick += 1) events.push(...runMovementPhase(restored.sprites, blockedBoard, tick));
  equal(restored.sprites.players[0]?.x, 52, "the destination is revalidated before every advance, so the restored step never moves");
  equal(restored.sprites.players[0]?.movement.lastStepBlocked, true);
  equal(events.some((record) => record.type === "step-complete"), false);
});

test("R-65 appends a script route from the active step's target, not the mid-step pixel", () => {
  const currentBoard = board();
  const current = stateWith(currentBoard);
  const player = current.sprites.players[0]!;
  current.sprites.players = [{
    ...player,
    x: 52,
    prev: { x: 48, y: 63 },
    state: "moving",
    queue: { moves: [{ source: "direction", direction: "E", distance: TILE }], waypoint: null },
    movement: {
      ...player.movement,
      active: { source: "direction", start: { x: 48, y: 63 }, target: { x: 80, y: 63 }, facing: "E", cadence: 0, ignoreBoard: false, tried: false, provenance: { kind: "input" } },
    },
  }];
  const thread = startThread(current.vm, { ref: { kind: "inline", text: "end()", ir: IR_VERSION }, kind: "persistent", owner: "script" });
  thread.takeover.push(player.id);
  // The active step ends at 80 and the queued E step ends at 112; a route to 112 therefore needs no travel.
  // Starting the expansion from the mid-step pixel 52 lands on 84 and wrongly enqueues a route.
  equal(applySpriteEffect(current, "playerpath", [player.id, 4, 112, 63], thread.id), false);
  equal(current.sprites.players[0]?.queue.moves.length, 1, "no route is appended when the queued end already equals the goal");
});

test("R-65 keeps one FIFO across kinds; a direction after a point starts where the point ended", () => {
  const currentBoard = board();
  const current = sprites(currentBoard);
  enqueueMove(current, "hero", { source: "points", target: { x: 64, y: 63 }, facing: null });
  enqueueDirectionMove(current, "hero", "E", 0);
  for (let tick = 0; tick <= 60; tick += 1) runMovementPhase(current, currentBoard, tick);
  equal(current.players[0]?.x, 96, "the direction starts from the point's actual end");
});

// R-69 (was R-65 item 5 / owner ruling on ambiguity 4) ---------------

/** Call one movement built-in directly and read its by-reference outputs. */
function getPath(
  command: "playergetpath" | "itemgetpath",
  state: GameState,
  handle: number | string,
  index: number,
  threadId?: number,
): { value: unknown; out: readonly (readonly [number, unknown])[]; wait?: unknown } {
  const services = createScriptServices(state, [{ definition: MOVEMENT_PLUGIN }]);
  if (threadId !== undefined) services.setCommandThread(threadId);
  const spec = services.commands.get(command)?.spec;
  if (spec === undefined) throw new Error(`missing ${command}`);
  const args: Arg[] = [
    { value: handle, ref: null },
    { value: index, ref: null },
    { value: 0, ref: "x" as never },
    { value: 0, ref: "y" as never },
  ];
  const result = spec.call(services.view, args, () => ({ value: null })) as { value: unknown; out?: readonly (readonly [number, unknown])[]; wait?: unknown };
  return { value: result.value, out: result.out ?? [], wait: result.wait };
}

/** Call the one-argument form, which reports only the count, optionally from a given thread's context. */
function getPathCount(command: "playergetpath" | "itemgetpath", state: GameState, handle: number | string, threadId?: number): unknown {
  const services = createScriptServices(state, [{ definition: MOVEMENT_PLUGIN }]);
  if (threadId !== undefined) services.setCommandThread(threadId);
  const spec = services.commands.get(command)?.spec;
  if (spec === undefined) throw new Error(`missing ${command}`);
  const result = spec.call(services.view, [{ value: handle, ref: null }], () => ({ value: null })) as { value: unknown };
  return result.value;
}

function waypointVector(handle = "wp", points: { x: number; y: number }[] = [{ x: 64, y: 63 }, { x: 96, y: 63 }]): NonNullable<WorldBoard["vectors"]>[number] {
  return { handle, attributes: 0, closed: 0, layer: 1, type: 4, points };
}

test("playergetpath reports where each queued entry would end, including a direction entry", () => {
  const currentBoard = board();
  const current = stateWith(currentBoard);
  enqueueDirectionMove(current.sprites, "hero", "E", 0);
  enqueueMove(current.sprites, "hero", { source: "points", target: { x: 200, y: 100 }, facing: null });
  const first = getPath("playergetpath", current, 0, 0);
  deepEqual([first.value, first.out], [2, [[2, 80], [3, 63]]], "the direction entry reports its computed pixel point");
  const second = getPath("playergetpath", current, 0, 1);
  deepEqual([second.value, second.out], [2, [[2, 200], [3, 100]]], "the point entry keeps its absolute target");
});

test("itemgetpath reports where each queued entry would end, including a direction entry", () => {
  const currentBoard = board();
  const current = stateWith(currentBoard);
  const npc = actorFromSource({ id: "npc", kind: "item", source: "npc.itm", x: 48, y: 63, layer: 1 }, currentBoard, 0, 0);
  current.sprites.items = [npc];
  enqueueDirectionMove(current.sprites, "npc", "E", 0);
  enqueueMove(current.sprites, "npc", { source: "points", target: { x: 200, y: 100 }, facing: null });
  const first = getPath("itemgetpath", current, 0, 0);
  deepEqual([first.value, first.out], [2, [[2, 80], [3, 63]]], "the direction entry reports its computed pixel point");
  const second = getPath("itemgetpath", current, 0, 1);
  deepEqual([second.value, second.out], [2, [[2, 200], [3, 100]]], "the point entry keeps its absolute target");
});

test("playergetpath recomputes a direction after a blocked step from the last safe position", () => {
  const clearBoard = board();
  const current = stateWith(clearBoard);
  enqueueDirectionMove(current.sprites, "hero", "E", 0);
  runMovementPhase(current.sprites, clearBoard, 0);
  equal(current.sprites.players[0]?.x, 52, "the first advance is safe");
  const blockedBoard = board([wall(70, 74)]);
  current.world = { ...current.world, board: blockedBoard };
  for (let tick = 1; tick <= 5; tick += 1) {
    current.time = { ...current.time, tick };
    movementPhaseRegistration().run(current);
  }
  equal(current.sprites.players[0]?.x, 52, "the blocked step stops at the last safe position");
  equal(current.sprites.players[0]?.movement.lastStepBlocked, true, "the step that was aimed at 80 is blocked");
  enqueueDirectionMove(current.sprites, "hero", "E", 0);
  const point = getPath("playergetpath", current, 0, 0);
  deepEqual([point.value, point.out], [1, [[2, 84], [3, 63]]], "the next direction starts from 52, not the blocked target 80");
});

test("playergetpath returns 0 and writes nothing when the player is idle", () => {
  const currentBoard = board();
  const current = stateWith(currentBoard);
  const empty = getPath("playergetpath", current, 0, 0);
  deepEqual([empty.value, empty.out], [0, []], "no entry reports no point and leaves both variables alone");
});

// R-69 items 1-8: count, index, rounding, missing index, arity, side effects, waypoints, missing handle.

test("R-69 counts the step in progress and reports its target at index 0", () => {
  const currentBoard = board();
  const current = stateWith(currentBoard);
  enqueueDirectionMove(current.sprites, "hero", "E", 0);
  runMovementPhase(current.sprites, currentBoard, 0);
  equal(current.sprites.players[0]?.x, 52, "the step is in progress");
  const result = getPath("playergetpath", current, 0, 0);
  deepEqual([result.value, result.out], [1, [[2, 80], [3, 63]]], "the active step's target is entry 0 and is counted");
});

test("R-69 reports the first queued entry at index 0 when no step is active", () => {
  const currentBoard = board();
  const current = stateWith(currentBoard);
  enqueueDirectionMove(current.sprites, "hero", "W", 0);
  enqueueDirectionMove(current.sprites, "hero", "W", 0);
  equal(current.sprites.players[0]?.movement.active, null);
  const result = getPath("playergetpath", current, 0, 0);
  deepEqual([result.value, result.out], [2, [[2, 16], [3, 63]]], "index 0 is the first queued entry, counted with the second");
});

test("R-69 writes the point rounded half up to whole pixels", () => {
  const currentBoard = board();
  const current = stateWith(currentBoard);
  enqueueMove(current.sprites, "hero", { source: "points", target: { x: 64.5, y: 63.49 }, facing: null });
  const result = getPath("playergetpath", current, 0, 0);
  deepEqual([result.value, result.out], [1, [[2, 65], [3, 63]]], "floor(value + 0.5) is never a truncation");
});

test("R-69 writes nothing for a negative or past-end index and leaves both variables alone", () => {
  const currentBoard = board();
  const current = stateWith(currentBoard);
  enqueueMove(current.sprites, "hero", { source: "points", target: { x: 200, y: 100 }, facing: null });
  const negative = getPath("playergetpath", current, 0, -1);
  deepEqual([negative.value, negative.out], [1, []], "a negative index writes nothing");
  const past = getPath("playergetpath", current, 0, 1);
  deepEqual([past.value, past.out], [1, []], "an index at the count writes nothing");
});

test("R-69 rejects any argument count other than one or four with arity.mismatch", () => {
  const currentBoard = board();
  const current = stateWith(currentBoard);
  const services = createScriptServices(current, [{ definition: MOVEMENT_PLUGIN }]);
  startProgram(current.vm, { kind: "inline", text: "playergetpath(0, 0)\n", ir: IR_VERSION });
  advanceScriptTick(current, services);
  const diagnostics = drainDiagnostics(services);
  equal(diagnostics.length, 1, "one diagnostic");
  equal(diagnostics[0]?.code, "arity.mismatch", "the standard catchable wrong-count error");
  ok(diagnostics[0]?.message.includes("1 or 4"), `the message names both valid counts: ${diagnostics[0]?.message}`);
});

test("R-69 does not wait or change movement when reading", () => {
  const currentBoard = board();
  const current = stateWith(currentBoard);
  enqueueDirectionMove(current.sprites, "hero", "E", 0);
  enqueueMove(current.sprites, "hero", { source: "points", target: { x: 200, y: 100 }, facing: null });
  const before = JSON.stringify(current.sprites);
  const count = getPathCount("playergetpath", current, 0);
  const first = getPath("playergetpath", current, 0, 0);
  const second = getPath("playergetpath", current, 0, 0);
  equal(count, 2, "the count includes both entries");
  deepEqual([first.value, first.out], [second.value, second.out], "reading twice returns the same values");
  equal(JSON.stringify(current.sprites), before, "the queue and movement are unchanged");
  equal(first.wait, undefined, "the four-argument form does not wait");
});

test("R-69 counts a copied waypoint in full once per cycle but not a linked one", () => {
  const currentBoard = board([waypointVector()]);
  const linked = stateWith(currentBoard);
  applySpriteEffect(linked, "playerpath", ["hero", 16, "wp", 1], 0);
  equal(linked.sprites.players[0]?.queue.waypoint?.live, true, "the vector is linked");
  deepEqual([getPathCount("playergetpath", linked, 0), getPath("playergetpath", linked, 0, 0).out], [0, []], "a linked waypoint is not a queue");
  for (let tick = 0; tick < 3; tick += 1) runMovementPhase(linked.sprites, currentBoard, tick);
  equal(linked.sprites.players[0]?.movement.active?.source, "waypoint-link", "a linked step is in progress");
  deepEqual([getPathCount("playergetpath", linked, 0), getPath("playergetpath", linked, 0, 0).out], [0, []], "an in-progress linked step is still not a queue entry");

  const copied = stateWith(currentBoard);
  applySpriteEffect(copied, "playerpath", ["hero", 8, "wp", 2], 0);
  equal(copied.sprites.players[0]?.queue.waypoint?.live, false, "the vector is copied");
  const first = getPath("playergetpath", copied, 0, 0);
  const second = getPath("playergetpath", copied, 0, 1);
  deepEqual([getPathCount("playergetpath", copied, 0), first.out, second.out], [2, [[2, 64], [3, 63]], [[2, 96], [3, 63]]], "two cycles of two points still count once per cycle");
  for (let tick = 0; tick < 200; tick += 1) runMovementPhase(copied.sprites, currentBoard, tick);
  deepEqual([getPathCount("playergetpath", copied, 0), getPath("playergetpath", copied, 0, 0).out], [0, []], "the finished waypoint leaves an empty queue");
});

test("R-69 reports 3.1's 'player not found' text for a handle that names no actor", () => {
  const currentBoard = board();
  const current = stateWith(currentBoard);
  const services = createScriptServices(current, [{ definition: MOVEMENT_PLUGIN }]);
  for (const command of ["playergetpath", "itemgetpath"] as const) {
    const spec = services.commands.get(command)?.spec;
    if (spec === undefined) throw new Error(`missing ${command}`);
    throws(
      () => spec.call(services.view, [{ value: "ghost", ref: null }], () => ({ value: null })),
      (error: unknown) => error instanceof ScriptError && error.code === "builtin.bad-arg" && error.message === "player not found",
      `${command} keeps 3.1's message text`,
    );
  }
});

test("R-69 accepts the calling thread's source and target context handles", () => {
  const currentBoard = board();
  const current = stateWith(currentBoard);
  const npc = actorFromSource({ id: "npc", kind: "item", source: "npc.itm", x: 48, y: 63, layer: 1 }, currentBoard, 0, 0);
  const altar = actorFromSource({ id: "altar", kind: "item", source: "altar.itm", x: 200, y: 40, layer: 1 }, currentBoard, 1, 1);
  current.sprites.items = [npc, altar];
  const ref = { kind: "inline" as const, text: "1", ir: IR_VERSION };
  const itemThread = startThread(current.vm, { ref, kind: "item", owner: "world", source: "npc", target: "altar" });
  enqueueDirectionMove(current.sprites, "npc", "E", 0);
  enqueueMove(current.sprites, "altar", { source: "points", target: { x: 232.5, y: 40 }, facing: null });

  const source = getPath("itemgetpath", current, "SOURCE", 0, itemThread.id);
  deepEqual([source.value, source.out], [1, [[2, 80], [3, 63]]], "source resolves the calling item and is case-insensitive");
  const target = getPath("itemgetpath", current, "target", 0, itemThread.id);
  deepEqual([target.value, target.out], [1, [[2, 233], [3, 40]]], "target resolves the other context item");

  const playerThread = startThread(current.vm, { ref, kind: "persistent", owner: "script", source: "hero", target: "hero" });
  enqueueDirectionMove(current.sprites, "hero", "E", 0);
  const playerSource = getPath("playergetpath", current, "source", 0, playerThread.id);
  deepEqual([playerSource.value, playerSource.out], [1, [[2, 80], [3, 63]]], "a player thread's source resolves that player");
  equal(getPathCount("playergetpath", current, "TARGET", playerThread.id), 1, "a player thread's target resolves too");

  throws(
    () => getPath("itemgetpath", current, "ghost", 0, itemThread.id),
    (error: unknown) => error instanceof ScriptError && error.message === "player not found",
    "a handle that still names nothing keeps the 3.1 message",
  );
});
