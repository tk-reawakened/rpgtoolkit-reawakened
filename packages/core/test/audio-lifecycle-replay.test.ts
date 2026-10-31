// #482: real script listeners, runtime transitions and saved dispatch, restored at every tick.
import { test } from "node:test";
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import {
  assetKey, createGameState, createAudioRuntime, hashGameState, registerEmitter, queueAudioEvent,
  restoreGameState, snapshot, startProgram, runWaitsPhase, runThreadsPhase, runEventsPhase,
  verifyRestoredHandles, type GameState, type ScriptServices, type AudioRuntime,
} from "../src/index.ts";
import { createScriptServices } from "./script-test-services.ts";

const file = assetKey("media/replay.wav");
const names = ["started", "stopped", "ended", "looped", "paused", "resumed", "faded"];
type Session = { services: ScriptServices; runtime: AudioRuntime };
function session(state: GameState): Session {
  const services = createScriptServices(state);
  const runtime = createAudioRuntime(state, { lookup: () => ({ kind: "known", lengthTicks: 4 }), transition: (event) => queueAudioEvent(state, event) });
  verifyRestoredHandles(state.vm, services, state.events);
  return { services, runtime };
}
function tick(state: GameState, current: Session) {
  const { runtime, services } = current;
  runWaitsPhase(state.vm, { tick: state.time.tick, events: state.events });
  runThreadsPhase(state.vm, services, 1000);
  runEventsPhase(state, services, 1000);
  // Authored deterministic host actions, following threads/events and before audio.
  switch (state.time.tick) {
    case 1: runtime.play({ track: "sfx", asset: file, loop: true }); break;
    case 2: runtime.fade("sfx", 20, 3, 0); break;
    case 3: runtime.pause("sfx"); break;
    case 5: runtime.resume("sfx"); break;
    case 9: runtime.stop("sfx"); break;
    case 10: runtime.play({ track: "sfx", asset: file, loop: false }); break;
  }
  runtime.phase();
  runtime.drain();
  state.time.tick += 1;
}

test("every-tick snapshot restores queued/in-flight lifecycle history and all subsequent hashes without duplicates", () => {
  const straight = createGameState({ seed: 41 });
  const media = registerEmitter(straight.vm, straight.events, "media");
  straight.vm.globals.media = { kind: "object", handle: media.handle, className: media.className };
  const listeners = names.map((name) => `media.on("${name}", (e) => { threadSleep(getThreadId(), 0.05); history = history + e.type + ":" + e.detail.tick + ";" })`).join("\n");
  startProgram(straight.vm, { kind: "inline", ir: "1", text: `history = ""\n${listeners}\n` });
  const running = session(straight);
  const saves: string[] = [];
  const hashes: string[] = [];
  const histories: unknown[] = [];
  let queued = 0;
  let dispatching = 0;
  for (let i = 0; i < 55; i += 1) {
    tick(straight, running);
    saves.push(snapshot(straight));
    hashes.push(hashGameState(straight));
    histories.push(straight.vm.globals.history);
    if (straight.events.queue.length > 0) queued += 1;
    if (straight.events.dispatch !== null) dispatching += 1;
  }
  ok(queued > 0, "saves must actually contain pending notifications");
  ok(dispatching > 0, "saves must actually contain an in-flight waiting listener");
  const history = String(straight.vm.globals.history);
  for (const name of names) ok(history.includes(`${name}:`), `${name} was actually delivered`);
  equal(straight.events.queue.length, 0);
  equal(straight.events.dispatch, null);
  for (let saved = 0; saved < saves.length; saved += 1) {
    const restored = restoreGameState(saves[saved]!);
    equal(hashGameState(restored), hashes[saved]);
    const fresh = session(restored);
    for (let next = saved + 1; next < saves.length; next += 1) {
      tick(restored, fresh);
      equal(hashGameState(restored), hashes[next], `save ${saved}, tick ${next}: entire core hash`);
      deepEqual(restored.vm.globals.history, histories[next], `save ${saved}, tick ${next}: delivered history`);
    }
    equal(restored.vm.globals.history, history, `save ${saved}: no lost or duplicated notification`);
  }
});

test("a snapshot within an exact one-tick wrap preserves its dedupe cursor, including a loop-setting step", () => {
  const state = createGameState({ seed: 1 });
  const history: string[] = [];
  const makeRuntime = (host: GameState, seen: string[]) => createAudioRuntime(host, {
    lookup: () => ({ kind: "known", lengthTicks: 1 }),
    transition: (event) => seen.push(`${event.type}:${event.detail.tick}`),
  });
  const runtime = makeRuntime(state, history);
  runtime.play({ track: "sfx", asset: file, loop: true });
  state.time.tick = 1;
  runtime.phase();
  deepEqual(history, ["started:0", "looped:1"]);
  const restored = restoreGameState(snapshot(state));
  const replay: string[] = [];
  const fresh = makeRuntime(restored, replay);
  fresh.phase();
  deepEqual(replay, [], "already observed boundary cannot replay on same-tick restore");
  runtime.setLoop("sfx", true);
  state.time.tick = 2;
  restored.time.tick = 2;
  runtime.phase();
  fresh.phase();
  deepEqual(replay, ["looped:2"]);
  state.time.tick = 3;
  runtime.setLoop("sfx", true);
  const afterFlag = restoreGameState(snapshot(state));
  const flagHistory: string[] = [];
  makeRuntime(afterFlag, flagHistory).phase();
  deepEqual(flagHistory, [], "setting loop at a boundary must not become a synthetic wrap after restore");
});

test("snapshot decoding refuses malformed audio event cursor maps", () => {
  const state = createGameState({ seed: 1 });
  for (const audioPasses of [{ "2": -1 }, { "2": 0.5 }, { "bad": 1 }, { "02": 1 }]) {
    const raw = JSON.parse(snapshot(state));
    raw.events.audioPasses = audioPasses;
    throws(() => restoreGameState(JSON.stringify(raw)), /events\.audioPasses/);
  }
});
