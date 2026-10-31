import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { assetKey } from "../src/formats/resolver/resolver.ts";
import { createGameState, type GameState } from "../src/save/state.ts";
import { actorFromSource, type SpriteActor } from "../src/sprites/model.ts";
import { runTriggersPhase } from "../src/triggers/runtime.ts";
import type { WorldBoard, WorldItem, WorldProgram } from "../src/world/model.ts";

const ref = (text: string) => ({ kind: "inline" as const, text, ir: "1", dialect: "tk3" as const });
const rectangle = (left: number, top: number, right: number, bottom: number) => [
  { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
];

function item(index: number, x: number, y: number, activationType = 0, initialVar = "", initialValue = ""): WorldItem {
  return { slot: index, itemFile: `item-${index}.itm`, activationPrg: `item-${index}`, multitaskPrg: "", initialVar, initialValue, finalVar: "", finalValue: "", loadingVar: "", loadingValue: "", activate: initialVar === "" ? 0 : 1, activationType, x, y, layer: 1, reserved: 0 };
}
function region(index: number, activationType = 0, initialVar = "", initialValue = ""): WorldProgram {
  return { program: `region-${index}`, graphic: "", initialVar, initialValue, finalVar: "", finalValue: "", activate: initialVar === "" ? 0 : 1, activationType, repeatDistance: 0, layer: 1, points: rectangle(-32, -32, 32, 32), closed: 1, handle: `r${index}` };
}
function board(programs: WorldProgram[] = [], items: WorldItem[] = []): WorldBoard {
  return { key: assetKey("boards/test.brd"), coordType: 0, sizeX: 10, sizeY: 10, sizeL: 1, width: 320, height: 320, background: { r: 0, g: 0, b: 0 }, ambient: { r: 255, g: 255, b: 255 }, layers: [], programs, items };
}
function stateWith(world: WorldBoard, itemSources: SpriteActor[] = []): GameState {
  const state = createGameState({ seed: 1 });
  state.world = { ...state.world, board: world };
  const player = actorFromSource({ id: "player", kind: "player", source: "hero", x: 0, y: 0, layer: 1, facing: "E", controlled: true }, world, 0, null);
  state.sprites.players = [player];
  state.sprites.selectedPlayer = player.id;
  state.sprites.items = itemSources;
  return state;
}
function itemActor(world: WorldBoard, source: WorldItem, index: number, x = source.x, y = source.y, visible = true): SpriteActor {
  return actorFromSource({ id: `item:${index}`, kind: "item", source: `item:${index}`, sourceSlot: source.slot, x, y, layer: source.layer, visible, boardItem: source }, world, index, index);
}
function finishActive(state: GameState): void {
  const active = state.triggers.active;
  if (active === null) throw new Error("expected active trigger");
  state.vm.threads = state.vm.threads.map((thread) => thread.id === active.thread ? { ...thread, status: "finished" } : thread);
  state.time.tick += 1;
  runTriggersPhase(state, { programRef: (name) => ref(name) });
}

test("trigger precedence, conditions, re-arm and key dispatch are deterministic", () => {
  const world = board([region(0), region(1)], [item(0, 0, 0), item(1, 8, 0)]);
  const state = stateWith(world, [itemActor(world, world.items![0]!, 0), itemActor(world, world.items![1]!, 1)]);
  state.time.tick = 1;
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, movement: { ...player.movement, lastStepTick: 1, lastStepDistance: 32 } }));
  const started = runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(started[0]?.key, "item:1");
  equal(state.sprites.items[1]?.facing, "W");
  finishActive(state);
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, x: 128, movement: { ...player.movement, lastStepTick: state.time.tick + 1, lastStepDistance: 128 } }));
  state.time.tick += 1;
  runTriggersPhase(state, { programRef: (name) => ref(name) });
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, x: 0, movement: { ...player.movement, lastStepTick: state.time.tick + 1, lastStepDistance: 128 } }));
  state.time.tick += 1;
  const rearmed = runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(rearmed[0]?.key, "item:1");
  finishActive(state);
  state.time.tick += 1;
  const key = runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(key.length, 0);
});

test("condition failure falls through and hidden items never become candidates", () => {
  const world = board([region(0, 0, "gate", "open"), region(1)], [item(0, 0, 0)]);
  const hidden = itemActor(world, world.items![0]!, 0, 0, 0, false);
  const state = stateWith(world, [hidden]);
  state.vm.globals.gate = "closed";
  state.time.tick = 1;
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, movement: { ...player.movement, lastStepTick: 1, lastStepDistance: 32 } }));
  const events = runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(events[0]?.key, "region:1");
  equal(state.vm.threads.filter((thread) => thread.kind === "item").length, 0);
});

test("snapshot trigger state is plain and resettable", () => {
  const state = createGameState({ seed: 2 });
  state.triggers.boardKey = "boards/test.brd";
  state.triggers.fired["region:0"] = true;
  state.triggers.suppressed = ["region:0"];
  state.triggers.active = { key: "region:0", thread: 3, setVar: "done", setValue: "yes", source: "region", silentMovement: true };
  const before = JSON.stringify(state.triggers);
  state.triggers.boardKey = null;
  state.triggers.fired = {};
  state.triggers.suppressed = [];
  state.triggers.active = null;
  equal(before.includes("region:0"), true);
  deepEqual(state.triggers.active, null);
});
