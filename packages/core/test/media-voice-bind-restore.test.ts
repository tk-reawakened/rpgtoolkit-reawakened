// MEDIA-1 (docs/spec/engine/audio-media.md#media-1) and issue #825: `bind` takes
// the voice handle from a `media.play` effect's argument, and a restored save
// revalidates only that `engine.pendingEffects` is an object
// (packages/core/src/save/snapshot.ts). A held effect whose handle was freed and
// reallocated must not throw inside `findVoice`; the play itself still applies,
// and the object the handle now names is left alone.
import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { createMediaScriptService } from "../src/audio/script.ts";
import type { MediaScriptService } from "../src/audio/script.ts";
import { createAudioRuntime } from "../src/audio/runtime.ts";
import type { AudioPlayResult, AudioRuntime } from "../src/audio/runtime.ts";
import { EffectBus } from "../src/engine/effects.ts";
import { engineEffect } from "../src/engine/boot.ts";
import { createGameState, restoreGameState, snapshot, type GameState } from "../src/save/index.ts";
import { createHostObject, findObject } from "../src/script/objects.ts";
import type { EffectRecord } from "../src/script/effects.ts";
import type { PlainData } from "../src/ports/plain-data.ts";

type Hosted = {
  readonly media: MediaScriptService;
  readonly audio: AudioRuntime;
  readonly bus: EffectBus;
};

/** The applier the engine installs, minus the engine: a known length for every file and the real `bind`. */
function hosted(state: GameState): Hosted {
  const bus = new EffectBus(state);
  const media = createMediaScriptService(
    state,
    (name, args) => bus.postEffect("audio", engineEffect("audio", name, args, "draw-audio-cue")),
    () => null,
    () => undefined,
  );
  const audio = createAudioRuntime(state, {
    lookup: () => ({ kind: "known", lengthTicks: 30 }),
    bindVoice: (handle, result) => media.bind(handle, result),
    defaultSoundFont: null,
  });
  return { media, audio, bus };
}

/** A `media.play` effect record naming `handle` in its voice argument, as `script.ts` posts it. */
function heldPlay(args: readonly PlainData[], handle: number): EffectRecord {
  return {
    seq: 1,
    tick: 0,
    thread: 0,
    name: "media.play",
    kind: "draw-audio-cue",
    args: [...args.slice(0, 8), handle],
    out: {},
    result: null,
    patch: null,
    wait: null,
    request: null,
  };
}

test("a restored save whose held media.play names a reallocated handle applies the play instead of throwing", () => {
  const state = createGameState({ seed: 7 });
  // The real producer: `media.play` builds the voice record and posts the handle at argument 8.
  let posted: readonly PlainData[] | null = null;
  const producer = createMediaScriptService(state, (_name, args) => { posted = [...args]; return { seq: 1 }; }, () => null, () => undefined);
  const start = producer.play("media/ready.wav", { track: "ui", loop: false, volume: 100, priority: 0, sync: null, wait: false });
  equal(findObject(state.vm, start.record.handle)?.hostType, "media.voice");
  // The handle was freed and its number reused by a media.voice this play never bound.
  const reallocated = createHostObject(state.vm, "media.voice");
  ok(posted !== null);
  (state.engine.pendingEffects ??= {}).audio = [heldPlay(posted as readonly PlainData[], reallocated.handle)];

  // Save -> load: the object table still holds the reallocated record, and the effect keeps its handle.
  const restored = restoreGameState(snapshot(state));
  const held = (restored.engine.pendingEffects?.audio ?? [])[0];
  ok(held !== undefined, "the held media.play survives the save");
  equal(held.args[8], reallocated.handle);
  equal(findObject(restored.vm, reallocated.handle)?.hostType, "media.voice");

  const { audio, bus } = hosted(restored);
  audio.register(bus);

  equal(restored.engine.pendingEffects?.audio?.length ?? 0, 0, "the held effect applied and left the queue");
  const ui = restored.audio.tracks.find((track) => track.name === "ui");
  equal(ui?.file, "media/ready.wav", "the play itself still started on its track");
  equal(ui?.voices.filter((voice) => voice.state === "playing").length, 1);
  deepEqual(findObject(restored.vm, reallocated.handle)?.members, {}, "a record that is not the play's voice is not written to");
});

test("a play applied in its own tick keeps the applier's result and binds a complete voice", () => {
  const state = createGameState({ seed: 7 });
  const { media, audio, bus } = hosted(state);
  audio.register(bus);
  const start = media.play("media/ready.wav", { track: "ui", loop: false, volume: 100, priority: 0, sync: null, wait: false });

  equal(start.outcome.kind, "started", "the play keeps its own result");
  const record = findObject(state.vm, start.record.handle);
  ok(record !== undefined);
  equal(record.members["track"], "ui");
  ok(Number.isInteger(record.members["slot"]), "the voice names its slot");
  ok(Number.isInteger(record.members["cueId"]), "the voice names its cue");
});
