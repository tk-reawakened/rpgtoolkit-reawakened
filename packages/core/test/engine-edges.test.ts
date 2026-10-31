import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { createAssetIndex, createEmptyBoard, createEngine, PACKAGE_ROOT, readEvent, writeBoard, type Board, type PluginDefinition } from "../src/index.ts";
import { addListener, applyEmitterOp, queueNativeEvent, registerEmitter, unregisterEmitter } from "../src/events/index.ts";
import { allocateHandle, createHostObject } from "../src/script/objects.ts";
import { createGameState, addActor, advanceScriptTick, collectStateGarbage, drainDiagnostics, runEngineCancelableEvent, startProgram } from "../src/index.ts";
import { hydrateSprites } from "../src/sprites/runtime.ts";
import type { Facing } from "../src/sprites/model.ts";
import type { GameState } from "../src/save/state.ts";
import { createScriptServices } from "./script-test-services.ts";
type EdgeCase = "no-link-edge-is-solid" | "board-link-arrives-opposite-edge" | "arrival-clamps-along-edge" | "blocked-arrival-is-refused" | "program-link-runs-program" | "west-edge-arrives-east-edge";

type EdgeFacts = { readonly board: string | null; readonly x: number | null; readonly y: number | null; readonly pending: Facing | null };

function bytes(board: Board): Uint8Array {
  const encoded = writeBoard(board);
  if (!encoded.ok) throw new Error(encoded.error.message);
  return encoded.value;
}

function board(sizeY: number, links: Partial<Board["links"]> = {}, vectors: Board["vectors"] = [], enterPrg = ""): Board {
  const empty = createEmptyBoard();
  const cells = 10 * sizeY;
  return {
    ...empty,
    sizeX: 10,
    sizeY,
    sizeL: 1,
    tileMatrix: Array.from({ length: cells }, () => 0),
    tileRuns: [{ lutIndex: 0, count: cells, marker: cells > 1 }],
    layerTitles: ["", ""],
    links: { ...empty.links, ...links },
    vectors,
    properties: { ...empty.properties, enterPrg },
  };
}

