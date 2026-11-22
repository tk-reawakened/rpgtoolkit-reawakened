// Gate decision for the mobile proof artifact (#2721), keeping the emulator lane advisory (#1935).
//
// The emulator job writes `started.json` as the first action of its emulator step. Then:
//   - readings present and valid            → pass (`result: "passed"` or `"failed"`)
//   - readings present but empty/garbled    → fail
//   - no readings, start marker present     → fail: a lane that started must produce a verdict
//   - no readings, no start marker          → pass with a "did not run" annotation: the advisory lane never started
// That keeps "no proof must not pass silently" without putting emulator/AVD infrastructure failures on every PR. The
// required `mobile-build` job is what guards the dependency surface.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");

/** `{ ok: true, result }` for a schema-1 proof with a passed/failed verdict, or `{ ok: false, reason }`. */
export function proofVerdict(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: `the proof readings are not JSON: ${error.message}` };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "the proof readings are not a JSON object" };
  }
  if (value.schema !== 1) {
    return { ok: false, reason: `the proof readings declare schema ${JSON.stringify(value.schema)}, not 1` };
  }
  if (value.result !== "passed" && value.result !== "failed") {
    return { ok: false, reason: `the proof result is ${JSON.stringify(value.result)}, not "passed" or "failed"` };
  }
  return { ok: true, result: value.result };
}

/**
 * Decide the proof-presence job from the readings and the emulator step's start marker. `read` and `exists` are
 * injected so tests never need a real artifact; a missing readings file is reported as `undefined` by `read` throwing.
 */
export function proofPresence({ readingsPath, startedPath, read = readFileSync, exists = existsSync }) {
  const started = exists(startedPath);
  let text;
  try {
    text = read(readingsPath, "utf8");
  } catch {
    text = undefined;
  }
  if (text === undefined) {
    if (started) {
      return {
        ok: false,
        state: "started-without-readings",
        reason: `the emulator lane started (${startedPath}) but wrote no readings at ${readingsPath}`,
      };
    }
    return { ok: true, state: "not-run", result: null, reason: `the emulator lane did not start (no ${startedPath})` };
  }
  if (String(text).trim() === "") {
    return { ok: false, state: "empty", reason: `the proof readings at ${readingsPath} are empty` };
  }
  const verdict = proofVerdict(text);
  return verdict.ok
    ? { ...verdict, state: "present", path: readingsPath }
    : { ...verdict, state: "invalid", path: readingsPath };
}

async function main() {
  const readingsPath = resolve(process.argv[2] ?? resolve(root, "artifacts", "mobile-proof", "readings.json"));
  const startedPath = resolve(process.argv[3] ?? resolve(root, "artifacts", "mobile-proof", "started.json"));
  const verdict = proofPresence({ readingsPath, startedPath });
  if (!verdict.ok) {
    console.error(`mobile proof check failed: ${verdict.reason}`);
    process.exitCode = 1;
    return;
  }
  if (verdict.state === "not-run") {
    console.log(`mobile proof not required: ${verdict.reason}`);
    return;
  }
  console.log(`mobile proof present: ${readingsPath} reports result "${verdict.result}"${verdict.result === "passed" ? "" : " (advisory, not a pass)"}`);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
