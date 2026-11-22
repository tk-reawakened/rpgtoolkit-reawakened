import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { proofVerdict, readProof } from "../proof-present.mjs";

test("no proof file fails: absence is not a pass", () => {
  const dir = mkdtempSync(join(tmpdir(), "proof-present-"));
  try {
    const result = readProof(join(dir, "readings.json"));
    assert.equal(result.ok, false);
    assert.match(result.reason, /no proof readings/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an empty proof file fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "proof-present-"));
  try {
    const path = join(dir, "readings.json");
    writeFileSync(path, "  \n");
    const result = readProof(path);
    assert.equal(result.ok, false);
    assert.match(result.reason, /empty/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unparseable or shapeless readings fail", () => {
  assert.match(proofVerdict("not json").reason, /not JSON/);
  assert.match(proofVerdict("[]").reason, /not a JSON object/);
  assert.match(proofVerdict("{}").reason, /schema/);
  assert.match(proofVerdict('{"schema":1}').reason, /result/);
  assert.match(proofVerdict('{"schema":1,"result":"flaky"}').reason, /"flaky"/);
});

test("a failed proof is present: the emulator lane is advisory", () => {
  const result = proofVerdict('{"schema":1,"result":"failed"}');
  assert.deepEqual(result, { ok: true, result: "failed" });
});

test("a passed proof is present", () => {
  const result = proofVerdict('{"schema":1,"result":"passed"}');
  assert.deepEqual(result, { ok: true, result: "passed" });
});

test("readProof carries the path for the log line", () => {
  const dir = mkdtempSync(join(tmpdir(), "proof-present-"));
  try {
    const path = join(dir, "readings.json");
    writeFileSync(path, '{"schema":1,"result":"passed"}');
    assert.deepEqual(readProof(path), { ok: true, result: "passed", path });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
