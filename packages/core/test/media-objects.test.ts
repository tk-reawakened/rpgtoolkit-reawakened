// The media objects (MEDIA-1, MEDIA-2; entry 21.5): `media`, track objects and the
// data-only voice `mediaPlay` returns. These drive the real VM, the real audio
// applier and the real post-order effect bus; nothing is mocked.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  addActor,
  assetKey,
  collectStateGarbage,
  CORE_PLUGIN,
  createAudioRuntime,
  createBattleOwner,
  createGameState,
  createMediaScriptService,
  createScriptServices,
  drainDiagnostics,
  hashGameState,
  mediaEventsActive,
  mediaVoiceRef,
  queueAudioEvent,
  MEDIA_PLUGIN,
  restoreGameState,
  runEventsPhase,
  runThreadsPhase,
  runTimePhase,
  runWaitsPhase,
  snapshot,
  startProgram,
  STEP_BUDGET,
  type AudioCue,
  type AudioLookup,
  type AudioNote,
  type AudioRuntime,
  type GameState,
  type PluginDefinition,
  type ScriptServices,
} from "../src/index.ts";
import { EffectBus } from "../src/engine/effects.ts";
import { engineEffect } from "../src/engine/boot.ts";
import { runEngineCancelableEventOutcome } from "../src/events/dispatch.ts";

type Diagnostic = { readonly code: string; readonly message: string };

type Rig = {
  readonly state: GameState;
  readonly services: ScriptServices;
  readonly audio: AudioRuntime;
  readonly notes: AudioNote[];
  readonly diagnostics: Diagnostic[];
  readonly cues: AudioCue[];
  postAudioEffect(name: string, args: Parameters<typeof engineEffect>[2]): void;
  tick(): void;
  run(ticks: number): void;
};

/** A real VM + audio applier + effect bus; the script's commands reach the one owner. */
function rig(lengths: Record<string, number | null | "pending">, program: string, extraPlugins: readonly PluginDefinition[] = [], saved?: string): Rig {
  const state = saved === undefined ? createGameState({ seed: 7 }) : restoreGameState(saved);
  const notes: AudioNote[] = [];
  const diagnostics: Diagnostic[] = [];
  const cues: AudioCue[] = [];
  const bus = new EffectBus(state);
  const media = createMediaScriptService(
    state,
    (name, args) => bus.postEffect("audio", engineEffect("audio", name, args, "draw-audio-cue")),
    (file) => Object.hasOwn(lengths, file) ? assetKey(`media/${file}`) : null,
    (code, op, _detail) => {
      diagnostics.push({ code, message: `${op}: ${code}` });
    },
  );
  let services!: ScriptServices;
  const audio = createAudioRuntime(state, {
    lookup: (asset): AudioLookup => {
      const found = lengths[asset.slice("media/".length)];
      if (found === undefined) return { kind: "unsupported" };
      if (found === "pending") return { kind: "pending" };
      return { kind: "known", lengthTicks: found };
    },
    engineBeforePlay: (detail) => runEngineCancelableEventOutcome(state, services, "media", "beforePlay", detail),
    bindVoice: (handle, result) => media.bind(handle, result),
    transition: (event) => queueAudioEvent(state, event),
    transitionsActive: () => mediaEventsActive(state),
    notify: (note) => {
      notes.push(note);
      if (note.kind === "diag") diagnostics.push({ code: note.code, message: `${note.op}: ${note.code}` });
    },
  });
  if (saved === undefined) audio.register(bus);
  else bus.register("audio", audio.apply);
  services = createScriptServices(
    state,
    [{ definition: CORE_PLUGIN }, { definition: MEDIA_PLUGIN }, ...extraPlugins.map((definition) => ({ definition }))],
    undefined,
    undefined,
    undefined,
    "media-objects-test",
    (section, effect) => bus.dispatchRecorded(section, effect),
    undefined,
    undefined,
    [],
    false,
    media,
  );
  for (const diagnostic of drainDiagnostics(services)) diagnostics.push({ code: diagnostic.code, message: diagnostic.message });
  if (saved === undefined) startProgram(state.vm, { kind: "inline", text: program, compiler: "2" });
  const made: Rig = {
    state,
    services,
    audio,
    notes,
    diagnostics,
    cues,
    postAudioEffect(name, args) {
      bus.postEffect("audio", engineEffect("audio", name, args, "draw-audio-cue"));
    },
    tick() {
      runWaitsPhase(state.vm, {
        tick: state.time.tick,
        events: state.events,
        audio: state.audio,
        ...(state.engine.pendingEffects?.audio === undefined ? {} : { pendingAudio: state.engine.pendingEffects.audio }),
        mediaStart: (handle: number) => {
          const record = state.vm.objects.find((item) => item.handle === handle);
          return record === undefined ? null : mediaVoiceRef(record);
        },
      });
      runThreadsPhase(state.vm, services, STEP_BUDGET);
      runEventsPhase(state, services, STEP_BUDGET);
      audio.retry();
      audio.phase();
      collectStateGarbage(state, []);
      runTimePhase(state.time);
      for (const diagnostic of drainDiagnostics(services)) diagnostics.push({ code: diagnostic.code, message: diagnostic.message });
      cues.push(...audio.drain());
    },
    run(ticks: number) {
      for (let index = 0; index < ticks; index += 1) made.tick();
    },
  };
  return made;
}

