import {
  ASSET_FOLDERS,
  DEFAULT_MOVEMENT_SCAN_CODES,
  createEmptyBoard,
  createEmptyCharacter,
  createEmptyMainFile,
  foldPath,
  writeBoard,
  writeCharacter,
  writeMainFile,
  type AssetKind,
  type Board,
  type Character,
  type MainFile,
} from "@tk-reawakened/core";
import type { FileSystemService } from "@tk-reawakened/platform-services";
import { reservedFolder, unusableName } from "./reserved-folders.ts";

/**
 * Creating a project (T-04, `docs/spec/formats/packaging-and-paths.md#new-project`): a game name, a main file, the 14 reserved
 * folders and, only when the author asks for them, starter contents. The plan is made first and is a pure value (nothing
 * is read or written); creating it compares every path with the destination, writes nothing that would replace a file, and
 * writes the main file last (ADR 0022 D4.2) so a failure never leaves a main file that points at missing starter files.
 */

/** The most characters a game name can have. */
export const NEW_PROJECT_MAX_NAME = 100;

/** The main file's folder inside the project (`docs/spec/formats/packaging-and-paths.md#new-project`). */
export const MAIN_FOLDER = "Main";

const ASSET_KINDS = Object.keys(ASSET_FOLDERS) as AssetKind[];

/** One thing the author may ask to have copied in. `unavailable` is a reason, or `null` when the item can be chosen. */
export interface StarterItem {
  readonly id: string;
  /** The item's name in the wizard. */
  readonly label: string;
  /** What it is, in plain words. */
  readonly description: string;
  /** What choosing it writes and stores, as a sentence; `Nothing is copied` when it only stores a name. */
  readonly writes: string;
  /** Who made the material and under which licence; the evidence that it may be redistributed. */
  readonly provenance: string;
  /** Why the item cannot be chosen, or `null` when it can. An unavailable item writes nothing and is never replaced. */
  readonly unavailable: string | null;
}

/** What choosing a starter item adds to the project. */
export interface StarterContribution {
  /** Files below the project root, by project-relative path with `/`. */
  readonly files: readonly { readonly path: string; readonly bytes: Uint8Array }[];
  /** Main-file fields the item sets. */
  readonly main: Partial<Pick<MainFile, "startupPrg" | "initBoard" | "initChar" | "menuPlugin" | "fightPlugin">>;
}

/** An item and, when it is available, how it contributes. */
export interface StarterDefinition extends StarterItem {
  readonly contribute: (() => StarterContribution) | null;
}

/** Plain ASCII, so each character is its own byte in the Windows-1252 text a program is stored as. */
const START_PROGRAM = [
  "// Start-up program: runs once before the first board.",
  'mwin("Welcome to your new game!")',
  "wait()",
  "mwincls()",
  "",
].join("\r\n");

function writeOrThrow(label: string, written: { readonly ok: true; readonly value: Uint8Array } | { readonly ok: false; readonly error: { readonly message: string } }): Uint8Array {
  if (!written.ok) throw new Error(`The starter ${label} could not be written: ${written.error.message}`);
  return written.value;
}

/** The 20 by 15 board with two layers and no tiles that the board creator's defaults give. */
function startBoard(): Board {
  const base = createEmptyBoard();
  const cells = 20 * 15 * 2;
  return {
    ...base,
    sizeX: 20,
    sizeY: 15,
    sizeL: 2,
    coordType: 0,
    tileMatrix: new Array<number>(cells).fill(0),
    tileRuns: [{ lutIndex: 0, count: cells, marker: true }],
    layerTitles: ["", "", ""],
  };
}

/** A character at the newest minor with no graphics: eight empty movement and idle animations and six empty stances. */
function startCharacter(): Character {
  const base = createEmptyCharacter();
  return {
    ...base,
    minor: 8,
    name: "Hero",
    stats: { ...base.stats, hp: 10, maxHp: 10, level: 1 },
    movementAnimations: new Array<string>(8).fill(""),
    battleStances: new Array<string>(6).fill(""),
    idleAnimations: new Array<string>(8).fill(""),
    idleTime: 3,
    speed: 0.05,
    customStances: [],
    vectorBases: [],
  };
}

