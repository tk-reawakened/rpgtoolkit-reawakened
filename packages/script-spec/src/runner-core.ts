/**
 * The spec runner (TOOL-5): `*.spec.prg` discovery, a fresh fixture per case,
 * group hooks that run once, determinism, and the strict/`only` modes.
 *
 * A run executes the spec file once on a `GameState` and walks the library's
 * registration tables (`package/startup.prg`); the library's `specMode` global
 * says what the walk does (collect the registered groups and cases, run one case,
 * run a group's beforeAll hooks, run its afterAll hooks). Every case starts from a
 * fresh fixture: either a new `GameState`, or the snapshot taken after the
 * `beforeAll` hooks of the innermost group that has any (TOOL-5, "Group hooks and
 * the fresh fixture"). The snapshot is the VM's own (`snapshot`/`restoreGameState`),
 * taken at the library's checkpoint report, so a restored run resumes in the middle
 * of the group's walk. Every task runs twice and must give identical outcomes and
 * state hashes. Each run has its own host-side test doubles (`doubles.ts`). A
 * beforeAll checkpoint carries the creator action scheduler's action log, pending
 * input edges and next ordinal so restored runs finish held actions without ID reuse.
 * With `coverage`, each counted run also counts the instructions it executes
 * (`coverage.ts`, TOOL-5 "Line coverage").
 */

import {
  addActor,
  advanceScriptTick,
  assetKey,
  BinaryReader,
  boardPixelSize,
  coordLayout,
  tileToPixel,
  createAssetIndex,
  createGameState,
  createScriptServices,
  DEFAULT_ENGINE_PLUGINS,
  drainDiagnostics,
  drainEffects,
  encodeCp1252,
  fileProgramRef,
  hashGameState,
  PACKAGE_ROOT,
  readBoard,
  registerActorObject,
  restoreGameState,
  ScriptError,
  snapshot,
  startProgram,
  STEP_BUDGET,
  usesPixelCoordinates,
  type CommandView,
  type EffectRecord,
  type GameState,
  type InputRecord,
  type PluginDefinition,
  type ProgramLoader,
  type ScriptServices,
} from "@tk-reawakened/core";
import { addCounts, createCoverageProbe, toCoverage, type LineCounts, type PositionFilter, type SpecCoverage } from "./coverage.ts";
import { FixtureError, type FixtureDeclaration, type FixtureDefinition } from "./fixture.ts";
import { createFixtureWorld, fixtureWorldSha256, type FixtureWorld, type FixtureWorldInputFile } from "./fixture-world.ts";
import { sha256Hex } from "./sha256.ts";
import type { CreatorAction, CreatorActionSnapshot } from "./creator-actions.ts";
import { createCreatorScene, type CreatorFrameObservation, type CreatorScene, type CreatorSceneProgram, type CreatorSceneSnapshot } from "./creator-scene.ts";
export type { CreatorFrameObservation } from "./creator-scene.ts";
import { applyDue, createDoubles, wrapPlugins, type SpecDoubles } from "./doubles.ts";
import { createSpecPlugin } from "./plugin.ts";

/**
 * TOOL-5 — "the API is a package, not a set of engine built-ins … a program that
 * wants them includes or loads the package" (docs/spec/engine/rpgcode-tooling.md#tool-5).
 * Loading waits on PKG-7 (a proposed ruling) and a package's script functions
 * are not reachable by an unqualified name today, so the runner uses the
 * documented **include** branch: the library is served as an includable unit of
 * the project's `Prg/` view. `#include` merges only functions and is collected
 * wherever it appears (MOD rules, docs/spec/engine/rpgcode-modules-and-objects.md),
 * so it sits after the spec's own text, behind the one `specRun()` call that walks
 * the registered tables: every spec statement keeps its authored line and positions
 * come from the compiled units, not an offset guess.
 */
const SPEC_PROGRAM = "__spec.prg";
const LIBRARY_INCLUDE = "script-spec/startup.prg";
const LIBRARY_PATH = `Prg/${LIBRARY_INCLUDE}`;

/**
 * Project loader with the native commands belonging to its package, if any, and the project path coverage reports
 * for an asset key it serves (default: the path the loader's index lists for it).
 */
export type SpecProgramLoader = ProgramLoader & {
  readonly nativePlugin?: PluginDefinition;
  readonly sourcePath?: (key: string) => string | undefined;
  /** Exact immutable project files made available to creator fixtures. */
  readonly fixtureFiles?: readonly FixtureWorldInputFile[];
};
const SPEC_FILE_KEY = assetKey(`Prg/${SPEC_PROGRAM}`);
const LIBRARY_KEY = assetKey(LIBRARY_PATH);

/** The project loader plus this spec file and the includable library unit. */
function specLoader(base: ProgramLoader | undefined, source: string, librarySource: string): ProgramLoader {
  const specPath = `Prg/${SPEC_PROGRAM}`;
  const specKey = assetKey(specPath);
  const libraryKey = assetKey(LIBRARY_PATH);
  // Program bytes are Windows-1252 (docs/spec/formats/rpgcode-program.md), so the
  // source the project already decoded is encoded back with the same codec; the
  // bundled library is converted the same way, not UTF-8.
  const specEncoded = encodeCp1252(`${source}\nspecRun()\n#include "${LIBRARY_INCLUDE}"\n`);
  const libraryEncoded = encodeCp1252(librarySource);
  if (!specEncoded.ok) throw new Error(`spec source is not Windows-1252: ${specEncoded.error.message}`);
  if (!libraryEncoded.ok) throw new Error(`the bundled spec library is not Windows-1252: ${libraryEncoded.error.message}`);
  const specBytes = specEncoded.value;
  const libraryBytes = libraryEncoded.value;
  return {
    index: createAssetIndex([...(base?.index.paths ?? []), specPath, LIBRARY_PATH]),
    root: base?.root ?? PACKAGE_ROOT,
    read: (candidate) => {
      if (candidate === specKey) return specBytes;
      if (candidate === libraryKey) return libraryBytes;
      return base?.read(candidate);
    },
  };
}

export type SpecOutcomeKind = "pass" | "fail" | "skip" | "only";

