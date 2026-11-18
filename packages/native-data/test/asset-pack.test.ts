import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import {
  ASSET_PACK_CONTRACT,
  ASSET_PACK_VERSION,
  checkAssetPack,
  formatAssetPackProblems,
  readAssetPack,
  setAssetPackProperty,
  writeAssetPack,
  type AssetPack,
  type AssetPackProblem,
} from "../src/asset-pack.ts";

/** An authored pack: comments, a flow map, an open line barrier, a color key and a plugin block. */
const PACK = `contract: asset-pack
version: 1.0.0-pre.1
# The kit's descriptive name; the path is its identity.
name: Medieval Isometric Props & Architecture
projection: iso-rotated
grid:
  tileWidth: 64 # logical pixels
  tileHeight: 32
sources:
  - id: props-atlas
    file: Bitmap/medieval_props.png
    transparent: {mode: alpha}
  - id: keyed-sheet
    file: Bitmap/keyed.bmp
    transparent: {mode: colorKey, color: [255, 0, 255]}
assets:
  - id: stone-archway
    name: Stone Archway
    category: Architecture
    kind: stamp
    anchor: {x: 64, y: 96, snap: iso-diamond-center}
    visuals:
      - source: props-atlas
        rect: [0, 0, 128, 112]
        layerOffset: 0
    solid:
      - label: Left Pillar # collision
        closed: true
        points: [[-48, -8], [-32, 0], [-16, -8], [-32, -16]]
    under:
      - label: Walk-Under Lintel
        attributes: 7
        closed: true
        points: [[-48, -80], [48, -32], [48, -16], [-48, -64]]
  - id: wooden-chest
    name: Wooden Chest
    kind: prop
    anchor: {x: 16, y: 28, snap: bottom-center}
    visuals:
      - {source: keyed-sheet, rect: [128, 0, 32, 32]}
    solid:
      - label: Fence Line
        closed: false
        points: [[-14, 0], [14, 0]]
pluginData: # keep comments, spacing and key order exactly
  com.example.glow: # plugin-owned block
    version: 1.0.0
    data: {bloom: 0.40, futureKnob: "keep: exact"} # unknown keys are opaque
`;

const MINIMAL = `contract: asset-pack
version: 1.0.0-pre.1
name: Tiny
projection: 2d
grid: {tileWidth: 32, tileHeight: 32}
sources:
  - {id: sheet, file: Bitmap/sheet.png}
assets:
  - id: rock
    name: Rock
    kind: backdrop
    anchor: {x: 0, y: 0, snap: bottom-center}
    visuals:
      - {source: sheet, rect: [0, 0, 8, 8]}
`;

function refused(text: string): readonly AssetPackProblem[] {
  const result = readAssetPack(text);
  if (result.ok) throw new Error("expected the reader to refuse the document");
  return result.problems;
}

function accepted(text: string): AssetPack {
  const result = readAssetPack(text);
  if (!result.ok) throw new Error(`expected the reader to accept the document:\n${formatAssetPackProblems(result.problems)}`);
  return result.assetPack;
}

/** The 0-based numbers of the lines that differ, for two texts of the same line count. */
function changedLines(before: string, after: string): number[] {
  const left = before.split("\n");
  const right = after.split("\n");
  equal(right.length, left.length, "the edit kept the number of lines");
  return left.flatMap((line, index) => (line === right[index] ? [] : [index]));
}

const comments = (text: string): string[] => text.split("\n").flatMap((line) => (line.includes("#") ? [line.slice(line.indexOf("#"))] : []));

const PLUGIN_TAIL = PACK.slice(PACK.indexOf("pluginData:"));
/** The block alone: the key through the end of its last line, without the line break. */
const PLUGIN_BLOCK = PLUGIN_TAIL.replace(/\n$/, "");

// ---------------------------------------------------------------- reading and writing

