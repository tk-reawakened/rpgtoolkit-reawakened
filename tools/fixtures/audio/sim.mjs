// Reference audio timeline for the audio oracle (ticket 6.4). Imports nothing from packages/core.
//
// A second, independent statement of the rules in docs/spec/engine/audio-media.md, written for
// one purpose: to derive the expected per-tick facts of the oracle scenes. It is plain integer
// arithmetic (no floating point beyond `Math.floor` of whole-number quotients), no clock and no
// random source. Where the specification is silent the choice made here is a numbered "proposed
// ruling" (`P-n`, listed in index.mjs); anything the specification does not rule and no scene
// needs is a hard error (`unruled`) so a scene cannot lean on an invented behaviour by accident.
//
// Tick pipeline per tick (AD-26): the registration/load/video inputs that arrive between ticks,
// then `waits` (every parked thread, ascending thread id), then the scene's operations in listed
// order (the `threads`, `animation` and `battle` phases: each applies synchronously), then the
// `audio` phase (fade completion, one-shot end), then the row is sampled, then `time` advances.

export const LOOP = 1;
export const WAIT = 2;
export const RESTART = 4;
export const LATE_TICKS = 15;
export const MAX_TRACKS = 16;
export const MAX_VOICES = 32;
export const BUILTIN = [["music", 1], ["sfx", 1], ["ambience", 4], ["voice", 2], ["ui", 4]];

const lower = (text) => text.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

/** The package-relative, case-folded asset key of a bare Media-folder name (Q18). */
export const resolve = (name) => `media/${lower(name)}`;

/** Seconds, given as whole milliseconds, to ticks: `max(0, floor(seconds * 60 + 1/2))` exactly. */
export const ticksFromMs = (ms) => Math.floor((ms * 60 + 500) / 1000);

/** The linear fade of 6.2 P7: nearest integer, halves rounded up, `d` clamped to `0..dur`. */
export function fadeValue(from, to, dur, elapsed) {
  if (dur <= 0) return to;
  const d = Math.min(Math.max(elapsed, 0), dur);
  const num = from * dur + (to - from) * d;
  return Math.floor((2 * num + dur) / (2 * dur));
}

const unruled = (what) => {
  throw new Error(`unruled: ${what}`);
};

const fadeTuple = (f) => (f === null ? null : [f.from, f.to, f.start, f.dur]);

function newTrack(name, configured) {
  return { name, configured, flags: 0, file: null, voices: [], bus: 100, busFade: null };
}

function makeState(setup) {
  const assets = {};
  for (const [key, spec] of Object.entries(setup.assets ?? {})) assets[key] = spec;
  return {
    tick: 0,
    cueId: 1,
    soundFont: null,
    defaultSoundFont: setup.defaultSoundFont ?? null,
    tracks: BUILTIN.map(([name, voices]) => newTrack(name, voices)),
    master: 100,
    waits: [],
    cues: [],
    ev: [],
    registered: false,
    pending: [],
    video: null,
    videoDone: new Set(),
    nextReq: 1,
    saves: {},
    assets,
    videos: new Set(setup.videos ?? []),
    cfgDirty: true,
  };
}

const trackOf = (st, name) => st.tracks.find((t) => t.name === lower(name));
const primary = (t) => t.voices.find((v) => v.index === 0);
const trackState = (t) => (t.voices.length === 0 ? "stopped" : t.voices.some((v) => v.state === "playing") ? "playing" : "paused");

function emit(st, kind, f = {}) {
  const cue = {
    cueId: st.cueId,
    tick: f.tick ?? st.tick,
    kind,
    track: f.track ?? null,
    voice: f.voice ?? null,
    asset: f.asset ?? null,
    loop: f.loop ?? null,
    flags: f.flags ?? null,
    positionTicks: f.positionTicks ?? null,
    volume: f.volume ?? null,
    targetVolume: f.targetVolume ?? null,
    durationTicks: f.durationTicks ?? null,
  };
  st.cueId += 1;
  st.cues.push(cue);
  return cue.cueId;
}

