// R-66 linked-edge preflight through the real engine: the destination is loaded for checking only,
// R-53's arrival is tested (bounds, layer count, exact solid), and its cancelable `beforeEnter` runs
// before anything commits (docs/spec/engine/movement-and-collision.md#r-66; ADR 0040).
import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  createAssetIndex,
  createEmptyBoard,
  createEngine,
  enqueueDirectionMove,
  hydrateSprites,
  movementPhaseRegistration,
  PACKAGE_ROOT,
  writeBoard,
  type Board,
  type GameState,
  type MovementEvent,
  type PluginDefinition,
} from "../src/index.ts";
import { applyEmitterOp } from "../src/events/index.ts";

function bytes(board: Board): Uint8Array {
  const encoded = writeBoard(board);
  if (!encoded.ok) throw new Error(encoded.error.message);
  return encoded.value;
}

function board(sizeX: number, sizeY: number, options: { links?: Partial<Board["links"]>; vectors?: Board["vectors"]; enterPrg?: string; sizeL?: number } = {}): Board {
  const empty = createEmptyBoard();
  const cells = sizeX * sizeY;
  return {
    ...empty,
    sizeX,
    sizeY,
    sizeL: options.sizeL ?? 1,
    tileMatrix: Array.from({ length: cells }, () => 0),
    tileRuns: [{ lutIndex: 0, count: cells, marker: cells > 1 }],
    layerTitles: Array.from({ length: (options.sizeL ?? 1) + 1 }, () => ""),
    links: { ...empty.links, ...options.links },
    vectors: options.vectors ?? [],
    properties: { ...empty.properties, enterPrg: options.enterPrg ?? "" },
  };
}

const source = (links: Partial<Board["links"]>, vectors: Board["vectors"] = []) => board(10, 10, { links, vectors });
const rubble: NonNullable<Board["vectors"]> = [
  { handle: "rubble", attributes: 0, closed: 1, layer: 0, type: 1, points: [{ x: 0, y: 64 }, { x: 64, y: 64 }, { x: 64, y: 128 }, { x: 0, y: 128 }] },
];

type Observation = {
  readonly board: string | null;
  readonly x: number | null;
  readonly y: number | null;
  readonly pending: string | null;
  readonly queued: number;
  readonly steps: number;
  readonly events: readonly MovementEvent[];
};
type Facts = Observation & {
  readonly diagnostics: readonly string[];
  readonly history: readonly { readonly board: string | null; readonly x: number | null; readonly y: number | null; readonly pending: string | null }[];
};

type PreflightCase = {
  readonly destination?: Board;
  readonly sourceLinks?: Partial<Board["links"]>;
  readonly sourceVectors?: Board["vectors"];
  readonly playerLayer?: number;
  readonly collisionBase?: readonly { readonly x: number; readonly y: number }[];
  readonly dirs?: readonly ("E" | "N")[];
  readonly holdReplyTicks?: number;
  readonly cancelBeforeEnter?: boolean;
  readonly index?: readonly string[];
};

