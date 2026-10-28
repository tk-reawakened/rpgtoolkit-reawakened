// A mid-battle save loaded into a brand-new engine (review of #702, finding 1): the saved pinned stance animations are
// restored already loaded, so the brand-new engine holds none of their picture files. It must ask the host for them,
// keep each animation's saved frame and origin tick, and never draw a frame whose picture it does not have.
// The save is the real thing: the engine's own `Save` request issued by a script during the fight.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { TextDecoder, TextEncoder } from "node:util";
import { fileURLToPath } from "node:url";
import {
  assetKey,
  createAssetIndex,
  createEngine,
  fnv1a64,
  frameAt,
  PACKAGE_ROOT,
  type Engine,
  type GameState,
  type InputRecord,
  type PackageCatalogueEntry,
} from "../src/index.ts";
import { bootUiRig, gameFiles, SCREEN_HEIGHT, SCREEN_WIDTH, type UiRig } from "./battle-ui-rig.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const encoder = new TextEncoder();
const RIG = { stanceDelayTicks: 3 } as const;

/** The fight program: the first turn saves the game, then the stock battle screen takes the turn as usual. */
const FIGHT = [
  "saveTurn = stockBattle.turn",
  "saved = 0",
  "stockBattle.turn = (party, index) => {",
  "  if (saved == 0) {",
  "    saved = 1",
  '    Save("slot")',
  "  }",
  "  return saveTurn(party, index)",
  "}",
  'fightenemy("slime", "bat", "slime", "meadow")',
  "afterfight = 1",
  "end()",
].join("\n");

type SavedAnimation = {
  readonly id: number;
  readonly pinned?: true;
  readonly loaded: boolean;
  readonly finished: boolean;
  readonly loop: boolean;
  readonly originTick: number;
  readonly delayTicks: number;
  readonly frame: number;
  readonly frames: readonly { readonly asset: string | null; readonly surface?: number }[];
};
type SavedGame = { readonly time: { readonly tick: number }; readonly battle: { readonly outcome: number | null } | null; readonly fx: { readonly animations: readonly SavedAnimation[] } };

type Saved = { readonly bytes: Uint8Array; readonly tick: number; readonly game: SavedGame };

/** Play a battle rig until the script's `Save` reaches the host, answering it so the fight carries on. */
function saveMidBattle(): { readonly rig: UiRig; readonly saved: Saved } {
  const rig = bootUiRig(RIG);
  rig.files.set(assetKey("prg/fight.prg"), encoder.encode(FIGHT));
  const engine = rig.engine as { advance: Engine["advance"] };
  const advance = engine.advance.bind(engine);
  let answers: InputRecord[] = [];
  let saved: Saved | null = null;
  engine.advance = (ticks, inputs, ...rest) => {
    const report = advance(ticks, [...answers, ...inputs], ...rest);
    answers = [];
    for (const request of report.requests) {
      if (request.kind !== "saveBlob") continue;
      const bytes = new Uint8Array(request.bytes);
      saved = { bytes, tick: report.tickAfter, game: JSON.parse(new TextDecoder().decode(bytes)) as SavedGame };
      answers.push({ tick: report.tickAfter, event: { kind: "blob.saved", reqId: request.reqId, ok: true } });
    }
    return report;
  };
  rig.until(() => saved !== null, 3000);
  ok(saved !== null, "the fight's script saved the game");
  return { rig, saved: saved as Saved };
}

type FreshHost = {
  readonly engine: Engine;
  readonly diagnostics: { readonly code: string; readonly message: string }[];
  readonly requested: string[];
  readonly hashes: string[];
  state(): GameState;
  /** One tick (or none while the host still owes the engine an asset), answering what the engine asks for. */
  step(): void;
  frame(): string;
};

function catalogue(): readonly PackageCatalogueEntry[] {
  const folder = join(repoRoot, "stock", "stock_battle");
  const manifest = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8")) as {
    readonly name: string;
    readonly version: string;
    readonly namespace: string;
    readonly requests: PackageCatalogueEntry["requests"];
    readonly program: string;
  };
  return [{
    name: manifest.name,
    version: manifest.version,
    namespace: manifest.namespace,
    requests: manifest.requests,
    definition: { id: manifest.name, version: manifest.version, commands: [] },
    startup: { kind: "inline", text: readFileSync(join(folder, manifest.program), "utf8"), compiler: "2", dialect: "tk3" },
  }];
}

