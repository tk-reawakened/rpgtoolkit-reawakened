import { utf8Decode, utf8Encode } from "@tk-reawakened/core";
import type { BoardStart, FileSystemService, Launch, ProgramFixture } from "@tk-reawakened/platform-services";

/**
 * Saved launch setups (ADR 0022 D8.7): named launches kept in the project so a run is set up once and run again with
 * one click, from any host. Every host reads the same file; none keeps a list of its own.
 */
export const LAUNCH_SETUPS_PATH = ".tkr/launch.json";

/** The only version of the file this editor reads and writes. */
export const LAUNCH_SETUPS_VERSION = 1;

/** What every setup may name; a missing `main` or `projectFolder` means the game open in the editor. */
interface SetupBase {
  readonly name: string;
  readonly main?: string;
  readonly projectFolder?: string;
  readonly seed?: number;
}

export interface GameSetup extends SetupBase {
  readonly kind: "game";
}

export interface BoardSetup extends SetupBase {
  readonly kind: "board";
  readonly start: BoardStart;
  readonly party: readonly string[];
}

/** A program test's fixture as saved: its `id` defaults to the setup's name. */
export type SavedFixture = Omit<ProgramFixture, "id"> & { readonly id?: string };

export interface ProgramSetup extends SetupBase {
  readonly kind: "program";
  readonly program: string;
  readonly fixture: SavedFixture;
}

export type LaunchSetup = GameSetup | BoardSetup | ProgramSetup;

/** One entry of the file, in file order: a usable setup, or the reason it cannot be used. */
export type LaunchSetupEntry =
  | { readonly name: string; readonly setup: LaunchSetup; readonly problem: null }
  | { readonly name: string; readonly setup: null; readonly problem: string };

/** The file as read: its entries, or why the whole file cannot be used (it is then never overwritten). */
export type LaunchSetupsRead =
  | { readonly ok: true; readonly entries: readonly LaunchSetupEntry[] }
  | { readonly ok: false; readonly problem: string };

export type LaunchSetupsWrite = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** The fields D8.7 defines; any other field of an entry is ignored and kept. */
const ENTRY_FIELDS = ["name", "kind", "main", "projectFolder", "seed", "start", "party", "program", "fixture"] as const;
const FIXTURE_FIELDS = ["id", "font", "fontSize", "windowGraphic", "party", "start"] as const;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const isWhole = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

function startProblem(value: unknown, field: string): string | null {
  if (!isObject(value)) return `${field} must be an object with board, x, y and layer.`;
  if (typeof value.board !== "string" || value.board === "") return `${field}.board must be a project-relative board path.`;
  if (!isWhole(value.x) || !isWhole(value.y)) return `${field}.x and ${field}.y must be whole numbers.`;
  if (!isWhole(value.layer) || value.layer < 1) return `${field}.layer must be a whole number from 1.`;
  return null;
}

function partyProblem(value: unknown, field: string): string | null {
  if (!Array.isArray(value) || !value.every((path) => typeof path === "string" && path !== "")) return `${field} must be a list of character file paths.`;
  return null;
}

const optionalString = (entry: Json, field: string): string | null =>
  entry[field] === undefined || typeof entry[field] === "string" ? null : `${field} must be text.`;

/** Why an entry breaks D8.7, or `null` when it is a usable setup. Duplicate names are found by the caller. */
function entryProblem(entry: unknown): string | null {
  if (!isObject(entry)) return "An entry must be an object.";
  if (typeof entry.name !== "string" || entry.name.trim() === "") return "An entry needs a name.";
  if (entry.kind !== "game" && entry.kind !== "board" && entry.kind !== "program") return `kind must be "game", "board" or "program".`;
  const base = optionalString(entry, "main") ?? optionalString(entry, "projectFolder");
  if (base !== null) return base;
  if (entry.seed !== undefined && !isWhole(entry.seed)) return "seed must be a whole number.";
  if (entry.kind === "board") return startProblem(entry.start, "start") ?? partyProblem(entry.party, "party");
  if (entry.kind === "program") {
    if (typeof entry.program !== "string" || entry.program === "") return "program must be a project-relative program path.";
    const fixture = entry.fixture;
    if (!isObject(fixture)) return "fixture must be an object.";
    for (const field of ["id", "font", "windowGraphic"]) {
      const problem = optionalString(fixture, field);
      if (problem !== null) return `fixture.${problem}`;
    }
    if (fixture.fontSize !== undefined && (typeof fixture.fontSize !== "number" || !(fixture.fontSize > 0))) return "fixture.fontSize must be a positive number.";
    const party = partyProblem(fixture.party, "fixture.party");
    if (party !== null) return party;
    if (fixture.start !== undefined) return startProblem(fixture.start, "fixture.start");
  }
  return null;
}

