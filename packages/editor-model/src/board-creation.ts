import {
  BOARD_MAX_CELLS,
  BinaryReader,
  boardGrid,
  boardPixelSize,
  coordLayout,
  createEmptyBoard,
  foldPath,
  readBoard,
  writeBoard,
  type Board,
  type BoardTileRun,
  type CoordLayout,
} from "@tk-reawakened/core";
import type { FileSystemService } from "@tk-reawakened/platform-services";
import type { Preferences, PreferencesSnapshot } from "./preferences.ts";
import { reservedFolder, unusableName, type ProjectLayout } from "./reserved-folders.ts";

/**
 * Creating a board (T-20, `docs/editor-features.md` "New board"): a blank board or one made from an existing board as a
 * template, in a coordinate system, with a size, a layer count and a background. The bytes are the board writer's, so a
 * new board is the same file every other board is, and it is created only where no file is, never over one.
 */

export type BoardCoordSystem = "2d" | "iso-stacked" | "iso-rotated";

export const BOARD_COORD_SYSTEMS: readonly { readonly value: BoardCoordSystem; readonly label: string }[] = [
  { value: "2d", label: "Top-down (2D)" },
  { value: "iso-stacked", label: "Isometric, stacked" },
  { value: "iso-rotated", label: "Isometric, rotated" },
];

/** The most tiles across or down, and the most layers, a new board is given. */
export const NEW_BOARD_MAX_SIZE = 1000;
export const NEW_BOARD_MAX_LAYERS = 64;

export interface NewBoardSettings {
  /** The file's name inside the boards folder, with or without `.brd`. No folder separators. */
  readonly name: string;
  readonly coordSystem: BoardCoordSystem;
  /** The "Use pixel coordinates" flag (bit 4 of `coordType`); it changes no tile geometry (`docs/spec/formats/board.md#coordinates`). */
  readonly pixelCoordinates: boolean;
  readonly width: number;
  readonly height: number;
  readonly layers: number;
  /** The background image reference, or `""` for none. */
  readonly backgroundImage: string;
  /** The project-relative path of a board to copy its layout, titles, background and ambience from, or `null` for a blank board. */
  readonly template: string | null;
}

export const DEFAULT_NEW_BOARD: NewBoardSettings = {
  name: "",
  coordSystem: "2d",
  pixelCoordinates: false,
  width: 20,
  height: 15,
  layers: 2,
  backgroundImage: "",
  template: null,
};

export interface NewBoardProblem {
  readonly field: keyof NewBoardSettings;
  readonly message: string;
}

/** The `coordType` of a coordinate system: 0 top-down, 1 iso-stacked, 2 iso-rotated, plus 4 for pixel coordinates. */
export function coordTypeOf(settings: Pick<NewBoardSettings, "coordSystem" | "pixelCoordinates">): number {
  const base = settings.coordSystem === "iso-stacked" ? 1 : settings.coordSystem === "iso-rotated" ? 2 : 0;
  return base | (settings.pixelCoordinates ? 4 : 0);
}

/** The coordinate system a `coordType` names (the pixel flag is ignored). */
export function coordSystemOf(coordType: number): BoardCoordSystem {
  const layout: CoordLayout = coordLayout(coordType);
  return layout;
}

/** The board file name for `name`: a `.brd` extension is added when it is missing. */
export function boardFileName(name: string): string {
  const trimmed = name.trim();
  return /\.brd$/i.test(trimmed) ? trimmed : `${trimmed}.brd`;
}

/** What the dialog shows beside the size: the board's size in pixels and how many cells every layer stores. */
export function newBoardSummary(settings: Pick<NewBoardSettings, "coordSystem" | "width" | "height" | "layers">): {
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly cells: number;
} {
  const grid = boardGrid(settings.width, settings.height, coordTypeOf({ coordSystem: settings.coordSystem, pixelCoordinates: false }));
  const size = boardPixelSize(settings.coordSystem, settings.width, settings.height);
  return { pixelWidth: size.width, pixelHeight: size.height, cells: grid.width * grid.height * settings.layers };
}

/** Every reason these settings cannot make a board, each on the field to blame. Empty when they can. */
export function validateNewBoard(settings: NewBoardSettings): readonly NewBoardProblem[] {
  const problems: NewBoardProblem[] = [];
  const whole = (field: "width" | "height" | "layers", label: string, max: number): void => {
    const value = settings[field];
    if (!Number.isInteger(value) || value < 1 || value > max) problems.push({ field, message: `${label} must be a whole number from 1 to ${max}.` });
  };
  const unusable = settings.name.trim() === "" ? "Give the board a name." : unusableName(boardFileName(settings.name));
  if (unusable !== null) problems.push({ field: "name", message: unusable });
  whole("width", "The width", NEW_BOARD_MAX_SIZE);
  whole("height", "The height", NEW_BOARD_MAX_SIZE);
  whole("layers", "The number of layers", NEW_BOARD_MAX_LAYERS);
  if (problems.every((problem) => problem.field === "name")) {
    const { cells } = newBoardSummary(settings);
    if (cells > BOARD_MAX_CELLS) {
      problems.push({ field: "width", message: `That is ${cells} stored cells; a board holds at most ${BOARD_MAX_CELLS}. Make it smaller or use fewer layers.` });
    }
  }
  if (/[\u0000-\u001f]/.test(settings.backgroundImage)) problems.push({ field: "backgroundImage", message: "Use a single line for the background image." });
  return problems;
}