const global = (state: GameState, name: string): unknown => state.vm.globals[name.toLowerCase()] ?? 0;

const track = (state: GameState, name: string) => state.audio.tracks.find((item) => item.name === name)!;

const voice = (state: GameState, name: string, slot: number) => track(state, name).voices.find((item) => item.index === slot);

const cueKinds = (cues: readonly AudioCue[]): string[] => cues.map((cue) => cue.kind);

test("mediaPlay returns a bound voice whose readable fields are the core voice state", () => {
  const world = rig({ "boom.wav": 60 }, [
    'v = mediaPlay("boom.wav", { track: "sfx" })',
    "vtrack = v.track",
    "vfile = v.file",
    "vstate = v.state",
    "vpos = v.position",
    "vlen = v.length",
    "vvol = v.volume",
    "vloop = v.loop",
  ].join("\n"));
  world.run(2);
  deepEqual(world.diagnostics, []);
  equal(global(world.state, "vtrack"), "sfx");
  equal(global(world.state, "vfile"), "media/boom.wav");
  equal(global(world.state, "vstate"), "playing");
  equal(global(world.state, "vlen"), 1);
  equal(global(world.state, "vvol"), 100);
  equal(global(world.state, "vloop"), 0);
  const record = voice(world.state, "sfx", 0)!;
  equal(record.file, "media/boom.wav");
  equal(global(world.state, "vpos"), 0);
  deepEqual(cueKinds(world.cues), ["soundfont.set", "media.play"]);
});

test("media.beforePlay mutates file, volume and loop before the shared start", () => {
  const world = rig({ "a.wav": 60, "b.wav": 90 }, [
    'media.on("beforePlay", (event) => { source = event.detail.source; event.detail.file = "MEDIA/B.WAV"; event.detail.volume = 25; event.detail.loop = 1 })',
    'v = mediaPlay("a.wav", { track: "sfx" })',
    "after = 1",
  ].join("\n"));
  world.tick();
  equal(global(world.state, "after"), 0);
  world.run(2);
  equal(global(world.state, "after"), 1);
  const started = voice(world.state, "sfx", 0)!;
  equal(started.file, "media/b.wav");
  equal(started.volume, 25);
  equal(started.loop, true);
  equal(global(world.state, "source"), "script");
  equal(world.cues.filter((cue) => cue.kind === "media.play").length, 1);
});

test("engine-originated starts share the script listener order and canonical mutation path", () => {
  const world = rig({ "original.mid": 60, "battle.mid": 90 }, [
    'order = ""',
    'media.on("beforePlay", (event) => { order = order + "A"; event.detail.file = "MEDIA/BATTLE.MID"; event.detail.volume = 35; event.detail.loop = 0 })',
    'media.on("beforePlay", (event) => { order = order + "B" + event.detail.source + event.detail.file })',
  ].join("\n"));
  world.tick();
  const result = world.audio.play({ track: "music", asset: assetKey("media/original.mid"), loop: true, source: "battle" });
  equal(result.kind, "started");
  equal(global(world.state, "order"), "ABbattleMEDIA/BATTLE.MID");
  const started = voice(world.state, "music", 0)!;
  deepEqual([started.file, started.volume, started.loop], ["media/battle.mid", 35, false]);
  deepEqual(world.audio.drain().filter((cue) => cue.kind === "media.play").map((cue) => [cue.asset, cue.volume, cue.loop]), [["media/battle.mid", 35, false]]);
});

test("battle music replaces board music on the built-in track with the battle source", () => {
  const world = rig({ "board.mid": 60, "battle.mid": 90 }, 'media.on("beforePlay", (event) => { source = event.detail.source })');
  world.tick();
  world.postAudioEffect("music.play", [assetKey("media/board.mid"), true, false, "board"]);
  const media = world.services.view.media;
  if (media === undefined) throw new Error("expected the engine media service");
  media.playBattleMusic("battle.mid");
  equal(voice(world.state, "music", 0)?.file, "media/battle.mid");
  equal(global(world.state, "source"), "battle");
  equal(world.state.vm.objects.filter((record) => record.className === "media.voice").length, 0);
});

