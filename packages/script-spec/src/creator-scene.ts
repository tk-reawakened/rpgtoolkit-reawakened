import type { LineCounts, PositionFilter } from "./coverage.ts";
import {
  compileProgram,
  fileProgramRef,
  assetKey,
  createAssetIndex,
  createEngine,
  createSpriteRuntime,
  encodeCp1252,
  inputPhaseRegistration,
  inputResetRegistration,
  movementPhaseRegistration,
  PACKAGE_ROOT,
  resolveProgram,
  ScriptError,
  triggerPhaseRegistration,
  type CommandResult,
  type CommandView,
  type DrawList,
  type EffectRecord,
  type AssetKey,
  type Engine,
  type GameState,
  type InputRecord,
  type ResolvedPlugin,
  type SourcePos,
  type Value,
} from "@tk-reawakened/core";
import type { CreatorStateBridge } from "./doubles.ts";
import type { FixtureDefinition } from "./fixture.ts";
import type { FixtureWorld } from "./fixture-world.ts";

const fold = (text: string): string => text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
const SPEC_PROGRAM_PATH = "Prg/__spec.prg";
const SPEC_LIBRARY_PATH = "Prg/script-spec/startup.prg";
const SPEC_FILE_KEY = assetKey(SPEC_PROGRAM_PATH);
const SPEC_LIBRARY_KEY = assetKey(SPEC_LIBRARY_PATH);

export type CreatorSceneProgram = {
  readonly source: string;
  readonly sourcePath: string;
  readonly librarySource: string;
  readonly mode: number;
  readonly target: number;
};

function quote(text: string): string {
  // readFixture rejects quotes and line breaks before fixture setup is compiled.
  return `"${text}"`;
}

function setupProgram(fixture: FixtureDefinition, program: CreatorSceneProgram): string {
  const player = fixture.party[0]!;
  const lines = fixture.party.map((path) => `AddPlayer(${quote(path)})`);
  lines.push(`Send(${quote(fixture.board)}, ${fixture.start.x}, ${fixture.start.y}, ${fixture.start.layer})`);
  if (fixture.facing !== null) lines.push(`PlayerDirection(${quote(player)}, ${quote(fixture.facing)})`);
  for (const key of ["maxhp", "maxsmp", "fp", "dp", "hp", "smp"] as const) {
    const value = fixture.stats[key];
    if (value !== undefined) lines.push(`${key}(${quote(player)}, ${value})`);
  }
  const inventory = Object.entries(fixture.inventory).sort(([a], [b]) => fold(a) < fold(b) ? -1 : fold(a) > fold(b) ? 1 : 0);
  for (const [item, count] of inventory) for (let index = 0; index < count; index += 1) lines.push(`GiveItem(${quote(item)})`);
  if (fixture.gold !== 0) lines.push(`GiveGP(${fixture.gold})`);
  for (const [name, value] of Object.entries(fixture.variables).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    lines.push(`${name} = ${typeof value === "string" ? quote(value) : value}`);
  }
  lines.push(
    `specmode = ${program.mode}`,
    `spectarget = ${program.target}`,
    `specResult("pass", "", "checkpoint", "fixture-ready")`,
    `Thread(${quote("__spec.prg")}, false)`,
    "end()",
  );
  return `${lines.join("\n")}\n`;
}

export type CreatorSceneSnapshot = {
  readonly engine: string;
  readonly effects: readonly (readonly [string, number])[];
  readonly programThread: number | null;
};

type DeepReadonly<T> =
  T extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[] :
  T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> } :
  T;

/** Synchronous read-only observation: draw references resolve through copied scene resources, never engine mutation. */
export type CreatorFrameObservation = {
  readonly tick: number;
  readonly drawList: DeepReadonly<DrawList>;
  readonly surfacePixels: Engine["surfacePixels"];
  readonly picturePixels: Engine["picturePixels"];
  readonly assetBytes: (key: AssetKey) => Uint8Array | null;
};

export type CreatorSceneDiagnostic = { readonly code: string; readonly message: string; readonly line: number; readonly sourcePath: string };

