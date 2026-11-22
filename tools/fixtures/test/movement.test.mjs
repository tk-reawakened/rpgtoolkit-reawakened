// Tests for the movement oracle (ticket 5.2): tools/fixtures/movement and its committed
// scenes under packages/core/test/fixtures/movement. The expected numbers asserted below are
// worked by hand from docs/spec/engine/movement-and-collision.md (R-50, R-51, R-54, E-34 ...),
// not read back from the simulation, so a regression in the oracle cannot confirm itself.
// This file imports nothing from packages/core.
import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "../author/generate.mjs";
import { CORPUS, MOVEMENT_OUT, PROPOSED, SCENE_NAMES, checkMovementCorpus, checkMovementImports, movementFixtureFiles, workspaceImports } from "../movement/index.mjs";
import { isGlancing } from "../movement/geometry.mjs";
import { ticksPerAdvance } from "../movement/sim.mjs";
import { padMask } from "../movement/input.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

const NAMED = [
  "movement-tile-pixel", "collision-solid-stairs-under", "collision-sprite-blocking", "edges-board-link-program",
  "board-entry-thread-lifecycle", "triggers-precedence", "tile-step-precheck-events", "actor-hydration-item-multitask", "pathfinding-axial-diagonal-vector",
  "input-replay-button-slots", "movement-waits", "animation-fallback-stance", "random-encounter",
  "demo-npc-pathfinding", "demo-npc-battle-trigger",
];

const load = (name) => JSON.parse(readFileSync(join(MOVEMENT_OUT, `${name}.json`), "utf8"));
const theCase = (scene, name) => {
  const found = load(scene).cases.find((c) => c.name === name);
  ok(found, `${scene}/${name} exists`);
  return found;
};
const rowAt = (c, t) => c.expect.find((r) => r.t === t);
const events = (c, type) => c.expect.flatMap((r) => (r.ev ?? []).filter((e) => e.e === type).map((e) => ({ t: r.t, ...e })));
const actorAt = (c, t, id) => rowAt(c, t).a.find((a) => a[0] === id);

test("every named scene resolves to a committed file, and the manifest lists them in order", () => {
  deepEqual(SCENE_NAMES, NAMED);
  const manifest = JSON.parse(readFileSync(join(MOVEMENT_OUT, "manifest.json"), "utf8"));
  deepEqual(manifest.scenes.map((s) => s.scene), NAMED);
  const onDisk = readdirSync(MOVEMENT_OUT).sort();
  deepEqual(onDisk, [...NAMED.map((n) => `${n}.json`), "manifest.json"].sort());
  for (const entry of manifest.scenes) {
    const doc = load(entry.scene);
    equal(doc.scene, entry.scene);
    ok(doc.cases.length > 0, `${entry.scene} has cases`);
    deepEqual(doc.cases.map((c) => c.name), entry.cases);
    for (const id of doc.proposed) ok(PROPOSED[id], `${entry.scene} cites ${id}`);
  }
});

test("every case carries one fact row per tick, in order, with positions, layers and no hashes", () => {
  for (const name of NAMED) {
    const doc = load(name);
    for (const c of doc.cases) {
      equal(c.expect.length, c.ticks, `${name}/${c.name} row count`);
      c.expect.forEach((row, index) => equal(row.t, index));
      if (c.setup.bindings === undefined) for (const row of c.expect) for (const actor of row.a) ok(Number.isFinite(actor[1]) && Number.isFinite(actor[2]) && Number.isInteger(actor[3]), `${name}/${c.name} actor row shape`);
    }
    ok(!/hash/i.test(JSON.stringify(doc.cases)), `${name} asserts no state or draw hash`);
  }
});

test("--check mode reproduces the committed fixtures byte for byte", () => {
  deepEqual(check(), []);
  const again = movementFixtureFiles();
  for (const [name, bytes] of movementFixtureFiles()) ok(again.find(([n]) => n === name)[1].equals(bytes), `${name} is deterministic`);
  for (const [name, bytes] of again) ok(readFileSync(join(MOVEMENT_OUT, name)).equals(bytes), `${name} matches disk`);
});

test("static import scan: the oracle and the generator import nothing from packages/core", () => {
  deepEqual(checkMovementImports(), []);
  deepEqual(workspaceImports('import a from "../../packages/core/src/x.ts"; import b from "@tk-reawakened/core"; import c from "./ok.mjs";'), ["../../packages/core/src/x.ts", "@tk-reawakened/core"]);
  const own = readdirSync(join(here, "..", "movement")).filter((f) => f.endsWith(".mjs"));
  ok(own.length >= 8);
});

test("the pinned demo corpus matches when it has been fetched", () => {
  deepEqual(checkMovementCorpus(repoRoot), []);
  deepEqual(load("demo-npc-pathfinding").corpus, CORPUS);
  deepEqual(load("demo-npc-battle-trigger").corpus, CORPUS);
});