function runPreflightCase(options: PreflightCase = {}): Facts {
  const links = options.sourceLinks ?? { east: "east.brd" };
  const from = source(links, options.sourceVectors ?? []);
  const destination = options.destination ?? board(10, 10, {});
  const events: MovementEvent[] = [];
  const diagnostics: string[] = [];
  const history: { board: string | null; x: number | null; y: number | null; pending: string | null }[] = [];
  let seeded = false;
  const observed: { value: Observation | null } = { value: null };
  const plugin: PluginDefinition = {
    id: "edge-cancel",
    version: "1.0.0",
    commands: [{
      name: "cancelbeforeenter",
      aliases: [],
      params: [{ name: "event", optional: false, byRef: false, variadic: false }],
      call: (view: { readonly state?: GameState }, args: readonly { readonly value: unknown }[]) => {
        if (view.state !== undefined) applyEmitterOp(view.state.vm, view.state.events, "cancel", args[0]?.value as never, [], null);
        return { value: 0 };
      },
    }],
    listeners: options.cancelBeforeEnter === true
      ? [{ emitter: "board:boards/east.brd", type: "beforeEnter", command: "cancelbeforeenter" }]
      : [],
  };
  const engine = createEngine({
    seed: 71,
    assetIndex: createAssetIndex(options.index ?? ["Boards/west.brd", "Boards/east.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "west.brd",
    width: 320,
    height: 320,
    maxTicks: 12,
    plugins: [{ definition: plugin }],
    phaseRegistrations: [
      {
        phase: "movement",
        rank: -1,
        run: (state) => {
          if (seeded) return;
          const currentBoard = state.world.board;
          if (currentBoard === null || currentBoard === undefined) return;
          seeded = true;
          state.sprites = hydrateSprites({
            board: currentBoard,
            players: [{ id: "hero", source: "hero.tem", kind: "player", x: 304, y: 95, layer: options.playerLayer ?? 0, facing: "E", controlled: true }],
          });
          if (options.collisionBase !== undefined) {
            state.sprites.players = state.sprites.players.map((actor) => ({ ...actor, collisionBase: { points: options.collisionBase!.map((point) => ({ ...point })) } }));
          }
          for (const direction of options.dirs ?? ["E"]) enqueueDirectionMove(state.sprites, "hero", direction);
        },
      },
      movementPhaseRegistration({ onEvent: (record) => { events.push(record); } }),
      {
        phase: "audio",
        run: (state) => {
          const player = state.sprites.players[0];
          history.push({ board: state.world.board?.key ?? null, x: player?.x ?? null, y: player?.y ?? null, pending: player?.movement.pendingExit ?? null });
          observed.value = {
            board: state.world.board?.key ?? null,
            x: player?.x ?? null,
            y: player?.y ?? null,
            pending: player?.movement.pendingExit ?? null,
            queued: player?.queue.moves.length ?? 0,
            steps: state.party.steps,
            events: [...events],
          };
        },
      },
    ],
  });
  const hold = options.holdReplyTicks ?? 0;
  type AssetReply = { readonly tick: number; readonly event: { readonly kind: "asset"; readonly reqId: number; readonly bytes: Uint8Array } };
  let result = engine.advance(0, []);
  let elapsed = 0;
  let iterations = 0;
  let held: { readonly reqId: number; readonly seen: number } | null = null;
  while (elapsed < 12 && iterations < 24) {
    iterations += 1;
    const replies: AssetReply[] = [];
    for (const request of result.requests) {
      if (request.kind !== "asset") continue;
      if (request.key === "boards/east.brd" && held === null && hold > 0) {
        held = { reqId: request.reqId, seen: iterations };
        continue;
      }
      const content = request.key === "boards/west.brd" ? from : destination;
      replies.push({ tick: result.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: bytes(content) } });
    }
    if (held !== null && iterations - held.seen >= hold) {
      replies.push({ tick: result.tickAfter, event: { kind: "asset", reqId: held.reqId, bytes: bytes(destination) } });
      held = null;
    }
    const next = engine.advance(1, replies);
    if (next.ticksRun === 0 && next.requests.length === 0 && held === null && replies.length === 0) break;
    elapsed += next.ticksRun;
    result = next;
    for (const diagnostic of next.diagnostics) diagnostics.push(diagnostic.code);
  }
  const latest = observed.value;
  if (latest === null) throw new Error("the audio observation never ran");
  return { ...latest, diagnostics, history };
}

test("R-66: an accepted crossing is a placement, not a completed step", () => {
  const facts = runPreflightCase({ dirs: ["E", "E"] });
  equal(facts.board, "boards/east.brd");
  deepEqual([facts.x, facts.y], [15, 95]);
  equal(facts.pending, null);
  equal(facts.queued, 0, "placement cancels the active step and the queue");
  equal(facts.steps, 0, "placement is not travel");
  equal(facts.events.some((record) => record.type === "step-complete"), false);
  equal(facts.events.some((record) => record.type === "edge-exit" && record.direction === "E"), true);
  equal(facts.events.some((record) => record.type === "blocked"), false);
});

test("R-66: a solid arrival is refused and the queued step behind it runs on the source board", () => {
  const facts = runPreflightCase({ destination: board(10, 10, { vectors: rubble }), dirs: ["E", "N"] });
  equal(facts.board, "boards/west.brd");
  equal(facts.x, 304);
  deepEqual(facts.events.filter((record) => record.type === "blocked").map((record) => record.edge), ["E"]);
  equal(facts.events.some((record) => record.type === "step-complete" && record.actor === "hero"), false, "the refused E step did not complete");
  equal(facts.events.some((record) => record.type === "edge-exit"), false);
  equal(facts.y !== 95, true, "the queued north step still ran");
  equal(facts.pending, null);
});

test("R-66: a destination layer count refusal keeps the player and queue on the source board", () => {
  const facts = runPreflightCase({ destination: board(10, 10, { sizeL: 1 }), playerLayer: 1, dirs: ["E"] });
  equal(facts.board, "boards/west.brd");
  deepEqual([facts.x, facts.y], [304, 95]);
  deepEqual(facts.events.filter((record) => record.type === "blocked").map((record) => record.edge), ["E"]);
  equal(facts.queued, 0, "the refused step is the only entry and it is consumed");
});

test("R-66: a collision base that cannot fit the destination is a refused bounds arrival", () => {
  const facts = runPreflightCase({
    collisionBase: [{ x: -200, y: -15 }, { x: 200, y: -15 }, { x: 200, y: 0 }, { x: -200, y: 0 }],
    dirs: ["E"],
  });
  equal(facts.board, "boards/west.brd");
  deepEqual([facts.x, facts.y], [304, 95]);
  deepEqual(facts.events.filter((record) => record.type === "blocked").map((record) => record.edge), ["E"]);
});

test("R-66: a missing destination board is refused with the existing diagnostic", () => {
  const facts = runPreflightCase({ sourceLinks: { east: "missing.brd" }, dirs: ["E"] });
  equal(facts.board, "boards/west.brd");
  deepEqual([facts.x, facts.y], [304, 95]);
  equal(facts.diagnostics.includes("asset.missing"), true);
  equal(facts.events.some((record) => record.type === "edge-exit"), false);
  deepEqual(facts.events.filter((record) => record.type === "blocked").map((record) => record.edge), ["E"]);
  equal(facts.queued, 0, "the refused step is consumed, not silently retried in place");
});

test("R-66: a cancelling beforeEnter refuses the crossing before anything commits", () => {
  const facts = runPreflightCase({ cancelBeforeEnter: true, dirs: ["E"] });
  equal(facts.board, "boards/west.brd");
  deepEqual([facts.x, facts.y], [304, 95]);
  equal(facts.events.some((record) => record.type === "blocked"), true);
  equal(facts.events.some((record) => record.type === "edge-exit"), false);
});

test("R-66: a destination still loading leaves the step unstarted until the bytes arrive", () => {
  const facts = runPreflightCase({ holdReplyTicks: 3, dirs: ["E"] });
  equal(facts.board, "boards/east.brd");
  deepEqual([facts.x, facts.y], [15, 95]);
  const waiting = facts.history.filter((row) => row.board === "boards/west.brd");
  equal(waiting.length > 0, true, "the player waits on the source board while the board is fetched");
  deepEqual(waiting.map((row) => [row.x, row.y, row.pending]), waiting.map(() => [304, 95, null]), "nothing committed while the fetch is pending");
  equal(facts.events.some((record) => record.type === "blocked"), false);
});
