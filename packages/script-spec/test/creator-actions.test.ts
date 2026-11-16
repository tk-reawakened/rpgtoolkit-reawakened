import { deepEqual, equal, throws } from "node:assert/strict";
import test from "node:test";
import { createCreatorActionScheduler, SpecActionError } from "../src/index.ts";
test("each action call holds its own semantic claim on the exact future ticks", () => {
  const scheduler = createCreatorActionScheduler();
  const first = scheduler.schedule("left", 2, 5, []);
  const second = scheduler.schedule("confirm", 1, 5, []);

  deepEqual([first.pressAt, first.releaseAt, second.pressAt, second.releaseAt], [6, 8, 6, 7]);
  equal(first.source, "spec.action:1");
  equal(second.source, "spec.action:2");
  deepEqual(scheduler.takeInputs(6).map(({ event }) => [event.kind, event.kind === "action" ? event.source : "", event.kind === "action" ? event.down : false]), [
    ["action", "spec.action:1", true],
    ["action", "spec.action:2", true],
  ]);
  deepEqual(scheduler.takeInputs(7).map(({ event }) => [event.kind, event.kind === "action" ? event.source : "", event.kind === "action" ? event.down : false]), [
    ["action", "spec.action:2", false],
  ]);
  scheduler.completeTick(7);
  deepEqual(scheduler.actions.map(({ completedAt }) => completedAt), [null, 7]);
  deepEqual(scheduler.takeInputs(8).map(({ event }) => [event.kind, event.kind === "action" ? event.source : "", event.kind === "action" ? event.down : false]), [
    ["action", "spec.action:1", false],
  ]);
  scheduler.completeTick(8);
  deepEqual(scheduler.actions.map(({ completedAt }) => completedAt), [8, 7]);
});

test("restoring a group action snapshot preserves a pending release without sharing mutable state", () => {
  const original = createCreatorActionScheduler();
  original.schedule("game.openDoor", 3, 10, ["game.openDoor"]);
  original.takeInputs(11);

  const resumed = createCreatorActionScheduler(original.snapshot());
  deepEqual(resumed.takeInputs(14).map(({ event }) => event.kind === "action" ? [event.source, event.down] : []), [["spec.action:1", false]]);
  resumed.completeTick(14);
  equal(resumed.actions[0]?.completedAt, 14);
  equal(original.actions[0]?.completedAt, null);
});

test("invalid action names and durations do not consume claims or schedule partial edges", () => {
  const scheduler = createCreatorActionScheduler();
  throws(() => scheduler.schedule("teleport", 1, 0, []), (error: unknown) => error instanceof SpecActionError && error.code === "spec.bad-action");
  for (const ticks of [0, -1, 1.5, 1001, Number.MAX_SAFE_INTEGER]) {
    throws(() => scheduler.schedule("up", ticks, 0, []), (error: unknown) => error instanceof SpecActionError && error.code === "spec.bad-ticks");
  }
  deepEqual(scheduler.actions, []);
  deepEqual(scheduler.takeInputs(1), []);
  equal(scheduler.schedule("up", 1, 0, []).source, "spec.action:1");
});
