// The battle Items list shows one row per inventory stack, so the stack the player picks must be the stack that pays for
// the use: docs/spec/engine/battle.md#bat-11 (Items), plugins-and-battle.md#e-81 (battle consumption), rpgcode-functions.md
// (`battleconsume`). Review of PR #702 found that picking "Special Potion" spent the canonical "Potion" stack, and that two
// non-canonical stacks of one file revived the target but spent neither.
import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { addActor, createEmptyItem, createGameState, type GameState } from "../src/index.ts";
import { applyInventoryAction } from "../src/menu/inventory.ts";
import { actor, awaitMenu, bootUiRig, ui, type UiRig } from "./battle-ui-rig.ts";

type Stack = { readonly source: string; readonly handle: string; readonly quantity: number };

function counts(rig: UiRig): Record<string, number> {
  return Object.fromEntries(rig.state().inventory.items.map((entry) => [entry.handle, entry.quantity]));
}

/** Open Items, move to the `row`-th stack, choose it and aim at the third party member (the fallen one). */
function chooseStack(rig: UiRig, row: number): void {
  const press = (name: string): void => rig.press(name, 12);
  press("DOWN");
  press("DOWN");
  press("ENTER");
  equal(ui(rig)["listkind"], "item");
  for (let step = 0; step < row; step += 1) press("DOWN");
  equal(ui(rig)["listcursor"], row);
  press("ENTER");
  equal(ui(rig)["mode"], "target");
  press("RIGHT");
  press("RIGHT");
}

function useStack(stacks: readonly Stack[], row: number): { readonly rig: UiRig; readonly hpBefore: number } {
  const rig = bootUiRig({ inventory: stacks });
  awaitMenu(rig);
  chooseStack(rig, row);
  const hpBefore = actor(rig, "rogue.tem").stats.hp;
  rig.press("ENTER", 12);
  rig.tick(100);
  return { rig, hpBefore };
}

test("using the Special Potion row spends the Special Potion stack, not the canonical Potion stack", () => {
  const { rig, hpBefore } = useStack([
    { source: "item/potion.itm", handle: "Potion", quantity: 3 },
    { source: "item/potion.itm", handle: "Special Potion", quantity: 2 },
  ], 1);
  deepEqual(counts(rig), { Potion: 3, "Special Potion": 1 });
  ok(actor(rig, "rogue.tem").stats.hp > hpBefore, "the item still heals the chosen target");
  deepEqual(rig.diagnostics, []);
});

test("using the canonical Potion row still spends the Potion stack and leaves the other row alone", () => {
  const { rig } = useStack([
    { source: "item/potion.itm", handle: "Potion", quantity: 3 },
    { source: "item/potion.itm", handle: "Special Potion", quantity: 2 },
  ], 0);
  deepEqual(counts(rig), { Potion: 2, "Special Potion": 2 });
  deepEqual(rig.diagnostics, []);
});

for (const row of [0, 1]) {
  test(`two non-canonical stacks of one file: row ${row} spends exactly the chosen stack and the use is not refused`, () => {
    const handles = ["Potion One", "Potion Two"];
    const { rig, hpBefore } = useStack(handles.map((handle) => ({ source: "item/potion.itm", handle, quantity: 1 })), row);
    deepEqual(counts(rig), { [handles[1 - row]!]: 1 }, "the chosen one-unit stack is gone and the other is untouched");
    ok(actor(rig, "rogue.tem").stats.hp > hpBefore, "the item heals the chosen target");
    deepEqual(rig.diagnostics, []);
  });
}

