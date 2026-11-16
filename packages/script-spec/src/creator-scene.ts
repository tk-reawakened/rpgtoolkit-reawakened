import {
  assetKey,
  createAssetIndex,
  createEngine,
  PACKAGE_ROOT,
  ScriptError,
  type CommandResult,
  type Engine,
  type GameState,
  type InputRecord,
  type ResolvedPlugin,
  type Value,
} from "@tk-reawakened/core";
import type { CreatorStateBridge } from "./doubles.ts";
import type { FixtureDefinition } from "./fixture.ts";
import type { FixtureWorld } from "./fixture-world.ts";

const fold = (text: string): string => text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

function quote(text: string): string {
  // readFixture rejects quotes and line breaks before fixture setup is compiled.
  return `"${text}"`;
}

function setupProgram(fixture: FixtureDefinition): string {
  const player = fixture.party[0]!;
  const program = fixture.party.map((path) => `AddPlayer(${quote(path)})`);
  program.push(`Send(${quote(fixture.board)}, ${fixture.start.x}, ${fixture.start.y}, ${fixture.start.layer})`);
  if (fixture.facing !== null) program.push(`PlayerDirection(${quote(player)}, ${quote(fixture.facing)})`);
  for (const key of ["maxhp", "maxsmp", "fp", "dp", "hp", "smp"] as const) {
    const value = fixture.stats[key];
    if (value !== undefined) program.push(`${key}(${quote(player)}, ${value})`);
  }
  const inventory = Object.entries(fixture.inventory).sort(([a], [b]) => fold(a) < fold(b) ? -1 : fold(a) > fold(b) ? 1 : 0);
  for (const [item, count] of inventory) for (let index = 0; index < count; index += 1) program.push(`GiveItem(${quote(item)})`);
  if (fixture.gold !== 0) program.push(`GiveGP(${fixture.gold})`);
  for (const [name, value] of Object.entries(fixture.variables).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    program.push(`${name} = ${typeof value === "string" ? quote(value) : value}`);
  }
  program.push("end()");
  return `${program.join("\n")}\n`;
}

export type CreatorSceneSnapshot = {
  readonly engine: string;
  readonly effects: readonly (readonly [string, number])[];
};

export type CreatorScene = {
  readonly engine: Engine;
  readonly bridge: CreatorStateBridge;
  readonly effects: Map<string, number>;
  readonly loaded: string[];
  readonly diagnostics: string[];
  readonly tick: () => number;
  readonly ready: () => boolean;
  readonly advance: (inputs: readonly InputRecord[]) => readonly InputRecord[];
  readonly checkpoint: () => CreatorSceneSnapshot;
};

function projection(state: GameState, effects: ReadonlyMap<string, number>, path: string): Value {
  const key = fold(path);
  if (key === "time.tick") return state.time.tick;
  if (key === "board") return state.world.board?.key ?? null;
  if (key === "party.size") return state.party.members.length;
  if (key === "gold") return state.inventory.gold;
  if (key.startsWith("effect.")) return effects.get(key.slice(7)) ?? 0;
  if (key.startsWith("variable.")) return state.vm.globals[key.slice(9)] ?? null;
  if (key.startsWith("inventory.")) {
    const item = key.slice(10);
    const wanted = assetKey(`Item/${item.endsWith(".itm") ? item : `${item}.itm`}`);
    return state.inventory.items.reduce((total, entry) => total + (assetKey(entry.source) === wanted ? entry.quantity : 0), 0);
  }
  const player = state.sprites.players.find((sprite) => sprite.id === state.sprites.selectedPlayer)
    ?? state.sprites.players.find((sprite) => sprite.actorId === state.party.selected);
  if (key === "player.x") return player?.x ?? null;
  if (key === "player.y") return player?.y ?? null;
  if (key === "player.tilex") return player === undefined ? null : Math.floor(player.x / 32) + 1;
  if (key === "player.tiley") return player === undefined ? null : Math.floor(player.y / 32) + 1;
  if (key === "player.layer") return player?.layer ?? null;
  if (key === "player.facing") return player?.facing ?? null;
  if (key === "player.moving") return player?.movement.active === null || player === undefined ? 0 : 1;
  if (key.startsWith("stat.")) {
    const actor = state.actors.actors.find((item) => item.id === state.party.selected);
    if (actor === undefined) return null;
    const stats: Record<string, number> = {
      hp: actor.stats.hp, maxhp: actor.stats.maxHp, smp: actor.stats.smp,
      maxsmp: actor.stats.maxSmp, fp: actor.stats.fp, dp: actor.stats.dp, level: actor.stats.level,
    };
    return stats[key.slice(5)] ?? null;
  }
  throw new ScriptError("spec.bad-path", `specValue: unknown fixture projection "${path}"`);
}

