import { deepEqual, equal, ok } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { BinaryReader, boardLayout, convertPreVectorBoard, createEmptyBoard, readBoard, readPreVectorBoard, writeBoard, type Board, type BoardImage, type BoardLight, type BoardProgram, type BoardProperties, type BoardShadeLayer, type BoardSprite, type BoardVector } from "@tk-reawakened/core";
import { importBoardToScene, recoverBoardToScene, sceneTargetPath, type ImportedScene, type SceneImportFinding, type SceneImportResult, type SceneImportSuccess } from "../src/scene.ts";
import { checkDocuments, readScene, writeScene } from "@tk-reawakened/native-data";

const root = fileURLToPath(new URL("../../../", import.meta.url));

// ---------------------------------------------------------------- building boards

type Run = readonly [count: number, index: number];

/** The tile stream of a board from `[count, index]` runs: the stored runs and the matrix they expand to, cells past the end included. */
function tiles(runs: readonly Run[]): Pick<Board, "tileRuns" | "tileMatrix"> {
  return {
    tileRuns: runs.map(([count, lutIndex]) => ({ lutIndex, count, marker: count !== 1 })),
    tileMatrix: runs.flatMap(([count, index]) => Array.from({ length: count }, () => index)),
  };
}

/** A shading layer from `[runCount, r, g, b]` records, as stored. */
const shade = (castLayer: number, ...records: readonly (readonly [number, number, number, number])[]): BoardShadeLayer => ({
  castLayer,
  records: records.map(([runCount, r, g, b]) => ({ runCount, r, g, b })),
});

const point = (x: number, y: number): { readonly x: number; readonly y: number } => ({ x, y });

function vector(patch: Partial<BoardVector> = {}): BoardVector {
  return { points: [point(0, 0), point(8, 8)], attributes: 0, closed: 0, layer: 1, type: 1, handle: "", ...patch };
}

function light(patch: Partial<BoardLight> = {}): BoardLight {
  return { layer: 1, type: 0, nodes: [point(1, 2), point(3, 4), point(5, 6)], colours: [{ r: 0, g: 0, b: 0 }, { r: 1, g: 2, b: 3 }], ...patch };
}

function program(patch: Partial<BoardProgram> = {}): BoardProgram {
  return {
    program: "",
    graphic: "",
    initialVar: "",
    initialValue: "",
    finalVar: "",
    finalValue: "",
    activate: 0,
    activationType: 0,
    repeatDistance: 0,
    layer: 1,
    points: [],
    closed: 0,
    handle: "",
    ...patch,
  };
}

function sprite(patch: Partial<BoardSprite> = {}): BoardSprite {
  return {
    itemFile: "",
    activationPrg: "",
    multitaskPrg: "",
    initialVar: "",
    initialValue: "",
    finalVar: "",
    finalValue: "",
    loadingVar: "",
    loadingValue: "",
    activate: 0,
    activationType: 0,
    x: 0,
    y: 0,
    layer: 1,
    reserved: -1,
    ...patch,
  };
}

function image(patch: Partial<BoardImage> = {}): BoardImage {
  return { file: "", left: 0, top: 0, layer: 1, drawType: 0, transparent: { r: 0, g: 0, b: 0 }, reserved: 100, ...patch };
}

const properties = (patch: Partial<BoardProperties> = {}): BoardProperties => ({ ...createEmptyBoard().properties, ...patch });

/** The smallest board that imports: 1 by 1, one layer, no look-up table, every setting at its default. */
function bare(patch: Partial<Board> = {}): Board {
  return { ...createEmptyBoard(), sizeX: 1, sizeY: 1, sizeL: 1, lut: [], ...tiles([[1, 0]]), layerTitles: ["", ""], ...patch };
}

/** The board of the contract page's sample: 4 by 3 tiles on a 2-D grid with the pixel-coordinates flag, two layers, and every kind of record. */
function cottage(): Board {
  return {
    ...createEmptyBoard(),
    sizeX: 4,
    sizeY: 3,
    sizeL: 2,
    coordType: 4,
    lut: ["", "village.tst1", "village.tst2", "", "water.tan"],
    // Layer 1: 1 1 1 1 / 2 2 4 4 / 1 1 1 1. Layer 2: twelve 0s, then three more 0s the final run carries past the end.
    ...tiles([[4, 1], [2, 2], [2, 4], [4, 1], [15, 0]]),
    shadeLayers: [shade(2, [8, 0, 0, 0], [6, 286, -20, -10])],
    lights: [light({ nodes: [point(64, 48), point(96, 48), point(64, 80)], colours: [{ r: 0, g: 0, b: 0 }, { r: 60, g: 50, b: 20 }] })],
    vectors: [
      vector({ points: [point(0, 8), point(128, 8)], type: 1 }),
      vector({ points: [point(32, 8), point(64, 8), point(64, 32), point(32, 32)], type: 2, attributes: 3, closed: -1 }),
      vector({ points: [point(96, 56), point(124, 56), point(124, 88), point(96, 88)], type: 8, attributes: 2, closed: -1 }),
      vector({ points: [point(16, 80), point(112, 80)], type: 16, handle: "patrol" }),
    ],
    programs: [
      program({
        program: "open_door.prg",
        graphic: "door.gph",
        initialVar: "7f3a9c1e",
        finalVar: "7f3a9c1e",
        finalValue: "_guid",
        activate: 1,
        activationType: 3,
        repeatDistance: 16,
        points: [point(32, 64), point(64, 64), point(64, 96), point(32, 96)],
        closed: -1,
        handle: "keep",
      }),
      program(),
    ],
    sprites: [
      sprite({
        itemFile: "chest.itm",
        activationPrg: "open_chest.prg",
        multitaskPrg: "sparkle.prg",
        initialVar: "chest_opened",
        initialValue: "0",
        finalVar: "chest_opened",
        finalValue: "1",
        loadingVar: "chapter",
        loadingValue: "2",
        activate: 1,
        activationType: 1,
        x: 48,
        y: 80,
        reserved: 7,
      }),
      sprite(),
    ],
    images: [image({ file: "fountain.png", left: 32, top: 16, drawType: 1, transparent: { r: 255, g: 0, b: 255 }, reserved: 90 })],
    threads: ["ambient.prg", ""],
    constants: ["gold", "", "7"],
    layerTitles: ["unused", "Ground", ""],
    links: { north: "village.brd", south: "", east: "exit.prg", west: "" },
    properties: {
      backgroundImage: "sky.png",
      backgroundDrawType: 2,
      backgroundColour: { r: 120, g: 160, b: 240 },
      backgroundMusic: "cottage_theme.ogg",
      enterPrg: "enter_cottage.prg",
      battleBackground: "forest.bkg",
      battleSkill: 2,
      allowBattles: -1,
      disableSaving: -1,
      ambient: { r: -10, g: -10, b: 0 },
      start: { x: 64, y: 80, layer: 1 },
    },
    residue: new Uint8Array([0, 1, 2]),
  };
}

void test("an authored board imports into a writable, checkable scene without losing slot data", () => {
  const result = importBoardToScene(cottage(), { boardName: "Boards/cottage.brd", existingPaths: [] });
  ok(result.ok, result.ok ? "" : JSON.stringify(result.findings));
  const written = writeScene(result.scene);
  ok(written.ok, written.ok ? "" : JSON.stringify(written.problems));
  const read = readScene(written.text);
  ok(read.ok, read.ok ? "" : JSON.stringify(read.problems));
  deepEqual(checkDocuments([{ path: result.scenePath, text: written.text }]), []);
  // Every empty slot is still there after the text round trip, at its index.
  equal(read.scene.triggers?.length, 2);
  deepEqual(read.scene.triggers?.[1], { floor: "layer-1" });
  equal(read.scene.items?.length, 2);
  deepEqual(read.scene.items?.[1], { floor: "layer-1", x: 0, y: 0 });
  deepEqual(read.scene.tilePalette, [{}, { legacy: "village.tst1" }, { legacy: "village.tst2" }, {}, { legacy: "water.tan" }]);
  deepEqual(read.scene.threads, ["ambient.prg", ""]);
  deepEqual(read.scene.constants, ["gold", "", "7"]);
  equal(read.scene.vectors?.length, 4);
  equal(read.scene.vectors?.[3]?.handle, "patrol");
  // The values the engine ignores and the cells past the end survive the round trip, value for value.
  deepEqual(read.scene.triggers?.[0]?.legacy, { graphic: "door.gph", reserved: "keep" });
  equal(read.scene.items?.[0]?.legacy?.reserved, 7);
  equal(read.scene.images?.[0]?.legacy?.reserved, 90);
  deepEqual(read.scene.shading?.[0]?.legacy?.excessCells, [2, 286, -20, -10]);
  deepEqual(read.scene.shading?.[0]?.cells, [[8, 0, 0, 0], [4, 286, -20, -10]]);
  deepEqual(read.scene.legacy, { layerTitleZero: "unused", trailingBytes: "AAEC", excessTiles: [3, 0] });
  // And every key the import wrote reads back equal.
  for (const key of Object.keys(result.scene)) deepEqual(Reflect.get(read.scene, key), Reflect.get(result.scene, key), key);
});

void test("the target is compared by document identity: ./, //, case and backslashes do not hide an existing scene, in import or recovery", () => {
  const existing = ["Boards/Cottage.tkrscn"];
  for (const name of ["./Boards/Cottage.brd", "Boards//Cottage.brd", "./Boards/./Cottage.BRD", "Boards\\Cottage.brd", "././boards/COTTAGE.brd"]) {
    equal(run(bare(), name, existing).ok, false, `import of ${name}`);
    const recovered = recover(bare(), existing, name);
    if (!recovered.ok) throw new Error(name);
    ok(!/cottage\.tkrscn$/i.test(recovered.scenePath), `recovery of ${name} proposed ${recovered.scenePath}`);
    ok(/\.recovered\.tkrscn$/.test(recovered.scenePath));
  }
  // The existing paths are normalised the same way.
  for (const standing of ["./Boards/Cottage.tkrscn", "Boards//cottage.TKRSCN", "boards\\Cottage.tkrscn", "././Boards/./Cottage.tkrscn"]) {
    equal(run(bare(), "Boards/Cottage.brd", [standing]).ok, false, standing);
    const recovered = recover(bare(), [standing, "./Boards//cottage.RECOVERED.tkrscn"]);
    if (!recovered.ok) throw new Error(standing);
    equal(recovered.scenePath, "Boards/Cottage.recovered-2.tkrscn", standing);
  }
  // The scene path is the document ID form: project-relative, no dot or empty parts; metadata.source keeps the caller's spelling.
  const made = run(bare(), "./Boards//Cottage.brd");
  if (!made.ok) throw new Error("expected a scene");
  equal(made.scenePath, "Boards/Cottage.tkrscn");
  equal(made.scene.metadata.source, "./Boards//Cottage.brd");
  // A different folder is a different document.
  equal(run(bare(), "./Boards/Cottage.brd", ["Other/Boards/Cottage.tkrscn"]).ok, true);
});

