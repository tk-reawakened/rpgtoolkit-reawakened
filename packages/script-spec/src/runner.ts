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
 * state hashes. Each run has its own host-side test doubles (`doubles.ts`), so a
 * case's scheduled keys, scripted draws and spies never reach another run.
 * With `coverage`, each counted run also counts the instructions it executes
 * (`coverage.ts`, TOOL-5 "Line coverage").
 */

import { readFileSync } from "node:fs";
import {
  addActor,
  assetKey,
  advanceScriptTick,
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
  registerActorObject,
  restoreGameState,
  snapshot,
  startProgram,
  STEP_BUDGET,
  type EffectRecord,
  type GameState,
  type PluginDefinition,
  type ProgramLoader,
  type ScriptServices,
} from "@tk-reawakened/core";
import { addCounts, createCoverageProbe, toCoverage, type LineCounts, type SpecCoverage } from "./coverage.ts";
import { applyDue, createDoubles, wrapPlugins } from "./doubles.ts";
import { createSpecPlugin } from "./index.ts";

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
const PACKAGE_STARTUP = readFileSync(new URL("../package/startup.prg", import.meta.url), "utf8");
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
};
const SPEC_FILE_KEY = assetKey(`Prg/${SPEC_PROGRAM}`);
const LIBRARY_KEY = assetKey(LIBRARY_PATH);

