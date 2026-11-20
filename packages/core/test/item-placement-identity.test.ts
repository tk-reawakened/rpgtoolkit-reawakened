import type { WorldBoard, WorldItem } from "../src/world/model.ts";
import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { assetKey, createEmptyBoard, restoreGameState, snapshot } from "../src/index.ts";
import { reconcileItemPlacementIdentities } from "../src/engine/item-placement-identity.ts";
import { createGameState } from "../src/save/state.ts";
import { createSpriteRuntime, enqueueMove, itemKey } from "../src/sprites/runtime.ts";
import type { GameState } from "../src/save/state.ts";
import { IR_VERSION, type ProgramRef } from "../src/script/program.ts";
import { startThread } from "../src/script/state.ts";
import type { Wait } from "../src/ports/wait.ts";

const itemProgram: ProgramRef = { kind: "inline", text: "end()\n", ir: IR_VERSION };

function itemSlot(itemFile: string, slot: number): WorldItem {
  return {
    slot, itemFile, activationPrg: "", multitaskPrg: "item.prg", initialVar: "", initialValue: "",
    finalVar: "", finalValue: "", loadingVar: "", loadingValue: "", activate: 0,
    activationType: 1, x: 48 + slot * 48, y: 63, layer: 1, reserved: 0,
  };
}

function board(files = ["walker.itm", "walker.itm"]): WorldBoard {
  const { residue: _residue, ...empty } = createEmptyBoard();
  const items = files.map(itemSlot);
  return {
    ...empty,
    key: assetKey("Boards/identity.brd"),
    coordType: 0,
    sizeX: 10,
    sizeY: 10,
    items,
    rawItems: items,
  } as unknown as WorldBoard;
}

function stateFor(items = board()): GameState {
  const state = createGameState({ seed: 1 });
  state.world = { ...state.world, board: items };
  const runtime = createSpriteRuntime({ vm: state.vm });
  state.sprites = runtime.hydrate({ board: items, vm: state.vm });
  state.sprites.items = state.sprites.items.map((item) => ({ ...item, id: item.source }));
  return state;
}

test("same-file item placements have independent identities, movement, and thread cleanup", () => {
  const state = createGameState({ seed: 1 });
  const runtime = createSpriteRuntime({ vm: state.vm });
  runtime.hydrate({ board: board(), vm: state.vm, programRef: () => itemProgram });
  const [first, second] = runtime.section.items;
  if (first === undefined || second === undefined) throw new Error("expected two board placements");
  equal(first.id, "walker.itm");
  equal(second.id, "walker.itm#board-slot:1");
  equal(first.multitaskThread === second.multitaskThread, false);
  equal(enqueueMove(runtime.section, second.id, { source: "direction", target: { x: 1, y: 0 }, facing: "E" }), true);
  equal(runtime.section.items[0]?.queue.moves.length, 0);
  equal(runtime.section.items[1]?.queue.moves.length, 1);
  equal(runtime.hideItem(second.id), true);
  equal(runtime.section.items[0]?.visible, true);
  equal(runtime.section.items[1]?.visible, false);
  equal(state.vm.threads.some((thread) => thread.id === second.multitaskThread), false);
  equal(state.vm.threads.some((thread) => thread.id === first.multitaskThread), true);
});

test("legacy duplicate sprite IDs restore by source slot and linked item thread", () => {
  const state = stateFor();
  const [first, second] = state.sprites.items;
  if (first === undefined || second === undefined) throw new Error("expected two board placements");
  const firstThread = startThread(state.vm, { ref: itemProgram, kind: "item", owner: "world", source: "item:walker.itm", target: "item:walker.itm" });
  const secondThread = startThread(state.vm, { ref: itemProgram, kind: "item", owner: "world", source: "item:walker.itm", target: "item:walker.itm" });
  state.sprites.items = [
    { ...first, multitaskThread: firstThread.id },
    { ...second, multitaskThread: secondThread.id },
  ];
  const restored = restoreGameState(snapshot(state));
  reconcileItemPlacementIdentities(restored);
  deepEqual(restored.sprites.items.map((item) => item.id), ["walker.itm", "walker.itm#board-slot:1"]);
  deepEqual(restored.vm.threads.map((thread) => thread.source), ["item:walker.itm", "item:walker.itm#board-slot:1"]);
});