export type CreatorLastAction = {
  readonly action: string;
  readonly ticks: number;
  readonly startTick: number;
  readonly completedTick: number;
};

export type CreatorOutcomeContext = {
  readonly tick: number;
  readonly lastAction: CreatorLastAction | null;
  readonly board: string | null;
};

export type CreatorFixtureIdentity = {
  readonly groups: readonly string[];
  readonly board: string;
  readonly party: readonly string[];
  readonly start: FixtureDefinition["start"];
  readonly seed: number;
};

export type CreatorRunSnapshot = {
  readonly launch: "saved-tests";
  readonly project: string | null;
  readonly documents: readonly {
    readonly role: "spec" | "fixture-board";
    readonly path: string;
    readonly sha256: string;
  }[];
  readonly world: { readonly files: number; readonly sha256: string };
  readonly seed: number;
  readonly fixture: CreatorFixtureIdentity;
  readonly runner: string;
};


export type CreatorFixtureRun = {
  readonly fixture: CreatorFixtureIdentity;
  readonly snapshot: CreatorRunSnapshot;
  readonly loaded: readonly string[];
  readonly ticks: number;
  readonly actionLog: readonly InputRecord[];
  readonly checkpoints: readonly { readonly tick: number; readonly stateHash: string }[];
};

export type SpecOutcome = {
  readonly kind: SpecOutcomeKind;
  /** `<case>/<matcher>` as the library records it. */
  readonly label: string;
  readonly expected: string;
  readonly actual: string;
  readonly line: number;
  readonly column: number;
  /** Project-relative file that owns this source position; falls back to the spec file for generated diagnostics. */
  readonly sourcePath: string;
  readonly context?: CreatorOutcomeContext;
};

export type SpecCaseResult = {
  readonly name: string;
  readonly groups: readonly string[];
  readonly outcomes: readonly SpecOutcome[];
  /** Strict: only passes count. Lenient: a skip is tolerated and still reported. */
  readonly ok: boolean;
  /** `hashGameState` after the case's run. */
  readonly stateHash: string;
  readonly run?: CreatorFixtureRun;
};

export type SpecFileReport = {
  readonly file: string;
  readonly cases: readonly SpecCaseResult[];
  readonly skipped: readonly string[];
  /** `only` narrowed the run; the text is stable. */
  readonly warning: string | null;
  readonly failures: readonly string[];
  /** Present only when the run asked for `coverage`. */
  readonly coverage?: SpecCoverage;
};

export type SpecRunOptions = {
  /** Seed for the fixture's injected RNG (default 0). */
  readonly seed?: number;
  /** A skip fails the run unless this is `false` (default `true`). */
  readonly strict?: boolean;
  /** Case-sensitive substring of the group and case names joined by ` > `. */
  readonly name?: string;
  /** Optional project program loader for includes made by the spec. */
  readonly loader?: SpecProgramLoader;
  /** Count the RPGCode lines the run executes and report them as `coverage` (TOOL-5 "Line coverage"). */
  readonly coverage?: boolean;
  /** Project identity for the captured run snapshot. */
  readonly project?: string;
  /** Observe read-only draws from each actual fixture Engine frame. */
  readonly onFrame?: (frame: CreatorFrameObservation) => void;
};

export const ONLY_WARNING = "only() narrowed the run to the marked cases; unmarked cases were not run";

/** The name of the failing outcome of a spec file that registers no case (TOOL-5). */
export const NO_CASES = "spec.no-cases";

const OUTCOME_KINDS = new Set(["pass", "fail", "skip", "only"]);

/** What one run of the library's walk does; the numbers are the library's `specMode`. */
const COLLECT = 1;
const CASE = 2;
const SETUP = 3;
const TEARDOWN = 4;

type Task = {
  readonly mode: typeof COLLECT | typeof CASE | typeof SETUP | typeof TEARDOWN;
  /** The case (mode `CASE`) or the group (modes `SETUP`, `TEARDOWN`) the run is for. */
  readonly target: number;
  /** The snapshot to resume from, or `null` for a fresh fixture. */
  readonly from: string | null;
};
type CreatorTask = {
  readonly fixture: FixtureDefinition;
  readonly fixtureDeclarations: readonly FixtureDeclaration[];
  readonly world: FixtureWorld | null;
  readonly from: CreatorSceneSnapshot | null;
  readonly actionSnapshot: CreatorActionSnapshot | null;
  readonly error: TaskError | null;
  readonly file: string;
  readonly groups: readonly string[];
  readonly project: string | null;
  readonly nativePlugin: PluginDefinition | null;
  readonly onFrame: ((frame: CreatorFrameObservation) => void) | null;
};

type TaskError = { readonly code: string; readonly message: string; readonly line: number; readonly sourcePath?: string };

function creatorRunReport(
  file: string,
  source: string,
  creator: CreatorTask,
  scene: CreatorScene,
  seed: number,
  actions: readonly { readonly action: string; readonly pressAt: number; readonly releaseAt: number; readonly completedAt: number | null }[],
  actionLog: readonly InputRecord[],
  checkpoints: readonly { readonly tick: number; readonly stateHash: string }[],
): CreatorFixtureRun {
  const board = creator.world!.byKey.get(assetKey(creator.fixture.board))!;
  const sourceSpec = creator.world!.files.find((entry) => assetKey(entry.sourcePath) === assetKey(file));
  const encoded = encodeCp1252(source);
  if (!encoded.ok) throw new Error(`spec source is not Windows-1252: ${encoded.error.message}`);
  const specDigest = sourceSpec === undefined ? sha256Hex(encoded.value) : sha256Hex(sourceSpec.bytes);
  const fixture: CreatorFixtureIdentity = {
    groups: creator.groups,
    board: creator.fixture.board,
    party: creator.fixture.party,
    start: creator.fixture.start,
    seed,
  };
  const excluded = new Set([assetKey(creator.fixture.board), assetKey(file)]);
  return {
    fixture,
    snapshot: {
      launch: "saved-tests",
      project: creator.project,
      documents: [
        { role: "spec", path: file, sha256: specDigest },
        { role: "fixture-board", path: board.sourcePath, sha256: sha256Hex(board.bytes) },
      ],
      world: {
        files: creator.world!.files.filter((entry) => !excluded.has(assetKey(entry.path))).length,
        sha256: fixtureWorldSha256(creator.world!, excluded),
      },
      seed,
      fixture,
      runner: "script-spec/1.0.0",
    },
    loaded: [...scene.loaded],
    ticks: scene.tick(),
    actionLog: [...actionLog],
    checkpoints: [...checkpoints],
  };
}

