/**
 * The legacy `.brd` to native scene importer (docs/spec/formats/native-scene.md,
 * "Import: from a board to a scene" and "Disposition of every board field"). It
 * takes the board the vector reader returns, already decoded, and returns a plain
 * scene document; it reads and writes no file (G2), and the scene it returns
 * carries no timestamp and nothing else that changes from run to run.
 *
 * The import is explicit and never an inverse of a build. Every one of the 75
 * documented board fields lands in the place its row names, the values the engine
 * ignores and the cells a run or record carries past the end of a grid included
 * (`legacy`), or the import is refused with a reason and returns no scene.
 * Nothing is clamped, substituted or dropped. It never overwrites: a scene that
 * already stands at the target path is a refusal. The board model keeps each table
 * as a list, so a stored upper bound below -1 (a refusal row of the contract) never
 * reaches this function: the board reader refuses it first.
 *
 * The scene is a plain object in the shape of the contract page, written in its
 * canonical key order (the stamp, `tags`, `metadata`, the core fields in the order
 * of the top-level table, and inside a record the keys in the order its table
 * gives), with maximal runs, floor ids `layer-1`, `layer-2` and so on, no record
 * ids, and every optional key at its default left out. Its type is the shared
 * `Scene` of `@tk-reawakened/native-data`, so an imported scene is the value
 * `writeScene` takes, with no second copy of the model to drift. `threads` and
 * `constants` are always written as stored (row 57 and 59: a stored -1 is `[]`, the
 * editor's one empty entry is `[""]`), the one exception to leaving a default out.
 */

import { BOARD_MAX_CELLS, boardGrid, type Board } from "@tk-reawakened/core";
import { documentId, foldId, SCENE_CONTRACT, SCENE_VERSION, type Scene } from "@tk-reawakened/native-data";

// ------------------------------------------------------------------ the scene document

/**
 * The scene an import makes: a `Scene`, with the keys an import always writes made
 * required. `name`, `placedPacks` and `pluginData` are never written by an import (a
 * `.brd` holds none of them), and every other optional key is present only when its
 * stored value differs from its default.
 */
export type ImportedScene = Scene & {
  readonly tags: readonly string[];
  readonly metadata: { readonly source: string };
  readonly threads: readonly string[];
  readonly constants: readonly string[];
};

// The parts of the shared model this module builds, named from `Scene` itself.
type Element<T> = NonNullable<T> extends readonly (infer Item)[] ? Item : never;
type ImportedSceneFloor = Element<Scene["floors"]>;
type ImportedScenePaletteEntry = Element<Scene["tilePalette"]>;
type ImportedSceneShadingLayer = Element<Scene["shading"]>;
type ImportedSceneLight = Element<Scene["lights"]>;
type ImportedSceneVector = Element<Scene["vectors"]>;
type ImportedSceneTrigger = Element<Scene["triggers"]>;
type ImportedSceneItem = Element<Scene["items"]>;
type ImportedSceneImage = Element<Scene["images"]>;
type ImportedSceneTileRun = Element<ImportedSceneFloor["tiles"]>;
type ImportedSceneTintRun = ImportedSceneShadingLayer["cells"][number];
type ImportedScenePoint = ImportedSceneLight["nodes"][number];
type ImportedSceneColour = ImportedSceneImage["transparent"];
type ImportedSceneCondition = NonNullable<ImportedSceneTrigger["condition"]>;
type ImportedSceneVariablePair = NonNullable<ImportedSceneTrigger["afterRun"]>;
/** The layer a record sits on: exactly one of `floor` and `layer`. */
type LayerRefOf<T> = T extends unknown ? Pick<T, Extract<keyof T, "floor" | "layer">> : never;
type ImportedSceneLayerRef = LayerRefOf<ImportedSceneVector>;

// ------------------------------------------------------------------ findings and result

export type SceneImportSeverity = "refusal" | "warning" | "note";

/**
 * One finding the import reports before anything is written. `field` is the
 * number of the board field row it concerns ("7", "9b", "X5"; "-" for a finding
 * about the call itself) and `path` the place in the scene (or, for a refusal that
 * leaves no place, the board) it concerns.
 */
export interface SceneImportFinding {
  readonly severity: SceneImportSeverity;
  readonly field: string;
  readonly path: string;
  readonly message: string;
}