void test("an authored pack reads into the typed model, with optional fields left absent", () => {
  const pack = accepted(PACK);
  equal(pack.contract, ASSET_PACK_CONTRACT);
  equal(pack.version, ASSET_PACK_VERSION);
  equal(pack.name, "Medieval Isometric Props & Architecture");
  equal(pack.projection, "iso-rotated");
  deepEqual(pack.grid, { tileWidth: 64, tileHeight: 32 });
  deepEqual(pack.sources[0], { id: "props-atlas", file: "Bitmap/medieval_props.png", transparent: { mode: "alpha" } });
  deepEqual(pack.sources[1]?.transparent, { mode: "colorKey", color: [255, 0, 255] });

  const archway = pack.assets[0];
  deepEqual(archway?.anchor, { x: 64, y: 96, snap: "iso-diamond-center" });
  deepEqual(archway?.visuals, [{ source: "props-atlas", rect: [0, 0, 128, 112], layerOffset: 0 }]);
  deepEqual(archway?.solid?.[0]?.points[0], [-48, -8]);
  equal(archway?.under?.[0]?.attributes, 7);

  const chest = pack.assets[1];
  ok(!Object.hasOwn(chest ?? {}, "category"), "an omitted category stays absent");
  ok(!Object.hasOwn(chest?.visuals[0] ?? {}, "layerOffset"), "an omitted layerOffset stays absent, not defaulted");
  ok(!Object.hasOwn(chest ?? {}, "under"));
  equal(chest?.solid?.[0]?.closed, false);

  deepEqual(pack.pluginData?.["com.example.glow"]?.data, { bloom: 0.4, futureKnob: "keep: exact" });
  equal(pack.pluginSource, PLUGIN_BLOCK);
  ok(!Object.hasOwn(accepted(MINIMAL), "pluginSource"));
});

void test("a source-backed write returns the authored bytes, and a reprinting writer would not", () => {
  const read = readAssetPack(PACK);
  ok(read.ok);
  if (!read.ok) return;
  equal(read.source, PACK);
  const written = writeAssetPack(read.assetPack, PACK);
  ok(written.ok);
  if (written.ok) equal(written.text, PACK);

  // The proof has teeth: printing the parsed tree changes the spacing before a trailing comment,
  // flow padding and the plugin block's numbers, so a reprint cannot equal the authored bytes.
  const { pluginData: _pluginData, pluginSource: _pluginSource, ...core } = read.assetPack;
  const sourceless = writeAssetPack(core);
  ok(sourceless.ok);
  if (sourceless.ok) ok(sourceless.text !== PACK);
});

void test("a pack without plugin blocks is written from the model and reads back the same", () => {
  const pack = accepted(MINIMAL);
  const written = writeAssetPack(pack);
  ok(written.ok);
  if (!written.ok) return;
  deepEqual(accepted(written.text), pack);
  ok(written.text.startsWith("contract: asset-pack\nversion: 1.0.0-pre.1\n"));
  ok(written.text.includes("anchor: {x: 0, y: 0, snap: bottom-center}"), written.text);
  ok(written.text.includes("rect: [0, 0, 8, 8]"), written.text);

  const full = accepted(PACK);
  const { pluginData: _pluginData, pluginSource: _pluginSource, ...core } = full;
  const rewritten = writeAssetPack(core);
  ok(rewritten.ok);
  if (!rewritten.ok) return;
  deepEqual(accepted(rewritten.text), core);
  ok(rewritten.text.includes("points: [[-48, -8], [-32, 0], [-16, -8], [-32, -16]]"), rewritten.text);
  ok(rewritten.text.includes("transparent: {mode: colorKey, color: [255, 0, 255]}"), rewritten.text);
});