const NO_MUSIC = "No rights-cleared music is shipped; the media/soundfonts folder holds instruments, not songs.";

/** Every item the wizard lists, available or not, in the order it is shown and written. */
export const STARTER_DEFINITIONS: readonly StarterDefinition[] = [
  {
    id: "start-program",
    label: "Start-up program",
    description: "A short program that shows a welcome message when the game starts.",
    writes: "Prg/start.prg, and the main file's start-up program is start.prg.",
    provenance: "Written for this project; MIT, like the repository.",
    unavailable: null,
    contribute: () => ({ files: [{ path: `${ASSET_FOLDERS.programs}/start.prg`, bytes: Uint8Array.from(START_PROGRAM, (character) => character.charCodeAt(0)) }], main: { startupPrg: "start.prg" } }),
  },
  {
    id: "start-board",
    label: "Empty start board",
    description: "A blank 20 by 15 board with two layers, no tiles and no background, for the game to begin on.",
    writes: "Boards/start.brd, and the main file's first board is start.brd.",
    provenance: "Generated by the editor's board writer; it contains no artwork.",
    unavailable: null,
    contribute: () => ({ files: [{ path: `${ASSET_FOLDERS.boards}/start.brd`, bytes: writeOrThrow("board", writeBoard(startBoard())) }], main: { initBoard: "start.brd" } }),
  },
  {
    id: "start-character",
    label: "Empty first character",
    description: "A character named Hero with starting health and level but no graphics, for the player to control.",
    writes: "Chrs/start.tem, and the main file's first character is start.tem.",
    provenance: "Generated by the editor's character writer; it contains no artwork.",
    unavailable: null,
    contribute: () => ({ files: [{ path: `${ASSET_FOLDERS.characters}/start.tem`, bytes: writeOrThrow("character", writeCharacter(startCharacter())) }], main: { initChar: "start.tem" } }),
  },
  {
    id: "builtin-menu-battle",
    label: "Built-in menu and battle",
    description: "Use the engine's own menu and battle systems.",
    writes: "Nothing is copied; the main file names tk3menu.dll and tk3fight.dll, which the engine maps to its built-in packages.",
    provenance: "The stock_menu and stock_battle packages in this repository's stock folder; MIT.",
    unavailable: null,
    contribute: () => ({ files: [], main: { menuPlugin: "tk3menu.dll", fightPlugin: "tk3fight.dll" } }),
  },
  {
    id: "tiles",
    label: "Default tiles",
    description: "A starter tileset for drawing boards.",
    writes: "Nothing.",
    provenance: "None: no rights-cleared tile art is shipped, and legacy tile sets are not assumed redistributable.",
    unavailable: "No rights-cleared tile art is shipped yet. Make tiles in the tile editor, or import your own.",
    contribute: null,
  },
  {
    id: "system-programs",
    label: "System programs",
    description: "Ready-made game-over and system programs.",
    writes: "Nothing.",
    provenance: "None: only the built-in menu and battle packages are rights-cleared.",
    unavailable: "No rights-cleared system programs are shipped beyond the built-in menu and battle. Write your own in Prg.",
    contribute: null,
  },
  {
    id: "music",
    label: "Music pack",
    description: "Songs and sound effects for the game.",
    writes: "Nothing.",
    provenance: "None: no music is shipped.",
    unavailable: NO_MUSIC,
    contribute: null,
  },
];

/** The catalogue as data for a wizard: availability and provenance without the means to build. */
export const STARTER_ITEMS: readonly StarterItem[] = STARTER_DEFINITIONS.map(({ contribute: _contribute, ...item }) => item);

