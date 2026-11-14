// Exercise the launch setup in the real deterministic engine, not a preview or a copied state.
// docs/spec/engine/main-loop-and-startup.md#reawakened-board-test-startup
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  assetKey, createAssetIndex, createEmptyBoard, createEmptyCharacter, createEngine,
  PACKAGE_ROOT, writeBoard, writeCharacter, type GameState, type InputRecord,
} from "@tk-reawakened/core";
import { prepareBoardLaunch, type BoardLaunch } from "@tk-reawakened/platform-services";

function startBoard(coordType: number, x: number, y: number): { state: GameState; hash: string } {
  const empty = createEmptyBoard();
  const board = writeBoard({
    ...empty, sizeX: 4, sizeY: 4, sizeL: 1, coordType,
    tileMatrix: Array<number>(16).fill(0), tileRuns: [{ lutIndex: 0, count: 16, marker: true }],
    layerTitles: ["", ""], programs: [], threads: [],
    properties: { ...empty.properties, backgroundMusic: "", enterPrg: "", start: { x: 96, y: 96, layer: 1 } },
  });
  ok(board.ok);
  const base = createEmptyCharacter();
  const characters = [
    { path: "Chrs/leader.tem", name: "Leader", hp: 7, maxHp: 31, smp: 3, maxSmp: 8, dp: 5, fp: 6 },
    { path: "Chrs/companion.tem", name: "Companion", hp: 19, maxHp: 42, smp: 4, maxSmp: 9, dp: 11, fp: 12 },
  ];
  const files = new Map([[assetKey("Boards/test.brd"), board.value]]);
  for (const character of characters) {
    const encoded = writeCharacter({
      ...base, minor: 5, name: character.name,
      stats: { ...base.stats, hp: character.hp, maxHp: character.maxHp, smp: character.smp, maxSmp: character.maxSmp, dp: character.dp, fp: character.fp },
      movementAnimations: Array<string>(8).fill(""), battleStances: Array<string>(6).fill(""),
    });
    ok(encoded.ok);
    files.set(assetKey(character.path), encoded.value);
  }
  const launch: BoardLaunch = {
    kind: "board", main: "Main/test.gam", projectFolder: "", seed: 23,
    start: { board: "Boards/test.brd", x, y, layer: 1 }, party: characters.map((character) => character.path),
  };
  const prepared = prepareBoardLaunch(launch);
  ok(prepared.ok);
  let observed: GameState | null = null;
  const engine = createEngine({
    seed: launch.seed ?? 0, assetIndex: createAssetIndex([...files.keys()]), assetRoot: PACKAGE_ROOT,
    initialBoard: prepared.value.board, program: prepared.value.program, width: 1, height: 1,
    maxTicks: 5,
    phaseRegistrations: [{ phase: "audio", run(state) { observed = state; } }],
  });
  let inputs: InputRecord[] = [];
  let ticks = 0;
  let hash = "";
  for (let attempt = 0; attempt < 20 && ticks < 5; attempt += 1) {
    const report = engine.advance(5 - ticks, inputs);
    deepEqual(report.diagnostics, []);
    ticks += report.ticksRun;
    hash = report.stateHash;
    inputs = report.requests.flatMap((request): InputRecord[] => request.kind === "asset"
      ? [{ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: files.get(request.key) ?? null } }]
      : []);
  }
  equal(ticks, 5, "the real setup finishes within the bounded asset-delivery loop");
  ok(observed !== null);
  return { state: observed, hash };
}

for (const entry of [
  { label: "one-based tiles", coordType: 0, x: 2, y: 2, position: { x: 48, y: 63 } },
  { label: "absolute pixels including zero", coordType: 4, x: 0, y: 0, position: { x: 0, y: 0 } },
]) {
  test(`board tests use stored party starts, select the first member and apply ${entry.label}`, () => {
    const { state, hash } = startBoard(entry.coordType, entry.x, entry.y);
    const members = state.party.members.map((id) => state.actors.actors.find((actor) => actor.id === id)!);
    deepEqual(members.map((member) => member.name), ["Leader", "Companion"]);
    equal(state.party.selected, members[0]!.id);
    deepEqual(members.map((member) => [member.stats.hp, member.stats.maxHp, member.stats.smp, member.stats.maxSmp, member.stats.dp, member.stats.fp]),
      [[7, 31, 3, 8, 5, 6], [19, 42, 4, 9, 11, 12]]);
    const selected = state.sprites.players.find((player) => player.id === state.sprites.selectedPlayer);
    ok(selected);
    equal(selected.actorId, members[0]!.id);
    deepEqual({ x: selected.x, y: selected.y }, entry.position);
    equal(selected.layer, 1);
    equal(state.world.board?.key, "boards/test.brd");

    state.inventory.gold = 999;
    state.vm.globals.previousrun = 1;
    members[0]!.stats.hp = 1;
    const fresh = startBoard(entry.coordType, entry.x, entry.y);
    equal(fresh.state.inventory.gold, 0, "a new board run does not borrow the preceding inventory");
    equal(fresh.state.vm.globals.previousrun, undefined, "a new board run does not borrow preceding globals");
    equal(fresh.state.actors.actors.find((actor) => actor.id === fresh.state.party.members[0])?.stats.hp, 7);
    equal(fresh.hash, hash, "the same saved inputs and seed reconstruct the same fresh state");
  });
}
