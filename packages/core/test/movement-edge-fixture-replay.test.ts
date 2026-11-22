// Data-driven engine replay of the movement oracle's edge scene
// (packages/core/test/fixtures/movement/edges-board-link-program.json, R-66/R-53/E-19/E-47/E-48/E-138).
//
// The oracle is authored from docs/spec, never from core output. This test drives the real engine over the
// fixture's setup and script and compares, per tick, the actor rows (position, layer, state, facing), the
// mapped event stream and the fired triggers. The mapping below deliberately covers only facts both sides
// can observe: board lifecycle internals (board-install, place-player, camera-align, music, threads-*,
// enter-program, cache-flushed) and oracle diagnostics (arrival-rejected, board-link, program-link) have no
// core event counterpart and are covered by their own behavioural tests instead.
import { deepEqual, equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEngine,
  enqueueDirectionMove,
  enqueueMove,
  hydrateSprites,
  IR_VERSION,
  movementPhaseRegistration,
  PACKAGE_ROOT,
  readEvent,
  triggerPhaseRegistration,
  writeBoard,
  type Board,
  type Facing,
  type AssetKey,
  type GameState,
  type MovementEvent,
  type PluginDefinition,
  type TriggerEvent,
} from "../src/index.ts";
import { applyEmitterOp } from "../src/events/index.ts";

type FixtureLink = { readonly board?: string; readonly program?: string } | null;
type FixtureVector = {
  readonly id: string;
  readonly type: string;
  readonly layer: number;
  readonly closed?: boolean;
  readonly points: readonly (readonly [number, number])[];
  readonly toLayer?: number;
};
type FixtureProgram = {
  readonly id: string;
  readonly type: string;
  readonly layer: number;
  readonly points: readonly (readonly [number, number])[];
  readonly program: string;
  readonly distanceRepeat?: number;
};
type FixtureBoard = {
  readonly w: number;
  readonly h: number;
  readonly layers?: number;
  readonly pixelMovement?: number;
  readonly vectors?: readonly FixtureVector[];
  readonly programs?: readonly FixtureProgram[];
  readonly links?: Readonly<Record<string, FixtureLink>>;
  readonly enterProgram?: string;
  readonly beforeEnterCancel?: boolean;
  readonly music?: string;
};
type FixturePlayer = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly layer?: number;
  readonly speed?: number;
  readonly facing?: string;
  readonly controlled?: boolean;
  readonly collision?: readonly [number, number, number, number];
};
type FixtureScriptOp = {
  readonly t: number;
  readonly op: string;
  readonly actor?: string;
  readonly dirs?: string;
  readonly clear?: boolean;
  readonly flags?: number;
  readonly points?: readonly (readonly [number, number])[];
};
type FixtureEvent = {
  readonly e: string;
  readonly actor?: string;
  readonly edge?: string;
  readonly dir?: string;
  readonly by?: string;
  readonly blocked?: boolean;
};
type FixtureFired = { readonly kind: string; readonly id: string; readonly program: string };
type FixtureRow = { readonly t: number; readonly a: readonly (readonly (string | number | boolean)[])[]; readonly ev?: readonly FixtureEvent[]; readonly fired?: readonly FixtureFired[] };
type FixtureCase = {
  readonly name: string;
  readonly setup: { readonly board: string; readonly boards: Readonly<Record<string, FixtureBoard>>; readonly players: readonly FixturePlayer[] };
  readonly script: readonly FixtureScriptOp[];
  readonly ticks: number;
  readonly expect: readonly FixtureRow[];
};
type FixtureDocument = { readonly cases: readonly FixtureCase[] };

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "fixtures", "movement", "edges-board-link-program.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as FixtureDocument;
const manifest = JSON.parse(readFileSync(join(here, "fixtures", "movement", "manifest.json"), "utf8")) as {
  readonly scenes: readonly { readonly scene: string; readonly cases: readonly string[] }[];
};

function bytes(board: Board): Uint8Array {
  const encoded = writeBoard(board);
  if (!encoded.ok) throw new Error(encoded.error.message);
  return encoded.value;
}