const diag = (st, code, op, detail = {}) => {
  st.ev.push({ e: "diag", code, op, ...detail });
};

const posOf = (v, tick) =>
  v.state === "paused" ? v.heldPos : v.length === null ? tick - v.startTick : v.loop ? (tick - v.startTick) % v.length : Math.min(tick - v.startTick, v.length);

const fadeElapsed = (v, tick) => (v.state === "paused" ? Math.max(0, v.pausedAt - v.fade.start) : tick - v.fade.start);
const volOf = (v, tick) => (v.fade === null ? v.volume : fadeValue(v.fade.from, v.fade.to, v.fade.dur, fadeElapsed(v, tick)));
const busOf = (t, tick) => (t.busFade === null ? t.bus : fadeValue(t.busFade.from, t.busFade.to, t.busFade.dur, tick - t.busFade.start));

function stopVoice(st, tr, v) {
  emit(st, "media.stop", { track: tr.name, voice: v.index });
  tr.voices = tr.voices.filter((x) => x !== v);
}

function addWait(st, tr, v, thread, pass) {
  const w = {
    kind: "audio.track",
    thread,
    track: tr.name,
    voice: v.index,
    cueId: v.cueId,
    endTick: v.endTick,
    pass,
    pass0: pass ? Math.floor((st.tick - v.startTick) / v.length) : null,
  };
  st.waits.push(w);
  st.ev.push({ e: "wait", thread, track: tr.name, voice: v.index, cueId: v.cueId, endTick: v.endTick, pass });
}

/** Start (or carry on / ignore) one voice. Returns the voice, or null when no voice was started. */
function startVoice(st, tr, key, o) {
  const spec = st.assets[key];
  const length = spec.lengthTicks ?? null;
  let index;
  if (tr.configured === 1) {
    const cur = tr.voices[0];
    if (cur !== undefined && cur.file === key) {
      if (cur.state === "paused") unruled("a same-file play on a paused single-voice track");
      if (!o.restart) {
        st.ev.push({ e: "same-file", track: tr.name, file: key, action: tr.name === "music" ? "carry-on" : "ignored" });
        return null;
      }
    }
    if (cur !== undefined) stopVoice(st, tr, cur);
    index = 0;
  } else {
    const taken = new Set(tr.voices.map((v) => v.index));
    index = 0;
    while (index < tr.configured && taken.has(index)) index += 1;
    if (index >= tr.configured) {
      const victim = [...tr.voices].sort((a, b) => a.priority - b.priority || a.startTick - b.startTick || a.index - b.index)[0];
      st.ev.push({ e: "steal", track: tr.name, voice: victim.index, cueId: victim.cueId });
      stopVoice(st, tr, victim);
      index = victim.index;
    }
  }
  const pos0 = o.pos0 ?? 0;
  const v = {
    index,
    state: "playing",
    file: key,
    cueId: 0,
    priority: o.priority ?? 0,
    volume: 100,
    startTick: st.tick - pos0,
    endTick: null,
    length,
    loop: o.loop,
    fade: null,
    pausedAt: null,
    heldPos: null,
  };
  v.endTick = length !== null && !o.loop ? v.startTick + length : null;
  v.cueId = emit(st, "media.play", { track: tr.name, voice: index, asset: key, loop: o.loop, flags: o.loop ? LOOP : 0, positionTicks: pos0, volume: 100 });
  tr.voices.push(v);
  tr.voices.sort((a, b) => a.index - b.index);
  tr.file = key;
  if (index === 0) tr.flags = o.loop ? LOOP : 0;
  if (spec.format === "unsupported") diag(st, "media.asset-format", o.op ?? "play", { file: key });
  return v;
}

function requireAsset(st, key) {
  if (st.assets[key] === undefined) throw new Error(`effect names an asset the setup does not declare: ${key}`);
}

