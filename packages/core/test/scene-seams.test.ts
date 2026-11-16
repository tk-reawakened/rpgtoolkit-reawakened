import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { TextEncoder } from "node:util";
import {
  assetKey, createAssetIndex, createEmptyBoard, createEmptyCharacter, createEngine, createSpriteRuntime,
  inputPhaseRegistration, inputResetRegistration, movementPhaseRegistration, triggerPhaseRegistration,
  fileProgramRef, PACKAGE_ROOT, writeBoard, writeCharacter,
  type EffectRecord, type Engine, type GameState, type InputRecord, type ProgramLoader,
  EFFECT_LOG_CAP,
  createGameState,
  drainEffects,
  observeEffects,
  recordDiagnostic,
} from "../src/index.ts";

/** A wall at x 160..192 and a step-on region at x 100..130 that runs the file program `Prg/door.prg`. */
function rig(options: { readonly resume?: string; readonly files?: Map<string, Uint8Array>; readonly setup?: string; readonly size?: number; readonly edgeProgram?: string; readonly extraFiles?: ReadonlyMap<string, Uint8Array>; readonly hideFromLoader?: string; readonly onEffect?: (record: EffectRecord) => void } = {}) {
  const empty = createEmptyBoard();
  const sizeX = options.edgeProgram === undefined ? 10 : 3;
  const board = writeBoard({
    ...empty, sizeX, sizeY: 8, sizeL: 1,
    tileMatrix: Array.from({ length: sizeX * 8 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: sizeX * 8, marker: true }],
    layerTitles: ["", ""],
    vectors: [{ handle: "wall", attributes: 0, closed: 1, layer: 1, type: 1, points: [{ x: 160, y: 32 }, { x: 192, y: 32 }, { x: 192, y: 200 }, { x: 160, y: 200 }] }] as never,
    programs: [{ program: "door.prg", graphic: "", initialVar: "", initialValue: "", finalVar: "", finalValue: "", activate: 0, activationType: 0, repeatDistance: 0, layer: 1, closed: 1, handle: "door", points: [{ x: 100, y: 32 }, { x: 130, y: 32 }, { x: 130, y: 200 }, { x: 100, y: 200 }] }] as never,
    links: { ...empty.links, east: options.edgeProgram ?? "" },
    properties: { ...empty.properties, start: { x: 2, y: 3, layer: 1 } },
  });
  if (!board.ok) throw new Error(board.error.message);
  const hero = writeCharacter({ ...createEmptyCharacter(), minor: 5, name: "Hero", movementAnimations: Array(8).fill(""), battleStances: ["", "", "", "", "", ""] });
  if (!hero.ok) throw new Error(hero.error.message);
  const files = options.files ?? new Map<string, Uint8Array>([
    [assetKey("Boards/wall.brd"), board.value],
    [assetKey("Chrs/hero.tem"), hero.value],
    [assetKey("Prg/door.prg"), new TextEncoder().encode("opened = 1\nend()\n")],
  ]);
  if (options.extraFiles !== undefined) for (const [key, bytes] of options.extraFiles) files.set(key, bytes);
  const index = createAssetIndex([...files.keys()]);
  const loader: ProgramLoader = { index, root: PACKAGE_ROOT, dialect: "tk3", read: (key) => (key === options.hideFromLoader ? undefined : files.get(key)) };
  let state!: GameState;
  const engine: Engine = createEngine({
    seed: 1, assetIndex: index, assetRoot: PACKAGE_ROOT, initialBoard: "wall.brd", programLoader: loader,
    ...(options.resume === undefined ? { program: `AddPlayer("hero.tem")\nSend("wall.brd", 2, 3, 1)\n${options.setup ?? ""}\nwait()\nend()\n` } : { resume: options.resume }),
    width: options.size ?? 640, height: options.size ?? 480, maxTicks: 100000,
    spriteRuntime: createSpriteRuntime(),
    input: { bindings: { keys: {} } },
    resetRegistrations: [inputResetRegistration()],
    phaseRegistrations: [
      inputPhaseRegistration({ pixelMovement: 0 }),
      movementPhaseRegistration({ pixelMovement: 0 }),
      triggerPhaseRegistration({ programRef: (name) => (files.has(assetKey(`Prg/${name}`)) ? fileProgramRef(loader, name) : null) }),
      { phase: "audio", rank: 0, run: (current: GameState) => { state = current; } },
    ],
    ...(options.onEffect === undefined ? {} : { scriptObservers: { onEffect: options.onEffect } }),
  });
  const log: string[] = [];
  const step = (inputs: InputRecord[] = [], ticks = 1): string => {
    let report = engine.advance(ticks, inputs);
    for (let guard = 0; guard < 200 && (report.loading || report.requests.some((request) => request.kind === "asset")); guard += 1) {
      const replies: InputRecord[] = report.requests.flatMap((request) => request.kind === "asset"
        ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }]
        : []);
      report = engine.advance(0, replies);
    }
    ok(!report.loading && !report.requests.some((request) => request.kind === "asset"), "scene asset hydration settled");
    for (const diagnostic of report.diagnostics) log.push(`${diagnostic.code}: ${diagnostic.message}`);
    return report.stateHash;
  };
  return { engine, step, log, state: () => state };
}