type TaskRun = {
  readonly outcomes: readonly SpecOutcome[];
  readonly errors: readonly TaskError[];
  readonly hash: string;
  /** Fixture declarations captured during the file's registration-only pass. */
  readonly fixtures: readonly FixtureDeclaration[];
  /** The controller state captured by beforeAll. */
  readonly checkpoint: string | null;
  /** Complete real-engine scene checkpoint and host effect counters. */
  readonly creatorCheckpoint: CreatorSceneSnapshot | null;
  /** Inputs consumed by the fixture engine in their exact replay order. */
  readonly actionLog: readonly InputRecord[];
  /** Fixture-world source paths served to the engine in request order. */
  readonly loaded: readonly string[];
  readonly creatorActionSnapshot: CreatorActionSnapshot | null;
  readonly creatorRun: CreatorFixtureRun | null;
  readonly creatorContext: CreatorOutcomeContext | null;
  /** This run's line counts, when coverage was asked for. */
  readonly lines: LineCounts | null;
};

function creatorContext(scene: CreatorScene, doubles: SpecDoubles): CreatorOutcomeContext {
  const tick = scene.tick();
  const completedAt = (item: CreatorAction): number | null =>
    item.completedAt ?? (item.releaseAt <= tick ? item.releaseAt : null);
  const latest = doubles.creatorActions.actions
    .filter((item) => completedAt(item) !== null)
    .reduce<CreatorAction | null>(
      (selected, item) => selected === null || completedAt(item)! > completedAt(selected)! || (
        completedAt(item) === completedAt(selected) && item.ordinal > selected.ordinal
      ) ? item : selected,
      null,
    );
  return {
    tick,
    lastAction: latest === null ? null : {
      action: latest.action,
      ticks: latest.releaseAt - latest.pressAt,
      startTick: latest.pressAt,
      completedTick: completedAt(latest)!,
    },
    board: scene.board(),
  };
}

/** Where a counted run's instruction positions are reported: a project path, or `null` for harness lines. */
type Placement = (file: string, line: number) => string | null;

/**
 * Coverage placement for one spec file (TOOL-5 coverage rule 1): the spec's own lines under its path, the library
 * and the lines appended after the spec's text never, and every other file under its project path.
 */
function placement(file: string, source: string, loader: SpecProgramLoader | undefined): Placement {
  const authored = source.split("\n").length;
  const indexed = new Map<string, string>();
  for (const path of loader?.index.paths ?? []) if (!indexed.has(assetKey(path))) indexed.set(assetKey(path), path);
  return (key, line) => {
    if (key === SPEC_FILE_KEY) return line <= authored ? file : null;
    if (key === LIBRARY_KEY) return null;
    return loader?.sourcePath?.(key) ?? indexed.get(key) ?? key;
  };
}
/** Map an engine's folded asset key to the project-relative source file used by the editor. */
function sourcePathFor(file: string, key: string, loader: SpecProgramLoader | undefined): string {
  if (key === SPEC_FILE_KEY || key === LIBRARY_KEY || key === "") return file;
  const indexedPath = loader?.index.paths.find((path) => assetKey(path) === key);
  return loader?.sourcePath?.(key) ?? indexedPath ?? key;
}


function validateFixtureStart(world: FixtureWorld, fixture: FixtureDefinition): void {
  const boardFile = world.byKey.get(assetKey(fixture.board));
  if (boardFile === undefined) throw new FixtureError("spec.fixture-load", `specFixture: board "${fixture.board}" is not in the fixture world`);
  const parsed = readBoard(new BinaryReader(boardFile.bytes, boardFile.sourcePath));
  if (!parsed.ok) throw new FixtureError("spec.fixture-load", `specFixture: board "${fixture.board}" is invalid: ${parsed.error.message}`);
  const board = parsed.value;
  const { x, y, layer } = fixture.start;
  const layout = coordLayout(board.coordType);
  const size = boardPixelSize(layout, board.sizeX, board.sizeY);
  const position = usesPixelCoordinates(board.coordType)
    ? { x, y }
    : layout === "iso-rotated"
      ? tileToPixel(layout, board.sizeX, x, y)
      : null;
  const inBounds = position === null
    ? x >= 1 && x <= board.sizeX && y >= 1 && y <= board.sizeY
    : position.x >= 0 && position.x < size.width && position.y >= 0 && position.y < size.height;
  if (!inBounds || layer < 1 || layer > board.sizeL) {
    throw new FixtureError("spec.fixture-load", `specFixture: start (${x}, ${y}, ${layer}) lies outside board "${fixture.board}"`);
  }
}

/** A fresh 1×1 board, one selected party actor and no variables. */
function freshState(seed: number): GameState {
  const state: GameState = createGameState({ seed });
  state.world = {
    ...state.world,
    board: {
      key: assetKey("boards/spec-fixture.brd"), coordType: 0,
      sizeX: 1, sizeY: 1, sizeL: 1, width: 32, height: 32,
      background: { r: 0, g: 0, b: 0 }, ambient: { r: 0, g: 0, b: 0 }, layers: [],
    },
  };
  const actor = addActor(state.actors, { kind: "party", source: "spec-fixture.tem", stats: { hp: 10, maxHp: 10 } });
  state.party.members.push(actor.id);
  state.party.selected = actor.id;
  const actorObject = registerActorObject(state.vm, state.events, state.actors, actor.id);
  if (actorObject === null) throw new Error("spec fixture actor was not registered");
  state.vm.globals.specactor = { kind: "object", handle: actorObject.handle, className: actorObject.className };
  state.vm.globals.specactorid = actor.id;
  return state;
}