test("empty or missing battle music leaves the current board track playing", () => {
  const world = rig({ "board.mid": 60 }, 'media.on("beforePlay", (event) => { source = event.detail.source })');
  world.tick();
  world.postAudioEffect("music.play", [assetKey("media/board.mid"), true, false, "board"]);
  const media = world.services.view.media;
  if (media === undefined) throw new Error("expected the engine media service");
  media.playBattleMusic("");
  media.playBattleMusic("missing.mid");
  equal(voice(world.state, "music", 0)?.file, "media/board.mid");
  equal(global(world.state, "source"), "board");
});
test("mid-battle battle music and battle state round-trip as deterministic plain data", () => {
  const world = rig({ "battle.mid": 90 }, "");
  world.tick();
  const enemy = addActor(world.state.actors, {
    kind: "enemy",
    source: "enemy/slime.ene",
    name: "Slime",
    stats: { hp: 8, maxHp: 8 },
  });
  const hero = addActor(world.state.actors, {
    kind: "party",
    source: "chrs/hero.tem",
    name: "Hero",
    stats: { hp: 10, maxHp: 10 },
  });
  world.state.party.members = [hero.id];
  world.state.party.selected = hero.id;
  const owner = createBattleOwner({
    readBattle: () => world.state.battle,
    readActors: () => world.state.actors,
    commit: (battle) => { world.state.battle = battle; },
  });
  const started = owner.start({
    boardKey: assetKey("boards/field.brd"),
    background: "night.bkg",
    canRun: true,
    enemies: [enemy.id],
    players: [hero.id],
  });
  ok(started.ok);
  if (world.services.view.media === undefined) throw new Error("expected the engine media service");
  world.services.view.media.playBattleMusic("battle.mid");
  const saved = snapshot(world.state);
  const restored = restoreGameState(saved);
  deepEqual(restored.battle, world.state.battle);
  deepEqual(restored.audio, world.state.audio);
  equal(snapshot(restored), saved);
  equal(hashGameState(restored), hashGameState(world.state));
  equal(Object.hasOwn(restored.battle ?? {}, "music"), false);
  equal(restored.audio.tracks.find((track) => track.name === "music")?.file, assetKey("media/battle.mid"));
});


test("engine effect starts cover board, frame, battle, menu and video sources", () => {
  const board = rig({ "a.wav": 60 }, 'media.on("beforePlay", (event) => { source = event.detail.source; event.cancel() })');
  board.tick();
  board.audio.drain();
  const boardCueId = board.state.audio.cueId;
  board.postAudioEffect("music.play", ["media/a.wav", true, false, "board"]);
  equal(board.state.audio.cueId, boardCueId);
  equal(global(board.state, "source"), "board");
  equal(voice(board.state, "music", 0), undefined);

  const frame = rig({ "a.wav": 60 }, [
    'media.on("beforePlay", (event) => { source = event.detail.source; event.detail.volume = 50 })',
  ].join("\n"));
  frame.tick();
  frame.audio.drain();
  frame.postAudioEffect("sfx.play", ["media/a.wav", false, null, "frame"]);
  equal(global(frame.state, "source"), "animation");
  equal(voice(frame.state, "sfx", 0)?.volume, 50);

  frame.postAudioEffect("sfx.play", ["media/a.wav", false, null, "ui"]);
  equal(global(frame.state, "source"), "menu");
  equal(voice(frame.state, "ui", 0)?.volume, 50);

  const battle = rig({ "a.wav": 60, "b.wav": 90 }, 'media.on("beforePlay", (event) => { source = event.detail.source; event.detail.file = "MEDIA/B.WAV" })');
  battle.tick();
  battle.audio.drain();
  battle.postAudioEffect("music.play", ["media/a.wav", true, false, "battle"]);
  equal(voice(battle.state, "music", 0)?.file, "media/b.wav");
  equal(global(battle.state, "source"), "battle");

  const video = rig({ "a.wav": 60 }, 'media.on("beforePlay", (event) => { source = event.detail.source })');
  video.tick();
  video.audio.drain();
  video.postAudioEffect("music.play", ["media/a.wav", true, false, "video"]);
  equal(global(video.state, "source"), "video");
});