/** The setup an entry holds, with only the fields D8.7 defines. The entry must have no problem. */
function setupOf(entry: Json): LaunchSetup {
  const base = {
    name: entry.name as string,
    ...(entry.main === undefined ? {} : { main: entry.main as string }),
    ...(entry.projectFolder === undefined ? {} : { projectFolder: entry.projectFolder as string }),
    ...(entry.seed === undefined ? {} : { seed: entry.seed as number }),
  };
  const start = (value: Json): BoardStart => ({ board: value.board as string, x: value.x as number, y: value.y as number, layer: value.layer as number });
  if (entry.kind === "board") return { ...base, kind: "board", start: start(entry.start as Json), party: [...(entry.party as string[])] };
  if (entry.kind === "program") {
    const fixture = entry.fixture as Json;
    return {
      ...base,
      kind: "program",
      program: entry.program as string,
      fixture: {
        ...(fixture.id === undefined ? {} : { id: fixture.id as string }),
        ...(fixture.font === undefined ? {} : { font: fixture.font as string }),
        ...(fixture.fontSize === undefined ? {} : { fontSize: fixture.fontSize as number }),
        ...(fixture.windowGraphic === undefined ? {} : { windowGraphic: fixture.windowGraphic as string }),
        party: [...(fixture.party as string[])],
        ...(fixture.start === undefined ? {} : { start: start(fixture.start as Json) }),
      },
    };
  }
  return { ...base, kind: "game" };
}

/** The file's top level, or why it cannot be used. A missing file is an empty one. */
async function readFile(fs: Pick<FileSystemService, "read">): Promise<{ readonly ok: true; readonly file: Json } | { readonly ok: false; readonly problem: string }> {
  const read = await fs.read(LAUNCH_SETUPS_PATH);
  if (!read.ok) {
    return read.error.code === "not-found"
      ? { ok: true, file: { version: LAUNCH_SETUPS_VERSION, configurations: [] } }
      : { ok: false, problem: `${LAUNCH_SETUPS_PATH} could not be read: ${read.error.message}` };
  }
  let value: unknown;
  try {
    value = JSON.parse(utf8Decode(read.value));
  } catch {
    return { ok: false, problem: `${LAUNCH_SETUPS_PATH} is not valid JSON.` };
  }
  if (!isObject(value)) return { ok: false, problem: `${LAUNCH_SETUPS_PATH} must hold a JSON object.` };
  if (value.version !== LAUNCH_SETUPS_VERSION) return { ok: false, problem: `${LAUNCH_SETUPS_PATH} has version ${JSON.stringify(value.version)}; this editor reads version ${LAUNCH_SETUPS_VERSION}.` };
  if (value.configurations !== undefined && !Array.isArray(value.configurations)) return { ok: false, problem: `${LAUNCH_SETUPS_PATH}: configurations must be a list.` };
  return { ok: true, file: value };
}

/** Read the project's saved setups (D8.7): every entry in file order, each usable or with its reason. */
export async function readLaunchSetups(fs: Pick<FileSystemService, "read">): Promise<LaunchSetupsRead> {
  const file = await readFile(fs);
  if (!file.ok) return file;
  const seen = new Set<string>();
  const entries = ((file.file.configurations ?? []) as unknown[]).map((entry): LaunchSetupEntry => {
    const name = isObject(entry) && typeof entry.name === "string" ? entry.name : "(unnamed)";
    const problem = entryProblem(entry);
    if (problem !== null) return { name, setup: null, problem };
    if (seen.has(name)) return { name, setup: null, problem: `Another setup is already named "${name}".` };
    seen.add(name);
    return { name, setup: setupOf(entry as Json), problem: null };
  });
  return { ok: true, entries };
}

