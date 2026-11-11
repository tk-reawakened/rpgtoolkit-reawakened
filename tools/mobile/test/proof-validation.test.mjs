import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertDocumentTitle,
  assertReport,
  assertCanvasFrame,
  assertScreenshotManifest,
  REQUIRED_SCREENSHOTS,
} from "../proof-validation.mjs";

const validReport = Object.freeze({
  tick: 31,
  stateHash: "0123456789abcdef",
  drawHash: "fedcba9876543210",
  board: "Demo",
  player: { x: 208, y: 191 },
  save: { path: "slot-1.json", written: true, blobPresent: false },
});

function cloneReport() {
  return structuredClone(validReport);
}

test("accepts a complete live report and returns an independent value", () => {
  const result = assertReport(validReport, "board");
  assert.deepEqual(result, validReport);
  assert.notStrictEqual(result, validReport);
});

test("rejects an absent or non-object report", () => {
  assert.throws(() => assertReport(null, "board"), /page report is absent/);
  assert.throws(() => assertReport(undefined, "board"), /page report is absent/);
  assert.throws(() => assertReport([], "board"), /page report is absent/);
});

test("rejects absent or malformed ticks", () => {
  for (const tick of [undefined, null, 0, -1, 1.5, "31", Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const report = cloneReport();
    report.tick = tick;
    assert.throws(() => assertReport(report, "board"), /invalid tick/);
  }
});

test("rejects absent or malformed state and draw hashes", () => {
  for (const key of ["stateHash", "drawHash"]) {
    for (const hash of [undefined, "", "0123456789abcde", "0123456789abcdefg", null, 123]) {
      const report = cloneReport();
      report[key] = hash;
      assert.throws(() => assertReport(report, "board"), new RegExp(`invalid ${key === "stateHash" ? "state" : "draw"} hash`));
    }
  }
});

test("rejects absent, null, or empty board entry", () => {
  for (const board of [undefined, null, ""]) {
    const report = cloneReport();
    report.board = board;
    assert.throws(() => assertReport(report, "board"), /board entry is missing/);
  }
});

test("rejects absent or malformed player coordinates", () => {
  for (const player of [undefined, null, {}, { x: Number.NaN, y: 1 }, { x: 1, y: Infinity }, { x: "1", y: 2 }]) {
    const report = cloneReport();
    report.player = player;
    assert.throws(() => assertReport(report, "board"), /player position is missing or invalid/);
  }
});

test("rejects absent or malformed host-save readings", () => {
  const invalidSaves = [
    undefined,
    null,
    [],
    { ...validReport.save, path: "other.json" },
    { ...validReport.save, written: false },
    { path: "slot-1.json", written: true },
    { ...validReport.save, blobPresent: "false" },
  ];
  for (const save of invalidSaves) {
    const report = cloneReport();
    report.save = save;
    assert.throws(() => assertReport(report, "board"), /host blob write and presence reading/);
  }
});

test("allows a title-screen report without board, player, or save evidence", () => {
  const title = {
    tick: 31,
    stateHash: validReport.stateHash,
    drawHash: validReport.drawHash,
    board: null,
    player: null,
  };
  assert.deepEqual(assertReport(title, "title", { needsBoard: false, needsSave: false }), title);
});

test("requires an exact document title for the live report", () => {
  const title = `mobile: ${validReport.board} ${validReport.tick} ${validReport.stateHash}`;
  assertDocumentTitle(validReport, title, "board");
  for (const malformed of [undefined, null, "", "mobile: Demo 31 stale-hash", "mobile: demo 31 0123456789abcdef"]) {
    assert.throws(() => assertDocumentTitle(validReport, malformed, "board"), /document.title does not match/);
  }
});

test("rejects missing screenshots and screenshot files", () => {
  const complete = Object.fromEntries(REQUIRED_SCREENSHOTS.map((name) => [name, `${name}.png`]));
  assertScreenshotManifest(complete, () => true);

  const missingEntry = { ...complete };
  delete missingEntry.tap;
  assert.throws(() => assertScreenshotManifest(missingEntry, () => true), /expected four saved screenshots/);
  assert.throws(() => assertScreenshotManifest(complete, (path) => path !== "rotation.png"), /missing screenshot rotation/);
});

/**
 * #1657: the proof passed while every retained screenshot showed a black game area. These cases pin the two halves of the
 * fix — a stored frame that decodes to black is refused, and the manifest is incomplete without one frame per stage.
 */
test("a saved canvas frame must decode to visible pixels", () => {
  const visible = { w: 16, h: 16, rgba: new Uint8Array(16 * 16 * 4).fill(255) };
  assert.deepEqual(assertCanvasFrame(visible, "title"), { width: 16, height: 16, nonBlackPixels: 256 });

  assert.throws(() => assertCanvasFrame({ w: 640, h: 480, rgba: new Uint8Array(640 * 480 * 4) }, "title"), /is black or lacks visible content/);
  assert.throws(() => assertCanvasFrame({ w: 0, h: 0, rgba: new Uint8Array(0) }, "title"), /has no pixels/);
  assert.throws(() => assertCanvasFrame({ w: 4, h: 4, rgba: new Uint8Array(10) }, "title"), /is not RGBA/);
  assert.throws(() => assertCanvasFrame(null, "title"), /has no pixels/);
});

test("the screenshot manifest requires one canvas frame per stage", () => {
  const screenshots = { title: "title.png", tap: "tap.png", rotation: "rotation.png", relaunch: "relaunch.png" };
  const frames = Object.fromEntries(Object.keys(screenshots).map((name) => [name, { path: `${name}-canvas.png`, nonBlackPixels: 900 }]));
  assertScreenshotManifest(screenshots, () => true, frames);

  const { rotation: _omitted, ...withoutRotation } = frames;
  assert.throws(() => assertScreenshotManifest(screenshots, () => true, withoutRotation), /missing canvas frame rotation/);
  assert.throws(
    () => assertScreenshotManifest(screenshots, (path) => !path.endsWith("relaunch-canvas.png"), frames),
    /missing canvas frame file relaunch/,
  );
  assert.throws(
    () => assertScreenshotManifest(screenshots, () => true, { ...frames, tap: { path: "tap-canvas.png", nonBlackPixels: 0 } }),
    /canvas frame tap reports no visible content/,
  );
});