test("a canceled script mediaPlay returns null and consumes no cue or voice", () => {
  const world = rig({ "a.wav": 60 }, [
    'media.on("beforePlay", (event) => { event.cancel() })',
    'v = mediaPlay("a.wav", { track: "sfx" })',
    "after = 1",
  ].join("\n"));
  const initialCueId = world.state.audio.cueId;
  world.run(2);
  equal(global(world.state, "v"), 0);
  equal(global(world.state, "after"), 1);
  equal(voice(world.state, "sfx", 0), undefined);
  equal(world.cues.filter((cue) => cue.kind === "media.play").length, 0);
  equal(world.state.audio.cueId, initialCueId);
});

test("a save during media.beforePlay dispatch resumes to the same state and cue stream", () => {
  const program = [
    'media.on("beforePlay", (event) => { threadSleep(getThreadId(), 0.02); event.detail.volume = 35 })',
    'v = mediaPlay("a.wav", { track: "sfx" })',
    "after = 1",
  ].join("\n");
  const uninterrupted = rig({ "a.wav": 60 }, program);
  uninterrupted.tick();
  equal(uninterrupted.state.events.dispatch?.emitter, "media");
  const cueBoundary = uninterrupted.cues.length;
  const saved = snapshot(uninterrupted.state);
  uninterrupted.run(6);
  const expectedHash = hashGameState(uninterrupted.state);
  const expectedCues = uninterrupted.cues.slice(cueBoundary);

  const restored = rig({ "a.wav": 60 }, "", [], saved);
  restored.run(6);
  equal(hashGameState(restored.state), expectedHash);
  deepEqual(restored.cues, expectedCues);
});

test("voice and track methods apply the same deterministic operations as the procedural commands", () => {
  const world = rig({ "boom.wav": 600 }, [
    'v = mediaPlay("boom.wav", { track: "sfx", loop: 0 })',
    "v.pause()",
    "paused = v.state",
    "v.volume = 40",
    "v.loop = 1",
    "v.resume()",
    "v.seek(0.5)",
    "v.fade(0, 1)",
    "media.music.volume = 20",
    "media.music.fade(0, 2)",
    "tv = media.music.volume",
  ].join("\n"));
  world.run(2);
  deepEqual(world.diagnostics, []);
  equal(global(world.state, "paused"), "paused");
  equal(global(world.state, "tv"), 20);
  const record = voice(world.state, "sfx", 0)!;
  equal(record.loop, true);
  equal(record.fade?.targetVolume, 0);
  const music = world.state.audio.settings.trackVolumes.find((entry) => entry.name === "music");
  equal(music?.volume, 20);
  equal(music?.fade?.targetVolume, 0);
  ok(cueKinds(world.cues).includes("media.pause"));
  ok(cueKinds(world.cues).includes("media.resume"));
  ok(cueKinds(world.cues).includes("media.seek"));
  ok(cueKinds(world.cues).includes("media.fade"));
  ok(cueKinds(world.cues).includes("media.volume"));
});

test("a replaced voice reads as no live voice and its methods diagnose without touching the replacement", () => {
  const world = rig({ "a.wav": 600, "b.wav": 600 }, [
    'v = mediaPlay("a.wav", { track: "sfx" })',
    'w = mediaPlay("b.wav", { track: "sfx" })',
    "vfile = v.file",
    "vstate = v.state",
    "vvol = v.volume",
    "vlen = v.length",
    "v.stop()",
    "wstate = w.state",
  ].join("\n"));
  world.run(2);
  equal(global(world.state, "vfile"), "");
  equal(global(world.state, "vstate"), "stopped");
  equal(global(world.state, "vvol"), 0);
  equal(global(world.state, "vlen"), 0);
  equal(global(world.state, "wstate"), "playing");
  equal(voice(world.state, "sfx", 0)?.file, "media/b.wav");
  deepEqual(world.diagnostics.map((entry) => entry.code), ["media.unknown-voice"]);
});

test("voice identity fields cannot be changed to redirect a stale object", () => {
  const world = rig({ "a.wav": 60, "b.wav": 60, "c.wav": 60 }, [
    'errors = ""',
    'game.on("error", (event) => { errors = errors + event.detail.code + ";" })',
    'old = mediaPlay("a.wav", { track: "sfx" })',
    'mediaPlay("b.wav", { track: "sfx" })',
    'target = mediaPlay("c.wav", { track: "music" })',
    'old.track = "music"',
    "old.slot = target.slot",
    "old.cueId = 3",
    "oldTrack = old.track",
    "oldSlot = old.slot",
    "old.stop()",
  ].join("\n"));
  world.run(3);
  equal(global(world.state, "errors"), "assign.read-only;assign.read-only;assign.read-only;");
  equal(global(world.state, "oldTrack"), "sfx");
  equal(global(world.state, "oldSlot"), 0);
  equal(voice(world.state, "music", 0)?.state, "playing");
  ok(world.diagnostics.some((entry) => entry.code === "media.unknown-voice"));
});

