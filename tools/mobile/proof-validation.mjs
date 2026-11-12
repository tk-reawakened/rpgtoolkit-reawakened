export const REQUIRED_SCREENSHOTS = Object.freeze(["title", "tap", "rotation", "relaunch"]);

export function assertReport(value, label, { needsBoard = true, needsSave = true } = {}) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}: page report is absent`);
  }
  if (typeof value.error === "string" && value.error.length > 0) throw new Error(`${label}: page error: ${value.error}`);
  if (!Number.isSafeInteger(value.tick) || value.tick <= 0) throw new Error(`${label}: invalid tick: ${value.tick}`);
  if (!/^[0-9a-f]{16}$/i.test(value.stateHash ?? "")) throw new Error(`${label}: invalid state hash: ${value.stateHash}`);
  if (!/^[0-9a-f]{16}$/i.test(value.drawHash ?? "")) throw new Error(`${label}: invalid draw hash: ${value.drawHash}`);
  if (needsBoard && (typeof value.board !== "string" || value.board.length === 0)) {
    throw new Error(`${label}: board entry is missing`);
  }
  if (needsBoard && (
    value.player === null || typeof value.player !== "object" ||
    !Number.isFinite(value.player.x) || !Number.isFinite(value.player.y)
  )) {
    throw new Error(`${label}: player position is missing or invalid`);
  }
  if (needsSave && (
    value.save === null || typeof value.save !== "object" || Array.isArray(value.save) ||
    value.save.path !== "slot-1.json" ||
    value.save.written !== true ||
    typeof value.save.blobPresent !== "boolean"
  )) {
    throw new Error(`${label}: expected a successful slot-1.json host blob write and presence reading; got ${JSON.stringify(value.save)}`);
  }
  return structuredClone(value);
}

export function assertDocumentTitle(report, actualTitle, label) {
  const expectedTitle = report.error
    ? `mobile: ${report.error}`
    : `mobile: ${report.board ?? "booting"} ${report.tick} ${report.stateHash}`;
  if (actualTitle !== expectedTitle) {
    throw new Error(`${label}: document.title does not match its live report; expected ${JSON.stringify(expectedTitle)}, got ${JSON.stringify(actualTitle)}`);
  }
}

/**
 * A saved canvas frame must hold the frame the reading measured. A PNG that decodes to black is the failure #1657
 * reported: the page's own reading showed drawn commands while the retained artefact showed nothing.
 */
export function assertCanvasFrame(decoded, name) {
  if (decoded === null || typeof decoded !== "object" || !Number.isSafeInteger(decoded.w) || !Number.isSafeInteger(decoded.h) || decoded.w <= 0 || decoded.h <= 0) {
    throw new Error(`${name}: the saved canvas frame has no pixels`);
  }
  const rgba = decoded.rgba;
  if (!(rgba instanceof Uint8Array) || rgba.length !== decoded.w * decoded.h * 4) {
    throw new Error(`${name}: the saved canvas frame is not RGBA for ${decoded.w}x${decoded.h}`);
  }
  let nonBlackPixels = 0;
  for (let index = 0; index < rgba.length; index += 4) {
    if (rgba[index] !== 0 || rgba[index + 1] !== 0 || rgba[index + 2] !== 0) nonBlackPixels += 1;
  }
  const minimum = Math.max(64, Math.ceil(decoded.w * decoded.h * 0.001));
  if (nonBlackPixels < minimum) {
    throw new Error(`${name}: the saved canvas frame is black or lacks visible content: ${JSON.stringify({ width: decoded.w, height: decoded.h, nonBlackPixels, minimum })}`);
  }
  return { width: decoded.w, height: decoded.h, nonBlackPixels };
}

export function assertScreenshotManifest(screenshots, fileExists, canvasFrames = null) {
  if (screenshots === null || typeof screenshots !== "object" || Array.isArray(screenshots) || typeof fileExists !== "function") {
    throw new Error("screenshot manifest is invalid");
  }
  const names = Object.keys(screenshots).sort();
  const expected = [...REQUIRED_SCREENSHOTS].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`expected four saved screenshots (${REQUIRED_SCREENSHOTS.join(", ")}); got ${JSON.stringify(screenshots)}`);
  }
  for (const name of REQUIRED_SCREENSHOTS) {
    const path = screenshots[name];
    if (typeof path !== "string" || path.length === 0 || !fileExists(path)) {
      throw new Error(`missing screenshot ${name}: ${JSON.stringify(path)}`);
    }
  }
  if (canvasFrames === null) return;
  // The page screenshot is chrome; the canvas frame is the game. Requiring both means a stage cannot pass with a game
  // area that nothing retained (#1657).
  if (typeof canvasFrames !== "object" || Array.isArray(canvasFrames)) throw new Error("canvas frame manifest is invalid");
  for (const name of REQUIRED_SCREENSHOTS) {
    const frame = canvasFrames[name];
    if (frame === undefined) throw new Error(`missing canvas frame ${name}`);
    if (typeof frame.path !== "string" || !fileExists(frame.path)) throw new Error(`missing canvas frame file ${name}: ${JSON.stringify(frame.path)}`);
    if (!Number.isSafeInteger(frame.nonBlackPixels) || frame.nonBlackPixels < 64) {
      throw new Error(`canvas frame ${name} reports no visible content: ${JSON.stringify(frame)}`);
    }
  }
}