void test("a successful import or recovery returns a POSIX project-relative path: legacy backslashes, dots and doubled slashes are normalised, the case is kept", () => {
  const cases: readonly (readonly [name: string, imported: string, recovered: string])[] = [
    ["Boards\\Old Town\\Well #2.brd", "Boards/Old Town/Well #2.tkrscn", "Boards/Old Town/Well #2.recovered.tkrscn"],
    [".\\Boards\\\\Sub/Cottage.BRD", "Boards/Sub/Cottage.tkrscn", "Boards/Sub/Cottage.recovered.tkrscn"],
    ["./Boards//Cottage.brd", "Boards/Cottage.tkrscn", "Boards/Cottage.recovered.tkrscn"],
    ["cottage.brd", "cottage.tkrscn", "cottage.recovered.tkrscn"],
  ];
  for (const [name, expected, recoveredExpected] of cases) {
    const made = run(bare(), name);
    if (!made.ok) throw new Error(name);
    equal(made.scenePath, expected, name);
    equal(made.scenePath.includes("\\"), false, name);
    equal(made.scene.metadata.source, name, "the source keeps the caller's spelling");
    const recovered = recover(bare(), [], name);
    if (!recovered.ok) throw new Error(name);
    equal(recovered.scenePath, recoveredExpected, name);
    // With the scene standing, recovery steps along the series, still in the same folder.
    const second = recover(bare(), [expected, recoveredExpected], name);
    if (!second.ok) throw new Error(name);
    equal(second.scenePath, recoveredExpected.replace(".recovered.", ".recovered-2."), name);
  }
});

void test("the header and the run encoding are normalised, and noted: N6 (major, minor) and N1 (run boundaries, marker form)", () => {
  const header = imported(bare({ major: 3, minor: 7 })).findings;
  deepEqual(header.map((finding) => [finding.severity, finding.field]), [["note", "X2"], ["note", "X3"]]);
  deepEqual(imported(bare({ major: 2, minor: 4 })).findings, []);
  deepEqual(fieldsOf(imported(bare({ minor: 5 })).findings, "note"), ["X3"]);

  const base = { sizeX: 4, lut: ["", "a.tst1"] };
  const noteOf = (tileRuns: Board["tileRuns"]): string[] => {
    const tileMatrix = tileRuns.flatMap((run) => Array.from({ length: run.count }, () => run.lutIndex));
    return fieldsOf(imported(bare({ ...base, tileRuns, tileMatrix })).findings, "note");
  };
  // Maximal runs, and a plain one-cell entry, are already what the import writes.
  deepEqual(noteOf([{ lutIndex: 1, count: 3, marker: true }, { lutIndex: 0, count: 1, marker: false }]), []);
  // A one-cell run in marker form, and neighbouring runs of one index, are re-encoded.
  deepEqual(noteOf([{ lutIndex: 1, count: 1, marker: true }, { lutIndex: 0, count: 3, marker: true }]), ["N1"]);
  deepEqual(noteOf([{ lutIndex: 1, count: 2, marker: true }, { lutIndex: 1, count: 2, marker: true }]), ["N1"]);
  // Runs of one index that a single marker cannot hold together are not split by the import: the first is already full.
  const full = bare({ sizeX: 1, lut: ["", "a.tst1"], tileRuns: [{ lutIndex: 1, count: 32_768, marker: true }, { lutIndex: 1, count: 1, marker: false }], tileMatrix: [1] });
  equal(imported(full).findings.some((finding) => finding.field === "N1"), false);
});

/** What the contract page's sample holds of the board's own data. The sample's scene-only data (native tile, boundary sources, pack placement, plugin block, ids, labels) cannot come from a board. */
const COTTAGE_SCENE: ImportedScene = {
  contract: "scene",
  version: "1.0.0-pre.1",
  tags: ["imported"],
  metadata: { source: "Boards/Cottage.brd" },
  projection: "2d",
  pixelCoordinates: true,
  size: { width: 4, height: 3 },
  floors: [
    { id: "layer-1", title: "Ground", tiles: [[4, 1], [2, 2], [2, 4], [4, 1]] },
    { id: "layer-2" },
  ],
  tilePalette: [{}, { legacy: "village.tst1" }, { legacy: "village.tst2" }, {}, { legacy: "water.tan" }],
  shading: [{ floor: "layer-2", cells: [[8, 0, 0, 0], [4, 286, -20, -10]], legacy: { excessCells: [2, 286, -20, -10] } }],
  lights: [{ floor: "layer-1", type: "ellipse", nodes: [[64, 48], [96, 48], [64, 80]], colors: [[0, 0, 0], [60, 50, 20]] }],
  vectors: [
    { floor: "layer-1", type: "solid", closed: false, points: [[0, 8], [128, 8]] },
    { floor: "layer-1", type: "under", closed: true, points: [[32, 8], [64, 8], [64, 32], [32, 32]], attributes: 3 },
    { floor: "layer-1", type: "stairs", closed: true, points: [[96, 56], [124, 56], [124, 88], [96, 88]], toFloor: "layer-2" },
    { floor: "layer-1", type: "waypoint", closed: false, points: [[16, 80], [112, 80]], handle: "patrol" },
  ],
  triggers: [
    {
      floor: "layer-1",
      program: "open_door.prg",
      condition: { mode: "conditional", variable: "7f3a9c1e" },
      afterRun: { variable: "7f3a9c1e", value: "_guid" },
      activation: { keyPress: true, repeat: true, repeatDistance: 16 },
      points: [[32, 64], [64, 64], [64, 96], [32, 96]],
      closed: true,
      legacy: { graphic: "door.gph", reserved: "keep" },
    },
    { floor: "layer-1" },
  ],
  items: [
    {
      floor: "layer-1",
      item: "chest.itm",
      x: 48,
      y: 80,
      activationProgram: "open_chest.prg",
      multitaskProgram: "sparkle.prg",
      condition: { mode: "conditional", variable: "chest_opened", value: "0" },
      afterRun: { variable: "chest_opened", value: "1" },
      loadCondition: { variable: "chapter", value: "2" },
      activation: { keyPress: true },
      legacy: { reserved: 7 },
    },
    { floor: "layer-1", x: 0, y: 0 },
  ],
  images: [{ floor: "layer-1", source: "fountain.png", x: 32, y: 16, type: "parallax", transparent: [255, 0, 255], legacy: { reserved: 90 } }],
  atmosphere: { ambient: [-10, -10, 0], music: "cottage_theme.ogg", background: { image: "sky.png", type: "stretch", color: [120, 160, 240] } },
  start: { y: 80 },
  links: { north: "village.brd", east: "exit.prg" },
  enterProgram: "enter_cottage.prg",
  battle: { background: "forest.bkg", skill: 2, allowed: true },
  savingDisabled: true,
  threads: ["ambient.prg", ""],
  constants: ["gold", "", "7"],
  legacy: { layerTitleZero: "unused", trailingBytes: "AAEC", excessTiles: [3, 0] },
};

// ---------------------------------------------------------------- running the import

const NAME = "Boards/Cottage.brd";

function run(board: Board, boardName = NAME, existingPaths: readonly string[] = []): SceneImportResult {
  return importBoardToScene(board, { boardName, existingPaths });
}

function imported(board: Board): SceneImportSuccess {
  const result = run(board);
  if (!result.ok) throw new Error(`refused: ${result.findings.map((finding) => `${finding.field} ${finding.path}: ${finding.message}`).join("; ")}`);
  return result;
}

function refused(board: Board, boardName = NAME, existingPaths: readonly string[] = []): readonly SceneImportFinding[] {
  const result = run(board, boardName, existingPaths);
  if (result.ok) throw new Error("expected the import to be refused");
  ok(result.findings.some((finding) => finding.severity === "refusal"), "a refusal is among the findings");
  return result.findings;
}

/** `field` of every finding of a severity, in report order. */
const fieldsOf = (findings: readonly SceneImportFinding[], severity: SceneImportFinding["severity"]): string[] => findings.filter((finding) => finding.severity === severity).map((finding) => finding.field);

const refusedFields = (board: Board): string[] => fieldsOf(refused(board), "refusal");

// ---------------------------------------------------------------- the authored board

void test("the board of the contract page's sample imports to the sample's own data, slot for slot, in canonical key order", () => {
  const result = run(cottage());
  if (!result.ok) throw new Error(JSON.stringify(result.findings));
  deepEqual(result.scene, COTTAGE_SCENE);
  // deepEqual ignores key order; the contract's canonical order is part of the import.
  equal(JSON.stringify(result.scene), JSON.stringify(COTTAGE_SCENE));
  equal(result.scenePath, "Boards/Cottage.tkrscn");
  deepEqual(
    result.findings.map((finding) => [finding.severity, finding.field]),
    [["warning", "7"], ["warning", "9b"], ["note", "9b"], ["warning", "X5"]],
  );
  deepEqual(Object.keys(result.scene), [
    "contract",
    "version",
    "tags",
    "metadata",
    "projection",
    "pixelCoordinates",
    "size",
    "floors",
    "tilePalette",
    "shading",
    "lights",
    "vectors",
    "triggers",
    "items",
    "images",
    "atmosphere",
    "start",
    "links",
    "enterProgram",
    "battle",
    "savingDisabled",
    "threads",
    "constants",
    "legacy",
  ]);
});

