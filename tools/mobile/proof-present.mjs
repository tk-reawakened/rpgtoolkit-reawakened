// Verify that a mobile proof exists and reports a verdict — not that the verdict is "passed" (#2721).
//
// The emulator lane stays advisory while mobile work is paused (#1935), but "advisory" must not mean "a missing proof
// looks green". `readings.json` is written in `proof.mjs`'s `finally` even when the proof failed, so a
// `result: "failed"` is a real observation; no file, an empty file or unparseable JSON is not.

import { readFileSync } from "node:fs";
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

/** Read a proof file and decide it, including the loud failure for a missing or empty file. */
export function readProof(path, read = readFileSync) {
  let text;
  try {
    text = read(path, "utf8");
  } catch (error) {
    return { ok: false, reason: `no proof readings at ${path} (${error?.code ?? error?.message ?? error})` };
  }
  if (String(text).trim() === "") return { ok: false, reason: `the proof readings at ${path} are empty` };
  return { ...proofVerdict(text), path };
}

async function main() {
  const path = resolve(process.argv[2] ?? resolve(root, "artifacts", "mobile-proof", "readings.json"));
  const verdict = readProof(path);
  if (!verdict.ok) {
    console.error(`mobile proof check failed: ${verdict.reason}`);
    process.exitCode = 1;
    return;
  }
  console.log(`mobile proof present: ${path} reports result "${verdict.result}"${verdict.result === "passed" ? "" : " (advisory, not a pass)"}`);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