function runEdgeCase(name: EdgeCase, batch = 1): { readonly facts: readonly EdgeFacts[]; readonly diagnostics: readonly string[]; readonly stateHashes: readonly string[] } {
  const sourceLink = name === "no-link-edge-is-solid" ? {} : name === "program-link-runs-program" ? { north: "north-gate.prg" } : { east: "east.brd", west: "east.brd" };
  const source = board(10, sourceLink);
  const blocked = [{ handle: "rubble", attributes: 0, closed: 1, layer: 0, type: 1, points: [{ x: 0, y: 64 }, { x: 64, y: 64 }, { x: 64, y: 128 }, { x: 0, y: 128 }] }];
  const destination = board(name === "arrival-clamps-along-edge" ? 5 : 10, {}, name === "blocked-arrival-is-refused" ? blocked : []);
  const direction: Facing = name === "west-edge-arrives-east-edge" ? "W" : name === "program-link-runs-program" ? "N" : name === "no-link-edge-is-solid" ? "S" : "E";
  const startY = name === "arrival-clamps-along-edge" ? 300 : 95;
  const facts: EdgeFacts[] = [];
  const stateHashes: string[] = [];
  let seeded = false;
  const engine = createEngine({
    seed: 59,
    assetIndex: createAssetIndex(["Boards/west.brd", "Boards/east.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "west.brd",
    width: 320,
    height: 320,
    maxTicks: 4,
    phaseRegistrations: [
      { phase: "movement", rank: -1, run: (state: GameState) => {
        const currentBoard = state.world.board;
        if (seeded || currentBoard === null || currentBoard === undefined) return;
        seeded = true;
        state.sprites = hydrateSprites({ board: currentBoard, players: [{ id: "hero", source: "hero.tem", kind: "player", x: direction === "W" ? 15 : direction === "E" ? 304 : 144, y: startY, layer: 0, facing: direction, controlled: true }] });
        state.sprites.players = state.sprites.players.map((actor) => ({ ...actor, state: "moving", movement: { ...actor.movement, pendingExit: direction } }));
      } },
      { phase: "audio", run: (state: GameState) => {
        const player = state.sprites.players[0];
        facts.push({ board: state.world.board?.key ?? null, x: player?.x ?? null, y: player?.y ?? null, pending: player?.movement.pendingExit ?? null });
        stateHashes.push(String(state.time.tick));
      } },
    ],
  });
  let result = engine.advance(0, []);
  let elapsed = 0;
  while (elapsed < 6) {
    const replies = result.requests.filter((request) => request.kind === "asset").map((request) => ({ tick: result.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: request.key === "boards/west.brd" ? bytes(source) : bytes(destination) } }));
    const next = engine.advance(Math.min(batch, 6 - elapsed), replies);
    elapsed += next.ticksRun;
    result = next;
    if (next.ticksRun === 0 && next.requests.length === 0) break;
  }
  return { facts, diagnostics: result.diagnostics.map((diagnostic) => diagnostic.code), stateHashes };
}

test("edges-board-link-program fixture cases drive the real core edges phase", () => {
  const noLink = runEdgeCase("no-link-edge-is-solid");
  deepEqual(noLink.facts[0], { board: "boards/west.brd", x: 144, y: 95, pending: null });
  const linked = runEdgeCase("board-link-arrives-opposite-edge");
  deepEqual(linked.facts[1], { board: "boards/east.brd", x: 15, y: 95, pending: null });
  const clamped = runEdgeCase("arrival-clamps-along-edge");
  equal(clamped.facts[1]?.y, 160);
  const refused = runEdgeCase("blocked-arrival-is-refused");
  deepEqual(refused.facts[1], { board: "boards/west.brd", x: 304, y: 95, pending: null });
  const program = runEdgeCase("program-link-runs-program");
  equal(program.facts[0]?.board, "boards/west.brd");
  const west = runEdgeCase("west-edge-arrives-east-edge");
  deepEqual(west.facts[1], { board: "boards/east.brd", x: 305, y: 95, pending: null });
});

test("edge transitions have equal facts when advanced one tick or in batches", () => {
  const one = runEdgeCase("board-link-arrives-opposite-edge");
  const batched = runEdgeCase("board-link-arrives-opposite-edge", 2);
  deepEqual(one.facts.at(-1), batched.facts.at(-1));
  equal(one.diagnostics.length, 0);
});


test("unloading a board emitter drops stale queued work and fresh registration has no old listeners", () => {
  const state = createGameState({ seed: 68 });
  const object = registerEmitter(state.vm, state.events, "board:old", createHostObject(state.vm, "board"));
  addListener(state.events, "board:old", "left", { type: "callable", def: "stale", captures: [], receiver: null }, false);
  queueNativeEvent(state.vm, state.events, "board:old", "left", { actorId: 1, boardKey: "old.brd" });
  equal(state.events.queue.length, 1);
  unregisterEmitter(state.events, "board:old");
  equal(state.events.queue.length, 0);
  equal(state.events.emitters?.["board:old"], undefined);
  equal(state.events.listeners.filter((listener) => listener.emitter === "board:old").length, 0);
  equal(state.vm.objects.some((record) => record.handle === object.handle), true);
  const fresh = registerEmitter(state.vm, state.events, "board:old", object);
  equal(fresh.handle, object.handle);
  equal(state.events.listeners.filter((listener) => listener.emitter === "board:old").length, 0);
  queueNativeEvent(state.vm, state.events, "board:old", "entered", { actorId: 1, boardKey: "old.brd" });
  equal(state.events.queue.length, 1);
  unregisterEmitter(state.events, "board:old");
  equal(state.events.queue.length, 0);
});

type BoardEventObservation = {
  readonly emitter: string;
  readonly type: string;
  readonly detail: Record<string, unknown>;
};
type BoardCaseResult = {
  readonly board: string | null;
  readonly player: { readonly x: number | null; readonly y: number | null; readonly pending: Facing | null };
  readonly events: readonly BoardEventObservation[];
  readonly order: readonly string[];
  readonly oldBoardRetired: boolean;
  readonly oldBoardListeners: number;
};

function runBoardEventCase(cancelBeforeEnter: boolean): BoardCaseResult {
  const source = board(10, { east: "east.brd" });
  const destination = board(10);
  const events: BoardEventObservation[] = [];
  const order: string[] = [];
  const eventCommand = {
    name: "recordevent",
    aliases: [],
    params: [{ name: "event", optional: false, byRef: false, variadic: false }],
    call: (view: { readonly state?: GameState }, args: readonly { readonly value: unknown }[]) => {
      if (view.state === undefined) return { value: 0 };
      const event = readEvent(view.state, args[0]?.value as never);
      if (event !== undefined) events.push({ emitter: event.emitter, type: event.type, detail: event.detail });
      return { value: 0 };
    },
  } satisfies PluginDefinition["commands"][number];
  const cancelCommand = {
    name: "cancelbeforeenter",
    aliases: [],
    params: [{ name: "event", optional: false, byRef: false, variadic: false }],
    call: (view: { readonly state?: GameState }, args: readonly { readonly value: unknown }[]) => {
      if (view.state !== undefined) applyEmitterOp(view.state.vm, view.state.events, "cancel", args[0]?.value as never, [], null);
      return { value: 0 };
    },
  } satisfies PluginDefinition["commands"][number];
  const orderCommand = (name: string) => ({
    name,
    aliases: [],
    params: [{ name: "event", optional: false, byRef: false, variadic: false }],
    call: () => {
      order.push(name);
      return { value: 0 };
    },
  }) satisfies PluginDefinition["commands"][number];
  const plugin: PluginDefinition = {
    id: "board-events",
    version: "1.0.0",
    commands: [eventCommand, cancelCommand, orderCommand("recordfirst"), orderCommand("recordsecond")],
    listeners: [
      { emitter: "board:boards/east.brd", type: "beforeEnter", command: cancelBeforeEnter ? "cancelbeforeenter" : "recordfirst" },
      { emitter: "board:boards/east.brd", type: "beforeEnter", command: cancelBeforeEnter ? "cancelbeforeenter" : "recordsecond" },
      { emitter: "board:boards/east.brd", type: "beforeEnter", command: cancelBeforeEnter ? "cancelbeforeenter" : "recordevent" },
      { emitter: "board:boards/east.brd", type: "entered", command: "recordevent" },
      { emitter: "board:boards/west.brd", type: "left", command: "recordevent" },
      { emitter: "actor:1", type: "left", command: "recordevent" },
    ],
  };
  let seeded = false;
  const facts: string[] = [];
  let playerFact: BoardCaseResult["player"] = { x: null, y: null, pending: null };
  let oldBoardRetired = false;
  let oldBoardListeners = -1;
  const engine = createEngine({
    seed: 59,
    assetIndex: createAssetIndex(["Boards/west.brd", "Boards/east.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "west.brd",
    width: 320,
    height: 320,
    maxTicks: 8,
    plugins: [{ definition: plugin }],
    phaseRegistrations: [
      {
        phase: "movement",
        rank: -1,
        run: (state: GameState) => {
          if (state.actors.actors.length === 0) addActor(state.actors, { id: 1, kind: "party", source: "hero.tem", behaviour: "board-events.hero", stats: { hp: 1, maxHp: 1 } });
          const currentBoard = state.world.board;
          if (seeded || currentBoard === null || currentBoard === undefined) return;
          seeded = true;
          state.sprites = hydrateSprites({ board: currentBoard, players: [{ id: "hero", source: "hero.tem", kind: "player", x: 304, y: 95, layer: 0, facing: "E", controlled: true }] });
          state.sprites.players = state.sprites.players.map((player) => ({ ...player, state: "moving", movement: { ...player.movement, pendingExit: "E" } }));
        },
      },
      { phase: "audio", run: (state: GameState) => {
        const player = state.sprites.players[0];
        playerFact = { x: player?.x ?? null, y: player?.y ?? null, pending: player?.movement.pendingExit ?? null };
        oldBoardRetired = state.events.emitters?.["board:boards/west.brd"] === undefined;
        oldBoardListeners = state.events.listeners.filter((listener) => listener.emitter === "board:boards/west.brd").length;
        facts.push(state.world.board?.key ?? "");
      } },
    ],
  });
  const first = engine.advance(0, []);
  const request = first.requests[0];
  if (request?.kind !== "asset") throw new Error("expected west board request");
  const loaded = engine.advance(1, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: bytes(source) } }]);
  const nextRequest = loaded.requests.find((item) => item.kind === "asset");
  if (nextRequest?.kind !== "asset") throw new Error("expected east board request");
  engine.advance(0, [{ tick: loaded.tickAfter, event: { kind: "asset", reqId: nextRequest.reqId, bytes: bytes(destination) } }]);
  engine.advance(4, []);
  return { board: facts.at(-1) ?? null, player: playerFact, events, order, oldBoardRetired, oldBoardListeners };
}