test("a chosen stack that vanished before the use is refused before any stat changes", () => {
  const rig = bootUiRig({ inventory: [
    { source: "item/potion.itm", handle: "Potion", quantity: 3 },
    { source: "item/potion.itm", handle: "Special Potion", quantity: 2 },
  ] });
  awaitMenu(rig);
  chooseStack(rig, 1);
  const hpBefore = actor(rig, "rogue.tem").stats.hp;
  const state = rig.state();
  state.inventory.items = state.inventory.items.filter((entry) => entry.handle !== "Special Potion");
  const cuesBefore = rig.cues.length;
  rig.press("ENTER", 12);
  rig.tick(100);
  equal(actor(rig, "rogue.tem").stats.hp, hpBefore, "no HP was applied");
  deepEqual(counts(rig), { Potion: 3 }, "the canonical stack was not spent in its place");
  equal(ui(rig)["mode"], "target", "the player is back at the target list");
  ok(rig.cues.length > cuesBefore, "the refusal plays a cue");
  deepEqual(rig.diagnostics, []);
});

function ownerState(stacks: readonly Stack[]): GameState {
  const state = createGameState({ seed: 1 });
  addActor(state.actors, { kind: "party", source: "hero.tem", name: "Hero", stats: { experience: 0, hp: 5, maxHp: 30, smp: 0, maxSmp: 0, fp: 1, dp: 1, level: 1, criticalOn: -1, criticalBy: -1 } });
  state.inventory.items = stacks.map((entry, index) => ({ id: index + 1, source: entry.source, handle: entry.handle, quantity: entry.quantity }));
  state.inventory.nextId = stacks.length + 1;
  return state;
}

const runtime = {
  item: () => ({ ...createEmptyItem(), name: "Potion" }),
  character: () => undefined,
  applyEquipment: () => true,
};

function consume(state: GameState, handle: string | null): { readonly ok: boolean; readonly path: string | null; readonly events: number } {
  const outcome = applyInventoryAction(state, { type: "consumeBattleItem", item: "item/potion.itm", target: state.actors.actors[0]!.id, handle }, runtime);
  return { ok: outcome.result.ok, path: outcome.result.error?.path ?? null, events: outcome.events.length };
}

test("the owner refuses a source-only request that matches several non-canonical stacks and changes nothing", () => {
  const state = ownerState([
    { source: "item/potion.itm", handle: "Potion One", quantity: 1 },
    { source: "item/potion.itm", handle: "Potion Two", quantity: 1 },
  ]);
  const before = JSON.stringify(state.inventory);
  deepEqual(consume(state, null), { ok: false, path: "inventory.consume.entry", events: 0 });
  equal(JSON.stringify(state.inventory), before);
});

test("the owner consumes exactly the named stack, whatever the definition name and sibling stacks are", () => {
  const state = ownerState([
    { source: "item/potion.itm", handle: "Potion", quantity: 3 },
    { source: "item/potion.itm", handle: "Special Potion", quantity: 2 },
  ]);
  deepEqual(consume(state, "Special Potion"), { ok: true, path: null, events: 1 });
  deepEqual(state.inventory.items.map((entry) => [entry.handle, entry.quantity]), [["Potion", 3], ["Special Potion", 1]]);
});

test("the owner refuses a named stack that is missing or empty and never falls back to another stack", () => {
  const state = ownerState([{ source: "item/potion.itm", handle: "Potion", quantity: 3 }]);
  const before = JSON.stringify(state.inventory);
  deepEqual(consume(state, "Special Potion"), { ok: false, path: "inventory.consume.entry", events: 0 });
  equal(JSON.stringify(state.inventory), before, "the canonical stack was not spent in its place");
  const empty = ownerState([{ source: "item/potion.itm", handle: "Special Potion", quantity: 0 }]);
  deepEqual(consume(empty, "Special Potion"), { ok: false, path: "inventory.items.quantity", events: 0 });
});

test("the owner refuses a handle that is neither null nor a non-empty string", () => {
  const state = ownerState([{ source: "item/potion.itm", handle: "Potion", quantity: 3 }]);
  const before = JSON.stringify(state.inventory);
  for (const handle of ["", 7, undefined]) {
    const outcome = applyInventoryAction(state, { type: "consumeBattleItem", item: "item/potion.itm", target: state.actors.actors[0]!.id, handle }, runtime);
    equal(outcome.result.ok, false);
  }
  equal(JSON.stringify(state.inventory), before);
});
