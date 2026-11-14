/**
 * The `run` surface of AD-20 (`startGame`, `startProgram` with a fixture, returning a handle) and the launch rules of
 * ADR 0022 D8.
 *
 * Three launches stay distinct (D8.1): a **game** run from the main file's configured start-up, a **board** test at an
 * explicit board, start position and party, and a **program** test of one program with a declared fixture. A board test
 * is a game launch with an explicit start, so it goes through `startGame`; AD-20 names no third method and D8 needed none
 * (ADR 0022, "What was and was not amended"). Each launch has its own capability, so a host that can do one and not
 * another says which (D8.6).
 *
 * A run is given a frozen copy of the project's saved files and a **snapshot** that identifies them (D8.3): the launch
 * kind, the project, the SHA-256 of each document the run targets, one manifest hash over the rest, the start, the seed,
 * the fixture and the runner build. Later edits never reach a running game (D8.4); a new run is a new snapshot. Saving
 * before the run is the editor's job (D8.2, `editor-model`'s launcher); the host only ever reads what is on disk.
 */
import type { FileSystemService } from "./fs.ts";
import { platformError, platformOk, type Disposable, type PlatformResult } from "./result.ts";

/** Which of the three launches of ADR 0022 D8.1 a run is. Saved tests (`*.spec.prg`, D9) are not a `run` launch. */
export type LaunchKind = "game" | "board" | "program";

/**
 * Where a run starts on a board, the way the legacy editor's test setting `Send(board, x, y, layer)` named it
 * (`docs/spec/formats/rpgcode-program.md#test-runs-from-the-editor`): a project-relative board path and a tile position.
 */
export interface BoardStart {
  /** The project-relative path of the board, for example `Boards/village.brd`. */
  readonly board: string;
  /** The tile column, counted from 1. */
  readonly x: number;
  /** The tile row, counted from 1. */
  readonly y: number;
  /** The board layer, counted from 1. */
  readonly layer: number;
}

/** What every launch names: the game's main file and where the project's type folders are. */
interface LaunchBase {
  /** The project-relative path of the game's main file (`.gam`). */
  readonly main: string;
  /**
   * The folder that holds the type folders (`Boards`, `Prg`, …), project-relative: `""` for a package layout, or
   * `Game/<projectPath>` for a legacy game folder (`editor-model`'s `ProjectLayout.projectFolder`).
   */
  readonly projectFolder: string;
  /** The seed the run's random source starts from; `0` when absent. Recorded in the snapshot. */
  readonly seed?: number;
}

/** A normal game run: the main file's configured start-up, with nothing replaced (D8.1). */
export interface GameLaunch extends LaunchBase {
  readonly kind: "game";
}

/** A board test: the game entered at an explicit board and start position with an explicit party (D8.1). */
export interface BoardLaunch extends LaunchBase {
  readonly kind: "board";
  readonly start: BoardStart;
  /** The project-relative character files of the party, leader first. Empty means the main file's initial character. */
  readonly party: readonly string[];
}

/**
 * The fixture of a program test: the editor's test settings, as data (ADR 0022 D8.5). The legacy editor wrote these as
 * lines before the program in `Prg\sys_test.prg`; a Reawakened run never writes that file and never reads a creator's
 * file of that name as a run input. Each field is optional the way each legacy line was.
 */
export interface ProgramFixture {
  /** What names this fixture in results, for example the setting it came from. Recorded in the snapshot (D8.3). */
  readonly id: string;
  /** The message font's name (`Font`). */
  readonly font?: string;
  /** The message font's size in points (`FontSize`). */
  readonly fontSize?: number;
  /** The project-relative message-window graphic (`WinGraphic`). */
  readonly windowGraphic?: string;
  /** The project-relative character files to add as the party, leader first (`AddPlayer`). */
  readonly party: readonly string[];
  /** The board and position to start on (`Send`); absent means the program starts with no board. */
  readonly start?: BoardStart;
}

/** A program test: one program run under a declared fixture instead of the main file's start-up (D8.1). */
export interface ProgramLaunch extends LaunchBase {
  readonly kind: "program";
  /** The project-relative path of the program under test. */
  readonly program: string;
  readonly fixture: ProgramFixture;
}

export type Launch = GameLaunch | BoardLaunch | ProgramLaunch;

/** One document a run targets and the SHA-256 of the bytes it was given. */
export interface RunDocument {
  readonly path: string;
  /** Lower-case hex SHA-256. */
  readonly sha256: string;
}