/** The audio applier: one effect record becomes state and cues (6.1 board-effect-mapping, 6.3 B2). */
function applyEffect(st, eff) {
  if (eff.kind === "music.play") {
    const tr = trackOf(st, "music");
    if (eff.asset === null) {
      const cur = tr.voices[0];
      if (cur !== undefined) stopVoice(st, tr, cur);
      tr.file = null;
      st.ev.push({ e: "silence", track: "music", source: eff.source });
      return;
    }
    requireAsset(st, eff.asset);
    startVoice(st, tr, eff.asset, { loop: eff.loop ?? true, restart: eff.restart === true, op: "music.play" });
  } else if (eff.kind === "sfx.play") {
    requireAsset(st, eff.asset);
    const tr = trackOf(st, eff.source === "ui" ? "ui" : "sfx");
    startVoice(st, tr, eff.asset, { loop: false, restart: eff.restart === true, op: "sfx.play" });
  } else if (eff.kind === "soundfont.set") {
    st.soundFont = eff.asset;
    emit(st, "soundfont.set", { asset: st.soundFont ?? st.defaultSoundFont });
  } else {
    throw new Error(`unknown effect ${eff.kind}`);
  }
}

function post(st, eff) {
  if (!st.registered) st.pending.push(eff);
  else applyEffect(st, eff);
}

function register(st) {
  st.registered = true;
  emit(st, "soundfont.set", { asset: st.soundFont ?? st.defaultSoundFont });
  for (const eff of st.pending) applyEffect(st, eff);
  st.pending = [];
}

const MEDIA_NAME = /^[A-Za-z0-9_.-]{1,32}$/;

function checkTrackAndVoice(st, op, name, voice) {
  const tr = trackOf(st, name);
  if (tr === undefined) {
    diag(st, "media.unknown-track", op, { track: name });
    return null;
  }
  const index = voice ?? 0;
  if (!Number.isInteger(index) || index < 0 || index >= tr.configured) {
    diag(st, "media.unknown-voice", op, { track: tr.name, voice: index });
    return null;
  }
  return { tr, index, v: tr.voices.find((x) => x.index === index) };
}

const noop = (st, op, tr) => st.ev.push({ e: "no-op", op, track: tr.name });

/** The legacy names of 6.2 (`legacy-audio-command-mapping`) as standard calls. */
function legacy(st, op) {
  const name = lower(op.name);
  const file = op.file;
  let std;
  if (name === "midiplay" || name === "playmidi" || name === "mediaplay") std = { op: "mediaPlay", file, track: "music", flags: LOOP, as: `mediaPlay(file, { track: "music", loop: true })` };
  else if (name === "mediastop" || name === "mediarest" || name === "midirest") std = { op: "mediaStop", track: "music", as: `mediaStop("music")` };
  else if (name === "wav" || name === "mp3") std = { op: "mediaPlay", file, track: "sfx", flags: 0, as: `mediaPlay(file, { track: "sfx", loop: false })` };
  else if (name === "wavstop") std = { op: "mediaStop", track: "sfx", as: `mediaStop("sfx")` };
  else if (name === "mp3pause") std = { op: "mediaPlay", file, track: "sfx", flags: WAIT, thread: op.thread, as: `mediaPlay(file, { track: "sfx", loop: false, wait: true })` };
  else if (name === "setvolume") std = { op: "setvolume", percent: op.percent, as: "master script volume" };
  else throw new Error(`unknown legacy name ${op.name}`);
  st.ev.push({ e: "legacy", name: op.name, as: std.as });
  const { as, ...call } = std;
  command(st, call);
}

