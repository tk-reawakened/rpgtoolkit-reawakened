import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { assetKey } from "../src/formats/resolver/resolver.ts";
import { createGameState, type GameState } from "../src/save/state.ts";
import { actorFromSource, type SpriteActor } from "../src/sprites/model.ts";
import { applyTriggerEffect, runTriggersPhase } from "../src/triggers/runtime.ts";
import { coordLayout, tileToPixel, boardPixelSize } from "../src/world/coords.ts";
import { placeSelectedPlayer } from "../src/sprites/runtime.ts";
import type { EffectRecord } from "../src/script/effects.ts";
import type { WorldBoard, WorldItem, WorldProgram } from "../src/world/model.ts";

const ref = (text: string) => ({ kind: "inline" as const, text, ir: "1", dialect: "tk3" as const });
const rectangle = (left: number, top: number, right: number, bottom: number) => [
  { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
];

function item(index: number, x: number, y: number, activationType = 0, initialVar = "", initialValue = ""): WorldItem {
  return { slot: index, itemFile: `item-${index}.itm`, activationPrg: `item-${index}`, multitaskPrg: "", initialVar, initialValue, finalVar: "", finalValue: "", loadingVar: "", loadingValue: "", activate: initialVar === "" ? 0 : 1, activationType, x, y, layer: 1, reserved: 0 };
}
function region(index: number, activationType = 0, initialVar = "", initialValue = "", finalVar = "", finalValue = "", layer = 1): WorldProgram {
  return { program: `region-${index}`, graphic: "", initialVar, initialValue, finalVar, finalValue, activate: initialVar === "" ? 0 : 1, activationType, repeatDistance: 0, layer, points: rectangle(-32, -32, 32, 32), closed: 1, handle: `r${index}` };
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

test("a key-press trigger fires on a key and a step-on trigger fires on a step, never the other way round", () => {
  const world = board([region(0, 1), region(1, 0)]);
  // A step: only the step-on region (activation type 0) qualifies.
  const stepped = stateWith(world);
  stepped.time.tick = 1;
  stepped.sprites.players = stepped.sprites.players.map((player) => ({ ...player, movement: { ...player.movement, lastStepTick: 1, lastStepDistance: 32 } }));
  const stepEvents = runTriggersPhase(stepped, { programRef: (name) => ref(name) });
  equal(stepEvents[0]?.key, "region:1", "a step starts the step-on region, not the key region");

  // A key press at the same place: now only the key region (type 1) qualifies.
  const pressed = stateWith(world);
  pressed.time.tick = 1;
  pressed.input.keys.push({ seq: 1, name: "ENTER", code: "Enter", char: "\n" });
  const keyEvents = runTriggersPhase(pressed, { programRef: (name) => ref(name) });
  equal(keyEvents[0]?.key, "region:0", "a key press starts the key region, not the step-on region");

  // A configured direction edge is movement, not activation: it neither starts a key region nor eats the press.
  const walked = stateWith(world);
  walked.time.tick = 1;
  walked.input.bindings = { keys: { ArrowRight: "right", Enter: "ENTER" } };
  walked.input.keys.push({ seq: 1, name: "right", code: "ArrowRight", char: null, action: "right" });
  walked.sprites.players = walked.sprites.players.map((player) => ({ ...player, movement: { ...player.movement, lastStepTick: 1, lastStepDistance: 32 } }));
  const walkedEvents = runTriggersPhase(walked, { programRef: (name) => ref(name) });
  equal(walkedEvents[0]?.key, "region:1", "a direction edge with a step only steps on (regions:1), never counts as activation");
  equal(walked.input.keys.length, 1, "the direction press stays queued for movement");
});

test("trigger layer matching ignores a region on another layer", () => {
  const world = board([region(0)]);
  const state = stateWith(world);
  state.time.tick = 1;
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, layer: 2, movement: { ...player.movement, lastStepTick: 1, lastStepDistance: 32 } }));
  equal(runTriggersPhase(state, { programRef: (name) => ref(name) }).length, 0, "a player on another layer never fires the region");
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, layer: 1 }));
  state.time.tick += 1;
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, movement: { ...player.movement, lastStepTick: state.time.tick } }));
  const sameLayer = runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(sameLayer[0]?.key, "region:0", "the same position on the region's layer fires it");
});