function runCreatorTask(
  source: string,
  librarySource: string,
  seed: number,
  task: Task,
  creator: CreatorTask,
  place: Placement | null,
): TaskRun {
  const empty = (error: TaskError): TaskRun => ({
    outcomes: [],
    errors: [error],
    hash: "",
    fixtures: [],
    checkpoint: null,
    creatorCheckpoint: null,
    actionLog: [],
    loaded: [],
    creatorRun: null,
    creatorContext: null,
    creatorActionSnapshot: null,
    lines: null,
  });
  if (creator.error !== null) return empty(creator.error);
  if (creator.world === null) return empty({ code: "spec.fixture-load", message: "fixture world was not created", line: 0 });

  let scene: CreatorScene | null = null;
  const resultContexts = new Map<number, { readonly context: CreatorOutcomeContext; readonly sourcePath: string }>();
  const bridge = {
    tick: () => scene?.tick() ?? 0,
    value: (path: string, view: CommandView) => {
      if (scene === null) throw new ScriptError("spec.fixture-load", "creator fixture engine is not ready");
      return scene.bridge.value(path, view);
    },
    wait: (path: string, expected: number | string, maxTicks: number, elapsed: number, view: CommandView) => {
      if (scene === null) throw new ScriptError("spec.fixture-load", "specWait: fixture engine is not ready");
      return scene.bridge.wait(path, expected, maxTicks, elapsed, view);
    },
  };
  const doubles = createDoubles(() => scene?.engine.registeredActionNames() ?? [], true, bridge, creator.actionSnapshot ?? undefined);
  for (const fixture of creator.fixtureDeclarations) doubles.fixtures.set(fixture.group, fixture);
  const plugins = wrapPlugins([
    ...DEFAULT_ENGINE_PLUGINS,
    ...(creator.nativePlugin === null ? [] : [{ definition: creator.nativePlugin }]),
    { definition: createSpecPlugin(doubles) },
  ], doubles);
  const runtimeSeed = creator.fixture.seed ?? seed;
  const program: CreatorSceneProgram = { source, sourcePath: creator.file, librarySource, mode: task.mode, target: task.target };
  scene = createCreatorScene(
    creator.world,
    creator.fixture,
    runtimeSeed,
    plugins,
    program,
    creator.from ?? undefined,
    creator.onFrame ?? undefined,
    place ?? undefined,
    (effect, observed) => {
      const current = scene;
      const context = current === null
        ? { tick: observed.tick, lastAction: null, board: observed.board }
        : creatorContext(current, doubles);
      resultContexts.set(effect.seq, { context, sourcePath: observed.sourcePath });
    },
  );
  let diagnosticsSeen = scene.diagnostics.length;
  const errors: TaskError[] = scene.diagnostics.map((item) => ({ code: item.code, message: item.message, line: item.line, sourcePath: item.sourcePath }));
  const collectDiagnostics = (): void => {
    errors.push(...scene!.diagnostics.slice(diagnosticsSeen).map((item) => ({ code: item.code, message: item.message, line: item.line, sourcePath: item.sourcePath })));
    diagnosticsSeen = scene!.diagnostics.length;
  };
  const actionLog: InputRecord[] = [];
  const checkpoints: { tick: number; stateHash: string }[] = [{ tick: scene.tick(), stateHash: scene.stateHash() }];
  let checkpoint: CreatorSceneSnapshot | null = null;
  let finished = false;
  for (let ticks = 0; ticks < 1000; ticks += 1) {
    if (task.mode === SETUP && scene.checkpointReached()) {
      // The creator checkpoint native parks this engine thread, preserving its continuation for case runs.
      checkpoint = scene.checkpoint();
      finished = true;
      break;
    }
    if (task.mode !== SETUP && scene.complete()) {
      finished = true;
      break;
    }
    const currentTick = scene.tick();
    const dueKeys = doubles.pending.filter((item) => item.tick === currentTick);
    const keyInputs = dueKeys.map((item): InputRecord => ({ tick: item.tick, event: item.event }));
    const actionInputs = doubles.creatorActions.takeInputs(currentTick);
    const consumed = scene.advance([...actionInputs, ...keyInputs]);
    const acceptedKeys = new Set(consumed.flatMap((record) =>
      record.event.kind === "key" ? [`${record.tick}\\0${record.event.name}\\0${record.event.down}`] : [],
    ));
    for (let index = doubles.pending.length - 1; index >= 0; index -= 1) {
      const item = doubles.pending[index]!;
      if (acceptedKeys.has(`${item.tick}\\0${item.event.name}\\0${item.event.down}`)) doubles.pending.splice(index, 1);
    }
    doubles.creatorActions.completeTick(scene.tick());
    actionLog.push(...consumed.filter((record) => record.event.kind === "action" || record.event.kind === "key"));
    if (doubles.creatorActions.actions.some((item) => item.completedAt === scene.tick())) {
      checkpoints.push({ tick: scene.tick(), stateHash: scene.stateHash() });
    }
    collectDiagnostics();
  }
  collectDiagnostics();
  if (!finished) errors.push({
    code: "spec.timeout",
    message: task.mode === SETUP
      ? "beforeAll did not reach its fixture checkpoint within 1,000 ticks"
      : "spec did not finish within 1,000 ticks",
    line: 0,
  });
  for (const item of doubles.pending) {
    errors.push({
      code: "spec.input-pending",
      message: `a key edge (${item.event.name}, ${item.event.down ? "down" : "up"}) scheduled for tick ${item.tick} never entered the input section`,
      line: 0,
    });
  }
  const context = creatorContext(scene, doubles);
  const outcomes: SpecOutcome[] = [];
  for (const record of scene.results) {
    if (record.name !== "specresult") continue;
    const kind = String(record.args[0] ?? "");
    if (!OUTCOME_KINDS.has(kind) || record.args[2] === "checkpoint") continue;
    outcomes.push({
      kind: kind as SpecOutcomeKind,
      label: String(record.args[1] ?? ""),
      expected: String(record.args[2] ?? ""),
      actual: String(record.args[3] ?? ""),
      line: typeof record.args[5] === "number" ? record.args[5] : 0,
      column: typeof record.args[6] === "number" ? record.args[6] : 0,
      sourcePath: resultContexts.get(record.seq)?.sourcePath ?? creator.file,
      context: resultContexts.get(record.seq)?.context ?? context,
    });
  }
  if (checkpoints.at(-1)?.tick !== scene.tick()) checkpoints.push({ tick: scene.tick(), stateHash: scene.stateHash() });
  const run = creatorRunReport(
    creator.file,
    source,
    creator,
    scene,
    runtimeSeed,
    doubles.creatorActions.actions,
    actionLog,
    checkpoints,
  );
  return {
    outcomes,
    errors,
    hash: scene.stateHash(),
    fixtures: [],
    checkpoint: null,
    creatorCheckpoint: checkpoint ?? scene.checkpoint(),
    actionLog,
    loaded: scene.loaded,
    creatorRun: run,
    creatorContext: context,
    creatorActionSnapshot: doubles.creatorActions.snapshot(),
    lines: place === null ? null : scene.coverage(),
  };
}