test("same-file music carries on and returns the live voice; the same request on sfx returns null", () => {
  const world = rig({ "song.mid": 600, "ding.wav": 60 }, [
    'a = mediaPlay("song.mid", { track: "music" })',
    'b = mediaPlay("song.mid", { track: "music" })',
    "same = a.cueId == b.cueId",
    'c = mediaPlay("ding.wav", { track: "sfx" })',
    'd = mediaPlay("ding.wav", { track: "sfx" })',
    "ignored = d == null",
  ].join("\n"));
  world.run(2);
  deepEqual(world.diagnostics, []);
  equal(global(world.state, "same"), 1);
  equal(global(world.state, "ignored"), 1);
  equal(world.notes.filter((note) => note.kind === "same-file").length, 2);
});

test("priority steals the lowest-priority voice when every slot is active", () => {
  const world = rig({ "a.wav": 600, "b.wav": 600, "c.wav": 600, "d.wav": 600, "e.wav": 600 }, [
    'a = mediaPlay("a.wav", { track: "ambience", priority: 5 })',
    'b = mediaPlay("b.wav", { track: "ambience", priority: 1 })',
    'c = mediaPlay("c.wav", { track: "ambience", priority: 3 })',
    'd = mediaPlay("d.wav", { track: "ambience", priority: 4 })',
    'e = mediaPlay("e.wav", { track: "ambience", priority: 9 })',
    "bstate = b.state",
    "estate = e.state",
  ].join("\n"));
  world.run(2);
  deepEqual(world.diagnostics, []);
  equal(global(world.state, "bstate"), "stopped");
  equal(global(world.state, "estate"), "playing");
  equal(voice(world.state, "ambience", 1)?.file, "media/e.wav");
  ok(world.notes.some((note) => note.kind === "steal" && note.voice === 1));
});

test("sync starts at the source track's modulo position", () => {
  const world = rig({ "pad.wav": 600, "drum.wav": 120 }, [
    'p = mediaPlay("pad.wav", { track: "ambience", loop: 1 })',
    "threadSleep(getThreadId(), 0.05)",
    "src = p.position",
    's = mediaPlay("drum.wav", { track: "ui", sync: "ambience" })',
    "pos = s.position",
  ].join("\n"));
  world.run(8);
  deepEqual(world.diagnostics, []);
  const src = Number(global(world.state, "src"));
  ok(src > 0, "the source had advanced before the synced start");
  equal(global(world.state, "pos"), 0.05);
});

test("media.track reaches a configured track and returns null with a diagnostic for an unknown name", () => {
  const before = rig({}, 't = media.track("ambience")\ntname = t.name\n');
  before.run(1);
  deepEqual(before.diagnostics, []);
  equal(global(before.state, "tname"), "ambience");

  const unknown = rig({}, [
    't = media.track("nosuch")',
    "wasnull = 0",
    "if (t == null) { wasnull = 1 }",
  ].join("\n"));
  unknown.run(1);
  ok(unknown.diagnostics.some((entry) => entry.code === "media.unknown-track"));
  equal(global(unknown.state, "wasnull"), 1);
  equal(unknown.state.audio.tracks.some((item) => item.name === "nosuch"), false);
});

test("voice, track and media hear one transition in voice then track then media order", () => {
  const order: string[] = [];
  const recorder = (scope: string): PluginDefinition["commands"][number] => ({
    name: `record_${scope}`,
    aliases: [],
    params: [{ name: "event", optional: false, byRef: false, variadic: false }],
    call: () => {
      order.push(scope);
      return { value: 0 };
    },
  });
  const plugin: PluginDefinition = {
    id: "media-order-test",
    version: "1.0.0",
    commands: [recorder("voice"), recorder("track"), recorder("media")],
    listeners: [
      { emitter: "media.voice:sfx:0:2", type: "stopped", command: "record_voice" },
      { emitter: "media.track:sfx", type: "stopped", command: "record_track" },
      { emitter: "media", type: "stopped", command: "record_media" },
    ],
  };
  const world = rig({ "a.wav": 600 }, 'v = mediaPlay("a.wav", { track: "sfx" })\nv.stop()\n', [plugin]);
  world.run(2);
  deepEqual(world.diagnostics, []);
  deepEqual(order, ["voice", "track", "media"]);
});

test("the media event domain stays lazy: a play alone adds no emitter registration", () => {
  const world = rig({ "a.wav": 60 }, 'v = mediaPlay("a.wav", { track: "sfx" })\n');
  world.run(2);
  equal(world.state.events.emitters, undefined);
});