const right = (tick: number, down: boolean): InputRecord => ({ tick, event: { kind: "action", action: "right", down, source: "spec.action:1", modalId: null } });

test("a scene with a program loader runs a board's file program", () => {
  const withLoader = rig();
  for (let index = 0; index < 4; index += 1) withLoader.step();
  withLoader.step([right(withLoader.state().time.tick, true)]);
  for (let index = 0; index < 60 && withLoader.state().vm.globals.opened === undefined; index += 1) withLoader.step();
  equal(withLoader.state().vm.globals.opened, 1, "the door program wrote its variable");
  deepEqual(withLoader.log, []);
});

test("a file program the frozen inventory does not hold is a located program.missing, with no wider fallback", () => {
  const hidden = rig({ hideFromLoader: assetKey("Prg/door.prg") });
  for (let index = 0; index < 4; index += 1) hidden.step();
  hidden.step([right(hidden.state().time.tick, true)]);
  for (let index = 0; index < 60; index += 1) hidden.step();
  equal(hidden.state().vm.globals.opened, undefined, "the unnamed program did not run");
  ok(hidden.log.some((entry) => entry.includes("program.missing") && entry.includes("door.prg")), hidden.log.join("|"));
});

test("the scene effect observer receives native command records", () => {
  const seen: string[] = [];
  const observed = rig({ onEffect: (record) => seen.push(record.name) });
  for (let index = 0; index < 6; index += 1) observed.step();
  deepEqual(seen, observed.state().vm.effects.map((record) => record.name), "observation preserves each produced record, including a command's continuation records");
  ok(seen.includes("addplayer") && seen.includes("send"), `saw ${seen.join(",")}`);
  ok(seen.includes("placeplayer"), `saw ${seen.join(",")}`);
});

test("effect production observation retains evicted records and survives log draining", () => {
  const vm = createGameState({ seed: 1 }).vm;
  const seen: number[] = [];
  observeEffects(vm, (record) => seen.push(record.seq));
  const produced = EFFECT_LOG_CAP + 1;
  for (let index = 0; index < produced; index += 1) recordDiagnostic(vm, 0, 1, "probe", "spec.prg", 1, "observed");
  deepEqual(seen, Array.from({ length: produced }, (_, index) => index + 1));
  deepEqual(vm.effects.map((record) => record.seq), seen.slice(1), "the first produced record was really evicted");
  drainEffects(vm);
  recordDiagnostic(vm, 0, 1, "probe", "spec.prg", 1, "after drain");
  deepEqual(seen, Array.from({ length: produced + 1 }, (_, index) => index + 1), "draining does not reset cumulative observation");
  deepEqual(vm.effects.map((record) => record.seq), [produced + 1]);
});