function runTask(
  source: string,
  librarySource: string,
  seed: number,
  loader: SpecProgramLoader | undefined,
  task: Task,
  place: Placement | null = null,
  creator: CreatorTask | null = null,
  sourceFile = "Prg/__spec.prg",
): TaskRun {
  if (creator !== null) return runCreatorTask(source, librarySource, seed, task, creator, place);
  const state = task.from === null ? freshState(seed) : restoreGameState(task.from);
  // The snapshot carries the effect log of the run that took it; this run reports only its own.
  if (task.from !== null) drainEffects(state.vm);
  state.vm.globals.specmode = task.mode;
  state.vm.globals.spectarget = task.target;
  if (task.mode === COLLECT && task.from === null) state.vm.globals.speccurrent = 0;
  const specProgram = specLoader(loader, source, librarySource);
  const specRef = fileProgramRef(specProgram, SPEC_FILE_KEY);
  const positions = new Map<number, { readonly line: number; readonly column: number; readonly sourcePath: string }>();
  let checkpoint: string | null = null;
  let lastSeq = state.vm.effectSeq;
  const probe = place === null ? null : createCoverageProbe(() => state.vm, () => services, place);
  let checkpointFailure: string | null = null;
  const nativePlugin = loader?.nativePlugin;
  const doubles = createDoubles(() => [], false);
  const plugins = wrapPlugins([...DEFAULT_ENGINE_PLUGINS, ...(nativePlugin === undefined ? [] : [{ definition: nativePlugin }]), { definition: createSpecPlugin(doubles) }], doubles);
  if (task.from === null) startProgram(state.vm, specRef);
  const services: ScriptServices = createScriptServices(state, plugins, undefined, undefined, specProgram,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, {
      postHandler: (handler, threadId) => {
        if (handler.plugin !== "script-spec" || handler.name !== "specresult") return;
        const seq = state.vm.effectSeq + 1;
        const thread = state.vm.threads.find((item) => item.id === threadId);
        for (let index = (thread?.frames.length ?? 0) - 1; index >= 0; index -= 1) {
          const frame = thread!.frames[index]!;
          const op = services.programs.get(frame.program).ops[frame.ip - 1];
          if (op !== undefined && op.pos.file !== LIBRARY_KEY && op.pos.file !== "") {
            positions.set(seq, {
              line: op.pos.line,
              column: op.pos.col ?? 0,
              sourcePath: sourcePathFor(sourceFile, op.pos.file, loader),
            });
            break;
        }
      }
      },
      ...(task.mode !== SETUP && probe === null ? {} : {
        postStep: (_op: unknown, threadId: number) => {
          probe?.step(threadId);
          if (task.mode !== SETUP) return;
          const last = state.vm.effects[state.vm.effects.length - 1];
          if (last === undefined || last.seq === lastSeq) return;
          lastSeq = last.seq;
          if (checkpoint !== null || last.name !== "specresult" || last.args[2] !== "checkpoint") return;
          try {
            checkpoint = snapshot(state);
          } catch (error) {
            checkpointFailure = error instanceof Error ? error.message : String(error);
          }
        },
      }),
    });
  const records: EffectRecord[] = [];
  let finished = false;
  for (let tick = 0; tick < 1000; tick += 1) {
    applyDue(doubles, state.input, state.time.tick);
    const status = advanceScriptTick(state, services, STEP_BUDGET);
    records.push(...drainEffects(state.vm));
    if (status === "finished") {
      finished = true;
      break;
    }
  }
  const errors: TaskError[] = drainDiagnostics(services).map((error) => ({
    code: error.code,
    message: error.message,
    line: error.line,
    sourcePath: sourcePathFor(sourceFile, error.file, loader),
  }));
  if (!finished) errors.push({ code: "spec.timeout", message: "spec did not finish within 1000 ticks", line: 0 });
  for (const item of doubles.pending) {
    errors.push({ code: "spec.input-pending", message: `a key edge (${item.event.name}, ${item.event.down ? "down" : "up"}) scheduled for tick ${item.tick} never entered the input section`, line: 0 });
  }
  if (checkpointFailure !== null) errors.push({ code: "spec.snapshot", message: checkpointFailure, line: 0 });
  const outcomes: SpecOutcome[] = [];
  for (const record of records) {
    if (record.name !== "specresult") continue;
    const kind = String(record.args[0] ?? "");
    if (!OUTCOME_KINDS.has(kind) || record.args[2] === "checkpoint") continue;
    const position = positions.get(record.seq);
    outcomes.push({
      kind: kind as SpecOutcomeKind,
      label: String(record.args[1] ?? ""),
      expected: String(record.args[2] ?? ""),
      actual: String(record.args[3] ?? ""),
      line: position?.line ?? 0,
      column: position?.column ?? 0,
      sourcePath: position?.sourcePath ?? sourceFile,
    });
  }
  const fixtures = task.mode === COLLECT
    ? [...doubles.fixtures.values()].sort((left, right) => left.group - right.group)
    : [];
  return {
    outcomes,
    errors,
    hash: hashGameState(state),
    checkpoint,
    fixtures,
    creatorCheckpoint: null,
    actionLog: [],
    loaded: [],
    creatorRun: null,
    creatorContext: null,
    creatorActionSnapshot: null,
    lines: probe?.finish() ?? null,
  };
}