test("a save at every tick restores the same hash and keeps the audio section plain data", () => {
  const world = rig({ "a.wav": 600, "b.wav": 60 }, [
    'v = mediaPlay("a.wav", { track: "sfx", loop: 0 })',
    'w = mediaPlay("b.wav", { track: "ambience" })',
    "v.volume = 55",
    "w.fade(0, 1)",
    "v.pause()",
    "v.resume()",
  ].join("\n"));
  for (let tick = 0; tick < 6; tick += 1) {
    world.tick();
    const saved = snapshot(world.state);
    const restored = restoreGameState(saved);
    equal(hashGameState(restored), hashGameState(world.state), `tick ${tick} hash`);
    equal(snapshot(restored), saved, `tick ${tick} snapshot`);
    const audio = (JSON.parse(saved) as { audio?: unknown }).audio;
    ok(audio !== undefined, "the save has an audio section");
    equal(JSON.stringify(audio).includes("=>"), false);
  }
  deepEqual(world.diagnostics, []);
});

test("the one-argument mediaPlay returns the voice with Toolkit 3.1 defaults and cue", () => {
  const assigned = rig({ "song.mid": 600 }, [
    'x = mediaPlay("song.mid")',
    "isnull = 0",
    "if (x == null) { isnull = 1 }",
    "trackName = x.track",
    "voiceState = x.state",
  ].join("\n"));
  assigned.run(1);
  deepEqual(assigned.diagnostics, []);
  equal(global(assigned.state, "isnull"), 0);
  equal(global(assigned.state, "trackName"), "music");
  equal(global(assigned.state, "voiceState"), "playing");
  deepEqual(cueKinds(assigned.cues), ["soundfont.set", "media.play"]);
  equal(voice(assigned.state, "music", 0)?.file, "media/song.mid");

  const bare = rig({ "song.mid": 600 }, 'mediaPlay("song.mid")\n');
  bare.run(1);
  deepEqual(bare.diagnostics, []);
  deepEqual(cueKinds(bare.cues), ["soundfont.set", "media.play"]);
  equal(voice(bare.state, "music", 0)?.file, "media/song.mid");
});

test("mp3pause waits for its finite sound to finish", () => {
  const world = rig({ "hit.wav": 3 }, [
    'mp3pause("hit.wav")',
    "done = 1",
  ].join("\n"));
  world.tick();
  equal(global(world.state, "done"), 0);
  const waiting = world.state.vm.threads.find((thread) => thread.status === "waiting");
  equal(waiting?.wait?.kind, "audio.track");
  const payload = waiting?.wait !== null && waiting?.wait !== undefined && "payload" in waiting.wait
    ? waiting.wait.payload[0]
    : undefined;
  equal(typeof payload === "object" && payload !== null && "endTick" in payload ? payload.endTick : undefined, 3);

  world.run(2);
  equal(global(world.state, "done"), 0);
  world.tick();
  equal(global(world.state, "done"), 1);
});

test("a wait requested on a start held for its asset parks until it binds, then waits for the finite end", () => {
  const lengths: Record<string, number | null | "pending"> = { "a.wav": "pending" };
  const world = rig(lengths, [
    'v = mediaPlay("a.wav", { track: "sfx", wait: 1 })',
    "vtrack = v.track",
    "vslot = v.slot",
    "returned = 1",
    "done = 1",
  ].join("\n"));
  world.tick();
  equal(global(world.state, "done"), 0);
  const waiting = world.state.vm.threads.find((thread) => thread.status === "waiting");
  equal(waiting?.wait?.kind, "audio.track");
  const pending = waiting?.wait;
  const payload = pending !== undefined && pending !== null && "payload" in pending ? pending.payload[0] : undefined;
  equal(typeof payload === "object" && payload !== null && "cueId" in payload ? payload.cueId : undefined, 0);
  // GC and save/restore must retain the not-yet-bound return object.
  const restored = rig(lengths, "", [], snapshot(world.state));
  lengths["a.wav"] = 60;
  for (let tick = 0; tick < 60; tick += 1) {
    world.tick();
    restored.tick();
    equal(hashGameState(restored.state), hashGameState(world.state), `pending replay tick ${tick}`);
    equal(global(world.state, "done"), 0, `must still wait at tick ${tick}`);
  }
  world.run(2);
  restored.run(2);
  equal(global(world.state, "done"), 1);
  equal(global(world.state, "returned"), 1);
  equal(global(world.state, "vtrack"), "sfx");
  equal(global(world.state, "vslot"), 0);
  deepEqual(world.diagnostics, []);
  deepEqual(restored.diagnostics, []);
});

