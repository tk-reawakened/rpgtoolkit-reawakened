// R-66 linked-edge preflight and E-138 selected-player-only edge order
// (docs/spec/engine/movement-and-collision.md#r-66, #e-138; ADR 0040).
import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  createEmptyBoard,
  enqueueDirectionMove,
  enqueueMove,
  hydrateSprites,
  runMovementPhase,
  type EdgePreflightOutcome,
  type EdgePreflightRequest,
  type MovementEvent,
  type SpritesSection,
  type WorldBoard,
} from "../src/index.ts";

type Links = { readonly north: string; readonly south: string; readonly east: string; readonly west: string };

function board(links: Partial<Links> = {}, vectors: WorldBoard["vectors"] = []): WorldBoard {
  const empty = createEmptyBoard();
  const { residue: _residue, ...plain } = empty;
  return ({
    ...plain,
    width: 320,
    height: 320,
    sizeL: 2,
    coordType: 0,
    links: { north: "", south: "", east: "", west: "", ...links },
    vectors,
    items: [],
  } as unknown) as WorldBoard;
}

function playerState(currentBoard: WorldBoard, options: { x?: number; y?: number; controlled?: boolean } = {}) {
  return hydrateSprites({
    board: currentBoard,
    players: [{
      id: "hero",
      kind: "player",
      source: "hero.tem",
      x: options.x ?? 304,
      y: options.y ?? 95,
      layer: 1,
      controlled: options.controlled ?? true,
    }],
  });
}

function recorder(outcomes: readonly EdgePreflightOutcome[] = ["accepted"]) {
  const requests: EdgePreflightRequest[] = [];
  let index = 0;
  return {
    requests,
    preflightEdge: (request: EdgePreflightRequest): EdgePreflightOutcome => {
      requests.push(request);
      const outcome = outcomes[Math.min(index, outcomes.length - 1)] ?? "accepted";
      index += 1;
      return outcome;
    },
  };
}

function run(sprites: SpritesSection, currentBoard: WorldBoard, ticks: number, preflightEdge?: (request: EdgePreflightRequest) => EdgePreflightOutcome, pixelMovement = 0): MovementEvent[] {
  const events: MovementEvent[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    events.push(...runMovementPhase(sprites, currentBoard, tick, { pixelMovement, ...(preflightEdge === undefined ? {} : { preflightEdge }) }));
  }
  return events;
}

test("R-66: a linked-edge step preflights at step start and requests the crossing without advancing", () => {
  const currentBoard = board({ east: "east.brd" });
  // x = 290: the whole 32 px target (322) is off the board, but the first few 4 px advances are still
  // inside. A preflight at step start therefore asks before x moves; a first-advance check would move.
  const sprites = playerState(currentBoard, { x: 290 });
  const { requests, preflightEdge } = recorder();
  enqueueDirectionMove(sprites, "hero", "E");
  const events = run(sprites, currentBoard, 1, preflightEdge);
  deepEqual(requests, [{ actorId: "hero", direction: "E", link: "east.brd" }]);
  equal(sprites.players[0]?.x, 290, "no advance on the source board");
  deepEqual(sprites.players[0]?.movement.pendingExit, "E");
  equal(sprites.players[0]?.movement.active, null);
  equal(events.some((record) => record.type === "step-complete"), false);
  equal(sprites.players[0]?.movement.lastStepTick, null, "a crossing is a placement, not a completed step");
});

test("R-66: a refused crossing ends the step blocked, uncounted, and keeps the rest of the queue", () => {
  const currentBoard = board({ east: "east.brd" });
  const sprites = playerState(currentBoard);
  const { preflightEdge } = recorder(["refused"]);
  enqueueDirectionMove(sprites, "hero", "E");
  enqueueDirectionMove(sprites, "hero", "N");
  const events = run(sprites, currentBoard, 1, preflightEdge);
  const hero = sprites.players[0];
  equal(hero?.x, 304);
  equal(hero?.y, 95);
  equal(hero?.movement.pendingExit, null);
  equal(hero?.movement.active, null);
  equal(hero?.movement.lastStepTick, null, "no end-of-step processing for a refusal");
  deepEqual(hero?.queue.moves.map((move) => move.source === "direction" ? move.direction : move.source), ["N"]);
  const blocked = events.filter((record) => record.type === "blocked");
  deepEqual(blocked.map((record) => [record.edge, record.partyDistance256, record.blocked]), [["E", undefined, true]]);
  equal(events.some((record) => record.type === "step-complete"), false);
  equal(events.some((record) => record.type === "movement-complete"), false, "the queue still has the north step");
  equal(events.some((record) => record.type === "party-step"), false);
});