void test("the same board through the real writer and reader gives the same scene, the cells past the end of the runs included", () => {
  const bytes = writeBoard(cottage());
  if (!bytes.ok) throw new Error(bytes.error.message);
  const read = readBoard(new BinaryReader(bytes.value));
  if (!read.ok) throw new Error(read.error.message);
  deepEqual(imported(read.value).scene, COTTAGE_SCENE);
});

void test("importing twice gives the same text, changes nothing of the board, and carries nothing that varies from run to run", () => {
  const board = cottage();
  const before = JSON.stringify({ ...board, residue: Array.from(board.residue) });
  const result = imported(board);
  const first = JSON.stringify(result);
  const second = JSON.stringify(imported(cottage()));
  equal(first, second);
  equal(JSON.stringify({ ...board, residue: Array.from(board.residue) }), before);
  ok(!/\d{4}-\d{2}-\d{2}|T\d\d:\d\d/.test(first), "no date or time");
  for (const absent of ["name", "placedPacks", "pluginData"]) equal(Object.hasOwn(result.scene, absent), false, absent);
  for (const record of [...(result.scene.vectors ?? []), ...(result.scene.triggers ?? []), ...(result.scene.items ?? []), ...(result.scene.images ?? []), ...(result.scene.lights ?? []), ...(result.scene.shading ?? [])]) {
    equal(Object.hasOwn(record, "id"), false, "an import writes no record id");
  }
  for (const floor of result.scene.floors) equal(Object.hasOwn(floor, "boundarySources"), false);
});

// ---------------------------------------------------------------- where the scene goes, and never over another

void test("the scene is made beside the board, with the same stem and the extension .tkrscn", () => {
  equal(sceneTargetPath("Boards/cottage.brd"), "Boards/cottage.tkrscn");
  equal(sceneTargetPath("Boards\\Sub\\Cottage.BRD"), "Boards\\Sub\\Cottage.tkrscn");
  equal(sceneTargetPath("cottage.brd"), "cottage.tkrscn");
  equal(sceneTargetPath("a.b.brd"), "a.b.tkrscn");
  equal(sceneTargetPath("Boards/cottage.tkrscn"), undefined);
  equal(sceneTargetPath("Boards/cottage"), undefined);
  equal(sceneTargetPath(".brd"), undefined);
  equal(sceneTargetPath("Boards/.brd"), undefined);
});

void test("metadata.source is the board's name as the caller gave it, case and folders kept", () => {
  for (const name of ["Boards/Cottage.brd", "cottage.BRD", "Boards\\Old Town\\Well #2.brd"]) {
    const result = run(bare(), name);
    if (!result.ok) throw new Error(name);
    equal(result.scene.metadata.source, name);
    deepEqual(result.scene.tags, ["imported"]);
  }
});

void test("a scene already standing at the target path stops the import; nothing is written and nothing is made", () => {
  for (const existing of ["Boards/Cottage.tkrscn", "boards/cottage.TKRSCN", "Boards\\COTTAGE.tkrscn"]) {
    const result = run(bare(), NAME, ["Other/a.tkrscn", existing]);
    equal(result.ok, false, existing);
    if (result.ok) continue;
    deepEqual(
      result.findings.map((finding) => [finding.severity, finding.field, finding.path]),
      [["refusal", "-", "Boards/Cottage.tkrscn"]],
    );
    ok(result.findings[0]!.message.includes("already exists"));
  }
  // A different scene, a board beside it, and the board itself are not in the way.
  equal(run(bare(), NAME, ["Boards/Cottage.brd", "Boards/Other.tkrscn", "Boards/sub/Cottage.tkrscn"]).ok, true);
  equal(run(bare()).ok, true);
});

void test("a name that is not a .brd file name is refused with no scene path to make", () => {
  const findings = refused(bare(), "Boards/Cottage.tkrscn");
  deepEqual(findings.map((finding) => [finding.severity, finding.field, finding.path]), [["refusal", "-", "boardName"]]);
});

// ---------------------------------------------------------------- the 75 fields: each lands, so each change is seen

void test("every field of the board lands somewhere: changing any one of them changes the scene", () => {
  const baseline = JSON.stringify(imported(cottage()).scene);
  const at = <T>(list: readonly T[], index: number, patch: Partial<T>): T[] => list.map((item, i) => (i === index ? { ...item, ...patch } : item));
  const props = (b: Board, patch: Partial<BoardProperties>): Board => ({ ...b, properties: { ...b.properties, ...patch } });
  const mutations: readonly (readonly [string, (b: Board) => Board])[] = [
    ["5 LUT upper bound (a trailing empty slot)", (b) => ({ ...b, lut: [...b.lut, ""] })],
    ["6 LUT entry", (b) => ({ ...b, lut: b.lut.map((entry, i) => (i === 3 ? "grass.tst9" : entry)) })],
    ["7 a cell", (b) => ({ ...b, ...tiles([[4, 1], [2, 2], [2, 4], [3, 1], [1, 2], [15, 0]]) })],
    ["7 cells past the end", (b) => ({ ...b, ...tiles([[4, 1], [2, 2], [2, 4], [4, 1], [20, 0]]) })],
    ["8 shade upper bound", (b) => ({ ...b, shadeLayers: [...b.shadeLayers, ...b.shadeLayers] })],
    ["9a shade layer", (b) => ({ ...b, shadeLayers: [shade(1, [8, 0, 0, 0], [6, 286, -20, -10])] })],
    ["9b a tint", (b) => ({ ...b, shadeLayers: [shade(2, [8, 0, 5, 0], [6, 286, -20, -10])] })],
    ["9b a tint past the 255 range", (b) => ({ ...b, shadeLayers: [shade(2, [8, 0, 0, 0], [6, 300, -20, -10])] })],
    ["9b cells past the end", (b) => ({ ...b, shadeLayers: [shade(2, [8, 0, 0, 0], [9, 286, -20, -10])] })],
    ["10 light upper bound", (b) => ({ ...b, lights: [...b.lights, light()] })],
    ["11 light layer", (b) => ({ ...b, lights: at(b.lights, 0, { layer: 2 }) })],
    ["12 light type", (b) => ({ ...b, lights: at(b.lights, 0, { type: 1 }) })],
    ["13 light nodes upper bound", (b) => ({ ...b, lights: at(b.lights, 0, { nodes: [...b.lights[0]!.nodes, point(0, 0)] }) })],
    ["14 light node", (b) => ({ ...b, lights: at(b.lights, 0, { nodes: [point(65, 48), point(96, 48), point(64, 80)] }) })],
    ["15 light colours upper bound", (b) => ({ ...b, lights: at(b.lights, 0, { colours: [...b.lights[0]!.colours, { r: 9, g: 9, b: 9 }] }) })],
    ["16 light colour", (b) => ({ ...b, lights: at(b.lights, 0, { colours: [{ r: 0, g: 0, b: 0 }, { r: 60, g: 51, b: 20 }] }) })],
    ["17 vector upper bound", (b) => ({ ...b, vectors: [...b.vectors, vector()] })],
    ["18 vector points upper bound", (b) => ({ ...b, vectors: at(b.vectors, 0, { points: [...b.vectors[0]!.points, point(1, 1)] }) })],
    ["19 vector point", (b) => ({ ...b, vectors: at(b.vectors, 0, { points: [point(0, 9), point(128, 8)] }) })],
    ["20 under attributes", (b) => ({ ...b, vectors: at(b.vectors, 1, { attributes: 5 }) })],
    ["20 stairs target", (b) => ({ ...b, vectors: at(b.vectors, 2, { attributes: 1 }) })],
    ["21 vector closed", (b) => ({ ...b, vectors: at(b.vectors, 0, { closed: -1 }) })],
    ["22 vector layer", (b) => ({ ...b, vectors: at(b.vectors, 0, { layer: 2 }) })],
    ["23 vector type", (b) => ({ ...b, vectors: at(b.vectors, 0, { type: 16 }) })],
    ["24 vector handle", (b) => ({ ...b, vectors: at(b.vectors, 0, { handle: "h" }) })],
    ["25 program upper bound", (b) => ({ ...b, programs: [...b.programs, program()] })],
    ["26 program file", (b) => ({ ...b, programs: at(b.programs, 0, { program: "other.prg" }) })],
    ["26 program file of the empty slot", (b) => ({ ...b, programs: at(b.programs, 1, { program: "#send(1)" }) })],
    ["27 program graphic", (b) => ({ ...b, programs: at(b.programs, 0, { graphic: "x.gph" }) })],
    ["28 program initialVar", (b) => ({ ...b, programs: at(b.programs, 0, { initialVar: "other" }) })],
    ["29 program initialValue", (b) => ({ ...b, programs: at(b.programs, 0, { initialValue: "1" }) })],
    ["30 program finalVar", (b) => ({ ...b, programs: at(b.programs, 0, { finalVar: "other" }) })],
    ["31 program finalValue", (b) => ({ ...b, programs: at(b.programs, 0, { finalValue: "1" }) })],
    ["32 program activate", (b) => ({ ...b, programs: at(b.programs, 0, { activate: 0 }) })],
    ["33 program activationType", (b) => ({ ...b, programs: at(b.programs, 0, { activationType: 7 }) })],
    ["34 program distanceRepeat", (b) => ({ ...b, programs: at(b.programs, 0, { repeatDistance: 17 }) })],
    ["35 program layer", (b) => ({ ...b, programs: at(b.programs, 0, { layer: 2 }) })],
    ["36 program points upper bound", (b) => ({ ...b, programs: at(b.programs, 0, { points: [...b.programs[0]!.points, point(1, 1)] }) })],
    ["37 program point", (b) => ({ ...b, programs: at(b.programs, 0, { points: [point(33, 64), point(64, 64), point(64, 96), point(32, 96)] }) })],
    ["38 program closed", (b) => ({ ...b, programs: at(b.programs, 0, { closed: 0 }) })],
    ["39 program reserved", (b) => ({ ...b, programs: at(b.programs, 0, { handle: "other" }) })],
    ["40 item upper bound", (b) => ({ ...b, sprites: [...b.sprites, sprite()] })],
    ["41 item file", (b) => ({ ...b, sprites: at(b.sprites, 0, { itemFile: "other.itm" }) })],
    ["41 item file of the empty slot", (b) => ({ ...b, sprites: at(b.sprites, 1, { itemFile: "other.itm" }) })],
    ["42 item prgActivate", (b) => ({ ...b, sprites: at(b.sprites, 0, { activationPrg: "other.prg" }) })],
    ["43 item prgMultitask", (b) => ({ ...b, sprites: at(b.sprites, 0, { multitaskPrg: "other.prg" }) })],
    ["44a item initialVar", (b) => ({ ...b, sprites: at(b.sprites, 0, { initialVar: "other" }) })],
    ["44b item initialValue", (b) => ({ ...b, sprites: at(b.sprites, 0, { initialValue: "9" }) })],
    ["44c item finalVar", (b) => ({ ...b, sprites: at(b.sprites, 0, { finalVar: "other" }) })],
    ["44d item finalValue", (b) => ({ ...b, sprites: at(b.sprites, 0, { finalValue: "9" }) })],
    ["45a item loadingVar", (b) => ({ ...b, sprites: at(b.sprites, 0, { loadingVar: "other" }) })],
    ["45b item loadingValue", (b) => ({ ...b, sprites: at(b.sprites, 0, { loadingValue: "9" }) })],
    ["46 item activate", (b) => ({ ...b, sprites: at(b.sprites, 0, { activate: 0 }) })],
    ["47 item activationType", (b) => ({ ...b, sprites: at(b.sprites, 0, { activationType: 3 }) })],
    ["48a item x", (b) => ({ ...b, sprites: at(b.sprites, 0, { x: 49 }) })],
    ["48b item y", (b) => ({ ...b, sprites: at(b.sprites, 0, { y: 81 }) })],
    ["48c item layer", (b) => ({ ...b, sprites: at(b.sprites, 0, { layer: 2 }) })],
    ["49 item reserved", (b) => ({ ...b, sprites: at(b.sprites, 0, { reserved: 8 }) })],
    ["50 image upper bound", (b) => ({ ...b, images: [...b.images, image()] })],
    ["51 image file", (b) => ({ ...b, images: at(b.images, 0, { file: "other.png" }) })],
    ["52 image left", (b) => ({ ...b, images: at(b.images, 0, { left: 33 }) })],
    ["52 image top", (b) => ({ ...b, images: at(b.images, 0, { top: 17 }) })],
    ["53 image layer", (b) => ({ ...b, images: at(b.images, 0, { layer: 2 }) })],
    ["54 image type", (b) => ({ ...b, images: at(b.images, 0, { drawType: 2 }) })],
    ["55 image transparent colour", (b) => ({ ...b, images: at(b.images, 0, { transparent: { r: 255, g: 1, b: 255 } }) })],
    ["56 image reserved", (b) => ({ ...b, images: at(b.images, 0, { reserved: 100 }) })],
    ["57 thread upper bound", (b) => ({ ...b, threads: [...b.threads, ""] })],
    ["58 thread", (b) => ({ ...b, threads: ["ambient.prg", "other.prg"] })],
    ["59 constant upper bound", (b) => ({ ...b, constants: [...b.constants, ""] })],
    ["60 constant", (b) => ({ ...b, constants: ["gold", "silver", "7"] })],
    ["61 layer title 0", (b) => ({ ...b, layerTitles: ["other", "Ground", ""] })],
    ["61 layer title 1", (b) => ({ ...b, layerTitles: ["unused", "Cellar", ""] })],
    ["61 layer title 2", (b) => ({ ...b, layerTitles: ["unused", "Ground", "Roof"] })],
    ["62 link north", (b) => ({ ...b, links: { ...b.links, north: "other.brd" } })],
    ["62 link south", (b) => ({ ...b, links: { ...b.links, south: "other.brd" } })],
    ["62 link east", (b) => ({ ...b, links: { ...b.links, east: "other.prg" } })],
    ["62 link west", (b) => ({ ...b, links: { ...b.links, west: "other.brd" } })],
    ["63 background image", (b) => props(b, { backgroundImage: "other.png" })],
    ["64 background image type", (b) => props(b, { backgroundDrawType: 1 })],
    ["65 background colour", (b) => props(b, { backgroundColour: { r: 120, g: 161, b: 240 } })],
    ["66 music", (b) => props(b, { backgroundMusic: "other.ogg" })],
    ["67 enter program", (b) => props(b, { enterPrg: "other.prg" })],
    ["68 battle background", (b) => props(b, { battleBackground: "other.bkg" })],
    ["69 battle skill", (b) => props(b, { battleSkill: 3 })],
    ["70 allow battles", (b) => props(b, { allowBattles: 0 })],
    ["71 disable saving", (b) => props(b, { disableSaving: 0 })],
    ["72a ambient red", (b) => props(b, { ambient: { r: -9, g: -10, b: 0 } })],
    ["72b ambient green", (b) => props(b, { ambient: { r: -10, g: -9, b: 0 } })],
    ["72c ambient blue", (b) => props(b, { ambient: { r: -10, g: -10, b: 1 } })],
    ["73 start x", (b) => props(b, { start: { x: 65, y: 80, layer: 1 } })],
    ["74 start y", (b) => props(b, { start: { x: 64, y: 81, layer: 1 } })],
    ["75 start layer", (b) => props(b, { start: { x: 64, y: 80, layer: 2 } })],
    ["X5 trailing bytes", (b) => ({ ...b, residue: new Uint8Array([0, 1, 3]) })],
  ];
  ok(mutations.length >= 80);
  for (const [label, mutate] of mutations) {
    const result = run(mutate(cottage()));
    if (!result.ok) throw new Error(`${label} was refused: ${JSON.stringify(result.findings)}`);
    ok(JSON.stringify(result.scene) !== baseline, `${label}: the scene did not change, so the field is dropped`);
  }
});