/** The actual play engine, started and resumed only from the fixture's frozen asset/program world. */
export function createCreatorScene(
  world: FixtureWorld,
  fixture: FixtureDefinition,
  seed: number,
  plugins: readonly ResolvedPlugin[],
  initial?: CreatorSceneSnapshot,
): CreatorScene {
  const effects = new Map(initial?.effects ?? []);
  const loaded: string[] = [];
  const diagnostics: string[] = [];
  let state: GameState | null = null;
  let ready = initial !== undefined;
  const initialProgram = initial === undefined ? setupProgram(fixture) : "";
  const waits = new Map<number, number>();
  const index = createAssetIndex(world.files.map((file) => file.path));
  const programLoader = { index, root: PACKAGE_ROOT, read: (key: string) => world.byKey.get(assetKey(key))?.bytes };
  const engine = createEngine({
    seed,
    assetIndex: index,
    assetRoot: PACKAGE_ROOT,
    initialBoard: fixture.board,
    width: 640,
    height: 480,
    maxTicks: 1000,
    plugins,
    programLoader,
    phaseRegistrations: [{ phase: "time", run: (next) => { state = next; } }],
    scriptObservers: { onEffect: (effect) => {
      const key = fold(effect.name);
      effects.set(key, (effects.get(key) ?? 0) + 1);
    } },
    ...(initial === undefined ? { program: initialProgram } : { resume: initial.engine }),
  });
  const getState = (): GameState | null => state;
  const tick = (): number => getState()?.time.tick ?? 0;
  const bridge: CreatorStateBridge = {
    tick,
    value: (path) => {
      const current = getState();
      if (current === null) throw new ScriptError("spec.fixture-load", "specValue: fixture has not completed a simulation tick");
      return projection(current, effects, path);
    },
    wait: (path, expected, maxTicks, view): CommandResult => {
      const thread = view.thread ?? 0;
      const current = getState();
      const now = current?.time.tick ?? 0;
      const start = waits.get(thread) ?? now;
      waits.set(thread, start);
      const actual = current === null ? null : projection(current, effects, path);
      const equal = path.toLowerCase() === "board" && typeof actual === "string" && typeof expected === "string"
        ? assetKey(actual) === assetKey(expected)
        : actual === expected;
      if (equal) {
        waits.delete(thread);
        return { value: now - start };
      }
      const elapsed = now - start;
      if (elapsed >= maxTicks) {
        waits.delete(thread);
        throw new ScriptError("spec.timeout", `specWait: ${path} expected ${JSON.stringify(expected)}, last value ${JSON.stringify(actual)} after ${maxTicks} ticks`);
      }
      return { value: null, wait: { kind: "sleep", global: false, until: now + 1, resumesCall: true } };
    },
  };

  const serve = (report: ReturnType<Engine["advance"]>): InputRecord[] => {
    let current = report;
    const consumed = [...report.consumed];
    let guard = 0;
    while (current.loading && guard++ < world.files.length + 32) {
      const replies: InputRecord[] = [];
      for (const request of current.requests) {
        if (request.kind !== "asset") continue;
        const file = world.byKey.get(request.key);
        if (file !== undefined) loaded.push(file.sourcePath);
        else diagnostics.push(`spec.fixture-scope: fixture world does not contain ${request.key}`);
        replies.push({ tick: current.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: file?.bytes ?? null } });
      }
      if (replies.length === 0) {
        diagnostics.push("spec.fixture-load: engine is blocked without an asset request");
        break;
      }
      current = engine.advance(0, replies);
      consumed.push(...current.consumed);
    }
    if (current.loading) diagnostics.push("spec.fixture-load: fixture engine remained blocked after frozen asset replies");
    diagnostics.push(...current.diagnostics.map((item) => `${item.code}: ${item.message}`));
    return consumed;
  };

  const activeSetup = (): boolean => {
    const current = getState();
    return current !== null && current.vm.threads.some((thread) => thread.frames.some((frame) => frame.program.kind === "inline" && frame.program.text === initialProgram));
  };
  const captureReady = (): void => {
    if (!ready && initialProgram !== "" && getState() !== null && !activeSetup()) ready = true;
  };
  if (initial === undefined) {
    serve(engine.advance(0, []));
    // Setup uses ordinary RPGCode and may yield at Send or an asset request. Run only until that inline program ends.
    let ticks = 0;
    while (!ready && ticks < 1000) {
      serve(engine.advance(1, []));
      ticks += 1;
      captureReady();
    }
    if (!ready) diagnostics.push("spec.fixture-load: fixture setup did not finish within 1,000 ticks");
  }
  if (initial === undefined && ready) effects.clear();

  return {
    engine, bridge, effects, loaded, diagnostics, tick, ready: () => ready,
    advance(inputs) {
      const consumed = serve(engine.advance(1, inputs));
      captureReady();
      return consumed;
    },
    checkpoint() {
      if (engine.checkpoint === undefined) throw new ScriptError("spec.snapshot", "this scene engine cannot make a complete checkpoint");
      return { engine: engine.checkpoint(), effects: [...effects].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) };
    },
  };
}
