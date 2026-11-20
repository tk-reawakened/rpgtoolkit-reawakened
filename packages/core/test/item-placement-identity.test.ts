import type { WorldBoard, WorldItem } from "../src/world/model.ts";
import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { assetKey, createEmptyBoard, restoreGameState, snapshot } from "../src/index.ts";
import { reconcileItemPlacementIdentities } from "../src/engine/item-placement-identity.ts";
import { createGameState } from "../src/save/state.ts";
import { createSpriteRuntime, enqueueMove } from "../src/sprites/runtime.ts";
import type { GameState } from "../src/save/state.ts";
import { IR_VERSION, type ProgramRef } from "../src/script/program.ts";
import { startThread } from "../src/script/state.ts";

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
  state.sprites.items = state.sprites.items.map((item) => ({ ...item, id: "walker.itm" }));
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
  frame.programRoot = { restore: { source: "item:walker.itm", target: null } };
  state.sprites.items = [{ ...first, multitaskThread: thread.id }, second];
  throws(() => reconcileItemPlacementIdentities(state), (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === "restore.item-identity");
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