test("board enter is cancelable and successful transitions deliver entered plus actor left through native consumers", () => {
  const canceled = runBoardEventCase(true);
  equal(canceled.board, "boards/west.brd");
  deepEqual(canceled.player, { x: 304, y: 95, pending: null });
  equal(canceled.events.some((event) => event.type === "entered"), false);
  equal(canceled.events.filter((event) => event.type === "left").length, 0);
  const entered = runBoardEventCase(false);
  equal(entered.board, "boards/east.brd");
  deepEqual(entered.order, ["recordfirst", "recordsecond"]);
  equal(entered.events.filter((event) => event.type === "entered" && event.emitter === "board:boards/east.brd").length, 1);
  const actorLeft = entered.events.filter((event) => event.type === "left" && event.emitter === "actor:1");
  equal(actorLeft.length, 1);
  deepEqual(actorLeft[0]?.detail, { actorId: 1, boardKey: "boards/west.brd" });
  const boardLeft = entered.events.filter((event) => event.type === "left" && event.emitter === "board:boards/west.brd");
  equal(boardLeft.length, 1);
  deepEqual(boardLeft[0]?.detail, { actorId: 1, boardKey: "boards/west.brd" });
  equal(entered.oldBoardRetired, true);
  equal(entered.oldBoardListeners, 0);
  const beforeEnter = entered.events.find((event) => event.type === "beforeEnter");
  deepEqual(beforeEnter?.detail.entry, { x: 15, y: 95, layer: 0, unit: "pixel" });
  equal(beforeEnter?.detail.actorId, 1);
});