test("R-50: integer ticks per advance, hand-worked", () => {
  equal(ticksPerAdvance(0.05, 0), 3); // 50 ms -> round(3.0)
  equal(ticksPerAdvance(0.05, 4), 1); // 50 - 400 < one tick
  equal(ticksPerAdvance(0, 0), 1);
  equal(ticksPerAdvance(0.01, -1), 7); // 110 ms -> floor((6600 + 500) / 1000)
  equal(ticksPerAdvance(0.05, -2), 15); // 250 ms
  equal(ticksPerAdvance(0.05, 9), 1); // game speed clamps to +4
});

test("movement-tile-pixel: a 32 px tile is 8 advances, 24 ticks, completing on the last advance", () => {
  const c = theCase("movement-tile-pixel", "tile-default-speed");
  deepEqual(actorAt(c, 0, "hero"), ["hero", 52, 63, 0, "moving", "E"]); // first advance on the tick the move starts
  deepEqual(actorAt(c, 3, "hero").slice(1, 3), [56, 63]);
  deepEqual(actorAt(c, 21, "hero").slice(1, 3), [80, 63]); // 8th advance of tile 1
  deepEqual(actorAt(c, 24, "hero").slice(1, 3), [84, 63]); // cadence continues into the next step
  const done = events(c, "movement-complete");
  deepEqual(done.map((e) => e.t), [69]); // 2 x 24 + 21
  deepEqual(actorAt(c, 69, "hero"), ["hero", 112, 95, 0, "waiting", "S"]);
  deepEqual(events(theCase("movement-tile-pixel", "tile-game-speed-clamps-to-one-tick"), "movement-complete").map((e) => e.t), [15]);
  deepEqual(events(theCase("movement-tile-pixel", "tile-game-speed-slower"), "movement-complete").map((e) => e.t), [49]);
});

test("collision-solid-stairs-under: blocked, sliding, layers and under facts", () => {
  const solid = theCase("collision-solid-stairs-under", "tile-solid-blocks");
  deepEqual(events(solid, "blocked").map((e) => e.t), [24, 25]); // the second E step blocks, then the third on the following update
  const slide = theCase("collision-solid-stairs-under", "pixel-glancing-slide");
  // R-54 item 3: the glancing SE step turns south, adopts the slid point and ends there, so x never moves.
  deepEqual(actorAt(slide, 0, "hero"), ["hero", 112, 67, 0, "waiting", "S"]);
  deepEqual(events(slide, "movement-complete").map((e) => e.t), [0]);
  const head = theCase("collision-solid-stairs-under", "pixel-head-on-blocks");
  equal(events(head, "blocked")[0].t, 0);
  equal(actorAt(head, 3, "hero")[2], 63); // head-on never changes y
  const stairs = theCase("collision-solid-stairs-under", "stairs-change-layer-and-layers-are-scoped");
  deepEqual(events(stairs, "layer-change").map((e) => [e.from, e.to, e.by]), [[0, 1, "stairs-up"]]);
  equal(events(stairs, "blocked").length, 0); // the layer-0 wall does not block a layer-1 sprite
  deepEqual(events(stairs, "under-enter").map((e) => e.vector), ["ceiling-under"]);
  deepEqual(events(stairs, "under-leave").map((e) => e.vector), ["ceiling-under"]);
  const table = load("collision-solid-stairs-under").thresholds.rows;
  deepEqual(table.map((r) => r.glancing), [true, false, false, true, false, true]);
  ok(isGlancing([1, 1], [1, 0], false)); // exactly 45 degrees is inclusive
  ok(!isGlancing([100, 101], [1, 0], false));
});

test("collision-sprite-blocking: R-64 consumed and retried steps, plus diversion, wait and stop", () => {
  const sc = "collision-sprite-blocking";
  // R-64 item 1: the player's blocked direction entry is consumed and counted; the NPC is unaffected.
  const lose = theCase(sc, "direction-step-consumed-into-npc");
  deepEqual(events(lose, "sprite-collision").map((e) => [e.t, e.winner, e.loser]), []);
  deepEqual(events(lose, "blocked").map((e) => e.t), [24, 25]);
  equal(actorAt(lose, 35, "npc")[4], "waiting");
  equal(actorAt(lose, 35, "hero")[1], 80); // two 32 px steps complete; the third is blocked at the last safe position
  // R-64 item 3: no direction step ever freezes another actor, not even a fresh attempt at tick 145.
  const thaw = theCase(sc, "blocked-direction-step-never-freezes-npc");
  equal(actorAt(thaw, 24, "npc")[4], "waiting");
  equal(actorAt(thaw, 143, "npc")[4], "waiting");
  deepEqual(events(thaw, "thaw").map((e) => e.t), []);
  deepEqual(events(thaw, "blocked").map((e) => e.t), [24, 25, 145]);
  equal(actorAt(thaw, 144, "hero")[4], "waiting");
  deepEqual(events(thaw, "sprite-collision").map((e) => e.t), []);
  // R-64 item 2: a direction block is not resolved by the R-51 winner/loser order.
  const movers = theCase(sc, "direction-movers-consume-and-retry");
  deepEqual(events(movers, "sprite-collision").map((e) => e.winner), []);
  deepEqual(events(movers, "blocked").length > 0, true);
  const retry = theCase(sc, "non-player-direction-steps-retry-forever");
  deepEqual(events(retry, "sprite-collision").map((e) => [e.winner, e.loser]), []);
  equal(actorAt(retry, 59, "slow")[4], "moving");
  equal(actorAt(retry, 59, "fast")[4], "moving");
  const mutual = theCase(sc, "mutual-direction-retry-queues-wait");
  deepEqual(events(mutual, "sprite-collision").map((e) => [e.winner, e.loser]), []);
  equal(actorAt(mutual, 89, "first")[4], "moving");
  equal(actorAt(mutual, 89, "second")[4], "moving");
  const dive = theCase(sc, "diversion-around-blocker");
  equal(events(dive, "diversion").length, 1);
  equal(events(dive, "sprite-collision").length, 0); // the collision is not applied
  deepEqual(actorAt(dive, 89, "walker").slice(1, 3), [240, 63]); // it still reaches its own target
  const wait = theCase(sc, "no-route-waits-then-continues");
  equal(events(wait, "waiting-for-blocker").length, 1);
  equal(events(wait, "sprite-collision").length, 0);
  deepEqual(actorAt(wait, 89, "walker").slice(1, 3), [240, 63]);
  const stop = theCase(sc, "no-route-wait-expires-and-stops");
  deepEqual(events(stop, "waiting-for-blocker").map((e) => e.t), [16]);
  deepEqual(events(stop, "path-stopped").map((e) => e.t), [136]); // 120 retests
  deepEqual(events(stop, "sprite-collision").map((e) => [e.winner, e.loser]), [["blocker", "walker"]]);
});