function command(st, op) {
  switch (op.op) {
    case "legacy":
      return legacy(st, op);
    case "mediaTrack": {
      const name = op.name;
      if (!MEDIA_NAME.test(name)) return diag(st, "media.invalid-track-name", op.op, { name });
      const voices = op.voices ?? 1;
      if (!Number.isInteger(voices) || voices < 1) return diag(st, "media.voice-count", op.op, { name, voices });
      const existing = trackOf(st, name);
      const sum = st.tracks.reduce((s, t) => s + t.configured, 0) - (existing?.configured ?? 0) + voices;
      if (existing !== undefined) {
        if (existing.voices.some((v) => v.index >= voices)) return diag(st, "media.voice-count", op.op, { name: existing.name, voices });
        if (sum > MAX_VOICES) return diag(st, "media.voice-cap", op.op, { name: existing.name, voices });
        existing.configured = voices;
      } else {
        if (st.tracks.length >= MAX_TRACKS) return diag(st, "media.track-limit", op.op, { name });
        if (sum > MAX_VOICES) return diag(st, "media.voice-cap", op.op, { name, voices });
        st.tracks.push(newTrack(lower(name), voices));
      }
      st.cfgDirty = true;
      st.ev.push({ e: "track", name: lower(name), voices });
      return undefined;
    }
    case "mediaPlay": {
      const tr = trackOf(st, op.track ?? "music");
      if (tr === undefined) return diag(st, "media.unknown-track", op.op, { track: op.track });
      const key = resolve(op.file);
      if (st.assets[key] === undefined) return diag(st, "media.asset-missing", op.op, { file: key });
      const flags = op.flags ?? (tr.name === "music" ? LOOP : 0);
      const loop = (flags & LOOP) !== 0;
      const wait = (flags & WAIT) !== 0;
      if (loop && wait) return diag(st, "media.wait-loop", op.op, { track: tr.name });
      let pos0 = 0;
      if (op.sync !== undefined && op.sync !== "") {
        const src = trackOf(st, op.sync);
        const sv = src === undefined ? undefined : primary(src);
        const dest = st.assets[key].lengthTicks ?? null;
        if (sv === undefined || sv.length === null || dest === null) {
          diag(st, "media.sync-source", op.op, { sync: op.sync });
          pos0 = 0;
        } else {
          pos0 = posOf(sv, st.tick) % dest;
        }
      }
      const v = startVoice(st, tr, key, { loop, restart: (flags & RESTART) !== 0, priority: op.priority ?? 0, pos0, op: op.op });
      if (v !== null && wait) {
        if (v.length === null) diag(st, "media.asset-length", op.op, { track: tr.name, voice: v.index });
        else addWait(st, tr, v, op.thread, false);
      }
      return undefined;
    }
    case "mediaStop": {
      const r = checkTrackAndVoice(st, op.op, op.track ?? "music", op.voice);
      if (r === null) return undefined;
      if (r.v === undefined) return noop(st, op.op, r.tr);
      stopVoice(st, r.tr, r.v);
      return undefined;
    }
    case "mediaPause": {
      const r = checkTrackAndVoice(st, op.op, op.track ?? "music", op.voice);
      if (r === null) return undefined;
      if (r.v === undefined || r.v.state !== "playing") return noop(st, op.op, r.tr);
      if (r.tr.busFade !== null) unruled("pausing a track whose bus fade is running");
      r.v.heldPos = posOf(r.v, st.tick);
      r.v.pausedAt = st.tick;
      r.v.state = "paused";
      emit(st, "media.pause", { track: r.tr.name, voice: r.index });
      return undefined;
    }
    case "mediaResume": {
      const r = checkTrackAndVoice(st, op.op, op.track ?? "music", op.voice);
      if (r === null) return undefined;
      if (r.v === undefined || r.v.state !== "paused") return noop(st, op.op, r.tr);
      const v = r.v;
      const span = st.tick - v.pausedAt;
      v.startTick += span;
      if (v.endTick !== null) v.endTick += span;
      if (v.fade !== null) v.fade.start += st.tick - Math.max(v.pausedAt, v.fade.start);
      v.state = "playing";
      v.pausedAt = null;
      v.heldPos = null;
      emit(st, "media.resume", { track: r.tr.name, voice: r.index });
      return undefined;
    }
    case "mediaSeek": {
      const r = checkTrackAndVoice(st, op.op, op.track, op.voice);
      if (r === null) return undefined;
      if (!Number.isInteger(op.ms) || op.ms < 0) return diag(st, "media.invalid-time", op.op, { ms: op.ms });
      if (r.v === undefined) return diag(st, "media.unknown-voice", op.op, { track: r.tr.name, voice: r.index });
      const v = r.v;
      if (v.length === null) return diag(st, "media.asset-length", op.op, { track: r.tr.name, voice: r.index });
      const want = ticksFromMs(op.ms);
      const pos = v.loop ? want % v.length : Math.min(want, v.length);
      const now = v.state === "paused" ? v.pausedAt : st.tick;
      v.startTick = now - pos;
      if (v.state === "paused") v.heldPos = pos;
      v.endTick = v.loop ? null : v.startTick + v.length;
      emit(st, "media.seek", { track: r.tr.name, voice: r.index, positionTicks: pos });
      return undefined;
    }
    case "mediaLoop": {
      const r = checkTrackAndVoice(st, op.op, op.track, op.voice);
      if (r === null) return undefined;
      if (r.v === undefined) unruled("mediaLoop on a voice that is not active");
      const v = r.v;
      v.loop = op.on;
      if (v.length !== null) {
        if (op.on) v.endTick = null;
        else {
          const now = v.state === "paused" ? v.pausedAt : st.tick;
          v.endTick = v.startTick + (Math.floor((now - v.startTick) / v.length) + 1) * v.length;
        }
      }
      if (r.index === 0) r.tr.flags = op.on ? LOOP : 0;
      emit(st, "media.flags", { track: r.tr.name, voice: r.index, loop: op.on, flags: op.on ? LOOP : 0 });
      return undefined;
    }
    case "mediaFade": {
      const tr = trackOf(st, op.track);
      if (tr === undefined) return diag(st, "media.unknown-track", op.op, { track: op.track });
      if (!Number.isInteger(op.percent) || op.percent < 0 || op.percent > 100) return diag(st, "media.invalid-volume", op.op, { percent: op.percent });
      if (!Number.isInteger(op.ms) || op.ms < 0) return diag(st, "media.invalid-time", op.op, { ms: op.ms });
      const dur = ticksFromMs(op.ms);
      if (op.voice === undefined) {
        const from = busOf(tr, st.tick);
        tr.bus = dur === 0 ? op.percent : from;
        tr.busFade = dur === 0 ? null : { from, to: op.percent, start: st.tick, dur };
        emit(st, "media.fade", { track: tr.name, volume: from, targetVolume: op.percent, durationTicks: dur });
        return undefined;
      }
      const r = checkTrackAndVoice(st, op.op, op.track, op.voice);
      if (r === null) return undefined;
      if (r.v === undefined) return diag(st, "media.unknown-voice", op.op, { track: tr.name, voice: r.index });
      const from = volOf(r.v, st.tick);
      if (dur === 0) {
        r.v.volume = op.percent;
        r.v.fade = null;
      } else {
        r.v.volume = from;
        r.v.fade = { from, to: op.percent, start: st.tick, dur };
      }
      emit(st, "media.fade", { track: tr.name, voice: r.index, volume: from, targetVolume: op.percent, durationTicks: dur });
      return undefined;
    }
    case "mediaVolume": {
      const tr = trackOf(st, op.track);
      if (tr === undefined) return diag(st, "media.unknown-track", op.op, { track: op.track });
      if (!Number.isInteger(op.percent) || op.percent < 0 || op.percent > 100) return diag(st, "media.invalid-volume", op.op, { percent: op.percent });
      if (op.voice === undefined) {
        tr.bus = op.percent;
        tr.busFade = null;
        emit(st, "media.volume", { track: tr.name, volume: op.percent });
        return undefined;
      }
      const r = checkTrackAndVoice(st, op.op, op.track, op.voice);
      if (r === null) return undefined;
      if (r.v === undefined) return diag(st, "media.unknown-voice", op.op, { track: tr.name, voice: r.index });
      r.v.volume = op.percent;
      r.v.fade = null;
      emit(st, "media.volume", { track: tr.name, voice: r.index, volume: op.percent });
      return undefined;
    }
    case "setvolume": {
      if (!Number.isInteger(op.percent) || op.percent < 0 || op.percent > 100) unruled("setvolume outside 0..100");
      st.master = op.percent;
      emit(st, "media.volume", { volume: op.percent });
      return undefined;
    }
    case "voiceWait": {
      const r = checkTrackAndVoice(st, op.op, op.track ?? "sfx", op.voice);
      if (r === null) return undefined;
      if (r.v === undefined) unruled("a voice wait on a voice that is not active");
      if (r.v.length === null) return diag(st, "media.asset-length", op.op, { track: r.tr.name, voice: r.index });
      addWait(st, r.tr, r.v, op.thread, r.v.loop);
      return undefined;
    }
    case "soundFont": {
      const key = resolve(op.file);
      if (!/\.sf[23]$/.test(key)) return diag(st, "media.soundfont-name", op.op, { file: key });
      if (st.assets[key] === undefined) return diag(st, "media.soundfont-missing", op.op, { file: key });
      post(st, { kind: "soundfont.set", asset: key });
      return undefined;
    }
    case "soundFontReset":
      post(st, { kind: "soundfont.set", asset: null });
      return undefined;
    case "playavi": {
      const key = resolve(op.file);
      if (!st.videos.has(key)) return diag(st, "media.video-missing", op.op, { file: key });
      if (st.video !== null) return diag(st, "media.video-busy", op.op, { file: key });
      const reqId = st.nextReq;
      st.nextReq += 1;
      const mt = trackOf(st, "music");
      const cur = mt.voices[0];
      if (cur !== undefined) stopVoice(st, mt, cur);
      st.video = { reqId, thread: op.thread, key, presentation: op.presentation ?? "full" };
      st.waits.push({ kind: "video", thread: op.thread, reqId });
      st.ev.push({ e: "video-request", thread: op.thread, reqId, key, presentation: st.video.presentation });
      return undefined;
    }
    default:
      throw new Error(`unknown operation ${op.op}`);
  }
}