void test("the writer refuses plugin blocks without source, stale source and a model that no longer matches", () => {
  const pack = accepted(PACK);
  ok(!writeAssetPack(pack).ok, "plugin data is never regenerated");
  const noSource = writeAssetPack(pack);
  if (!noSource.ok) equal(noSource.problems[0]?.path, "pluginData");

  const renamed = { ...pack, name: "Renamed" };
  const mismatch = writeAssetPack(renamed, PACK);
  ok(!mismatch.ok, "a changed model cannot be paired with stale source");
  if (!mismatch.ok) equal(mismatch.problems[0]?.kind, "edit");

  ok(!writeAssetPack(pack, PACK.replace("bloom: 0.40", "bloom: 0.4")).ok, "even a lexically changed opaque block is a different source");
  ok(!writeAssetPack(pack, PACK.replace("version: 1.0.0-pre.1", "version: 2.0.0")).ok, "a source the reader refuses is refused");

  const invalid = writeAssetPack({ ...accepted(MINIMAL), projection: "hex" } as unknown as AssetPack);
  ok(!invalid.ok, "an invalid model is not written");
});

// ---------------------------------------------------------------- invalid documents

void test("a document with a wrong or missing stamp is refused first, as a stamp problem", () => {
  const missing = refused(MINIMAL.replace("contract: asset-pack\n", ""));
  equal(missing[0]?.kind, "stamp");
  const wrong = refused(MINIMAL.replace("contract: asset-pack", "contract: animation-clip"));
  equal(wrong[0]?.path, "contract");
  ok(wrong[0]?.message.includes("asset-pack"));
  equal(wrong[0]?.line, 1);
  const notFirst = refused(MINIMAL.replace("contract: asset-pack\nversion: 1.0.0-pre.1\nname: Tiny\n", "name: Tiny\ncontract: asset-pack\nversion: 1.0.0-pre.1\n"));
  equal(notFirst[0]?.kind, "stamp");
  const future = refused(MINIMAL.replace("1.0.0-pre.1", "1.0.0-pre.2"));
  equal(future[0]?.path, "version");
  ok(readAssetPack(MINIMAL.replace("1.0.0-pre.1", "1.0.0-pre.1+build.7")).ok, "a build suffix is allowed");
});