test("edges-board-link-program: R-66 preflight, refusals, arrival and program links", () => {
  const sc = "edges-board-link-program";
  // E-138/R-64: with no link the edge is solid at step start; the selected tile direction is consumed
  // and counted, and the step never advances.
  const noLink = theCase(sc, "no-link-edge-is-solid");
  deepEqual(events(noLink, "blocked").map((e) => [e.t, e.edge]), [[0, "S"]]);
  deepEqual(actorAt(noLink, 0, "hero").slice(1, 3), [144, 303]);
  equal(actorAt(noLink, 11, "hero")[4], "waiting");
  deepEqual(noLink.expect.filter((r) => r.fired), []);
  // R-66 item 4: an accepted crossing is a placement on the step's first tick, so no step completes.
  const link = theCase(sc, "board-link-arrives-opposite-edge");
  deepEqual(actorAt(link, 0, "hero").slice(1, 3), [15, 95]);
  deepEqual(events(link, "before-enter").map((e) => e.t), [0]);
  deepEqual(events(link, "edge-exit").map((e) => [e.t, e.dir]), [[0, "E"]]);
  deepEqual(events(link, "step-complete").filter((e) => e.t === 0), []);
  deepEqual(events(link, "enter-program").map((e) => e.program), ["east-enter.prg"]);
  // E-19/E-40 re-arms when the base leaves the area; R-67 defines an area overlap as any contact, so the
  // west step that brings the base's leading edge onto x = 64 already contacts the region and fires (t51).
  deepEqual(link.expect.filter((r) => r.fired).map((r) => r.t), [51]); // re-entering after leaving, never on arrival
  deepEqual(actorAt(theCase(sc, "arrival-clamps-along-edge"), 0, "hero").slice(1, 3), [15, 160]);
  // R-66 item 3: a refused crossing ends blocked, keeps the queued step, and nothing is switched.
  const refused = theCase(sc, "blocked-arrival-is-refused");
  deepEqual(events(refused, "blocked").map((e) => [e.t, e.edge]), [[0, "E"]]);
  deepEqual(events(refused, "arrival-rejected").map((e) => [e.reason, e.x, e.y]), [["solid", 15, 127]]);
  equal(events(refused, "board-link").length, 0);
  equal(events(refused, "edge-exit").length, 0);
  deepEqual(actorAt(refused, 29, "hero").slice(1, 3), [304, 95]); // stayed on the source board; the queued N step ran
  // R-66 item 3: a refusal is not counted, so a step program over the attempted destination never fires.
  deepEqual(theCase(sc, "refused-crossing-is-not-counted").expect.filter((r) => r.fired), []);
  // R-66 item 2: every refusal cause keeps the source board and the last safe position.
  for (const [name, reason] of [
    ["refusal-by-bounds-keeps-the-source", "bounds"],
    ["refusal-by-layer-count-keeps-the-source", "layer"],
    ["refusal-by-missing-board-keeps-the-source", "missing"],
    ["refusal-by-before-enter-cancel-keeps-the-source", "cancelled"],
  ]) {
    const refusedBy = theCase(sc, name);
    deepEqual(events(refusedBy, "arrival-rejected").map((e) => e.reason), [reason], name);
    deepEqual(events(refusedBy, "blocked").map((e) => e.edge), ["E"], name);
    deepEqual(actorAt(refusedBy, 11, "hero").slice(1, 3), [304, 95], name);
    equal(events(refusedBy, "board-link").length, 0, name);
  }
  // E-138: the vector result is tested before the edge, so a link never clears a solid.
  const vector = theCase(sc, "vector-is-tested-before-the-edge");
  deepEqual(events(vector, "blocked").map((e) => e.by), ["edge-wall"]);
  equal(events(vector, "before-enter").length, 0);
  // E-22/R-66: a point-style step ignores the source board's vectors, so a source solid over its
  // off-board point cannot skip the edge preflight. The accepted crossing is placed, not walked.
  const pointAccepted = theCase(sc, "point-path-edge-preflight-ignores-source-solid");
  deepEqual(actorAt(pointAccepted, 0, "hero").slice(1, 3), [15, 95]);
  // Accepting an edge exit faces the crossed edge for every step style (origin/main behaviour, E-19 does
  // not reset facing); a refused point step never moves, so it keeps the facing it had.
  equal(actorAt(pointAccepted, 0, "hero")[5], "E");
  equal(actorAt(theCase(sc, "board-link-arrives-opposite-edge"), 0, "hero")[5], "E");
  deepEqual(events(pointAccepted, "edge-exit").map((e) => [e.t, e.dir]), [[0, "E"]]);
  equal(events(pointAccepted, "step-complete").length, 0);
  const pointRefused = theCase(sc, "point-path-refusal-starts-at-the-last-safe-position");
  deepEqual(actorAt(pointRefused, 0, "hero").slice(1, 3), [290, 127], "no advance before the refusal");
  equal(actorAt(pointRefused, 0, "hero")[5], "S");
  deepEqual(events(pointRefused, "blocked").map((e) => [e.t, e.edge]), [[0, "E"]]);
  equal(events(pointRefused, "edge-exit").length, 0);
  // E-48 unchanged.
  deepEqual(events(theCase(sc, "program-link-runs-program"), "program-link").map((e) => e.program), ["north-gate.prg"]);
  deepEqual(actorAt(theCase(sc, "west-edge-arrives-east-edge"), 0, "hero").slice(1, 3), [305, 95]);
  // E-138: a non-selected player is not tested against the edge at all.
  const ally = theCase(sc, "non-selected-player-is-not-tested-against-the-edge");
  deepEqual(actorAt(ally, 7, "ally").slice(1, 3), [336, 95]);
  equal(events(ally, "blocked").length, 0);
  equal(actorAt(ally, 7, "hero").slice(1, 3).join(","), "48,63");
});