/** The setup as an entry, keeping the fields of `previous` that D8.7 does not define. */
function entryOf(setup: LaunchSetup, previous: Json | null): Json {
  const kept: Json = {};
  if (previous !== null) for (const [key, value] of Object.entries(previous)) if (!(ENTRY_FIELDS as readonly string[]).includes(key)) kept[key] = value;
  const entry: Json = { name: setup.name, kind: setup.kind };
  if (setup.main !== undefined) entry.main = setup.main;
  if (setup.projectFolder !== undefined) entry.projectFolder = setup.projectFolder;
  if (setup.seed !== undefined) entry.seed = setup.seed;
  if (setup.kind === "board") {
    entry.start = { ...setup.start };
    entry.party = [...setup.party];
  } else if (setup.kind === "program") {
    entry.program = setup.program;
    const keptFixture: Json = {};
    const old = previous !== null && isObject(previous.fixture) ? previous.fixture : null;
    if (old !== null) for (const [key, value] of Object.entries(old)) if (!(FIXTURE_FIELDS as readonly string[]).includes(key)) keptFixture[key] = value;
    entry.fixture = {
      ...(setup.fixture.id === undefined ? {} : { id: setup.fixture.id }),
      ...(setup.fixture.font === undefined ? {} : { font: setup.fixture.font }),
      ...(setup.fixture.fontSize === undefined ? {} : { fontSize: setup.fixture.fontSize }),
      ...(setup.fixture.windowGraphic === undefined ? {} : { windowGraphic: setup.fixture.windowGraphic }),
      party: [...setup.fixture.party],
      ...(setup.fixture.start === undefined ? {} : { start: { ...setup.fixture.start } }),
      ...keptFixture,
    };
  }
  return { ...entry, ...kept };
}

/** Change the file: `change` gets the entries and returns the new list, or a refusal. The file is rewritten whole. */
async function rewrite(
  fs: Pick<FileSystemService, "read" | "write">,
  change: (entries: unknown[]) => unknown[] | string,
): Promise<LaunchSetupsWrite> {
  const file = await readFile(fs);
  if (!file.ok) return { ok: false, message: `${file.problem} It was not changed.` };
  const changed = change([...((file.file.configurations ?? []) as unknown[])]);
  if (typeof changed === "string") return { ok: false, message: changed };
  const text = `${JSON.stringify({ ...file.file, version: LAUNCH_SETUPS_VERSION, configurations: changed }, null, 2)}\n`;
  const written = await fs.write(LAUNCH_SETUPS_PATH, utf8Encode(text));
  return written.ok ? { ok: true } : { ok: false, message: `${LAUNCH_SETUPS_PATH} could not be saved: ${written.error.message}` };
}

const named = (entry: unknown, name: string): boolean => isObject(entry) && entry.name === name;

/**
 * Save a setup (D8.7). With `replacing`, the entry of that name is changed in place (and may be renamed); otherwise the
 * setup is added last. A name another entry already has is refused.
 */
export function saveLaunchSetup(fs: Pick<FileSystemService, "read" | "write">, setup: LaunchSetup, replacing?: string): Promise<LaunchSetupsWrite> {
  return rewrite(fs, (entries) => {
    if (setup.name.trim() === "") return "A setup needs a name.";
    const problem = entryProblem(entryOf(setup, null));
    if (problem !== null) return problem;
    const at = replacing === undefined ? -1 : entries.findIndex((entry) => named(entry, replacing));
    if (replacing !== undefined && at === -1) return `There is no setup named "${replacing}".`;
    if (entries.some((entry, index) => index !== at && named(entry, setup.name))) return `Another setup is already named "${setup.name}".`;
    if (at === -1) return [...entries, entryOf(setup, null)];
    const next = [...entries];
    next[at] = entryOf(setup, entries[at] as Json);
    return next;
  });
}

/** Delete the setup named `name` (D8.7); the others keep their order. */
export function deleteLaunchSetup(fs: Pick<FileSystemService, "read" | "write">, name: string): Promise<LaunchSetupsWrite> {
  return rewrite(fs, (entries) => {
    const at = entries.findIndex((entry) => named(entry, name));
    return at === -1 ? `There is no setup named "${name}".` : entries.filter((_, index) => index !== at);
  });
}

/** The launch a setup makes, with D8.7's defaults: the open game's main file and folder, seed `0`, fixture id = name. */
export function launchOfSetup(setup: LaunchSetup, open: { readonly main: string; readonly projectFolder: string }): Launch {
  const base = { main: setup.main ?? open.main, projectFolder: setup.projectFolder ?? open.projectFolder, seed: setup.seed ?? 0 };
  if (setup.kind === "board") return { ...base, kind: "board", start: { ...setup.start }, party: [...setup.party], expectedFiles: null };
  if (setup.kind === "program") return { ...base, kind: "program", program: setup.program, fixture: { ...setup.fixture, id: setup.fixture.id ?? setup.name, party: [...setup.fixture.party] } };
  return { ...base, kind: "game" };
}
