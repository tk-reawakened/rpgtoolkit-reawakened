import { ANIMATION_MAGIC, createEmptyBoard, createEmptyCharacter, writeAnimation, writeBoard, writeCharacter } from "@tk-reawakened/core";

export const CREATOR_TEST_SPEC_PATH = ".tkr-tests/Prg/wall.spec.prg";
export const CREATOR_TEST_CASE_NAME = "wall stops movement";
const HERO_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAYUlEQVR42mP4z/D//0BihlEHkKL41xEDovCoA2juAAk5NTDGxR/+DhhNAwPiALkjLSTh4eUAWNASazkpUTHqgFEHDA0HjJYDg8IBIOyorYCCCYmPOmDUAaMOGH4OGJadUwDKwj3WIfzvWAAAAABJRU5ErkJggg==";

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
      points: [{ x: 96, y: 0 }, { x: 98, y: 0 }, { x: 98, y: 96 }, { x: 96, y: 96 }],
      attributes: 0,
      closed: 1,
      layer: 1,
      type: 1,
      handle: "wall",
    }],
    properties: {
      ...createEmptyBoard().properties,
      backgroundImage: "",
      backgroundDrawType: 0,
      backgroundColour: { r: 22, g: 58, b: 84 },
      start: { x: 1, y: 2, layer: 1 },
    },
  });
  const animationResult = writeAnimation({
    magic: ANIMATION_MAGIC,
    major: 2,
    minor: 3,
    width: 32,
    height: 32,
    frames: [{ image: "hero.png", transparent: { r: 255, g: 0, b: 255 }, sound: "" }],
    delay: 0.1,
    residue: new Uint8Array(),
  });
  const characterResult = writeCharacter({
    ...createEmptyCharacter(),
    minor: 5,
    name: "Proof Hero",
    movementAnimations: Array(8).fill("walk.anm"),
    idleAnimations: Array(8).fill("walk.anm"),
    battleStances: Array(6).fill(""),
  });
  if (!boardResult.ok) throw new Error(`Could not author creator-test board: ${boardResult.error.message}`);
  if (!characterResult.ok) throw new Error(`Could not author creator-test character: ${characterResult.error.message}`);
  if (!animationResult.ok) throw new Error(`Could not author creator-test animation: ${animationResult.error.message}`);
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
  const heroPng = Uint8Array.from(atob(HERO_PNG_BASE64), (character) => character.charCodeAt(0));
  return [
    { path: ".tkr-tests/Boards/wall.brd", bytes: boardResult.value },
    { path: ".tkr-tests/Chrs/Hero.tem", bytes: characterResult.value },
    { path: ".tkr-tests/Misc/walk.anm", bytes: animationResult.value },
    { path: ".tkr-tests/Bitmap/hero.png", bytes: heroPng },
    { path: CREATOR_TEST_SPEC_PATH, bytes: new TextEncoder().encode(spec) },
  ];
}