test("board-entry-thread-lifecycle: board and item threads stop, persistent survives, new threads start in order", () => {
  const sc = "board-entry-thread-lifecycle";
  const blocking = theCase(sc, "send-from-blocking-thread");
  deepEqual(events(blocking, "threads-stopped")[0].ids, ["town.clock", "town.crowd", "item:guard"]);
  deepEqual(events(blocking, "threads-started")[0].ids, ["inn.fire", "inn.bard", "item:innkeeper"]);
  deepEqual(events(blocking, "enter-program").map((e) => e.as), ["board"]);
  equal(events(blocking, "caller-resume").length, 1);
  const board = theCase(sc, "send-from-board-thread");
  deepEqual(events(board, "enter-program").map((e) => e.as), ["blocking"]);
  equal(events(board, "caller-killed").length, 1);
  equal(events(board, "caller-resume").length, 0);
  deepEqual(events(blocking, "send-swap").map((e) => e.t), [3]); // posted on tick 2, swapped between ticks
  deepEqual(events(theCase(sc, "second-send-replaces-first"), "send-swap").map((e) => e.board), ["inn"]);
});

test("triggers-precedence: once-per-entry, repeat distance, precedence, conditions, gone and per-move suppression", () => {
  const sc = "triggers-precedence";
  const fired = (c) => c.expect.filter((r) => r.fired).map((r) => [r.t, r.fired[0].id]);
  deepEqual(fired(theCase(sc, "step-on-once-per-entry-and-rearm")), [[15, "mat"], [55, "mat"]]);
  deepEqual(fired(theCase(sc, "repeat-distance")), [[15, "trail"], [31, "trail"], [47, "trail"]]);
  deepEqual(fired(theCase(sc, "key-press-versus-step-on")), [[15, "mat"], [60, "lever"], [70, "lever"]]);
  deepEqual(fired(theCase(sc, "layer-matching")), []);
  deepEqual(fired(theCase(sc, "layer-one-player-fires")), [[15, "upper"]]);
  deepEqual(fired(theCase(sc, "last-region-in-board-order-wins")), [[15, "second"]]);
  deepEqual(fired(theCase(sc, "items-before-regions-front-then-nearest")), [[7, "ahead"]]);
  deepEqual(fired(theCase(sc, "equal-front-and-distance-lowest-index")), [[7, "north-guard"]]);
  deepEqual(fired(theCase(sc, "condition-failure-falls-through")), [[15, "open-door"]]);
  const once = theCase(sc, "run-once-condition-before-set-after");
  deepEqual(fired(once), [[15, "intro"]]);
  deepEqual(once.expect.find((r) => r.vars).vars, { seen: 1 });
  equal(theCase(sc, "aborted-program-does-not-set").expect.some((r) => r.vars), false);
  const stop = theCase(sc, "stop-movement-clears-queue");
  deepEqual(actorAt(stop, 70, "hero").slice(1, 3), [112, 63]);
  deepEqual(fired(theCase(sc, "gone-suppresses-until-board-left")), [[15, "once-only"]]);
  const triggerOrigin = theCase(sc, "trigger-origin-movement-does-not-recurse");
  deepEqual(fired(triggerOrigin), [[7, "shove"]]);
  deepEqual(actorAt(triggerOrigin, 79, "hero").slice(1, 3), [176, 63]);
  const inherited = theCase(sc, "unrelated-queued-step-remains-eligible");
  deepEqual(fired(inherited), [[7, "shove"], [23, "beyond"]]);
  deepEqual(actorAt(inherited, 99, "hero").slice(1, 3), [240, 63]);
  const appended = theCase(sc, "new-unrelated-step-remains-eligible");
  deepEqual(fired(appended), [[7, "shove"], [39, "later"]]);
  deepEqual(actorAt(appended, 99, "hero").slice(1, 3), [208, 63]);
  deepEqual(fired(theCase(sc, "hidden-item-is-not-a-candidate")), [[39, "secret"]]);
});