const INVALID: readonly [string, (text: string) => string, string, string][] = [
  ["an unknown top-level key", (t) => `${t}extra: 1\n`, "extra", "closed"],
  ["a missing name", (t) => t.replace("name: Tiny\n", ""), "name", "required"],
  ["a blank pack name", (t) => t.replace("name: Tiny", 'name: " "'), "name", "empty"],
  ["an unknown projection", (t) => t.replace("projection: 2d", "projection: hex"), "projection", "not one of"],
  ["a zero grid width", (t) => t.replace("tileWidth: 32", "tileWidth: 0"), "grid.tileWidth", "at least 1"],
  ["a fractional grid height", (t) => t.replace("tileHeight: 32", "tileHeight: 1.5"), "grid.tileHeight", "whole number"],
  ["an unknown grid key", (t) => t.replace("tileHeight: 32}", "tileHeight: 32, depth: 1}"), "grid.depth", "closed"],
  ["empty sources", (t) => t.replace(/sources:\n {2}- \{id: sheet, file: Bitmap\/sheet.png\}\n/, "sources: []\n"), "sources", "at least one source"],
  ["empty assets", (t) => t.replace(/assets:[\s\S]*/, "assets: []\n"), "assets", "at least one asset"],
  ["a source id in the wrong form", (t) => t.replace("id: sheet", "id: Sheet_1"), "sources[0].id", "not a local ID"],
  ["a source with an unknown key", (t) => t.replace("file: Bitmap/sheet.png}", "file: Bitmap/sheet.png, size: 4}"), "sources[0].size", "closed"],
  ["an empty source file", (t) => t.replace("Bitmap/sheet.png", '""'), "sources[0].file", "empty"],
  ["an absolute source file", (t) => t.replace("Bitmap/sheet.png", "/Bitmap/sheet.png"), "sources[0].file", "relative"],
  ["an unknown transparency mode", (t) => t.replace("{id: sheet, file: Bitmap/sheet.png}", "{id: sheet, file: Bitmap/sheet.png, transparent: {mode: mask}}"), "sources[0].transparent.mode", "not one of"],
  ["a color key without a color", (t) => t.replace("{id: sheet, file: Bitmap/sheet.png}", "{id: sheet, file: Bitmap/sheet.png, transparent: {mode: colorKey}}"), "sources[0].transparent.color", "required"],
  ["a color key channel out of range", (t) => t.replace("{id: sheet, file: Bitmap/sheet.png}", "{id: sheet, file: Bitmap/sheet.png, transparent: {mode: colorKey, color: [0, 256, 0]}}"), "sources[0].transparent.color[1]", "0 to 255"],
  ["a color with alpha mode", (t) => t.replace("{id: sheet, file: Bitmap/sheet.png}", "{id: sheet, file: Bitmap/sheet.png, transparent: {mode: alpha, color: [0, 0, 0]}}"), "sources[0].transparent.color", "colorKey"],
  ["a duplicate source id", (t) => t.replace("sources:\n", "sources:\n  - {id: sheet, file: Bitmap/other.png}\n"), "sources[1].id", "more than once"],
  ["a duplicate asset id", (t) => `${t}  - id: rock\n    name: Rock Two\n    kind: prop\n    anchor: {x: 0, y: 0, snap: bottom-center}\n    visuals:\n      - {source: sheet, rect: [0, 0, 8, 8]}\n`, "assets[1].id", "more than once"],
  ["an asset id in the wrong form", (t) => t.replace("id: rock", "id: Big_Rock"), "assets[0].id", "not a local ID"],
  ["an unknown asset kind", (t) => t.replace("kind: backdrop", "kind: sprite"), "assets[0].kind", "not one of"],
  ["a missing asset anchor", (t) => t.replace("    anchor: {x: 0, y: 0, snap: bottom-center}\n", ""), "assets[0].anchor", "`anchor` is required"],
  ["a non-integer anchor", (t) => t.replace("anchor: {x: 0,", "anchor: {x: 0.5,"), "assets[0].anchor.x", "whole number"],
  ["a missing snap", (t) => t.replace("anchor: {x: 0, y: 0, snap: bottom-center}", "anchor: {x: 0, y: 0}"), "assets[0].anchor.snap", "`snap` is required"],
  ["an empty category", (t) => t.replace("    kind: backdrop\n", "    kind: backdrop\n    category: ''\n"), "assets[0].category", "empty"],
  ["a null category", (t) => t.replace("    kind: backdrop\n", "    kind: backdrop\n    category: null\n"), "assets[0].category", "leave the key out"],
  ["an asset with a legacy key", (t) => t.replace("    kind: backdrop\n", "    kind: backdrop\n    vectors: []\n"), "assets[0].vectors", "closed"],
  ["empty visuals", (t) => t.replace(/ {4}visuals:\n.*\n/, "    visuals: []\n"), "assets[0].visuals", "at least one visual"],
  ["a visual naming a missing source", (t) => t.replace("{source: sheet,", "{source: sheet-2,"), "assets[0].visuals[0].source", "not the ID of a source in this pack"],
  ["a visual rect of the wrong length", (t) => t.replace("rect: [0, 0, 8, 8]", "rect: [0, 0, 8]"), "assets[0].visuals[0].rect", "x, y, width and height"],
  ["a visual rect with no area", (t) => t.replace("rect: [0, 0, 8, 8]", "rect: [0, 0, 0, 8]"), "assets[0].visuals[0].rect[2]", "at least 1"],
  ["a visual rect with a negative origin", (t) => t.replace("rect: [0, 0, 8, 8]", "rect: [-1, 0, 8, 8]"), "assets[0].visuals[0].rect[0]", "0 or more"],
  ["a fractional layer offset", (t) => t.replace("rect: [0, 0, 8, 8]}", "rect: [0, 0, 8, 8], layerOffset: 0.5}"), "assets[0].visuals[0].layerOffset", "whole number"],
];

