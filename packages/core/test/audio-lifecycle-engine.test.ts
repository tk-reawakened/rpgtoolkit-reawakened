import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEngine,
  CORE_PLUGIN,
  MEDIA_PLUGIN,
  PACKAGE_ROOT,
  readEvent,
  writeBoard,
  type AssetIndex,
  type Engine,
  type GameState,
  type PluginDefinition,
  type TickReport,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const wav = readFileSync(join(here, "fixtures", "audio", "files", "pcm8-mono-8000.wav"));

function boardBytes(): Uint8Array {
  const encoded = writeBoard(createEmptyBoard());
  if (!encoded.ok) throw new Error(encoded.error.message);
  return encoded.value;
}

type EventRecord = {
  readonly scope: string;
  readonly type: string;
  readonly detail: Record<string, unknown>;
};

type Fixture = {
  readonly files: Map<string, Uint8Array>;
  readonly index: AssetIndex;
};

function fixture(): Fixture {
  const files = new Map<string, Uint8Array>([
    [assetKey("Boards/start.brd"), boardBytes()],
    [assetKey("Media/step.wav"), new Uint8Array(wav)],
    [assetKey("Media/other.wav"), new Uint8Array(wav)],
  ]);
  return { files, index: createAssetIndex([...files.keys()]) };
}

function lifecyclePlugin(events: EventRecord[]): PluginDefinition {
  const record = (scope: string) => ({
    name: `recordaudioevent_${scope}`,
    aliases: [],
    params: [{ name: "event", optional: false, byRef: false, variadic: false }],
    call: (view: { readonly state?: GameState }, args: readonly { readonly value: unknown }[]) => {
      if (view.state !== undefined) {
        const event = readEvent(view.state, args[0]?.value as never);
        if (event !== undefined) events.push({ scope, type: event.type, detail: event.detail });
      }
      return { value: 0 };
    },
  }) satisfies PluginDefinition["commands"][number];
  return {
    id: "audio-lifecycle-test",
    version: "1.0.0",
    commands: [record("voice"), record("track"), record("media")],
    listeners: [
      { emitter: "media.voice:sfx:0:2", type: "started", command: "recordaudioevent_voice" },
      { emitter: "media.track:sfx", type: "started", command: "recordaudioevent_track" },
      { emitter: "media", type: "started", command: "recordaudioevent_media" },
      { emitter: "media.voice:sfx:0:2", type: "ended", command: "recordaudioevent_voice" },
      { emitter: "media.track:sfx", type: "ended", command: "recordaudioevent_track" },
      { emitter: "media", type: "ended", command: "recordaudioevent_media" },
      { emitter: "media", type: "stopped", command: "recordaudioevent_media" },
    ],
  };
}


function advanceAll(engine: Engine, files: Map<string, Uint8Array>, ticks: number): TickReport[] {
  const reports: TickReport[] = [];
  let remaining = ticks;
  let reply = [] as Parameters<typeof engine.advance>[1];
  for (let guard = 0; guard < 200; guard += 1) {
    const report = engine.advance(Math.max(0, remaining), reply);
    reports.push(report);
    remaining -= report.ticksRun;
    reply = report.requests.flatMap((request) => request.kind === "asset"
      ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }]
      : []);
    if (report.loading) continue;
    if (remaining <= 0 || report.ticksRun === 0) return reports;
  }
  throw new Error("authored asset driver did not settle");
}

function makeEngine(game: Fixture, events: EventRecord[], program: string) {
  return createEngine({
    seed: 31,
    assetIndex: game.index,
    assetRoot: PACKAGE_ROOT,
    initialBoard: "start.brd",
    width: 32,
    height: 32,
    maxTicks: 120,
    program,
    plugins: [{ definition: CORE_PLUGIN }, { definition: MEDIA_PLUGIN }, { definition: lifecyclePlugin(events) }],
  });
}

function publicEvents(events: readonly EventRecord[]): unknown[] {
  return events.map(({ scope, type, detail }) => ({ scope, type, detail }));
}

test("scripted legacy wav emits exact voice, track, and media lifecycle events FIFO", () => {
  const game = fixture();
  const events: EventRecord[] = [];
  const engine = makeEngine(game, events, 'wav("step.wav")\nthreadSleep(getThreadId(), 1)\nend()\n');
  const reports = advanceAll(engine, game.files, 45);

  ok(reports.some((report) => report.audioCues.some((cue) => cue.kind === "media.play")));
  equal(events.length, 6);
  deepEqual(events.slice(0, 3).map((event) => event.scope), ["voice", "track", "media"]);
  deepEqual(events.slice(0, 3).map((event) => event.type), ["started", "started", "started"]);
  deepEqual(events.slice(3).map((event) => event.scope), ["voice", "track", "media"]);
  deepEqual(events.slice(3).map((event) => event.type), ["ended", "ended", "ended"]);
  for (const event of events) {
    deepEqual(Object.keys(event.detail).sort(), ["cueId", "file", "slot", "tick", "track"]);
    equal(event.detail.track, "sfx");
    equal(event.detail.slot, 0);
    equal(event.detail.cueId, 2);
    equal(event.detail.file, "media/step.wav");
    equal(typeof event.detail.tick, "number");
  }
});