test("engine beforeEnter rejects a waiting listener with a located diagnostic", () => {
  const state = createGameState({ seed: 69 });
  const boardObject = registerEmitter(state.vm, state.events, "board:test", createHostObject(state.vm, "board"));
  state.vm.globals.board = { kind: "object", handle: boardObject.handle, className: boardObject.className };
  startProgram(state.vm, { kind: "inline", ir: "1", text: `board.on("beforeEnter", (event) => { sleep(1) })\n` });
  const services = createScriptServices(state);
  advanceScriptTick(state, services);
  equal(runEngineCancelableEvent(state, services, "board:test", "beforeEnter", { actorId: 1, boardKey: "test.brd" }), false);
  const diagnostic = drainDiagnostics(services).find((item) => item.code === "event.wait-forbidden");
  equal(diagnostic?.file, "<engine>");
  equal(diagnostic?.line, 0);
});
test("engine beforeEnter rejects a listener that exceeds its bounded budget", () => {
  const state = createGameState({ seed: 70 });
  const boardObject = registerEmitter(state.vm, state.events, "board:budget", createHostObject(state.vm, "board"));
  state.vm.globals.board = { kind: "object", handle: boardObject.handle, className: boardObject.className };
  startProgram(state.vm, { kind: "inline", ir: "1", text: `board.on("beforeEnter", (event) => { for (i = 0; i < 400; i = i + 1) { n = i } })\n` });
  const services = createScriptServices(state);
  advanceScriptTick(state, services);
  equal(runEngineCancelableEvent(state, services, "board:budget", "beforeEnter", { actorId: 1, boardKey: "budget.brd" }, 2), false);
  const diagnostic = drainDiagnostics(services).find((item) => item.code === "event.budget-exceeded");
  equal(diagnostic?.file, "<engine>");
  equal(diagnostic?.line, 0);
});

function assertRejectedEngineEventReleasesNativeDetail(
  emitter: string,
  program: string,
  budget: number | undefined,
  diagnosticCode: string,
): void {
  const state = createGameState({ seed: 71 });
  const emitterObject = registerEmitter(state.vm, state.events, emitter, createHostObject(state.vm, "board"));
  state.vm.globals.board = { kind: "object", handle: emitterObject.handle, className: emitterObject.className };
  startProgram(state.vm, { kind: "inline", ir: "1", text: program });
  const services = createScriptServices(state);
  advanceScriptTick(state, services);

  // queueNativeEvent allocates the detail object before the event object.
  const expectedEventHandle = allocateHandle(state.vm) + 1;
  const accepted = budget === undefined
    ? runEngineCancelableEvent(state, services, emitter, "beforeEnter", { marker: "rejected" })
    : runEngineCancelableEvent(state, services, emitter, "beforeEnter", { marker: "rejected" }, budget);
  equal(accepted, false);
  equal(state.events.dispatch, null);
  equal(state.events.nativeDetails, undefined);
  equal(drainDiagnostics(services).find((item) => item.code === diagnosticCode)?.code, diagnosticCode);

  collectStateGarbage(state);
  const freshEventHandle = queueNativeEvent(state.vm, state.events, emitter, "beforeEnter", { marker: "fresh" });
  equal(freshEventHandle, expectedEventHandle, "the rejected event handle is reused after collection");
  equal(readEvent(state, { kind: "object", handle: freshEventHandle, className: "" })?.detail.marker, "fresh");
}

test("rejected engine events clean native detail metadata before a handle is reused", () => {
  assertRejectedEngineEventReleasesNativeDetail(
    "board:wait-cleanup",
    `board.on("beforeEnter", (event) => { sleep(1) })\n`,
    undefined,
    "event.wait-forbidden",
  );
  assertRejectedEngineEventReleasesNativeDetail(
    "board:budget-cleanup",
    `board.on("beforeEnter", (event) => { for (i = 0; i < 400; i = i + 1) { n = i } })\n`,
    2,
    "event.budget-exceeded",
  );
});