for (const [name, mutate, path, fragment] of INVALID) {
  void test(`the reader refuses ${name}`, () => {
    const mutated = mutate(MINIMAL);
    ok(mutated !== MINIMAL, "the mutation changed the fixture");
    const problems = refused(mutated);
    const found = problems.find((problem) => problem.path === path);
    if (found === undefined) throw new Error(`expected a problem at ${path}, got:\n${formatAssetPackProblems(problems)}`);
    ok(found.message.includes(fragment), `"${found.message}" should mention "${fragment}"`);
    equal(found.kind, "shape");
  });
}

const VECTOR = (body: string): string => MINIMAL.replace("      - {source: sheet, rect: [0, 0, 8, 8]}\n", `      - {source: sheet, rect: [0, 0, 8, 8]}\n${body}`);

const INVALID_VECTORS: readonly [string, string, string, string][] = [
  ["a solid outline with attributes", "    solid:\n      - {label: A, attributes: 1, closed: true, points: [[0, 0], [1, 0], [1, 1]]}\n", "assets[0].solid[0].attributes", "only on `under`"],
  ["a vector with a generic type", "    solid:\n      - {label: A, type: wall, closed: true, points: [[0, 0], [1, 0], [1, 1]]}\n", "assets[0].solid[0].type", "closed"],
  ["an unlabeled vector", "    solid:\n      - {closed: true, points: [[0, 0], [1, 0], [1, 1]]}\n", "assets[0].solid[0].label", "`label` is required"],
  ["a closed outline with two points", "    solid:\n      - {label: A, closed: true, points: [[0, 0], [1, 0]]}\n", "assets[0].solid[0].points", "at least 3"],
  ["an open outline with one point", "    solid:\n      - {label: A, closed: false, points: [[0, 0]]}\n", "assets[0].solid[0].points", "at least 2"],
  ["a fractional point", "    solid:\n      - {label: A, closed: false, points: [[0, 0], [1.5, 1]]}\n", "assets[0].solid[0].points[1][0]", "whole number"],
  ["a point of three numbers", "    solid:\n      - {label: A, closed: false, points: [[0, 0], [1, 1, 1]]}\n", "assets[0].solid[0].points[1]", "x and y"],
  ["a non-boolean closed", "    solid:\n      - {label: A, closed: yes, points: [[0, 0], [1, 1]]}\n", "assets[0].solid[0].closed", "true or false"],
  ["an open under region", "    under:\n      - {label: A, attributes: 1, closed: false, points: [[0, 0], [1, 0], [1, 1]]}\n", "assets[0].under[0].closed", "closed polygon"],
  ["an under region without a mask", "    under:\n      - {label: A, closed: true, points: [[0, 0], [1, 0], [1, 1]]}\n", "assets[0].under[0].attributes", "`attributes` is required"],
  ["an under mask above 7", "    under:\n      - {label: A, attributes: 8, closed: true, points: [[0, 0], [1, 0], [1, 1]]}\n", "assets[0].under[0].attributes", "0 to 7"],
  ["a negative under mask", "    under:\n      - {label: A, attributes: -1, closed: true, points: [[0, 0], [1, 0], [1, 1]]}\n", "assets[0].under[0].attributes", "0 to 7"],
  ["a solid list that is not a list", "    solid: wall\n", "assets[0].solid", "list of collision outlines"],
];

for (const [name, body, path, fragment] of INVALID_VECTORS) {
  void test(`the reader refuses ${name}`, () => {
    const problems = refused(VECTOR(body));
    const found = problems.find((problem) => problem.path === path);
    if (found === undefined) throw new Error(`expected a problem at ${path}, got:\n${formatAssetPackProblems(problems)}`);
    ok(found.message.includes(fragment), `"${found.message}" should mention "${fragment}"`);
  });
}

void test("empty solid and under lists are valid and read as empty", () => {
  const pack = accepted(VECTOR("    solid: []\n    under: []\n"));
  deepEqual(pack.assets[0]?.solid, []);
  deepEqual(pack.assets[0]?.under, []);
});