/** Run a task twice: determinism is part of the contract, so a difference is a runner failure. */
function runTwice(
  what: string,
  source: string,
  librarySource: string,
  seed: number,
  loader: SpecProgramLoader | undefined,
  task: Task,
  place: Placement | null,
  creator: CreatorTask | null = null,
  sourceFile = "Prg/__spec.prg",
): TaskRun {
  const first = runTask(source, librarySource, seed, loader, task, place, creator, sourceFile);
  const second = runTask(source, librarySource, seed, loader, task, place, creator, sourceFile);
  if (first.hash !== second.hash) {
    throw new Error(`${what}: two runs gave different state hashes (${first.hash} vs ${second.hash})`);
  }
  if (JSON.stringify(first.outcomes) !== JSON.stringify(second.outcomes)
    || JSON.stringify(first.errors) !== JSON.stringify(second.errors)
    || first.checkpoint !== second.checkpoint
    || JSON.stringify(first.creatorCheckpoint) !== JSON.stringify(second.creatorCheckpoint)
    || JSON.stringify(first.actionLog) !== JSON.stringify(second.actionLog)
    || JSON.stringify(first.loaded) !== JSON.stringify(second.loaded)
    || JSON.stringify(first.creatorRun) !== JSON.stringify(second.creatorRun)
    || JSON.stringify(first.creatorContext) !== JSON.stringify(second.creatorContext)
    || JSON.stringify(first.creatorActionSnapshot) !== JSON.stringify(second.creatorActionSnapshot)
    // The replay is compared, never counted: coverage is one logical run (TOOL-5 coverage rule 4).
    || (first.lines !== null && JSON.stringify(toCoverage(first.lines)) !== JSON.stringify(toCoverage(second.lines!)))) {
    throw new Error(`${what}: two runs gave different outcomes`);
  }
  return first;
}

/** `<matcher>: expected X, actual Y`, the message a failing case reports verbatim. */
export function failureMessage(outcome: SpecOutcome): string {
  const slash = outcome.label.lastIndexOf("/");
  const matcher = slash < 0 ? outcome.label : outcome.label.slice(slash + 1);
  const message = `${matcher}: expected ${outcome.expected}, actual ${outcome.actual}`;
  const context = outcome.context;
  if (context === undefined) return message;
  const action = context.lastAction === null
    ? "none"
    : `${context.lastAction.action} (${context.lastAction.ticks} ticks, started ${context.lastAction.startTick}, completed ${context.lastAction.completedTick})`;
  return `${message}; tick ${context.tick}, board ${context.board ?? "none"}, last action ${action}`;
}

type Group = {
  readonly id: number;
  readonly parent: number;
  readonly name: string;
  readonly hasBeforeAll: boolean;
  readonly hasAfterAll: boolean;
  readonly hasHook: boolean;
};

type RegisteredCase = {
  readonly id: number;
  readonly name: string;
  readonly kind: "normal" | "skip" | "only";
  readonly group: number;
};

type Structure = {
  readonly groups: ReadonlyMap<number, Group>;
  readonly cases: readonly RegisteredCase[];
  readonly fixtures: readonly FixtureDeclaration[];
  readonly hash: string;
};

const CASE_KINDS = ["normal", "skip", "only"] as const;

/** Whether a fixture's parent chain already owns a hook or fixture world. */
function fixtureAncestorHasHookOrFixture(group: number, groups: ReadonlyMap<number, Group>, fixtures: readonly FixtureDeclaration[]): boolean {
  let current = groups.get(group)?.parent;
  while (current !== undefined && current !== group) {
    const ancestor = groups.get(current);
    if (ancestor === undefined) return false;
    if (ancestor.hasHook || fixtures.some((fixture) => fixture.group === current)) return true;
    if (current === 0) return false;
    current = ancestor.parent;
  }
  return false;
}

/** Run registration once and reject fixture worlds that would replay or inherit an incompatible ancestor. */
function collect(source: string, librarySource: string, seed: number, loader?: SpecProgramLoader): Structure {
  const run = runTask(source, librarySource, seed, loader, { mode: COLLECT, target: 0, from: null });
  if (run.errors.length > 0) {
    const error = run.errors[0]!;
    throw new Error(`spec discovery failed at line ${error.line} (${error.code}): ${error.message}`);
  }
  const groups = new Map<number, { id: number; parent: number; name: string; hasBeforeAll: boolean; hasAfterAll: boolean; hasHook: boolean }>();
  groups.set(0, { id: 0, parent: 0, name: "", hasBeforeAll: false, hasAfterAll: false, hasHook: false });
  const cases: RegisteredCase[] = [];
  for (const outcome of run.outcomes) {
    if (outcome.kind !== "pass") continue;
    const parts = outcome.actual.split(":").map(Number);
    if (outcome.expected === "group") {
      groups.set(parts[0]!, { id: parts[0]!, parent: parts[1]!, name: outcome.label, hasBeforeAll: false, hasAfterAll: false, hasHook: false });
    } else if (outcome.expected === "case") {
      cases.push({ id: parts[1]!, name: outcome.label, kind: CASE_KINDS[parts[0]!] ?? "normal", group: parts[2]! });
    } else if (outcome.expected === "hook") {
      const group = groups.get(parts[0]!);
      if (group !== undefined) {
        group.hasHook = true;
        if (outcome.label === "beforeAll") group.hasBeforeAll = true;
        else if (outcome.label === "afterAll") group.hasAfterAll = true;
      }
    }
  }
  for (const fixture of run.fixtures) {
    if (fixtureAncestorHasHookOrFixture(fixture.group, groups, run.fixtures)) {
      throw new Error(`spec discovery failed at line ${fixture.line} (spec.fixture-nested): fixture group ${fixture.group} is nested under a hook or fixture group`);
    }
  }
  return { groups, cases, fixtures: run.fixtures, hash: run.hash };
}