export type CreatorScene = {
  readonly engine: Engine;
  readonly bridge: CreatorStateBridge;
  readonly effects: Map<string, number>;
  readonly results: EffectRecord[];
  readonly loaded: string[];
  readonly diagnostics: CreatorSceneDiagnostic[];
  readonly tick: () => number;
  readonly stateHash: () => string;
  readonly board: () => string | null;
  readonly state: () => GameState | null;
  readonly ready: () => boolean;
  readonly checkpointReached: () => boolean;
  readonly complete: () => boolean;
  readonly advance: (inputs: readonly InputRecord[]) => readonly InputRecord[];
  readonly checkpoint: () => CreatorSceneSnapshot;
  readonly coverage: () => LineCounts;
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

/** One actual Engine and VM execute fixture setup and the complete spec/library program. */
export function createCreatorScene(
  world: FixtureWorld,
  fixture: FixtureDefinition,
  seed: number,
  plugins: readonly ResolvedPlugin[],
  program: CreatorSceneProgram,
  initial?: CreatorSceneSnapshot,
  onFrame?: (frame: CreatorFrameObservation) => void,
  place?: PositionFilter,
  onResult?: (effect: EffectRecord, context: { readonly tick: number; readonly board: string | null; readonly sourcePath: string }) => void,
): CreatorScene {
  const effects = new Map(initial?.effects ?? []);
  const results: EffectRecord[] = [];
  const loaded: string[] = [];
  const loadedSet = new Set<string>();
  const programKeys = new Set<string>([SPEC_PROGRAM_PATH]);
  const diagnostics: CreatorSceneDiagnostic[] = [];
  let state: GameState | null = null;
  let ready = initial !== undefined;
  let checkpointReached = false;
  let programThread = initial?.programThread ?? null;
  const operationHits = new Map<string, number>();
  const specProgramText = `${program.source}\nspecRun()\n#include "script-spec/startup.prg"\n`;
  const specProgramResult = encodeCp1252(specProgramText);
  const specLibraryResult = encodeCp1252(program.librarySource);
  if (!specProgramResult.ok || !specLibraryResult.ok) {
    throw new ScriptError("spec.fixture-load", "fixture spec and embedded library must be Windows-1252 encodable");
  }
  const specFiles = new Map<string, Uint8Array>([
    [SPEC_FILE_KEY, specProgramResult.value],
    [SPEC_LIBRARY_KEY, specLibraryResult.value],
  ]);
  const index = createAssetIndex([
    ...world.files.filter((file) => !specFiles.has(assetKey(file.path))).map((file) => file.path),
    SPEC_PROGRAM_PATH,
    SPEC_LIBRARY_PATH,
  ]);
  const readFile = (key: string): Uint8Array | undefined => {
    const canonical = assetKey(key);
    const synthetic = specFiles.get(canonical);
    if (synthetic !== undefined) return synthetic;
    const file = world.byKey.get(canonical);
    if (file === undefined) return undefined;
    if (canonical.endsWith(".prg")) programKeys.add(canonical);
    if (!loadedSet.has(file.sourcePath)) {
      loadedSet.add(file.sourcePath);
      loaded.push(file.sourcePath);
    }
    return file.bytes;
  };
  const programLoader = { index, root: PACKAGE_ROOT, dialect: "tk3" as const, read: readFile };
  const lastSpecPositions = new Map<number, SourcePos>();
  const lastOwnPositions = new Map<number, SourcePos>();
  let lastAuthoredCallPosition: SourcePos | null = null;
  let waitTimeoutPosition: SourcePos | null = null;

  const authoredCallPosition = (threadId: number): SourcePos | null => lastSpecPositions.get(threadId) ?? lastAuthoredCallPosition;
  /** The innermost call site the author wrote: the spec itself or an included program, never the bundled library. */
  const ownSourcePosition = (threadId: number): SourcePos | null =>
    lastOwnPositions.get(threadId) ?? lastSpecPositions.get(threadId) ?? lastAuthoredCallPosition;
  const sourcePathForPosition = (position: SourcePos | null): string => {
    if (position === null || position.file === SPEC_FILE_KEY || position.file === SPEC_LIBRARY_KEY || position.file === "") return program.sourcePath;
    return world.byKey.get(assetKey(position.file))?.sourcePath ?? program.sourcePath;
  };
  const activeAuthoredCallPosition = (view: CommandView): SourcePos | null => {
    const thread = view.state?.vm.threads.find((item) => item.id === view.thread);
    if (thread === undefined) return null;
    for (let index = thread.frames.length - 1; index >= 0; index -= 1) {
      const frame = thread.frames[index]!;
      const operation = compileProgram(frame.program, { loader: programLoader }).ops[frame.ip - 1];
      if (operation?.pos.file === SPEC_FILE_KEY) return operation.pos;
    }
    return null;
  };
  const startupProgram = initial === undefined ? setupProgram(fixture, program) : "";
  const spriteRuntime = createSpriteRuntime();
  const drawInclude = { shading: true, images: true, sprites: true } as const;
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
    spriteRuntime,
    input: { bindings: { keys: {} } },
    resetRegistrations: [inputResetRegistration()],
    include: drawInclude,
    phaseRegistrations: [
      inputPhaseRegistration({ pixelMovement: 0 }),
      movementPhaseRegistration({ pixelMovement: 0 }),
      triggerPhaseRegistration({
        programRef: (name) => resolveProgram(programLoader, name) === undefined
          ? null
          : fileProgramRef(programLoader, name),
      }),
      { phase: "input", rank: 1, run: (next) => {
        state = next;
        next.vm.globals.specmode = program.mode;
        next.vm.globals.spectarget = program.target;
      } },
      { phase: "time", run: (next) => { state = next; } },
    ],
    scriptObservers: {
      onEffect: (effect) => {
        if (effect.name === "specresult" && effect.args[2] === "checkpoint" && effect.args[3] === "fixture-ready") {
          effects.clear();
          results.length = 0;
          ready = true;
          return;
        }
        if (effect.name !== "specresult" || effect.args[2] !== "checkpoint") {
          const key = fold(effect.name);
          effects.set(key, (effects.get(key) ?? 0) + 1);
        }
        if (effect.name === "specresult" && effect.args[2] === "checkpoint" && program.mode === 3) {
          programThread = effect.thread;
          checkpointReached = true;
        }
        const position = effect.name === "specresult" && effect.args[2] !== "checkpoint"
          ? ownSourcePosition(effect.thread)
          : null;
        const reported = position === null
          ? effect
          : { ...effect, args: [...effect.args.slice(0, 5), position.line, position.col ?? 0, ...effect.args.slice(7)] };
        results.push(reported);
        if (effect.name === "specresult" && effect.args[2] !== "checkpoint") {
          const board = typeof reported.args[7] === "string" ? reported.args[7] : reported.args[7] === null ? null : state?.world.board?.key ?? null;
          const resultTick = typeof reported.args[8] === "number" ? reported.args[8] : state?.time.tick ?? 0;
          onResult?.(reported, { tick: resultTick, board, sourcePath: sourcePathForPosition(position) });
        }
      },
      postStep: (operation, thread) => {
        if (operation.pos.file === SPEC_FILE_KEY) {
          lastSpecPositions.set(thread, operation.pos);
          lastAuthoredCallPosition = operation.pos;
        }
        // Every authored file (the spec or an included program) keeps its own coordinates; the bundled library never wins.
        if (operation.pos.file !== "" && operation.pos.file !== SPEC_LIBRARY_KEY) lastOwnPositions.set(thread, operation.pos);
        if (programThread === null && operation.pos.file === SPEC_FILE_KEY) programThread = thread;
        if (place !== undefined) {
          const path = place(operation.pos.file, operation.pos.line);
          if (path !== null) {
            const key = JSON.stringify(operation);
            operationHits.set(key, (operationHits.get(key) ?? 0) + 1);
          }
        }
      },
    },
    ...(initial === undefined ? { program: startupProgram } : { resume: initial.engine }),
  });
  const frameReaders = onFrame === undefined ? null : {
    surfacePixels: (id: Parameters<Engine["surfacePixels"]>[0], rev: Parameters<Engine["surfacePixels"]>[1]) => engine.surfacePixels(id, rev),
    picturePixels: (key: Parameters<Engine["picturePixels"]>[0]) => engine.picturePixels(key),
    assetBytes: (key: AssetKey) => world.byKey.get(assetKey(key))?.bytes.slice() ?? null,
  };
  const getState = (): GameState | null => state;
  const tick = (): number => getState()?.time.tick ?? 0;
  const bridge: CreatorStateBridge = {
    tick,
    sourcePosition: authoredCallPosition,
    value: (path) => {
      const current = getState();
      if (current === null) throw new ScriptError("spec.fixture-load", "specValue: fixture has not completed a simulation tick");
      return projection(current, effects, path);
    },
    wait: (path, expected, maxTicks, elapsed, view): CommandResult => {
      const current = getState();
      if (current === null) throw new ScriptError("spec.fixture-load", "specWait: fixture has not completed a simulation tick");
      const actual = projection(current, effects, path);
      const equal = path.toLowerCase() === "board" && typeof actual === "string" && typeof expected === "string"
        ? assetKey(actual) === assetKey(expected)
        : actual === expected;
      if (equal) return { value: elapsed };
      if (elapsed >= maxTicks) {
        waitTimeoutPosition = ownSourcePosition(view.thread ?? 0) ?? activeAuthoredCallPosition(view);
        throw new ScriptError("spec.timeout", `specWait: ${path} expected ${JSON.stringify(expected)}, last value ${JSON.stringify(actual)} after ${maxTicks} ticks`, view.pos);
      }
      return { value: -1 };
    },
  };

  const diagnostic = (code: string, message: string, line = 0, sourcePath = program.sourcePath): void => {
    diagnostics.push({ code, message, line, sourcePath });
  };
  const serve = (report: ReturnType<Engine["advance"]>): InputRecord[] => {
    let current = report;
    const consumed = [...report.consumed];
    let guard = 0;
    while (current.loading && guard++ < world.files.length + 32) {
      const replies: InputRecord[] = [];
      for (const request of current.requests) {
        if (request.kind !== "asset") continue;
        const bytes = readFile(request.key);
        if (bytes === undefined) diagnostic("spec.fixture-scope", `fixture world does not contain ${request.key}`);
        replies.push({ tick: current.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: bytes ?? null } });
      }
      if (replies.length === 0) {
        diagnostic("spec.fixture-load", "engine is blocked without an asset request");
        break;
      }
      current = engine.advance(0, replies);
      consumed.push(...current.consumed);
    }
    if (current.loading) diagnostic("spec.fixture-load", "fixture engine remained blocked after frozen asset replies");
    for (const item of current.diagnostics) {
      const authoredTimeout = item.code === "spec.timeout" ? waitTimeoutPosition : null;
      const sourcePath = authoredTimeout === null
        ? sourcePathForPosition({ file: item.file as AssetKey, line: item.line, col: 0 })
        : sourcePathForPosition(authoredTimeout);
      diagnostic(item.code, item.message, authoredTimeout?.line ?? item.line, sourcePath);
    }
    if (!current.loading && onFrame !== undefined && frameReaders !== null) {
      onFrame({ tick: current.tickAfter, drawList: engine.drawList(0, drawInclude), ...frameReaders });
    }
    return consumed;
  };
  const initialProgram = initial === undefined ? setupProgram(fixture, program) : "";
  if (initial === undefined) {
    serve(engine.advance(0, []));
    let ticks = 0;
    while (!ready && ticks < 1000) {
      serve(engine.advance(1, []));
      ticks += 1;
    }
    if (!ready) diagnostic("spec.fixture-load", "fixture setup did not finish within 1,000 ticks");
  }
  const checkpoint = (): CreatorSceneSnapshot => {
    if (engine.checkpoint === undefined) throw new ScriptError("spec.snapshot", "this scene engine cannot make a complete checkpoint");
    return {
      engine: engine.checkpoint(),
      effects: [...effects].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
      programThread,
    };
  };
  const collectCoverage = (): LineCounts => {
    const complete: LineCounts = new Map();
    if (place === undefined) return complete;
    for (const path of programKeys) {
      const compiled = compileProgram(fileProgramRef(programLoader, path), { loader: programLoader });
      const inStatement = new Array<boolean>(compiled.ops.length).fill(false);
      for (const range of compiled.statements) {
        for (let index = range.start; index < range.end; index += 1) inStatement[index] = true;
      }
      compiled.ops.forEach((operation, index) => {
        if (operation.op === "return" && !inStatement[index]) return;
        const file = place(operation.pos.file, operation.pos.line);
        if (file === null) return;
        let lines = complete.get(file);
        if (lines === undefined) {
          lines = new Map();
          complete.set(file, lines);
        }
        const hits = operationHits.get(JSON.stringify(operation)) ?? 0;
        lines.set(operation.pos.line, Math.max(lines.get(operation.pos.line) ?? 0, hits));
      });
    }
    return complete;
  };
  return {
    engine, bridge, effects, results, loaded, diagnostics, tick, stateHash: () => engine.stateHash(),
    board: () => getState()?.world.board?.key ?? null,
    state: getState,
    ready: () => ready,
    checkpointReached: () => checkpointReached,
    complete: () => {
      const current = getState();
      const thread = current?.vm.threads.find((item) => item.id === programThread);
      return current !== null && programThread !== null && (thread === undefined || thread.status === "finished");
    },
    advance: (inputs) => serve(engine.advance(1, inputs)),
    checkpoint,
    coverage: collectCoverage,
  };
}