/**
 * The snapshot a run records and its results show (ADR 0022 D8.3). Two runs with equal snapshots were given equal bytes
 * and equal inputs; the editor compares a later snapshot with this one to say a run is out of date.
 */
export interface RunSnapshot {
  readonly kind: LaunchKind;
  /** The project handle (ADR 0022 D1.1). */
  readonly project: string;
  /** The main file, then the board (a board test) or the program and the fixture's board (a program test). */
  readonly targets: readonly RunDocument[];
  /**
   * SHA-256 over every other project file's `(path, sha256)` record, length-prefixed and sorted, so no path or hash can
   * be re-split into another record (D8.3, the way `derivePackageIdentity` encodes them).
   */
  readonly manifest: string;
  /** How many files the manifest covers. */
  readonly manifestFiles: number;
  /** The explicit start, or `null` for a game run (it starts where the main file says). */
  readonly start: BoardStart | null;
  /** The party a board test or a fixture named; empty for a game run. */
  readonly party: readonly string[];
  readonly seed: number;
  /** The fixture's `id` for a program test; `null` otherwise. */
  readonly fixture: string | null;
  /** Full saved test settings, so equal snapshots represent equal executable fixture inputs. */
  readonly fixtureSettings: {
    readonly id: string;
    readonly font: string | null;
    readonly fontSize: number | null;
    readonly windowGraphic: string | null;
    readonly party: readonly string[];
    readonly start: BoardStart | null;
  } | null;
  /** The runner build that ran it, as the host names it. */
  readonly runner: string;
}