/** The registered cases in source order, without executing their bodies. */
export function discoverCasesWithLibrary(source: string, librarySource: string, seed = 0, loader?: SpecProgramLoader): string[] {
  return collect(source, librarySource, seed, loader).cases.map((item) => item.name);
}

/** Whether the file registers at least one focused case, without running cases. */
export function hasOnlyCasesWithLibrary(source: string, librarySource: string, seed = 0, loader?: SpecProgramLoader): boolean {
  return collect(source, librarySource, seed, loader).cases.some((item) => item.kind === "only");
}

function runtimeFailures(
  label: string,
  expected: string,
  errors: readonly TaskError[],
  sourceFile: string,
  context: CreatorOutcomeContext | null = null,
): SpecOutcome[] {
  return errors.map((error) => ({
    kind: "fail" as const,
    label,
    expected,
    actual: `${error.code}: ${error.message}`,
    line: error.line,
    column: 0,
    sourcePath: error.sourcePath ?? sourceFile,
    ...(context === null ? {} : { context }),
  }));
}

/** The result of one group's `beforeAll` hooks: what they recorded and the snapshot every case of the group starts from. */
type Setup = {
  readonly outcomes: readonly SpecOutcome[];
  readonly creatorActionSnapshot: CreatorActionSnapshot | null;
  readonly errors: readonly TaskError[];
  readonly snapshot: string | null;
  readonly creatorSnapshot: CreatorSceneSnapshot | null;
  readonly creatorContext: CreatorOutcomeContext | null;
  readonly creator: boolean;
  readonly hash: string;
};

function setupFailed(setup: Setup): boolean {
  return (setup.creator ? setup.creatorSnapshot === null : setup.snapshot === null)
    || setup.errors.length > 0
    || setup.outcomes.some((outcome) => outcome.kind === "fail");
}

