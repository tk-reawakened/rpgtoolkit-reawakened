import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { actor, awaitMenu, bootUiRig, ui, type UiRig } from "./battle-ui-rig.ts";

// The fixture marks frame zero white and frame one black, independently of each stance's artwork.
// Check every roster slot, not just aggregate changes by delay: a frozen or early animation must fail on its own.
const fighters = [
  { name: "slime 0", file: "slime_rest.anm", delay: 1, loop: true },
  { name: "bat", file: "bat_rest.anm", delay: 2, loop: true },
  { name: "slime 2", file: "slime_rest.anm", delay: 1, loop: true },
  { name: "hero", file: "hero_rest.anm", delay: 3, loop: true },
  { name: "mage", file: "mage_rest.anm", delay: 2, loop: true },
  { name: "rogue", file: "rogue_die.anm", delay: 3, loop: false },
] as const;

type Timeline = { readonly id: number; readonly originTick: number };

function timelines(rig: UiRig, acting: boolean): Timeline[] {
  const ids = ui(rig)["spriteid"] as Record<string, number>;
  const animations = rig.state().fx.animations.filter((animation) => animation.pinned === true);
  equal(animations.length, fighters.length, "one pinned animation per fighter");
  const seen = new Set<number>();
  return fighters.map((fighter, index) => {
    const id = ids[String(index)];
    ok(typeof id === "number" && id > 0, `${fighter.name} has a sprite id`);
    ok(!seen.has(id), `${fighter.name} has its own animation`);
    seen.add(id);
    const animation = animations.find((candidate) => candidate.id === id);
    ok(animation !== undefined && animation.loaded, `${fighter.name} animation ${id} is loaded`);
    const file = acting && fighter.name === "mage" ? "mage_fight.anm" : fighter.file;
    ok(animation.file.toLowerCase().endsWith(file), `${fighter.name} uses ${file}, got ${animation.file}`);
    equal(animation.delayTicks, fighter.delay, `${fighter.name} delay`);
    equal(animation.loop, fighter.loop, `${fighter.name} loop`);
    equal(animation.frames.length, 2, `${fighter.name} has two frames`);
    equal(animation.hidden, undefined, `${fighter.name} is visible`);
    return { id, originTick: animation.originTick };
  });
}

function assertCadence(rig: UiRig, ticks: number, acting: boolean, initial: readonly Timeline[]): void {
  const advances = fighters.map(() => 0);
  const previousFrames: (number | undefined)[] = fighters.map(() => undefined);
  for (let step = 0; step < ticks; step += 1) {
    rig.tick(1);
    equal(ui(rig)["mode"], acting ? "act" : "command", `phase at step ${step}`);
    if (acting) {
      equal(ui(rig)["acting"], actor(rig, "mage.tem").id, "the selected Mage is acting");
      equal(ui(rig)["actingstance"], "fight", "the Fight stance remains active");
    }
    const current = timelines(rig, acting);
    const frame = rig.frame();
    // Animation advancement for tick T happens before the state tick is incremented.
    const tick = rig.state().time.tick - 1;
    for (let index = 0; index < fighters.length; index += 1) {
      const fighter = fighters[index]!;
      const timeline = initial[index]!;
      deepEqual(current[index], timeline, `${fighter.name} retains its animation and origin at tick ${tick}`);
      const animation = rig.state().fx.animations.find((candidate) => candidate.id === timeline.id)!;
      const raw = Math.floor(Math.max(0, tick - timeline.originTick) / fighter.delay);
      const expectedFrame = fighter.loop ? raw % 2 : Math.min(raw, 1);
      equal(animation.frame, expectedFrame, `${fighter.name} animation ${timeline.id} at tick ${tick}`);
      const at = ((animation.y + 39) * frame.w + animation.x + 31) * 4;
      const colour = expectedFrame === 0 ? 255 : 0;
      deepEqual([...frame.rgba.subarray(at, at + 4)], [colour, colour, colour, 255],
        `${fighter.name} animation ${timeline.id} pixel at tick ${tick}, expected frame ${expectedFrame}`);
      if (previousFrames[index] !== undefined && previousFrames[index] !== expectedFrame) advances[index]! += 1;
      previousFrames[index] = expectedFrame;
    }
  }
  for (let index = 0; index < fighters.length; index += 1) {
    const fighter = fighters[index]!;
    if (fighter.loop) ok(advances[index]! >= Math.floor((ticks - 1) / fighter.delay),
      `${fighter.name} advanced at its own ${fighter.delay}-tick delay`);
  }
}

test("every stance picture advances at its own 1-, 2- or 3-tick frame delay, idle and during an action", () => {
  const rig = bootUiRig({ stanceDelays: { slime: 1, bat: 2, hero: 3, mage: 2, rogue: 3 } });
  awaitMenu(rig);
  equal(ui(rig)["menuindex"], 1, "the Mage has the first turn");
  equal(ui(rig)["cursor"], 0, "Fight is selected");
  const idle = timelines(rig, false);
  assertCadence(rig, 12, false, idle);

  rig.press("ENTER", 8);
  equal(ui(rig)["mode"], "target", "Fight opens target selection");
  equal(ui(rig)["targetparty"], 0, "the target is an enemy");
  equal(ui(rig)["targetcursor"], 0, "the first enemy is selected");
  const targets = ui(rig)["targets"] as Record<string, number>;
  equal(targets["0"], 0, "the selected target is the first enemy slot");
  const battle = rig.state().battle;
  ok(battle !== null);
  const targetId = battle.parties[0][0]!.actorId;
  const targetBefore = rig.state().actors.actors.find((candidate) => candidate.id === targetId);
  ok(targetBefore !== undefined);
  const targetHp = targetBefore.stats.hp;
  rig.press("ENTER", 1);
  rig.until(() => ui(rig)["mode"] === "act"
    && rig.state().fx.animations.some((animation) => animation.pinned === true
      && animation.loaded && animation.file.toLowerCase().endsWith("mage_fight.anm")), 30);
  equal(ui(rig)["acting"], actor(rig, "mage.tem").id, "confirming the target starts the Mage's action");
  equal(ui(rig)["actingstance"], "fight");
  const acting = timelines(rig, true);
  for (let index = 0; index < fighters.length; index += 1) {
    if (fighters[index]!.name === "mage") ok(acting[index]!.id !== idle[index]!.id, "Fight starts a new Mage animation");
    else deepEqual(acting[index], idle[index], `${fighters[index]!.name} keeps its idle timeline during Fight`);
  }
  assertCadence(rig, 24, true, acting);
  const targetAfter = rig.state().actors.actors.find((candidate) => candidate.id === targetId);
  ok(targetAfter !== undefined && targetAfter.stats.hp < targetHp, "the confirmed enemy took damage");
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
