// Scenes: triggers-precedence, actor-hydration-item-multitask, pathfinding-axial-diagonal-vector
// (ticket 5.2). Authored from docs/spec/engine/movement-and-collision.md (E-40..E-45, R-52, E-34).

import { FLAGS } from "./sim.mjs";
import { board, hero, makeCase, npc, rectPts, solid } from "./common.mjs";

const region = (id, type, x0, y0, x1, y1, o = {}) => ({ id, type, layer: 0, points: rectPts(x0, y0, x1, y1), program: `${id}.prg`, ...o });
// Props get a 4 x 2 px collision base so the activation tests are not pre-empted by sprite blocking.
const item = (id, x, y, type, o = {}) => npc(id, x, y, { collision: [-2, -2, 2, 0], activation: { type, program: `${id}.prg`, ...(o.act ?? {}) }, ...o.actor });
const walk = (dirs, t = 0) => ({ t, op: "push", actor: "hero", dirs });

export function triggersPrecedence() {
  const field = (o = {}) => ({ board: "field", boards: { field: board({ pfMode: 1, ...o }) }, players: [hero({ x: 48, y: 63, speed: 0.02, facing: "E" })] });
  const withVars = (setup, vars) => ({ ...setup, vars });
  return {
    spec: ["movement-and-collision.md#e-40", "movement-and-collision.md#e-41", "movement-and-collision.md#e-42", "movement-and-collision.md#e-43", "movement-and-collision.md#e-44", "movement-and-collision.md#e-45", "movement-and-collision.md#r-52", "movement-and-collision.md#reawakened-gone-trigger-suppression"],
    cases: [
      makeCase("step-on-once-per-entry-and-rearm", "E-40: fires once on entering, not again while inside, and re-arms after the player leaves.", field({ programs: [region("mat", "step", 96, 32, 160, 96)] }), [walk("E,E,E,E,E,W,W,W,W")], 130),
      makeCase("repeat-distance", "E-42: fires on entry, then again each distanceRepeat (64) px walked inside; the counter resets on leaving.", field({ programs: [region("trail", "repeat", 96, 32, 288, 96, { distanceRepeat: 64 })] }), [walk("E,E,E,E,E,E,E")], 130),
      makeCase("key-press-versus-step-on", "E-41: a key-press region does not fire on entry; each activation key press inside fires it. A step region overlapping it fires on entry only.", field({ programs: [region("lever", "key", 96, 32, 160, 96), region("mat", "step", 96, 32, 160, 96)] }), [walk("E,E"), { t: 60, op: "activate" }, { t: 70, op: "activate" }], 90),
      makeCase("layer-matching", "A region on layer 1 is ignored by a player on layer 0 and fires for a player on layer 1.", { board: "field", boards: { field: board({ programs: [region("upper", "step", 96, 32, 160, 96, { layer: 1 })] }) }, players: [hero({ x: 48, y: 63, speed: 0.02 }), { id: "ally", x: 48, y: 127, layer: 1, speed: 0.02, controlled: false }] }, [walk("E,E,E")], 40),
      makeCase("layer-one-player-fires", "The same region fires when the controlled player is on layer 1.", { board: "field", boards: { field: board({ programs: [region("upper", "step", 96, 32, 160, 96, { layer: 1 })] }) }, players: [hero({ x: 48, y: 63, speed: 0.02, layer: 1 })] }, [walk("E,E,E")], 40),
      makeCase("last-region-in-board-order-wins", "Activation: among matching regions the last in stored board order wins; the earlier one is not marked fired.", field({ programs: [region("first", "step", 96, 32, 160, 96), region("second", "step", 96, 32, 160, 96)] }), [walk("E,E")], 40),
      makeCase("items-before-regions-front-then-nearest", "R-52 item 2: items are chosen before regions; the item most directly in front (facing E) wins over a nearer item beside the player; a region under both is ignored.", field({ programs: [region("floor", "step", 64, 32, 160, 96)], items: [item("beside", 80, 79, "step"), item("ahead", 104, 63, "step")] }), [walk("E")], 20),
      makeCase("equal-front-and-distance-lowest-index", "R-52 item 2: equal in-front value and equal distance, the lowest compacted runtime item index wins.", field({ items: [item("north-guard", 80, 43, "step"), item("south-guard", 80, 83, "step")] }), [walk("E")], 20),
      makeCase("condition-failure-falls-through", "R-52 item 1: a failed condition removes the candidate without consuming the event, so the earlier unconditional region fires.", withVars(field({ programs: [region("open-door", "step", 96, 32, 160, 96), region("locked-door", "step", 96, 32, 160, 96, { condition: { var: "has_key", value: 1 } })] }), { has_key: 0 }), [walk("E,E")], 40),
      makeCase("run-once-condition-before-set-after", "E-44 and R-52 item 4: the condition is tested before the program and the variable set after it; leaving and re-entering does not fire again.", withVars(field({ programs: [region("intro", "step", 96, 32, 160, 96, { condition: { var: "seen", value: 0 }, set: { var: "seen", value: 1 } })] }), { seen: 0 }), [walk("E,E,E,E,W,W,W,W")], 130),
      makeCase("aborted-program-does-not-set", "R-52 item 4: a program aborted by an unhandled error does not set its variable.", withVars(field({ programs: [region("faulty", "step", 96, 32, 160, 96, { set: { var: "done", value: 1 }, ops: [{ op: "abort" }] })] }), { done: 0 }), [walk("E,E")], 40),
      makeCase("stop-movement-clears-queue", "A region flagged stop-movement clears the player's queued movement before running.", field({ programs: [region("gate", "step", 96, 32, 160, 96, { stopMovement: true })] }), [walk("E,E,E,E,E,E")], 80),
      makeCase("gone-suppresses-until-board-left", "Reawakened gone rule: gone() suppresses only this trigger until the board is left; the region stays on the board.", field({ programs: [region("once-only", "step", 96, 32, 160, 96, { ops: [{ op: "gone" }] })] }), [walk("E,E,E,E,W,W,W,W")], 130),
      makeCase("trigger-origin-movement-does-not-recurse", "P-8 / E-45: a program-issued step cannot start another trigger; the trigger-origin mark belongs to that move, not the whole queue.", field({ programs: [region("shove", "step", 64, 32, 96, 96, { ops: [{ op: "triggerMove", dirs: "E,E,E" }] }), region("beyond", "step", 128, 32, 192, 96)] }), [walk("E")], 80),
      makeCase("unrelated-queued-step-remains-eligible", "P-8: a pre-existing unrelated step remains eligible even when trigger-origin steps are appended to the same queue.", field({ programs: [region("shove", "step", 64, 32, 96, 96, { ops: [{ op: "triggerMove", dirs: "E,E,E" }] }), region("beyond", "step", 128, 32, 192, 96)] }), [walk("E,E,E")], 100),
      makeCase("new-unrelated-step-remains-eligible", "P-8: a new unrelated step appended while trigger-origin movement is queued can still start an unconsumed trigger.", field({ programs: [region("shove", "step", 64, 32, 96, 96, { ops: [{ op: "triggerMove", dirs: "E,E,E" }] }), region("beyond", "step", 128, 32, 192, 96), region("later", "step", 192, 32, 256, 96)] }), [walk("E"), { t: 12, op: "push", actor: "hero", dirs: "E" }], 100),
      makeCase("hidden-item-is-not-a-candidate", "E-45: an item whose loading condition fails is hidden and offers no activation until shown by script.", withVars(field({ items: [item("secret", 112, 63, "step", { actor: { loadCondition: { var: "door", value: 1 } } })] }), { door: 0 }), [walk("E"), { t: 30, op: "showItem", item: "secret" }, { t: 31, op: "teleport", actor: "hero", x: 48, y: 63 }, walk("E", 32)], 70),
    ],
  };
}

