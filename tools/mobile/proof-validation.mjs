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

export function assertScreenshotManifest(screenshots, fileExists) {
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
}