test("tile-step-precheck-events: a counted blocked step is processed at its intended destination", () => {
  const sc = "tile-step-precheck-events";
  // R-63: the step into the wall (x 76..84) never advances, so the player stays at x 48 and only turns.
  const door = theCase(sc, "blocked-counted-step-fires-the-step-region-at-the-destination");
  deepEqual(door.expect.filter((r) => r.fired).map((r) => [r.t, r.fired[0].id]), [[0, "door"]]);
  deepEqual(actorAt(door, 0, "hero").slice(1, 3), [48, 63]);
  equal(actorAt(door, 0, "hero")[5], "E");
  deepEqual(events(door, "blocked").map((e) => [e.t, e.by]), [[0, "wall"]]);
  deepEqual(events(door, "movement-complete").map((e) => [e.t, e.blocked]), [[0, true]]);
  equal(events(door, "step-complete").length, 0);
  // R-64 item 2: the battle check runs at the intended destination tile (x 48 is tile 1, x 80 is tile 2).
  const battle = theCase(sc, "blocked-counted-step-checks-battles-at-the-destination");
  deepEqual(events(battle, "tile-moved").map((e) => [e.t, e.cell]), [[0, [2, 1]]]);
  deepEqual(events(battle, "rng-draw").map((e) => [e.n, e.value]), [[4, 0], [1, 0]]);
  const handoff = events(battle, "fight-handoff")[0];
  equal(handoff.t, 0);
  deepEqual(handoff.enemies, ["rat.ene"]);
  deepEqual([handoff.x, handoff.y], [48, 63]);
  // R-67: the counted blocked step adds one step's worth (32 px) of repeat distance at the attempted
  // destination. A 40 px program therefore fires on entry (tick 0) and again once 64 px has accumulated on
  // the third press (tick 16), never on the second (32 px).
  const repeat = theCase(sc, "blocked-counted-step-feeds-repeat-distance");
  deepEqual(repeat.expect.filter((r) => r.fired).map((r) => [r.t, r.fired[0].id]), [[0, "trail"], [16, "trail"]]);
  deepEqual(events(repeat, "blocked").map((e) => e.t), [0, 8, 16]);
  equal(actorAt(repeat, 16, "hero")[1], 48, "the player never moves");
  // R-67 item 3: 32 px or less fires on every counted blocked press.
  const every = theCase(sc, "repeat-distance-32-fires-on-every-blocked-press");
  deepEqual(every.expect.filter((r) => r.fired).map((r) => [r.t, r.fired[0].id]), [[0, "press32"], [8, "press32"]]);
  // R-67 item 2: a destination outside the area resets the counter and re-arms the program, so the press at
  // tick 24 fires on entry with no walking in between; the tick-8 eastward press accumulated only 32 px.
  const rearm = theCase(sc, "blocked-press-outside-the-area-rearms-the-repeat");
  deepEqual(rearm.expect.filter((r) => r.fired).map((r) => [r.t, r.fired[0].id]), [[0, "rearm"], [24, "rearm"]]);
  equal(actorAt(rearm, 16, "hero")[5], "W", "the westward press turns the player without moving him");
  // R-68 items 1-2: the region on the pressed-into tile and the destination battle check both run on the
  // tick the step is counted, so the program the region starts cannot split the bundle.
  const both = theCase(sc, "blocked-counted-step-fires-the-region-and-checks-the-battle");
  deepEqual(both.expect.filter((r) => r.fired).map((r) => [r.t, r.fired[0].id]), [[0, "door"]]);
  deepEqual(events(both, "tile-moved").map((e) => [e.t, e.cell]), [[0, [2, 1]]]);
  deepEqual(events(both, "fight-handoff").map((e) => e.t), [0]);
  // R-63 item 2 with R-64: the step is stopped after its first advance by an item that walked into the
  // destination's collision area, so it is not the counted step and the step region over the destination
  // never fires. The item finishes its own step at the end of the run.
  const midStep = theCase(sc, "blocked-mid-step-is-not-counted");
  deepEqual(midStep.expect.filter((r) => r.fired), []);
  deepEqual(actorAt(midStep, 1, "hero"), ["hero", 50.828125, 60.171875, 0, "waiting", "NE"]);
  deepEqual(events(midStep, "blocked").map((e) => [e.t, e.by]), [[1, "cart"]]);
  deepEqual(events(midStep, "step-complete").map((e) => e.actor), ["cart"]);
  deepEqual(events(midStep, "movement-complete").map((e) => [e.t, e.actor, e.blocked === true]), [[1, "hero", true], [7, "cart", false]]);
  // R-64 item 1: a blocked step consumes the entry whether or not it was counted, so the next queued
  // direction starts on the update after the block (tick 3 + 1), not one three-tick advance cadence later.
  // Hero speed 0.05 advances every three ticks: 52 at tick 0, then the precheck runs at tick 3 with the
  // cart (speed 0.02, one 4 px step per tick) already in the destination's collision area at (96, 63).
  const queue = theCase(sc, "blocked-mid-step-queue-continues-next-update");
  deepEqual(events(queue, "blocked").map((e) => [e.t, e.by]), [[3, "cart"]]);
  deepEqual(events(queue, "step-complete").map((e) => [e.t, e.actor]), [[7, "cart"]]);
  deepEqual(queue.expect.filter((r) => r.a.find((a) => a[0] === "hero")[2] === 59).map((r) => r.t), [4, 5, 6]);
  deepEqual(actorAt(queue, 4, "hero"), ["hero", 52, 59, 0, "moving", "N"]);
  // R-64 item 3: a non-selected party player keeps and retries its blocked entry every update, so it never
  // completes the step and never emits a counted or completed-step event.
  const ally = theCase(sc, "non-selected-player-blocked-step-retries");
  deepEqual(actorAt(ally, 5, "ally"), ["ally", 48, 127, 0, "moving", "E"]);
  equal(events(ally, "blocked").length, ally.ticks);
  equal(events(ally, "movement-complete").length, 0);
  equal(events(ally, "step-complete").length, 0);
});

