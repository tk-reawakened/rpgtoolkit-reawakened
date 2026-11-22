// R-66 linked-edge preflight through the real engine: the destination is loaded for checking only,
// R-53's arrival is tested (bounds, layer count, exact solid), and its cancelable `beforeEnter` runs
// before anything commits (docs/spec/engine/movement-and-collision.md#r-66; ADR 0040).
import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  assetKey,
  CORE_PLUGIN,
  createAssetIndex,
  createEmptyBoard,
  createEngine,
  enqueueDirectionMove,
  MOVEMENT_PLUGIN,
  hydrateSprites,
  IR_VERSION,
  movementPhaseRegistration,
  PACKAGE_ROOT,
  readEvent,
  triggerPhaseRegistration,
  utf8Encode,
  writeBoard,
  type AssetKey,
  type Board,
  type GameState,
  type MovementEvent,
  type PluginDefinition,
  type TriggerEvent,
} from "../src/index.ts";
import { applyEmitterOp } from "../src/events/index.ts";

function bytes(board: Board): Uint8Array {
  const encoded = writeBoard(board);
  if (!encoded.ok) throw new Error(encoded.error.message);
  return encoded.value;
}

function board(sizeX: number, sizeY: number, options: { links?: Partial<Board["links"]>; vectors?: Board["vectors"]; programs?: Board["programs"]; enterPrg?: string; sizeL?: number } = {}): Board {
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
    programs: options.programs ?? [],
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
  readonly lastStepTick: number | null;
  readonly lastStepBlocked: boolean;
};
type Facts = Observation & {
  readonly triggerStarts: readonly TriggerEvent[];
  readonly beforeEnter: readonly number[];
  readonly diagnostics: readonly string[];
  readonly history: readonly { readonly board: string | null; readonly x: number | null; readonly y: number | null; readonly pending: string | null; readonly queued: number }[];
};

type PreflightCase = {
  readonly destination?: Board;
  readonly sourceLinks?: Partial<Board["links"]>;
  readonly sourceVectors?: Board["vectors"];
  readonly sourcePrograms?: Board["programs"];
  readonly playerLayer?: number;
  readonly collisionBase?: readonly { readonly x: number; readonly y: number }[];
  readonly dirs?: readonly ("E" | "N")[];
  readonly holdReplyTicks?: number;
  readonly cancelBeforeEnter?: boolean;
  readonly blockingProgram?: boolean;
  readonly index?: readonly string[];
};

