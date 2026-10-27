// The default battle UI (entry 7.11, issue #514; docs/spec/engine/battle.md#bat-11).
//
// A whole seeded game boots the real stock_battle package with a screen, answers every asset request from authored
// files (battle-ui-rig.ts), presses real keys through the engine's key queue and reads back the battle, the actors, the
// audio cues and the composed frame. The golden frames in golden/battle-ui/ are PROPOSED for the owner's approval; they
// are compared pixel for pixel and rewritten only with BATTLE_UI_GOLDEN=record (G5).
import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canon, decodeTexture, fnv1a64, hashDrawList, readSurfacePixels, type ActorRecord } from "../src/index.ts";
import { bootUiRig, encodePng, type UiRig } from "./battle-ui-rig.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const goldenDirectory = join(repoRoot, "golden", "battle-ui");
const manifestPath = join(goldenDirectory, "frames.json");
const stockSource = readFileSync(join(repoRoot, "stock", "stock_battle", "startup.prg"), "utf8");

type FrameRecord = { readonly keys: readonly string[]; readonly pixels: string; readonly drawList: string };
type Manifest = { readonly schema: 1; readonly seed: number; readonly size: readonly [number, number]; readonly frames: Record<string, FrameRecord> };

const recording = process.env["BATTLE_UI_GOLDEN"] === "record";

function readManifest(): Manifest {
  if (!existsSync(manifestPath)) return { schema: 1, seed: 291, size: [640, 480], frames: {} };
  return JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
}