/** A brand-new engine on the same game whose start-up program loads the save: nothing of the saved run is cached. */
function freshLoad(saved: Uint8Array): FreshHost {
  const game = gameFiles(RIG);
  game.files.set(assetKey("prg/start.prg"), encoder.encode('load("slot")\nend()\n'));
  game.files.set(assetKey("prg/fight.prg"), encoder.encode(FIGHT));
  let latest: GameState | null = null;
  const engine = createEngine({
    seed: 291,
    assetIndex: createAssetIndex(game.paths),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "battle-ui-test",
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    maxTicks: 100000,
    bundled: new Map([[assetKey("media/fonts/tkr-8x8.fnt"), new Uint8Array(readFileSync(join(repoRoot, "media", "fonts", "tkr-8x8.fnt")))]]),
    packageCatalogue: catalogue(),
    phaseRegistrations: [{ phase: "triggers", run: (state) => { latest = state; } }],
  });
  const diagnostics: { code: string; message: string }[] = [];
  const requested: string[] = [];
  const hashes: string[] = [];
  let replies: InputRecord[] = [];
  const host: FreshHost = {
    engine,
    diagnostics,
    requested,
    hashes,
    state() {
      if (latest === null) throw new Error("no tick has run yet");
      return latest;
    },
    step() {
      const report = engine.advance(1, replies);
      replies = [];
      diagnostics.push(...report.diagnostics);
      if (report.ticksRun > 0) hashes.push(report.stateHash);
      for (const request of report.requests) {
        if (request.kind === "asset") {
          requested.push(request.key);
          replies.push({ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: game.files.get(request.key) ?? null } });
        } else if (request.kind === "loadBlob") {
          replies.push({ tick: report.tickAfter, event: { kind: "blob.loaded", reqId: request.reqId, bytes: new Uint8Array(saved) } });
        } else if (request.kind === "saveBlob") {
          replies.push({ tick: report.tickAfter, event: { kind: "blob.saved", reqId: request.reqId, ok: true } });
        }
      }
    },
    frame() {
      engine.surfacePixels(0 as never, -1);
      const surface = engine.surfacePixels(0 as never, host.state().surfaces.entries["0"]!.rev);
      if (surface === null) throw new Error("the frame is not readable");
      return fnv1a64(surface.rgba);
    },
  };
  return host;
}

/** Step the host until the save has been applied and the engine ticks again at `tick`. */
function runUntilTick(host: FreshHost, tick: number): void {
  for (let guard = 0; guard < 400; guard += 1) {
    if (host.hashes.length > 0 && host.state().time.tick >= tick) return;
    host.step();
  }
  throw new Error(`the engine did not reach tick ${tick}: ${JSON.stringify(host.diagnostics)}`);
}

function pinned(animations: readonly SavedAnimation[]): readonly SavedAnimation[] {
  return animations.filter((animation) => animation.pinned === true);
}

test("the save holds loaded, pinned stance animations and no picture surfaces", () => {
  const { saved } = saveMidBattle();
  ok(saved.game.battle !== null && saved.game.battle.outcome === null, "the save is mid-battle");
  const stances = pinned(saved.game.fx.animations);
  ok(stances.length >= 3, "the fighters' stances are pinned animations");
  for (const animation of stances) {
    ok(animation.loaded && !animation.finished);
    ok(animation.frames.length === 2, "two authored frames per stance");
    ok(animation.frames.every((frame) => frame.asset !== null && frame.surface === undefined), "frames are pictures, not saved surfaces");
  }
});

test("a mid-battle save loaded into a brand-new engine asks for the animation pictures and draws them", () => {
  const { rig, saved } = saveMidBattle();
  const stances = pinned(saved.game.fx.animations);
  const host = freshLoad(saved.bytes);
  runUntilTick(host, saved.tick + 1);

  // Every picture of every restored animation was asked for, with the saved timeline untouched.
  const wanted = new Set(stances.flatMap((animation) => animation.frames.map((frame) => frame.asset as string)));
  for (const asset of wanted) ok(host.requested.includes(asset), `the picture ${asset} was requested`);
  const restored = pinned(host.state().fx.animations as unknown as readonly SavedAnimation[]);
  deepEqual(restored.map((animation) => animation.id), stances.map((animation) => animation.id));
  for (const [index, animation] of restored.entries()) {
    const was = stances[index]!;
    equal(animation.originTick, was.originTick, "the origin tick is the saved one");
    ok(animation.loaded, "the animation is still loaded");
    equal(animation.frame, frameAt(was.originTick, host.state().time.tick - 1, was.delayTicks, was.frames.length, was.loop), "the frame follows the saved origin (the animation phase runs before the tick advances)");
  }

  // The loaded battle draws exactly what the saved run draws, tick for tick.
  const seen = new Set<string>();
  for (let step = 0; step < 12; step += 1) {
    const tick = host.state().time.tick;
    while (rig.state().time.tick < tick) rig.tick(1);
    equal(rig.state().time.tick, tick, "the saved run is on the same tick");
    const frame = host.frame();
    equal(frame, fnv1a64(rig.frame().rgba), `the frame at tick ${tick} matches the saved run`);
    seen.add(frame);
    host.step();
  }
  ok(seen.size >= 2, "the stance pictures change between ticks, so the comparison sees the frame clock");
  deepEqual(host.diagnostics.filter((entry) => entry.code === "render.failed"), []);
  deepEqual(host.diagnostics.map((entry) => entry.code), []);
});

test("a frame drawn while the animation pictures are still on their way is not a render failure", () => {
  const { saved } = saveMidBattle();
  const host = freshLoad(saved.bytes);
  for (let guard = 0; guard < 400 && !host.requested.includes("bitmap/slime_rest.png"); guard += 1) host.step();
  ok(host.requested.includes("bitmap/slime_rest.png"), "the engine asked for a stance picture");
  host.frame();
  deepEqual(host.diagnostics.filter((entry) => entry.code === "render.failed"), [], "the host drew before it answered");
  runUntilTick(host, saved.tick + 1);
  host.frame();
  deepEqual(host.diagnostics, []);
});

test("two brand-new engines loading the same mid-battle save run the same state hashes", () => {
  const { saved } = saveMidBattle();
  const first = freshLoad(saved.bytes);
  const second = freshLoad(saved.bytes);
  runUntilTick(first, saved.tick + 30);
  runUntilTick(second, saved.tick + 30);
  first.frame();
  deepEqual(first.hashes, second.hashes);
  ok(first.hashes.length >= 30);
  deepEqual(first.diagnostics, []);
});