test("R-66: the next step asks again; nothing remembers the refusal", () => {
  const currentBoard = board({ east: "east.brd" });
  const sprites = playerState(currentBoard);
  const { requests, preflightEdge } = recorder(["refused", "refused"]);
  enqueueDirectionMove(sprites, "hero", "E");
  run(sprites, currentBoard, 1, preflightEdge);
  enqueueDirectionMove(sprites, "hero", "E");
  run(sprites, currentBoard, 3, preflightEdge);
  deepEqual(requests.map((request) => request.direction), ["E", "E"]);
  equal(sprites.players[0]?.x, 304);
});

test("R-66: a destination still loading leaves the step unstarted and unchanged", () => {
  const currentBoard = board({ east: "east.brd" });
  const sprites = playerState(currentBoard);
  const { requests, preflightEdge } = recorder(["pending", "accepted"]);
  enqueueDirectionMove(sprites, "hero", "E");
  run(sprites, currentBoard, 1, preflightEdge);
  deepEqual(sprites.players[0]?.queue.moves.map((move) => move.source === "direction" ? move.direction : move.source), ["E"]);
  equal(sprites.players[0]?.x, 304);
  equal(sprites.players[0]?.movement.pendingExit, null);
  run(sprites, currentBoard, 2, preflightEdge);
  deepEqual(requests.map((request) => request.direction), ["E", "E", "E"]);
  deepEqual(sprites.players[0]?.movement.pendingExit, "E");
});

test("E-138/R-64: a no-link edge is a solid block at step start, counted once for a direction tile step", () => {
  const currentBoard = board();
  const sprites = playerState(currentBoard);
  const { requests, preflightEdge } = recorder();
  enqueueDirectionMove(sprites, "hero", "E");
  const events = run(sprites, currentBoard, 1, preflightEdge);
  deepEqual(requests, [], "no link means no board preflight");
  const blocked = events.filter((record) => record.type === "blocked");
  deepEqual(blocked.map((record) => [record.edge, record.vector, record.partyDistance256]), [["E", undefined, 32 * 256]]);
  equal(sprites.players[0]?.x, 304, "no partial move");
  deepEqual(sprites.players[0]?.movement.lastStepTarget, { x: 336, y: 95 });
  equal(sprites.players[0]?.movement.lastStepTick, 0);
});

test("E-138: only the selected player is tested against the board edge", () => {
  const currentBoard = board({ east: "east.brd" });
  const sprites = playerState(currentBoard, { controlled: false });
  const { requests, preflightEdge } = recorder();
  enqueueDirectionMove(sprites, "hero", "E");
  const events = run(sprites, currentBoard, 30, preflightEdge);
  deepEqual(requests, []);
  equal(sprites.players[0]?.movement.pendingExit, null);
  equal(events.some((record) => record.type === "edge-exit"), false);
  equal((sprites.players[0]?.x ?? 0) > 320, true, "a non-selected player is not limited by the edge");
});

test("E-138: the edge result is combined with the vector result; a link never clears a solid", () => {
  const wall = { handle: "wall", attributes: 0, closed: 1, layer: 1, type: 1, points: [{ x: 320, y: 60 }, { x: 340, y: 60 }, { x: 340, y: 140 }, { x: 320, y: 140 }] };
  const currentBoard = board({ east: "east.brd" }, [wall]);
  const sprites = playerState(currentBoard);
  const { requests, preflightEdge } = recorder(["accepted"]);
  enqueueDirectionMove(sprites, "hero", "E");
  const events = run(sprites, currentBoard, 1, preflightEdge);
  deepEqual(requests, [], "the vector check runs before the edge check");
  deepEqual(events.filter((record) => record.type === "blocked").map((record) => record.vector), ["wall"]);
  equal(sprites.players[0]?.movement.pendingExit, null);
  equal(sprites.players[0]?.x, 304);
});

test("R-66: point-style steps are preflighted too", () => {
  const currentBoard = board({ east: "east.brd" });
  const sprites = playerState(currentBoard, { x: 290 });
  const { requests, preflightEdge } = recorder(["refused"]);
  enqueueMove(sprites, "hero", { source: "points", target: { x: 322, y: 95 }, facing: "E", provenance: { kind: "script", thread: 0 } });
  run(sprites, currentBoard, 1, preflightEdge);
  deepEqual(requests, [{ actorId: "hero", direction: "E", link: "east.brd" }]);
  equal(sprites.players[0]?.x, 290, "the point-style step is refused at its start, not after advancing");
  deepEqual(sprites.players[0]?.queue.moves, []);
});

test("E-48: a program link is not preflighted and keeps the existing program-link request", () => {
  const currentBoard = board({ east: "gate.prg" });
  const sprites = playerState(currentBoard);
  const { requests, preflightEdge } = recorder();
  enqueueDirectionMove(sprites, "hero", "E");
  const events = run(sprites, currentBoard, 30, preflightEdge);
  deepEqual(requests, []);
  deepEqual(events.filter((record) => record.type === "edge-exit").map((record) => record.direction), ["E"]);
  equal(sprites.players[0]?.movement.pendingExit, "E");
});
