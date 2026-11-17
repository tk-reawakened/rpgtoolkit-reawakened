import type { BoardStart, Launch, LaunchKind, ProgramFixture } from "@tk-reawakened/platform-services";

/**
 * A `tkr` launch configuration (ADR 0037): the Run and Debug spelling of a platform-services `Launch`. This module is pure;
 * it imports no `vscode`, so unit tests drive it directly, and the commands and the debug provider share it.
 */
export const TKR_DEBUG_TYPE = "tkr";

/** Each question a configuration can leave unanswered. The VS Code implementation is the palette commands' own prompts. */
export interface LaunchPrompts {
  /** Which launch; asked only when the configuration names none. */
  kind(): Promise<LaunchKind | undefined>;
  /** The workspace-relative `.gam` main file. */
  main(): Promise<string | undefined>;
  /** `""` (package layout) or `Game/<game>`. */
  projectFolder(): Promise<string | undefined>;
  /** The workspace-relative program under test. */
  program(projectFolder: string): Promise<string | undefined>;
  /** The workspace-relative board a board test enters, or a program fixture starts on. */
  board(projectFolder: string, purpose: "board" | "fixture"): Promise<string | undefined>;
  /** One start coordinate. */
  coordinate(name: "x" | "y" | "layer"): Promise<number | undefined>;
  /** Workspace-relative `.tem` files, leader first. `required` means at least one must be chosen (a board test). */
  party(projectFolder: string, required: boolean): Promise<readonly string[] | undefined>;
  /** A font name, or `""` for the game's default. */
  font(): Promise<string | undefined>;
  /** A font size, or `null` for the game's default. */
  fontSize(): Promise<number | null | undefined>;
  /** A workspace-relative message-window graphic, or `null` for none. */
  windowGraphic(projectFolder: string): Promise<string | null | undefined>;
}

export type ResolvedLaunch =
  | { readonly ok: true; readonly launch: Launch }
  | { readonly ok: false; readonly cancelled: true }
  | { readonly ok: false; readonly cancelled: false; readonly message: string };

const KINDS: readonly LaunchKind[] = ["game", "board", "program"];

class Refused extends Error {}
class Cancelled extends Error {}

/**
 * Turn a configured path into a workspace-relative one. `roots` are the spellings of the configuration's workspace folder
 * (its URI string, its file-system path and its URI path), so `${workspaceFolder}/Main/x.gam` works on desktop and web.
 * Returns `undefined` for a path outside the folder or one with `.` or `..` segments.
 */