void test("problems carry the line of the place they name", () => {
  const problems = refused(MINIMAL.replace("rect: [0, 0, 8, 8]", "rect: [0, 0, 0, 8]"));
  const rect = problems.find((problem) => problem.path === "assets[0].visuals[0].rect[2]");
  equal(rect?.line, 14);
  const dangling = refused(MINIMAL.replace("{source: sheet,", "{source: gone,"));
  equal(dangling.find((problem) => problem.path === "assets[0].visuals[0].source")?.line, 14);
});

void test("a malformed plugin block is a plugin-block problem and unknown core keys fail while the payload survives a valid read", () => {
  const cases: readonly [string, string][] = [
    [PACK.replace("com.example.glow:", "Com.Example.Glow:"), "id"],
    [PACK.replace("    version: 1.0.0\n", ""), "shape"],
    [PACK.replace("data: {bloom: 0.40, futureKnob: \"keep: exact\"}", "data: [bloom]"), "data"],
    [PACK.replace(/pluginData:[\s\S]*/, "pluginData: [com.example.glow]\n"), "container"],
  ];
  for (const [text, kind] of cases) {
    const problems = refused(text);
    ok(problems.some((problem) => problem.kind === "plugin-block" && problem.pluginKind === kind), `${kind}: ${formatAssetPackProblems(problems)}`);
  }
  const unknown = refused(PACK.replace("projection: iso-rotated\n", "projection: iso-rotated\nfuture: 1\n"));
  ok(unknown.some((problem) => problem.path === "future" && problem.message.includes("closed")));
  equal(accepted(PACK).pluginData?.["com.example.glow"]?.version, "1.0.0");
  // A plugin may not claim a core field as its id.
  ok(refused(PACK.replace("com.example.glow:", "assets:")).some((problem) => problem.kind === "plugin-block"));
});

void test("YAML that does not parse is refused with a located problem", () => {
  const problems = refused(`${MINIMAL}name: again\n`);
  ok(problems.some((problem) => problem.message.startsWith("YAML error")), formatAssetPackProblems(problems));
});

void test("checkAssetPack checks a model without a document", () => {
  deepEqual(checkAssetPack(accepted(MINIMAL)), []);
  deepEqual(checkAssetPack(accepted(PACK)), [], "the plugin source token is not a contract key");
  const bad = { ...accepted(MINIMAL), projection: "hex", extra: true, assets: [] };
  const paths = checkAssetPack(bad).map((problem) => problem.path);
  deepEqual(paths.sort(), ["assets", "extra", "projection"]);
  ok(checkAssetPack(null).length > 0);
  ok(checkAssetPack(accepted(MINIMAL)).every((problem) => problem.line === null));
});

// ---------------------------------------------------------------- editing

void test("editing a collision point changes one value and leaves comments and the plugin block as written", () => {
  const edited = setAssetPackProperty(PACK, ["assets", 0, "solid", 0, "points", 1, 0], -30);
  ok(edited.ok);
  if (!edited.ok) return;
  deepEqual(changedLines(PACK, edited.text), [28]);
  ok(edited.text.includes("points: [[-48, -8], [-30, 0], [-16, -8], [-32, -16]]"));
  deepEqual(comments(edited.text), comments(PACK));
  equal(edited.text.slice(edited.text.indexOf("pluginData:")), PLUGIN_TAIL);
  deepEqual(accepted(edited.text).assets[0]?.solid?.[0]?.points[1], [-30, 0]);
});

void test("editing a scalar keeps the trailing comment and its spacing", () => {
  const edited = setAssetPackProperty(PACK, ["grid", "tileWidth"], 96);
  ok(edited.ok);
  if (!edited.ok) return;
  ok(edited.text.includes("  tileWidth: 96 # logical pixels\n"));
  deepEqual(changedLines(PACK, edited.text), [6]);

  const renamed = setAssetPackProperty(PACK, ["assets", 1, "name"], "Oak: Chest");
  ok(renamed.ok);
  if (renamed.ok) ok(renamed.text.includes('name: "Oak: Chest"'), "a value that needs quotes is quoted");

  const quoted = setAssetPackProperty('contract: asset-pack\nversion: 1.0.0-pre.1\nname: "Kit"\nprojection: 2d\n' + MINIMAL.split("projection: 2d\n")[1]!, ["name"], "Kit Two");
  ok(quoted.ok);
  if (quoted.ok) ok(quoted.text.includes('name: "Kit Two"'), "a quoted scalar keeps its quote style");
});

