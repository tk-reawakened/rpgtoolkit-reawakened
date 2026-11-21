import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { BinaryReader, readBoard } from "@tk-reawakened/core";
import { readScene } from "@tk-reawakened/native-data";
import { writeResolvedSceneBoard } from "../src/scene-board-binary.ts";

void test("a resolved scene keeps the complete overshoot inside the final wire marker", () => {
  const source = readScene(`contract: scene
version: 1.0.0-pre.1
projection: 2d
size: {width: 200, height: 164}
floors:
  - {id: ground}
triggers:
  - {floor: ground}
  - {floor: ground, program: gate.prg, activation: {keyPress: true}}
shading:
  - floor: ground
    cells: [[32800, 286, -3, 0]]
    legacy: {excessCells: [32766, 286, -3, 0]}
legacy: {excessTiles: [32767, 0], trailingBytes: AQIDBA==}
`);
  if (!source.ok) throw new Error(JSON.stringify(source.problems));
  const cells = Array<number>(32_800).fill(0);
  const resolved = { lut: [], cells, generatedVectors: [], generatedImages: [] };
  const written = writeResolvedSceneBoard(source.scene, resolved);
  if (!written.ok) throw new Error(written.error.message);
  const decoded = readBoard(new BinaryReader(written.value));
  if (!decoded.ok) throw new Error(decoded.error.message);

  const board = decoded.value;
  equal(board.tileMatrix.length, 32_800 + 32_767);
  deepEqual(board.tileRuns.map(({ count }) => count), [32_768, 31, 32_768]);
  deepEqual(board.shadeLayers[0]?.records.at(-1), { runCount: 32_767, r: 286, g: -3, b: 0 });
  deepEqual(board.programs.map(({ program }) => program), ["", "gate.prg"]);
  deepEqual(board.residue, Uint8Array.of(1, 2, 3, 4));

  cells[32_799] = 1;
  const refused = writeResolvedSceneBoard(source.scene, { ...resolved, lut: ["", "grass.tst1"] });
  equal(refused.ok, false);
  if (refused.ok) throw new Error("the build must not attach unmatched residue to a different tile");
  equal(refused.error.section, "legacy.excessTiles");
});