void test("the size, the layer count and the coordinate system land as the contract's rows say", () => {
  const cases: readonly (readonly [number, string, boolean | undefined])[] = [
    [0, "2d", undefined],
    [1, "iso-stacked", undefined],
    [2, "iso-rotated", undefined],
    [4, "2d", true],
    [5, "iso-stacked", true],
    [6, "iso-rotated", true],
  ];
  for (const [coordType, projection, pixel] of cases) {
    // The iso-rotated grid is (3 + 2) by (3 + 2): 25 cells per layer; the others are 3 by 2: 6.
    const cells = (coordType & 3) === 2 ? 25 : 6;
    const { scene } = imported(bare({ sizeX: 3, sizeY: 2, sizeL: 2, coordType, ...tiles([[cells * 2, 0]]), layerTitles: ["", "", ""] }));
    equal(scene.projection, projection, `coordType ${coordType}`);
    equal(scene.pixelCoordinates, pixel, `coordType ${coordType}`);
    deepEqual(scene.size, { width: 3, height: 2 });
    deepEqual(
      scene.floors.map((floor) => floor.id),
      ["layer-1", "layer-2"],
    );
    equal(Object.hasOwn(scene, "pixelCoordinates"), pixel === true);
  }
  // On the rotated grid the tiles and the shading run over the whole 5 by 5 square, as stored.
  const rotated = bare({ sizeX: 3, sizeY: 2, coordType: 2, lut: ["", "a.tst1"], ...tiles([[10, 1], [15, 0]]), shadeLayers: [shade(1, [20, 1, 2, 3], [5, 4, 5, 6])] });
  const { scene } = imported(rotated);
  deepEqual(scene.floors[0]?.tiles, [[10, 1], [15, 0]]);
  deepEqual(scene.shading?.[0]?.cells, [[20, 1, 2, 3], [5, 4, 5, 6]]);
});

// ---------------------------------------------------------------- tiles and shading

void test("tile runs are maximal, run on across a row end, and never span a floor", () => {
  const board = bare({
    sizeX: 3,
    sizeY: 2,
    sizeL: 3,
    lut: ["", "a.tst1", "a.tst2"],
    // Stored in odd pieces: a one-cell marker, adjacent runs of one index, and runs over a row end and over a floor end (an N1 note).
    // Cells: layer 1 is 1 1 1 2 2 2, layer 2 is 2 2 2 2 2 2 (the run of 2 starts in layer 1), layer 3 is empty.
    tileRuns: [
      { lutIndex: 1, count: 1, marker: true },
      { lutIndex: 1, count: 2, marker: true },
      { lutIndex: 2, count: 1, marker: false },
      { lutIndex: 2, count: 1, marker: false },
      { lutIndex: 2, count: 7, marker: true },
      { lutIndex: 0, count: 6, marker: true },
    ],
    tileMatrix: [1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0],
    layerTitles: ["", "", "", ""],
  });
  const { scene, findings } = imported(board);
  deepEqual(scene.floors, [
    { id: "layer-1", tiles: [[3, 1], [3, 2]] },
    { id: "layer-2", tiles: [[6, 2]] },
    { id: "layer-3" },
  ]);
  deepEqual(
    findings.map((finding) => [finding.severity, finding.field, finding.path]),
    [["note", "N1", "floors[].tiles"]],
  );
});

void test("a floor of nothing but empty cells has no tiles key, and a board with no look-up table has no tilePalette", () => {
  const { scene } = imported(bare({ sizeX: 2, sizeY: 2, ...tiles([[4, 0]]) }));
  equal(Object.hasOwn(scene, "tilePalette"), false);
  deepEqual(scene.floors, [{ id: "layer-1" }]);
  // A present table is kept whole, even when nothing uses it.
  const table = imported(bare({ lut: [""], tileRuns: [{ lutIndex: 0, count: 1, marker: false }] })).scene;
  deepEqual(table.tilePalette, [{}]);
});

void test("the look-up table keeps every slot as stored: empty slots, trailing empty slots, and the animated tile", () => {
  const { scene } = imported(bare({ lut: ["", "a.tst1", "", "", "w.tan", "", ""], ...tiles([[1, 4]]) }));
  deepEqual(scene.tilePalette, [{}, { legacy: "a.tst1" }, {}, {}, { legacy: "w.tan" }, {}, {}]);
  deepEqual(scene.floors, [{ id: "layer-1", tiles: [[1, 4]] }]);
});