/** The tile runs of a board with every cell empty: runs of up to 32768 cells, the most one run marker holds. */
function emptyRuns(cells: number): BoardTileRun[] {
  const runs: BoardTileRun[] = [];
  for (let left = cells; left > 0; left -= 32_768) {
    const count = Math.min(left, 32_768);
    runs.push({ lutIndex: 0, count, marker: count > 1 });
  }
  return runs;
}

/**
 * The bytes of a new board. A template contributes its layer titles, background (image, how it is drawn, colour and
 * music) and ambient light; its tiles, vectors, programs, sprites and images are not copied. A background named in
 * `settings` replaces the template's.
 */
export function buildNewBoard(settings: NewBoardSettings, template: Board | null = null): { readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false; readonly message: string } {
  const problems = validateNewBoard({ ...settings, name: settings.name === "" ? "new" : settings.name });
  const blocking = problems.find((problem) => problem.field !== "name");
  if (blocking !== undefined) return { ok: false, message: blocking.message };
  const coordType = coordTypeOf(settings);
  const grid = boardGrid(settings.width, settings.height, coordType);
  const cells = grid.width * grid.height * settings.layers;
  const base = createEmptyBoard();
  const titles = Array.from({ length: settings.layers + 1 }, (_, index) => template?.layerTitles[index] ?? "");
  const properties = template === null
    ? base.properties
    : {
        ...base.properties,
        backgroundImage: template.properties.backgroundImage,
        backgroundDrawType: template.properties.backgroundDrawType,
        backgroundColour: template.properties.backgroundColour,
        backgroundMusic: template.properties.backgroundMusic,
        ambient: template.properties.ambient,
      };
  const board: Board = {
    ...base,
    sizeX: settings.width,
    sizeY: settings.height,
    sizeL: settings.layers,
    coordType,
    tileMatrix: new Array<number>(cells).fill(0),
    tileRuns: emptyRuns(cells),
    layerTitles: titles,
    properties: settings.backgroundImage === "" ? properties : { ...properties, backgroundImage: settings.backgroundImage },
  };
  const written = writeBoard(board);
  if (!written.ok) return { ok: false, message: written.error.message };
  return { ok: true, bytes: written.value };
}

export type CreateBoardResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: "invalid" | "exists" | "template" | "failed"; readonly message: string };

export type NewBoardStorage = Pick<FileSystemService, "list" | "read" | "write">;

/** The names of the files in the boards folder, folded for comparison; empty when the folder does not exist yet. */
async function boardNames(fs: NewBoardStorage, folder: string): Promise<{ readonly names: Set<string> } | { readonly failure: string }> {
  const listed = await fs.list(folder);
  if (!listed.ok) return listed.error.code === "not-found" ? { names: new Set() } : { failure: `Could not read ${folder}: ${listed.error.message}` };
  return { names: new Set(listed.value.map((entry) => foldPath(entry.name))) };
}

/**
 * A name for a board that is not taken: `untitled`, then `untitled 2`, `untitled 3`, for creating a board without the
 * dialog ("Ask before creating a board" off).
 */
export async function uniqueBoardName(fs: NewBoardStorage, layout: ProjectLayout): Promise<string> {
  const taken = await boardNames(fs, reservedFolder(layout, "boards"));
  const names = "names" in taken ? taken.names : new Set<string>();
  let counter = 1;
  for (;;) {
    const candidate = counter === 1 ? "untitled" : `untitled ${counter}`;
    if (!names.has(foldPath(`${candidate}.brd`))) return candidate;
    counter += 1;
  }
}

/**
 * Create the board in the project's boards folder (T-20). Nothing is written when the settings are invalid, the template
 * cannot be read as a board, or a file of that name (compared without regard to A-Z case) already exists.
 */