function silentWave(): Uint8Array {
  const bytes = new Uint8Array(4_044);
  const view = new DataView(bytes.buffer);
  bytes.set([82, 73, 70, 70], 0);
  view.setUint32(4, bytes.length - 8, true);
  bytes.set([87, 65, 86, 69, 102, 109, 116, 32], 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8_000, true);
  view.setUint32(28, 8_000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  bytes.set([100, 97, 116, 97], 36);
  view.setUint32(40, 4_000, true);
  bytes.fill(128, 44);
  return bytes;
}

test("scene checkpoints retain audio, registered actions and subsequent hashes exactly", () => {
  const extraFiles = new Map([[assetKey("Media/tone.wav"), silentWave()]]);
  const original = rig({ extraFiles, setup: 'voice = mediaPlay("tone.wav")\nvoice.fade(37, 2)\ndelay(0.1)\nvoice.pause()\n' });
  for (let tick = 0; tick < 4; tick += 1) original.step();
  ok(original.state().audio.tracks.some((track) => track.name === "music" && track.voices.length > 0), "the real script started music");
  ok(original.engine.registerGameAction({ name: "game.inspect", label: "Inspect", icon: null, group: null, controls: [], locked: false, hidden: false }));
  ok(original.engine.checkpoint, "the core exposes full scene checkpoints");
  for (const ticks of [0, 2, 5]) {
    for (let tick = 0; tick < ticks; tick += 1) original.step();
    const checkpoint = original.engine.checkpoint();
    const restored = rig({ resume: checkpoint, extraFiles });
    ok(restored.engine.checkpoint, "the resumed core exposes full scene checkpoints");
    equal(restored.engine.checkpoint() === checkpoint, true, "construction preserves the complete checkpoint");
    restored.step([], 0);
    equal(restored.engine.checkpoint() === checkpoint, true, "resource hydration preserves the complete checkpoint");
    equal(restored.step(), original.step(), "the next real simulation tick has the same state hash");
  }
});

test("scene checkpoints retain the baked red overlay after the live canvas becomes blue", () => {
  const original = rig({
    size: 32,
    setup: 'rendernow(1)\nc = cnvrendernow\ncolorrgb(255,0,0)\nfillrect(0,0,20,20,c)\nsend("wall.brd",2,3,1)\ncolorrgb(0,0,255)\nfillrect(0,0,20,20,c)\n',
  });
  for (let tick = 0; tick < 6; tick += 1) original.step();
  deepEqual(original.log, []);
  const canvas = original.state().surfaces.renderNow;
  ok(canvas !== undefined);
  const live = original.state().surfaces.entries[String(canvas)];
  ok(live);
  const list = original.engine.drawList();
  const overlay = list.commands.find((command) => command.kind === "blit" && "surface" in command.source && command.source.surface === canvas);
  ok(overlay?.kind === "blit" && "surface" in overlay.source);
  ok(overlay.source.rev < live.rev, "the last redraw predates the blue paint");
  const bakedPixels = original.engine.surfacePixels(canvas, overlay.source.rev);
  const livePixels = original.engine.surfacePixels(canvas, live.rev);
  ok(bakedPixels && livePixels);
  deepEqual([...bakedPixels.rgba.subarray(0, 4)], [255, 0, 0, 255]);
  deepEqual([...livePixels.rgba.subarray(0, 4)], [0, 0, 255, 255]);
  ok(original.engine.checkpoint);
  const checkpoint = original.engine.checkpoint();
  const restored = rig({ resume: checkpoint, size: 32 });
  restored.step([], 0);
  deepEqual(restored.log, []);
  deepEqual(restored.engine.drawList(), list, "the resumed waiting program has the same commands");
  deepEqual(restored.engine.surfacePixels(canvas, overlay.source.rev), bakedPixels, "the resumed renderer receives the historical red pixels");
  ok(restored.engine.checkpoint);
  equal(restored.engine.checkpoint() === checkpoint, true, "hydration preserves state and presentation");
  equal(restored.step(), original.step(), "the next real tick has the same state hash");
  deepEqual(restored.engine.drawList(), original.engine.drawList());
  deepEqual(restored.engine.surfacePixels(canvas, overlay.source.rev), bakedPixels);
});

test("scene checkpoint restoration rejects incomplete or malformed presentation before applying it", () => {
  const original = rig({ size: 16 });
  for (let tick = 0; tick < 4; tick += 1) original.step();
  ok(original.engine.checkpoint);
  const envelope = JSON.parse(original.engine.checkpoint()) as { version: number; state: unknown; presentation: Record<string, unknown> };
  const missing = { ...envelope.presentation };
  delete missing.bakedOverlay;
  const malformed = { ...envelope.presentation, bakedOverlay: { id: 1, rev: 0, bitmap: { t: "rgba", w: 1, h: 1, b64: "!!!!AA==" } } };
  for (const [resume, diagnostic] of [
    [JSON.stringify(envelope.state), "version"],
    [JSON.stringify({ ...envelope, version: 2 }), "version"],
    [JSON.stringify({ ...envelope, presentation: missing }), "presentation.bakedOverlay"],
    [JSON.stringify({ ...envelope, presentation: malformed }), "presentation.bakedOverlay.bitmap.b64 is not valid base64"],
  ] as const) {
    const rejected = rig({ resume, size: 16 });
    rejected.step([], 0);
    ok(rejected.log.some((entry) => entry.startsWith("restore.shape:") && entry.includes(diagnostic)), rejected.log.join("|"));
  }
});

test("scene checkpoints keep a finished program's held screen until the next real tick", () => {
  const original = rig({ size: 32, setup: "colorrgb(255,0,0)\nfillrect(0,0,20,20)\ndelay(0.05)\nend()\n" });
  ok(original.engine.checkpoint);
  let checkpoint: string | undefined;
  for (let tick = 0; tick < 8; tick += 1) {
    original.step();
    const candidate = original.engine.checkpoint();
    const boundary = JSON.parse(candidate) as { presentation: { endedProgramThisTick: boolean } };
    if (boundary.presentation.endedProgramThisTick) {
      checkpoint = candidate;
      break;
    }
  }
  ok(checkpoint, "the real program reached its final held frame");
  const frame = original.state().surfaces.entries["0"];
  ok(frame);
  const pixels = original.engine.surfacePixels(frame.id, frame.rev);
  ok(pixels);
  deepEqual([...pixels.rgba.subarray(0, 4)], [255, 0, 0, 255]);
  const list = original.engine.drawList();
  const restored = rig({ resume: checkpoint, size: 32 });
  restored.step([], 0);
  deepEqual(restored.engine.drawList(), list, "zero-tick hydration does not release the held screen");
  deepEqual(restored.engine.surfacePixels(frame.id, frame.rev), pixels);
  ok(restored.engine.checkpoint);
  equal(restored.engine.checkpoint() === checkpoint, true);
  equal(restored.step(), original.step());
  deepEqual(restored.engine.drawList(), original.engine.drawList(), "both runs release the held frame on the same real tick");
});

test("starting a second program discards the first program's baked overlay before checkpointing", () => {
  const files = new Map([[assetKey("Prg/door.prg"), new TextEncoder().encode("secondStarted = 1\ndelay(100)\nend()\n")]]);
  const original = rig({
    size: 32,
    edgeProgram: "door.prg",
    setup: 'rendernow(1)\nc = cnvrendernow\ncolorrgb(255,0,0)\nfillrect(0,0,20,20,c)\nsend("wall.brd",2,3,1)\nend()\n',
    extraFiles: files,
  });
  ok(original.engine.checkpoint);
  let baked = false;
  for (let tick = 0; tick < 8; tick += 1) {
    original.step();
    const capsule = JSON.parse(original.engine.checkpoint()) as { presentation: { bakedOverlay: unknown } };
    baked ||= capsule.presentation.bakedOverlay !== null;
  }
  ok(baked, "the first real program captured its red canvas");
  original.step([right(original.state().time.tick, true)]);
  for (let tick = 0; tick < 60 && original.state().vm.globals.secondstarted !== 1; tick += 1) original.step();
  equal(original.state().vm.globals.secondstarted, 1, `the board edge started the second file program; position ${JSON.stringify(original.state().sprites.players.map(({ x, y }) => ({ x, y })))}; diagnostics ${original.log.join("|")}`);
  const checkpoint = original.engine.checkpoint();
  const capsule = JSON.parse(checkpoint) as { presentation: { bakedOverlay: unknown } };
  equal(capsule.presentation.bakedOverlay, null, "the new program has no baked canvas from its predecessor");
  const restored = rig({ resume: checkpoint, size: 32, edgeProgram: "door.prg", extraFiles: files });
  restored.step([], 0);
  deepEqual(restored.log, []);
  deepEqual(restored.engine.drawList(), original.engine.drawList());
  const frame = original.state().surfaces.entries["0"]!;
  deepEqual(restored.engine.surfacePixels(frame.id, frame.rev), original.engine.surfacePixels(frame.id, frame.rev));
  equal(restored.step(), original.step());
  deepEqual(restored.engine.drawList(), original.engine.drawList());
});

test("a real Reset discards the preceding lifecycle's baked canvas from scene checkpoints", () => {
  const original = rig({
    size: 32,
    setup: 'rendernow(1)\nc = cnvrendernow\ncolorrgb(255,0,0)\nfillrect(0,0,20,20,c)\nsend("wall.brd",2,3,1)\ndelay(0.05)\nreset()\n',
  });
  ok(original.engine.checkpoint);
  let baked = false;
  let reset = false;
  for (let tick = 0; tick < 12; tick += 1) {
    original.step();
    const capsule = JSON.parse(original.engine.checkpoint()) as { presentation: { bakedOverlay: unknown } };
    baked ||= capsule.presentation.bakedOverlay !== null;
    if (baked && original.state().party.members.length === 0) {
      reset = true;
      break;
    }
  }
  ok(baked && reset, "the actual reset ran after a canvas had been baked");
  const checkpoint = original.engine.checkpoint();
  const capsule = JSON.parse(checkpoint) as { presentation: { bakedOverlay: unknown } };
  equal(capsule.presentation.bakedOverlay, null);
  const restored = rig({ resume: checkpoint, size: 32 });
  restored.step([], 0);
  deepEqual(restored.log, []);
  deepEqual(restored.engine.drawList(), original.engine.drawList());
  ok(restored.engine.checkpoint);
  equal(restored.engine.checkpoint(), checkpoint, "rehydration does not resurrect any prior-lifecycle surface");
  equal(restored.step(), original.step());
});
