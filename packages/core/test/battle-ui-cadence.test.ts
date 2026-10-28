import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { fnv1a64 } from "../src/index.ts";
import { awaitMenu, bootUiRig, type UiRig } from "./battle-ui-rig.ts";

// Frame cadence (entry 7.11, BAT-11 item 4): every fighter is one engine-owned pinned animation, so each picture on the
// real screen must change on exactly the ticks its animation's frame index changes, at the stored frame delay, idle and
// during an action. The comparison is per animation id, so a stance switch (a new animation) is not mistaken for a skip.
type Sample = { readonly id: number; readonly frame: number; readonly picture: string; readonly delay: number };

function samplePictures(rig: UiRig): Map<number, Sample> {
  const frame = rig.frame();
  const result = new Map<number, Sample>();
  for (const animation of rig.state().fx.animations) {
    if (animation.pinned !== true || !animation.loaded) continue;
    const crop = new Uint8Array(64 * 64 * 4);
    for (let row = 0; row < 64; row += 1) {
      const from = ((animation.y + row) * frame.w + animation.x) * 4;
      crop.set(frame.rgba.subarray(from, from + 64 * 4), row * 64 * 4);
    }
    result.set(animation.id, { id: animation.id, frame: animation.frame, picture: fnv1a64(crop), delay: animation.delayTicks });
  }
  return result;
}

function cadenceViolations(rig: UiRig, ticks: number): { readonly compared: number[]; readonly changed: number[]; readonly violations: string[] } {
  const violations: string[] = [];
  const compared = [0, 0, 0, 0];
  const changed = [0, 0, 0, 0];
  let previous = samplePictures(rig);
  for (let step = 0; step < ticks; step += 1) {
    rig.tick(1);
    const current = samplePictures(rig);
    for (const [id, now] of current) {
      const before = previous.get(id);
      if (before === undefined) continue;
      compared[now.delay]! += 1;
      const frameMoved = now.frame !== before.frame;
      const pictureMoved = now.picture !== before.picture;
      if (frameMoved) changed[now.delay]! += 1;
      if (frameMoved !== pictureMoved) violations.push(`tick ${rig.state().time.tick} animation ${id}: frame ${before.frame}->${now.frame} but picture ${pictureMoved ? "changed" : "did not change"}`);
    }
    previous = current;
  }
  return { compared, changed, violations };
}

test("every stance picture advances at its own 1-, 2- or 3-tick frame delay, idle and during an action", () => {
  const rig = bootUiRig({ stanceDelays: { slime: 1, bat: 2, hero: 3, mage: 2, rogue: 3 } });
  awaitMenu(rig);
  const idle = cadenceViolations(rig, 12);
  for (const delay of [1, 2, 3]) {
    ok(idle.compared[delay]! >= 12, `delay ${delay} compared each idle tick`);
    ok(idle.changed[delay]! >= Math.floor(12 / delay), `delay ${delay} frames moved`);
  }
  deepEqual(idle.violations, [], "idle cadence");
  rig.press("ENTER", 4);
  const acting = cadenceViolations(rig, 24);
  for (const delay of [1, 2, 3]) {
    ok(acting.compared[delay]! > 0, `delay ${delay} compared during action`);
    ok(acting.changed[delay]! > 0, `delay ${delay} advanced during action`);
  }
  deepEqual(acting.violations, [], "cadence during the action");
  deepEqual(rig.diagnostics, []);
});

test("each pinned animation's frame is the pure function of its start tick, delay and the tick it was advanced on", () => {
  const rig = bootUiRig({ stanceDelayTicks: 2 });
  awaitMenu(rig);
  for (let step = 0; step < 9; step += 1) {
    rig.tick(1);
    // The animation phase of tick T runs before the engine counts the tick, so the state read now holds the frame of tick - 1.
    const tick = rig.state().time.tick - 1;
    for (const animation of rig.state().fx.animations) {
      if (animation.pinned !== true || !animation.loaded) continue;
      const elapsed = Math.max(0, tick - animation.originTick);
      const raw = Math.floor(elapsed / animation.delayTicks);
      equal(animation.frame, animation.loop ? raw % animation.frames.length : Math.min(raw, animation.frames.length - 1), `animation ${animation.id} at tick ${tick}`);
    }
  }
});