test("an invalid loop assignment diagnoses and leaves the flag unchanged", () => {
  const world = rig({ "a.wav": 600 }, [
    'v = mediaPlay("a.wav", { track: "sfx", loop: 1 })',
    "before = v.loop",
    "v.loop = 2",
    "after = v.loop",
  ].join("\n"));
  world.run(1);
  equal(global(world.state, "before"), 1);
  equal(global(world.state, "after"), 1);
  ok(world.diagnostics.some((entry) => entry.code === "builtin.bad-arg"));
});

test("the Toolkit 3.1 aliases keep their cue streams and mp3pause waits", () => {
  const legacy = rig({ "song.mid": 600, "hit.wav": 60, "ding.wav": 60 }, [
    'midiplay("song.mid")',
    'wav("hit.wav")',
    'mp3pause("ding.wav")',
  ].join("\n"));
  legacy.run(2);
  const object = rig({ "song.mid": 600, "hit.wav": 60 }, [
    'mediaPlay("song.mid", { track: "music", loop: 1 })',
    'mediaPlay("hit.wav", { track: "sfx", loop: 0 })',
  ].join("\n"));
  object.run(2);
  deepEqual(cueKinds(legacy.cues), ["soundfont.set", "media.play", "media.play", "media.stop", "media.play"]);
  const shape = (cue: AudioCue): unknown[] => [cue.kind, cue.track, cue.asset, cue.loop];
  deepEqual(legacy.cues.slice(0, 3).map(shape), object.cues.map(shape));
  ok(legacy.state.vm.threads.some((thread) => thread.status === "waiting" && thread.wait?.kind === "audio.track"), "mp3pause parks on its finite sfx voice");

  const retired = rig({}, 'mediaPlay("f.wav", "sfx", 4)\n');
  retired.run(1);
  ok(retired.diagnostics.some((entry) => entry.code === "arity.mismatch"));
});

test("a finite waited mediaPlay returns its voice after waking, while mp3pause remains void", () => {
  const world = rig({ "a.wav": 3 }, [
    'v = mediaPlay("a.wav", {track: "sfx", wait: 1})',
    "name = v.track",
    'legacy = mp3pause("a.wav")',
    "legacyNull = 0",
    "if (legacy == null) { legacyNull = 1 }",
  ].join("\n"));
  world.run(8);
  deepEqual(world.diagnostics, []);
  equal(global(world.state, "name"), "sfx");
  equal(global(world.state, "legacyNull"), 1);
});

test("media and track caches recreate live records after GC and VM replacement", () => {
  const world = rig({}, "");
  const media = world.services.media!;
  const first = media.mediaObject();
  const firstTrack = media.trackObject("sfx")!;
  collectStateGarbage(world.state, []);
  equal(world.state.vm.objects.includes(first), false);
  const next = media.mediaObject();
  const nextTrack = media.trackObject("sfx")!;
  ok(next !== first);
  ok(nextTrack !== firstTrack);
  ok(world.state.vm.objects.includes(next));
  ok(world.state.vm.objects.includes(nextTrack));
  world.state.vm = createGameState({ seed: 7 }).vm;
  const reset = media.mediaObject();
  const resetTrack = media.trackObject("sfx")!;
  ok(reset !== next);
  ok(resetTrack !== nextTrack);
  ok(world.state.vm.objects.includes(reset));
  ok(world.state.vm.objects.includes(resetTrack));
});

test("active media lifecycle emitters adopt the returned voice and retain queued targets", () => {
  const world = rig({ "a.wav": 60 }, [
    'media.on("started", (event) => { started = event.target })',
    'v = mediaPlay("a.wav", {track: "sfx"})',
    'v.on("paused", (event) => { heard = 1; pausedTarget = event.target })',
    'v.on("started", (event) => { voiceStarted = event.target })',
    "v.pause()",
  ].join("\n"));
  world.run(2);
  deepEqual(world.diagnostics, []);
  equal(global(world.state, "heard"), 1);
  deepEqual(global(world.state, "pausedTarget"), global(world.state, "v"));
  deepEqual(global(world.state, "voiceStarted"), global(world.state, "v"));
  // The media relay targets media; the voice notification queued before binding
  // must target the voice, not its provisional generic emitter.
  const value = global(world.state, "v") as { handle: number };
  equal(world.state.events.emitters?.["media.voice:sfx:0:2"], value.handle);
});

test("invalid sync sources diagnose but start the valid destination at zero", () => {
  for (const source of ["missing", "inactive", "unknown"]) {
    const world = rig({ "a.wav": 60, "unknown.wav": null }, [
      ...(source === "unknown" ? ['mediaPlay("unknown.wav", {track: "ambience"})'] : []),
      `v = mediaPlay("a.wav", {track: "sfx", sync: "${source === "missing" ? "nosuch" : "ambience"}"})`,
      "pos = v.position",
      "name = v.track",
    ].join("\n"));
    world.run(1);
    equal(global(world.state, "name"), "sfx", source);
    equal(global(world.state, "pos"), 0, source);
    ok(world.diagnostics.some((entry) => entry.code === "media.sync-source"), source);
  }
});