export interface NewProjectSettings {
  /** The game's title, stored in the main file. */
  readonly gameName: string;
  /** The main file's name inside `Main/`, with or without `.gam`. */
  readonly mainFile: string;
  /** The ids of the starter items to copy in; none by default. */
  readonly starters: readonly string[];
}

export const DEFAULT_NEW_PROJECT: NewProjectSettings = { gameName: "", mainFile: "", starters: [] };

export interface NewProjectProblem {
  readonly field: keyof NewProjectSettings;
  readonly message: string;
}

/** The game name with `\`, `/`, `:`, space and `.` removed: the project folder name the 3.1 editor used. */
export function folderSafeName(name: string): string {
  return name.replace(/[\\/: .]/g, "");
}

/** The main file name suggested for a game name: its folder-safe form with `.gam`, or `""` when that is empty. */
export function suggestedMainFile(gameName: string): string {
  const safe = folderSafeName(gameName.trim());
  return safe === "" ? "" : `${safe}.gam`;
}

/** The main file's name as stored: `.gam` is added when it is missing. */
export function mainFileName(input: string): string {
  const trimmed = input.trim();
  return /\.gam$/i.test(trimmed) ? trimmed : `${trimmed}.gam`;
}

const PORTABLE_BAD = /[<>:"|?*\u0000-\u001f]/;

/** Every reason these settings cannot make a project, each on the field to blame. Empty when they can. */
export function validateNewProject(settings: NewProjectSettings, definitions: readonly StarterDefinition[] = STARTER_DEFINITIONS): readonly NewProjectProblem[] {
  const problems: NewProjectProblem[] = [];
  const name = settings.gameName.trim();
  if (name === "") problems.push({ field: "gameName", message: "Give the game a name." });
  else if (name.length > NEW_PROJECT_MAX_NAME) problems.push({ field: "gameName", message: `A game name has at most ${NEW_PROJECT_MAX_NAME} characters.` });
  else if (/[\u0000-\u001f]/.test(name)) problems.push({ field: "gameName", message: "A game name is one line of text." });
  else if (folderSafeName(name) === "") problems.push({ field: "gameName", message: "The name needs at least one character other than \\ / : . and space, because the project folder name is made from it." });

  const file = mainFileName(settings.mainFile);
  const stem = file.slice(0, -".gam".length);
  const unusable = settings.mainFile.trim() === "" ? "Give the main file a name." : unusableName(file);
  if (unusable !== null) problems.push({ field: "mainFile", message: unusable });
  else if (stem.trim() === "" || stem.startsWith(" ")) problems.push({ field: "mainFile", message: "The main file needs a name before .gam." });
  else if (PORTABLE_BAD.test(file) || /[ .]$/.test(stem)) problems.push({ field: "mainFile", message: 'The main file name cannot hold < > : " | ? * or a control character, and cannot end in a space or a dot.' });

  const seen = new Set<string>();
  for (const id of settings.starters) {
    const item = definitions.find((candidate) => candidate.id === id);
    if (item === undefined) problems.push({ field: "starters", message: `"${id}" is not a starter item.` });
    else if (item.unavailable !== null || item.contribute === null) problems.push({ field: "starters", message: `${item.label} is not available: ${item.unavailable ?? "it has no material to copy."}` });
    else if (seen.has(id)) problems.push({ field: "starters", message: `${item.label} is chosen twice.` });
    seen.add(id);
  }
  return problems;
}

export interface PlannedFile {
  /** The project-relative path, with `/`. */
  readonly path: string;
  readonly bytes: Uint8Array;
  /** The main file is written last. */
  readonly role: "starter" | "main";
}

/** What creating the project will do, before anything is read or written. */
export interface NewProjectPlan {
  /** The 14 reserved folders, in the order the spec lists them, then `Main`: all project-relative. */
  readonly folders: readonly string[];
  /** The files to write, in order: starter files, then the main file. */
  readonly files: readonly PlannedFile[];
  /** The main file's project-relative path. */
  readonly mainPath: string;
  /** The `Game/<folder-safe name>` folder that must not exist, because a host would read the type folders from it. */
  readonly reservedGameFolder: string;
}

export type PlanResult = { readonly ok: true; readonly plan: NewProjectPlan } | { readonly ok: false; readonly problems: readonly NewProjectProblem[] };

/** The main file of a project: minor 9, the template fields of `docs/spec/formats/packaging-and-paths.md#new-project`, and `contributions`. */
function buildMainFile(settings: NewProjectSettings, contributions: readonly StarterContribution[]): MainFile {
  const base = createEmptyMainFile();
  const fields = Object.assign({}, ...contributions.map((contribution) => contribution.main)) as StarterContribution["main"];
  return {
    ...base,
    minor: 9,
    registrationFlag: 1,
    projectPath: `Game\\${folderSafeName(settings.gameName.trim())}\\`,
    gameTitle: settings.gameName.trim(),
    screenType: 1,
    languageFile: "0english.lng",
    menuKey: 13,
    activationKey: 32,
    fightType: 0,
    chances: 20,
    mouseCursor: "TK DEFAULT",
    transparent: { r: 255, g: 0, b: 0 },
    pathfindHeuristic: 2,
    pathColor: { r: 255, g: 255, b: 255 },
    movementControls: 5,
    movementScanCodes: [...DEFAULT_MOVEMENT_SCAN_CODES],
    ...fields,
  };
}

/** Plan the project: the folders, the starter files and the main file. Pure; a problem is returned, never thrown for a bad answer. */
export function planNewProject(settings: NewProjectSettings, definitions: readonly StarterDefinition[] = STARTER_DEFINITIONS): PlanResult {
  const problems = validateNewProject(settings, definitions);
  if (problems.length > 0) return { ok: false, problems };
  const chosen = definitions.filter((definition) => settings.starters.includes(definition.id));
  const contributions = chosen.map((definition) => definition.contribute!());
  const folders = [...ASSET_KINDS.map((kind) => reservedFolder({ projectFolder: "" }, kind)), MAIN_FOLDER];
  const files: PlannedFile[] = contributions.flatMap((contribution) => contribution.files.map((file): PlannedFile => ({ ...file, role: "starter" })));
  const duplicate = files.find((file, index) => files.findIndex((other) => foldPath(other.path) === foldPath(file.path)) !== index);
  if (duplicate !== undefined) return { ok: false, problems: [{ field: "starters", message: `Two starter items both write ${duplicate.path}.` }] };
  const mainPath = `${MAIN_FOLDER}/${mainFileName(settings.mainFile)}`;
  const written = writeMainFile(buildMainFile(settings, contributions));
  if (!written.ok) return { ok: false, problems: [{ field: "gameName", message: `The main file could not be written: ${written.error.message}` }] };
  files.push({ path: mainPath, bytes: written.value, role: "main" });
  return { ok: true, plan: { folders, files, mainPath, reservedGameFolder: `Game/${folderSafeName(settings.gameName.trim())}` } };
}

/** The part of the file system a project is made with: the destination folder is its root. */
export type NewProjectStorage = Pick<FileSystemService, "list" | "read" | "write" | "createFolder" | "stat" | "delete">;

/** One path the destination already holds that creating the project would have to replace. */
export interface ProjectConflict {
  readonly path: string;
  readonly message: string;
}

export type CreateProjectResult =
  | {
      readonly ok: true;
      /** The main file's path, as it is spelled in the destination. */
      readonly mainPath: string;
      /** Files written now. */
      readonly written: readonly string[];
      /** Files the destination already held with exactly these bytes, left alone. */
      readonly present: readonly string[];
    }
  | { readonly ok: false; readonly reason: "invalid"; readonly problems: readonly NewProjectProblem[]; readonly message: string }
  | { readonly ok: false; readonly reason: "conflicts"; readonly conflicts: readonly ProjectConflict[]; readonly message: string }
  | {
      readonly ok: false;
      readonly reason: "failed";
      readonly message: string;
      /** What reached the destination before the failure; it is kept (ADR 0022 D4.2). */
      readonly written: readonly string[];
      readonly present: readonly string[];
      /** What was not written, the failed item first. */
      readonly pending: readonly string[];
    };

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

interface Listing {
  /** Folded name to the entry as stored. */
  readonly entries: Map<string, { readonly name: string; readonly kind: "file" | "directory" | "link" }>;
}

/**
 * Create the project in the destination (T-04). Everything is compared with the destination first: nothing is written
 * when any path would replace a file or sit on something that is not a folder, and the answer lists each one. Folders are
 * then made, starter files written, and the main file last. A file that already holds exactly the bytes to write is left
 * alone, so running this again after a failure finishes the project. An existing file is never replaced, an empty one
 * included; the empty file a *failed* write leaves behind is the wizard's own artefact and is removed. Names are compared
 * ASCII-folded and an existing folder keeps its own spelling.
 */
export async function createNewProject(storage: NewProjectStorage, settings: NewProjectSettings, definitions: readonly StarterDefinition[] = STARTER_DEFINITIONS): Promise<CreateProjectResult> {
  const planned = planNewProject(settings, definitions);
  if (!planned.ok) return { ok: false, reason: "invalid", problems: planned.problems, message: planned.problems[0]!.message };
  const { plan } = planned;

  const listings = new Map<string, Listing>();
  const unreadable = (path: string, message: string): CreateProjectResult => ({ ok: false, reason: "failed", message: `Could not read ${path === "" ? "the destination folder" : path}: ${message}`, written: [], present: [], pending: plan.files.map((file) => file.path) });
  const listing = async (folder: string): Promise<Listing | { readonly failure: string }> => {
    const key = foldPath(folder);
    const known = listings.get(key);
    if (known !== undefined) return known;
    const listed = await storage.list(folder);
    const entries: Listing["entries"] = new Map();
    if (!listed.ok) {
      // The destination itself must exist; a missing reserved folder is simply empty.
      if (folder === "" || listed.error.code !== "not-found") return { failure: listed.error.message };
    } else {
      for (const entry of listed.value) entries.set(foldPath(entry.name), entry);
    }
    const made = { entries };
    listings.set(key, made);
    return made;
  };

  const root = await listing("");
  if ("failure" in root) return unreadable("", root.failure);
  const conflicts: ProjectConflict[] = [];
  const reserved = root.entries.get(foldPath("Game"));
  if (reserved !== undefined && reserved.kind === "directory") {
    const inner = await listing(reserved.name);
    if ("failure" in inner) return unreadable(reserved.name, inner.failure);
    const clash = inner.entries.get(foldPath(plan.reservedGameFolder.slice("Game/".length)));
    if (clash !== undefined) conflicts.push({ path: `${reserved.name}/${clash.name}`, message: `${reserved.name}/${clash.name} exists, and the editor would read this project's folders from it instead of from the project root.` });
  }

  /** The folder spelled the way the destination already spells it. */
  const folderOf = (folder: string): { readonly name: string; readonly exists: boolean } => {
    const existing = root.entries.get(foldPath(folder));
    return existing !== undefined && existing.kind === "directory" ? { name: existing.name, exists: true } : { name: folder, exists: false };
  };
  const toMake: string[] = [];
  for (const folder of plan.folders) {
    const existing = root.entries.get(foldPath(folder));
    if (existing === undefined) toMake.push(folder);
    else if (existing.kind !== "directory") conflicts.push({ path: existing.name, message: `${existing.name} is a ${existing.kind === "file" ? "file" : "link"}, and the project needs a folder of that name.` });
  }

  const actions: { readonly file: PlannedFile; readonly path: string; readonly present: boolean }[] = [];
  for (const file of plan.files) {
    const slash = file.path.indexOf("/");
    const folder = folderOf(file.path.slice(0, slash));
    const name = file.path.slice(slash + 1);
    let path = `${folder.name}/${name}`;
    let present = false;
    if (folder.exists) {
      const inside = await listing(folder.name);
      if ("failure" in inside) return unreadable(folder.name, inside.failure);
      const existing = inside.entries.get(foldPath(name));
      if (existing !== undefined) {
        path = `${folder.name}/${existing.name}`;
        if (existing.kind !== "file") {
          conflicts.push({ path, message: `${path} is a ${existing.kind === "directory" ? "folder" : "link"}, and the project needs a file of that name.` });
        } else {
          const read = await storage.read(path);
          if (!read.ok) return unreadable(path, read.error.message);
          // Every existing file is kept, an empty one included: it is the author's data, not the wizard's to replace.
          if (sameBytes(read.value, file.bytes)) present = true;
          else if (read.value.length === 0) conflicts.push({ path, message: `${path} already exists and is empty; the editor never replaces an existing file. Choose another folder or name, or remove it yourself.` });
          else conflicts.push({ path, message: `${path} already exists with different content; the editor never replaces it. Choose another folder or name.` });
        }
      }
    }
    actions.push({ file, path, present });
  }
  if (conflicts.length > 0) {
    const first = conflicts[0]!;
    return { ok: false, reason: "conflicts", conflicts, message: conflicts.length === 1 ? `${first.message} Nothing was written.` : `${conflicts.length} paths in the destination would be replaced, starting with: ${first.message} Nothing was written.` };
  }

  const written: string[] = [];
  const present = actions.filter((action) => action.present).map((action) => action.path);
  const failed = (message: string, pending: readonly string[]): CreateProjectResult => ({ ok: false, reason: "failed", message, written, present, pending });
  const todo = actions.filter((action) => !action.present);
  for (const folder of toMake) {
    const made = await storage.createFolder(folder);
    if (!made.ok) return failed(`Could not create the folder ${folder}: ${made.error.message} ${describeProgress(written, present, todo.map((action) => action.path))}`, todo.map((action) => action.path));
  }
  for (const [index, action] of todo.entries()) {
    const result = await storage.write(action.path, action.file.bytes);
    if (!result.ok) {
      const pending = todo.slice(index).map((item) => item.path);
      const artefact = await removeEmptyArtefact(storage, action.path);
      const reason = `${result.error.message.replace(/\.$/, "")}.${artefact === "" ? "" : ` ${artefact}`}`;
      return failed(`Could not write ${action.path}: ${reason} ${describeProgress(written, present, pending)}`, pending);
    }
    written.push(action.path);
  }
  const main = actions[actions.length - 1]!;
  return { ok: true, mainPath: main.path, written, present };
}

/**
 * Remove the empty file a failed write may have left, and say so. The preflight found no file at `path`, so a file there
 * now that is still empty is this write's own artefact (a browser creates the file before it commits any content);
 * anything with content in it is left exactly as it is, and a host that cannot remove it says nothing.
 */
async function removeEmptyArtefact(storage: NewProjectStorage, path: string): Promise<string> {
  const stat = await storage.stat(path);
  if (!stat.ok || stat.value.kind !== "file" || stat.value.size !== 0) return "";
  const removed = await storage.delete(path);
  return removed.ok ? `The empty file it left at ${path} was removed.` : "";
}

/** A sentence that says what a failed creation left behind and how to finish it. */
function describeProgress(written: readonly string[], present: readonly string[], pending: readonly string[]): string {
  const parts = [`Written: ${written.length === 0 ? "nothing" : written.join(", ")}.`];
  if (present.length > 0) parts.push(`Already present and left alone: ${present.join(", ")}.`);
  parts.push(`Not written: ${pending.join(", ")}.`, "Nothing that existed before was changed; run the wizard again with the same answers to finish.");
  return parts.join(" ");
}