/** Compare the composed frame with its golden PNG and recorded hashes, or (only when recording) rewrite them. */
function goldenFrame(rig: UiRig, name: string, keys: readonly string[]): void {
  rig.tick(6);
  const frame = rig.frame();
  const record: FrameRecord = { keys, pixels: fnv1a64(frame.rgba), drawList: hashDrawList(rig.engine.drawList()) };
  const png = join(goldenDirectory, `${name}.png`);
  if (recording) {
    mkdirSync(goldenDirectory, { recursive: true });
    writeFileSync(png, encodePng(frame.w, frame.h, frame.rgba));
    const manifest = readManifest();
    writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, frames: { ...manifest.frames, [name]: record } }, null, 2)}\n`);
    return;
  }
  const manifest = readManifest();
  const recorded = manifest.frames[name];
  ok(recorded !== undefined, `golden frame ${name} is not recorded (run with BATTLE_UI_GOLDEN=record and explain why in the pull request)`);
  deepEqual(record.keys, recorded.keys, `${name}: the key script changed`);
  const expected = decodeTexture(new Uint8Array(readFileSync(png)), `${name}.png`);
  if (!expected.ok) throw new Error(expected.error.message);
  equal(expected.value.w, frame.w);
  equal(expected.value.h, frame.h);
  let different = -1;
  for (let at = 0; at < frame.rgba.length; at += 1) if (frame.rgba[at] !== expected.value.rgba[at]) { different = at; break; }
  equal(different, -1, `${name}: first differing byte ${different} (pixel ${Math.floor(different / 4) % frame.w},${Math.floor(different / 4 / frame.w)})`);
  equal(record.pixels, recorded.pixels, `${name}: pixel hash`);
  equal(record.drawList, recorded.drawList, `${name}: draw-list hash`);
}

function actor(rig: UiRig, source: string): ActorRecord {
  const found = rig.state().actors.actors.find((candidate) => candidate.source === source);
  if (found === undefined) throw new Error(`no actor ${source}`);
  return found;
}

function ui(rig: UiRig): Record<string, unknown> {
  const dictionary = rig.ui();
  if (dictionary === null) throw new Error("the screen is not up");
  return dictionary;
}

function entries(value: unknown, count: number): Record<string, unknown>[] {
  const dictionary = value as Record<string, Record<string, unknown>>;
  return Array.from({ length: count }, (_, index) => dictionary[String(index)]!);
}

/** The battle's rule state the screen must never change: the actors, the battle section and the random generator. */
function ruleHash(rig: UiRig): string {
  const state = rig.state();
  return fnv1a64(canon({ actors: state.actors, battle: state.battle, rng: state.rng }));
}

function cueNames(rig: UiRig): string[] {
  return rig.cues.filter((cue) => cue.kind === "media.play").map((cue) => String(cue.asset).split("/").pop() ?? "");
}

function awaitMenu(rig: UiRig): void {
  rig.until(() => {
    const dictionary = rig.ui();
    return dictionary !== null && dictionary["mode"] === "command";
  }, 2000);
  rig.tick(8);
}

const MAGE = 1;
const THRESHOLD = 75;

test("a seeded battle opens the command box for the first charged player, and every command, list and target is reachable by keyboard", () => {
  const rig = bootUiRig();
  awaitMenu(rig);
  const mage = actor(rig, "mage.tem");
  deepEqual(rig.diagnostics, [], "booting the screen reports no diagnostic");
  equal(ui(rig)["on"], 1);
  equal(ui(rig)["menuindex"], MAGE, "with seed 291 the Mage is the first charged player");
  equal(ui(rig)["cursor"], 0);
  const keys: string[] = [];
  const press = (name: string): void => { keys.push(name); rig.press(name, 12); };
  goldenFrame(rig, "command", keys);

  // The command box wraps in both directions.
  press("UP");
  equal(ui(rig)["cursor"], 3, "UP from Fight wraps to Run");
  press("DOWN");
  equal(ui(rig)["cursor"], 0, "DOWN from Run wraps to Fight");
  deepEqual(cueNames(rig), ["move.wav", "move.wav"], "each cursor move plays the background's select sound");

  // A blocked Run (the Bat forbids it) plays the cancel sound and the player keeps the turn.
  press("UP");
  const chargeBefore = rig.charges()[1]![MAGE]!;
  ok(chargeBefore >= THRESHOLD);
  const rngBefore = JSON.stringify(rig.state().rng);
  const before = cueNames(rig).length;
  press("ENTER");
  equal(ui(rig)["mode"], "command", "choosing a blocked Run leaves the player in the command box");
  deepEqual(cueNames(rig).slice(before), ["cant.wav"], "and plays the cancel sound");
  equal(rig.charges()[1]![MAGE], chargeBefore, "the turn and the charge are kept");
  equal(JSON.stringify(rig.state().rng), rngBefore, "a refused Run draws no random number");
  equal(rig.state().battle?.outcome, null);

  // The Special list: a move the Mage cannot afford is listed, refused, and the player stays in the list.
  press("UP");
  press("UP");
  equal(ui(rig)["cursor"], 1);
  press("ENTER");
  equal(ui(rig)["mode"], "list");
  equal(ui(rig)["listkind"], "special");
  const specials = entries(ui(rig)["list"], Number(ui(rig)["listcount"]));
  deepEqual(specials.map((entry) => [entry["label"], entry["affordable"]]), [["fire", 0], ["blaze", 0]], "both moves cost more than the Mage's 3 SMP");
  goldenFrame(rig, "special", keys);
  const smpBefore = mage.stats.smp;
  const hashBefore = ruleHash(rig);
  const cuesBefore = cueNames(rig).length;
  press("ENTER");
  equal(ui(rig)["mode"], "list", "an unaffordable special keeps the player in the menu");
  deepEqual(cueNames(rig).slice(cuesBefore), ["cant.wav"]);
  equal(actor(rig, "mage.tem").stats.smp, smpBefore, "nothing was spent");
  equal(ruleHash(rig), hashBefore, "the refusal changed no actor, battle value or random number");

  // Esc goes back one level, and at the top level it does nothing.
  press("ESC");
  equal(ui(rig)["mode"], "command");
  const cuesAtTop = cueNames(rig).length;
  const hashAtTop = ruleHash(rig);
  press("ESC");
  equal(ui(rig)["mode"], "command", "Esc at the top opens no menu");
  equal(ui(rig)["cursor"], 1);
  equal(cueNames(rig).length, cuesAtTop, "and plays nothing");
  equal(ruleHash(rig), hashAtTop);

  // The Items list names only the battle-usable stacks (the Brass Key is not one).
  press("DOWN");
  press("ENTER");
  equal(ui(rig)["listkind"], "item");
  deepEqual(entries(ui(rig)["list"], Number(ui(rig)["listcount"])).map((entry) => [entry["label"], entry["detail"]]), [["Potion", "x3"], ["Ether", "x1"]]);
  press("ESC");
  equal(ui(rig)["mode"], "command");

  // Fight chooses among the living enemies; every one of them is reachable and the cursor wraps.
  press("UP");
  press("UP");
  equal(ui(rig)["cursor"], 0);
  press("ENTER");
  equal(ui(rig)["mode"], "target");
  deepEqual(entries(ui(rig)["targets"], Number(ui(rig)["targetcount"])), [0, 1, 2]);
  const seen = new Set<number>();
  for (let step = 0; step < 3; step += 1) {
    seen.add(Number(ui(rig)["targetcursor"]));
    press("RIGHT");
  }
  deepEqual([...seen].sort(), [0, 1, 2], "the target cursor reaches every enemy");
  equal(ui(rig)["targetcursor"], 0, "and wraps");
  press("DOWN");
  equal(ui(rig)["targetcursor"], 1);
  goldenFrame(rig, "target", keys);

  // The menu and target selection are drawn from state: while they wait, no rule value moves.
  const idleHash = ruleHash(rig);
  rig.tick(40);
  equal(ruleHash(rig), idleHash, "waiting in the menu changes no actor, charge or random number");

  // Performing the attack lowers exactly the chosen enemy's HP, shows its number, and ends the turn.
  const bat = actor(rig, "bat.ene");
  const batBefore = bat.stats.hp;
  press("ENTER");
  equal(ui(rig)["mode"], "act");
  rig.until(() => rig.charges()[1]![MAGE]! < THRESHOLD, 400);
  const batAfter = actor(rig, "bat.ene").stats.hp;
  ok(batAfter < batBefore, "the Bat took damage");
  deepEqual(rig.state().actors.actors.filter((candidate) => candidate.source === "slime.ene").map((candidate) => candidate.stats.hp), [30, 30], "only the chosen enemy was hurt");
  equal(ui(rig)["numbercount"], 0, "the numbers are gone when the turn ends");
  deepEqual(rig.diagnostics, []);
});



test("a healing item can target and revive a fallen ally, and a defeated enemy keeps its slot", () => {
  const rig = bootUiRig({ slimeHp: 5 });
  awaitMenu(rig);
  const keys: string[] = [];
  const press = (name: string): void => { keys.push(name); rig.press(name, 12); };
  const rogue = actor(rig, "rogue.tem");
  equal(rogue.stats.hp, 0, "the Rogue starts fallen");
  const potionHp = 20;

  press("DOWN");
  press("DOWN");
  press("ENTER");
  equal(ui(rig)["listkind"], "item");
  press("ENTER");
  equal(ui(rig)["mode"], "target");
  equal(ui(rig)["targetparty"], 1, "an item aims at the party");
  deepEqual(entries(ui(rig)["targets"], Number(ui(rig)["targetcount"])), [0, 1, 2], "fallen members are targets");
  press("RIGHT");
  press("RIGHT");
  equal(ui(rig)["targetcursor"], 2, "the cursor lands on the fallen Rogue");
  goldenFrame(rig, "revive", keys);
  press("ENTER");
  rig.until(() => rig.charges()[1]![MAGE]! < THRESHOLD, 400);
  equal(actor(rig, "rogue.tem").stats.hp, potionHp, "the Potion raised the fallen Rogue above 0");
  // PR #703 real inventory owner integration: exactly one Potion unit was consumed from inventory (quantity 3 -> 2).
  const potionStack = rig.state().inventory.items.find((item) => item.source.toLowerCase().includes("potion"));
  ok(potionStack !== undefined, "potion stack exists");
  equal(potionStack.quantity, 2, "the actual inventory owner decremented the potion count by 1");
  deepEqual(rig.diagnostics, []);

  // The next charged player attacks the first Slime, whose 5 HP one hit takes.
  awaitMenu(rig);
  press("ENTER");
  equal(ui(rig)["mode"], "target");
  press("ENTER");
  rig.until(() => ui(rig)["mode"] === "idle", 400);
  const slimes = rig.state().actors.actors.filter((candidate) => candidate.source === "slime.ene");
  equal(slimes.length, 2);
  ok(slimes[0]!.stats.hp === 0 || slimes[1]!.stats.hp === 0, "a Slime was defeated");
  equal(rig.state().battle?.parties[0].length, 3, "the defeated enemy stays in its slot");
  goldenFrame(rig, "defeated", keys);

  // The next Fight lists only the enemies still standing.
  awaitMenu(rig);
  press("ENTER");
  equal(ui(rig)["mode"], "target");
  equal(Number(ui(rig)["targetcount"]), 2, "the defeated enemy is skipped by the target cursor");
  deepEqual(rig.diagnostics, []);

  // Defect 3 regression: with target mode active, selecting an item whose inventory stack is 0 is refused cleanly
  // without trapping the UI in `mode: "act"`. It plays the cancel sound and restores `mode: "target"`.
  press("ESC"); // back to command box
  press("DOWN");
  press("DOWN");
  press("ENTER"); // open Items list
  equal(ui(rig)["listkind"], "item");
  press("ENTER"); // open target selection for Potion
  equal(ui(rig)["mode"], "target");
  rig.state().inventory.items = []; // inventory stack zeroed out before confirm
  press("ENTER"); // perform preflight fails
  equal(ui(rig)["mode"], "target", "refused item restores target mode");
  equal(cueNames(rig).slice(-1)[0], "cant.wav", "and plays cancel sound");
});

test("five party members (E-85 maximum 5) render without clipping and each member is reachable by keyboard", () => {
  const fiveParty = [
    { key: "hero" as const, hp: 42, smp: 12 },
    { key: "mage" as const, hp: 30, smp: 3 },
    { key: "rogue" as const, hp: 25, smp: 6 },
    { key: "hero" as const, hp: 38, smp: 10 },
    { key: "mage" as const, hp: 20, smp: 5 },
  ];
  const rig = bootUiRig({ party: fiveParty });
  awaitMenu(rig);
  equal(ui(rig)["on"], 1);
  equal(Number(rig.state().battle?.parties[1].length), 5, "all five members are in battle");
  // Open Items list and target selection across the five-member party
  rig.press("DOWN", 12);
  rig.press("DOWN", 12);
  rig.press("ENTER", 12); // open Items
  rig.press("ENTER", 12); // target party
  equal(ui(rig)["mode"], "target");
  equal(ui(rig)["targetparty"], 1);
  equal(Number(ui(rig)["targetcount"]), 5, "all five party members are selectable targets");
  // Step through all 5 members with the keyboard
  for (let step = 0; step < 5; step += 1) {
    equal(Number(ui(rig)["targetcursor"]), step, `cursor lands on member index ${step}`);
    rig.press("RIGHT", 12);
  }
  equal(Number(ui(rig)["targetcursor"]), 0, "target cursor wraps cleanly from fifth member back to first");
  // Capture rendered frame to verify no visual clipping
  const frame = rig.frame();
  ok(frame.w === 640 && frame.h === 480, "rendered at 640x480");
  deepEqual(rig.diagnostics, []);
});

// Frame cadence (entry 7.11, BAT-11 item 4): every fighter is one engine-owned pinned animation, so each picture on the
// real screen must change on exactly the ticks its animation's frame index changes, at the stored frame delay, idle and
// during an action. The comparison is per animation id, so a stance switch (a new animation) is not mistaken for a skip.
type Sample = { readonly id: number; readonly frame: number; readonly picture: string };

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
    result.set(animation.id, { id: animation.id, frame: animation.frame, picture: fnv1a64(crop) });
  }
  return result;
}

function cadenceViolations(rig: UiRig, ticks: number): { readonly compared: number; readonly changed: number; readonly violations: string[] } {
  const violations: string[] = [];
  let compared = 0;
  let changed = 0;
  let previous = samplePictures(rig);
  for (let step = 0; step < ticks; step += 1) {
    rig.tick(1);
    const current = samplePictures(rig);
    for (const [id, now] of current) {
      const before = previous.get(id);
      if (before === undefined) continue;
      compared += 1;
      const frameMoved = now.frame !== before.frame;
      const pictureMoved = now.picture !== before.picture;
      if (frameMoved) changed += 1;
      if (frameMoved !== pictureMoved) violations.push(`tick ${rig.state().time.tick} animation ${id}: frame ${before.frame}->${now.frame} but picture ${pictureMoved ? "changed" : "did not change"}`);
    }
    previous = current;
  }
  return { compared, changed, violations };
}

for (const delay of [1, 2, 3]) {
  test(`every stance picture on the real screen advances exactly at a ${delay}-tick frame delay, idle and during an action`, () => {
    const rig = bootUiRig({ stanceDelayTicks: delay });
    awaitMenu(rig);
    const idle = cadenceViolations(rig, 12);
    ok(idle.compared >= 12 * 3, `fighters were compared every tick (${idle.compared})`);
    ok(idle.changed >= Math.floor(12 / delay), `frames moved (${idle.changed})`);
    deepEqual(idle.violations, [], "idle cadence");
    rig.press("ENTER", 4);
    const acting = cadenceViolations(rig, 24);
    ok(acting.compared > 0);
    deepEqual(acting.violations, [], "cadence during the action");
    deepEqual(rig.diagnostics, []);
  });
}

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

/** Pinned pictures that are being drawn (not hidden). */
function pinnedCount(rig: UiRig): number {
  return rig.state().fx.animations.filter((animation) => animation.pinned === true && animation.hidden !== true).length;
}

function pinnedTimelines(rig: UiRig): { readonly id: number; readonly originTick: number; readonly loop: boolean }[] {
  return rig.state().fx.animations.filter((animation) => animation.pinned === true).map((animation) => ({ id: animation.id, originTick: animation.originTick, loop: animation.loop }));
}

function countColour(rig: UiRig, box: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }, colour: readonly [number, number, number]): { readonly count: number; readonly minY: number; readonly maxY: number } {
  const frame = rig.frame();
  let count = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = box.y1; y <= box.y2; y += 1) {
    for (let x = box.x1; x <= box.x2; x += 1) {
      const at = (y * frame.w + x) * 4;
      if (frame.rgba[at] === colour[0] && frame.rgba[at + 1] === colour[1] && frame.rgba[at + 2] === colour[2]) {
        count += 1;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return { count, minY, maxY };
}

const LIST_FIELD = { x1: 16, y1: 28, x2: 623, y2: 329 };
const LIST_HIGHLIGHT: readonly [number, number, number] = [40, 64, 140];
const ENEMY_BAR_RED: readonly [number, number, number] = [220, 64, 56];

test("an item list longer than sixteen entries pages inside its box, and the fighters' pictures and labels stay off it while it is open", () => {
  const rig = bootUiRig({ extraItems: 20, stanceDelayTicks: 2 });
  awaitMenu(rig);
  ok(pinnedCount(rig) > 0, "the fighters' pictures are showing before the list opens");
  const timelines = pinnedTimelines(rig);
  equal(timelines.length, 6, "three party members and three enemies");
  ok(countColour(rig, LIST_FIELD, ENEMY_BAR_RED).count > 0, "an enemy's HP bar shows on the field before the list opens");
  const press = (name: string): void => rig.press(name, 6);
  press("DOWN");
  press("DOWN");
  press("ENTER");
  equal(ui(rig)["listkind"], "item");
  equal(ui(rig)["listcount"], 22, "Potion, Ether and twenty gems; the key is not usable in a fight");
  rig.tick(6);
  equal(pinnedCount(rig), 0, "no picture is drawn over the open list");
  deepEqual(pinnedTimelines(rig), timelines, "the pictures are hidden, not ended: the same animations on the same timelines");
  equal(countColour(rig, LIST_FIELD, ENEMY_BAR_RED).count, 0, "no enemy label is drawn over the open list");
  // Each move redraws the list, which takes the turn loop several ticks, so presses queue up behind it; none is lost.
  for (let step = 0; step < 17; step += 1) press("DOWN");
  rig.until(() => ui(rig)["listcursor"] === 17, 120);
  rig.tick(8);
  equal(ui(rig)["listcursor"], 17);
  equal(ui(rig)["listtop"], 16, "the second page starts at entry 16");
  const highlight = countColour(rig, LIST_FIELD, LIST_HIGHLIGHT);
  ok(highlight.count > 200, `the selected row is drawn (${highlight.count} pixels)`);
  ok(highlight.minY >= 70 && highlight.maxY <= 326, `the selected row stays inside the list box (y ${highlight.minY}..${highlight.maxY})`);
  press("ENTER");
  equal(ui(rig)["mode"], "target");
  equal((ui(rig)["pendingentry"] as { label: string }).label, "Gem 16", "entry 17 is the sixteenth gem");
  press("ESC");
  press("ESC");
  rig.tick(8);
  equal(ui(rig)["mode"], "command");
  equal(pinnedCount(rig), 6, "the pictures return when the list is closed");
  deepEqual(pinnedTimelines(rig), timelines, "the same animations, none restarted");
  const dying = rig.state().fx.animations.filter((animation) => animation.pinned === true && !animation.loop);
  equal(dying.length, 1, "the fallen Rogue's die animation");
  equal(dying[0]!.frame, dying[0]!.frames.length - 1, "its die pose is still held on the last frame, not replayed");
  deepEqual(rig.diagnostics, []);
});

test("damage numbers are on the real screen for 36 ticks after they are drawn, plus the redraw that clears them", () => {
  const rig = bootUiRig({ slimeHp: 60 });
  awaitMenu(rig);
  rig.press("ENTER", 6);
  rig.press("ENTER", 1);
  // The first contiguous run of ticks on which the damage colour is on the field; a later action has its own run.
  let shown = 0;
  for (let step = 0; step < 100; step += 1) {
    rig.tick(1);
    const visible = countColour(rig, { x1: 0, y1: 0, x2: 639, y2: 340 }, [255, 96, 96]).count > 0;
    if (visible) shown += 1;
    else if (shown > 0) break;
  }
  ok(shown >= 36 && shown <= 44, `the number was on screen for ${shown} ticks`);
  deepEqual(rig.diagnostics, []);
});

test("a second battle in the same game starts a working screen with live canvases and its own pictures", () => {
  const rig = bootUiRig({ enemies: ["slime"], slimeHp: 1, fights: 2 });
  awaitMenu(rig);
  rig.press("ENTER", 6);
  rig.press("ENTER", 6);
  rig.until((state) => state.vm.globals.afterfight === 1, 3000);
  rig.until(() => ui(rig)["mode"] === "command", 3000);
  rig.tick(8);
  equal(rig.state().vm.globals.afterfight, 1, "the first fight is over and the second is on");
  equal(pinnedCount(rig), 4, "three party pictures and one enemy picture of the second battle");
  const frame = rig.frame();
  const at = (348 * frame.w + 160) * 4;
  deepEqual([...frame.rgba.subarray(at, at + 3)], [180, 190, 255], "the second battle's party panel frame is on screen");
  ok(countColour(rig, { x1: 8, y1: 348, x2: 151, y2: 479 }, [40, 64, 140]).count > 200, "the command panel's highlight is drawn");
  // The reserved overlay is the one from the first battle (it persists), plus this battle's buffer and the copy of the
  // overlay taken to restore it afterwards; nothing of the first battle's screen is left over.
  const fullSize = Object.values(rig.state().surfaces.entries).filter((entry) => entry.id !== (0 as never) && entry.bitmap.w === 640 && entry.bitmap.h === 480).map((entry) => entry.id);
  equal(fullSize.length, 3, `the overlay, the buffer and the overlay back-up (${fullSize.join(",")})`);
  equal(rig.state().surfaces.renderNow as number, 2, "the second battle draws on the reserved canvas the first one used");
  const buffer = rig.ui()?.["buffer"] as number;
  ok(fullSize.map((id) => id as number).includes(buffer), "the buffer of the second battle is one of the three");
  rig.press("ENTER", 6);
  rig.press("ENTER", 6);
  rig.until((state) => state.vm.globals.afterfight === 2, 3000);
  rig.tick(10);
  const left = Object.values(rig.state().surfaces.entries).filter((entry) => entry.id !== (0 as never) && entry.bitmap.w === 640 && entry.bitmap.h === 480);
  deepEqual(left.map((entry) => entry.id as number), [rig.state().surfaces.renderNow as number], "between and after battles only the reserved overlay is left");
  equal(rig.state().surfaces.renderNowOn, false, "the game had no HUD, so the overlay is switched off again");
  deepEqual(rig.diagnostics, []);
});

function overlayPixel(rig: UiRig, x: number, y: number): number[] {
  const surfaces = rig.state().surfaces;
  const handle = surfaces.renderNow as number;
  const pixels = readSurfacePixels(surfaces, handle as never, surfaces.entries[String(handle)]!.rev);
  if (pixels === null) throw new Error("the overlay is not readable");
  return [...pixels.rgba.subarray((y * pixels.w + x) * 4, (y * pixels.w + x) * 4 + 4)];
}

for (const hud of ["on", "off", undefined] as const) {
  test(`a battle borrows the game's overlay and hands it back: the HUD's pixels and flag survive (${hud ?? "no HUD"})`, () => {
    const rig = bootUiRig({ enemies: ["slime"], slimeHp: 1, ...(hud === undefined ? {} : { hud }) });
    awaitMenu(rig);
    const handle = rig.state().surfaces.renderNow as number;
    if (hud !== undefined) equal(handle, rig.state().vm.globals.hud, "the battle drew on the game's own reserved canvas");
    ok(overlayPixel(rig, 10, 10)[0] !== 200, "during the battle the screen owns the overlay");
    rig.press("ENTER", 6);
    rig.press("ENTER", 6);
    rig.until((state) => state.vm.globals.afterfight === 1, 3000);
    rig.tick(10);
    const surfaces = rig.state().surfaces;
    equal(surfaces.renderNow, handle, "the reserved canvas persisted");
    equal(surfaces.renderNowOn, hud === "on", "the on/off flag is what the game had (off when there was no HUD)");
    deepEqual(overlayPixel(rig, 10, 10), hud === undefined ? [0, 0, 0, 0] : [200, 30, 30, 255], hud === undefined ? "a canvas the battle created is left clear" : "the HUD's pixels are back");
    deepEqual(overlayPixel(rig, 300, 200), [0, 0, 0, 0], "nothing of the battle screen is left on it");
    const frame = rig.frame();
    const at = (10 * frame.w + 10) * 4;
    const shown = frame.rgba[at] === 200 && frame.rgba[at + 1] === 30 && frame.rgba[at + 2] === 30;
    equal(shown, hud === "on", "the HUD shows on the real screen only when the game had it on");
    deepEqual(rig.diagnostics, []);
  });
}

test("a selection change is on the real screen within six ticks (a tenth of a second)", () => {
  const rig = bootUiRig();
  awaitMenu(rig);
  const before = fnv1a64(rig.frame().rgba);
  rig.press("DOWN", 1);
  let waited = 1;
  while (waited < 6 && fnv1a64(rig.frame().rgba) === before) {
    rig.tick(1);
    waited += 1;
  }
  equal(ui(rig)["cursor"], 1, "the cursor moved");
  ok(fnv1a64(rig.frame().rgba) !== before, "the highlighted command changed the rendered frame");
  deepEqual(rig.diagnostics, []);
});
