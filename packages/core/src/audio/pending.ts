/**
 * The held `media.play` effects: where their script voice handle sits in the
 * effect arguments, and the objects the end-of-tick pass must keep alive for
 * them (docs/spec/engine/audio-media.md#audio-core-pins pin 4; R-34 in
 * docs/spec/engine/rpgcode-modules-and-objects.md, entry 21.11).
 *
 * The applier holds a play, and every later `audio` effect, in the engine
 * section's pending queue until the file's bytes are known. The play's voice
 * object is script data, not part of the effect's plain arguments, so the
 * ordinary roots do not name it: this module is the one place that knows the
 * argument index and turns a held effect into that root. The producer
 * (`script.ts`), the consumer (`runtime.ts`) and the end-of-tick pass
 * (`events/dispatch.ts`) all use it, so the index exists once.
 */

import { findObject } from "../script/objects.ts";
import type { Value } from "../ports/value.ts";
import type { GameState } from "../save/state.ts";

/** The index of the script voice handle in a `media.play` effect's arguments (MEDIA-1). */
export const MEDIA_PLAY_VOICE_ARG = 8;

/**
 * The `media.voice` records named by the engine section's held `media.play`
 * effects, as roots for the end-of-tick unreferenced-object pass (R-34): a play
 * that is still waiting for its asset keeps the voice the reply will bind.
 */
export function pendingAudioRoots(state: Pick<GameState, "vm" | "engine">): readonly Value[] {
  const roots: Value[] = [];
  for (const effect of state.engine.pendingEffects?.audio ?? []) {
    if (effect.name.toLowerCase() !== "media.play") continue;
    const handle = effect.args[MEDIA_PLAY_VOICE_ARG];
    const record = typeof handle === "number" ? findObject(state.vm, handle) : undefined;
    if (record?.hostType === "media.voice") roots.push({ kind: "object", handle: record.handle, className: record.className });
  }
  return roots;
}
