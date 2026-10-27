// Tests of the data commands added for the default battle UI (docs/spec/engine/battle.md#bat-11):
// `battlecharacterdata` special-move availability, `battleinventory`, `battleitemdata` usable byte, `battlescreensize`.
import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TextEncoder } from "node:util";
import {
  addActor,
  assetKey,
  BATTLE_PLUGIN,
  BinaryReader,
  CATALOGUE_RESPONDERS_PLUGIN,
  CATALOGUE_STUBS_PLUGIN,
  CORE_PLUGIN,
  createAssetIndex,
  createEmptyCharacter,
  createEmptyItem,
  createGameState,
  createPluginLayers,
  createScriptServices,
  createSurfacesSection,
  defaultWaitPoll,
  fileProgramRef,
  PACKAGE_ROOT,
  registerActorObject,
  runEventsPhase,
  runPackageStartup,
  runThreadsPhase,
  runWaitsPhase,
  startProgram,
  STEP_BUDGET,
  WORLD_PLUGIN,
  writeCharacter,
  writeItem,
  type GameState,
  type ProgramLoader,
  type ResolvedPlugin,
  type Wait,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const encoder = new TextEncoder();

const unwrap = <T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const stockBattle: ResolvedPlugin = {
  namespace: "stock_battle",
  definition: { id: "stock_battle", version: "1.0.0", commands: [] },
};

function characterAsset(values: { minExp?: number; minLevel?: number; condVar?: string; condValue?: string }): Uint8Array {
  const base = createEmptyCharacter();
  const slots = base.specialMoves.map((slot, index) => {
    if (index === 0) return { file: "fire.spc", minExp: values.minExp ?? 0, minLevel: values.minLevel ?? 0, condVar: values.condVar ?? "", condValue: values.condValue ?? "" };
    if (index === 1) return { file: "heal.spc", minExp: 100, minLevel: 10, condVar: "", condValue: "" };
    return slot;
  });
  return unwrap(writeCharacter({ ...base, minor: 5, name: "Hero", movementAnimations: Array(8).fill(""), battleStances: Array(6).fill(""), specialMoves: slots, specialMoveCategory: "Magic", hasSpecialMoves: 0 }));
}

function itemAsset(battleUsable: number): Uint8Array {
  return unwrap(writeItem({
    ...createEmptyItem(),
    minor: 4,
    movementAnimations: Array(8).fill(""),
    restAnimation: "",
    reservedAnimation: "",
    customStances: [],
    name: "Potion",
    battleUsable,
    battleUseHp: 10,
    battleUseSmp: 0,
  }));
}

function runRig(programText: string, setup: (state: GameState) => void, assets: Readonly<Record<string, Uint8Array>> = {}): GameState {
  const state = createGameState({ seed: 1 });
  setup(state);
  const files: Record<string, Uint8Array> = {
    [assetKey("Prg/data-test.prg")]: encoder.encode(programText),
    ...Object.fromEntries(Object.entries(assets).map(([path, bytes]) => [assetKey(path), bytes])),
  };
  const loader: ProgramLoader = {
    index: createAssetIndex(Object.keys(files)),
    root: PACKAGE_ROOT,
    read: (key) => files[key],
  };
  const layers = createPluginLayers();
  const services = createScriptServices(
    state,
    [{ definition: CORE_PLUGIN }, { definition: CATALOGUE_STUBS_PLUGIN }, { definition: CATALOGUE_RESPONDERS_PLUGIN }, { definition: WORLD_PLUGIN }, { definition: BATTLE_PLUGIN }, stockBattle],
    undefined, undefined, loader, "default", undefined, undefined, layers,
  );
  runPackageStartup(state, services, [], [stockBattle]);
  startProgram(state.vm, { ...fileProgramRef(loader, "data-test.prg"), owner: "test" });
  const answer = (_view: unknown, wait: Wait) => {
    if (wait.kind !== "request") return defaultWaitPoll(_view as never, wait);
    const path = state.vm.effects.find((effect) => effect.request?.reqId === wait.reqId)?.request?.path;
    const name = typeof path === "string" ? path.toLowerCase() : "";
    const found = Object.entries(files).find(([k]) => k.toLowerCase().endsWith(name));
    return found === undefined ? { ok: false as const, value: null } : { ok: true as const, value: Array.from(found[1], (b) => b.toString(16).padStart(2, "0")).join("") };
  };
  for (let tick = 0; tick < 20; tick += 1) {
    runWaitsPhase(state.vm, { tick: state.time.tick, events: state.events }, answer as never, undefined, services);
    runThreadsPhase(state.vm, services, STEP_BUDGET);
    runEventsPhase(state, services, STEP_BUDGET);
    state.time.tick += 1;
    if (state.vm.globals.done === 1) return state;
  }
  throw new Error("program did not complete");
}

function readDict(state: GameState, value: unknown): unknown {
  if (typeof value === "object" && value !== null && "kind" in value && value.kind === "object" && "handle" in value && typeof value.handle === "number") {
    const record = state.vm.objects.find((object) => object.handle === value.handle);
    if (record === undefined) return null;
    return Object.fromEntries(Object.entries(record.members).map(([k, v]) => [k, readDict(state, v)]));
  }
  return value;
}

test("battlecharacterdata lists special moves and evaluates condition variable against globals", () => {
  const assets = { "Chrs/hero.tem": characterAsset({ condVar: "learned", condValue: "yes" }) };
  const program = 'data = battlecharacterdata(fighter)\ndone = 1\nend()\n';
  const state = runRig(program, (s) => {
    const actor = addActor(s.actors, { kind: "party", source: "hero.tem", stats: { experience: 0, hp: 20, maxHp: 20, smp: 10, maxSmp: 10, fp: 1, dp: 1, level: 1, criticalOn: -1, criticalBy: -1 } });
    const obj = registerActorObject(s.vm, s.events, s.actors, actor.id)!;
    s.party.members = [actor.id];
    s.battle = { id: 1, boardKey: "b", background: "bg", canRun: true, outcome: null, parties: [[], [{ party: 1, actorId: actor.id, charge: 0 }]] };
    s.vm.globals.fighter = { kind: "object", handle: obj.handle, className: obj.className };
    s.vm.globals.learned = "yes";
  }, assets);
  const data = readDict(state, state.vm.globals.data) as Record<string, unknown>;
  equal(data["specialname"], "Magic");
  equal(data["hasspecial"], 1);
  equal(data["specialcount"], 2);
  const moves = data["specialmoves"] as Record<string, Record<string, unknown>>;
  equal(moves["0"]!["file"], "fire.spc");
  equal(moves["0"]!["available"], 1, "condVar matched the global");
  equal(moves["1"]!["available"], 0, "level 1 < minLevel 10");
});

test("battleinventory returns available stacks and battleitemdata exposes usable byte", () => {
  const assets = { "Item/potion.itm": itemAsset(1), "Item/key.itm": itemAsset(0) };
  const program = 'inv = battleinventory()\npotion = battleitemdata("Item/potion.itm")\nkey = battleitemdata("Item/key.itm")\ndone = 1\nend()\n';
  const state = runRig(program, (s) => {
    s.battle = { id: 1, boardKey: "b", background: "bg", canRun: true, outcome: null, parties: [[], []] };
    s.inventory.items = [
      { id: 1, source: "Item/potion.itm", handle: "Potion", quantity: 3 },
      { id: 2, source: "Item/empty.itm", handle: "Empty", quantity: 0 },
      { id: 3, source: "Item/key.itm", handle: "Brass Key", quantity: 1 },
    ];
  }, assets);
  const inv = readDict(state, state.vm.globals.inv) as Record<string, unknown>;
  equal(inv["count"], 2, "zero-quantity stacks are omitted");
  const items = inv["items"] as Record<string, Record<string, unknown>>;
  deepEqual([items["0"]!["handle"], items["1"]!["handle"]], ["Potion", "Brass Key"]);
  const potion = readDict(state, state.vm.globals.potion) as Record<string, unknown>;
  equal(potion["usable"], 1);
  const key = readDict(state, state.vm.globals.key) as Record<string, unknown>;
  equal(key["usable"], 0);
});

test("battlescreensize reports logical pixel size with surfaces and null without", () => {
  const withScreen = runRig('size = battlescreensize()\ndone = 1\nend()\n', (s) => {
    s.battle = { id: 1, boardKey: "b", background: "bg", canRun: true, outcome: null, parties: [[], []] };
    s.surfaces = createSurfacesSection(320, 240);
  });
  deepEqual(readDict(withScreen, withScreen.vm.globals.size), { width: 320, height: 240 });
  const headless = runRig('size = battlescreensize()\ndone = 1\nend()\n', (s) => {
    s.battle = { id: 1, boardKey: "b", background: "bg", canRun: true, outcome: null, parties: [[], []] };
  });
  equal(headless.vm.globals.size, 0);
});
