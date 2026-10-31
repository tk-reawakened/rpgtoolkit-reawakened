// Entry 21.7 (issue #486): the authored media-package golden's own guard. The run is
// deterministic, the committed record round-trips, and any drift in a cue or the state
// hash is named rather than silently accepted (G5).
import { test } from "node:test";
import { equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TextEncoder } from "node:util";
import {
  checkMediaPackagesGolden,
  formatMediaPackagesGolden,
  MEDIA_PACKAGE_FILES,
  MEDIA_PACKAGE_FOLDER,
  MEDIA_PACKAGE_STARTUP,
  runMediaPackages,
} from "../src/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const packages: Record<string, Uint8Array> = {};
for (const [name, file] of Object.entries(MEDIA_PACKAGE_FILES)) packages[name] = new Uint8Array(readFileSync(join(root, MEDIA_PACKAGE_FOLDER, file)));
const startup = new TextEncoder().encode(MEDIA_PACKAGE_STARTUP);

test("the authored media-package run is deterministic from its seed", () => {
  const first = runMediaPackages(packages, startup);
  const second = runMediaPackages(packages, startup);
  equal(first.stateHash, second.stateHash);
  equal(JSON.stringify(first.cues), JSON.stringify(second.cues));
  ok(first.cues.length > 0);
});

test("the committed record round-trips and any drift is named", () => {
  const run = runMediaPackages(packages, startup);
  const record = formatMediaPackagesGolden(run);
  const clean = checkMediaPackagesGolden(run, record);
  equal(clean.ok, true, clean.lines.join("; "));

  const drifted = JSON.parse(record) as { run: { stateHash: string } };
  drifted.run.stateHash = "0000000000000000";
  const drift = checkMediaPackagesGolden(run, JSON.stringify(drifted));
  equal(drift.ok, false);
  ok(drift.lines.some((line) => line.includes("final state hash")), "the state-hash drift is named");

  const cueDrift = JSON.parse(record) as { run: { cues: { tick: number }[] } };
  cueDrift.run.cues[1]!.tick += 1;
  const cues = checkMediaPackagesGolden(run, JSON.stringify(cueDrift));
  equal(cues.ok, false);
  ok(cues.lines.some((line) => line.includes("cue stream drifted")), "the cue drift is named");
});
