import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  assetKey, createAssetIndex, createEmptyBoard, createEngine, hydrateSprites,
  inputPhaseRegistration, movementPhaseRegistration, PACKAGE_ROOT, restoreGameState,
  snapshot, writeBoard, type GameState, type MovementEvent, type WorldBoard,
} from "../src/index.ts";

test("completed player tile steps count, blocked steps do not, and the count survives save and load", () => {
  const authored = writeBoard(createEmptyBoard());
  if (!authored.ok) throw new Error(authored.error.message);
  let state: GameState | undefined;
  const events: MovementEvent[] = [];
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 320,
    height: 240,
    maxTicks: 100,
    input: { bindings: { keys: { ArrowRight: "right" } } },
    phaseRegistrations: [
      { phase: "input", rank: -1, run: (current) => {
        if (state !== undefined) return;
        const board = {
          ...current.world.board!, key: assetKey("boards/test.brd"), width: 320, height: 240,
          vectors: [{ handle: "wall", attributes: 0, closed: 1, layer: 1, type: 1, points: [
            { x: 128, y: 32 }, { x: 160, y: 32 }, { x: 160, y: 224 }, { x: 128, y: 224 },
          ] }],
        } as unknown as WorldBoard;
        current.world = { board };
        current.sprites = hydrateSprites({ board, players: [
          { id: "hero", kind: "player", source: "hero.tem", x: 48, y: 63, layer: 1, facing: "S", controlled: true },
        ] });
        state = current;
      } },
      inputPhaseRegistration({ pixelMovement: 0, pixelStep: 8 }),
      movementPhaseRegistration({ onEvent: (event) => events.push(event) }),
    ],
  });
  const request = engine.advance(0, []).requests[0];
  if (request?.kind !== "asset") throw new Error("expected board request");
  engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: authored.value } }]);
  engine.advance(1, []);
  ok(state);
  const current: GameState = state;
  equal(current.party.steps, 0);
  const key = (down: boolean) => ({ kind: "key" as const, name: "RIGHT", code: "ArrowRight", char: null, down });
  const walkOne = () => {
    engine.advance(1, [{ tick: current.time.tick, event: key(true) }]);
    engine.advance(1, [{ tick: current.time.tick, event: key(false) }]);
    engine.advance(30, []);
  };
  walkOne();
  equal(current.sprites.players[0]?.x, 80);
  equal(current.party.steps, 1);
  walkOne();
  equal(current.sprites.players[0]?.x, 112);
  equal(current.party.steps, 2);
  walkOne();
  equal(current.sprites.players[0]?.x, 112);
  ok(events.some((event) => event.type === "blocked" && event.vector === "wall"));
  equal(current.party.steps, 2);
  equal(restoreGameState(snapshot(current)).party.steps, 2);
});