void test("cells past the end of the tile stream are carried, not dropped, and reported", () => {
  const board = bare({ sizeX: 2, sizeY: 1, lut: ["", "a.tst1"], ...tiles([[1, 0], [32_767, 1]]) });
  const { scene, findings } = imported(board);
  deepEqual(scene.floors, [{ id: "layer-1", tiles: [[1, 0], [1, 1]] }]);
  deepEqual(scene.legacy, { excessTiles: [32_766, 1] });
  deepEqual(fieldsOf(findings, "warning"), ["7"]);
  // The most a marker can carry: 32,768 cells, one of them a grid cell.
  const most = imported(bare({ lut: ["", "a.tst1"], ...tiles([[32_768, 1]]) }));
  deepEqual(most.scene.legacy, { excessTiles: [32_767, 1] });
  // A run that ends exactly on the last cell leaves nothing past it.
  equal(Object.hasOwn(imported(bare({ sizeX: 2, lut: ["", "a.tst1"], ...tiles([[2, 1]]) })).scene, "legacy"), false);
});

void test("shading runs are maximal, a count of 0 or less is one cell, and the records past the end are carried per layer", () => {
  const board = bare({
    sizeX: 3,
    sizeY: 2,
    sizeL: 2,
    ...tiles([[12, 0]]),
    layerTitles: ["", "", ""],
    shadeLayers: [
      // Maximal runs: the single cells and the run of one tint join; a count of 0 and of -5 each read as one cell, written 1.
      shade(2, [1, 5, 5, 5], [0, 5, 5, 5], [-5, 5, 5, 5], [1, 5, 5, 5], [1, 0, 0, 0], [1, 7, 8, 9]),
      // Each layer has its own residue: this one's final record covers 4 cells where 2 are left, so 2 go past the end.
      shade(1, [4, 1, 1, 1], [4, 2, 2, 2]),
      shade(1, [1, 1, 1, 1], [6, 2, 2, 2]),
    ],
  });
  const { scene, findings } = imported(board);
  deepEqual(scene.shading, [
    { floor: "layer-2", cells: [[4, 5, 5, 5], [1, 0, 0, 0], [1, 7, 8, 9]] },
    { floor: "layer-1", cells: [[4, 1, 1, 1], [2, 2, 2, 2]], legacy: { excessCells: [2, 2, 2, 2] } },
    { floor: "layer-1", cells: [[1, 1, 1, 1], [5, 2, 2, 2]], legacy: { excessCells: [1, 2, 2, 2] } },
  ]);
  deepEqual(
    findings.map((finding) => [finding.severity, finding.field, finding.path]),
    [
      ["note", "9b", "shading[0].cells"],
      ["warning", "9b", "shading[1].legacy.excessCells"],
      ["warning", "9b", "shading[2].legacy.excessCells"],
    ],
  );
  equal(Object.hasOwn(scene, "tilePalette"), false);
});

void test("the most a shading record can carry past the end is 32,766 cells", () => {
  const { scene } = imported(bare({ shadeLayers: [shade(1, [32_767, 3, 2, 1])] }));
  deepEqual(scene.shading, [{ floor: "layer-1", cells: [[1, 3, 2, 1]], legacy: { excessCells: [32_766, 3, 2, 1] } }]);
});

// ---------------------------------------------------------------- empty slots and defaults

void test("a board of defaults imports to the stamp and the required keys alone, threads and constants kept as stored", () => {
  const { scene, findings } = imported(bare());
  equal(JSON.stringify(scene), JSON.stringify({ contract: "scene", version: "1.0.0-pre.1", tags: ["imported"], metadata: { source: NAME }, projection: "2d", size: { width: 1, height: 1 }, floors: [{ id: "layer-1" }], threads: [], constants: [] }));
  deepEqual(findings, []);
  // The editor's own board holds one empty thread and one empty constant; a stored -1 is an empty list. They stay different.
  const editor = imported(bare({ threads: [""], constants: [""] })).scene;
  deepEqual(editor.threads, [""]);
  deepEqual(editor.constants, [""]);
  deepEqual(imported(bare()).scene.threads, []);
});

void test("empty program, item and image slots keep their slots and their other fields", () => {
  const board = bare({
    programs: [program({ layer: 1 }), program({ program: "a.prg", layer: 1 }), program({ layer: 1 })],
    sprites: [sprite({ itemFile: "a.itm", x: 3, y: 4 }), sprite({ x: -7, y: 32_767, layer: 1 }), sprite({ itemFile: "b.itm", x: 1, y: 2 })],
    images: [image({ file: "", left: -40, top: 9 }), image({ file: "a.png", left: 1, top: 2 })],
  });
  const { scene } = imported(board);
  deepEqual(scene.triggers, [{ floor: "layer-1" }, { floor: "layer-1", program: "a.prg" }, { floor: "layer-1" }]);
  deepEqual(scene.items, [
    { floor: "layer-1", item: "a.itm", x: 3, y: 4 },
    { floor: "layer-1", x: -7, y: 32_767 },
    { floor: "layer-1", item: "b.itm", x: 1, y: 2 },
  ]);
  deepEqual(scene.images, [
    { floor: "layer-1", x: -40, y: 9, transparent: [0, 0, 0] },
    { floor: "layer-1", source: "a.png", x: 1, y: 2, transparent: [0, 0, 0] },
  ]);
});

void test("the reserved values land in legacy only when they are not the editor's own, and inline program text is kept as stored", () => {
  const { scene } = imported(
    bare({
      programs: [program({ program: "#mwin(\"hi\")", handle: "ignored", graphic: "g.gph" }), program({ handle: "", graphic: "" })],
      sprites: [sprite({ reserved: -1 }), sprite({ reserved: 0 }), sprite({ reserved: -32_768 })],
      images: [image({ reserved: 100 }), image({ reserved: 0 }), image({ reserved: 32_767 })],
      layerTitles: ["zero", "one"],
    }),
  );
  deepEqual(scene.triggers, [{ floor: "layer-1", program: "#mwin(\"hi\")", legacy: { graphic: "g.gph", reserved: "ignored" } }, { floor: "layer-1" }]);
  deepEqual(scene.items?.map((item) => item.legacy), [undefined, { reserved: 0 }, { reserved: -32_768 }]);
  deepEqual(scene.images?.map((entry) => entry.legacy), [undefined, { reserved: 0 }, { reserved: 32_767 }]);
  deepEqual(scene.legacy, { layerTitleZero: "zero" });
  deepEqual(scene.floors, [{ id: "layer-1", title: "one" }]);
});

void test("2.x type sigils on a condition variable and text with spaces are kept exactly as stored", () => {
  const { scene } = imported(bare({ programs: [program({ activate: 1, initialVar: "!count", initialValue: " 5 ", finalVar: "$name", finalValue: "A b" })] }));
  deepEqual(scene.triggers, [{ floor: "layer-1", condition: { mode: "conditional", variable: "!count", value: " 5 " }, afterRun: { variable: "$name", value: "A b" } }]);
});

void test("a run-once program is stored exactly as the editor stores it", () => {
  const { scene } = imported(bare({ programs: [program({ program: "once.prg", activate: 1, initialVar: "9c1e", finalVar: "9c1e", finalValue: "_guid" })] }));
  deepEqual(scene.triggers, [{ floor: "layer-1", program: "once.prg", condition: { mode: "conditional", variable: "9c1e" }, afterRun: { variable: "9c1e", value: "_guid" } }]);
});

void test("a condition stored on an always-active record is carried, not discarded", () => {
  const { scene } = imported(bare({ sprites: [sprite({ activate: 0, initialVar: "v", initialValue: "1", loadingVar: "l" })] }));
  deepEqual(scene.items?.[0]?.condition, { variable: "v", value: "1" });
  deepEqual(scene.items?.[0]?.loadCondition, { variable: "l" });
});

void test("activation flags land by bit: the trigger has three, the item two, and none set is stepping in", () => {
  const triggerBits = [0, 1, 2, 4, 3, 5, 6, 7].map((activationType) => imported(bare({ programs: [program({ activationType })] })).scene.triggers?.[0]?.activation);
  deepEqual(triggerBits, [
    undefined,
    { keyPress: true },
    { repeat: true },
    { stopsMovement: true },
    { keyPress: true, repeat: true },
    { keyPress: true, stopsMovement: true },
    { repeat: true, stopsMovement: true },
    { keyPress: true, repeat: true, stopsMovement: true },
  ]);
  const itemBits = [0, 1, 2, 3].map((activationType) => imported(bare({ sprites: [sprite({ activationType })] })).scene.items?.[0]?.activation);
  deepEqual(itemBits, [undefined, { keyPress: true }, { repeat: true }, { keyPress: true, repeat: true }]);
  deepEqual(imported(bare({ programs: [program({ repeatDistance: -3 })] })).scene.triggers?.[0]?.activation, { repeatDistance: -3 });
});

void test("the board-wide blocks are left out when every value is a default, and kept whole when any one is not", () => {
  const empty = imported(bare()).scene;
  for (const key of ["atmosphere", "start", "links", "battle", "enterProgram", "savingDisabled", "legacy"]) equal(Object.hasOwn(empty, key), false, key);
  const { scene } = imported(
    bare({
      links: { north: "", south: "s.brd", east: "", west: "" },
      properties: properties({ backgroundDrawType: 1, battleSkill: -2, backgroundColour: { r: 0, g: 0, b: 1 } }),
    }),
  );
  deepEqual(scene.links, { south: "s.brd" });
  // The background type is kept even when no image is named.
  deepEqual(scene.atmosphere, { background: { type: "parallax", color: [0, 0, 1] } });
  deepEqual(scene.battle, { skill: -2 });
});

// ---------------------------------------------------------------- layers