function pollWaits(st) {
  const remaining = [];
  for (const w of [...st.waits].sort((a, b) => a.thread - b.thread)) {
    if (w.kind === "video") {
      if (st.videoDone.has(w.reqId)) {
        st.ev.push({ e: "wake", thread: w.thread, kind: "video", reqId: w.reqId });
        st.video = null;
        const mt = trackOf(st, "music");
        if (mt.file !== null) applyEffect(st, { kind: "music.play", asset: mt.file, loop: (mt.flags & LOOP) !== 0, restart: true, source: "video" });
      } else remaining.push(w);
      continue;
    }
    const tr = trackOf(st, w.track);
    const v = tr.voices.find((x) => x.index === w.voice && x.cueId === w.cueId);
    let wake = false;
    let why = "";
    if (v === undefined) {
      wake = true;
      why = "gone";
    } else if (v.state === "paused") {
      wake = false;
    } else if (w.pass && v.loop) {
      wake = Math.floor((st.tick - v.startTick) / v.length) > w.pass0;
      why = "pass";
    } else if (v.endTick !== null) {
      wake = st.tick >= v.endTick;
      why = "end";
    }
    if (wake) st.ev.push({ e: "wake", thread: w.thread, kind: "audio.track", track: w.track, voice: w.voice, cueId: w.cueId, why });
    else remaining.push(w);
  }
  st.waits = remaining;
}