export function actorHydrationItemMultitask() {
  const hall = board({
    threads: [{ id: "hall.ambience", kind: "board" }],
    items: [
      npc("clerk", 112, 63, { slot: 0, thread: "clerk.prg" }),
      npc("statue", 144, 95, { slot: 2 }),
      npc("ghost", 176, 63, { slot: 3, thread: "ghost.prg", loadCondition: { var: "haunted", value: 1 } }),
      npc("cat", 208, 95, { slot: 5, thread: "cat.prg" }),
    ],
  });
  return {
    spec: ["movement-and-collision.md#e-20", "movement-and-collision.md#e-29", "movement-and-collision.md#e-45"],
    cases: [
      makeCase("hydrate-order-and-item-threads", "Players hydrate first, then items by compacted runtime index (raw slots 0, 2, 3, 5 become 0..3); a hidden item (E-45) starts no thread; removing an item stops its thread; showing a hidden item starts it (PROPOSED P-9).", { board: "hall", boards: { hall }, players: [hero(), { id: "ally", x: 80, y: 63, layer: 0, controlled: false }], vars: { haunted: 0 } }, [{ t: 2, op: "removeItem", item: "clerk" }, { t: 4, op: "showItem", item: "ghost" }, { t: 6, op: "hideItem", item: "ghost" }], 8),
    ],
  };
}