void test("a stored layer is a floor reference when a floor has it, and the stored number with a warning when none does", () => {
  const board = bare({
    sizeL: 2,
    ...tiles([[2, 0]]),
    layerTitles: ["", "", ""],
    lights: [light({ layer: 2 }), light({ layer: 3 })],
    vectors: [vector({ layer: 1 }), vector({ layer: 0 }), vector({ layer: -4 }), vector({ layer: 3 })],
    programs: [program({ layer: 9 })],
    sprites: [sprite({ layer: 0 })],
    images: [image({ layer: 32_767 })],
    shadeLayers: [shade(1, [1, 0, 0, 0]), shade(7, [1, 0, 0, 0]), shade(-2_000_000_000, [1, 0, 0, 0])],
  });
  const { scene, findings } = imported(board);
  deepEqual(
    scene.lights?.map((entry) => ("floor" in entry ? entry.floor : entry.layer)),
    ["layer-2", 3],
  );
  deepEqual(
    scene.vectors?.map((entry) => ("floor" in entry ? entry.floor : entry.layer)),
    ["layer-1", 0, -4, 3],
  );
  equal(Object.hasOwn(scene.vectors![1]!, "floor"), false, "exactly one of floor and layer");
  deepEqual(scene.triggers?.[0], { layer: 9 });
  deepEqual(scene.items?.[0], { layer: 0, x: 0, y: 0 });
  deepEqual(scene.images?.[0], { layer: 32_767, x: 0, y: 0, transparent: [0, 0, 0] });
  deepEqual(
    scene.shading?.map((entry) => ("floor" in entry ? entry.floor : entry.layer)),
    ["layer-1", 7, -2_000_000_000],
  );
  deepEqual(
    findings.map((finding) => [finding.severity, finding.field, finding.path]),
    [
      ["warning", "9a", "shading[1].layer"],
      ["warning", "9a", "shading[2].layer"],
      ["warning", "11", "lights[1].layer"],
      ["warning", "22", "vectors[1].layer"],
      ["warning", "22", "vectors[2].layer"],
      ["warning", "22", "vectors[3].layer"],
      ["warning", "35", "triggers[0].layer"],
      ["warning", "48c", "items[0].layer"],
      ["warning", "53", "images[0].layer"],
    ],
  );
});

void test("a stairs target is a floor when a layer has it and toLayer otherwise, and exactly one of the two is written", () => {
  const { scene, findings } = imported(
    bare({ sizeL: 2, ...tiles([[2, 0]]), layerTitles: ["", "", ""], vectors: [vector({ type: 8, attributes: 2 }), vector({ type: 8, attributes: 5 }), vector({ type: 8, attributes: 0 }), vector({ type: 8, attributes: -1 })] }),
  );
  deepEqual(
    scene.vectors?.map((entry) => [entry.toFloor, entry.toLayer, entry.attributes]),
    [["layer-2", undefined, undefined], [undefined, 5, undefined], [undefined, 0, undefined], [undefined, -1, undefined]],
  );
  deepEqual(findings, []);
});

void test("the start: defaults are an absent key, a layer outside the board is kept as stored, and the normalisations are noted", () => {
  const start = (x: number, y: number, layer: number, sizeL = 1): SceneImportSuccess =>
    imported(bare({ sizeL, ...tiles([[sizeL, 0]]), layerTitles: Array.from({ length: sizeL + 1 }, () => ""), properties: properties({ start: { x, y, layer } }) }));
  const defaults = start(64, 64, 1);
  equal(Object.hasOwn(defaults.scene, "start"), false);
  deepEqual(defaults.findings, []);

  const unset = start(0, -5, 0);
  equal(Object.hasOwn(unset.scene, "start"), false);
  deepEqual(
    unset.findings.map((finding) => [finding.severity, finding.field]),
    [["note", "73"], ["note", "74"], ["note", "75"]],
  );

  deepEqual(start(1, 32_767, 2, 3).scene.start, { x: 1, y: 32_767, floor: "layer-2" });
  const beyond = start(70, 64, 4, 3);
  deepEqual(beyond.scene.start, { x: 70, layer: 4 });
  deepEqual(
    beyond.findings.map((finding) => [finding.severity, finding.field, finding.path]),
    [["warning", "75", "start.layer"]],
  );
});

// ---------------------------------------------------------------- numbers carried exactly as stored

void test("signed offsets are carried exactly: a channel outside -255 to 255 is a note, never a refusal and never clamped", () => {
  const { scene, findings } = imported(
    bare({
      sizeX: 2,
      ...tiles([[2, 0]]),
      shadeLayers: [shade(1, [2, 286, -300, 32_767])],
      lights: [light({ colours: [{ r: -32_768, g: 255, b: -255 }, { r: 256, g: 0, b: 0 }] })],
      properties: properties({ ambient: { r: 300, g: -256, b: 0 } }),
    }),
  );
  deepEqual(scene.shading?.[0]?.cells, [[2, 286, -300, 32_767]]);
  deepEqual(scene.lights?.[0]?.colors, [[-32_768, 255, -255], [256, 0, 0]]);
  deepEqual(scene.atmosphere?.ambient, [300, -256, 0]);
  deepEqual(
    findings.map((finding) => [finding.severity, finding.field]),
    [["note", "9b"], ["note", "16"], ["note", "72"]],
  );
  // The documented range, edges included, is not a note.
  deepEqual(imported(bare({ properties: properties({ ambient: { r: 255, g: -255, b: 0 } }) })).findings, []);
});

void test("a non-zero flag reads as true and is written as true; any value but the editor's -1 is noted", () => {
  const { scene, findings } = imported(
    bare({
      vectors: [vector({ closed: -1 }), vector({ closed: 1 }), vector({ closed: 0 }), vector({ closed: 32_767 })],
      programs: [program({ closed: -1 }), program({ closed: 2 }), program({ closed: 0 })],
      properties: properties({ allowBattles: 1, disableSaving: -1 }),
    }),
  );
  deepEqual(scene.vectors?.map((entry) => entry.closed), [true, true, false, true]);
  deepEqual(scene.triggers?.map((entry) => entry.closed), [true, true, undefined]);
  equal(scene.battle?.allowed, true);
  equal(scene.savingDisabled, true);
  deepEqual(
    findings.map((finding) => [finding.severity, finding.field, finding.path]),
    [
      ["note", "21", "vectors[1].closed"],
      ["note", "21", "vectors[3].closed"],
      ["note", "38", "triggers[1].closed"],
      ["note", "70", "battle.allowed"],
    ],
  );
  // A flag stored as 0 is false: nothing is written for it.
  const off = imported(bare({ properties: properties({ allowBattles: 0, disableSaving: 0 }) })).scene;
  equal(Object.hasOwn(off, "battle"), false);
  equal(Object.hasOwn(off, "savingDisabled"), false);
});

void test("a vector's type, mask and the unidirectional kind land as the rows say", () => {
  const { scene } = imported(
    bare({
      vectors: [vector({ type: 0 }), vector({ type: 1 }), vector({ type: 2, attributes: 0 }), vector({ type: 2, attributes: 7 }), vector({ type: 4 }), vector({ type: 16, handle: "w" })],
    }),
  );
  deepEqual(
    scene.vectors?.map((entry) => [entry.type, entry.attributes]),
    [["none", undefined], ["solid", undefined], ["under", undefined], ["under", 7], ["unidirectional", undefined], ["waypoint", undefined]],
  );
  deepEqual(scene.vectors?.[5]?.handle, "w");
});

void test("every light type and every image type lands, in the stored order of nodes and colours", () => {
  const { scene } = imported(
    bare({
      lights: [light({ type: 0 }), light({ type: 1, nodes: [point(9, 9), point(1, 1)] }), light({ type: 2, nodes: [point(0, 0)], colours: [] })],
      images: [image({ drawType: 0 }), image({ drawType: 1 }), image({ drawType: 2 })],
    }),
  );
  deepEqual(
    scene.lights?.map((entry) => entry.type),
    ["ellipse", "gradient", "clipped-gradient"],
  );
  deepEqual(scene.lights?.[1]?.nodes, [[9, 9], [1, 1]]);
  deepEqual(scene.lights?.[2]?.colors, []);
  deepEqual(
    scene.images?.map((entry) => entry.type),
    [undefined, "parallax", "stretch"],
  );
});

// ---------------------------------------------------------------- the trailing bytes

void test("trailing bytes are carried as RFC 4648 base64 with padding, whatever their length, and reported", () => {
  for (let length = 1; length <= 9; length += 1) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 250) & 0xff);
    const { scene, findings } = imported(bare({ residue: bytes }));
    equal(scene.legacy?.trailingBytes, Buffer.from(bytes).toString("base64"), `${length} bytes`);
    deepEqual(fieldsOf(findings, "warning"), ["X5"]);
  }
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  equal(imported(bare({ residue: all })).scene.legacy?.trailingBytes, Buffer.from(all).toString("base64"));
  equal(Object.hasOwn(imported(bare()).scene, "legacy"), false, "no bytes, no key");
});

void test("the legacy block holds its keys in the contract's order and nothing else", () => {
  const { scene } = imported(bare({ sizeX: 2, lut: ["", "a.tst1"], ...tiles([[3, 1]]), layerTitles: ["z", ""], residue: new Uint8Array([1]) }));
  deepEqual(Object.keys(scene.legacy ?? {}), ["layerTitleZero", "trailingBytes", "excessTiles"]);
  deepEqual(scene.legacy, { layerTitleZero: "z", trailingBytes: "AQ==", excessTiles: [1, 1] });
});

// ---------------------------------------------------------------- refusals: a limit of the contract, every cause named, nothing written

void test("a size, a layer count or a coordinate type the contract has no key for is refused, by field", () => {
  deepEqual(refusedFields(bare({ sizeX: 0, ...tiles([]) })), ["1"]);
  deepEqual(refusedFields(bare({ sizeY: -1 })), ["2"]);
  deepEqual(refusedFields(bare({ sizeL: 0, layerTitles: [""] })), ["3"]);
  deepEqual(refusedFields(bare({ sizeX: 0, sizeY: 0, sizeL: -2 })), ["1", "2", "3"]);
  for (const coordType of [3, 7, 8, -1, 12]) deepEqual(refusedFields(bare({ coordType })), ["4"], `coordType ${coordType}`);
  // More cells than the board limit allows: refused before any cell is read.
  deepEqual(refusedFields(bare({ sizeX: 2048, sizeY: 2048, sizeL: 2, ...tiles([]), tileMatrix: [], layerTitles: ["", "", ""] })), ["3"]);
  deepEqual(refusedFields(bare({ sizeX: 1025, sizeY: 1024, coordType: 2, ...tiles([]), tileMatrix: [] })), ["3"]);
});