/** Run one spec file: every case on a fresh fixture, twice, and compare. */
export function runSpecFileWithLibrary(file: string, source: string, librarySource: string, options: SpecRunOptions): SpecFileReport {
  const seed = options.seed ?? 0;
  const strict = options.strict ?? true;
  const loader = options.loader;
  const structure = collect(source, librarySource, seed, loader);
  const place = options.coverage === true ? placement(file, source, loader) : null;
  const counted: LineCounts = new Map();
  const count = (run: TaskRun): void => {
    if (run.lines !== null) addCounts(counted, run.lines);
  };
  if (structure.cases.length === 0) {
    const outcome: SpecOutcome = {
      kind: "fail", label: NO_CASES, expected: "at least one case", actual: "no case is registered",
      line: 1, column: 1, sourcePath: file,
    };
    return {
      file,
      cases: [{ name: NO_CASES, groups: [], outcomes: [outcome], ok: false, stateHash: structure.hash }],
      skipped: [],
      warning: null,
      failures: [`${file}: ${NO_CASES}: the spec file registers no case (line 1)`],
      ...(place === null ? {} : { coverage: toCoverage(counted) }),
    };
  }
  const onlySeen = structure.cases.some((item) => item.kind === "only");

  /** The group and its ancestors, innermost first, up to and including the file (group 0). */
  const lineage = (group: number): number[] => {
    const chain = [group];
    while (chain[chain.length - 1] !== 0) chain.push(structure.groups.get(chain[chain.length - 1]!)!.parent);
    return chain;
  };
  const groupsFor = (group: number): string[] =>
    lineage(group).filter((id) => id !== 0).reverse().map((id) => structure.groups.get(id)!.name);
  const creatorFor = (group: number, from: CreatorSceneSnapshot | null, actionSnapshot: CreatorActionSnapshot | null = null): CreatorTask | null => {
    const declaration = structure.fixtures.find((fixture) => lineage(group).includes(fixture.group)) ?? null;
    if (declaration === null) return null;
    try {
      const world = createFixtureWorld(loader?.fixtureFiles ?? [], declaration.definition);
      validateFixtureStart(world, declaration.definition);
      return {
        fixtureDeclarations: structure.fixtures,
        fixture: declaration.definition,
        world,
        from,
        actionSnapshot,
        error: null,
        file,
        groups: groupsFor(declaration.group),
        project: options.project ?? null,
        nativePlugin: loader?.nativePlugin ?? null,
        onFrame: options.onFrame ?? null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        fixtureDeclarations: structure.fixtures,
        fixture: declaration.definition,
        world: null,
        actionSnapshot,
        from: null,
        error: {
          code: error instanceof FixtureError ? error.code : "spec.fixture-load",
          message,
          line: declaration.line,
          sourcePath: file,
        },
        file,
        groups: groupsFor(declaration.group),
        project: options.project ?? null,
        nativePlugin: loader?.nativePlugin ?? null,
        onFrame: options.onFrame ?? null,
      };
    }
  };
  const selected = structure.cases.filter((item) =>
    (!onlySeen || item.kind === "only") && [...groupsFor(item.group), item.name].join(" > ").includes(options.name ?? ""));
  const setups = new Map<number, Setup>();
  const setupOf = (group: number): Setup => {
    const known = setups.get(group);
    if (known !== undefined) return known;
    // A group's setup resumes from the snapshot of its nearest ancestor that has a beforeAll.
    const above = lineage(group).slice(1).find((id) => structure.groups.get(id)!.hasBeforeAll);
    const from = above === undefined ? null : setupOf(above).snapshot;
    const creatorFrom = above === undefined ? null : setupOf(above).creatorSnapshot;
    const creatorActionFrom = above === undefined ? null : setupOf(above).creatorActionSnapshot;
    const creator = creatorFor(group, creatorFrom, creatorActionFrom);
    const run = runTwice(
      `beforeAll of group ${group}`,
      source,
      librarySource,
      seed,
      loader,
      { mode: SETUP, target: group, from },
      place,
      creator,
      file,
    );
    count(run);
    const setup: Setup = {
      outcomes: run.outcomes,
      creatorActionSnapshot: run.creatorActionSnapshot,
      errors: run.errors,
      snapshot: run.checkpoint,
      creatorSnapshot: run.creatorCheckpoint,
      creatorContext: run.creatorContext,
      creator: creator !== null,
      hash: run.hash,
    };
    setups.set(group, setup);
    return setup;
  };
  /** The snapshot a run for `group` resumes from: its own setup, else the nearest ancestor's, else a fresh fixture. */
  const snapshotFor = (group: number): string | null => {
    const owner = lineage(group).find((id) => structure.groups.get(id)!.hasBeforeAll);
    return owner === undefined ? null : setupOf(owner).snapshot;
  };
  const creatorSnapshotFor = (group: number): CreatorSceneSnapshot | null => {
    const owner = lineage(group).find((id) => structure.groups.get(id)!.hasBeforeAll);
    return owner === undefined ? null : setupOf(owner).creatorSnapshot;
  };
  const creatorActionSnapshotFor = (group: number): CreatorActionSnapshot | null => {
    const owner = lineage(group).find((id) => structure.groups.get(id)!.hasBeforeAll);
    return owner === undefined ? null : setupOf(owner).creatorActionSnapshot;
  };
  /** Whether the beforeAll of a proper ancestor of `group` failed; outermost first, so no setup resumes from a failed one. */
  const failedAbove = (group: number): boolean =>
    lineage(group).slice(1).filter((id) => structure.groups.get(id)!.hasBeforeAll).reverse().some((id) => setupFailed(setupOf(id)));

  // The cases still to run in each group's subtree: a group's afterAll runs after the last one.
  const remaining = new Map<number, number>();
  for (const item of selected) {
    if (item.kind === "skip") continue;
    for (const id of lineage(item.group)) remaining.set(id, (remaining.get(id) ?? 0) + 1);
  }

  const cases: SpecCaseResult[] = [];
  const skipped: string[] = [];
  const failures: string[] = [];
  for (const item of selected) {
    const { name } = item;
    const own: SpecOutcome[] = [];
    const prefix: SpecOutcome[] = [];
    const suffix: SpecOutcome[] = [];
    let hash = structure.hash;
    let from: string | null = null;
    let creatorFrom: CreatorSceneSnapshot | null = null;
    let creatorActionFrom: CreatorActionSnapshot | null = null;
    let caseRun: CreatorFixtureRun | null = null;
    let blocked = false;
    if (item.kind !== "skip") {
      // Setups run outermost first, each from the one above; a failed one fails every case of its group.
      const owners = lineage(item.group).filter((id) => structure.groups.get(id)!.hasBeforeAll).reverse();
      for (const owner of owners) {
        const setup = setupOf(owner);
        prefix.push(
          ...setup.outcomes,
          ...runtimeFailures(`${name}/beforeAll`, "beforeAll without a runtime error", setup.errors, file, setup.creatorContext),
        );
        hash = setup.hash;
        if (setupFailed(setup)) {
          blocked = true;
          if (setup.errors.length === 0 && !setup.outcomes.some((outcome) => outcome.kind === "fail")) {
            prefix.push({ kind: "fail", label: `${name}/beforeAll`, expected: "beforeAll completes", actual: "beforeAll did not reach its checkpoint", line: 0, column: 0, sourcePath: file });
          }
          break;
        }
        from = setup.snapshot;
        creatorFrom = setup.creatorSnapshot;
        creatorActionFrom = setup.creatorActionSnapshot;
      }
    }
    if (!blocked) {
      const run = runTwice(name, source, librarySource, seed, loader, { mode: CASE, target: item.id, from }, place, creatorFor(item.group, creatorFrom, creatorActionFrom), file);
      count(run);
      own.push(...run.outcomes, ...runtimeFailures(`${name}/runtime error`, "no runtime error", run.errors, file, run.creatorContext));
      caseRun = run.creatorRun;
      hash = run.hash;
    }
    if (item.kind === "skip") skipped.push(name);
    if (item.kind !== "skip") {
      // afterAll runs once per group, from the group's own snapshot, after the group's last case.
      for (const group of lineage(item.group)) {
        remaining.set(group, remaining.get(group)! - 1);
        const info = structure.groups.get(group)!;
        if (remaining.get(group) !== 0 || !info.hasAfterAll || failedAbove(group)) continue;
        const from = info.hasBeforeAll ? setupOf(group).snapshot : snapshotFor(group);
        const creatorFrom = info.hasBeforeAll ? setupOf(group).creatorSnapshot : creatorSnapshotFor(group);
        const creatorActionFrom = info.hasBeforeAll ? setupOf(group).creatorActionSnapshot : creatorActionSnapshotFor(group);
        const creator = creatorFor(group, creatorFrom, creatorActionFrom);
        if (info.hasBeforeAll && (creator === null ? from === null : creatorFrom === null)) continue;
        const run = runTwice(
          `afterAll of group ${group}`,
          source,
          librarySource,
          seed,
          loader,
          { mode: TEARDOWN, target: group, from },
          place,
          creator,
          file,
        );
        count(run);
        suffix.push(...run.outcomes, ...runtimeFailures(`${name}/afterAll`, "afterAll without a runtime error", run.errors, file, run.creatorContext));
      }
    }
    const outcomes = [...prefix, ...own, ...suffix];
    // A case that records nothing has tested nothing: it must not read as healthy.
    const ok = (blocked || own.length > 0)
      && outcomes.every((outcome) => outcome.kind === "pass" || outcome.kind === "only" || (!strict && outcome.kind === "skip"));
    if (!blocked && own.length === 0) failures.push(`${file}: ${name}: recorded no assertion`);
    if (item.kind === "skip" && strict) failures.push(`${file}: ${name}: skipped in strict mode`);
    for (const outcome of outcomes) if (outcome.kind === "fail") failures.push(`${file}: ${name}: ${failureMessage(outcome)} (line ${outcome.line})`);
    cases.push({ name, groups: groupsFor(item.group), outcomes, ok, stateHash: hash, ...(caseRun === null ? {} : { run: caseRun }) });
  }
  return {
    file, cases, skipped, warning: onlySeen ? ONLY_WARNING : null, failures,
    ...(place === null ? {} : { coverage: toCoverage(counted) }),
  };
}