test("actor-hydration-item-multitask: compacted order, hidden items and thread ownership", () => {
  const c = theCase("actor-hydration-item-multitask", "hydrate-order-and-item-threads");
  deepEqual(c.boot.filter((e) => e.e === "hydrate").map((e) => [e.id, e.drawId, e.index, e.slot, e.visible]), [
    ["hero", 0, 0, 0, true], ["ally", 1, 1, 1, true], ["clerk", 2, 0, 0, true], ["statue", 3, 1, 2, true], ["ghost", 4, 2, 3, false], ["cat", 5, 3, 5, true],
  ]);
  deepEqual(c.boot.find((e) => e.e === "threads-started").ids, ["hall.ambience", "item:clerk", "item:cat"]); // no thread for the hidden item
  deepEqual(events(c, "thread-stop").map((e) => [e.t, e.id]), [[2, "item:clerk"], [6, "item:ghost"]]);
  deepEqual(events(c, "thread-start").map((e) => [e.t, e.id]), [[4, "item:ghost"]]);
});

test("pathfinding-axial-diagonal-vector: routes, caps, nearest-free, tie order and cache", () => {
  const sc = "pathfinding-axial-diagonal-vector";
  const path = (name) => events(theCase(sc, name), "path")[0];
  const axial = path("axial-around-wall");
  equal(axial.route.length, 17);
  deepEqual(axial.route.at(-1), [208, 63]);
  ok(axial.route.every((p, i) => i === 0 || Math.abs(p[0] - axial.route[i - 1][0]) + Math.abs(p[1] - axial.route[i - 1][1]) === 32), "axial steps are 32 px, 4-way");
  ok(path("diagonal-around-wall").route.length < axial.route.length);
  deepEqual(path("vector-around-wall").route, [[81, 239], [143, 239], [208, 63]]); // corners of the wall grown by the base
  const blocked = path("blocked-goal-nearest-free");
  deepEqual(blocked.goalAdjusted, [176, 63]);
  equal(blocked.reached, true);
  deepEqual(path("tie-order-is-total").route, [[48, 95], [48, 127], [80, 127], [112, 127]]);
  const capped = path("unreachable-goal-approaches");
  equal(capped.capped, true);
  equal(capped.expansions, 1000);
  equal(capped.reached, false);
  const cache = events(theCase(sc, "cache-hit-edit-flush-and-new-route"), "path");
  deepEqual(cache.map((e) => e.cache), ["miss", "hit", "miss"]);
  ok(cache[2].route.length > cache[0].route.length);
});