test("ambiguous legacy item-thread references refuse identity migration", () => {
  const state = stateFor();
  const thread = startThread(state.vm, { ref: itemProgram, kind: "item", owner: "world", source: "item:walker.itm", target: "item:walker.itm" });
  throws(() => reconcileItemPlacementIdentities(state), (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === "restore.item-identity" && thread.source === "item:walker.itm");
  deepEqual(state.sprites.items.map((item) => item.id), ["walker.itm", "walker.itm"]);
});

test("ambiguous nested continuation references refuse legacy migration", () => {
  const state = stateFor();
  const [first, second] = state.sprites.items;
  if (first === undefined || second === undefined) throw new Error("expected two board placements");
  const thread = startThread(state.vm, { ref: itemProgram, kind: "item", owner: "world", source: "item:walker.itm", target: "item:walker.itm" });
  const frame = thread.frames[0];
  if (frame === undefined) throw new Error("expected an item thread frame");
  frame.programRoot = { restore: { source: "walker.itm", target: null } };
  state.sprites.items = [{ ...first, multitaskThread: thread.id }, second];
  throws(() => reconcileItemPlacementIdentities(state), (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === "restore.item-identity");
});

test("ambiguous bare item activation references refuse identity migration", () => {
  const state = stateFor();
  const activation = startThread(state.vm, {
    ref: itemProgram,
    kind: "blocking",
    owner: "script",
    source: "walker.itm",
    target: null,
  });
  throws(() => reconcileItemPlacementIdentities(state), (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === "restore.item-identity");
  equal(activation.source, "walker.itm");
  deepEqual(state.sprites.items.map((item) => item.id), ["walker.itm", "walker.itm"]);
});

test("ambiguous typed waits refuse legacy item identity migration", () => {
  const waits: Wait[] = [
    { kind: "movement", global: false, moves: [{ sprite: "walker.itm", until: 0 }] },
    { kind: "sprite.movement", global: false, actor: "walker.itm" },
    { kind: "sprite.stance", global: false, actor: "walker.itm", stance: "walking" },
  ];
  for (const wait of waits) {
    const state = stateFor();
    const thread = startThread(state.vm, { ref: itemProgram, kind: "item", owner: "world", source: null, target: null });
    thread.wait = wait;
    thread.status = "waiting";
    const restored = restoreGameState(snapshot(state));
    throws(() => reconcileItemPlacementIdentities(restored), (error: unknown) =>
      typeof error === "object" && error !== null && "code" in error && error.code === "restore.item-identity");
    deepEqual(restored.sprites.items.map((item) => item.id), ["walker.itm", "walker.itm"]);
    deepEqual(restored.vm.threads[0]?.wait, wait);
  }
});

test("an item-thread link cannot disambiguate another repeated placement key", () => {
  const state = stateFor(board(["walker.itm", "walker.itm", "other.itm", "other.itm"]));
  const first = state.sprites.items[0];
  if (first === undefined) throw new Error("expected an item placement");
  const thread = startThread(state.vm, {
    ref: itemProgram,
    kind: "item",
    owner: "world",
    source: "item:walker.itm",
    target: "item:walker.itm",
  });
  state.sprites.items[0] = { ...first, multitaskThread: thread.id };
  thread.source = "item:other.itm";
  throws(() => reconcileItemPlacementIdentities(state), (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === "restore.item-identity");
  equal(thread.source, "item:other.itm");
  deepEqual(state.sprites.items.map((item) => item.id), ["walker.itm", "walker.itm", "other.itm", "other.itm"]);
});

test("unique saved item identities remain stable with linked thread keys", () => {
  const state = stateFor(board(["token.itm"]));
  const item = state.sprites.items[0];
  if (item === undefined) throw new Error("expected an item placement");
  const legacyId = "items/token.itm";
  const thread = startThread(state.vm, {
    ref: itemProgram,
    kind: "item",
    owner: "world",
    source: `item:${legacyId}`,
    target: `item:${legacyId}`,
  });
  state.sprites.items = [{ ...item, id: legacyId, multitaskThread: thread.id }];
  const restored = restoreGameState(snapshot(state));
  reconcileItemPlacementIdentities(restored);
  const restoredItem = restored.sprites.items[0];
  if (restoredItem === undefined) throw new Error("expected the restored item placement");
  equal(restoredItem.id, legacyId);
  equal(restored.vm.threads[0]?.source, itemKey(restoredItem));
  equal(restored.vm.threads[0]?.target, itemKey(restoredItem));
});

test("replacement identities cannot collide with unique saved item IDs", () => {
  const state = stateFor(board(["walker.itm", "walker.itm", "other.itm"]));
  const third = state.sprites.items[2];
  if (third === undefined) throw new Error("expected a unique item placement");
  state.sprites.items[2] = { ...third, id: "walker.itm#board-slot:1" };
  const restored = restoreGameState(snapshot(state));
  throws(() => reconcileItemPlacementIdentities(restored), (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === "restore.item-identity");
  deepEqual(restored.sprites.items.map((item) => item.id), [
    "walker.itm",
    "walker.itm",
    "walker.itm#board-slot:1",
  ]);
});

test("generated slot identities avoid literal item filenames", () => {
  const state = createGameState({ seed: 1 });
  const runtime = createSpriteRuntime({ vm: state.vm });
  runtime.hydrate({ board: board(["walker.itm", "walker.itm", "walker.itm#board-slot:1"]), vm: state.vm });
  deepEqual(runtime.section.items.map((item) => item.id), [
    "walker.itm",
    "walker.itm#board-slot:1:2",
    "walker.itm#board-slot:1",
  ]);
});