export async function createBoardFile(fs: NewBoardStorage, layout: ProjectLayout, settings: NewBoardSettings): Promise<CreateBoardResult> {
  const problems = validateNewBoard(settings);
  if (problems.length > 0) return { ok: false, reason: "invalid", message: problems[0]!.message };
  let template: Board | null = null;
  if (settings.template !== null) {
    const read = await fs.read(settings.template);
    if (!read.ok) return { ok: false, reason: "template", message: `Could not read the template ${settings.template}: ${read.error.message}` };
    const parsed = readBoard(new BinaryReader(read.value, settings.template));
    if (!parsed.ok) return { ok: false, reason: "template", message: `${settings.template} is not a board this editor reads: ${parsed.error.message}` };
    template = parsed.value;
  }
  const built = buildNewBoard(settings, template);
  if (!built.ok) return { ok: false, reason: "invalid", message: built.message };
  const folder = reservedFolder(layout, "boards");
  const name = boardFileName(settings.name);
  const taken = await boardNames(fs, folder);
  if ("failure" in taken) return { ok: false, reason: "failed", message: taken.failure };
  if (taken.names.has(foldPath(name))) {
    return { ok: false, reason: "exists", message: `${folder}/${name} already exists (names are compared without regard to A-Z case). Nothing was created; choose another name.` };
  }
  const path = `${folder}/${name}`;
  const written = await fs.write(path, built.bytes);
  if (!written.ok) return { ok: false, reason: "failed", message: `Could not create ${path}: ${written.error.message}` };
  return { ok: true, path };
}

/** What choosing a template fills the dialog's fields with: the template's own layout, size, layer count and background. */
export async function readBoardTemplate(
  fs: Pick<FileSystemService, "read">,
  path: string,
): Promise<{ readonly ok: true; readonly settings: Pick<NewBoardSettings, "coordSystem" | "pixelCoordinates" | "width" | "height" | "layers" | "backgroundImage"> } | { readonly ok: false; readonly message: string }> {
  const read = await fs.read(path);
  if (!read.ok) return { ok: false, message: `Could not read the template ${path}: ${read.error.message}` };
  const parsed = readBoard(new BinaryReader(read.value, path));
  if (!parsed.ok) return { ok: false, message: `${path} is not a board this editor reads: ${parsed.error.message}` };
  const board = parsed.value;
  return {
    ok: true,
    settings: {
      coordSystem: coordSystemOf(board.coordType),
      pixelCoordinates: (board.coordType & 4) !== 0,
      width: board.sizeX,
      height: board.sizeY,
      layers: board.sizeL,
      backgroundImage: board.properties.backgroundImage,
    },
  };
}

/** The new-board preferences (T-20 "remembers last settings"; T-33 "show the new-board dialog"). */
export const NEW_BOARD_PREFERENCE_IDS = {
  coordSystem: "board.new.coordSystem",
  pixelCoordinates: "board.new.pixelCoordinates",
  width: "board.new.width",
  height: "board.new.height",
  layers: "board.new.layers",
} as const;

/** The remembered settings in force (the defaults where none is remembered); the name is left for the caller. */
export function newBoardSettingsFrom(snapshot: PreferencesSnapshot): NewBoardSettings {
  const value = (id: string): unknown => snapshot.rows.find((row) => row.entry.id === id)?.effective;
  const coord = value(NEW_BOARD_PREFERENCE_IDS.coordSystem);
  const number = (id: string, fallback: number): number => {
    const stored = value(id);
    return typeof stored === "number" ? stored : fallback;
  };
  return {
    ...DEFAULT_NEW_BOARD,
    coordSystem: coord === "iso-stacked" || coord === "iso-rotated" ? coord : "2d",
    pixelCoordinates: value(NEW_BOARD_PREFERENCE_IDS.pixelCoordinates) === true,
    width: number(NEW_BOARD_PREFERENCE_IDS.width, DEFAULT_NEW_BOARD.width),
    height: number(NEW_BOARD_PREFERENCE_IDS.height, DEFAULT_NEW_BOARD.height),
    layers: number(NEW_BOARD_PREFERENCE_IDS.layers, DEFAULT_NEW_BOARD.layers),
  };
}

/** Whether the dialog is asked for before a board is created (`board.showNewBoardDialog`). */
export function asksBeforeCreating(snapshot: PreferencesSnapshot): boolean {
  return snapshot.rows.find((row) => row.entry.id === "board.showNewBoardDialog")?.effective !== false;
}

/** Remember the choices of a created board in the user layer. A preference that cannot be saved is reported, not lost silently. */
export async function rememberNewBoard(preferences: Pick<Preferences, "set">, settings: NewBoardSettings): Promise<string | null> {
  const values: readonly (readonly [string, string | number | boolean])[] = [
    [NEW_BOARD_PREFERENCE_IDS.coordSystem, settings.coordSystem],
    [NEW_BOARD_PREFERENCE_IDS.pixelCoordinates, settings.pixelCoordinates],
    [NEW_BOARD_PREFERENCE_IDS.width, settings.width],
    [NEW_BOARD_PREFERENCE_IDS.height, settings.height],
    [NEW_BOARD_PREFERENCE_IDS.layers, settings.layers],
  ];
  const failures: string[] = [];
  for (const [id, value] of values) {
    const saved = await preferences.set(id, "user", value);
    if (!saved.ok) failures.push(saved.reason);
  }
  return failures.length === 0 ? null : `The board was created but your choices were not remembered: ${failures[0]}`;
}
