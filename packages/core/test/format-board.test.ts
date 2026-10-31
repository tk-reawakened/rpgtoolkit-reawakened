// The vector board format of docs/spec/formats/board.md#version-dispatch (version dispatch)
// (layout, AD-18): dimensions and coordinate type, the tile lookup table, the
// run-length tile matrix, shading, lights, vectors, programs, sprites, images,
// threads, constants, layer titles, the four edge links and the trailing
// properties — plus the sample fixtures when they have been fetched.
//
// The reader never throws, so the tests assert on values and on the error's
// offset and section rather than on exceptions.
import { test } from "node:test";
import { deepEqual, equal } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOARD_DETECT_OFFSET,
  BOARD_MAGIC,
  BOARD_MAX_CELLS,
  BOARD_SECTION,
  BinaryReader,
  BinaryWriter,
  createEmptyBoard,
  readBoard,
  writeBoard,
} from "../src/index.ts";
import type { Board, BoardRgb, Colorref, Result } from "../src/index.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");

/** Unwrap a result the test expects to succeed. */
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got: ${result.error.message}`);
  }
  return result.value;
}

/** The stored upper bound for `count` entries (docs/spec/formats/README.md#counts-are-usually-upper-bounds). */
function bound(count: number): number {
  return count === 0 ? -1 : count - 1;
}

const BLACK: Colorref = { r: 0, g: 0, b: 0 };

/** One vector as the builder writes it (docs/spec/formats/board.md#vector-layout-minor-4-and-later). */
interface VectorSpec {
  readonly points: readonly (readonly [number, number])[];
  readonly attributes: number;
  readonly closed: number;
  readonly layer: number;
  readonly type: number;
  readonly handle: string;
}

/** One program as the builder writes it (docs/spec/formats/board.md#vector-layout-minor-4-and-later). */
interface ProgramSpec {
  readonly program: string;
  readonly graphic: string;
  readonly initialVar: string;
  readonly initialValue: string;
  readonly finalVar: string;
  readonly finalValue: string;
  readonly activate: number;
  readonly activationType: number;
  readonly repeatDistance: number;
  readonly layer: number;
  readonly points: readonly (readonly [number, number])[];
  readonly closed: number;
  readonly handle: string;
}

/** One sprite as the builder writes it (docs/spec/formats/board.md#vector-layout-minor-4-and-later). */
interface SpriteSpec {
  readonly itemFile: string;
  readonly activationPrg: string;
  readonly multitaskPrg: string;
  readonly initialVar: string;
  readonly initialValue: string;
  readonly finalVar: string;
  readonly finalValue: string;
  readonly loadingVar: string;
  readonly loadingValue: string;
  readonly activate: number;
  readonly activationType: number;
  readonly x: number;
  readonly y: number;
  readonly layer: number;
  readonly reserved: number;
}

/** One shading layer as the builder writes it (docs/spec/formats/board.md#vector-layout-minor-4-and-later). */
interface ShadeSpec {
  readonly castLayer: number;
  /** `runCount, r, g, b` per record; `runCount` 0 or 1 covers one cell. */
  readonly records: readonly (readonly [number, number, number, number])[];
}

/** One precomputed light as the builder writes it (docs/spec/formats/board.md#vector-layout-minor-4-and-later). */
interface LightSpec {
  readonly layer: number;
  /** 0 = elliptical spotlight, 1 = linear gradient, 2 = clipped gradient. */
  readonly type: number;
  readonly nodes: readonly (readonly [number, number])[];
  readonly colours: readonly BoardRgb[];
}

/** One free image as the builder writes it (docs/spec/formats/board.md#vector-layout-minor-4-and-later). */
interface ImageSpec {
  readonly file: string;
  readonly left: number;
  readonly top: number;
  readonly layer: number;
  readonly drawType: number;
  readonly transparent: Colorref;
  readonly reserved: number;
}

/** The fields a synthetic board lets a test vary. */
interface BuildOptions {
  readonly magic?: string;
  readonly major?: number;
  readonly minor?: number;
  readonly sizeX?: number;
  readonly sizeY?: number;
  readonly sizeL?: number;
  readonly coordType?: number;
  readonly lut?: readonly string[];
  /** The raw `i16` LUT upper bound, to craft an invalid one (−1 means none). */
  readonly lutBound?: number;
  /** The raw `i16` tile-matrix tokens, markers included (negative = a run marker). */
  readonly tokens?: readonly number[];
  readonly shadeLayers?: readonly ShadeSpec[];
  readonly lights?: readonly LightSpec[];
  readonly vectors?: readonly VectorSpec[];
  readonly programs?: readonly ProgramSpec[];
  readonly sprites?: readonly SpriteSpec[];
  readonly images?: readonly ImageSpec[];
  readonly threads?: readonly string[];
  readonly constants?: readonly string[];
  readonly layerTitles?: readonly string[];
  readonly links?: readonly [string, string, string, string];
  readonly properties?: {
    readonly backgroundImage?: string;
    readonly backgroundDrawType?: number;
    readonly backgroundColour?: Colorref;
    readonly backgroundMusic?: string;
    readonly enterPrg?: string;
    readonly battleBackground?: string;
    readonly battleSkill?: number;
    readonly allowBattles?: number;
    readonly disableSaving?: number;
    readonly ambient?: BoardRgb;
    readonly start?: { readonly x: number; readonly y: number; readonly layer: number };
  };
  /** Extra bytes after the last field, to prove they survive as residue. */
  readonly tail?: readonly number[];
}

/** Serialise a synthetic vector board in the docs/spec/formats/board.md#vector-layout-minor-4-and-later order. */
function buildBoard(options: BuildOptions = {}): Uint8Array {
  const sizeX = options.sizeX ?? 2;
  const sizeY = options.sizeY ?? 2;
  const sizeL = options.sizeL ?? 1;
  const cells = sizeX * sizeY;
  const total = cells * sizeL;
  const tokens = options.tokens ?? (total > 0 ? [-total, 1] : []);
  const shadeLayers =
    options.shadeLayers ?? (cells > 0 ? [{ castLayer: 1, records: [[cells, 0, 0, 0]] }] : []);
  const layerTitles = options.layerTitles ?? Array.from({ length: sizeL + 1 }, () => "");
  const links = options.links ?? ["", "", "", ""];
  const props = options.properties ?? {};
  const start = props.start ?? { x: 64, y: 64, layer: 1 };

  const writer = new BinaryWriter();
  writer.str(options.magic ?? BOARD_MAGIC);
  writer.i16(options.major ?? 2);
  writer.i16(options.minor ?? 4);
  writer.i16(sizeX);
  writer.i16(sizeY);
  writer.i16(sizeL);
  writer.i16(options.coordType ?? 0);

  const lut = options.lut ?? ["", "default.tst1"];
  writer.i16(options.lutBound ?? bound(lut.length));
  for (const reference of lut) {
    writer.str(reference);
  }

  for (const token of tokens) {
    writer.i16(token);
  }

  writer.i16(bound(shadeLayers.length));
  for (const layer of shadeLayers) {
    writer.i32(layer.castLayer);
    for (const record of layer.records) {
      writer.i16(record[0]);
      writer.i16(record[1]);
      writer.i16(record[2]);
      writer.i16(record[3]);
    }
  }

  const lights = options.lights ?? [];
  writer.i16(bound(lights.length));
  for (const light of lights) {
    writer.i32(light.layer);
    writer.i32(light.type);
    writer.i16(bound(light.nodes.length));
    for (const node of light.nodes) {
      writer.i32(node[0]);
      writer.i32(node[1]);
    }
    writer.i16(bound(light.colours.length));
    for (const colour of light.colours) {
      writer.i16(colour.r);
      writer.i16(colour.g);
      writer.i16(colour.b);
    }
  }

  const vectors = options.vectors ?? [];
  writer.i16(bound(vectors.length));
  for (const vector of vectors) {
    writer.i16(bound(vector.points.length));
    for (const point of vector.points) {
      writer.i32(point[0]);
      writer.i32(point[1]);
    }
    writer.i16(vector.attributes);
    writer.i16(vector.closed);
    writer.i16(vector.layer);
    writer.i16(vector.type);
    writer.str(vector.handle);
  }

  const programs = options.programs ?? [];
  writer.i16(bound(programs.length));
  for (const program of programs) {
    for (const value of [
      program.program,
      program.graphic,
      program.initialVar,
      program.initialValue,
      program.finalVar,
      program.finalValue,
    ]) {
      writer.str(value);
    }
    writer.i16(program.activate);
    writer.i16(program.activationType);
    writer.i16(program.repeatDistance);
    writer.i16(program.layer);
    writer.i16(bound(program.points.length));
    for (const point of program.points) {
      writer.i32(point[0]);
      writer.i32(point[1]);
    }
    writer.i16(program.closed);
    writer.str(program.handle);
  }

  const sprites = options.sprites ?? [];
  writer.i16(bound(sprites.length));
  for (const sprite of sprites) {
    for (const value of [
      sprite.itemFile,
      sprite.activationPrg,
      sprite.multitaskPrg,
      sprite.initialVar,
      sprite.initialValue,
      sprite.finalVar,
      sprite.finalValue,
      sprite.loadingVar,
      sprite.loadingValue,
    ]) {
      writer.str(value);
    }
    writer.i16(sprite.activate);
    writer.i16(sprite.activationType);
    writer.i16(sprite.x);
    writer.i16(sprite.y);
    writer.i16(sprite.layer);
    writer.i16(sprite.reserved);
  }

  const images = options.images ?? [];
  writer.i16(bound(images.length));
  for (const image of images) {
    writer.str(image.file);
    writer.i32(image.left);
    writer.i32(image.top);
    writer.i16(image.layer);
    writer.i16(image.drawType);
    writer.color(image.transparent);
    writer.i16(image.reserved);
  }

  const threads = options.threads ?? [];
  writer.i16(bound(threads.length));
  for (const thread of threads) {
    writer.str(thread);
  }

  const constants = options.constants ?? [];
  writer.i16(bound(constants.length));
  for (const constant of constants) {
    writer.str(constant);
  }

  for (const title of layerTitles) {
    writer.str(title);
  }

  for (const link of links) {
    writer.str(link);
  }

  writer.str(props.backgroundImage ?? "");
  writer.i32(props.backgroundDrawType ?? 0);
  writer.color(props.backgroundColour ?? BLACK);
  writer.str(props.backgroundMusic ?? "");
  writer.str(props.enterPrg ?? "");
  writer.str(props.battleBackground ?? "");
  writer.i16(props.battleSkill ?? 0);
  writer.i16(props.allowBattles ?? 0);
  writer.i16(props.disableSaving ?? 0);
  writer.i16(props.ambient?.r ?? 0);
  writer.i16(props.ambient?.g ?? 0);
  writer.i16(props.ambient?.b ?? 0);
  writer.i16(start.x);
  writer.i16(start.y);
  writer.i16(start.layer);

  if (options.tail !== undefined) {
    writer.writeBytes(new Uint8Array(options.tail));
  }
  return writer.toBytes();
}

test("reads the header, the dimensions and the reserved LUT index 0", () => {
  const bytes = buildBoard({ lut: ["", "a.tst1", "b.iso2"], coordType: 4 });
  const model = unwrap(readBoard(new BinaryReader(bytes)));
  equal(model.magic, BOARD_MAGIC);
  equal(model.major, 2);
  equal(model.minor, 4);
  equal(model.sizeX, 2);
  equal(model.sizeY, 2);
  equal(model.sizeL, 1);
  equal(model.coordType, 4);
  deepEqual(model.lut, ["", "a.tst1", "b.iso2"]);
  equal(model.lut[0], "", "index 0 is the reserved 'no tile' entry");
  deepEqual(unwrap(writeBoard(model)), bytes);
});

test("a board with lutUpperBound -1 has no LUT at all, and one below -1 is refused", () => {
  // -1 means the table is absent: no entries and therefore no index 0(docs/spec/formats/README.md#counts-are-usually-upper-bounds, docs/spec/formats/board.md#vector-layout-minor-4-and-later.
  const absent = buildBoard({ lutBound: -1, lut: [] });
  const none = unwrap(readBoard(new BinaryReader(absent)));
  deepEqual(none.lut, [], "an absent LUT has no index 0");
  deepEqual(unwrap(writeBoard(none)), absent, "an absent LUT round-trips");

  // No other negative bound is valid; the reader reports it at the bound's byte.
  const result = readBoard(new BinaryReader(buildBoard({ lutBound: -2, lut: [] })));
  equal(result.ok, false);
  if (result.ok) {
    return;
  }
  equal(result.error.section, "docs/spec/formats/README.md#counts-are-usually-upper-bounds");
  equal(result.error.offset, 27, "the LUT upper bound's first byte");
});

test("only the rotated style (bit 2) expands the tile grid; bits 1 and 4 keep sizeX by sizeY", () => {
  // coordType bit 1 (ISO_STACKED) is isometric yet stores sizeX × sizeY per
  // layer; bit 2 (ISO_ROTATED) alone expands it to (sizeX + sizeY)² per layer;
  // bit 4 (pixel-absolute) changes neither, alone or combined(docs/spec/formats/board.md#vector-layout-minor-4-and-later, docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector, docs/spec/formats/README.md#cross-format-test-checklist.
  const cases: readonly [string, number, number, readonly number[]][] = [
    ["2D (bit 0 none)", 0, 6, [-6, 1]],
    ["iso stacked (bit 1)", 1, 6, [-6, 1]],
    ["iso rotated (bit 2)", 2, 25, [-25, 1]],
    ["pixel absolute (bit 4)", 4, 6, [-6, 1]],
    ["iso stacked + pixel absolute", 1 | 4, 6, [-6, 1]],
  ];
  for (const [name, coordType, cells, tokens] of cases) {
    const model = unwrap(
      readBoard(
        new BinaryReader(
          buildBoard({
            sizeX: 3,
            sizeY: 2,
            sizeL: 1,
            coordType,
            tokens,
            shadeLayers: [{ castLayer: 1, records: [[cells, 0, 0, 0]] }],
          }),
        ),
      ),
    );
    equal(model.tileMatrix.length, cells, `${name}: grid cell count`);
  }
});

test("expands a matrix run that wraps a row end and one that wraps a layer boundary", () => {
  // 3 × 2 × 2 = 12 cells. Tokens: one cell, then runs of 4, 3 and 4.
  const bytes = buildBoard({ sizeX: 3, sizeY: 2, sizeL: 2, tokens: [1, -4, 3, -3, 6, -4, 2] });
  const model = unwrap(readBoard(new BinaryReader(bytes)));
  deepEqual(model.tileMatrix, [1, 3, 3, 3, 3, 6, 6, 6, 2, 2, 2, 2]);
  equal(model.tileRuns.length, 4);
  // Layer 1 is cells 0–5 (y outer, x inner) and layer 2 starts at cell 6.
  equal(model.tileMatrix[2], model.tileMatrix[3], "a run wraps from y1x3 into y2x1");
  equal(model.tileMatrix[5], model.tileMatrix[6], "a run wraps from layer 1 into layer 2");
  deepEqual(unwrap(writeBoard(model)), bytes);
});

test("keeps the stored run encoding so the matrix writes back byte for byte", () => {
  // A run marker covering a single cell must not be re-encoded as a bare index.
  const bytes = buildBoard({ tokens: [-1, 1, -1, 1, -1, 1, -1, 1] });
  const model = unwrap(readBoard(new BinaryReader(bytes)));
  deepEqual(model.tileMatrix, [1, 1, 1, 1]);
  equal(model.tileRuns.length, 4);
  equal(model.tileRuns[0]?.marker, true);
  equal(model.tileRuns[0]?.count, 1);
  deepEqual(unwrap(writeBoard(model)), bytes);
});

test("a shading record with runCount 0 or 1 each covers one cell", () => {
  const bytes = buildBoard({
    shadeLayers: [
      { castLayer: 1, records: [[0, 1, 2, 3], [1, 4, 5, 6], [2, 7, 8, 9]] },
    ],
  });
  const model = unwrap(readBoard(new BinaryReader(bytes)));
  equal(model.shadeLayers.length, 1);
  deepEqual(model.shadeLayers[0]?.records, [
    { runCount: 0, r: 1, g: 2, b: 3 },
    { runCount: 1, r: 4, g: 5, b: 6 },
    { runCount: 2, r: 7, g: 8, b: 9 },
  ]);
  deepEqual(unwrap(writeBoard(model)), bytes);
});

test("a shading layer stops after the grid is covered", () => {
  // Layer 1 covers the 4 cells with four 1-cell runs; layer 2 does it with one.
  const bytes = buildBoard({
    shadeLayers: [
      { castLayer: 1, records: [[0, 1, 1, 1], [0, 2, 2, 2], [0, 3, 3, 3], [0, 4, 4, 4]] },
      { castLayer: 2, records: [[4, 9, 9, 9]] },
    ],
  });
  const model = unwrap(readBoard(new BinaryReader(bytes)));
  equal(model.shadeLayers.length, 2);
  equal(model.shadeLayers[0]?.records.length, 4);
  equal(model.shadeLayers[1]?.castLayer, 2);
  deepEqual(unwrap(writeBoard(model)), bytes);
});

test("round-trips the precomputed lights byte for byte", () => {
  const bytes = buildBoard({
    lights: [
      {
        layer: 1,
        type: 0,
        nodes: [[64, 96], [128, 96], [64, 32]],
        colours: [{ r: 10, g: 20, b: 30 }, { r: 0, g: 0, b: 0 }],
      },
      {
        layer: 2,
        type: 1,
        nodes: [[0, 0], [32, 32]],
        colours: [{ r: -5, g: 5, b: 0 }, { r: 1, g: 1, b: 1 }],
      },
    ],
  });
  const model = unwrap(readBoard(new BinaryReader(bytes)));
  equal(model.lights.length, 2);
  deepEqual(model.lights[0], {
    layer: 1,
    type: 0,
    nodes: [{ x: 64, y: 96 }, { x: 128, y: 96 }, { x: 64, y: 32 }],
    colours: [{ r: 10, g: 20, b: 30 }, { r: 0, g: 0, b: 0 }],
  });
  equal(model.lights[1]?.type, 1, "a linear gradient has two nodes and two colours");
  deepEqual(model.lights[1]?.nodes, [{ x: 0, y: 0 }, { x: 32, y: 32 }]);
  deepEqual(unwrap(writeBoard(model)), bytes);
});

test("reads and writes a closed vector with the legacy -1", () => {
  const bytes = buildBoard({
    vectors: [
      { points: [[32, 0], [64, 0], [32, 32]], attributes: 0, closed: -1, layer: 1, type: 1, handle: "" },
      { points: [[0, 0], [32, 0]], attributes: 2, closed: 0, layer: 2, type: 2, handle: "h" },
    ],
  });
  const model = unwrap(readBoard(new BinaryReader(bytes)));
  equal(model.vectors.length, 2);
  equal(model.vectors[0]?.closed, -1, "non-zero means closed");
  deepEqual(model.vectors[0]?.points, [{ x: 32, y: 0 }, { x: 64, y: 0 }, { x: 32, y: 32 }]);
  equal(model.vectors[0]?.type, 1);
  equal(model.vectors[1]?.closed, 0, "zero means an open polyline");
  deepEqual(unwrap(writeBoard(model)), bytes);
});

test("keeps an empty program and sprite slot at its index", () => {
  const program = {
    program: "p.prg",
    graphic: "",
    initialVar: "v",
    initialValue: "1",
    finalVar: "v",
    finalValue: "2",
    activate: 1,
    activationType: 1,
    repeatDistance: 32,
    layer: 1,
    points: [[0, 0], [32, 0], [32, 32]] as readonly (readonly [number, number])[],
    closed: -1,
    handle: "",
  };
  const sprite = {
    itemFile: "npc.itm",
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
    x: 64,
    y: 96,
    layer: 1,
    reserved: -1,
  };
  const bytes = buildBoard({
    programs: [
      { ...program, program: "" },
      program,
    ],
    sprites: [{ ...sprite, itemFile: "" }, sprite],
  });
  const model = unwrap(readBoard(new BinaryReader(bytes)));
  equal(model.programs.length, 2);
  equal(model.programs[0]?.program, "", "the empty program slot stays at index 0");
  equal(model.programs[1]?.program, "p.prg");
  equal(model.sprites.length, 2);
  equal(model.sprites[0]?.itemFile, "", "the empty sprite slot stays at index 0");
  equal(model.sprites[1]?.itemFile, "npc.itm");
  equal(model.sprites[1]?.reserved, -1);
  deepEqual(unwrap(writeBoard(model)), bytes);
});

test("reads images, threads, constants, layer titles, links and properties", () => {
  const bytes = buildBoard({
    sizeL: 2,
    layerTitles: ["", "Ground", "Sky"],
    threads: ["bg.prg"],
    constants: ["a", "b"],
    links: ["north.brd", "", "east.prg", ""],
    images: [
      { file: "bg.png", left: 16, top: 32, layer: 1, drawType: 2, transparent: { r: 1, g: 2, b: 3 }, reserved: 100 },
    ],
    properties: {
      backgroundImage: "sky.bmp",
      backgroundDrawType: 1,
      backgroundColour: { r: 4, g: 5, b: 6 },
      backgroundMusic: "theme.mid",
      enterPrg: "enter.prg",
      battleBackground: "field.bkg",
      battleSkill: 3,
      allowBattles: 1,
      disableSaving: 0,
      ambient: { r: -10, g: 20, b: -30 },
      start: { x: 204, y: 246, layer: 2 },
    },
  });
  const model = unwrap(readBoard(new BinaryReader(bytes)));
  equal(model.images.length, 1);
  deepEqual(model.images[0], {
    file: "bg.png",
    left: 16,
    top: 32,
    layer: 1,
    drawType: 2,
    transparent: { r: 1, g: 2, b: 3 },
    reserved: 100,
  });
  deepEqual(model.threads, ["bg.prg"]);
  deepEqual(model.constants, ["a", "b"]);
  deepEqual(model.layerTitles, ["", "Ground", "Sky"]);
  deepEqual(model.links, { north: "north.brd", south: "", east: "east.prg", west: "" });
  equal(model.properties.backgroundImage, "sky.bmp");
  equal(model.properties.backgroundDrawType, 1);
  deepEqual(model.properties.backgroundColour, { r: 4, g: 5, b: 6 });
  equal(model.properties.backgroundMusic, "theme.mid");
  equal(model.properties.enterPrg, "enter.prg");
  equal(model.properties.battleBackground, "field.bkg");
  equal(model.properties.battleSkill, 3);
  equal(model.properties.allowBattles, 1);
  deepEqual(model.properties.ambient, { r: -10, g: 20, b: -30 });
  deepEqual(model.properties.start, { x: 204, y: 246, layer: 2 });
  deepEqual(unwrap(writeBoard(model)), bytes);
});

test("keeps trailing bytes as residue and does not error on them", () => {
  const bytes = buildBoard({ tail: [0xde, 0xad, 0xbe, 0xef] });
  const reader = new BinaryReader(bytes);
  const result = readBoard(reader);
  equal(result.ok, true);
  equal(reader.remaining, 0);
  const model = unwrap(result);
  deepEqual(model.residue, new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  equal(result.ok && result.warnings.length, 1);
  deepEqual(unwrap(writeBoard(model)), bytes);
});

test("dispatches a 2.x text board at byte 14 and reports located error on malformed data", () => {
  const text = "RPGTLKIT BOARD\r\nname=Wrong\r\n";
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  const result = readBoard(new BinaryReader(bytes));
  equal(result.ok, false);
  if (result.ok) {
    return;
  }
  equal(result.error.offset, 16);
  equal(result.error.section.includes("text-formats"), true);
});

test("refuses a wrong magic at offset 0", () => {
  const bytes = buildBoard({ magic: "RPGTLKIT WRONG" });
  const result = readBoard(new BinaryReader(bytes));
  equal(result.ok, false);
  if (result.ok) {
    return;
  }
  equal(result.error.offset, 0);
  equal(result.error.section, BOARD_SECTION);
  equal(result.error.message.includes("RPGTLKIT WRONG"), true, result.error.message);
});

test("refuses minors 2 and 3 with a pointer to pre-vector", () => {
  for (const minor of [2, 3]) {
    const bytes = buildBoard({ minor });
    const result = readBoard(new BinaryReader(bytes));
    equal(result.ok, false, `minor ${minor}`);
    if (result.ok) {
      continue;
    }
    // magic (15 bytes) + major (2) = the minor field starts at 17.
    equal(result.error.offset, 17);
    equal(result.error.section, BOARD_SECTION);
    equal(result.error.message.includes("docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector"), true, result.error.message);
    equal(result.error.message.includes("pre-vector"), true, result.error.message);
  }
});

test("refuses minors 0 and 1 as obsolete", () => {
  for (const minor of [0, 1]) {
    const result = readBoard(new BinaryReader(buildBoard({ minor })));
    equal(result.ok, false, `minor ${minor}`);
    if (result.ok) {
      continue;
    }
    equal(result.error.offset, 17);
    equal(result.error.section, BOARD_SECTION);
    equal(result.error.message.includes("obsolete"), true, result.error.message);
  }
});

test("refuses a negative minor version", () => {
  const result = readBoard(new BinaryReader(buildBoard({ minor: -1 })));
  equal(result.ok, false);
  if (result.ok) {
    return;
  }
  equal(result.error.offset, 17);
  equal(result.error.section, "docs/spec/formats/README.md#header-and-version");
});

test("refuses a negative sizeX, sizeY or sizeL", () => {
  const cases: readonly (readonly [number, number, number])[] = [
    [-1, 2, 1],
    [2, -1, 1],
    [2, 2, -2],
  ];
  for (const [sizeX, sizeY, sizeL] of cases) {
    const result = readBoard(new BinaryReader(buildBoard({ sizeX, sizeY, sizeL })));
    equal(result.ok, false, `${sizeX}×${sizeY}×${sizeL} is invalid`);
    if (result.ok) {
      continue;
    }
    equal(result.error.section, "docs/spec/formats/board.md#vector-layout-minor-4-and-later");
    equal(result.error.offset, 19, "the sizeX field");
  }
});

test("a truncated file reports the field's offset", () => {
  const bytes = buildBoard({});
  // magic (15 bytes) + major (2) + minor (2) = 19; cutting at 20 leaves one
  // byte of sizeX, so the i16 read at 19 falls short.
  const truncated = bytes.slice(0, 20);
  const result = readBoard(new BinaryReader(truncated));
  equal(result.ok, false);
  if (result.ok) {
    return;
  }
  equal(result.error.offset, 19);
  equal(result.error.section, "docs/spec/formats/README.md#primitive-encoding");
});

test("a file too short for the detection byte reports the header read", () => {
  const bytes = buildBoard({}).slice(0, 10);
  const result = readBoard(new BinaryReader(bytes));
  equal(result.ok, false);
  if (result.ok) {
    return;
  }
  equal(result.error.section, "docs/spec/formats/README.md#primitive-encoding");
});

test("refuses a run marker followed by a negative LUT index", () => {
  const bytes = buildBoard({ tokens: [1, -2, -5, 1] });
  const result = readBoard(new BinaryReader(bytes));
  equal(result.ok, false);
  if (result.ok) {
    return;
  }
  equal(result.error.section, "docs/spec/formats/board.md#vector-layout-minor-4-and-later");
});

test("round-trips a board with every section populated", () => {
  const bytes = buildBoard({
    sizeX: 4,
    sizeY: 3,
    sizeL: 3,
    coordType: 2,
    lut: ["", "a.tst1", "b.gph"],
    // Iso-rotated grids are (sizeX + sizeY)² = 49 cells per layer.
    tokens: [-147, 1],
    shadeLayers: [{ castLayer: 3, records: [[24, 5, 5, 5], [25, -5, -5, -5]] }],
    vectors: [{ points: [[1, 2], [3, 4]], attributes: 4, closed: -1, layer: 3, type: 16, handle: "way" }],
    programs: [
      {
        program: "line:say hi",
        graphic: "",
        initialVar: "",
        initialValue: "",
        finalVar: "",
        finalValue: "",
        activate: 0,
        activationType: 5,
        repeatDistance: 0,
        layer: 2,
        points: [[0, 0]],
        closed: 0,
        handle: "",
      },
    ],
    sprites: [
      {
        itemFile: "npc.itm",
        activationPrg: "",
        multitaskPrg: "",
        initialVar: "met",
        initialValue: "",
        finalVar: "met",
        finalValue: "yes",
        loadingVar: "met",
        loadingValue: "",
        activate: 1,
        activationType: 1,
        x: 128,
        y: 160,
        layer: 1,
        reserved: -1,
      },
    ],
    images: [{ file: "img.png", left: -4, top: 8, layer: 2, drawType: 0, transparent: BLACK, reserved: 100 }],
    threads: ["t1.prg", ""],
    constants: ["x", ""],
    layerTitles: ["", "one", "two", "three"],
    links: ["n.brd", "s.brd", "e.prg", "w.brd"],
    properties: { start: { x: 1, y: 2, layer: 3 }, ambient: { r: -1, g: 0, b: 1 } },
    tail: [1, 2, 3],
  });
  const reader = new BinaryReader(bytes);
  const model = unwrap(readBoard(reader));
  equal(reader.remaining, 0);
  // The iso-rotated grid is (4 + 3)² × 3 layers = 147 cells.
  equal(model.tileMatrix.length, 147);
  deepEqual(model.tileRuns, [{ lutIndex: 1, count: 147, marker: true }]);
  deepEqual(unwrap(writeBoard(model)), bytes);
});

test("a valid model's runs and matrix round-trip unchanged", () => {
  const bytes = buildBoard({ sizeX: 3, sizeY: 2, sizeL: 2, tokens: [1, -4, 3, -3, 6, -4, 2] });
  const model = unwrap(readBoard(new BinaryReader(bytes)));
  deepEqual(unwrap(writeBoard(model)), bytes);
});

test("refuses a tile matrix that disagrees with the stored runs", () => {
  const model = unwrap(readBoard(new BinaryReader(buildBoard({}))));
  const edited = { ...model, tileMatrix: [1, 1, 7, 1] };
  const result = writeBoard(edited);
  equal(result.ok, false);
  if (result.ok) {
    return;
  }
  equal(result.error.section, "docs/spec/formats/board.md#vector-layout-minor-4-and-later");
  equal(result.error.message.includes("tile cell 2"), true, result.error.message);
});

test("refuses tile runs that cover fewer cells than the grid", () => {
  const model = unwrap(readBoard(new BinaryReader(buildBoard({}))));
  const partial = {
    ...model,
    tileRuns: [{ lutIndex: 1, count: 3, marker: true }],
    tileMatrix: [1, 1, 1],
  };
  const result = writeBoard(partial);
  equal(result.ok, false);
  if (result.ok) {
    return;
  }
  equal(result.error.section, "docs/spec/formats/board.md#vector-layout-minor-4-and-later");
});

test("refuses a run that follows the run completing the grid", () => {
  const model = unwrap(readBoard(new BinaryReader(buildBoard({}))));
  const over = {
    ...model,
    tileRuns: [
      { lutIndex: 1, count: 4, marker: true },
      { lutIndex: 1, count: 1, marker: false },
    ],
    tileMatrix: [1, 1, 1, 1, 1],
  };
  const result = writeBoard(over);
  equal(result.ok, false);
  if (result.ok) {
    return;
  }
  equal(result.error.section, "docs/spec/formats/board.md#vector-layout-minor-4-and-later");
});

test("keeps a final run that overshoots the grid and writes it back", () => {
  const bytes = buildBoard({ tokens: [1, -5, 2] });
  const result = readBoard(new BinaryReader(bytes));
  equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  equal(result.warnings.length > 0, true, "the reader warns about the overshoot");
  deepEqual(result.value.tileMatrix, [1, 2, 2, 2, 2, 2]);
  deepEqual(unwrap(writeBoard(result.value)), bytes);
});

test("refuses a board whose tile matrix would exceed the cell limit", () => {
  // 397 × 2113 × 5 = BOARD_MAX_CELLS + 1 cells — yet the crafted file is tiny,
  // so the reader must refuse on the dimensions before it expands a single run.
  equal(397 * 2113 * 5, BOARD_MAX_CELLS + 1, "the crafted grid is one cell over the limit");
  const bytes = buildBoard({ sizeX: 397, sizeY: 2113, sizeL: 5 });
  const result = readBoard(new BinaryReader(bytes));
  equal(result.ok, false);
  if (result.ok) {
    return;
  }
  equal(result.error.section, "docs/spec/formats/board.md#vector-layout-minor-4-and-later");
  equal(result.error.offset, 19, "the sizeX field");
});

test("accepts a board of exactly BOARD_MAX_CELLS cells built from 128 maximum runs", () => {
  equal(2048 * 2048, BOARD_MAX_CELLS, "2048 × 2048 × 1 is exactly the limit");
  equal(128 * 32_768, BOARD_MAX_CELLS, "128 runs of 32768 cells fill it");
  const tokens = Array.from({ length: 128 }, () => [-32_768, 1]).flat();
  const bytes = buildBoard({ sizeX: 2048, sizeY: 2048, sizeL: 1, tokens, shadeLayers: [] });
  const model = unwrap(readBoard(new BinaryReader(bytes)));
  equal(model.tileMatrix.length, BOARD_MAX_CELLS);
  equal(model.tileRuns.length, 128);
  deepEqual(unwrap(writeBoard(model)), bytes);
});

test("refuses a model whose tile matrix would exceed the cell limit", () => {
  const model = unwrap(readBoard(new BinaryReader(buildBoard({}))));
  // 2048 × 2064 × 1 = 4227072 cells — 32768 over the limit — and 129 maximum
  // runs (129 × 32768 = 4227072) cover it exactly, so only the docs/spec/formats/board.md#vector-layout-minor-4-and-later limit can
  // refuse this model; every other guard would accept it.
  equal(2048 * 2064, 129 * 32_768, "the runs cover the over-limit grid exactly");
  const tileMatrix = new Array<number>(129 * 32_768).fill(1);
  const tileRuns = Array.from({ length: 129 }, () => ({ lutIndex: 1, count: 32_768, marker: true }));
  const result = writeBoard({ ...model, sizeX: 2048, sizeY: 2064, sizeL: 1, tileMatrix, tileRuns });
  equal(result.ok, false);
  if (result.ok) {
    return;
  }
  equal(result.error.section, "docs/spec/formats/board.md#vector-layout-minor-4-and-later");
});

test("refuses a model with a value the vector layout cannot store", () => {
  const model = unwrap(readBoard(new BinaryReader(buildBoard({}))));

  const wideDimension = writeBoard({ ...model, sizeX: 40_000 });
  equal(wideDimension.ok, false, "an i16-overflowing sizeX");
  if (!wideDimension.ok) {
    equal(wideDimension.error.section, "docs/spec/formats/board.md#vector-layout-minor-4-and-later");
  }

  const tooManyLayers = writeBoard({
    ...model,
    shadeLayers: Array.from({ length: 40_000 }, () => ({ castLayer: 1, records: [] })),
  });
  equal(tooManyLayers.ok, false, "a shade-layer count above 32768");

  const wrongMagic = writeBoard({ ...model, magic: "RPGTLKIT WRONG" });
  equal(wrongMagic.ok, false, "a magic the reader refuses");

  const oldMinor = writeBoard({ ...model, minor: 3 });
  equal(oldMinor.ok, false, "a minor that dispatches to docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector");
});

// --- Sample fixtures (guard-rail G5 rule 4: fetched, never committed) --------

/** Every `.brd` under `root`, recursively; empty when the folder is absent. */
function collectBoards(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root, { recursive: true })
    .filter((name) => name.toLowerCase().endsWith(".brd"))
    .map((name) => join(root, name));
}

const sampleBoards = [
  ...collectBoards(join(repoRoot, "fixtures", "legacy", "demo")),
  ...collectBoards(join(repoRoot, "fixtures", "legacy", "Basic")),
];

/** The observations the three shipped sample boards pin (docs/spec/formats/board.md#vector-layout-minor-4-and-later). */
const observed: readonly {
  readonly suffix: string;
  readonly coordType: number;
  readonly lut: number;
  readonly size: readonly [number, number, number];
  readonly vectors: number;
}[] = [
  { suffix: "demo/Boards/out.brd", coordType: 4, lut: 34, size: [20, 15, 2], vectors: 6 },
  { suffix: "demo/Boards/start.brd", coordType: 4, lut: 19, size: [20, 11, 2], vectors: 17 },
  { suffix: "Basic/Boards/start.brd", coordType: 0, lut: 2, size: [20, 15, 2], vectors: 0 },
];

test(
  "every sample board parses with zero trailing bytes and round-trips exactly",
  { skip: sampleBoards.length === 0 ? "legacy fixtures are not fetched" : false },
  (t?: { readonly diagnostic?: (message: string) => void }) => {
    for (const path of sampleBoards) {
      const bytes = new Uint8Array(readFileSync(path));
      const reader = new BinaryReader(bytes, path);
      const result = readBoard(reader);
      const model = unwrap(result);
      // The reader absorbs trailing bytes into `residue` with this warning, so
      // `remaining === 0` alone would hold even if the docs/spec/formats/board.md#vector-layout-minor-4-and-later layout stopped
      // matching the bytes. Asserting empty residue makes a layout drift — a
      // field read at the wrong width, a missing section — fail here instead.
      equal(reader.remaining, 0, `${path}: trailing bytes`);
      equal(model.residue.length, 0, `${path}: ${model.residue.length} byte(s) fell through to residue`);
      if (result.ok) {
        equal(
          result.warnings.filter((warning) => warning.includes("residue")).length,
          0,
          `${path}: residue warning`,
        );
      }
      deepEqual(unwrap(writeBoard(model)), bytes, `${path}: byte-identical round-trip`);
      t?.diagnostic?.(
        `${path}: size ${model.sizeX}×${model.sizeY}×${model.sizeL}, coordType ${model.coordType}, ` +
          `LUT ${model.lut.length}, tile cells ${model.tileMatrix.length}, vectors ${model.vectors.length}, ` +
          `programs ${model.programs.length}, sprites ${model.sprites.length}, images ${model.images.length}, ` +
          `shade layers ${model.shadeLayers.length}, start ${model.properties.start.x},${model.properties.start.y},${model.properties.start.layer}`,
      );

      for (const expect of observed) {
        if (!path.endsWith(expect.suffix)) {
          continue;
        }
        const where = `${path}: ${expect.suffix}`;
        equal(model.coordType, expect.coordType, where);
        equal(model.lut.length, expect.lut, where);
        deepEqual([model.sizeX, model.sizeY, model.sizeL], [...expect.size], where);
        equal(model.vectors.length, expect.vectors, where);
      }
    }
  },
);

test(
  "all three shipped sample boards are present",
  { skip: sampleBoards.length === 0 ? "legacy fixtures are not fetched" : false },
  () => {
    for (const expect of observed) {
      equal(
        sampleBoards.some((path) => path.endsWith(expect.suffix)),
        true,
        `${expect.suffix} was found`,
      );
    }
  },
);

test("a shade layer that under-covers the grid is refused instead of writing a misread file", () => {
  // docs/spec/formats/board.md#vector-layout-minor-4-and-later: the reader consumes a layer's records until they
  // cover the grid, so a short layer would be read into the light list (#847).
  const filled: Board = {
    ...createEmptyBoard(),
    magic: BOARD_MAGIC,
    major: 2,
    minor: 4,
    sizeX: 4,
    sizeY: 4,
    sizeL: 1,
    tileMatrix: Array(16).fill(0),
    tileRuns: [{ lutIndex: 0, count: 16, marker: true }],
    layerTitles: ["", ""],
    shadeLayers: [{ castLayer: 1, records: [{ runCount: 16, r: 0, g: 0, b: 0 }] }],
  };
  const board = unwrap(readBoard(new BinaryReader(unwrap(writeBoard(filled)))));
  const short = writeBoard({ ...board, shadeLayers: [{ castLayer: 1, records: [{ runCount: 8, r: 0, g: 0, b: 0 }] }] });
  equal(short.ok, false, "a layer covering half the grid is refused");
  if (short.ok) return;
  equal(short.error.message.includes("shade layer 0 covers 8 cells"), true, short.error.message);
  equal(short.error.section, "docs/spec/formats/board.md#vector-layout-minor-4-and-later", short.error.section);
  // The exact-cover case still writes the same bytes.
  deepEqual(unwrap(writeBoard(board)), unwrap(writeBoard(filled)));
});
