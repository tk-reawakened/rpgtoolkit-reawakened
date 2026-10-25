import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { addActor, advanceScriptTick, BATTLE_PLUGIN, BinaryWriter, CORE_PLUGIN, createGameState, createScriptServices, startProgram, STATUS_EFFECT_MAGIC, type GameState, type WaitPoll } from "../src/index.ts";

const plugins = [{ definition: CORE_PLUGIN }, { definition: BATTLE_PLUGIN }] as const;
function stateWithStatus() {
  const state = createGameState({ seed: 3 });
  const actor = addActor(state.actors, { kind: "party", source: "hero.tem", name: "Hero", statuses: { "First.ste": 0, "Second.ste": 2 } });
  state.party.members.push(actor.id);
  return { state, actor };
}

function run(state: GameState, code: string, poll?: WaitPoll) {
  const services = createScriptServices(state, plugins);
  const thread = startProgram(state.vm, { kind: "inline", text: code, compiler: "2" });
  let status: string = "running";
  for (let i = 0; i < 20 && status !== "finished"; i += 1) status = advanceScriptTick(state, services, undefined, poll);
  return { thread, services };
}

function statusEffectBytes(): Uint8Array {
  const writer = new BinaryWriter();
  writer.str(STATUS_EFFECT_MAGIC);
  writer.i16(2); writer.i16(2); writer.str("test"); writer.i16(0);
  writer.i16(-1); writer.i16(7); writer.i16(0);
  for (let i = 0; i < 5; i += 1) writer.i16(0);
  writer.str("");
  return writer.toBytes();
}

test("getstatus lists identities in insertion order, including zero-round status", () => {
  const { state } = stateWithStatus();
  run(state, 'first = getstatus("Hero", 0)\nsecond = getstatus("Hero", 1)\nmissing = getstatus("Hero", 2)');
  equal(state.vm.globals.first, "First.ste");
  equal(state.vm.globals.second, "Second.ste");
  equal(state.vm.globals.missing, "");
});

test("getstatus rejects invalid indexes", () => {
  for (const index of ["-1", "1.5"]) {
    const { state } = stateWithStatus();
    const { services } = run(state, `x = getstatus("Hero", ${index})`);
    ok(services.diagnostics.some((item) => item.code === "builtin.bad-arg"));
  }
});

test("statusflags returns normalized file flags without actor mutations", () => {
  const { state, actor } = stateWithStatus();
  const statsBefore = JSON.stringify(actor.stats);
  const statusesBefore = JSON.stringify(actor.statuses);
  const bytes = statusEffectBytes();
  const { services } = run(state, 'flags = statusflags("test")', (_view, wait) =>
    wait.kind === "request"
      ? { value: Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join(""), ok: true }
      : null,
  );
  equal(services.diagnostics.length, 0);
  const flagValue = state.vm.globals.flags;
  ok(flagValue !== null && typeof flagValue === "object" && "handle" in flagValue);
  const dictionary = state.vm.objects.find((item) => item.handle === flagValue.handle);
  ok(dictionary);
  deepEqual(dictionary.members, { speed: 1, slow: 1, disable: 0 });
  equal(JSON.stringify(actor.stats), statsBefore);
  equal(JSON.stringify(actor.statuses), statusesBefore);
});

test("statusflags distinguishes missing, malformed reply and malformed file", () => {
  const replies: readonly { readonly ok: boolean; readonly value: string }[] = [
    { ok: false, value: "" },
    { ok: true, value: "xyz" },
    { ok: true, value: "00" },
  ];
  const expected = ["asset.missing", "request.bad-reply", "format.status-effect"];
  for (let index = 0; index < replies.length; index += 1) {
    const { state } = stateWithStatus();
    const reply = replies[index]!;
    const { services } = run(state, 'flags = statusflags("test")', (_view, wait) =>
      wait.kind === "request" ? { ok: reply.ok, value: reply.value } : null,
    );
    ok(services.diagnostics.some((item) => item.code === expected[index]));
  }
});

test("a failed status reply enters its calling function's handler and stays located", () => {
  const { state } = stateWithStatus();
  const { services } = run(state, `
function inspectStatus() {
  setErrorHandler(:missing)
  flags = statusflags("missing.ste")
  return "not reached"
  :missing
  return "caught"
}
handled = inspectStatus()
`, (_view, wait) => wait.kind === "request" ? { ok: false, value: "" } : null);
  equal(state.vm.globals.handled, "caught");
  equal(services.diagnostics.length, 1);
  equal(services.diagnostics[0]?.code, "asset.missing");
  equal(services.diagnostics[0]?.file, "<inline>");
  equal(services.diagnostics[0]?.line, 4);
});

test("a structured asset reply reports request.bad-reply and resumes the failed expression", () => {
  const { state } = stateWithStatus();
  const { services } = run(state, 'flags = statusflags("test")\ncontinued = 1',
    (_view, wait) => wait.kind === "request"
      ? { ok: true, value: { kind: "object", handle: 1, className: "Dictionary" } }
      : null);
  equal(state.vm.globals.flags, 0);
  equal(state.vm.globals.continued, 1);
  equal(services.diagnostics.length, 1);
  equal(services.diagnostics[0]?.code, "request.bad-reply");
  equal(services.diagnostics[0]?.file, "<inline>");
  equal(services.diagnostics[0]?.line, 1);
});