function audioPhase(st) {
  for (const tr of st.tracks) {
    for (const v of [...tr.voices]) {
      if (v.fade !== null && v.state === "playing" && st.tick - v.fade.start >= v.fade.dur) {
        v.volume = v.fade.to;
        v.fade = null;
      }
      if (v.state === "playing" && !v.loop && v.length !== null && st.tick >= v.endTick) {
        st.ev.push({ e: "finished", track: tr.name, voice: v.index, cueId: v.cueId, endTick: v.endTick });
        emit(st, "media.stop", { track: tr.name, voice: v.index });
        tr.voices = tr.voices.filter((x) => x !== v);
      }
    }
    if (tr.busFade !== null && st.tick - tr.busFade.start >= tr.busFade.dur) {
      tr.bus = tr.busFade.to;
      tr.busFade = null;
    }
  }
}

function snapshot(st) {
  return {
    cueId: st.cueId,
    tracks: st.tracks.map((t) => ({
      name: t.name,
      flags: t.flags,
      file: t.file,
      voices: t.voices.map((v) => ({
        index: v.index,
        state: v.state,
        file: v.file,
        priority: v.priority,
        volume: v.fade === null ? v.volume : unruled("saving while a voice fade runs"),
        pos: posOf(v, st.tick),
        length: v.length,
        loop: v.loop,
      })),
    })),
  };
}

