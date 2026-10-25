// Pure-RPGCode middleware under the VM-backed script host (entry 18.7; fixtures in
// `packages/core/test/fixtures/plugins/`): the libraries wrap `mwin`, `sleep` and `wait`,
// a wrapper waits for ticks and for a key, the host is saved at every tick and restored
// into a fresh host, and the restored run keeps the original's state hash tick by tick.
import { deepEqual, equal } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { TextEncoder } from "node:util";
import { fileURLToPath } from "node:url";
import {
  assetKey,
  createAssetIndex,
  fileProgramRef,
  PACKAGE_ROOT,
  type InputRecord,
  type ProgramLoader,
} from "@tk-reawakened/core";
import { checkSnapshotRestore, createScriptHost, restoreScriptHost, type ScriptHost } from "../src/index.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "core", "test", "fixtures", "plugins");

function fixtureLoader(): ProgramLoader {
  const bytes = new Map<string, Uint8Array>();
  const names = readdirSync(FIXTURES);
  for (const name of names) bytes.set(assetKey(`Prg/${name}`), new TextEncoder().encode(readFileSync(join(FIXTURES, name), "utf8")));
  return { index: createAssetIndex(names.map((name) => `Prg/${name}`)), root: PACKAGE_ROOT, read: (key) => bytes.get(key) };
}

function hostOf(boot: string, seed = 0): ScriptHost {
  const loader = fixtureLoader();
  return createScriptHost({ program: fileProgramRef(loader, boot), loader, seed });
}

function restore(json: string): ScriptHost {
  return restoreScriptHost(json, { loader: fixtureLoader() });
}

const PRESS: InputRecord = { tick: 0, event: { kind: "key", name: "A", code: "KeyA", char: "a", down: true } };
/** The key arrives on tick 5, after the first line has been shown and the gate is waiting. */
const keyOnTick = (tick: number): readonly InputRecord[] => (tick === 5 ? [PRESS] : []);

function finishedHost(host: ScriptHost): boolean {
  return host.state().vm.threads.every((thread) => thread.status === "finished");
}

function engineLines(host: ScriptHost): unknown[] {
  const lines: unknown[] = [];
  for (const effect of host.state().vm.effects) {
    if (effect.name === "mwin") lines.push(effect.args[0]);
  }
  return lines;
}

test("the four-library fixture game runs under the script host through every layer", () => {
  const host = hostOf("boot.prg");
  for (let tick = 0; tick < 12; tick += 1) equal(host.advance(1, []).diagnostics.length, 0);

  equal(finishedHost(host), true);
  deepEqual(engineLines(host), ["w:rain|a0:hello", "w:snow|a1:again"]);
  equal(host.state().vm.globals.done, 2);
});

test("the host saved at every tick restores into a fresh host that keeps the same hash tick by tick", () => {
  const total = 12;
  for (let split = 0; split <= total; split += 1) {
    const fresh = hostOf("boot.prg");
    fresh.advance(split, []);
    const restored = restore(fresh.snapshot());
    equal(restored.stateHash(), fresh.stateHash(), `split ${split}`);
    checkSnapshotRestore({ fresh, fromSnapshot: restored }, { ticks: total - split, split, inputsForTick: undefined });
    equal(restored.snapshot(), fresh.snapshot(), `split ${split} ends in the same snapshot`);
  }
});

test("two hosts built from the same seed and files run the fixture game to the same hash at every tick", () => {
  const left = hostOf("boot.prg", 3);
  const right = hostOf("boot.prg", 3);
  for (let tick = 0; tick < 12; tick += 1) {
    equal(left.advance(1, []).stateHash, right.advance(1, []).stateHash, `tick ${tick}`);
  }
  equal(left.snapshot(), right.snapshot());
});

test("a wrapper stopped on a key press: saved while it waits, the restored host takes the key and finishes the same", () => {
  const total = 10;
  const straight = hostOf("boot-keys.prg");
  for (let tick = 0; tick < total; tick += 1) straight.advance(1, keyOnTick(tick));
  equal(finishedHost(straight), true);
  deepEqual(engineLines(straight), ["press a key", "thanks"]);
  equal(straight.state().vm.globals.done, 1, "the gate counted the press once wait() came back");
  equal(straight.state().vm.globals.pressed, "A", "the key reached the game's variable through the wrapper's by-reference parameter");
  equal(straight.state().vm.globals.trace, "hud> <hud keys> <keys hud> <hud ");

  let savedWhileWaitingForKey = 0;
  for (let split = 0; split <= total; split += 1) {
    const fresh = hostOf("boot-keys.prg");
    for (let tick = 0; tick < split; tick += 1) fresh.advance(1, keyOnTick(tick));
    if (fresh.state().vm.threads.some((thread) => thread.wait?.kind === "input.key")) savedWhileWaitingForKey += 1;

    const restored = restore(fresh.snapshot());
    equal(restored.stateHash(), fresh.stateHash(), `split ${split}`);
    checkSnapshotRestore(
      { fresh, fromSnapshot: restored },
      { ticks: total - split, split, inputsForTick: keyOnTick },
    );
    equal(restored.snapshot(), straight.snapshot(), `split ${split} ends where the uninterrupted run ends`);
  }
  equal(savedWhileWaitingForKey >= 2, true, `saves landed while the gate waited (${savedWhileWaitingForKey})`);
});
test("the script host delivers cursor-map keys once and restores the selected point", () => {
  const fresh = hostOf("boot-cursormap.prg");
  fresh.state().ui.cursorMaps = [{ id: 1, points: [{ x: 10, y: 20 }, { x: 50, y: 60 }], selected: 0 }];
  fresh.state().ui.activeCursorMap = 1;
  fresh.advance(1, []);
  const initialWait = fresh.state().vm.threads[0]?.wait;
  if (initialWait?.kind !== "input.key" || initialWait.cursorMap === undefined) {
    throw new Error("expected the script to park on a cursor-map key wait");
  }
  equal(initialWait.cursorMap, 1);

  const right: InputRecord = { tick: 0, event: { kind: "key", name: "Right", code: "ArrowRight", char: null, down: true } };
  deepEqual(fresh.advance(1, [right]).consumed, [right]);
  const movedState = fresh.state();
  const movedWait = movedState.vm.threads[0]?.wait;
  if (movedWait?.kind !== "input.key") {
    throw new Error("expected the cursor-map wait to remain active");
  }
  equal(movedWait.cursorSelection, 1);
  equal(movedWait.key, null);

  fresh.advance(1, []);
  const afterIdle = fresh.state().vm.threads[0]?.wait;
  if (afterIdle?.kind !== "input.key") throw new Error("expected the cursor-map wait to remain active after an idle tick");
  equal(afterIdle.cursorSelection, 1, "the injected navigation key is not applied twice");

  const restored = restore(fresh.snapshot());
  equal(restored.stateHash(), fresh.stateHash());
  const enter: InputRecord = { tick: 0, event: { kind: "key", name: "Enter", code: "Enter", char: null, down: true } };
  fresh.advance(1, [enter]);
  restored.advance(1, [enter]);
  equal(restored.stateHash(), fresh.stateHash());
  equal(fresh.state().vm.globals.selected, 1);
  equal(fresh.state().vm.globals.done, 1);
  equal(finishedHost(fresh), true);
  equal(finishedHost(restored), true);
});
