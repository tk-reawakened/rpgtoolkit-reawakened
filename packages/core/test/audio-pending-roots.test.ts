// The end-of-tick root of a held `media.play` (docs/spec/engine/audio-media.md#audio-core-pins pin 4; R-34,
// entry 21.11): the applier holds a play in the engine section's pending queue while it waits for the file's
// bytes, and the `media.voice` object the play built must survive the unreferenced-object pass in the meantime.
import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { MEDIA_PLAY_VOICE_ARG, pendingAudioRoots } from "../src/audio/pending.ts";
import { collectStateGarbage } from "../src/events/dispatch.ts";
import { createGameState } from "../src/save/index.ts";
import { createHostObject, findObject, writeMember } from "../src/script/objects.ts";
import type { EffectRecord } from "../src/script/effects.ts";
import type { PlainData } from "../src/ports/plain-data.ts";

/** A `media.play` effect naming `handle` in its voice argument, as `script.ts` posts it. */
function heldPlay(handle: PlainData): EffectRecord {
  const args: PlainData[] = new Array<PlainData>(MEDIA_PLAY_VOICE_ARG + 1).fill(null);
  args[MEDIA_PLAY_VOICE_ARG] = handle;
  return {
    seq: 1,
    tick: 0,
    thread: 0,
    name: "media.play",
    kind: "draw-audio-cue",
    args,
    out: {},
    result: null,
    patch: null,
    wait: null,
    request: null,
  };
}

test("a held media.play keeps its media.voice object across the end-of-tick pass", () => {
  const state = createGameState({ seed: 3 });
  const voice = createHostObject(state.vm, "media.voice");
  writeMember(voice, "track", "ui");
  (state.engine.pendingEffects ??= {}).audio = [heldPlay(voice.handle)];

  deepEqual(pendingAudioRoots(state), [{ kind: "object", handle: voice.handle, className: voice.className }]);

  collectStateGarbage(state);
  ok(findObject(state.vm, voice.handle) === voice, "the held play's voice survives the pass");

  // The effect applied and left the queue: nothing names the voice, so the next pass frees it.
  (state.engine.pendingEffects).audio = [];
  collectStateGarbage(state);
  equal(findObject(state.vm, voice.handle), undefined, "an applied play leaves no root");
});

test("a held play whose argument names something else contributes no root", () => {
  const state = createGameState({ seed: 3 });
  const track = createHostObject(state.vm, "media.track");
  (state.engine.pendingEffects ??= {}).audio = [heldPlay(track.handle)];

  deepEqual(pendingAudioRoots(state), [], "only a media.voice record is rooted");

  collectStateGarbage(state);
  equal(findObject(state.vm, track.handle), undefined, "the pass frees the record the play did not build");
});