void test("a table whose slot 0 is not empty, and a cell outside the table, are refused", () => {
  deepEqual(refusedFields(bare({ lut: ["a.tst1"], ...tiles([[1, 0]]) })), ["6"]);
  const outside = refused(bare({ sizeX: 3, lut: ["", "a.tst1"], ...tiles([[1, 1], [1, 2], [1, 2]]) }));
  deepEqual(outside.map((finding) => [finding.severity, finding.field]), [["refusal", "7"], ["note", "N1"]]);
  ok(outside[0]!.message.includes("index 2") && outside[0]!.message.includes("x 2"), outside[0]!.message);
  // Without a table every cell must be 0.
  const none = refused(bare({ sizeX: 2, ...tiles([[1, 0], [1, 1]]) }));
  ok(none[0]!.message.includes("no look-up table"));
  deepEqual(refusedFields(bare({ lut: ["", "a.tst1"], tileMatrix: [-1] })), ["7"]);
});

void test("a stream that ends before its cells are covered, and a tail that is not the final run, are refused", () => {
  deepEqual(refusedFields(bare({ sizeX: 3, tileMatrix: [0, 0] })), ["7"]);
  deepEqual(refusedFields(bare({ sizeX: 2, lut: ["", "a.tst1", "b.tst2"], tileMatrix: [0, 1, 2] })), ["7"]);
  deepEqual(refusedFields(bare({ sizeX: 2, lut: ["", "a.tst1"], tileMatrix: Array.from({ length: 2 + 32_768 }, () => 1) })), ["7"]);
  deepEqual(refusedFields(bare({ shadeLayers: [{ castLayer: 1, records: [] }] })), ["9b"]);
  deepEqual(refusedFields(bare({ sizeX: 3, ...tiles([[3, 0]]), shadeLayers: [shade(1, [2, 0, 0, 0])] })), ["9b"]);
  deepEqual(refusedFields(bare({ sizeX: 1, shadeLayers: [shade(1, [1, 0, 0, 0], [1, 0, 0, 0])] })), ["9b"]);
  deepEqual(refusedFields(bare({ shadeLayers: [shade(1, [32_768, 0, 0, 0])] })), ["9b"]);
});

void test("a vector, light, image, trigger or item holding a stored value the contract has no key for is refused, by field", () => {
  deepEqual(refusedFields(bare({ vectors: [vector({ points: [point(1, 1)] })] })), ["18"]);
  deepEqual(refusedFields(bare({ vectors: [vector({ points: [] })] })), ["18"]);
  for (const type of [3, 5, 6, 7, 9, 15, 17, 32, -1]) deepEqual(refusedFields(bare({ vectors: [vector({ type })] })), ["23"], `vector type ${type}`);
  deepEqual(refusedFields(bare({ vectors: [vector({ type: 2, attributes: 8 })] })), ["20"]);
  deepEqual(refusedFields(bare({ vectors: [vector({ type: 2, attributes: -1 })] })), ["20"]);
  for (const type of [0, 1, 4, 16]) deepEqual(refusedFields(bare({ vectors: [vector({ type, attributes: 1 })] })), ["20"], `attributes on type ${type}`);
  for (const type of [3, -1, 9]) deepEqual(refusedFields(bare({ lights: [light({ type })] })), ["12"], `light type ${type}`);
  for (const drawType of [3, -1, 100]) deepEqual(refusedFields(bare({ images: [image({ drawType })] })), ["54"], `image type ${drawType}`);
  deepEqual(refusedFields(bare({ properties: properties({ backgroundDrawType: 3 }) })), ["64"]);
  for (const activate of [2, -1, 7]) {
    deepEqual(refusedFields(bare({ programs: [program({ activate })] })), ["32"], `trigger activate ${activate}`);
    deepEqual(refusedFields(bare({ sprites: [sprite({ activate })] })), ["46"], `item activate ${activate}`);
  }
  for (const activationType of [8, 16, -1]) deepEqual(refusedFields(bare({ programs: [program({ activationType })] })), ["33"], `trigger activationType ${activationType}`);
  for (const activationType of [4, 8, -1]) deepEqual(refusedFields(bare({ sprites: [sprite({ activationType })] })), ["47"], `item activationType ${activationType}`);
  deepEqual(refusedFields(bare({ layerTitles: [""] })), ["61"]);
  deepEqual(refusedFields(bare({ layerTitles: ["", "", "extra"] })), ["61"]);
});

void test("every refusal is collected, so one run names every cause, and a refusal returns no scene", () => {
  const board = bare({
    coordType: 3,
    lut: ["x.tst1"],
    vectors: [vector({ type: 3 }), vector({ points: [point(0, 0)] })],
    lights: [light({ type: 9 })],
    images: [image({ drawType: 4 })],
    programs: [program({ activate: 5 })],
    sprites: [sprite({ activationType: 8 })],
  });
  const result = run(board);
  equal(result.ok, false);
  deepEqual(
    result.findings.filter((finding) => finding.severity === "refusal").map((finding) => [finding.field, finding.path]),
    [
      ["4", "projection"],
      ["6", "tilePalette[0]"],
      ["12", "lights[0].type"],
      ["23", "vectors[0].type"],
      ["18", "vectors[1].points"],
      ["32", "triggers[0].condition.mode"],
      ["47", "items[0].activation"],
      ["54", "images[0].type"],
    ],
  );
  equal("scene" in result, false);
  equal("scenePath" in result, false);
  // The source board stays what it was: nothing was altered while refusing.
  equal(board.lut[0], "x.tst1");
});

// ---------------------------------------------------------------- semantic equality over every field, on real boards

/** The decoded fields of a board with the contract's normalisations applied and nothing else: the "semantic equality" side of a board. */
function viewOfBoard(board: Board): unknown {
  const tint = (records: BoardShadeLayer["records"]): (readonly number[])[] => {
    const runs: number[][] = [];
    for (const record of records) {
      const count = record.runCount > 1 ? record.runCount : 1;
      const last = runs[runs.length - 1];
      if (last !== undefined && last[1] === record.r && last[2] === record.g && last[3] === record.b) last[0]! += count;
      else runs.push([count, record.r, record.g, record.b]);
    }
    return runs;
  };
  const p = board.properties;
  return {
    size: [board.sizeX, board.sizeY, board.sizeL],
    coordType: board.coordType,
    lut: board.lut,
    tiles: board.tileMatrix,
    shading: board.shadeLayers.map((layer) => ({ cast: layer.castLayer, runs: tint(layer.records) })),
    lights: board.lights.map((l) => ({ ...l, nodes: l.nodes.map((n) => [n.x, n.y]), colours: l.colours.map((c) => [c.r, c.g, c.b]) })),
    vectors: board.vectors.map((v) => ({ ...v, points: v.points.map((n) => [n.x, n.y]), closed: v.closed !== 0 })),
    programs: board.programs.map((g) => ({ ...g, points: g.points.map((n) => [n.x, n.y]), closed: g.closed !== 0 })),
    sprites: board.sprites,
    images: board.images.map((m) => ({ ...m, transparent: [m.transparent.r, m.transparent.g, m.transparent.b] })),
    threads: board.threads,
    constants: board.constants,
    titles: board.layerTitles,
    links: board.links,
    properties: {
      backgroundImage: p.backgroundImage,
      backgroundDrawType: p.backgroundDrawType,
      backgroundColour: [p.backgroundColour.r, p.backgroundColour.g, p.backgroundColour.b],
      backgroundMusic: p.backgroundMusic,
      enterPrg: p.enterPrg,
      battleBackground: p.battleBackground,
      battleSkill: p.battleSkill,
      allowBattles: p.allowBattles !== 0,
      disableSaving: p.disableSaving !== 0,
      ambient: [p.ambient.r, p.ambient.g, p.ambient.b],
      start: [p.start.x <= 0 ? 64 : p.start.x, p.start.y <= 0 ? 64 : p.start.y, p.start.layer <= 0 ? 1 : p.start.layer],
    },
    residue: Array.from(board.residue),
  };
}