export function toWorkspacePath(value: string, roots: readonly string[]): string | undefined {
  const path = value.replace(/\\/g, "/");
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("/");
  let relative: string | undefined = absolute ? undefined : path.replace(/^\.\//, "");
  if (absolute) {
    for (const rawRoot of roots) {
      const root = rawRoot.replace(/\\/g, "/").replace(/\/+$/, "");
      if (rawRoot === "") continue;
      // A folder at the root of its file system (a web workspace such as `memfs:/`) has the path `/`.
      if (root === "") {
        if (path.startsWith("/")) relative = path;
        if (relative !== undefined) break;
        continue;
      }
      const fold = /^[a-z]:\//i.test(root) || /^file:/i.test(root);
      const [have, want] = fold ? [path.toLowerCase(), root.toLowerCase()] : [path, root];
      if (have === want) relative = "";
      else if (have.startsWith(`${want}/`)) relative = path.slice(root.length + 1);
      if (relative !== undefined) break;
    }
  }
  if (relative === undefined) return undefined;
  // An empty `projectFolder` spliced into `${workspaceFolder}/${projectFolder}/Boards` leaves a doubled slash.
  relative = relative.replace(/\/{2,}/g, "/").replace(/^\/|\/$/g, "");
  return relative.split("/").some((part) => part === "." || part === "..") ? undefined : relative;
}

/**
 * Resolve a configuration into a `Launch`, asking `prompts` for each missing value in the palette commands' order. A value
 * of the wrong shape refuses with a message naming the field; it is never replaced by a guess.
 */
export async function resolveLaunch(configuration: Readonly<Record<string, unknown>>, roots: readonly string[], prompts: LaunchPrompts): Promise<ResolvedLaunch> {
  try {
    return { ok: true, launch: await resolve(configuration, roots, prompts) };
  } catch (error) {
    if (error instanceof Cancelled) return { ok: false, cancelled: true };
    if (error instanceof Refused) return { ok: false, cancelled: false, message: error.message };
    throw error;
  }
}

async function resolve(config: Readonly<Record<string, unknown>>, roots: readonly string[], prompts: LaunchPrompts): Promise<Launch> {
  const kind = config.kind === undefined ? answer(await prompts.kind()) : config.kind;
  if (typeof kind !== "string" || !KINDS.includes(kind as LaunchKind)) {
    throw new Refused(`"kind" must be "game", "board" or "program".`);
  }
  const seed = config.seed;
  if (seed !== undefined && (typeof seed !== "number" || !Number.isSafeInteger(seed))) throw new Refused(`"seed" must be a whole number.`);
  const main = config.main === undefined ? answer(await prompts.main()) : workspacePath("main", config.main);
  if (!main.toLowerCase().endsWith(".gam")) throw new Refused(`"main" must name a .gam main file.`);
  const projectFolder = config.projectFolder === undefined ? answer(await prompts.projectFolder()) : workspacePath("projectFolder", config.projectFolder);
  if (projectFolder !== "" && !/^Game\/[^/]+$/i.test(projectFolder)) {
    throw new Refused(`"projectFolder" must be the workspace folder itself or one Game/<game> folder.`);
  }
  const base = { main, projectFolder, ...(seed === undefined ? {} : { seed }) };
  if (kind === "game") return { kind: "game", ...base };
  if (kind === "board") {
    const start = await boardStart("start", config.start, "board");
    const party = await partyList("party", config.party, true);
    return { kind: "board", ...base, start, party };
  }
  const program = config.program === undefined ? answer(await prompts.program(projectFolder)) : workspacePath("program", config.program);
  return { kind: "program", ...base, program, fixture: await fixtureOf(program) };

  /**
   * A configured `fixture` is a `ProgramFixture` as written: an absent `font`, `fontSize`, `windowGraphic` or `start` means
   * the game's default, none, or no board, and only its `party` (which the type requires) is asked for. With no `fixture`
   * at all, every setting is asked for, as the Test Program command does.
   */
  async function fixtureOf(program: string): Promise<ProgramFixture> {
    // A missing `fixture.id` is the configuration's name, as for a saved setup (ADR 0022 D8.7); a nameless one (the Test
    // Program command) uses the program path.
    const fixtureId = typeof config.name === "string" && config.name !== "" ? config.name : program;
    if (config.fixture === undefined) {
      const start = await boardStart("fixture.start", undefined, "fixture");
      const party = await partyList("fixture.party", undefined, false);
      const font = answer(await prompts.font());
      const fontSize = answer(await prompts.fontSize());
      const graphic = answer(await prompts.windowGraphic(projectFolder));
      return {
        id: fixtureId, party,
        ...(font === "" ? {} : { font }),
        ...(fontSize === null ? {} : { fontSize }),
        ...(graphic === null ? {} : { windowGraphic: graphic }),
        start,
      };
    }
    const fixture = object("fixture", config.fixture);
    if (fixture.id !== undefined && typeof fixture.id !== "string") throw new Refused(`"fixture.id" must be a name.`);
    if (fixture.font !== undefined && typeof fixture.font !== "string") throw new Refused(`"fixture.font" must be a font name.`);
    if (fixture.fontSize !== undefined && (typeof fixture.fontSize !== "number" || !Number.isFinite(fixture.fontSize) || fixture.fontSize <= 0)) {
      throw new Refused(`"fixture.fontSize" must be a positive number.`);
    }
    const party = await partyList("fixture.party", fixture.party, false);
    const start = fixture.start === undefined ? undefined : await boardStart("fixture.start", fixture.start, "fixture");
    return {
      id: typeof fixture.id === "string" ? fixture.id : fixtureId,
      party,
      ...(typeof fixture.font === "string" ? { font: fixture.font } : {}),
      ...(typeof fixture.fontSize === "number" ? { fontSize: fixture.fontSize } : {}),
      ...(fixture.windowGraphic === undefined ? {} : { windowGraphic: workspacePath("fixture.windowGraphic", fixture.windowGraphic) }),
      ...(start === undefined ? {} : { start }),
    };
  }

  function workspacePath(name: string, value: unknown): string {
    const relative = typeof value === "string" ? toWorkspacePath(value, roots) : undefined;
    if (relative === undefined) throw new Refused(`"${name}" must be a path inside the workspace folder.`);
    return relative;
  }

  function object(name: string, value: unknown): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Refused(`"${name}" must be an object.`);
    return value as Record<string, unknown>;
  }

  /** A `BoardStart`; members the configuration leaves out are asked for. */
  async function boardStart(name: string, value: unknown, purpose: "board" | "fixture"): Promise<BoardStart> {
    const given = value === undefined ? {} : object(name, value);
    const board = given.board === undefined ? answer(await prompts.board(projectFolder, purpose)) : workspacePath(`${name}.board`, given.board);
    const coordinate = async (member: "x" | "y" | "layer"): Promise<number> => {
      const number = given[member] === undefined ? answer(await prompts.coordinate(member)) : given[member];
      if (typeof number !== "number" || !Number.isSafeInteger(number)) throw new Refused(`"${name}.${member}" must be a whole number.`);
      return number;
    };
    const x = await coordinate("x");
    const y = await coordinate("y");
    const layer = await coordinate("layer");
    return { board, x, y, layer };
  }

  async function partyList(name: string, value: unknown, required: boolean): Promise<readonly string[]> {
    if (value === undefined) return answer(await prompts.party(projectFolder, required));
    if (!Array.isArray(value)) throw new Refused(`"${name}" must be a list of character (.tem) files.`);
    return value.map((member: unknown) => workspacePath(name, member));
  }
}

function answer<T>(value: T | undefined): T {
  if (value === undefined) throw new Cancelled();
  return value;
}

/** A resolved launch as configuration fields: the `Launch` itself, so a restart reruns it without asking again (ADR 0037 item 5). */
export function launchConfiguration(launch: Launch): Record<string, unknown> {
  return JSON.parse(JSON.stringify(launch)) as Record<string, unknown>;
}

/**
 * The answers a running session already has, under what the configuration now says: the configuration wins, and a
 * `start` or `fixture` it gives only partly keeps the session's other members (one level down, as `Launch` nests).
 */
export function mergeAnswers(previous: Readonly<Record<string, unknown>>, configuration: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...previous, ...configuration };
  for (const key of ["start", "fixture"]) {
    const before = previous[key];
    const now = configuration[key];
    if (isObject(before) && isObject(now)) merged[key] = { ...before, ...now };
  }
  return merged;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