test("voice position and voice/track fade reads project the current tick and freeze paused voice fades", () => {
  const world = rig({ "a.wav": 600 }, [
    'v = mediaPlay("a.wav", {track: "sfx"})',
    "v.fade(0, 1)",
    "media.sfx.fade(0, 1)",
    "threadSleep(getThreadId(), 0.5)",
    "pos = v.position",
    "gain = v.volume",
    "busgain = media.sfx.volume",
    "v.pause()",
    "threadSleep(getThreadId(), 0.25)",
    "heldpos = v.position",
    "heldgain = v.volume",
    "runningbusgain = media.sfx.volume",
  ].join("\n"));
  world.run(47);
  deepEqual(world.diagnostics, []);
  equal(global(world.state, "pos"), 0.5);
  equal(global(world.state, "gain"), 50);
  equal(global(world.state, "busgain"), 50);
  equal(global(world.state, "heldpos"), 0.5);
  equal(global(world.state, "heldgain"), 50);
  equal(global(world.state, "runningbusgain"), 25);
});

test("a pending mp3pause keeps its internal voice alive without returning it", () => {
  const lengths: Record<string, number | null | "pending"> = { "a.wav": "pending" };
  const world = rig(lengths, 'result = mp3pause("a.wav")\ndone = 1');
  world.run(2);
  equal(global(world.state, "done"), 0);
  lengths["a.wav"] = 3;
  world.run(3);
  equal(global(world.state, "done"), 0);
  world.tick();
  equal(global(world.state, "done"), 1);
  equal(world.state.vm.globals["result"], 0);
  deepEqual(world.diagnostics, []);
});

test("a pending ignored same-file request returns null without waiting on the existing voice", () => {
  const lengths: Record<string, number | null | "pending"> = { "a.wav": "pending" };
  const world = rig(lengths, [
    'first = mediaPlay("a.wav", {track: "sfx"})',
    'second = mediaPlay("a.wav", {track: "sfx", wait: 1})',
    "done = 1",
  ].join("\n"));
  world.tick();
  lengths["a.wav"] = 60;
  world.tick();
  equal(global(world.state, "done"), 0);
  world.tick();
  equal(global(world.state, "done"), 1);
  equal(world.state.vm.globals["second"], 0);
  ok(voice(world.state, "sfx", 0) !== undefined);
  deepEqual(world.diagnostics, []);
});

test("a pending waited start with unknown length diagnoses and returns its started voice without parking forever", () => {
  const lengths: Record<string, number | null | "pending"> = { "a.wav": "pending" };
  const world = rig(lengths, 'v = mediaPlay("a.wav", {track: "sfx", wait: 1})\nname = v.track');
  world.tick();
  lengths["a.wav"] = null;
  world.run(2);
  equal(global(world.state, "name"), "sfx");
  equal(world.diagnostics.filter((entry) => entry.code === "media.asset-length").length, 1);
});

test("an unknown-length sync destination diagnoses and starts at zero", () => {
  const world = rig({ "source.wav": 60, "dest.wav": null }, [
    'mediaPlay("source.wav", {track: "ambience"})',
    'v = mediaPlay("dest.wav", {track: "sfx", sync: "ambience"})',
    "pos = v.position",
    "name = v.track",
  ].join("\n"));
  world.tick();
  equal(global(world.state, "name"), "sfx");
  equal(global(world.state, "pos"), 0);
  ok(world.diagnostics.some((entry) => entry.code === "media.sync-source"));
});

test("listeners on an unbound returned voice receive its eventual started event", () => {
  for (const relayActive of [false, true]) {
    const lengths: Record<string, number | null | "pending"> = { "a.wav": "pending" };
    const world = rig(lengths, [
      ...(relayActive ? ['media.on("started", (event) => { relay = 1 })'] : []),
      'v = mediaPlay("a.wav", {track: "sfx"})',
      'v.on("started", (event) => { heard = heard + 1; target = event.target })',
    ].join("\n"));
    world.tick();
    equal(global(world.state, "heard"), 0);
    lengths["a.wav"] = 60;
    world.run(2);
    deepEqual(world.diagnostics, []);
    equal(global(world.state, "heard"), 1, `relay active: ${relayActive}`);
    deepEqual(global(world.state, "target"), global(world.state, "v"));
  }
});
