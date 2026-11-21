import { deepEqual, equal } from "node:assert/strict";
import test from "node:test";
import { sceneTerrainArtReferences, tilesetTerrainArtReferences } from "../src/terrain-art-references.ts";

const SCENE = `contract: scene
version: 1.0.0-pre.1
tilePalette:
  - {tile: 'tiles/field.tkrtle'}
floors:
  - id: ground
    boundarySources:
      walkableTiles: [{tile: tiles/walk.tkrtle}]
tileOverrides:
  - {floor: ground, cell: [0, 0], tile: {tile: tiles/override.tkrtle}}
terrainRegions:
  - id: grass-paint
    floor: ground
    terrain: {tileset: tiles/field.tkrtst, terrain: meadow}
`;

const TILESET = `contract: tileset
version: 1.0.0-pre.1
tiles:
  - {tile: tiles/grass.tkrtle}
terrains:
  - id: meadow
    rules:
      - id: plain
        use: {tile: tiles/grass.tkrtle}
      - id: edge
        variants: [{tile: tiles/edge.tkrtle, weight: 2}]
outputBinding:
  slots:
    - {slot: 1, tile: tiles/grass.tkrtle}
    - {slot: 2, reserved: true}
`;

test("scene terrain references retain source scalar ranges and local terrain IDs", () => {
  const result = sceneTerrainArtReferences(SCENE);
  deepEqual(result.problems, []);
  deepEqual(result.references.map(({ kind }) => kind), ["tile", "tile", "tile", "tileset"]);
  const paths = result.references.map(({ path }) => SCENE.slice(path.range![0], path.range![1]));
  deepEqual(paths, ["'tiles/field.tkrtle'", "tiles/walk.tkrtle", "tiles/override.tkrtle", "tiles/field.tkrtst"]);
  const terrain = result.references[3];
  if (terrain?.kind !== "tileset") throw new Error("expected scene terrain tileset reference");
  equal(terrain.localId, "meadow");
  equal(SCENE.slice(terrain.localIdScalar.range![0], terrain.localIdScalar.range![1]), "meadow");
});

test("tileset terrain references include palette, rule uses and variants, and allocated slots", () => {
  const result = tilesetTerrainArtReferences(TILESET);
  deepEqual(result.problems, []);
  deepEqual(result.references.map(({ kind }) => kind), ["tile", "tile", "tile", "tile"]);
  deepEqual(result.references.map(({ path }) => TILESET.slice(path.range![0], path.range![1])), [
    "tiles/grass.tkrtle", "tiles/grass.tkrtle", "tiles/edge.tkrtle", "tiles/grass.tkrtle",
  ]);
});

test("malformed declared reference shapes are reported and never returned as references", () => {
  const scene = sceneTerrainArtReferences(`contract: scene\ntilePalette: [{tile: 12}]\nterrainRegions: [{terrain: {tileset: tiles/field.tkrtst}}]\n`);
  equal(scene.references.length, 0);
  equal(scene.problems.length, 2);

  const tileset = tilesetTerrainArtReferences(`contract: tileset\ntiles: [{}]\nterrains: [{rules: [{use: {tile: 4}}]}]\noutputBinding: {slots: [{slot: 1, tile: null}]}\n`);
  equal(tileset.references.length, 0);
  equal(tileset.problems.length, 3);
});
