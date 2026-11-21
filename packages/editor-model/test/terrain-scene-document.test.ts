import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { utf8Encode } from "@tk-reawakened/core";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createDocumentIdentity } from "../src/identity.ts";
import { asTerrainSceneDocument, kindForPath } from "../src/kinds.ts";

const path = "Boards/pond.tkrscn";
const SOURCE = `contract: scene
version: 1.0.0-pre.2
name: Pond # keep this comment
projection: 2d
size: {width: 4, height: 3}
floors: [{id: ground}, {id: upper}]
placedPacks:
  - instanceId: lantern-1 # the lantern
    pack: Packs/props.tkrpack
    asset: lantern
    floor: ground
    x: 24
    y: 40
terrainRegions: []
`;

const expected = SOURCE.replace(`    y: 40
terrainRegions`, `    y: 40
  - instanceId: arch-1
    pack: Packs/props.tkrpack
    asset: arch
    floor: ground
    x: 8
    y: 16
terrainRegions`);

async function open(source = SOURCE) {
  const host = createMemoryPlatformServices({ files: { [path]: utf8Encode(source) } });
  const kind = kindForPath(path);
  ok(kind !== null);
  const opened = await kind.open(host.fs, createDocumentIdentity("memory-project", path));
  ok(opened.ok, JSON.stringify(opened));
  return asTerrainSceneDocument(opened.document);
}

void test("a placement edit is an accepted edit with normal undo and redo, preserving the rest of the file", async () => {
  const doc = await open();
  const applied = doc.apply({
    type: "edit-scene-terrain",
    terrain: { terrainRegions: [], tileOverrides: [] },
    placements: [
      { instanceId: "lantern-1", pack: "Packs/props.tkrpack", asset: "lantern", floor: "ground", x: 24, y: 40 },
      { instanceId: "arch-1", pack: "Packs/props.tkrpack", asset: "arch", floor: "ground", x: 8, y: 16 },
    ],
  });
  ok(applied.ok, JSON.stringify(applied));
  equal(doc.getSnapshot().text, expected);
  deepEqual(doc.getSnapshot().scene.placedPacks?.map(({ instanceId }) => instanceId), ["lantern-1", "arch-1"]);
  equal(doc.getSnapshot().dirty, true);

  ok(doc.undo().ok);
  equal(doc.getSnapshot().text, SOURCE);
  ok(doc.redo().ok);
  equal(doc.getSnapshot().text, expected);

  const unchanged = doc.apply({
    type: "edit-scene-terrain",
    terrain: { terrainRegions: [], tileOverrides: [] },
    placements: [
      { instanceId: "lantern-1", pack: "Packs/props.tkrpack", asset: "lantern", floor: "ground", x: 24, y: 40 },
      { instanceId: "arch-1", pack: "Packs/props.tkrpack", asset: "arch", floor: "ground", x: 8, y: 16 },
    ],
  });
  ok(!unchanged.ok);
  equal(unchanged.rejection.reason, "invalid");

  const saved = await doc.save();
  ok(saved.ok, JSON.stringify(saved));
});

void test("terrain and placements in one command both land, and a refused placement changes nothing", async () => {
  const doc = await open();
  const applied = doc.apply({
    type: "edit-scene-terrain",
    terrain: { terrainRegions: [], tileOverrides: [{ floor: "ground", cell: [0, 0], tile: {} }] },
    placements: [{ instanceId: "lantern-1", pack: "Packs/props.tkrpack", asset: "lantern", floor: "upper", x: 24, y: 40 }],
  });
  ok(applied.ok, JSON.stringify(applied));
  ok(doc.getSnapshot().text.includes("tileOverrides:"));
  ok(doc.getSnapshot().text.includes("floor: upper"));
  equal(doc.getSnapshot().text.includes("name: Pond # keep this comment"), true);
  const edited = doc.getSnapshot().text;

  const refused = doc.apply({
    type: "edit-scene-terrain",
    terrain: { terrainRegions: [], tileOverrides: [{ floor: "ground", cell: [0, 0], tile: {} }] },
    placements: [{ instanceId: "lantern-1", pack: "Packs/props.tkrpack", asset: "lantern", floor: "attic", x: 0, y: 0 }],
  });
  ok(!refused.ok);
  equal(refused.rejection.reason, "invalid");
  equal(doc.getSnapshot().text, edited);
});