test("input-replay-button-slots: bindings, dead zone, edges, merge, slots and click-to-move", () => {
  const sc = "input-replay-button-slots";
  equal(padMask({ axes: { x: 249, y: 0 }, buttons: 0 }), 0);
  equal(padMask({ axes: { x: 250, y: -1000 }, buttons: 1 }), 8 | 1 | 16);
  const kb = theCase(sc, "keyboard-diagonal-and-repeat");
  equal(rowAt(kb, 2).intent, "NE");
  deepEqual(kb.expect.flatMap((r) => (r.queue ?? []).map((q) => q.seq)), [1, 2, 3, 4, 5]);
  deepEqual(rowAt(kb, 3).queue, [{ seq: 3, key: "right" }], "auto-repeat keeps one raw compatibility key but adds no action edge");
  deepEqual(rowAt(kb, 4).queue, [{ seq: 4, key: "KeyQ" }], "an unbound physical key remains in the legacy queue");
  deepEqual(rowAt(kb, 5).held, ["up", "right", "confirm", "menu"], "Enter's defaults include both confirm and the legacy menu action");
  equal(rowAt(theCase(sc, "diagonals-disabled-last-press-wins"), 2).intent, "E");
  const gp = theCase(sc, "gamepad-dead-zone-edges-and-merge");
  equal(rowAt(gp, 1).held.length, 0); // 249 is inside the dead zone
  deepEqual(rowAt(gp, 2).held, ["right"]); // 250 is active
  deepEqual(rowAt(gp, 3).queue.map((q) => q.key), ["confirm", "up"]); // ascending physical changed-control order
  deepEqual(rowAt(gp, 4).queue, [{ seq: 4, key: "right" }], "a keyboard press still queues raw compatibility input while a pad holds right");
  deepEqual(rowAt(gp, 5).held, ["right"]);
  const gamepadOnly = theCase(sc, "gamepad-only-named-actions");
  deepEqual(rowAt(gamepadOnly, 1).held, ["confirm", "menu"]);
  deepEqual(rowAt(gamepadOnly, 1).queue.map((q) => q.key), ["confirm", "menu"]);
  const dc = theCase(sc, "gamepad-disconnect-and-unknown-devices");
  deepEqual(rowAt(dc, 5).held, ["right"]); // device 1 still holds it
  deepEqual(rowAt(dc, 6).held, []);
  const ptr = theCase(sc, "pointer-click-to-move-and-button-slots");
  deepEqual(rowAt(ptr, 1).click, { logical: [100, 100], board: [260, 196], via: "pathfind" });
  equal(rowAt(ptr, 2).queue, undefined, "slot press alone does not activate");
  deepEqual(rowAt(ptr, 4).queue, [{ seq: 1, key: "confirm", via: "slot:attack" }]);
  equal(rowAt(ptr, 5).click.logical[0], 80); // one past the slot edge
  deepEqual(rowAt(ptr, 6).notes, ["slot-disabled:menu"]);
  deepEqual(rowAt(ptr, 7).notes, ["slot:menu:enabled"]);
  deepEqual(rowAt(ptr, 8).queue, [{ seq: 2, key: "menu", via: "slot:menu" }]);
  const canceled = theCase(sc, "pointer-cancel-clears-slot-gesture");
  equal(rowAt(canceled, 2).queue, undefined, "cancel is not a slot release");
  deepEqual(rowAt(canceled, 4).click, { logical: [30, 30], board: [130, 230], via: "pathfind" });
  equal(rowAt(canceled, 5).click, undefined, "cancel creates no click destination");
});

test("movement-waits: the wait is polled in the waits phase, one tick after completion", () => {
  const sc = "movement-waits";
  const pause = theCase(sc, "pause-thread-flag-waits-for-completion");
  deepEqual(events(pause, "movement-complete").map((e) => e.t), [23]);
  equal(rowAt(pause, 23).th.T, "wait:movement");
  equal(rowAt(pause, 24).th.T, "done");
  deepEqual(events(pause, "locate").map((e) => [e.t, e.x, e.y]), [[24, 144, 95]]);
  const free = theCase(sc, "without-the-flag-the-thread-continues");
  deepEqual(events(free, "continued").map((e) => e.t), [0]);
  deepEqual(events(free, "woke-mid-walk").map((e) => e.t), [10]);
  deepEqual(events(theCase(sc, "blocking-thread-implies-the-wait"), "walked").map((e) => e.t), [16]);
  // R-68: an ordinary blocking program's movement completes at tick 7, but no end-of-step processing runs
  // while that live blocking thread exists, so the repeat region across the walked tile never fires.
  const suppressed = theCase(sc, "blocking-program-step-suppresses-end-of-step-processing");
  deepEqual(actorAt(suppressed, 7, "hero").slice(1, 5), [80, 63, 0, "waiting"]);
  equal(rowAt(suppressed, 7).th.main, "wait:movement");
  deepEqual(suppressed.expect.filter((r) => r.fired), []);
  // R-68 item 3: a board thread parked in the same movement wait is not a blocking script, so the same
  // step runs end-of-step processing and the 32 px repeat region fires when it completes.
  const roaming = theCase(sc, "background-thread-movement-counts-as-free-roaming");
  deepEqual(roaming.expect.filter((r) => r.fired).map((r) => [r.t, r.fired[0].id]), [[7, "step-region"]]);
  deepEqual(events(roaming, "step-complete").map((e) => e.t), [7]);
  const multi = theCase(sc, "multirun-one-wait-over-both-sprites");
  deepEqual(events(multi, "movement-complete").map((e) => [e.t, e.actor]), [[15, "a"], [31, "b"]]);
  deepEqual(events(multi, "both-done").map((e) => e.t), [32]);
  deepEqual(events(theCase(sc, "waypoint-path-copy-two-cycles"), "waypoint-complete").length, 1);
  const link = theCase(sc, "waypoint-link-sees-live-edit");
  ok(link.expect.some((r) => r.a.find((a) => a[0] === "a")[1] > 112), "the edited second point pulls the item past x = 112");
});