/** Load (6.1 audio-save-load, 6.3 A3): bank first, then tracks in order, voices ascending. Settings are not touched. */
function load(st, snap) {
  if (st.waits.length > 0) unruled("loading while a thread is parked in a wait");
  st.cueId = Math.max(st.cueId, snap.cueId);
  emit(st, "soundfont.set", { asset: st.soundFont ?? st.defaultSoundFont });
  const playback = new Map(snap.tracks.map((t) => [t.name, t]));
  st.tracks = st.tracks.map((configured) => {
    const s = playback.get(configured.name);
    const t = newTrack(configured.name, configured.configured);
    t.bus = configured.bus;
    t.busFade = configured.busFade;
    if (s === undefined) return t;
    t.flags = s.flags;
    t.file = s.file;
    for (const sv of s.voices) {
      if (sv.index >= t.configured) continue;
      if (sv.state === "paused") unruled("loading a paused voice");
      if (sv.length !== null && !sv.loop && sv.pos >= sv.length) continue;
      const music = s.name === "music";
      const startTick = music ? st.tick : st.tick - sv.pos;
      const v = {
        index: sv.index,
        state: "playing",
        file: sv.file,
        cueId: 0,
        priority: sv.priority,
        volume: sv.volume,
        startTick,
        endTick: sv.length !== null && !sv.loop ? startTick + sv.length : null,
        length: sv.length,
        loop: sv.loop,
        fade: null,
        pausedAt: null,
        heldPos: null,
      };
      v.cueId = emit(st, "media.play", { tick: startTick, track: s.name, voice: sv.index, asset: sv.file, loop: sv.loop, flags: sv.loop ? LOOP : 0, positionTicks: 0, volume: sv.volume });
      t.voices.push(v);
    }
    return t;
  });
  st.cfgDirty = true;
  st.ev.push({ e: "load" });
}

function sample(st) {
  const row = { t: st.tick };
  if (st.cfgDirty) {
    row.cfg = st.tracks.map((t) => [t.name, t.configured]);
    st.cfgDirty = false;
  }
  row.tr = [];
  for (const t of st.tracks) {
    if (t.file === null && t.voices.length === 0) continue;
    const p = primary(t);
    row.tr.push([
      t.name,
      trackState(t),
      t.flags,
      t.file,
      p === undefined ? 0 : posOf(p, st.tick),
      p === undefined ? null : p.length,
      t.voices.map((v) => [v.index, v.state, v.cueId, v.priority, volOf(v, st.tick), v.startTick, posOf(v, st.tick), v.endTick, v.loop ? 1 : 0, fadeTuple(v.fade)]),
    ]);
  }
  const bus = st.tracks.filter((t) => t.bus !== 100 || t.busFade !== null).map((t) => [t.name, busOf(t, st.tick), fadeTuple(t.busFade)]);
  if (bus.length > 0) row.bus = bus;
  if (st.master !== 100) row.master = st.master;
  if (st.soundFont !== null) row.sf = st.soundFont;
  if (st.cues.length > 0) row.cues = st.cues;
  if (st.ev.length > 0) row.ev = st.ev;
  return row;
}