/** An import that made a scene. */
export interface SceneImportSuccess {
  readonly ok: true;
  readonly scene: ImportedScene;
  /** The project-relative path the scene is to be created at: beside the board, same stem, `.tkrscn`. */
  readonly scenePath: string;
  /** The warnings and notes, in the order the board's fields are read. */
  readonly findings: readonly SceneImportFinding[];
}

/** An import that was refused: nothing is written, and no scene is returned. */
export interface SceneImportRefusal {
  readonly ok: false;
  /** Every finding, at least one a refusal. */
  readonly findings: readonly SceneImportFinding[];
}

export type SceneImportResult = SceneImportSuccess | SceneImportRefusal;

export interface SceneImportOptions {
  /**
   * The board's file name as the caller gives it, case kept (for example
   * `Boards/cottage.brd`). It is recorded unchanged as `metadata.source`, and the
   * scene's path is this name with its `.brd` extension replaced by `.tkrscn`.
   */
  readonly boardName: string;
  /**
   * The project-relative paths of the documents that already exist. Required, so
   * that a caller cannot forget the check: the import never overwrites, and a
   * scene that stands at the target path (compared by the ID fold) is a refusal.
   */
  readonly existingPaths: Iterable<string>;
}

// ------------------------------------------------------------------ small pieces

/** The most cells a final tile marker can carry past the grid: a marker holds 32,768 and at least one is a grid cell. */
const MAX_EXCESS_TILES = 32_767;
/** The most cells a final shading record can carry past the grid: a record holds 32,767 and at least one is a grid cell. */
const MAX_EXCESS_CELLS = 32_766;
const COORD_TYPES = [0, 1, 2, 4, 5, 6];
const PROJECTIONS = ["2d", "iso-stacked", "iso-rotated"] as const;
const LIGHT_TYPES = new Map<number, ImportedSceneLight["type"]>([[0, "ellipse"], [1, "gradient"], [2, "clipped-gradient"]]);
const VECTOR_TYPES = new Map<number, ImportedSceneVector["type"]>([
  [0, "none"],
  [1, "solid"],
  [2, "under"],
  [4, "unidirectional"],
  [8, "stairs"],
  [16, "waypoint"],
]);
const DRAW_TYPES = new Map<number, "parallax" | "stretch" | undefined>([[0, undefined], [1, "parallax"], [2, "stretch"]]);

/**
 * The identity a path is compared by: `\` is `/` (the legacy path rule), empty and `.`
 * parts are dropped (`documentId`, so `./Boards//Cottage.brd` is `Boards/Cottage.brd`),
 * then the ASCII fold. Every no-overwrite comparison goes through it, on both sides.
 */
const fold = (name: string): string => foldId(documentId(name.replaceAll("\\", "/")));

/** `Boards/cottage.brd` is `Boards/cottage.tkrscn`: the same folder, the same stem. Undefined when the name has no `.brd` extension and a stem. */
export function sceneTargetPath(boardName: string): string | undefined {
  const extension = ".brd";
  if (boardName.length <= extension.length || foldId(boardName.slice(-extension.length)) !== extension) return undefined;
  const stem = boardName.slice(0, -extension.length);
  if (stem.endsWith("/") || stem.endsWith("\\")) return undefined;
  return `${stem}.tkrscn`;
}

const floorId = (layer: number): string => `layer-${layer}`;

/** `{ [key]: value }`, or nothing when the value is absent: a key an import writes only when it differs from its default. */
function opt<K extends string, V>(key: K, value: V | undefined): { readonly [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { readonly [P in K]: V });
}

/** The value when it holds any key, otherwise nothing: an optional block whose every key is a default is left out. */
function nonEmpty<T extends object>(value: T): T | undefined {
  return Object.keys(value).length > 0 ? value : undefined;
}

/** A legacy empty string is a key left out. */
const text = (value: string): string | undefined => (value === "" ? undefined : value);

const rgb = (colour: { readonly r: number; readonly g: number; readonly b: number }): ImportedSceneColour => [colour.r, colour.g, colour.b];
const isBlack = (colour: ImportedSceneColour): boolean => colour[0] === 0 && colour[1] === 0 && colour[2] === 0;
const outOfShadeRange = (channel: number): boolean => channel < -255 || channel > 255;

