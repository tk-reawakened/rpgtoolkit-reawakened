import { deepEqual, equal } from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkSceneGolden, runTracerScene, type TracerScene } from "@tk-reawakened/runner-harness";

const TEST_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = dirname(dirname(TEST_ROOT));
const readBytes = (path: string): Uint8Array => new Uint8Array(readFileSync(join(REPO_ROOT, path)));
const sceneText = readFileSync(join(REPO_ROOT, "golden/scenes/S-01.json"), "utf8");
const scene = JSON.parse(sceneText) as TracerScene;
const assets = scene.boardFiles.map((path) => ({ path, bytes: readBytes(path) }));

test("S-01 runs through the real tracer twice with stable hashes and exact independent pixels", () => {
  const files = new Map(assets.map((asset) => [asset.path, asset.bytes]));
  const first = runTracerScene(scene, files);
  const second = runTracerScene(scene, files);
  equal(first.error, null);
  equal(second.error, null);
  equal(first.drawHash, second.drawHash);
  equal(first.stateHash, second.stateHash);
  deepEqual(first.pixels, second.pixels);
  const outcome = checkSceneGolden({ sceneText, assets, referencePng: readBytes("golden/reference/S-01.png"), ledgerText: readFileSync(join(REPO_ROOT, "golden/ledger.json"), "utf8") });
  equal(outcome.ok, true, outcome.message);
});

for (const name of ["S-ISO-STACKED", "S-ISO-ROTATED", "S-LIGHT-ELLIPSE", "S-LIGHT-GRADIENT", "S-LIGHT-CLIPPED", "S-LIGHT-OVERLAP", "S-LIGHT-NIGHT", "S-LIGHT-BOUNDARY", "S-LIGHT-SHADE"]) {
  test(`${name} runs through the real tracer and matches its independent oracle`, () => {
    const sceneText = readFileSync(join(REPO_ROOT, `golden/scenes/${name}.json`), "utf8");
    const scene = JSON.parse(sceneText) as TracerScene;
    const assets = scene.boardFiles.map((path) => ({ path, bytes: readBytes(path) }));
    const files = new Map(assets.map((asset) => [asset.path, asset.bytes]));
    const first = runTracerScene(scene, files);
    const second = runTracerScene(scene, files);
    equal(first.error, null);
    equal(second.error, null);
    equal(first.drawHash, second.drawHash);
    equal(first.stateHash, second.stateHash);
    deepEqual(first.pixels, second.pixels);
    const outcome = checkSceneGolden({
      sceneText,
      assets,
      referencePng: readBytes(`golden/reference/${name}.png`),
      ledgerText: readFileSync(join(REPO_ROOT, "golden/ledger.json"), "utf8"),
    });
    equal(outcome.ok, true, outcome.message);
  });
}
