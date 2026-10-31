import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import {
  advanceScriptTick,
  BATTLE_PLUGIN,
  CORE_PLUGIN,
  CATALOGUE_PLUGIN,
  CATALOGUE_RESPONDERS_PLUGIN,
  createGameState,
  createWaitPoll,
  hashState,
  replyToRequest,
  restoreGameState,
  snapshot,
  startProgram,
  WAIT_KIND_RESOLVERS,
  type BuiltinSpec,
  type GameState,
  type WaitKindResolver,
} from "../src/index.ts";
import { advanceOrFail } from "./script-failures.ts";
import { createScriptServices } from "./script-test-services.ts";

const COMMANDS: readonly BuiltinSpec[] = CATALOGUE_RESPONDERS_PLUGIN.commands;

const BATTLE_FACING_NAMES = [
  "hp", "givehp", "gethp", "maxhp", "getmaxhp", "smp", "givesmp", "getsmp", "maxsmp", "getmaxsmp",
  "fp", "givefp", "getfp", "dp", "getdp", "applystatus", "removestatus", "giveexp",
] as const;

const CORE_PURE_NAMES = ["run", "change", "rpgcode", "delay", "done", "stop", "branch", "fbranch"] as const;

function callText(spec: BuiltinSpec): string {
  if (spec.name === "branch" || spec.name === "fbranch") return `${spec.name}(:target)\n:target\n`;
  const count = spec.params.some((param) => param.variadic) ? spec.params.length + 1 : spec.params.length;
  const declarations: string[] = [];
  const args: string[] = [];
  for (let index = 0; index < count; index += 1) {
    if (spec.params[index]?.byRef === true) {
      declarations.push(`v${index} = 5`);
      args.push(`v${index}`);
    } else {
      args.push("1");
    }
  }
  return `${declarations.length > 0 ? `${declarations.join("\n")}\n` : ""}${spec.name}(${args.join(", ")})\n`;
}

function run(text: string): GameState {
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, { kind: "inline", text, ir: "1" });
  advanceOrFail(state, createScriptServices(state, [CATALOGUE_RESPONDERS_PLUGIN]));
  return state;
}

function resolver(kind: string): WaitKindResolver {
  return { kind, poll: (_view, wait) => ({ value: wait.kind, ok: true }) };
}

const pluginWaitPoll = createWaitPoll([
  ...WAIT_KIND_RESOLVERS,
  resolver("render.msgbox"),
  resolver("input.mouse"),
  resolver("menu.screen"),
]);

test("all non-core catalogue responders have a lower-case command and a recorded response", () => {
  equal(COMMANDS.length, 94);
  equal(new Set(COMMANDS.map((spec) => spec.name)).size, COMMANDS.length);
  for (const spec of COMMANDS) {
    equal(spec.name, spec.name.toLowerCase());
    const state = createGameState({ seed: 0 });
    startProgram(state.vm, { kind: "inline", text: callText(spec), ir: "1" });
    if (["godos", "sound", "start", "win"].includes(spec.name)) {
      throws(() => advanceOrFail(state, createScriptServices(state, [CATALOGUE_RESPONDERS_PLUGIN])), /obsolete/);
      equal(state.vm.effects.length, 0);
      continue;
    }
    advanceOrFail(state, createScriptServices(state, [CATALOGUE_RESPONDERS_PLUGIN]));
    equal(state.vm.effects.length > 0, true, `${spec.name} did not record an effect`);
  }
});

test("battle-facing built-ins have one registration path", () => {
  for (const name of BATTLE_FACING_NAMES) {
    equal(BATTLE_PLUGIN.commands.filter((command) => command.name === name).length, 1, `${name} in battle pack`);
    equal(CATALOGUE_PLUGIN.commands.some((command) => command.name === name), false, `${name} absent from catalogue plugin`);
    equal(CATALOGUE_RESPONDERS_PLUGIN.commands.some((command) => command.name === name), false, `${name} absent from responders`);
  }
});

test("core pure commands are not duplicated in the default catalogue layer", () => {
  for (const name of CORE_PURE_NAMES) {
    equal(CORE_PLUGIN.commands.some((command) => command.name === name || command.aliases.includes(name)), true, `${name} remains in core`);
    equal(CATALOGUE_PLUGIN.commands.some((command) => command.name === name || command.aliases.includes(name)), false, `${name} is not duplicated by catalogue`);
  }
});

test("a named wait is global, records its wait, and resumes by-reference outputs", () => {
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, { kind: "inline", text: 'prompt("Question", answer)\n', ir: "1" });
  advanceOrFail(state, createScriptServices(state, [CATALOGUE_RESPONDERS_PLUGIN]));

  const thread = state.vm.threads[0]!;
  equal(thread.status, "waiting");
  equal(thread.wait?.kind, "render.msgbox");
  equal(thread.wait?.global, true);
  equal(state.vm.effects.some((effect) => effect.wait?.kind === "render.msgbox"), true);
  const restored = restoreGameState(snapshot(state));
  equal(hashState(state), hashState(restored));

  advanceScriptTick(state, createScriptServices(state, [CATALOGUE_RESPONDERS_PLUGIN]), undefined, pluginWaitPoll);
  equal(state.vm.globals.answer, "render.msgbox");
  equal(state.vm.threads[0]?.status, "finished");
});

test("file responders emit host requests and resume with the reply", () => {
  const state = run('result = openFileInput("save.dat", "games")\n');
  const request = state.vm.effects.find((effect) => effect.request !== null);
  equal(request?.request?.kind, "asset");
  equal(state.vm.threads[0]?.wait?.kind, "request");
  const reqId = state.vm.threads[0]?.wait?.kind === "request" ? state.vm.threads[0].wait.reqId : 0;
  replyToRequest(state.vm, reqId, { ok: true, value: 7 });
  advanceScriptTick(state, createScriptServices(state, [CATALOGUE_RESPONDERS_PLUGIN]));
  equal(state.vm.globals.result, 7);
  equal(state.vm.effects.some((effect) => effect.kind === "request"), true);
});

test("mixed movement commands record their effect before waiting", () => {
  const state = run("playerStep(1, 2, 3)\n");
  equal(state.vm.threads[0]?.wait?.kind, "movement");
  equal(state.vm.effects.some((effect) => effect.kind === "mixed"), true);
  equal(state.vm.effects.some((effect) => effect.wait?.kind === "movement"), true);
});

test("responder snapshots remain deterministic while a wait is pending", () => {
  const state = run('msgbox("hello")\n');
  const first = hashState(state);
  const replay = snapshot(state);
  deepEqual(snapshot(state), replay);
  equal(hashState(state), first);
  equal(hashState(restoreGameState(replay)), first);
});
