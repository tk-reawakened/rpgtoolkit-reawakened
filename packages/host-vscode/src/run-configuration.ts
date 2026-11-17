import type { BoardStart, Launch, LaunchKind } from "@tk-reawakened/platform-services";

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
  const kind = config.launch === undefined ? answer(await prompts.kind()) : config.launch;
  if (typeof kind !== "string" || !KINDS.includes(kind as LaunchKind)) {
    throw new Refused(`"launch" must be "game", "board" or "program".`);
  }
  const seed = config.seed;
  if (seed !== undefined && (typeof seed !== "number" || !Number.isSafeInteger(seed))) throw new Refused(`"seed" must be a whole number.`);
  const main = await path("main", () => prompts.main());
  if (!main.toLowerCase().endsWith(".gam")) throw new Refused(`"main" must name a .gam main file.`);
  const projectFolder = config.projectFolder === undefined ? answer(await prompts.projectFolder()) : workspacePath("projectFolder", config.projectFolder);
  if (projectFolder !== "" && !/^Game\/[^/]+$/i.test(projectFolder)) {
    throw new Refused(`"projectFolder" must be the workspace folder itself or one Game/<game> folder.`);
  }
  const base = { main, projectFolder, ...(seed === undefined ? {} : { seed }) };
  if (kind === "game") return { kind: "game", ...base };
  if (kind === "board") {
    const start = await boardStart("board");
    const party = await partyList(true);
    return { kind: "board", ...base, start, party };
  }
  const program = await path("program", () => prompts.program(projectFolder));
  const start = await boardStart("fixture");
  const party = await partyList(false);
  const font = config.font === undefined ? answer(await prompts.font()) : config.font;
  if (typeof font !== "string") throw new Refused(`"font" must be a font name, or "" for the game's default.`);
  const fontSize = config.fontSize === undefined ? answer(await prompts.fontSize()) : config.fontSize;
  if (fontSize !== null && (typeof fontSize !== "number" || !Number.isFinite(fontSize) || fontSize <= 0)) {
    throw new Refused(`"fontSize" must be a positive number, or null for the game's default.`);
  }
  const graphic = config.windowGraphic === undefined ? answer(await prompts.windowGraphic(projectFolder))
    : config.windowGraphic === null || config.windowGraphic === "" ? null : workspacePath("windowGraphic", config.windowGraphic);
  return {
    kind: "program",
    ...base,
    program,
    fixture: {
      id: program,
      party,
      ...(font === "" ? {} : { font }),
      ...(fontSize === null ? {} : { fontSize }),
      ...(graphic === null ? {} : { windowGraphic: graphic }),
      start,
    },
  };

  async function path(name: "main" | "program" | "board", ask: () => Promise<string | undefined>): Promise<string> {
    return config[name] === undefined ? answer(await ask()) : workspacePath(name, config[name]);
  }

  function workspacePath(name: string, value: unknown): string {
    const relative = typeof value === "string" ? toWorkspacePath(value, roots) : undefined;
    if (relative === undefined) throw new Refused(`"${name}" must be a path inside the workspace folder.`);
    return relative;
  }

  async function boardStart(purpose: "board" | "fixture"): Promise<BoardStart> {
    const board = await path("board", () => prompts.board(projectFolder, purpose));
    const coordinate = async (name: "x" | "y" | "layer"): Promise<number> => {
      const value = config[name] === undefined ? answer(await prompts.coordinate(name)) : config[name];
      if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Refused(`"${name}" must be a whole number.`);
      return value;
    };
    const x = await coordinate("x");
    const y = await coordinate("y");
    const layer = await coordinate("layer");
    return { board, x, y, layer };
  }

  async function partyList(required: boolean): Promise<readonly string[]> {
    if (config.party === undefined) return answer(await prompts.party(projectFolder, required));
    if (!Array.isArray(config.party)) throw new Refused(`"party" must be a list of character (.tem) files.`);
    return config.party.map((member: unknown) => workspacePath("party", member));
  }
}

function answer<T>(value: T | undefined): T {
  if (value === undefined) throw new Cancelled();
  return value;
}

/** The configuration that names every value of `launch`, so a restart reruns it without asking again (ADR 0037 item 5). */
export function launchConfiguration(launch: Launch): Record<string, unknown> {
  const base = { launch: launch.kind, main: launch.main, projectFolder: launch.projectFolder, ...(launch.seed === undefined ? {} : { seed: launch.seed }) };
  if (launch.kind === "game") return base;
  if (launch.kind === "board") return { ...base, ...launch.start, party: [...launch.party] };
  const fixture = launch.fixture;
  return {
    ...base,
    program: launch.program,
    ...(fixture.start === undefined ? {} : fixture.start),
    party: [...fixture.party],
    font: fixture.font ?? "",
    fontSize: fixture.fontSize ?? null,
    windowGraphic: fixture.windowGraphic ?? null,
  };
}