/** The same view built back from a scene alone: the inverse of the contract's field rows, which is what a build writes. */
function viewOfScene(scene: ImportedScene): unknown {
  const layerOf = (ref: { readonly floor?: string; readonly layer?: number }): number => (ref.floor !== undefined ? Number(ref.floor.slice("layer-".length)) : (ref.layer ?? 1));
  const cellsPer = (scene.projection === "iso-rotated" ? (scene.size.width + scene.size.height) ** 2 : scene.size.width * scene.size.height);
  const tiles = scene.floors.flatMap((floor) => (floor.tiles ?? [[cellsPer, 0]]).flatMap(([count, index]) => Array.from({ length: count }, () => index)));
  const excess = scene.legacy?.excessTiles;
  if (excess !== undefined) tiles.push(...Array.from({ length: excess[0] }, () => excess[1]));
  const coordType = (["2d", "iso-stacked", "iso-rotated"] as const).indexOf(scene.projection) + (scene.pixelCoordinates === true ? 4 : 0);
  const typeNumber = { none: 0, solid: 1, under: 2, unidirectional: 4, stairs: 8, waypoint: 16 } as const;
  const lightNumber = { ellipse: 0, gradient: 1, "clipped-gradient": 2 } as const;
  const drawNumber = (type: "normal" | "parallax" | "stretch" | undefined): number => (type === undefined || type === "normal" ? 0 : type === "parallax" ? 1 : 2);
  const bg = scene.atmosphere?.background;
  const start = scene.start;
  return {
    size: [scene.size.width, scene.size.height, scene.floors.length],
    coordType,
    lut: scene.tilePalette?.map((entry) => entry.legacy ?? "") ?? [],
    tiles,
    shading: (scene.shading ?? []).map((layer) => ({ cast: layerOf(layer), runs: [...layer.cells, ...(layer.legacy?.excessCells === undefined ? [] : [layer.legacy.excessCells])].reduce<number[][]>((runs, [count, r, g, b]) => {
      const last = runs[runs.length - 1];
      if (last !== undefined && last[1] === r && last[2] === g && last[3] === b) last[0]! += count;
      else runs.push([count, r, g, b]);
      return runs;
    }, []) })),
    lights: (scene.lights ?? []).map((l) => ({ layer: layerOf(l), type: lightNumber[l.type], nodes: l.nodes, colours: l.colors })),
    vectors: (scene.vectors ?? []).map((v) => ({
      points: v.points,
      attributes: v.type === "under" ? (v.attributes ?? 0) : v.type === "stairs" ? (v.toFloor !== undefined ? layerOf({ floor: v.toFloor }) : v.toLayer) : 0,
      closed: v.closed,
      layer: layerOf(v),
      type: typeNumber[v.type],
      handle: v.handle ?? "",
    })),
    programs: (scene.triggers ?? []).map((g) => ({
      program: g.program ?? "",
      graphic: g.legacy?.graphic ?? "",
      initialVar: g.condition?.variable ?? "",
      initialValue: g.condition?.value ?? "",
      finalVar: g.afterRun?.variable ?? "",
      finalValue: g.afterRun?.value ?? "",
      activate: g.condition?.mode === "conditional" ? 1 : 0,
      activationType: (g.activation?.keyPress === true ? 1 : 0) | (g.activation?.repeat === true ? 2 : 0) | (g.activation?.stopsMovement === true ? 4 : 0),
      repeatDistance: g.activation?.repeatDistance ?? 0,
      layer: layerOf(g),
      points: g.points ?? [],
      closed: g.closed ?? false,
      handle: g.legacy?.reserved ?? "",
    })),
    sprites: (scene.items ?? []).map((s) => ({
      itemFile: s.item ?? "",
      activationPrg: s.activationProgram ?? "",
      multitaskPrg: s.multitaskProgram ?? "",
      initialVar: s.condition?.variable ?? "",
      initialValue: s.condition?.value ?? "",
      finalVar: s.afterRun?.variable ?? "",
      finalValue: s.afterRun?.value ?? "",
      loadingVar: s.loadCondition?.variable ?? "",
      loadingValue: s.loadCondition?.value ?? "",
      activate: s.condition?.mode === "conditional" ? 1 : 0,
      activationType: (s.activation?.keyPress === true ? 1 : 0) | (s.activation?.repeat === true ? 2 : 0),
      x: s.x,
      y: s.y,
      layer: layerOf(s),
      reserved: s.legacy?.reserved ?? -1,
    })),
    images: (scene.images ?? []).map((m) => ({ file: m.source ?? "", left: m.x, top: m.y, layer: layerOf(m), drawType: drawNumber(m.type), transparent: m.transparent, reserved: m.legacy?.reserved ?? 100 })),
    threads: scene.threads,
    constants: scene.constants,
    titles: [scene.legacy?.layerTitleZero ?? "", ...scene.floors.map((floor) => floor.title ?? "")],
    links: { north: scene.links?.north ?? "", south: scene.links?.south ?? "", east: scene.links?.east ?? "", west: scene.links?.west ?? "" },
    properties: {
      backgroundImage: bg?.image ?? "",
      backgroundDrawType: drawNumber(bg?.type),
      backgroundColour: bg?.color ?? [0, 0, 0],
      backgroundMusic: scene.atmosphere?.music ?? "",
      enterPrg: scene.enterProgram ?? "",
      battleBackground: scene.battle?.background ?? "",
      battleSkill: scene.battle?.skill ?? 0,
      allowBattles: scene.battle?.allowed ?? false,
      disableSaving: scene.savingDisabled ?? false,
      ambient: scene.atmosphere?.ambient ?? [0, 0, 0],
      start: [start?.x ?? 64, start?.y ?? 64, start === undefined ? 1 : layerOf(start)],
    },
    residue: scene.legacy?.trailingBytes === undefined ? [] : Array.from(Buffer.from(scene.legacy.trailingBytes, "base64")),
  };
}

/** A board of either layout, as the legacy decoder returns it: a pre-vector board is converted first, as the import's contract says. */
function decodeBoard(bytes: Uint8Array): { readonly board: Board; readonly layout: "vector" | "pre-vector" } | { readonly error: string } {
  const header = new BinaryReader(bytes).header();
  if (header.ok && boardLayout(header.value.minor) === "pre-vector") {
    const pre = readPreVectorBoard(new BinaryReader(bytes));
    if (!pre.ok) return { error: pre.error.message };
    const converted = convertPreVectorBoard(pre.value);
    return converted.ok ? { board: converted.value, layout: "pre-vector" } : { error: converted.error.message };
  }
  const read = readBoard(new BinaryReader(bytes));
  return read.ok ? { board: read.value, layout: "vector" } : { error: read.error.message };
}

function boardFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) boardFiles(path, found);
    else if (/\.brd$/i.test(entry.name)) found.push(path);
  }
  return found;
}

void test("the sample board, imported and built back by the contract's rows, equals the source in every field", () => {
  deepEqual(viewOfScene(imported(cottage()).scene), viewOfBoard(cottage()));
});

void test("every board the repository holds imports, and built back by the rows equals its source in every field, or is refused with a named cause", (t) => {
  const origins = [join(root, "docs", "spec", "examples"), join(root, "fixtures", "legacy")];
  let vectorExamples = 0;
  let converted = 0;
  let refusedCount = 0;
  let undecodable = 0;
  let wide = 0;
  let overshoot = 0;
  for (const origin of origins) {
    if (!existsSync(origin)) continue;
    const isExample = origin === origins[0];
    for (const path of boardFiles(origin)) {
      const label = path.slice(root.length);
      const decoded = decodeBoard(new Uint8Array(readFileSync(path)));
      if ("error" in decoded) {
        // A damaged fixture is not the importer's input; an example board always decodes.
        ok(!isExample, `${label} did not decode: ${decoded.error}`);
        undecodable += 1;
        continue;
      }
      const board = decoded.board;
      const options = { boardName: path.slice(path.lastIndexOf("/") + 1), existingPaths: [] };
      const result = importBoardToScene(board, options);
      // A board of the vector layout in the example games imports; one brought up from the pre-vector layout, or a fixture, may hold a value this first cut has no key for.
      if (isExample && decoded.layout === "vector") ok(result.ok, `${label} was refused: ${JSON.stringify(result.findings)}`);
      if (!result.ok) {
        ok(result.findings.some((finding) => finding.severity === "refusal" && finding.message.length > 0 && finding.field.length > 0), `${label}: a refusal names its cause`);
        refusedCount += 1;
        continue;
      }
      if (isExample && decoded.layout === "vector") vectorExamples += 1;
      converted += 1;
      deepEqual(viewOfScene(result.scene), viewOfBoard(board), label);
      if (result.findings.some((finding) => finding.field === "9b" && finding.message.includes("outside -255"))) wide += 1;
      if (result.scene.legacy?.excessTiles !== undefined || result.scene.shading?.some((layer) => layer.legacy !== undefined)) overshoot += 1;
      // Deterministic: the same board gives the same text.
      equal(JSON.stringify(importBoardToScene(board, options)), JSON.stringify(result), label);
    }
  }
  ok(vectorExamples >= 2, "the example games' vector boards are always there");
  t.diagnostic(`${converted} boards imported (${vectorExamples} vector examples), ${refusedCount} refused, ${undecodable} not decodable, ${wide} with a channel outside -255 to 255, ${overshoot} with cells past the end`);
});

// ---------------------------------------------------------------- the recovery import (import rule 7)

const recover = (board: Board, existingPaths: readonly string[] = [], boardName = NAME): SceneImportResult => recoverBoardToScene(board, { boardName, existingPaths });

void test("a recovery import proposes the same scene as the import, at a new path beside the scene that exists, and notes every scene-only feature", () => {
  const existing = ["Boards/Cottage.tkrscn", "Boards/Cottage.brd"];
  // The plain import refuses: the scene is there.
  equal(run(cottage(), NAME, existing).ok, false);
  const result = recover(cottage(), existing);
  if (!result.ok) throw new Error(JSON.stringify(result.findings));
  equal(result.scenePath, "Boards/Cottage.recovered.tkrscn");
  deepEqual(result.scene, imported(cottage()).scene);
  equal(JSON.stringify(result.scene), JSON.stringify(COTTAGE_SCENE));
  const plain = imported(cottage()).findings;
  deepEqual(result.findings.slice(0, plain.length), plain, "the import's own findings come first, unchanged");
  const notes = result.findings.slice(plain.length);
  deepEqual(
    notes.map((finding) => [finding.severity, finding.field]),
    ["U1", "U2", "U3", "U4", "U5", "U6", "U7", "U8", "U9"].map((field) => ["note", field]),
  );
  ok(notes.every((finding) => finding.path.length > 0 && finding.message.length > 0));
  // The plain import's findings carry none of them.
  ok(plain.every((finding) => !finding.field.startsWith("U")));
});

void test("a recovery import never targets an existing path: the first free name of the series, compared by the ID fold", () => {
  equal((recover(bare()) as SceneImportSuccess).scenePath, "Boards/Cottage.recovered.tkrscn");
  const taken = ["Boards/Cottage.tkrscn", "boards/cottage.RECOVERED.tkrscn", "Boards\\Cottage.recovered-2.TKRSCN", "Boards/Cottage.recovered-4.tkrscn"];
  const result = recover(bare(), taken);
  if (!result.ok) throw new Error("expected a proposal");
  equal(result.scenePath, "Boards/Cottage.recovered-3.tkrscn");
  for (const existing of taken) ok(result.scenePath.toLowerCase() !== existing.toLowerCase().replaceAll("\\", "/"));
  // The series is the same for a board in a sub-folder, and the board's own file name is kept as the source.
  const nested = recover(bare(), ["Boards/Sub/Town.tkrscn"], "Boards/Sub/Town.brd");
  if (!nested.ok) throw new Error("expected a proposal");
  equal(nested.scenePath, "Boards/Sub/Town.recovered.tkrscn");
  equal(nested.scene.metadata.source, "Boards/Sub/Town.brd");
});

void test("a recovery import is refused for the same causes as an import, with the same findings and no notes", () => {
  const board = bare({ vectors: [vector({ type: 3 })], lights: [light({ type: 9 })] });
  const refusal = recover(board, ["Boards/Cottage.tkrscn"]);
  equal(refusal.ok, false);
  deepEqual(refusal.findings, refused(board));
  ok(refusal.findings.every((finding) => !finding.field.startsWith("U")));
  deepEqual(
    recover(bare(), [], "Boards/Cottage.tkrscn").findings.map((finding) => [finding.severity, finding.field, finding.path]),
    [["refusal", "-", "boardName"]],
  );
});