void test("editing a flag, a mask, a rect and a color-key channel is done in place", () => {
  const mask = setAssetPackProperty(PACK, ["assets", 0, "under", 0, "attributes"], 3);
  ok(mask.ok);
  if (mask.ok) deepEqual(changedLines(PACK, mask.text), [31]);

  const closed = setAssetPackProperty(PACK, ["assets", 1, "solid", 0, "closed"], true);
  // two points are too few for a closed outline, so the edit is refused instead of leaving an invalid pack
  ok(!closed.ok);
  if (!closed.ok) ok(closed.problems[0]?.message.includes("at least 3"), formatAssetPackProblems(closed.problems));

  const rect = setAssetPackProperty(PACK, ["assets", 0, "visuals", 0, "rect"], [8, 8, 64, 64]);
  ok(rect.ok);
  if (rect.ok) {
    ok(rect.text.includes("rect: [8, 8, 64, 64]"));
    deepEqual(changedLines(PACK, rect.text), [23]);
  }

  const color = setAssetPackProperty(PACK, ["sources", 1, "transparent", "color"], [0, 0, 0]);
  ok(color.ok);
  if (color.ok) ok(color.text.includes("transparent: {mode: colorKey, color: [0, 0, 0]}"));

  const points = setAssetPackProperty(PACK, ["assets", 1, "solid", 0, "points"], [[-1, 0], [1, 0], [1, 1]]);
  ok(points.ok);
  if (points.ok) ok(points.text.includes("points: [[-1, 0], [1, 0], [1, 1]]"));
});

void test("setting an absent optional key adds one line after the key that precedes it", () => {
  const withCategory = setAssetPackProperty(PACK, ["assets", 1, "category"], "Furniture");
  ok(withCategory.ok);
  if (!withCategory.ok) return;
  ok(withCategory.text.includes("    name: Wooden Chest\n    category: Furniture\n    kind: prop\n"), withCategory.text);
  equal(withCategory.text.split("\n").length, PACK.split("\n").length + 1);
  equal(withCategory.text.slice(withCategory.text.indexOf("pluginData:")), PLUGIN_TAIL);
  equal(accepted(withCategory.text).assets[1]?.category, "Furniture");

  const flow = setAssetPackProperty(PACK, ["assets", 1, "visuals", 0, "layerOffset"], 2);
  ok(flow.ok);
  if (flow.ok) ok(flow.text.includes("- {source: keyed-sheet, rect: [128, 0, 32, 32], layerOffset: 2}"), flow.text);

  const tags = setAssetPackProperty(MINIMAL, ["metadata"], "x");
  ok(!tags.ok, "a scalar cannot stand for a mapping");
});

void test("an invalid path, a wrong value type or an unsafe edit is refused with a located reason and changes nothing", () => {
  const cases: readonly [readonly (string | number)[], string | number | boolean | readonly number[], string][] = [
    [["assets", 5, "name"], "x", "no such"],
    [["assets", 0, "solid", 0, "points", 1, 5], 1, "no such list entry"],
    [["assets", 0, "nothing", "deeper"], "x", "no such place"],
    [["assets", 0, "kind"], "sprite", "not one of"],
    [["assets", 0, "under", 0, "attributes"], 9, "0 to 7"],
    [["assets", 0, "anchor", "x"], 1.5, "whole number"],
    [["projection"], "hex", "not one of"],
    [["assets", 0, "visuals", 0, "source"], "gone", "not the ID of a source"],
    [["sources", 0, "id"], "renamed-atlas", "not the ID of a source"],
    [["assets", 0, "visuals", 0, "rect"], 5, "one-line scalar"],
    [["assets", 0, "name"], [1, 2], "one-line list"],
    [["assets", 0, "extra"], 1, "closed"],
    [["assets", 0, "anchor"], "x", "one-line scalar"],
    [[], "x", "names a place"],
  ];
  for (const [path, value, fragment] of cases) {
    const result = setAssetPackProperty(PACK, path, value);
    ok(!result.ok, `${JSON.stringify(path)} should be refused`);
    if (result.ok) continue;
    const problem = result.problems[0];
    ok(problem?.message.includes(fragment), `${JSON.stringify(path)}: "${problem?.message}" should mention "${fragment}"`);
  }
  const missing = setAssetPackProperty(PACK, ["assets", 0, "solid", 0, "points", 0, 0], "text");
  ok(!missing.ok, "text where a whole number belongs is refused");
});

