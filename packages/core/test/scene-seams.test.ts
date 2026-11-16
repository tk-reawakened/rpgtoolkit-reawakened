import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  assetKey, createAssetIndex, createEmptyBoard, createEmptyCharacter, createEngine, createSpriteRuntime,
  inputPhaseRegistration, inputResetRegistration, movementPhaseRegistration, triggerPhaseRegistration,
  fileProgramRef, PACKAGE_ROOT, writeBoard, writeCharacter,
  type EffectRecord, type Engine, type GameState, type InputRecord, type ProgramLoader,
} from "../src/index.ts";

/** A wall at x 160..192 and a step-on region at x 100..130 that runs the file program `Prg/door.prg`. */
function rig(options: { readonly resume?: string; readonly files?: Map<string, Uint8Array>; readonly hideFromLoader?: string; readonly onEffect?: (record: EffectRecord) => void } = {}) {
  const empty = createEmptyBoard();
  const board = writeBoard({
    ...empty, sizeX: 10, sizeY: 8, sizeL: 1,
    tileMatrix: Array.from({ length: 80 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 80, marker: true }],
    layerTitles: ["", ""],
    vectors: [{ handle: "wall", attributes: 0, closed: 1, layer: 1, type: 1, points: [{ x: 160, y: 32 }, { x: 192, y: 32 }, { x: 192, y: 200 }, { x: 160, y: 200 }] }] as never,
    programs: [{ program: "door.prg", graphic: "", initialVar: "", initialValue: "", finalVar: "", finalValue: "", activate: 0, activationType: 0, repeatDistance: 0, layer: 1, closed: 1, handle: "door", points: [{ x: 100, y: 32 }, { x: 130, y: 32 }, { x: 130, y: 200 }, { x: 100, y: 200 }] }] as never,
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
  const index = createAssetIndex([...files.keys()]);
  const loader: ProgramLoader = { index, root: PACKAGE_ROOT, dialect: "tk3", read: (key) => (key === options.hideFromLoader ? undefined : files.get(key)) };
  let state!: GameState;
  const engine: Engine = createEngine({
    seed: 1, assetIndex: index, assetRoot: PACKAGE_ROOT, initialBoard: "wall.brd", programLoader: loader,
    ...(options.resume === undefined ? { program: 'AddPlayer("hero.tem")\nSend("wall.brd", 2, 3, 1)\nwait()\nend()\n' } : { resume: options.resume }),
    width: 640, height: 480, maxTicks: 100000,
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
  const step = (inputs: InputRecord[] = []): string => {
    let report = engine.advance(1, inputs);
    for (let guard = 0; guard < 200 && (report.loading || report.requests.some((request) => request.kind === "asset")); guard += 1) {
      const replies: InputRecord[] = report.requests.flatMap((request) => request.kind === "asset"
        ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }]
        : []);
      report = engine.advance(0, replies);
    }
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

test("the effect observer sees every record at production, including ones the log later drops", () => {
  const seen: string[] = [];
  const observed = rig({ onEffect: (record) => seen.push(record.name) });
  for (let index = 0; index < 6; index += 1) observed.step();
  ok(seen.includes("addplayer") && seen.includes("send") && seen.includes("placeplayer"), `saw ${seen.join(",")}`);
  const logged = observed.state().vm.effects.map((record) => record.name);
  ok(seen.length >= logged.length, "the observer saw at least what survives in the log");
});