test("audio lifecycle delivery is replay-stable under different advance batching", () => {
  const game = fixture();
  const run = (batch: number) => {
    const events: EventRecord[] = [];
    const engine = makeEngine(game, events, 'wav("step.wav")\nthreadSleep(getThreadId(), 1)\nend()\n');
    let remaining = 45;
    while (remaining > 0) {
      const reports = advanceAll(engine, game.files, Math.min(batch, remaining));
      const consumed = reports.reduce((sum, report) => sum + report.ticksRun, 0);
      ok(consumed > 0, "batch must make simulation progress");
      remaining -= consumed;
    }
    return { events: publicEvents(events), final: engine.advance(0, []).stateHash };
  };
  const one = run(1);
  const seven = run(7);
  deepEqual(seven.events, one.events);
  equal(seven.final, one.final);
});

test("unknown and duplicate audio.ended replies are advisory and do not alter state or lifecycle history", () => {
  const game = fixture();
  const noisyEvents: EventRecord[] = [];
  const cleanEvents: EventRecord[] = [];
  const noisy = makeEngine(game, noisyEvents, 'wav("step.wav")\nthreadSleep(getThreadId(), 1)\nend()\n');
  const clean = makeEngine(game, cleanEvents, 'wav("step.wav")\nthreadSleep(getThreadId(), 1)\nend()\n');
  const noisyFirst = advanceAll(noisy, game.files, 5).at(-1)!;
  advanceAll(clean, game.files, 5);
  const noisyResult = noisy.advance(1, [
    { tick: noisyFirst.tickAfter, event: { kind: "audio.ended", cueId: 999 } },
    { tick: noisyFirst.tickAfter, event: { kind: "audio.ended", cueId: 2 } },
    { tick: noisyFirst.tickAfter, event: { kind: "audio.ended", cueId: 2 } },
  ]);
  const cleanResult = clean.advance(1, []);
  equal(noisyResult.stateHash, cleanResult.stateHash);
  equal(noisyEvents.length, 3);
  deepEqual(publicEvents(noisyEvents), publicEvents(cleanEvents));
  const last = advanceAll(noisy, game.files, 40).at(-1)!;
  advanceAll(clean, game.files, 40);
  equal(noisyEvents.filter((event) => event.type === "ended").length, 3);
  const late = noisy.advance(1, [
    { tick: last.tickAfter, event: { kind: "audio.ended", cueId: 2 } },
    { tick: last.tickAfter, event: { kind: "audio.ended", cueId: 2 } },
  ]);
  equal(late.stateHash, clean.advance(1, []).stateHash);
  deepEqual(publicEvents(noisyEvents), publicEvents(cleanEvents));
});

test("event detail casing and values are stable across a real authored source", () => {
  const game = fixture();
  const events: EventRecord[] = [];
  const engine = makeEngine(game, events, 'wav("STEP.WAV")\nthreadSleep(getThreadId(), 1)\nend()\n');
  advanceAll(engine, game.files, 5);
  equal(events[0]?.detail.track, "sfx");
  equal(events[0]?.detail.file, "media/step.wav");
  equal(events[0]?.detail.slot, 0);
});
 
test("replacement reports stopped before the replacement started transition", () => {
  const game = fixture();
  const events: EventRecord[] = [];
  const engine = makeEngine(game, events, 'wav("step.wav")\nwav("other.wav")\nthreadSleep(getThreadId(), 1)\nend()\n');
  advanceAll(engine, game.files, 5);
  const shared = events.filter((event) => event.scope === "media");
  deepEqual(shared.map((event) => event.type), ["started", "stopped", "started"]);
  deepEqual(shared.map((event) => event.detail.file), ["media/step.wav", "media/step.wav", "media/other.wav"]);
});

 

for (const action of ["", "wavStop()", 'mediaPlay("other.wav", {track: "sfx"})']) {
  test(`natural end waiter race: ${action || "no mutation"} before audio retirement`, () => {
    const game = fixture();
    const events: EventRecord[] = [];
    const engine = makeEngine(game, events, `v = mediaPlay("step.wav", {track: "sfx"})\nthreadSleep(getThreadId(), 0.05)\nv.wait()\n${action}\nthreadSleep(getThreadId(), 1)\nend()`);
    const reports = advanceAll(engine, game.files, 40);
    deepEqual(reports.flatMap((report) => report.diagnostics), []);
    const shared = events.filter((event) => event.scope === "media");
    deepEqual(shared.map((event) => event.type), action === "" ? ["started", "ended"]
      : action === "wavStop()" ? ["started", "stopped"] : ["started", "ended", "started"]);
    const initial = shared[0]!.detail;
    const completion = shared[1]!.detail;
    equal(completion.tick, Number(initial.tick) + 30);
    equal(completion.cueId, initial.cueId);
  });
}
