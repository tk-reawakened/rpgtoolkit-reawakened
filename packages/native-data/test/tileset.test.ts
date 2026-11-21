import { deepEqual, ok } from "node:assert/strict";
import test from "node:test";
import { checkTileset, readTileset, writeTileset, type Tileset } from "../src/tileset.ts";

const SAMPLE = `contract: tileset # the stamp
version: 1.0.0-pre.2
name: Village
expects: {projection: 2d, cellSize: [32, 32]}
tiles:
  - {tile: Tiles/grass.tkrtle} # meadow
  - {tile: Tiles/edge.tkrtle}
terrains:
  - id: meadow
    name: Meadow
    resolver: {provider: builtin, id: neighbour-match, version: 1.0.0}
    neighbours: cardinal-4
    coverage: partial
    sync: independent
    rules:
      - id: plain
        when: {}
        use: {tile: Tiles/grass.tkrtle}
      - id: edge
        when: {e: same}
        variants:
          - {tile: Tiles/edge.tkrtle, weight: 2}
          - {tile: Tiles/grass.tkrtle, weight: 1}
outputBinding:
  target: Tiles/village.tst
  detail: 1
  slots:
    - {slot: 1, tile: Tiles/grass.tkrtle}
    - {slot: 2, tile: Tiles/edge.tkrtle}
    - {slot: 3, reserved: true}
pluginData:
  com.example.weather:
    version: 1.0.0
    data: {future: 1.10} # opaque
`;

const PLAIN: Tileset = {
  contract: "tileset",
  version: "1.0.0-pre.2",
  name: "Plain",
  expects: { projection: "2d", cellSize: [16, 16] },
  tiles: [{ tile: "Tiles/a.tkrtle" }],
  outputBinding: { target: "Tiles/plain.tst", detail: 1, slots: [{ slot: 1, tile: "Tiles/a.tkrtle" }] },
};

void test("a canonical tileset reads and writes back its exact source", () => {
  const result = readTileset(SAMPLE);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  deepEqual(result.tileset.tiles, [{ tile: "Tiles/grass.tkrtle" }, { tile: "Tiles/edge.tkrtle" }]);
  deepEqual(result.tileset.terrains?.[0]?.rules[1], { id: "edge", when: { e: "same" }, variants: [{ tile: "Tiles/edge.tkrtle", weight: 2 }, { tile: "Tiles/grass.tkrtle", weight: 1 }] });
  deepEqual(result.tileset.outputBinding.slots, [
    { slot: 1, tile: "Tiles/grass.tkrtle" },
    { slot: 2, tile: "Tiles/edge.tkrtle" },
    { slot: 3, reserved: true },
  ]);
  const written = writeTileset(result.tileset, result.source);
  deepEqual(written, { ok: true, text: SAMPLE });
});

void test("a regenerated tileset writes contract order and keeps every slot integer", () => {
  const written = writeTileset(PLAIN);
  if (!written.ok) throw new Error(JSON.stringify(written.problems));
  ok(written.text.startsWith("contract: tileset\nversion: 1.0.0-pre.2\nname: Plain\nexpects:\n  projection: 2d\n  cellSize:\n    - 16\n    - 16\ntiles:\n  - tile: Tiles/a.tkrtle\noutputBinding:\n  target: Tiles/plain.tst\n  detail: 1\n  slots:\n    - slot: 1\n      tile: Tiles/a.tkrtle\n"), written.text);
  const back = readTileset(written.text);
  if (!back.ok) throw new Error(JSON.stringify(back.problems));
  deepEqual(back.tileset, PLAIN);
});

void test("the old embedded tile form, autotiles and pre.1 are rejected", () => {
  const embedded = SAMPLE.replace("  - {tile: Tiles/grass.tkrtle} # meadow\n  - {tile: Tiles/edge.tkrtle}\n", "  - {id: grass, name: Grass, source: sheet, cell: [0, 0], role: floor, collision: walkable}\n");
  const rejected = readTileset(embedded);
  ok(!rejected.ok && rejected.problems.some((problem) => problem.message.includes("not allowed")));
  ok(!readTileset(SAMPLE.replace("version: 1.0.0-pre.2", "version: 1.0.0-pre.1")).ok);
  ok(!readTileset(SAMPLE.replace("outputBinding:", "autotiles: []\noutputBinding:")).ok);
});

void test("slot gaps, duplicate allocations, unknown members and non-contiguous slots are errors", () => {
  for (const [from, to] of [
    ["  - {slot: 3, reserved: true}", "  - {slot: 4, reserved: true}"],
    ["use: {tile: Tiles/grass.tkrtle}", "use: {tile: Tiles/unknown.tkrtle}"],
    ["  - {slot: 2, tile: Tiles/edge.tkrtle}", "  - {slot: 2, tile: Tiles/edge.tkrtle}\n  - {slot: 2, tile: Tiles/grass.tkrtle}"],
  ] as const) {
    ok(!readTileset(SAMPLE.replace(from, to)).ok, `${from} -> ${to}`);
  }
});

void test("a model check names a version, palette member or slot problem", () => {
  deepEqual(checkTileset({ ...PLAIN, version: "1.0.0-pre.1" }).map((problem) => problem.path), ["version"]);
  ok(checkTileset({ ...PLAIN, tiles: [{ tile: "Tiles/a.tkrtle" }, { tile: "Tiles/a.tkrtle" }] }).some((problem) => problem.message.includes("duplicate normalized")));
  ok(checkTileset({ ...PLAIN, outputBinding: { ...PLAIN.outputBinding, slots: [{ slot: 2, reserved: true }] } }).some((problem) => problem.path === "outputBinding.slots"));
});

void test("a plugin block needs its source to be written", () => {
  const result = readTileset(SAMPLE);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  const noSource = writeTileset(result.tileset);
  ok(!noSource.ok && noSource.problems[0]!.path === "pluginData");
});
