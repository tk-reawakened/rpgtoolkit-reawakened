// Per-rig program-cache isolation for the battle test rigs (PR #702 review item 6).
// The battle test files used to share one compiled-program cache across rigs, which let a definition
// compiled for one rig answer a handle lookup in another and routed the one-time compile diagnostics
// of a shared program to whichever rig compiled it first. Each rig now owns its cache; these tests
// pin that behaviour for the services every rig is built from.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TextEncoder } from "node:util";
import { test } from "node:test";
import {
  advanceScriptTick,
  assetKey,
  BATTLE_PLUGIN,
  CATALOGUE_RESPONDERS_PLUGIN,
  CATALOGUE_STUBS_PLUGIN,
  CORE_PLUGIN,
  createAssetIndex,
  createCollectingSink,
  createGameState,
  createLogger,
  createScriptServices,
  drainDiagnostics,
  fileProgramRef,
  PACKAGE_ROOT,
  startProgram,
  WORLD_PLUGIN,
  type Diagnostic,
  type GameState,
  type LogRecord,
  type ProgramLoader,
  type ScriptServices,
} from "../src/index.ts";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const files: Readonly<Record<string, string>> = {
  "main.prg": '#include "a.prg"\nr = fa()\n',
  "a.prg": '#include "b.prg"\nfunction fa() { return 1 }\n',
  "b.prg": '#include "a.prg"\nfunction fb() { return 2 }\n',
  "other.prg": "function only_in_other() { return 3 }\nx = only_in_other()\n",
};
const bytes = Object.fromEntries(Object.entries(files).map(([name, source]) => [assetKey(`Prg/${name}`), new TextEncoder().encode(source)]));
// One loader for every rig, exactly as each battle test file uses one loader for all of its rigs.
const loader: ProgramLoader = {
  index: createAssetIndex(Object.keys(bytes)),
  root: PACKAGE_ROOT,
  read: (key) => bytes[key],
};

type Rig = { readonly state: GameState; readonly services: ScriptServices; readonly records: LogRecord[] };

function rig(): Rig {
  const state = createGameState({ seed: 3 });
  const { sink, records } = createCollectingSink();
  const services = createScriptServices(
    state,
    [CORE_PLUGIN, CATALOGUE_STUBS_PLUGIN, CATALOGUE_RESPONDERS_PLUGIN, WORLD_PLUGIN, BATTLE_PLUGIN].map((definition) => ({ definition })),
    createLogger([sink]),
    undefined,
    loader,
  );
  return { state, services, records };
}

function run(target: Rig, name: string): Diagnostic[] {
  startProgram(target.state.vm, fileProgramRef(loader, name));
  advanceScriptTick(target.state, target.services);
  return drainDiagnostics(target.services);
}

const cycles = (records: readonly LogRecord[]): number => records.filter((record) => record.code === "include.cycle").length;

test("two rigs over one loader own separate program caches", () => {
  const a = rig();
  const b = rig();
  ok(a.services.programs !== b.services.programs);
  run(a, "other.prg");
  equal(a.services.programs.compiles, 1);
  equal(b.services.programs.compiles, 0);
});

test("a definition compiled in one rig is not visible to another rig's handle lookup", () => {
  const a = rig();
  const b = rig();
  run(a, "other.prg");
  equal(a.state.vm.globals.x, 3);
  equal(a.services.programs.find("only_in_other")?.functions["only_in_other"] !== undefined, true);
  equal(b.services.programs.find("only_in_other"), undefined);
});

test("a compile diagnostic is routed to its own rig, however many rigs compile the same program", () => {
  const a = rig();
  const b = rig();
  const first = run(a, "main.prg");
  deepEqual(first.map(({ code }) => code), ["include.cycle"]);
  equal(cycles(a.records), 1);
  equal(cycles(b.records), 0);

  const second = run(b, "main.prg");
  deepEqual(second.map(({ code }) => code), ["include.cycle"]);
  equal(cycles(b.records), 1);
  equal(cycles(a.records), 1);
  equal(b.services.diagnostics.length, 0);
  equal(a.services.diagnostics.length, 0);
});

test("the battle rig helpers build a fresh program cache per rig", () => {
  for (const name of ["battle-actions", "battle-ai", "battle-loop"]) {
    const source = readFileSync(join(testDirectory, `${name}.test.ts`), "utf8");
    equal(source.includes("sharedPrograms"), false, `${name}.test.ts must not share a program cache across rigs`);
  }
});