/** RFC 4648 standard base64 with padding. The package has no host, so no `Buffer` or `btoa`. */
function base64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let at = 0; at < bytes.length; at += 3) {
    const a = bytes[at] ?? 0;
    const b = bytes[at + 1];
    const c = bytes[at + 2];
    const word = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += alphabet[(word >> 18) & 63]! + alphabet[(word >> 12) & 63]!;
    out += b === undefined ? "=" : alphabet[(word >> 6) & 63]!;
    out += c === undefined ? "=" : alphabet[word & 63]!;
  }
  return out;
}

// ------------------------------------------------------------------ the import

/**
 * Convert a decoded vector board to a native scene. Every refusal is collected
 * (the import names each value that caused it) and returned with nothing written;
 * otherwise the scene comes back with its warnings and notes. The scene goes to
 * the board's own scene path, and a scene already standing there is a refusal.
 */
export function importBoardToScene(board: Board, options: SceneImportOptions): SceneImportResult {
  return convertBoard(board, options, false);
}

/**
 * The reviewed recovery import (docs/spec/formats/native-scene.md, import rule 7):
 * the same import, run on a `.brd` that was edited outside the editor after the
 * scene built it. It reads the board exactly as `importBoardToScene` does and
 * proposes a scene for the author to review, but never for the scene that exists:
 * the proposal's path is `<stem>.recovered.tkrscn`, or `<stem>.recovered-2.tkrscn`,
 * `-3`, and so on, the first of them no document in `existingPaths` stands at, so
 * no existing file (the board's own scene included) is ever the target. Its
 * findings add one note for each scene-only feature a `.brd` cannot carry, so the
 * author sees what the edited board cannot restore.
 */
export function recoverBoardToScene(board: Board, options: SceneImportOptions): SceneImportResult {
  return convertBoard(board, options, true);
}

/** The scene-only features a `.brd` has no field for (the contract's list U1 to U9), named in a recovery import's notes. */
const SCENE_ONLY_FEATURES: readonly (readonly [field: string, path: string, message: string])[] = [
  ["U1", "floors[].id", "a floor's id and every floor or toFloor reference: the board numbers layers and has no names for them; recovery names the floors layer-1, layer-2 and so on"],
  ["U2", "id", "a record's id (shading, lights, vectors, triggers, items, images): the board identifies a record by slot index only; any id the scene had cannot be restored"],
  ["U3", "vectors[].label", "a vector's label: the board has the script-visible handle only; any label the scene had cannot be restored"],
  ["U4", "floors[].boundarySources", "a floor's boundarySources: the board stores the traced vectors, not the recipe they came from; the recipe cannot be restored"],
  ["U5", "tilePalette[]", "a native tile reference {tile}: the board stores a legacy tile reference and no link to a standalone tile; recovered palette entries are legacy references"],
  ["U6", "placedPacks", "placedPacks and which generated records came from which placement: the board stores the expanded images, cells and vectors, not where they came from"],
  ["U7", "name", "the scene's display name: the board has no name; its file name is its name"],
  ["U8", "tags, metadata", "the scene's tags and metadata: a .brd has no stamp; recovery writes only tags [imported] and metadata.source"],
  ["U9", "pluginData", "plugin blocks: a plugin block exists only on a native contract document and is not carried into a board"],
];