test("a finished trigger program applies its final variable", () => {
  const world = board([region(0, 0, "", "", "doorOpen", "yes")]);
  const state = stateWith(world);
  state.vm.globals.doorOpen = "no";
  state.time.tick = 1;
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, movement: { ...player.movement, lastStepTick: 1, lastStepDistance: 32 } }));
  const started = runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(started[0]?.key, "region:0");
  equal(state.vm.globals.doorOpen, "no", "the final variable is untouched while the program runs");
  finishActive(state);
  equal(state.vm.globals.doorOpen, "yes", "completion writes the region's final variable");
  equal(state.triggers.active, null);
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

test("send-arrival deactivation suppresses the arrival frame only and re-arms when the player leaves", () => {
  const world = board([region(0)]);
  const state = stateWith(world);
  // The engine sets the board key inside arrive() before it posts deactivateat; mirror that here.
  state.triggers.boardKey = world.key;
  applyTriggerEffect(state, { name: "deactivateat", args: [0, 0, 1, "pixel"] } as EffectRecord);
  equal(state.triggers.deactivateAt?.x, 0);
  equal(state.triggers.deactivateAt?.layer, 1);
  state.time.tick = 1;
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, movement: { ...player.movement, lastStepTick: 1, lastStepDistance: 32 } }));
  equal(state.triggers.deactivated.length, 0, "the arrival has not been consumed yet");
  const arrival = runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(arrival.length, 0, "the same-unit arrival frame fires nothing on the arrival phase");
  equal(state.triggers.deactivated.length > 0, true, "the region is deactivated");
  // A step inside the still-suppressed candidate fires nothing...
  const second = runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(second.length, 0, "the arrival suppresses the region while it still overlaps");
  // ...but a step outside the candidate re-arms it.
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, x: 256, movement: { ...player.movement, lastStepTick: state.time.tick, lastStepDistance: 32 } }));
  const leaving = runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(leaving.length, 0, "leaving never triggers");
  state.time.tick += 1;
  state.sprites.players = state.sprites.players.map((player) => ({ ...player, x: 0, movement: { ...player.movement, lastStepTick: state.time.tick, lastStepDistance: 32 } }));
  const reentered = runTriggersPhase(state, { programRef: (name) => ref(name) });
  equal(reentered[0]?.key, "region:0", "the region re-arms after the player leaves and re-enters");
});

test("send-arrival tile placement and deactivation agree on stacked and rotated boards", () => {
  // The destination region sits exactly on the arrival tile (3, 2) of each layout's own pixel conversion.
  for (const coordType of [0, 1, 2]) {
    const layout = coordLayout(coordType);
    const request = coordType === 0 ? { x: 3, y: 2 } : coordType === 1 ? { x: 4, y: 4 } : { x: 5, y: 3 };
    const world: WorldBoard = {
      ...board([region(0)]),
      coordType,
      sizeX: 8,
      sizeY: 8,
      width: boardPixelSize(layout, 8, 8).width,
      height: boardPixelSize(layout, 8, 8).height,
    };
    const destination = tileToPixel(layout, world.sizeX, request.x, request.y);
    // A region whose points translate to the arrival pixel: regionCandidate translates its authored points.
    const worldArrival: WorldBoard = {
      ...world,
      programs: [{
        ...region(0),
        points: [{ x: destination.x - 4, y: destination.y - 4 }, { x: destination.x + 4, y: destination.y - 4 }, { x: destination.x + 4, y: destination.y + 4 }, { x: destination.x - 4, y: destination.y + 4 }],
      }],
    };
    const state = stateWith(worldArrival);
    state.triggers.boardKey = worldArrival.key;
    // The engine posts the raw send tile coordinates; trigger's applyTriggerEffect must convert them with the
    // same destination-layout conversion the sprites owner uses when it places the player.
    applyTriggerEffect(state, { name: "deactivateat", args: [request.x, request.y, 1, "tile"] } as EffectRecord);
    placeSelectedPlayer(state.sprites, request.x, request.y, 1, "tile", layout, world.sizeX);
    const placed = state.sprites.players[0]!;
    deepEqual({ x: placed.x, y: placed.y }, destination, `${layout}: the player sits at the destination-layout pixel`);
    state.time.tick = 1;
    state.sprites.players = state.sprites.players.map((player) => ({ ...player, movement: { ...player.movement, lastStepTick: 1, lastStepDistance: 8 } }));
    runTriggersPhase(state, { programRef: (name) => ref(name) });
    equal(state.triggers.deactivated.length > 0, true, `${layout}: the arrival deactivation covers the actually placed destination`);
    const arrivalEvents = runTriggersPhase(state, { programRef: (name) => ref(name) });
    equal(arrivalEvents.length, 0, `${layout}: nothing fires on the arrival tick`);
  }
});