const PF = (mode, o = {}) => board({ w: 320, h: 320, pfMode: mode, ...o });
const quest = (setup, goal, flags = FLAGS.PATHFIND, t = 0) => [{ t, op: "path", actor: "walker", flags, points: [goal] }];
const walker = (x, y) => npc("walker", x, y, { speed: 0 });

export function pathfindingAxialDiagonalVector() {
  const wall = [solid("wall", 96, 0, 128, 224)];
  const open = (mode, vectors = []) => ({ board: "field", boards: { field: PF(mode, { vectors }) }, players: [hero({ x: 304, y: 295 })], items: undefined });
  const withWalker = (mode, vectors = [], x = 48, y = 63, extra = {}) => ({ board: "field", boards: { field: PF(mode, { vectors, items: [walker(x, y)], ...extra }) }, players: [hero({ x: 304, y: 295 })] });
  const pocket = [solid("n", 576, 576, 640, 608), solid("s", 576, 672, 640, 704), solid("w", 576, 608, 608, 672), solid("e", 608, 608, 640, 672)];
  // The pocket walls enclose the cell (18, 19)-(19, 20) region around the goal; the board is 40 x 40 cells.
  const big = (mode) => ({ board: "field", boards: { field: board({ w: 1280, h: 1280, pfMode: mode, vectors: [solid("box-n", 576, 576, 704, 608), solid("box-s", 576, 704, 704, 736), solid("box-w", 576, 608, 608, 704), solid("box-e", 672, 608, 704, 704)], items: [walker(48, 63)] }) }, players: [hero({ x: 1264, y: 1255 })] });
  void pocket;
  return {
    spec: ["movement-and-collision.md#e-34"],
    cases: [
      makeCase("axial-around-wall", "Mode 1: 4-way A* over the 32 px grid, Manhattan cost, around a wall; the final point is the exact goal.", withWalker(1, wall), quest(null, [208, 63]), 140),
      makeCase("diagonal-around-wall", "Mode 2: 8-way A*, octile cost; shorter than the axial path around the same wall.", withWalker(2, wall), quest(null, [208, 63]), 140),
      makeCase("vector-around-wall", "Mode 3: visibility graph over obstacle corners grown by the collision base; straight segments between corners.", withWalker(3, wall), quest(null, [208, 63]), 80),
      makeCase("blocked-goal-nearest-free", "E-34: a blocked goal moves to the nearest free node (ties by node coordinate); the walker stops adjacent to the sprite goal.", { board: "field", boards: { field: PF(1, { items: [walker(48, 63), npc("crate", 208, 63)] }) }, players: [hero({ x: 304, y: 295 })] }, quest(null, [208, 63]), 70),
      makeCase("tie-order-is-total", "AD-25: equal-cost routes tie by node coordinate then insertion index; the chosen route is part of the fixture (open field, goal two cells diagonal).", withWalker(1, [], 48, 63), quest(null, [112, 127]), 40),
      makeCase("unreachable-goal-approaches", "E-34: an enclosed goal is unreachable; the 1000-expansion cap ends the search and the walker approaches the expanded node nearest the goal.", big(1), [{ t: 0, op: "path", actor: "walker", flags: FLAGS.PATHFIND, points: [[640, 655]] }], 2),
      makeCase("cache-hit-edit-flush-and-new-route", "Results are cached per board and invalidated by a vector edit: the repeat query hits, the edit flushes, the next query misses and routes around the new wall.", withWalker(1, [], 48, 63), [{ t: 0, op: "path", actor: "walker", flags: FLAGS.PATHFIND | FLAGS.CLEAR_QUEUE, points: [[240, 63]] }, { t: 0, op: "path", actor: "walker", flags: FLAGS.PATHFIND | FLAGS.CLEAR_QUEUE, points: [[240, 63]] }, { t: 2, op: "editVector", action: "add", vector: { id: "new-wall", type: "solid", layer: 0, closed: true, points: rectPts(128, 32, 160, 96) } }, { t: 3, op: "path", actor: "walker", flags: FLAGS.PATHFIND | FLAGS.CLEAR_QUEUE, points: [[240, 63]] }], 8),
    ].map((c) => c),
    note: undefined,
  };
}
