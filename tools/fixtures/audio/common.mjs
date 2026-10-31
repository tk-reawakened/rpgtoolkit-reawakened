// Shared authoring helpers for the audio scenes (ticket 6.4). Imports nothing from packages/core.

import { LOOP, RESTART, WAIT, cuePlayer, resolve, simulate } from "./sim.mjs";

export { LOOP, RESTART, WAIT };
export const ONCE = 0;

const formatOf = (name) => (/\.mid$/i.test(name) ? "audio.midi" : /\.wav$/i.test(name) ? "audio.wav" : /\.sf[23]$/i.test(name) ? "soundfont" : "unsupported");

/**
 * A case setup. `assets` maps a Media-folder name to its length in ticks, `"unsupported"` (a file no decoder
 * accepts: unknown length) or `"soundfont"`; `{ ticks, authored }` ties a length to an authored file.
 */
export function setup({ assets = {}, videos = [], defaultSoundFont = null, registerAt = 0 } = {}) {
  const table = {};
  for (const [name, spec] of Object.entries(assets)) {
    if (spec === "unsupported") table[resolve(name)] = { format: "unsupported", lengthTicks: null };
    else if (spec === "soundfont") table[resolve(name)] = { format: "soundfont", lengthTicks: null };
    else if (typeof spec === "number") table[resolve(name)] = { format: formatOf(name), lengthTicks: spec };
    else table[resolve(name)] = { format: formatOf(name), lengthTicks: spec.ticks, authored: `files/${spec.authored}` };
  }
  return {
    defaultSoundFont: defaultSoundFont === null ? null : resolve(defaultSoundFont),
    ...(registerAt !== 0 ? { registerAt } : {}),
    assets: table,
    videos: videos.map(resolve),
  };
}

/** An effect record posted to the audio applier (Epic 4's vocabulary, 6.1 board-effect-mapping). */
export const music = (t, asset, o = {}) => ({ t, op: "effect", kind: "music.play", asset: asset === null ? null : resolve(asset), loop: o.loop ?? true, restart: o.restart ?? false, source: o.source ?? "board" });
export const sfx = (t, asset, o = {}) => ({ t, op: "effect", kind: "sfx.play", asset: resolve(asset), source: o.source ?? "frame" });
export const bank = (t, asset) => ({ t, op: "effect", kind: "soundfont.set", asset: asset === null ? null : resolve(asset), source: "script" });

/** A script command or engine input. */
export const cmd = (t, op, args = {}) => ({ t, op, ...args });
export const pre = (t, op, args = {}) => ({ t, op, at: "pre", ...args });
export const post = (t, op, args = {}) => ({ t, op, at: "post", ...args });

/**
 * Author one recorded case. The expected per-tick facts are derived by this directory's reference timeline,
 * never hand-typed and never read from `packages/core`; the test file asserts hand-worked numbers.
 */
export function makeCase(name, note, caseSetup, script, ticks, extra = {}) {
  const { rows, end, assets } = simulate(caseSetup, script, ticks);
  const doc = { name, note, setup: caseSetup, script, ticks, expect: rows, end };
  if (extra.runner !== undefined) doc.runner = runnerFacts(extra.runner, rows, assets);
  return doc;
}

/**
 * Runner-side expectations for a case (6.3 cue-player and audio-late-sounds): for a cue found in the case (or given
 * literally), what a runner that becomes ready at tick `R` does. Pure arithmetic on the cue; no device is read.
 */
function runnerFacts(specs, rows, assets) {
  return specs.map((spec) => {
    let cue = spec.cue;
    if (cue === undefined) {
      const all = rows.flatMap((r) => r.cues ?? []);
      cue = all.find((c) => Object.entries(spec.find).every(([k, v]) => c[k] === v));
      if (cue === undefined) throw new Error(`runner spec finds no cue: ${JSON.stringify(spec.find)}`);
    }
    const length = spec.length !== undefined ? spec.length : cue.asset !== null && assets[cue.asset] !== undefined ? assets[cue.asset].lengthTicks : null;
    return {
      // The whole cue: the start arithmetic reads `loop`, `positionTicks`, `volume`, `targetVolume` and `durationTicks`,
      // so a vector that committed only its identity could not pin the arithmetic it demonstrates.
      cue: { ...cue },
      lengthTicks: length,
      // The two facts the start arithmetic reads that a cue may not carry itself: a seek's voice `loop` and whether it
      // is `playing`. Committed so the vector pins the expectation instead of relying on a generator-local default.
      loop: spec.loop === undefined ? null : spec.loop,
      playing: spec.playing === undefined ? null : spec.playing,
      ready: spec.ready.map((r) => ({ at: r, ...cuePlayer(cue, r, { length, loop: spec.loop ?? cue.loop === true, playing: spec.playing }) })),
    };
  });
}