/** One located problem a run reported (AD-24 `TickReport` diagnostics). */
export interface RunDiagnostic {
  readonly code: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

/**
 * Where a run is. `stalled` means the engine is waiting on an asset (`stalledOn`); `ended` means the game quit or was
 * stopped; `failed` means it could not go on (`message` says why).
 */
export type RunState = "starting" | "running" | "stalled" | "ended" | "failed";

export interface RunStatus {
  readonly state: RunState;
  /** The engine tick reached, `0` before the first. */
  readonly tick: number;
  /** The board the game is on, or `null` before board entry or when the runner cannot say. */
  readonly board: string | null;
  /** Deterministic hash of the most recently observed runtime state, or null before one is available. */
  readonly stateHash: string | null;
  /** The asset the engine waits on while `stalled`; `null` otherwise. */
  readonly stalledOn: string | null;
  /** The located problems the run reported, latest last, as far as the runner exposes them. */
  readonly diagnostics: readonly RunDiagnostic[];
  /** A sentence for an `ended` or `failed` run; `null` otherwise. */
  readonly message: string | null;
}

/** A started run (AD-20: `run` returns a handle). */
export interface RunHandle {
  readonly snapshot: RunSnapshot;
  status(): RunStatus;
  /** Call `listener` on every status change until disposed. */
  onStatus(listener: (status: RunStatus) => void): Disposable;
  /** End the run. A stopped run reports `ended`; stopping it again does nothing. */
  stop(): void;
}

/**
 * The editor's last check after a host has read and hashed the saved files, immediately before it starts a runner. It is
 * synchronous so no editor command can run between the check and the start in that host turn. A host must abort on a
 * failure; it must not start the runner and then stop it (ADR 0022 D8.2).
 */
export type RunStartGuard = () => PlatformResult<void>;

/**
 * The `run` surface of AD-20. Present only with at least one of the `runGame`, `runBoard` and `runProgram` capabilities;
 * a launch whose capability the host does not declare answers `unavailable` with the reason. A file the launch names that
 * the project does not hold answers `not-found` naming it. Nothing is started from unsaved editor memory.
 */
export interface RunService {
  /**
   * Why each launch whose capability this host does not declare cannot be done, in a sentence a creator can read, so the
   * editor disables it with that reason before anyone asks (ADR 0022 D8.6).
   */
  readonly unavailable: Readonly<Partial<Record<LaunchKind, string>>>;
  /** A game run from its configured start-up (`kind: "game"`), or a board test (`kind: "board"`). */
  startGame(launch: GameLaunch | BoardLaunch, guard?: RunStartGuard): Promise<PlatformResult<RunHandle>>;
  /** A program test under its fixture. */
  startProgram(launch: ProgramLaunch, guard?: RunStartGuard): Promise<PlatformResult<RunHandle>>;
}

/** The capability each launch kind needs. */
export const LAUNCH_CAPABILITY = { game: "runGame", board: "runBoard", program: "runProgram" } as const;

/** An isolated board-backed scene and its in-memory RPGCode setup. */
export interface PreparedSceneLaunch {
  readonly board: string;
  readonly program: string;
}

/**
 * Stage test preferences through documented RPGCode rather than modifying engine state or writing `sys_test.prg`.
 * SceneInit requires a board and has no main-file defaults or game identity; refuse inputs it cannot express.
 */
export function prepareSceneLaunch(
  launch: ProgramLaunch,
  files: ReadonlyMap<string, Uint8Array>,
): PlatformResult<PreparedSceneLaunch> {
  const fixture = launch.fixture;
  const start = fixture.start;
  if (start === undefined) return platformError("unavailable", "The isolated scene runner requires an explicit fixture board.");
  const problem = badStart(start, "start");
  if (problem !== null) return platformError("invalid-request", problem);
  const root = launch.projectFolder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const relative = (path: string): string | null => {
    const name = path.replace(/\\/g, "/");
    return root === "" ? name : fold(name).startsWith(`${fold(root)}/`) ? name.slice(root.length + 1) : null;
  };
  // The RPGCode lexer has no string escape syntax. Never let a filename become injected code.
  const quote = (text: string | null): string | null => text === null || /["\r\n]/.test(text) ? null : `"${text}"`;
  const board = relative(start.board);
  const boardString = quote(board);
  const party = fixture.party.map((path) => quote(relative(path)));
  const font = fixture?.font === undefined ? null : quote(fixture.font);
  const graphic = fixture?.windowGraphic === undefined ? null : quote(relative(fixture.windowGraphic));
  if (board === null || boardString === null || party.some((member) => member === null)
    || (fixture?.font !== undefined && font === null)
    || (fixture?.windowGraphic !== undefined && graphic === null)) {
    return platformError("invalid-request", "A fixture value is outside the game folder or cannot be represented as an RPGCode string.");
  }
  if (fixture?.fontSize !== undefined && (!Number.isFinite(fixture.fontSize) || fixture.fontSize <= 0)) {
    return platformError("invalid-request", "The fixture font size must be a finite number above zero.");
  }
  const lines: string[] = [];
  if (font !== null) lines.push(`Font(${font})`);
  if (fixture?.fontSize !== undefined) lines.push(`FontSize(${fixture.fontSize})`);
  if (graphic !== null) lines.push(`WinGraphic(${graphic})`);
  for (const member of party) lines.push(`AddPlayer(${member})`);
  lines.push(`Send(${boardString},${start.x},${start.y},${start.layer})`);
  let bytes: Uint8Array | undefined;
  const wanted = fold(launch.program);
  for (const [path, contents] of files) if (fold(path) === wanted) { bytes = contents; break; }
  if (bytes === undefined) return platformError("not-found", `The program ${launch.program} is not in the saved snapshot.`);
  const Decoder: unknown = Reflect.get(globalThis, "TextDecoder");
  if (typeof Decoder !== "function") return platformError("unavailable", "This host cannot decode the saved program.");
  try {
    const decoder = Reflect.construct(Decoder, ["windows-1252"]) as { decode(bytes: Uint8Array): string };
    lines.push(decoder.decode(bytes));
  } catch {
    return platformError("unavailable", "This host cannot decode the saved program as Windows-1252.");
  }
  return platformOk({ board, program: `${lines.join("\n")}\n` });
}
/** What a host runs: the snapshot and the frozen bytes it identifies, by project-relative path as stored. */
export interface PreparedRun {
  readonly snapshot: RunSnapshot;
  readonly files: ReadonlyMap<string, Uint8Array>;
}

/** What `prepareRun` needs from the host. */
export interface PrepareRunOptions {
  /** The project handle the run reads from; every read is bound to it (ADR 0022 D1.1). */
  readonly projectId: string;
  /** The runner build, recorded in the snapshot. */
  readonly runner: string;
  /** SHA-256 of `bytes`; the platform's Web Crypto by default. */
  readonly sha256?: (bytes: Uint8Array) => Promise<string>;
}

/** The most files one run reads, so a launch over a huge folder stays bounded. */
const MAX_RUN_FILES = 20000;

/** The files a launch names, in snapshot order, with what each is, for a refusal that names it. */
function targetsOf(launch: Launch): readonly { readonly path: string; readonly role: string }[] {
  const targets: { readonly path: string; readonly role: string }[] = [{ path: launch.main, role: "main file" }];
  if (launch.kind === "board") targets.push({ path: launch.start.board, role: "board" });
  if (launch.kind === "program") {
    targets.push({ path: launch.program, role: "program" });
    if (launch.fixture.start !== undefined) targets.push({ path: launch.fixture.start.board, role: "fixture board" });
  }
  return targets;
}

/** Files a launch needs but does not target (the party, the window graphic): they must exist, and the manifest covers them. */
function requiredOf(launch: Launch): readonly { readonly path: string; readonly role: string }[] {
  if (launch.kind === "board") return launch.party.map((path) => ({ path, role: "party member" }));
  if (launch.kind === "program") {
    const required = launch.fixture.party.map((path) => ({ path, role: "fixture party member" }));
    if (launch.fixture.windowGraphic !== undefined) required.push({ path: launch.fixture.windowGraphic, role: "fixture window graphic" });
    return required;
  }
  return [];
}

/** ASCII fold of ADR 0022 D1.1, the comparison every project path uses. */
function fold(path: string): string {
  return path.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/** `<length>:<text>`, so concatenated fields cannot be re-split. */
function field(text: string): string {
  return `${text.length}:${text}`;
}

interface SubtleDigest {
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
}

/** The platform's Web Crypto digest, which browsers, VS Code's hosts and Node all provide; `undefined` where it is missing. */
function webCrypto(): SubtleDigest | undefined {
  // This package's lib is plain ES2022, which does not type the `crypto` global, so its shape is checked here.
  const crypto: unknown = Reflect.get(globalThis, "crypto");
  if (typeof crypto !== "object" || crypto === null || !("subtle" in crypto)) return undefined;
  const subtle: unknown = crypto.subtle;
  if (typeof subtle !== "object" || subtle === null || !("digest" in subtle) || typeof subtle.digest !== "function") return undefined;
  const digest: SubtleDigest["digest"] = (algorithm, data) => (subtle.digest as SubtleDigest["digest"]).call(subtle, algorithm, data);
  return { digest };
}

/** Lower-case hex SHA-256 through Web Crypto. */
async function webCryptoSha256(bytes: Uint8Array): Promise<string> {
  const subtle = webCrypto();
  if (subtle === undefined) throw new Error("this host has no Web Crypto to hash the run's files");
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/** UTF-8 bytes of `text` (a lone surrogate becomes U+FFFD, as `TextEncoder` does), without the DOM's `TextEncoder` type. */
function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (const character of text) {
    let code = character.codePointAt(0)!;
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return new Uint8Array(out);
}

/** A position that is not a whole tile counted from 1, as a sentence; `null` when it is one. */
function badStart(start: BoardStart, role: string): string | null {
  for (const [name, value] of [["x", start.x], ["y", start.y], ["layer", start.layer]] as const) {
    if (!Number.isInteger(value) || value < 1) return `The ${role}'s ${name} must be a whole number from 1; it is ${value}.`;
  }
  return null;
}

/**
 * Read every saved project file once, check that the files the launch names exist, and build the snapshot that
 * identifies them (ADR 0022 D8.3). Every host's `run` starts here, so snapshots agree across hosts; the host then hands
 * `files` to its runner and never reads the project again for that run (D8.4: no hot reload).
 */
export async function prepareRun(
  fs: Pick<FileSystemService, "list" | "readProject">,
  launch: Launch,
  options: PrepareRunOptions,
): Promise<PlatformResult<PreparedRun>> {
  const sha256 = options.sha256 ?? webCryptoSha256;
  const seed = launch.seed ?? 0;
  if (!Number.isInteger(seed)) return platformError("invalid-request", `The seed must be a whole number; it is ${seed}.`);
  const start = launch.kind === "board" ? launch.start : launch.kind === "program" ? launch.fixture.start ?? null : null;
  if (start !== null) {
    const problem = badStart(start, launch.kind === "board" ? "start" : "fixture start");
    if (problem !== null) return platformError("invalid-request", problem);
  }
  if (launch.kind === "program" && launch.fixture.fontSize !== undefined && !(launch.fixture.fontSize > 0)) {
    return platformError("invalid-request", `The fixture's font size must be above 0; it is ${launch.fixture.fontSize}.`);
  }

  const files = new Map<string, Uint8Array>();
  const byKey = new Map<string, string>();
  const pending = [""];
  while (pending.length > 0) {
    const folder = pending.shift()!;
    const listed = await fs.list(folder);
    if (!listed.ok) return listed;
    for (const entry of [...listed.value].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
      if (entry.kind === "directory") {
        pending.push(path);
        continue;
      }
      if (files.size >= MAX_RUN_FILES) return platformError("io-error", `The project has more than ${MAX_RUN_FILES} files; a run reads at most that many.`);
      const read = await fs.readProject(options.projectId, path);
      if (!read.ok) return read;
      files.set(path, read.value);
      byKey.set(fold(path), path);
    }
  }

  const targets: RunDocument[] = [];
  const targeted = new Set<string>();
  const named = targetsOf(launch);
  for (const target of [...named, ...requiredOf(launch)]) {
    const stored = byKey.get(fold(target.path));
    if (stored === undefined) return platformError("not-found", `The run needs the ${target.role} ${target.path}, which the project does not have.`);
    if (named.includes(target) && !targeted.has(stored)) {
      targeted.add(stored);
      targets.push({ path: stored, sha256: "" });
    }
  }

  const records: string[] = [];
  let manifest: string;
  try {
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index]!;
      targets[index] = { path: target.path, sha256: await sha256(files.get(target.path)!) };
    }
    for (const [path, bytes] of files) {
      if (targeted.has(path)) continue;
      records.push(`${field(path)}${field(await sha256(bytes))}`);
    }
    records.sort();
    manifest = await sha256(utf8(records.map(field).join("")));
  } catch (error) {
    return platformError("unavailable", `The run's files could not be hashed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const party = launch.kind === "board" ? launch.party : launch.kind === "program" ? launch.fixture.party : [];
  return platformOk({
    files,
    snapshot: {
      kind: launch.kind,
      project: options.projectId,
      targets,
      manifest,
      manifestFiles: records.length,
      start: start === null ? null : { ...start, board: byKey.get(fold(start.board)) ?? start.board },
      party: party.map((path) => byKey.get(fold(path)) ?? path),
      seed,
      fixture: launch.kind === "program" ? launch.fixture.id : null,
      fixtureSettings: launch.kind !== "program" ? null : {
        id: launch.fixture.id,
        font: launch.fixture.font ?? null,
        fontSize: launch.fixture.fontSize ?? null,
        windowGraphic: launch.fixture.windowGraphic === undefined ? null : byKey.get(fold(launch.fixture.windowGraphic)) ?? launch.fixture.windowGraphic,
        party: party.map((path) => byKey.get(fold(path)) ?? path),
        start: start === null ? null : { ...start, board: byKey.get(fold(start.board)) ?? start.board },
      },
      runner: options.runner,
    },
  });
}

/** The `unavailable` refusal for a launch whose capability the host does not declare, with the host's own reason. */
export function launchUnavailable(kind: LaunchKind, reason: string): PlatformResult<never> {
  const what = kind === "game" ? "run the game from its start-up" : kind === "board" ? "start a board test" : "run a program test";
  return platformError("unavailable", `This host cannot ${what}: ${reason}`);
}

/**
 * A run handle over a status the host updates. `report` changes the status and tells every listener; `stop` reports
 * `ended` once and calls the host's `onStop` so it can close its runner.
 */
export function createRunHandle(snapshot: RunSnapshot, onStop: () => void): { readonly handle: RunHandle; report(status: Partial<RunStatus>): void } {
  let status: RunStatus = { state: "starting", tick: 0, board: null, stateHash: null, stalledOn: null, diagnostics: [], message: null };
  const listeners = new Set<(status: RunStatus) => void>();
  const finished = (): boolean => status.state === "ended" || status.state === "failed";
  const report = (change: Partial<RunStatus>): void => {
    if (finished()) return;
    status = { ...status, ...change };
    for (const listener of [...listeners]) listener(status);
  };
  const handle: RunHandle = {
    snapshot,
    status: () => status,
    onStatus(listener) {
      listeners.add(listener);
      return { dispose: () => void listeners.delete(listener) };
    },
    stop() {
      if (finished()) return;
      report({ state: "ended", stalledOn: null, message: "The run was stopped." });
      onStop();
    },
  };
  return { handle, report };
}
