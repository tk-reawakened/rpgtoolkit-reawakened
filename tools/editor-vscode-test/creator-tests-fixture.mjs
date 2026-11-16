import { createEmptyBoard, createEmptyCharacter, writeBoard, writeCharacter } from "@tk-reawakened/core";

export const CREATOR_TEST_SPEC_PATH = ".tkr-tests/Prg/wall.spec.prg";
export const CREATOR_TEST_CASE_NAME = "wall stops movement";

/** Authored, ordinary project bytes shared by native and browser TOOL-5 proofs. */
export function createCreatorTestFiles({ failWall = false } = {}) {
  if (typeof failWall !== "boolean") throw new TypeError("failWall must be a boolean");
  const boardResult = writeBoard({
    ...createEmptyBoard(),
    sizeX: 5,
    sizeY: 3,
    sizeL: 1,
    tileMatrix: Array(15).fill(0),
    tileRuns: [{ lutIndex: 0, count: 15, marker: true }],
    layerTitles: ["", "Ground"],
    vectors: [{
      points: [{ x: 64, y: 0 }, { x: 66, y: 0 }, { x: 66, y: 96 }, { x: 64, y: 96 }],
      attributes: 0,
      closed: 1,
      layer: 1,
      type: 1,
      handle: "wall",
    }],
    properties: {
      ...createEmptyBoard().properties,
      backgroundImage: "Media/floor.png",
      backgroundDrawType: 2,
      backgroundColour: { r: 22, g: 58, b: 84 },
      start: { x: 1, y: 2, layer: 1 },
    },
  });
  const characterResult = writeCharacter({
    ...createEmptyCharacter(),
    minor: 5,
    name: "Proof Hero",
    movementAnimations: Array(8).fill(""),
    battleStances: Array(6).fill(""),
  });
  if (!boardResult.ok) throw new Error(`Could not author creator-test board: ${boardResult.error.message}`);
  if (!characterResult.ok) throw new Error(`Could not author creator-test character: ${characterResult.error.message}`);
  const expectedTile = failWall ? 3 : 2;
  const spec = [
    'specFixture({ board: "Boards/wall.brd", party: { length: 1, "0": "Chrs/Hero.tem" }, x: 1, y: 2, facing: "E" })',
    "globalProof = 0",
    "beforeAll(() => {",
    "  globalProof = 7",
    "})",
    "beforeEach(() => {",
    "  GiveGP(3)",
    "})",
    `it("${CREATOR_TEST_CASE_NAME}", () => {`,
    '  specAction("right", 30)',
    `  expect(specValue("player.tileX")).toBe(${expectedTile})`,
    '  expect(specValue("gold")).toBe(3)',
    '  expect(specValue("variable.globalProof")).toBe(7)',
    "})",
  ].join("\n");
  return [
    { path: ".tkr-tests/Boards/wall.brd", bytes: boardResult.value },
    { path: ".tkr-tests/Chrs/Hero.tem", bytes: characterResult.value },
    { path: ".tkr-tests/Media/floor.png", bytes: new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jg9sAAAAASUVORK5CYII=", "base64")) },
    { path: CREATOR_TEST_SPEC_PATH, bytes: new TextEncoder().encode(spec) },
  ];
}