function coreBoard(def: FixtureBoard): Board {
  const empty = createEmptyBoard();
  const sizeX = def.w / 32;
  const sizeY = def.h / 32;
  if (!Number.isInteger(sizeX) || !Number.isInteger(sizeY)) throw new Error(`board ${def.w}x${def.h} is not a whole tile grid`);
  const sizeL = def.layers ?? 1;
  const cells = sizeX * sizeY * sizeL;
  const link = (slot: string): string => {
    const value = def.links?.[slot] ?? null;
    if (value === null) return "";
    if (value.program !== undefined) return value.program;
    if (value.board !== undefined) return `${value.board}.brd`;
    return "";
  };
  return {
    ...empty,
    sizeX,
    sizeY,
    sizeL,
    coordType: 0,
    tileMatrix: Array.from({ length: cells }, () => 0),
    tileRuns: [{ lutIndex: 0, count: cells, marker: cells > 1 }],
    layerTitles: Array.from({ length: sizeL + 1 }, () => ""),
    vectors: (def.vectors ?? []).map((vector) => ({
      handle: vector.id,
      attributes: vector.toLayer ?? 0,
      closed: vector.closed === true ? 1 : 0,
      layer: vector.layer,
      type: vector.type === "solid" ? 1 : vector.type === "under" ? 2 : vector.type === "stairs" ? 8 : 16,
      points: vector.points.map(([x, y]) => ({ x, y })),
    })),
    programs: (def.programs ?? []).map((program) => ({
      program: program.program,
      graphic: "",
      initialVar: "",
      initialValue: "",
      finalVar: "",
      finalValue: "",
      activate: 0,
      activationType: program.type === "key" ? 1 : program.type === "repeat" ? 2 : 0,
      repeatDistance: program.distanceRepeat ?? 0,
      layer: program.layer,
      points: program.points.map(([x, y]) => ({ x, y })),
      closed: 1,
      handle: program.id,
    })),
    links: { north: link("N"), south: link("S"), east: link("E"), west: link("W") },
    properties: { ...empty.properties, enterPrg: def.enterProgram ?? "", backgroundMusic: def.music ?? "" },
  };
}

function rectBase(collision: readonly [number, number, number, number]) {
  const [x0, y0, x1, y1] = collision;
  return { points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] };
}

type Observed = { readonly tick: number; readonly key: string };

function fixtureEventKey(event: FixtureEvent): string | null {
  switch (event.e) {
    case "blocked": return `blocked:${event.actor ?? ""}:${event.edge !== undefined ? `edge:${event.edge}` : `by:${event.by ?? ""}`}`;
    case "step-complete": return `step-complete:${event.actor ?? ""}`;
    case "movement-complete": return `movement-complete:${event.actor ?? ""}:${event.blocked === true}`;
    case "edge-exit": return `edge-exit:${event.actor ?? ""}:${event.dir ?? ""}`;
    case "before-enter": return "before-enter";
    default: return null;
  }
}

function coreEventKey(event: MovementEvent): string | null {
  switch (event.type) {
    case "blocked": return `blocked:${event.actor ?? ""}:${event.edge !== undefined ? `edge:${event.edge}` : `by:${event.vector ?? event.blocker ?? ""}`}`;
    case "step-complete": return `step-complete:${event.actor ?? ""}`;
    case "movement-complete": return `movement-complete:${event.actor ?? ""}:${event.blocked === true}`;
    case "edge-exit": return `edge-exit:${event.actor ?? ""}:${event.direction ?? ""}`;
    default: return null;
  }
}

function actorRows(state: GameState): (string | number | boolean)[][] {
  return [...state.sprites.players, ...state.sprites.items].map((actor) => [
    actor.id, actor.x, actor.y, actor.layer, actor.visible ? actor.state : "hidden", actor.facing,
  ]);
}