/**
 * Run one case. `script` operations are `{ t, op, at?, ...arguments }`; `at` is "pre" (between ticks:
 * `register`, `load`, `reset`, `video.ended`), "post" (after the audio phase: `save`) or, by default,
 * the thread/effect phases. Effects are `{ op: "effect", kind, ... }`.
 */
export function simulate(setup, script, ticks) {
  const st = makeState(setup);
  const registerAt = setup.registerAt ?? 0;
  const rows = [];
  for (let t = 0; t < ticks; t += 1) {
    st.tick = t;
    st.cues = [];
    st.ev = [];
    if (t === registerAt) register(st);
    for (const op of script) {
      if (op.t !== t || op.at !== "pre") continue;
      if (op.op === "load") load(st, st.saves[op.save]);
      else if (op.op === "reset") st.ev.push({ e: "reset" });
      else if (op.op === "video.ended") {
        if (st.video !== null && st.video.reqId === op.reqId) {
          st.videoDone.add(op.reqId);
          st.ev.push({ e: "video-ended", reqId: op.reqId });
        } else st.ev.push({ e: "video-ended-ignored", reqId: op.reqId });
      } else throw new Error(`unknown pre operation ${op.op}`);
    }
    if (st.registered) pollWaits(st);
    for (const op of script) {
      if (op.t !== t || op.at === "pre" || op.at === "post") continue;
      if (op.op === "effect") {
        post(st, { kind: op.kind, asset: op.asset ?? null, loop: op.loop, restart: op.restart, source: op.source });
      } else {
        if (!st.registered) throw new Error("a command ran before the applier registered");
        command(st, op);
      }
    }
    audioPhase(st);
    rows.push(sample(st));
    for (const op of script) {
      if (op.t !== t || op.at !== "post") continue;
      if (op.op === "save") st.saves[op.name] = snapshot(st);
      else throw new Error(`unknown post operation ${op.op}`);
    }
  }
  const end = { cueId: st.cueId, soundFont: st.soundFont, master: st.master };
  return { rows, end, assets: st.assets };
}

/**
 * The cue player's start arithmetic (6.3 cue-player and audio-late-sounds) for one cue and the tick `ready`
 * at which the runner can act. A pure function of the cue, the length and the track; nothing is read from a device.
 */
export function cuePlayer(cue, ready, info) {
  const lateness = Math.max(0, ready - cue.tick);
  if (cue.kind === "media.play") {
    let s = cue.positionTicks + lateness;
    const finite = info.length !== null;
    if (finite && !cue.loop && cue.track !== "music" && lateness >= LATE_TICKS) return { action: "stop", reason: "late", lateness };
    if (finite && cue.loop) s %= info.length;
    if (finite && !cue.loop && s >= info.length) return { action: "stop", reason: "finished", lateness };
    return { action: "play", positionTicks: s, lateness };
  }
  if (cue.kind === "media.seek") {
    let s = cue.positionTicks + (info.playing === false ? 0 : lateness);
    if (info.loop && info.length !== null) s %= info.length;
    return { action: "seek", positionTicks: s, lateness };
  }
  if (cue.kind === "media.fade") {
    const d = lateness;
    if (d >= cue.durationTicks) return { action: "setVolume", volume: cue.targetVolume, lateness };
    return { action: "fade", from: fadeValue(cue.volume, cue.targetVolume, cue.durationTicks, d), target: cue.targetVolume, durationTicks: cue.durationTicks - d, lateness };
  }
  throw new Error(`cuePlayer does not model ${cue.kind}`);
}
