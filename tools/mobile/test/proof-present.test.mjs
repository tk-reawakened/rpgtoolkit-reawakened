import assert from "node:assert/strict";
import { test } from "node:test";

import { proofPresence, proofVerdict } from "../proof-present.mjs";

const presence = ({ text, started = false }) => proofPresence({
  readingsPath: "/proof/readings.json",
  startedPath: "/proof/started.json",
  read: () => {
    if (text === undefined) throw Object.assign(new Error("not found"), { code: "ENOENT" });
    return text;
  },
  exists: () => started,
});

test("a lane that never started passes with a not-run annotation", () => {
  const result = presence({ text: undefined, started: false });
  assert.equal(result.ok, true);
  assert.equal(result.state, "not-run");
  assert.equal(result.result, null);
  assert.match(result.reason, /did not start/);
});

test("a started lane with no readings fails: a started proof must report a verdict", () => {
  const result = presence({ text: undefined, started: true });
  assert.equal(result.ok, false);
  assert.equal(result.state, "started-without-readings");
  assert.match(result.reason, /started .* but wrote no readings/);
});

test("an empty proof file fails", () => {
  const result = presence({ text: "  \n" });
  assert.equal(result.ok, false);
  assert.equal(result.state, "empty");
  assert.match(result.reason, /empty/);
});

test("unparseable or shapeless readings fail", () => {
  assert.match(proofVerdict("not json").reason, /not JSON/);
  assert.match(proofVerdict("[]").reason, /not a JSON object/);
  assert.match(proofVerdict("{}").reason, /schema/);
  assert.match(proofVerdict('{"schema":1}').reason, /result/);
  assert.match(proofVerdict('{"schema":1,"result":"flaky"}').reason, /"flaky"/);
  assert.equal(presence({ text: '{"schema":1}' }).state, "invalid");
});

test("a failed proof is present: the emulator lane is advisory", () => {
  assert.deepEqual(proofVerdict('{"schema":1,"result":"failed"}'), { ok: true, result: "failed" });
  const result = presence({ text: '{"schema":1,"result":"failed"}' });
  assert.equal(result.ok, true);
  assert.equal(result.state, "present");
  assert.equal(result.result, "failed");
});

test("a passed proof is present", () => {
  assert.deepEqual(proofVerdict('{"schema":1,"result":"passed"}'), { ok: true, result: "passed" });
  assert.equal(presence({ text: '{"schema":1,"result":"passed"}' }).result, "passed");
});