test("animation-fallback-stance: documented fall-backs, frame timing and stance completion", () => {
  const sc = "animation-fallback-stance";
  const diag = theCase(sc, "diagonal-walk-falls-back-to-horizontal");
  equal(actorAt(diag, 0, "hero")[6], "walk.E"); // NE facing, no NE walk: nearest horizontal
  deepEqual(actorAt(diag, 6, "hero").slice(6), ["walk.E", 1]); // 100 ms = 6 ticks per frame
  equal(actorAt(diag, 39, "hero")[4], "waiting"); // idleMs 500 = 30 ticks after movement ends on tick 11
  equal(actorAt(diag, 40, "hero")[4], "idling");
  equal(actorAt(diag, 40, "hero")[6], "walk.E"); // a missing idle uses the walk animation
  const idle = theCase(sc, "missing-idle-uses-walk-present-idle-loops");
  equal(actorAt(idle, 125, "hero")[6], "idle.S");
  const stance = theCase(sc, "stance-plays-once-and-completes");
  deepEqual(events(stance, "stance-complete").map((e) => [e.t, e.held]), [[20, false]]); // 3 frames x 6 ticks from tick 3
  const held = theCase(sc, "held-stance-until-movement-resumes");
  deepEqual(events(held, "stance-complete").map((e) => [e.t, e.held]), [[13, true]]);
  deepEqual(events(held, "stance-released").map((e) => e.t), [24]);
});

test("random-encounter: one roll per tile moved, after activation, with stable handoff data", () => {
  const sc = "random-encounter";
  const one = theCase(sc, "type-zero-one-roll-per-tile-after-activation");
  deepEqual(events(one, "tile-moved").map((e) => e.t), [7, 15, 23, 31, 39, 47]);
  equal(rowAt(one, 15).fired[0].id, "mat"); // activation fired on the same tick, before the roll
  const handoff = events(one, "fight-handoff");
  deepEqual(handoff.map((e) => [e.t, e.enemies, e.background, e.player]), [[23, ["rat.ene", "bat.ene"], "cave.bkg", "hero"]]);
  deepEqual(events(theCase(sc, "type-one-every-n-tiles"), "fight-handoff").map((e) => [e.t, e.enemies.length]), [[15, 1], [31, 4], [47, 1]]);
  equal(events(theCase(sc, "pixel-steps-within-a-tile-roll-once"), "rng-draw").length, 1);
  equal(events(theCase(sc, "board-forbids-battles"), "rng-draw").length, 0);
  equal(events(theCase(sc, "main-file-disables-fighting"), "tile-moved").length, 0);
  deepEqual(events(theCase(sc, "custom-fight-program"), "custom-fight-program").map((e) => e.program), ["fight.prg"]);
  deepEqual(events(theCase(sc, "no-enemy-of-the-skill-level"), "message").map((e) => e.text), ["No enemies of skill level 2 found."]);  // R-68 with R-64: the step a blocking program drove is not tested, but its tile is recorded, so the
  // free-roam step back to the start tile is a new tile and draws once (a fight at tick 27).
  const suppressed = theCase(sc, "suppressed-program-step-records-its-tile");
  deepEqual(events(suppressed, "tile-moved").map((e) => [e.t, e.cell]), [[27, [1, 1]]]);
  deepEqual(events(suppressed, "rng-draw").map((e) => e.t), [27, 27, 27]);
  deepEqual(events(suppressed, "fight-handoff").map((e) => e.t), [27]);
  deepEqual(suppressed.expect.filter((r) => r.ev?.some((e) => e.e === "rng-draw" && r.t === 7)), []);

});

test("demo scenes: the corpus pathfinding NPC intercepts, and a stationary player gets the battle handoff", () => {
  const battle = theCase("demo-npc-battle-trigger", "stationary-player-is-intercepted-and-fights");
  const fight = events(battle, "fightEnemy");
  deepEqual(fight.map((e) => [e.t, e.enemy, e.background]), [[80, "pirate.ene", "bkg.bkg"]]);
  equal(rowAt(battle, 36).th.man_wander, "wait:key");
  equal(rowAt(battle, 80).th.man_wander, "done");
  const path = events(battle, "path")[0];
  equal(path.mode, 2);
  deepEqual(path.goalAdjusted, [240, 223]); // the player's own node is blocked by its base
  const walk = theCase("demo-npc-pathfinding", "wander-when-the-player-is-far");
  deepEqual(events(walk, "rng-draw").slice(0, 2).map((e) => [e.n, e.value]), [[512, 300], [512, 200]]);
  deepEqual(events(walk, "path")[0].goal, [380, 167]); // 336 + (300 - 256), 223 + (200 - 256)
  const away = theCase("demo-npc-pathfinding", "intercept-but-the-player-keeps-moving");
  equal(events(away, "fightEnemy").length, 0);
});
