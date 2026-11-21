import { deepEqual, ok } from "node:assert/strict";
import test from "node:test";
import { checkTerrainTileset, readTerrainTileset, writeTerrainTileset } from "../src/terrain-tileset.ts";

const SAMPLE = `contract: tileset
version: 1.0.0-pre.1
name: Village
expects: {projection: 2d, cellSize: [32, 32]}
tiles:
  - {tile: tiles/grass.tkrtle}
terrains:
  - id: meadow
    name: Meadow
    resolver: {provider: builtin, id: neighbour-match, version: 1.0.0}
    neighbours: cardinal-4
    coverage: partial
    sync: independent
    rules:
      - id: default
        when: {}
        use: {tile: tiles/grass.tkrtle}
sources:
  - id: old-sheet
    file: art/raised.png
    grid: {width: 32, height: 32, marginX: 0, marginY: 0, gapX: 0, gapY: 0}
    transparent: {mode: alpha}
isoBlocks:
  - id: raised-stone
    name: Raised stone
    heightPixels: 32
    faces:
      top: {source: old-sheet, cell: [0, 0]}
      left: {source: old-sheet, cell: [1, 0]}
      right: {source: old-sheet, cell: [2, 0]}
    collision: solid
    wallCapUnder: true
outputBinding:
  target: Tiles/village.tst
  detail: 1
  slots:
    - {slot: 1, tile: tiles/grass.tkrtle}
    - {slot: 2, reserved: true}
`;

test("terrain tileset retains raised source recipes and the original YAML", () => {
  const result = readTerrainTileset(SAMPLE);
  ok(result.ok);
  deepEqual(result.tileset.isoBlocks?.[0], {
    id: "raised-stone", name: "Raised stone", heightPixels: 32,
    faces: { top: { source: "old-sheet", cell: [0, 0] }, left: { source: "old-sheet", cell: [1, 0] }, right: { source: "old-sheet", cell: [2, 0] } },
    collision: "solid", wallCapUnder: true,
  });
  deepEqual(writeTerrainTileset(result.tileset, result.source), { ok: true, text: SAMPLE });
});

test("terrain tileset rejects non-contiguous slots, non-member mappings and unsupported pins", () => {
  for (const [from, to] of [
    ["slot: 2, reserved: true", "slot: 3, reserved: true"],
    ["use: {tile: tiles/grass.tkrtle}", "use: {tile: tiles/unknown.tkrtle}"],
    ["version: 1.0.0}", "version: 2.0.0}"],
  ] as const) {
    const result = readTerrainTileset(SAMPLE.replace(from, to));
    ok(!result.ok, `${from} -> ${to} must be rejected`);
  }
  const parsed = readTerrainTileset(SAMPLE);
  ok(parsed.ok);
  const invalid = { ...parsed.tileset, terrains: parsed.tileset.terrains?.map((terrain) => ({ ...terrain, resolver: { ...terrain.resolver, provider: "plugin" } })) };
  ok(checkTerrainTileset(invalid).some(({ path }) => path.endsWith("resolver")));
});