/** The project loader plus this spec file and the includable library unit. */
function specLoader(base: ProgramLoader | undefined, source: string): ProgramLoader {
  const specPath = `Prg/${SPEC_PROGRAM}`;
  const specKey = assetKey(specPath);
  const libraryKey = assetKey(LIBRARY_PATH);
  // Program bytes are Windows-1252 (docs/spec/formats/rpgcode-program.md), so the
  // source the project already decoded is encoded back with the same codec; the
  // bundled library is converted the same way, not UTF-8.
  const specEncoded = encodeCp1252(`${source}\nspecRun()\n#include "${LIBRARY_INCLUDE}"\n`);
  const libraryEncoded = encodeCp1252(PACKAGE_STARTUP);
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

export type SpecOutcome = {
  readonly kind: SpecOutcomeKind;
  /** `<case>/<matcher>` as the library records it. */
  readonly label: string;
  readonly expected: string;
  readonly actual: string;
  readonly line: number;
  readonly column: number;
};

export type SpecCaseResult = {
  readonly name: string;
  readonly groups: readonly string[];
  readonly outcomes: readonly SpecOutcome[];
  /** Strict: only passes count. Lenient: a skip is tolerated and still reported. */
  readonly ok: boolean;
  /** `hashGameState` after the case's run. */
  readonly stateHash: string;
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

type TaskError = { readonly code: string; readonly message: string; readonly line: number };

type TaskRun = {
  readonly outcomes: readonly SpecOutcome[];
  readonly errors: readonly TaskError[];
  readonly hash: string;
  /** The snapshot taken at a setup run's checkpoint, or `null`. */
  readonly checkpoint: string | null;
  /** This run's line counts, when coverage was asked for. */
  readonly lines: LineCounts | null;
};

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

function runTask(source: string, seed: number, loader: SpecProgramLoader | undefined, task: Task, place: Placement | null = null): TaskRun {
  const state = task.from === null ? freshState(seed) : restoreGameState(task.from);
  // The snapshot carries the effect log of the run that took it; this run reports only its own.
  if (task.from !== null) drainEffects(state.vm);
  state.vm.globals.specmode = task.mode;
  state.vm.globals.spectarget = task.target;
  const specProgram = specLoader(loader, source);
  const specRef = fileProgramRef(specProgram, SPEC_PROGRAM);
  if (task.from === null) startProgram(state.vm, specRef);
  // The record carries `specResult`'s own library position, not the assertion's, so the
  // spec-file line is captured where the handler runs and keyed by the effect sequence the
  // call is about to take: the effect log may evict records, so pairing by array index would
  // silently drift.
  const positions = new Map<number, { line: number; column: number }>();
  let checkpoint: string | null = null;
  let checkpointFailure: string | null = null;
  let lastSeq = state.vm.effectSeq;
  // The probe reads the services only while steps run, after they exist.
  const probe = place === null ? null : createCoverageProbe(() => state.vm, () => services, place);
  const nativePlugin = loader?.nativePlugin;
  // TOOL-5 test doubles: host-side, made afresh for this run, never saved or hashed.
  const doubles = createDoubles();
  const plugins = wrapPlugins([...DEFAULT_ENGINE_PLUGINS, ...(nativePlugin === undefined ? [] : [{ definition: nativePlugin }]), { definition: createSpecPlugin(doubles) }], doubles);
  const services: ScriptServices = createScriptServices(state, plugins, undefined, undefined, specProgram,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, {
      postHandler: (handler, threadId) => {
        if (handler.plugin !== "script-spec" || handler.name !== "specresult") return;
        const seq = state.vm.effectSeq + 1;
        const thread = state.vm.threads.find((item) => item.id === threadId);
        for (let index = (thread?.frames.length ?? 0) - 1; index >= 0; index -= 1) {
          const frame = thread!.frames[index]!;
          // Included code is part of the same compiled program, so the position's
          // own file is what separates a spec statement from a library statement.
          const op = services.programs.get(frame.program).ops[frame.ip - 1];
          if (op !== undefined && specRef.kind === "file" && op.pos.file === SPEC_FILE_KEY) {
            positions.set(seq, { line: op.pos.line, column: op.pos.col ?? 0 });
            return;
          }
        }
      },
      // A step is observed before it runs, so the first step after the library's checkpoint
      // report sees a state whose last call has finished: the snapshot resumes right after it.
      // Coverage counts the instruction the thread's top frame is about to run.
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
    // Scheduled key edges enter the input section before this tick's wait poll, in scheduling order.
    applyDue(doubles, state.input, state.time.tick);
    const status = advanceScriptTick(state, services, STEP_BUDGET);
    // The effect log is a bounded ring: drain it every tick so no record is evicted.
    for (const record of drainEffects(state.vm)) records.push(record);
    if (status === "finished") {
      finished = true;
      break;
    }
  }
  const errors: TaskError[] = drainDiagnostics(services).map((error) => ({
    code: error.code,
    message: error.message,
    line: error.line,
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
    // The checkpoint report is the library talking to this runner, not an outcome.
    if (!OUTCOME_KINDS.has(kind) || record.args[2] === "checkpoint") continue;
    const position = positions.get(record.seq);
    outcomes.push({
      kind: kind as SpecOutcomeKind,
      label: String(record.args[1] ?? ""),
      expected: String(record.args[2] ?? ""),
      actual: String(record.args[3] ?? ""),
      line: position?.line ?? 0,
      column: position?.column ?? 0,
    });
  }
  return { outcomes, errors, hash: hashGameState(state), checkpoint, lines: probe?.finish() ?? null };
}

/** Run a task twice: determinism is part of the contract, so a difference is a runner failure. */
function runTwice(what: string, source: string, seed: number, loader: SpecProgramLoader | undefined, task: Task, place: Placement | null): TaskRun {
  const first = runTask(source, seed, loader, task, place);
  const second = runTask(source, seed, loader, task, place);
  if (first.hash !== second.hash) {
    throw new Error(`${what}: two runs gave different state hashes (${first.hash} vs ${second.hash})`);
  }
  if (JSON.stringify(first.outcomes) !== JSON.stringify(second.outcomes)
    || JSON.stringify(first.errors) !== JSON.stringify(second.errors)
    || first.checkpoint !== second.checkpoint
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
  return `${matcher}: expected ${outcome.expected}, actual ${outcome.actual}`;
}

type Group = {
  readonly id: number;
  readonly parent: number;
  readonly name: string;
  readonly hasBeforeAll: boolean;
  readonly hasAfterAll: boolean;
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
  readonly hash: string;
};

const CASE_KINDS = ["normal", "skip", "only"] as const;

/**
 * Run the spec file's registration alone: the library reports every group, case and group hook it registers
 * (collect mode records them and executes no body). A failure while registering fails discovery.
 */
function collect(source: string, seed: number, loader?: SpecProgramLoader): Structure {
  const run = runTask(source, seed, loader, { mode: COLLECT, target: 0, from: null });
  if (run.errors.length > 0) {
    const error = run.errors[0]!;
    throw new Error(`spec discovery failed at line ${error.line} (${error.code}): ${error.message}`);
  }
  const groups = new Map<number, { id: number; parent: number; name: string; hasBeforeAll: boolean; hasAfterAll: boolean }>();
  groups.set(0, { id: 0, parent: 0, name: "", hasBeforeAll: false, hasAfterAll: false });
  const cases: RegisteredCase[] = [];
  for (const outcome of run.outcomes) {
    if (outcome.kind !== "pass") continue;
    const parts = outcome.actual.split(":").map(Number);
    if (outcome.expected === "group") {
      groups.set(parts[0]!, { id: parts[0]!, parent: parts[1]!, name: outcome.label, hasBeforeAll: false, hasAfterAll: false });
    } else if (outcome.expected === "case") {
      cases.push({ id: parts[1]!, name: outcome.label, kind: CASE_KINDS[parts[0]!] ?? "normal", group: parts[2]! });
    } else if (outcome.expected === "hook") {
      const group = groups.get(parts[0]!);
      if (group !== undefined) {
        if (outcome.label === "beforeAll") group.hasBeforeAll = true;
        else group.hasAfterAll = true;
      }
    }
  }
  return { groups, cases, hash: run.hash };
}

/** The registered cases in source order, without executing their bodies. */
export function discoverCases(source: string, seed = 0, loader?: SpecProgramLoader): string[] {
  return collect(source, seed, loader).cases.map((item) => item.name);
}

/** Whether the file registers at least one focused case, without running cases. */
export function hasOnlyCases(source: string, seed = 0, loader?: SpecProgramLoader): boolean {
  return collect(source, seed, loader).cases.some((item) => item.kind === "only");
}

function runtimeFailures(label: string, expected: string, errors: readonly TaskError[]): SpecOutcome[] {
  return errors.map((error) => ({
    kind: "fail" as const,
    label,
    expected,
    actual: `${error.code}: ${error.message}`,
    line: error.line,
    column: 0,
  }));
}

/** The result of one group's `beforeAll` hooks: what they recorded and the snapshot every case of the group starts from. */
type Setup = {
  readonly outcomes: readonly SpecOutcome[];
  readonly errors: readonly TaskError[];
  readonly snapshot: string | null;
  readonly hash: string;
};

function setupFailed(setup: Setup): boolean {
  return setup.snapshot === null || setup.errors.length > 0 || setup.outcomes.some((outcome) => outcome.kind === "fail");
}

/** Run one spec file: every case on a fresh fixture, twice, and compare. */
export function runSpecFile(file: string, source: string, options: SpecRunOptions): SpecFileReport {
  const seed = options.seed ?? 0;
  const strict = options.strict ?? true;
  const loader = options.loader;
  const structure = collect(source, seed, loader);
  const place = options.coverage === true ? placement(file, source, loader) : null;
  const counted: LineCounts = new Map();
  const count = (run: TaskRun): void => {
    if (run.lines !== null) addCounts(counted, run.lines);
  };
  if (structure.cases.length === 0) {
    const outcome: SpecOutcome = {
      kind: "fail", label: NO_CASES, expected: "at least one case", actual: "no case is registered", line: 1, column: 1,
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
  const selected = structure.cases.filter((item) =>
    (!onlySeen || item.kind === "only") && [...groupsFor(item.group), item.name].join(" > ").includes(options.name ?? ""));
  const setups = new Map<number, Setup>();
  const setupOf = (group: number): Setup => {
    const known = setups.get(group);
    if (known !== undefined) return known;
    // A group's setup resumes from the snapshot of its nearest ancestor that has a beforeAll.
    const above = lineage(group).slice(1).find((id) => structure.groups.get(id)!.hasBeforeAll);
    const from = above === undefined ? null : setupOf(above).snapshot;
    const run = runTwice(`beforeAll of group ${group}`, source, seed, loader, { mode: SETUP, target: group, from }, place);
    count(run);
    const setup: Setup = { outcomes: run.outcomes, errors: run.errors, snapshot: run.checkpoint, hash: run.hash };
    setups.set(group, setup);
    return setup;
  };
  /** The snapshot a run for `group` resumes from: its own setup, else the nearest ancestor's, else a fresh fixture. */
  const snapshotFor = (group: number): string | null => {
    const owner = lineage(group).find((id) => structure.groups.get(id)!.hasBeforeAll);
    return owner === undefined ? null : setupOf(owner).snapshot;
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
    let blocked = false;
    if (item.kind !== "skip") {
      // Setups run outermost first, each from the one above; a failed one fails every case of its group.
      const owners = lineage(item.group).filter((id) => structure.groups.get(id)!.hasBeforeAll).reverse();
      for (const owner of owners) {
        const setup = setupOf(owner);
        prefix.push(...setup.outcomes, ...runtimeFailures(`${name}/beforeAll`, "beforeAll without a runtime error", setup.errors));
        hash = setup.hash;
        if (setupFailed(setup)) {
          blocked = true;
          if (setup.errors.length === 0 && !setup.outcomes.some((outcome) => outcome.kind === "fail")) {
            prefix.push({ kind: "fail", label: `${name}/beforeAll`, expected: "beforeAll completes", actual: "beforeAll did not reach its checkpoint", line: 0, column: 0 });
          }
          break;
        }
        from = setup.snapshot;
      }
    }
    if (!blocked) {
      const run = runTwice(name, source, seed, loader, { mode: CASE, target: item.id, from }, place);
      count(run);
      own.push(...run.outcomes, ...runtimeFailures(`${name}/runtime error`, "no runtime error", run.errors));
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
        if (info.hasBeforeAll && from === null) continue;
        const run = runTwice(`afterAll of group ${group}`, source, seed, loader, { mode: TEARDOWN, target: group, from }, place);
        count(run);
        suffix.push(...run.outcomes, ...runtimeFailures(`${name}/afterAll`, "afterAll without a runtime error", run.errors));
      }
    }
    const outcomes = [...prefix, ...own, ...suffix];
    // A case that records nothing has tested nothing: it must not read as healthy.
    const ok = (blocked || own.length > 0)
      && outcomes.every((outcome) => outcome.kind === "pass" || outcome.kind === "only" || (!strict && outcome.kind === "skip"));
    if (!blocked && own.length === 0) failures.push(`${file}: ${name}: recorded no assertion`);
    if (item.kind === "skip" && strict) failures.push(`${file}: ${name}: skipped in strict mode`);
    for (const outcome of outcomes) if (outcome.kind === "fail") failures.push(`${file}: ${name}: ${failureMessage(outcome)} (line ${outcome.line})`);
    cases.push({ name, groups: groupsFor(item.group), outcomes, ok, stateHash: hash });
  }
  return {
    file, cases, skipped, warning: onlySeen ? ONLY_WARNING : null, failures,
    ...(place === null ? {} : { coverage: toCoverage(counted) }),
  };
}