function convertBoard(board: Board, options: SceneImportOptions, recovery: boolean): SceneImportResult {
  const findings: SceneImportFinding[] = [];
  const report = (severity: SceneImportSeverity, field: string, path: string, message: string): void => {
    findings.push({ severity, field, path, message });
  };
  const refuse = (field: string, path: string, message: string): void => report("refusal", field, path, message);
  const warn = (field: string, path: string, message: string): void => report("warning", field, path, message);
  const note = (field: string, path: string, message: string): void => report("note", field, path, message);
  const failed = (): SceneImportResult => ({ ok: false, findings });

  // The call itself: a board name that builds a scene path, and a path nobody stands at. Stops at once.
  const derivedScenePath = sceneTargetPath(options.boardName);
  // The path is the document's identity: legacy `\` separators are `/`, and `./Boards//Cottage.brd` makes `Boards/Cottage.tkrscn`.
  const boardScenePath = derivedScenePath === undefined ? undefined : documentId(derivedScenePath.replaceAll("\\", "/"));
  if (boardScenePath === undefined) {
    refuse("-", "boardName", `"${options.boardName}" is not a .brd file name, so no scene path can be made from it`);
    return failed();
  }
  const taken = new Set<string>();
  for (const existing of options.existingPaths) taken.add(fold(existing));
  let scenePath = boardScenePath;
  if (recovery) {
    // Never the scene that exists: the first path of the series nothing stands at.
    const stem = boardScenePath.slice(0, -".tkrscn".length);
    scenePath = `${stem}.recovered.tkrscn`;
    for (let attempt = 2; taken.has(fold(scenePath)); attempt += 1) scenePath = `${stem}.recovered-${attempt}.tkrscn`;
  } else if (taken.has(fold(scenePath))) {
    refuse("-", scenePath, `${scenePath} already exists; an import never overwrites a scene, so nothing is written`);
    return failed();
  }

  const { sizeX, sizeY, sizeL, coordType } = board;

  // N6: the header is written as RPGTLKIT BOARD, major 2, minor 4, whatever the board stored.
  if (board.major !== 2) note("X2", "-", `stored major ${board.major}; a build writes major 2 (the engine ignores it)`);
  if (board.minor !== 4) note("X3", "-", `stored minor ${board.minor}; a build writes the vector layout, minor 4, which readers read for 4 and later`);

  /** A stored non-zero flag reads as true and is written as true (N3); any non-zero value but the editor's −1 is a normalisation. */
  const flag = (value: number, field: string, path: string): boolean => {
    if (value !== 0 && value !== -1) note(field, path, `stored ${value}, a flag; it reads as true and is written as true (every non-zero value does; the build writes -1)`);
    return value !== 0;
  };

  /** A stored layer number is a floor of the scene when a floor has it, otherwise it is carried as `layer`, as stored, with a warning. */
  const layerRef = (layer: number, field: string, path: string): ImportedSceneLayerRef => {
    if (layer >= 1 && layer <= sizeL) return { floor: floorId(layer) };
    warn(field, `${path}.layer`, `stored layer ${layer} is outside 1 to ${sizeL}; carried as layer ${layer}, as stored`);
    return { layer };
  };

  const points = (list: readonly { readonly x: number; readonly y: number }[]): ImportedScenePoint[] => list.map((point) => [point.x, point.y]);

  // ---- fields 1 to 4: size, layers, coordinate system
  if (sizeX < 1) refuse("1", "size.width", `the board is ${sizeX} tiles wide; a width below 1 cannot be carried`);
  if (sizeY < 1) refuse("2", "size.height", `the board is ${sizeY} tiles high; a height below 1 cannot be carried`);
  if (sizeL < 1) refuse("3", "floors", `the board has ${sizeL} layers; a layer count below 1 cannot be carried`);
  const coordOk = COORD_TYPES.includes(coordType);
  if (!coordOk) refuse("4", "projection", `coordType ${coordType} is none of 0, 1, 2, 4, 5 or 6; no editor produces it`);

  // Without a valid size and coordinate system there is no effective grid, so no cell of any stream can be checked against one.
  const dimensionsOk = sizeX >= 1 && sizeY >= 1 && sizeL >= 1;
  const grid = boardGrid(sizeX, sizeY, coordType);
  const cellsPerFloor = grid.width * grid.height;
  const totalCells = cellsPerFloor * sizeL;
  let gridOk = dimensionsOk && coordOk;
  if (gridOk && totalCells > BOARD_MAX_CELLS) {
    gridOk = false;
    refuse("3", "floors", `the effective grid ${grid.width}x${grid.height} times ${sizeL} layers is ${totalCells} cells, over the limit of ${BOARD_MAX_CELLS}`);
  }
  const projection = PROJECTIONS[coordType & 3] ?? "2d";

  /** Where a cell of the stored tile stream is, for a message: layer, then x and y on the effective grid (1-based). */
  const cellAt = (cell: number): string => {
    const within = cell % cellsPerFloor;
    return `layer ${Math.floor(cell / cellsPerFloor) + 1}, x ${(within % grid.width) + 1}, y ${Math.floor(within / grid.width) + 1}`;
  };

  // ---- fields 5 and 6: the tile look-up table
  const lut = board.lut;
  if (lut.length > 0 && lut[0] !== "") refuse("6", "tilePalette[0]", `slot 0 holds "${lut[0]}"; index 0 is always no tile and must be empty`);
  const tilePalette = lut.length === 0 ? undefined : lut.map((reference): ImportedScenePaletteEntry => (reference === "" ? {} : { legacy: reference }));

  // ---- field 7: the tile stream, one run list per floor, and the cells past the end
  const matrix = board.tileMatrix;
  let excessTiles: ImportedSceneTileRun | undefined;
  const floorRuns: (ImportedSceneTileRun[] | undefined)[] = [];
  if (gridOk) {
    if (matrix.length < totalCells) {
      refuse("7", "floors", `the tile stream holds ${matrix.length} cells but the grid has ${totalCells}; a stream that ends before its cells are covered cannot be carried`);
    } else {
      const badIndex = new Map<number, number>();
      for (let cell = 0; cell < totalCells; cell += 1) {
        const index = matrix[cell]!;
        if ((index < 0 || index >= lut.length) && (lut.length > 0 || index !== 0) && !badIndex.has(index)) badIndex.set(index, cell);
      }
      for (const [index, cell] of badIndex) {
        refuse(
          "7",
          "floors",
          lut.length === 0
            ? `a cell shows index ${index} (first at ${cellAt(cell)}) but the board has no look-up table, so every index must be 0`
            : `a cell shows index ${index} (first at ${cellAt(cell)}) but the look-up table has ${lut.length} slots`,
        );
      }

      const extra = matrix.length - totalCells;
      if (extra > 0) {
        const last = matrix[totalCells - 1]!;
        const continues = matrix.slice(totalCells).every((index) => index === last);
        if (!continues) refuse("7", "legacy.excessTiles", `the ${extra} cells past the end of the grid are not a continuation of the final run (index ${last})`);
        else if (extra > MAX_EXCESS_TILES) refuse("7", "legacy.excessTiles", `the final run carries ${extra} cells past the end; at most ${MAX_EXCESS_TILES} can be carried`);
        else {
          excessTiles = [extra, last];
          warn("7", "legacy.excessTiles", `the final run carries ${extra} cell(s) of index ${last} past the last cell of the last floor; carried in legacy.excessTiles`);
        }
      }

      for (let layer = 0; layer < sizeL; layer += 1) {
        const runs: [number, number][] = [];
        const from = layer * cellsPerFloor;
        for (let cell = from; cell < from + cellsPerFloor; cell += 1) {
          const index = matrix[cell]!;
          const last = runs[runs.length - 1];
          if (last !== undefined && last[1] === index) last[0] += 1;
          else runs.push([1, index]);
        }
        // Every cell empty is the default: an absent `tiles`.
        floorRuns.push(runs.length === 1 && runs[0]![1] === 0 ? undefined : runs);
      }
      // N1: run boundaries and the one-cell marker form are encoding, not model; a build writes maximal runs (a marker holds up to 32,768 cells).
      const runsList = board.tileRuns;
      const oneCellMarker = runsList.some((run) => run.marker && run.count === 1);
      const splitRun = runsList.some((run, at) => at > 0 && runsList[at - 1]!.lutIndex === run.lutIndex && runsList[at - 1]!.count < 32_768);
      if (oneCellMarker || splitRun) {
        note("N1", "floors[].tiles", "the stored tile runs are not maximal (a one-cell run in marker form, or neighbouring runs of one index); they are re-encoded as maximal runs, and the decoded cells are equal");
      }
    }
  }

  // ---- field 61 and field 3: the floors, one per layer
  const titles = board.layerTitles;
  if (dimensionsOk && titles.length !== sizeL + 1) refuse("61", "floors", `the board holds ${titles.length} layer titles but ${sizeL} layers need ${sizeL + 1} (index 0, then one per layer)`);
  const floors: ImportedSceneFloor[] = [];
  for (let layer = 1; layer <= sizeL; layer += 1) {
    floors.push({
      id: floorId(layer),
      ...opt("title", text(titles[layer] ?? "")),
      ...opt("tiles", floorRuns[layer - 1]),
    });
  }

  // ---- fields 8, 9, 9a, 9b: shading layers and the records past the end
  const shading: ImportedSceneShadingLayer[] = [];
  board.shadeLayers.forEach((layer, at) => {
    const path = `shading[${at}]`;
    const cells: [number, number, number, number][] = [];
    let excessCells: ImportedSceneTintRun | undefined;
    let covered = 0;
    let stray = false;
    let reset = 0;
    let wide = 0;
    if (gridOk) {
      for (const record of layer.records) {
        const count = record.runCount > 1 ? record.runCount : 1;
        if (record.runCount < 1) reset += 1;
        if (outOfShadeRange(record.r) || outOfShadeRange(record.g) || outOfShadeRange(record.b)) wide += 1;
        if (covered >= cellsPerFloor) {
          stray = true;
          continue;
        }
        let inGrid = count;
        if (covered + count > cellsPerFloor) {
          const extra = covered + count - cellsPerFloor;
          inGrid = count - extra;
          if (extra > MAX_EXCESS_CELLS) refuse("9b", `${path}.legacy.excessCells`, `the final record carries ${extra} cells past the end; at most ${MAX_EXCESS_CELLS} can be carried`);
          else {
            excessCells = [extra, record.r, record.g, record.b];
            warn("9b", `${path}.legacy.excessCells`, `the final record carries ${extra} cell(s) past the last cell of the grid; carried in legacy.excessCells`);
          }
        }
        const last = cells[cells.length - 1];
        if (last !== undefined && last[1] === record.r && last[2] === record.g && last[3] === record.b) last[0] += inGrid;
        else cells.push([inGrid, record.r, record.g, record.b]);
        covered += count;
      }
      if (covered < cellsPerFloor) refuse("9b", `${path}.cells`, `the records cover ${covered} cells but the grid has ${cellsPerFloor}; records that end before the grid is covered cannot be carried`);
      if (stray) refuse("9b", `${path}.cells`, `records follow the one that already covers the grid; they cannot be carried`);
    }
    if (reset > 0) note("9b", `${path}.cells`, `${reset} record(s) stored a count of 0 or less, which reads as one cell; written as 1`);
    if (wide > 0) note("9b", `${path}.cells`, `${wide} record(s) hold a channel outside -255 to 255; carried exactly as stored`);
    shading.push({
      ...layerRef(layer.castLayer, "9a", path),
      cells,
      ...opt("legacy", excessCells === undefined ? undefined : { excessCells }),
    });
  });

  // ---- fields 10 to 16: lights
  const lights: ImportedSceneLight[] = [];
  board.lights.forEach((light, at) => {
    const path = `lights[${at}]`;
    const type = LIGHT_TYPES.get(light.type);
    if (type === undefined) refuse("12", `${path}.type`, `light type ${light.type} is none of 0, 1 or 2`);
    if (light.colours.some((colour) => outOfShadeRange(colour.r) || outOfShadeRange(colour.g) || outOfShadeRange(colour.b))) {
      note("16", `${path}.colors`, "a colour channel is outside -255 to 255; carried exactly as stored");
    }
    lights.push({
      ...layerRef(light.layer, "11", path),
      type: type ?? "ellipse",
      nodes: points(light.nodes),
      colors: light.colours.map(rgb),
    });
  });

  // ---- fields 17 to 24: vectors
  const vectors: ImportedSceneVector[] = [];
  board.vectors.forEach((vector, at) => {
    const path = `vectors[${at}]`;
    const type = VECTOR_TYPES.get(vector.type);
    if (type === undefined) refuse("23", `${path}.type`, `vector type ${vector.type} is none of 0, 1, 2, 4, 8 or 16`);
    if (vector.points.length < 2) refuse("18", `${path}.points`, `the vector has ${vector.points.length} point(s); a stored vector has at least 2`);
    let attributes: number | undefined;
    let target: { readonly toFloor: string } | { readonly toLayer: number } | undefined;
    if (type === "under") {
      if (vector.attributes < 0 || vector.attributes > 7) refuse("20", `${path}.attributes`, `an under vector holds attributes ${vector.attributes}; the mask is 0 to 7`);
      attributes = vector.attributes === 0 ? undefined : vector.attributes;
    } else if (type === "stairs") {
      target = vector.attributes >= 1 && vector.attributes <= sizeL ? { toFloor: floorId(vector.attributes) } : { toLayer: vector.attributes };
    } else if (type !== undefined && vector.attributes !== 0) {
      refuse("20", `${path}.attributes`, `a ${type} vector holds attributes ${vector.attributes}; the board defines none for that type`);
    }
    vectors.push({
      ...layerRef(vector.layer, "22", path),
      type: type ?? "none",
      closed: flag(vector.closed, "21", `${path}.closed`),
      points: points(vector.points),
      ...opt("handle", text(vector.handle)),
      ...opt("attributes", attributes),
      ...(target ?? {}),
    });
  });

  // ---- fields 25 to 39: program triggers
  const conditionOf = (activate: number, variable: string, value: string, field: string, path: string): ImportedSceneCondition | undefined => {
    if (activate !== 0 && activate !== 1) refuse(field, `${path}.condition.mode`, `activate ${activate} is neither 0 (always) nor 1 (conditional)`);
    return nonEmpty({ ...opt("mode", activate === 1 ? ("conditional" as const) : undefined), ...opt("variable", text(variable)), ...opt("value", text(value)) });
  };
  const pairOf = (variable: string, value: string): ImportedSceneVariablePair | undefined => nonEmpty({ ...opt("variable", text(variable)), ...opt("value", text(value)) });

  const triggers: ImportedSceneTrigger[] = [];
  board.programs.forEach((program, at) => {
    const path = `triggers[${at}]`;
    const bits = program.activationType;
    if ((bits & ~7) !== 0) refuse("33", `${path}.activation`, `activationType ${bits} sets a bit other than 1 (key press), 2 (repeat) or 4 (stops movement)`);
    triggers.push({
      ...layerRef(program.layer, "35", path),
      ...opt("program", text(program.program)),
      ...opt("condition", conditionOf(program.activate, program.initialVar, program.initialValue, "32", path)),
      ...opt("afterRun", pairOf(program.finalVar, program.finalValue)),
      ...opt(
        "activation",
        nonEmpty({
          ...opt("keyPress", (bits & 1) !== 0 ? true : undefined),
          ...opt("repeat", (bits & 2) !== 0 ? true : undefined),
          ...opt("stopsMovement", (bits & 4) !== 0 ? true : undefined),
          ...opt("repeatDistance", program.repeatDistance === 0 ? undefined : program.repeatDistance),
        }),
      ),
      ...opt("points", program.points.length === 0 ? undefined : points(program.points)),
      ...opt("closed", flag(program.closed, "38", `${path}.closed`) ? true : undefined),
      ...opt("legacy", nonEmpty({ ...opt("graphic", text(program.graphic)), ...opt("reserved", text(program.handle)) })),
    });
  });

  // ---- fields 40 to 49: items placed on the board
  const items: ImportedSceneItem[] = [];
  board.sprites.forEach((sprite, at) => {
    const path = `items[${at}]`;
    const bits = sprite.activationType;
    if ((bits & ~3) !== 0) refuse("47", `${path}.activation`, `activationType ${bits} sets a bit other than 1 (key press) or 2 (repeat)`);
    items.push({
      ...layerRef(sprite.layer, "48c", path),
      ...opt("item", text(sprite.itemFile)),
      x: sprite.x,
      y: sprite.y,
      ...opt("activationProgram", text(sprite.activationPrg)),
      ...opt("multitaskProgram", text(sprite.multitaskPrg)),
      ...opt("condition", conditionOf(sprite.activate, sprite.initialVar, sprite.initialValue, "46", path)),
      ...opt("afterRun", pairOf(sprite.finalVar, sprite.finalValue)),
      ...opt("loadCondition", pairOf(sprite.loadingVar, sprite.loadingValue)),
      ...opt("activation", nonEmpty({ ...opt("keyPress", (bits & 1) !== 0 ? true : undefined), ...opt("repeat", (bits & 2) !== 0 ? true : undefined) })),
      ...opt("legacy", sprite.reserved === -1 ? undefined : { reserved: sprite.reserved }),
    });
  });

  // ---- fields 50 to 56: images
  const drawType = (stored: number, field: string, path: string): "parallax" | "stretch" | undefined => {
    if (!DRAW_TYPES.has(stored)) refuse(field, path, `type ${stored} is none of 0 (normal), 1 (parallax) or 2 (stretch)`);
    return DRAW_TYPES.get(stored);
  };
  const images: ImportedSceneImage[] = [];
  board.images.forEach((image, at) => {
    const path = `images[${at}]`;
    images.push({
      ...layerRef(image.layer, "53", path),
      ...opt("source", text(image.file)),
      x: image.left,
      y: image.top,
      ...opt("type", drawType(image.drawType, "54", `${path}.type`)),
      transparent: rgb(image.transparent),
      ...opt("legacy", image.reserved === 100 ? undefined : { reserved: image.reserved }),
    });
  });

  // ---- fields 62 to 75: links, background, music, programs, battle, saving, ambient, start
  const properties = board.properties;
  const ambient = rgb(properties.ambient);
  if (ambient.some(outOfShadeRange)) note("72", "atmosphere.ambient", "an ambient channel is outside -255 to 255; carried exactly as stored");
  const backgroundColour = rgb(properties.backgroundColour);
  const atmosphere = nonEmpty({
    ...opt("ambient", isBlack(ambient) ? undefined : ambient),
    ...opt("music", text(properties.backgroundMusic)),
    ...opt(
      "background",
      nonEmpty({
        ...opt("image", text(properties.backgroundImage)),
        ...opt("type", drawType(properties.backgroundDrawType, "64", "atmosphere.background.type")),
        ...opt("color", isBlack(backgroundColour) ? undefined : backgroundColour),
      }),
    ),
  });

  const start = properties.start;
  if (start.x <= 0) note("73", "start.x", `stored start x ${start.x} means the default; carried as the key being absent`);
  if (start.y <= 0) note("74", "start.y", `stored start y ${start.y} means the default; carried as the key being absent`);
  if (start.layer <= 0) note("75", "start", `stored start layer ${start.layer} means layer 1; carried as both keys being absent`);
  const startLayer = start.layer <= 1 ? undefined : layerRef(start.layer, "75", "start");
  const sceneStart = nonEmpty({
    ...opt("x", start.x <= 0 || start.x === 64 ? undefined : start.x),
    ...opt("y", start.y <= 0 || start.y === 64 ? undefined : start.y),
    ...(startLayer ?? {}),
  });

  const sceneLinks = nonEmpty({
    ...opt("north", text(board.links.north)),
    ...opt("south", text(board.links.south)),
    ...opt("east", text(board.links.east)),
    ...opt("west", text(board.links.west)),
  });

  const battle = nonEmpty({
    ...opt("background", text(properties.battleBackground)),
    ...opt("skill", properties.battleSkill === 0 ? undefined : properties.battleSkill),
    ...opt("allowed", flag(properties.allowBattles, "70", "battle.allowed") ? true : undefined),
  });
  const savingDisabled = flag(properties.disableSaving, "71", "savingDisabled");

  // ---- field X5 and field 61: what the model has no other place for
  const residue = board.residue;
  if (residue.length > 0) warn("X5", "legacy.trailingBytes", `${residue.length} byte(s) follow the last documented field; carried, as base64, in legacy.trailingBytes`);
  const legacy = nonEmpty({
    ...opt("layerTitleZero", text(titles[0] ?? "")),
    ...opt("trailingBytes", residue.length === 0 ? undefined : base64(residue)),
    ...opt("excessTiles", excessTiles),
  });

  if (findings.some((finding) => finding.severity === "refusal")) return failed();

  const scene: ImportedScene = {
    contract: SCENE_CONTRACT,
    version: SCENE_VERSION,
    tags: ["imported"],
    metadata: { source: options.boardName },
    projection,
    ...opt("pixelCoordinates", (coordType & 4) !== 0 ? true : undefined),
    size: { width: sizeX, height: sizeY },
    floors,
    ...opt("tilePalette", tilePalette),
    ...opt("shading", shading.length === 0 ? undefined : shading),
    ...opt("lights", lights.length === 0 ? undefined : lights),
    ...opt("vectors", vectors.length === 0 ? undefined : vectors),
    ...opt("triggers", triggers.length === 0 ? undefined : triggers),
    ...opt("items", items.length === 0 ? undefined : items),
    ...opt("images", images.length === 0 ? undefined : images),
    ...opt("atmosphere", atmosphere),
    ...opt("start", sceneStart),
    ...opt("links", sceneLinks),
    ...opt("enterProgram", text(properties.enterPrg)),
    ...opt("battle", battle),
    ...opt("savingDisabled", savingDisabled ? true : undefined),
    threads: [...board.threads],
    constants: [...board.constants],
    ...opt("legacy", legacy),
  };
  if (recovery) for (const [field, path, message] of SCENE_ONLY_FEATURES) note(field, path, message);
  return { ok: true, scene, scenePath, findings };
}