function replay(testCase: FixtureCase): { readonly rows: { readonly t: number; readonly a: (string | number | boolean)[][]; readonly ev: string[]; readonly fired: string[] }[] } {
  const setup = testCase.setup;
  const source = setup.boards[setup.board];
  if (source === undefined) throw new Error(`${testCase.name}: setup.board is not in setup.boards`);
  const observed: Observed[] = [];
  const applied = new Set<number>();
  let seeded = false;
  const rows: { t: number; a: (string | number | boolean)[][]; ev: string[]; fired: string[] }[] = [];
  let currentPrograms: readonly FixtureProgram[] = [];
  const target = setup.boards.east;
  const cancel = target?.beforeEnterCancel === true;
  const plugin: PluginDefinition = {
    id: "edge-replay",
    version: "1.0.0",
    commands: [
      {
        name: "recordbeforeenter",
        aliases: [],
        params: [{ name: "event", optional: false, byRef: false, variadic: false }],
        call: (view: { readonly state?: GameState }, args: readonly { readonly value: unknown }[]) => {
          if (view.state !== undefined && readEvent(view.state, args[0]?.value as never) !== undefined) {
            observed.push({ tick: view.state.time.tick, key: "before-enter" });
          }
          return { value: 0 };
        },
      },
      {
        name: "cancelbeforeenter",
        aliases: [],
        params: [{ name: "event", optional: false, byRef: false, variadic: false }],
        call: (view: { readonly state?: GameState }, args: readonly { readonly value: unknown }[]) => {
          if (view.state !== undefined) applyEmitterOp(view.state.vm, view.state.events, "cancel", args[0]?.value as never, [], null);
          return { value: 0 };
        },
      },
    ],
    // Two listeners for the cancel case: the recorder observes that beforeEnter ran (the oracle records
    // the event whether or not it cancels), then the canceller makes the crossing refused.
    listeners: cancel
      ? [
        { emitter: "board:boards/east.brd", type: "beforeEnter", command: "recordbeforeenter" },
        { emitter: "board:boards/east.brd", type: "beforeEnter", command: "cancelbeforeenter" },
      ]
      : [{ emitter: "board:boards/east.brd", type: "beforeEnter", command: "recordbeforeenter" }],
  };
  const boardNames = Object.keys(setup.boards);
  const assets = new Map<AssetKey, Uint8Array>();
  for (const [name, def] of Object.entries(setup.boards)) assets.set(assetKey(`boards/${name}.brd`), bytes(coreBoard(def)));
  const engine = createEngine({
    seed: 71,
    assetIndex: createAssetIndex(boardNames.map((name) => `Boards/${name}.brd`)),
    assetRoot: PACKAGE_ROOT,
    initialBoard: `${setup.board}.brd`,
    width: 320,
    height: 320,
    maxTicks: testCase.ticks,
    initialAssets: assets,
    plugins: [{ definition: plugin }],
    phaseRegistrations: [
      {
        phase: "input",
        rank: -1,
        run: (state) => {
          if (state.world.board === null || state.world.board === undefined) return;
          if (!seeded) {
            seeded = true;
            state.sprites = hydrateSprites({
              board: state.world.board,
              players: setup.players.map((player) => ({
                id: player.id,
                source: `${player.id}.tem`,
                kind: "player",
                x: player.x,
                y: player.y,
                layer: player.layer ?? 0,
                facing: (player.facing ?? "S") as Facing,
                controlled: player.controlled ?? true,
              })),
            });
            state.sprites.players = state.sprites.players.map((actor) => {
              const def = setup.players.find((player) => player.id === actor.id);
              if (def === undefined) return actor;
              return {
                ...actor,
                speed: def.speed ?? actor.speed,
                ...(def.collision === undefined ? {} : { collisionBase: rectBase(def.collision) }),
              };
            });
          }
          const tick = state.time.tick;
          if (applied.has(tick)) return;
          applied.add(tick);
          for (const op of testCase.script.filter((command) => command.t === tick)) {
            if (op.actor === undefined) continue;
            if (op.op === "push" && op.dirs !== undefined) {
              const dirs = op.dirs.split(",").map((value) => value.trim()).filter((value) => value !== "");
              dirs.forEach((direction, index) => {
                enqueueDirectionMove(state.sprites, op.actor!, direction as Facing, source.pixelMovement ?? 0, op.clear === true && index === 0);
              });
            } else if (op.op === "path" && op.flags === 0 && op.points !== undefined) {
              for (const [x, y] of op.points) {
                enqueueMove(state.sprites, op.actor, { source: "points", target: { x, y }, facing: null, provenance: { kind: "script", thread: 0 } });
              }
            } else {
              throw new Error(`${testCase.name}: unsupported script op ${op.op} (flags ${op.flags ?? 0})`);
            }
          }
        },
      },
      { phase: "movement", rank: -100, run: (state) => { currentPrograms = setup.boards[Object.keys(setup.boards).find((name) => `boards/${name}.brd` === state.world.board?.key) ?? ""]?.programs ?? []; } },
      movementPhaseRegistration({
        pixelMovement: source.pixelMovement ?? 0,
        onEvent: (event) => {
          const key = coreEventKey(event);
          if (key !== null) observed.push({ tick: event.tick, key });
        },
      }),
      triggerPhaseRegistration({
        programRef: () => ({ kind: "inline", text: "end()\n", ir: IR_VERSION }),
        onEvent: (event: TriggerEvent) => {
          if (event.type !== "trigger-start") return;
          const match = /^region:(\d+)$/.exec(event.key);
          const region = match === null ? undefined : currentPrograms[Number(match[1])];
          observed.push({ tick: event.tick, key: `fired:${region?.id ?? event.key}` });
        },
      }),
      {
        phase: "audio",
        run: (state) => {
          const tick = state.time.tick;
          const keys = observed.filter((entry) => entry.tick === tick).map((entry) => entry.key);
          rows.push({
            t: tick,
            a: actorRows(state),
            ev: keys.filter((key) => !key.startsWith("fired:")),
            fired: keys.filter((key) => key.startsWith("fired:")).map((key) => key.slice("fired:".length)),
          });
        },
      },
    ],
  });
  let result = engine.advance(0, []);
  let iterations = 0;
  while (rows.length < testCase.ticks && iterations < testCase.ticks * 4 + 16) {
    iterations += 1;
    const replies = result.requests.flatMap((request) => {
      if (request.kind !== "asset") return [];
      const content = assets.get(request.key);
      if (content === undefined) throw new Error(`${testCase.name}: unexpected asset request ${request.key}`);
      return [{ tick: result.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: content } }];
    });
    const next = engine.advance(1, replies);
    result = next;
    if (next.ticksRun === 0 && replies.length === 0 && next.requests.length === 0) break;
  }
  for (const diagnostic of result.diagnostics) {
    if (diagnostic.code !== "asset.missing") throw new Error(`${testCase.name}: ${diagnostic.code}: ${diagnostic.message}`);
  }
  equal(rows.length, testCase.ticks, `${testCase.name}: all ticks ran`);
  return { rows };
}

test("edges-board-link-program: the committed fixture replays through the real engine", () => {
  const entry = manifest.scenes.find((scene) => scene.scene === "edges-board-link-program");
  deepEqual(entry?.cases, fixture.cases.map((testCase) => testCase.name), "every manifest case is replayed");
  for (const testCase of fixture.cases) {
    const { rows } = replay(testCase);
    for (const expected of testCase.expect) {
      const actual = rows[expected.t];
      if (actual === undefined) throw new Error(`${testCase.name} t${expected.t}: row is missing`);
      equal(actual.t, expected.t, `${testCase.name} t${expected.t}: row exists`);
      deepEqual(actual.a, expected.a.map((row) => [...row]), `${testCase.name} t${expected.t}: actors`);
      const events = (expected.ev ?? []).map(fixtureEventKey).filter((key): key is string => key !== null);
      deepEqual(actual.ev, events, `${testCase.name} t${expected.t}: events`);
      deepEqual(actual.fired, (expected.fired ?? []).map((entry) => entry.id), `${testCase.name} t${expected.t}: fired`);
    }
  }
});