void test("a plugin block above the core fields bounds the plugin token and leaves those fields editable", () => {
  const block = "pluginData: # opaque, above the fields\n  com.example.glow:\n    version: 1.0.0\n    data: {bloom: 0.40} # keep\n";
  const rest = MINIMAL.slice(MINIMAL.indexOf("name: Tiny\n"));
  const above = `contract: asset-pack\nversion: 1.0.0-pre.1\n${block}${rest}`;
  const read = readAssetPack(above);
  ok(read.ok, read.ok ? "" : formatAssetPackProblems(read.problems));
  if (!read.ok) return;
  equal(read.assetPack.pluginSource, block.replace(/\n$/, ""), "the token stops at the end of the block, not at the end of the file");

  const written = writeAssetPack(read.assetPack, above);
  ok(written.ok);
  if (written.ok) equal(written.text, above);

  const renamed = setAssetPackProperty(above, ["name"], "Renamed");
  ok(renamed.ok, renamed.ok ? "" : formatAssetPackProblems(renamed.problems));
  if (renamed.ok) {
    deepEqual(changedLines(above, renamed.text), [6]);
    ok(renamed.text.includes(block), "the plugin block is byte for byte as authored");
  }
  const grid = setAssetPackProperty(above, ["grid", "tileWidth"], 64);
  ok(grid.ok, grid.ok ? "" : formatAssetPackProblems(grid.problems));
  const category = setAssetPackProperty(above, ["assets", 0, "category"], "Rocks");
  ok(category.ok, category.ok ? "" : formatAssetPackProblems(category.problems));
  if (category.ok) ok(category.text.includes(block));
  ok(!setAssetPackProperty(above, ["pluginData", "com.example.glow", "version"], "1.1.0").ok, "the plugin block stays uneditable");
  ok(!writeAssetPack({ ...read.assetPack, name: "Renamed" }, above).ok, "a changed model is not paired with the source");
});

void test("a plugin block is never edited, and a document the reader refuses is never edited", () => {
  for (const path of [["pluginData"], ["pluginData", "com.example.glow", "version"], ["pluginData", "com.example.glow", "data", "bloom"]]) {
    const result = setAssetPackProperty(PACK, path, "1.1.0");
    ok(!result.ok);
    if (!result.ok) {
      equal(result.problems[0]?.kind, "edit");
      ok(result.problems[0]?.message.includes("plugin blocks"));
    }
  }
  const broken = setAssetPackProperty(MINIMAL.replace("projection: 2d", "projection: hex"), ["name"], "Fixed");
  ok(!broken.ok, "the editor does not repair a document the reader refuses");
  if (!broken.ok) equal(broken.problems[0]?.path, "projection");
});

void test("an edit keeps CRLF line endings when it adds a key", () => {
  const crlf = MINIMAL.replace(/\n/g, "\r\n");
  const edited = setAssetPackProperty(crlf, ["assets", 0, "category"], "Rocks");
  ok(edited.ok);
  if (edited.ok) ok(edited.text.includes("    name: Rock\r\n    category: Rocks\r\n    kind: backdrop\r\n"), JSON.stringify(edited.text));
});