function runPreflightCase(options: PreflightCase = {}): Facts {
  const links = options.sourceLinks ?? { east: "east.brd" };
  const from = board(10, 10, { links, vectors: options.sourceVectors ?? [], programs: options.sourcePrograms ?? [] });
  const destination = options.destination ?? board(10, 10, {});
  const events: MovementEvent[] = [];
  const diagnostics: string[] = [];
  const history: { board: string | null; x: number | null; y: number | null; pending: string | null; queued: number }[] = [];
  const triggerStarts: TriggerEvent[] = [];
  const beforeEnter: number[] = [];
  let seeded = false;
  const observed: { value: Observation | null } = { value: null };
  const plugin: PluginDefinition = {
    id: "edge-cancel",
    version: "1.0.0",
    commands: [
      {
        name: "recordbeforeenter",
        aliases: [],
        params: [{ name: "event", optional: false, byRef: false, variadic: false }],
        call: (view: { readonly state?: GameState }, args: readonly { readonly value: unknown }[]) => {
          if (view.state !== undefined && readEvent(view.state, args[0]?.value as never) !== undefined) beforeEnter.push(view.state.time.tick);
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
    listeners: options.cancelBeforeEnter === true
      ? [
        { emitter: "board:boards/east.brd", type: "beforeEnter", command: "recordbeforeenter" },
        { emitter: "board:boards/east.brd", type: "beforeEnter", command: "cancelbeforeenter" },
      ]
      : [{ emitter: "board:boards/east.brd", type: "beforeEnter", command: "recordbeforeenter" }],
  };
  const engine = createEngine({
    seed: 71,
    assetIndex: createAssetIndex(options.index ?? ["Boards/west.brd", "Boards/east.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "west.brd",
    width: 320,
    height: 320,
    maxTicks: 12,
    ...(options.blockingProgram === true ? { program: "wait()\nend()" } : {}),
    // The scene program needs the built-in command table; the other cases keep the minimal plugin set.
    plugins: options.blockingProgram === true
      ? [{ definition: CORE_PLUGIN }, { definition: MOVEMENT_PLUGIN }, { definition: plugin }]
      : [{ definition: plugin }],
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
      triggerPhaseRegistration({
        programRef: () => ({ kind: "inline", text: "end()", ir: IR_VERSION }),
        onEvent: (record) => { if (record.type === "trigger-start") triggerStarts.push(record); },
      }),
      {
        phase: "audio",
        run: (state) => {
          const player = state.sprites.players[0];
          history.push({ board: state.world.board?.key ?? null, x: player?.x ?? null, y: player?.y ?? null, pending: player?.movement.pendingExit ?? null, queued: player?.queue.moves.length ?? 0 });
          observed.value = {
            board: state.world.board?.key ?? null,
            x: player?.x ?? null,
            y: player?.y ?? null,
            pending: player?.movement.pendingExit ?? null,
            queued: player?.queue.moves.length ?? 0,
            steps: state.party.steps,
            events: [...events],
            lastStepTick: player?.movement.lastStepTick ?? null,
            lastStepBlocked: player?.movement.lastStepBlocked ?? false,
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
  return { ...latest, diagnostics, history, triggerStarts, beforeEnter };
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

test("E-48: a program-link exit keeps its finished-step record and fires a step region under the exit tile", () => {
  // ADR 0040/R-66 item 6: a `.prg` link keeps E-48. The step still ends as a blocked step (so a
  // step-triggered region under the exit tile activates on that tick) and the queue event survives.
  const exitRegion = {
    program: "gate-exit.prg", graphic: "", initialVar: "", initialValue: "", finalVar: "", finalValue: "",
    activate: 0, activationType: 0, repeatDistance: 0, layer: 0,
    points: [{ x: 280, y: 70 }, { x: 320, y: 70 }, { x: 320, y: 100 }, { x: 280, y: 100 }],
    closed: 1, handle: "exit-region",
  } satisfies Board["programs"][number];
  const facts = runPreflightCase({ sourceLinks: { east: "gate.prg" }, sourcePrograms: [exitRegion], dirs: ["E"] });
  equal(facts.board, "boards/west.brd");
  deepEqual([facts.x, facts.y], [304, 95], "the exiting step stops at its last safe position");
  deepEqual(facts.events.filter((record) => record.type === "movement-complete").map((record) => [record.tick, record.blocked]), [[0, true]]);
  deepEqual(facts.events.filter((record) => record.type === "edge-exit").map((record) => [record.tick, record.direction]), [[0, "E"]]);
  equal(facts.lastStepTick, 0, "E-48 keeps the finished-step record");
  equal(facts.lastStepBlocked, true);
  deepEqual(facts.triggerStarts.map((record) => [record.tick, record.key, record.source]), [[0, "region:0", "region"]]);
});


test("R-66/R-68: a linked refusal under a live blocking program is refused before beforeEnter and keeps the queue", () => {
  // The scene program's wait() is a live blocking thread at the movement phase, so R-68 suppresses
  // end-of-step processing for this tick. The linked refusal is uncounted either way, but it must still
  // run its preflight (and beforeEnter) and keep the unrelated queued step.
  const facts = runPreflightCase({ dirs: ["E", "N"], cancelBeforeEnter: true, blockingProgram: true });
  // The destination arrives one tick after it is requested, so the linked attempt is refused on that
  // tick, under the live blocking scene program's suppression. The engine forbids starting a cancelable
  // event while a blocking thread is live (`runEngineCancelableEventOutcome`), so beforeEnter does not run
  // and the preflight's "any failure is a refusal" boundary applies — uncounted, queue kept.
  equal(facts.beforeEnter.length, 0);
  equal(facts.diagnostics.filter((code) => code === "event.dispatch-active").length, 1);
  const blockedAt = facts.events.find((record) => record.type === "blocked");
  if (blockedAt === undefined) throw new Error("the linked attempt was not refused");
  const tick = blockedAt.tick;
  const row = facts.history[tick]!;
  equal(row.board, "boards/west.brd");
  deepEqual([row.x, row.y], [304, 95]);
  equal(row.queued, 1, "the refused step consumed only its own entry; N stays queued");
  deepEqual(facts.events.filter((record) => record.type === "blocked").map((record) => [record.tick, record.edge]), [[tick, "E"]]);
  equal(facts.events.some((record) => record.type === "edge-exit"), false);
  equal(facts.history.every((entry) => entry.board === "boards/west.brd"), true);
});

test("R-66/R-68: a crossing tick's end-of-step decision is captured before the blocking enter program starts", () => {
  const west = board(10, 10, { links: { east: "east.brd" } });
  const east = board(10, 10, { enterPrg: "east-enter.prg" });
  const assets = new Map<AssetKey, Uint8Array>([
    [assetKey("boards/west.brd"), bytes(west)],
    [assetKey("boards/east.brd"), bytes(east)],
  ]);
  const programLoader = {
    index: createAssetIndex(["Prg/east-enter.prg"]),
    root: { kind: "package" as const },
    read: (key: AssetKey) => key === assetKey("prg/east-enter.prg") ? utf8Encode("wait()\nend()") : undefined,
  };
  const movementContexts: { tick: number; suppressed: boolean | undefined }[] = [];
  const triggerContexts: { tick: number; suppressed: boolean | undefined; live: boolean }[] = [];
  const rows: { tick: number; board: string | null; x: number | null; y: number | null }[] = [];
  let seeded = false;
  const engine = createEngine({
    seed: 71,
    assetIndex: createAssetIndex(["Boards/west.brd", "Boards/east.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "west.brd",
    programLoader,
    width: 320,
    height: 320,
    maxTicks: 4,
    initialAssets: assets,
    phaseRegistrations: [
      {
        phase: "input",
        rank: -1,
        run: (state) => {
          if (seeded) return;
          const currentBoard = state.world.board;
          if (currentBoard === null || currentBoard === undefined) return;
          seeded = true;
          state.sprites = hydrateSprites({
            board: currentBoard,
            players: [{ id: "hero", source: "hero.tem", kind: "player", x: 304, y: 95, layer: 0, facing: "E", controlled: true }],
          });
          enqueueDirectionMove(state.sprites, "hero", "E");
        },
      },
      { phase: "movement", rank: -200, run: (state, _post, context) => movementContexts.push({ tick: state.time.tick, suppressed: context?.endOfStepSuppressed }) },
      movementPhaseRegistration(),
      {
        phase: "triggers",
        rank: -200,
        run: (state, _post, context) => triggerContexts.push({
          tick: state.time.tick,
          suppressed: context?.endOfStepSuppressed,
          live: state.vm.threads.some((thread) => thread.kind === "blocking" && thread.status !== "finished"),
        }),
      },
      {
        phase: "audio",
        run: (state) => {
          const player = state.sprites.players[0];
          rows.push({ tick: state.time.tick, board: state.world.board?.key ?? null, x: player?.x ?? null, y: player?.y ?? null });
        },
      },
    ],
  });
  engine.advance(2, []);
  // Tick 0: no blocking thread when the movement phase captures the decision; the crossing then starts the
  // destination's enter program as a blocking thread, and the triggers phase still reads the captured false.
  deepEqual(movementContexts.map((entry) => [entry.tick, entry.suppressed]), [[0, false], [1, true]]);
  deepEqual(triggerContexts.map((entry) => [entry.tick, entry.suppressed, entry.live]), [[0, false, true], [1, true, true]]);
  deepEqual(rows.slice(0, 2).map((row) => [row.tick, row.board, row.x, row.y]), [[0, "boards/east.brd", 15, 95], [1, "boards/east.brd", 15, 95]]);
});
