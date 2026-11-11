// Tests for tools/no-skips/shards.mjs and the shard resolution in run.mjs (epic 28, #1886). The packing and the
// verification are pure, so these tests use small invented timings; the last tests check the committed timings
// file itself, without running any test.
import { test } from "node:test";
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BALANCE_LIMIT, SHARD_COUNT, UNTIMED_MS, formatTimings, packShards, parseTimings, verifyShards } from "../shards.mjs";
import { listAllTestFiles, repoRoot, resolveShard } from "../run.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const noSkipsTool = resolve(here, "..", "run.mjs");

test("packShards takes files slowest first onto the lightest shard, with lowest index on a tie", () => {
  const timings = { "a.test.ts": 10, "b.test.ts": 9, "c.test.ts": 8, "d.test.ts": 7, "e.test.ts": 1, "f.test.ts": 1 };
  const shards = packShards(Object.keys(timings), timings, 2);
  deepEqual(
    shards.map((shard) => [shard.index, shard.files, shard.ms]),
    [
      [1, ["a.test.ts", "d.test.ts", "e.test.ts"], 18],
      [2, ["b.test.ts", "c.test.ts", "f.test.ts"], 18],
    ],
  );
});

test("packShards is the same however the files are listed", () => {
  const timings = { "a.test.ts": 5, "b.test.ts": 5, "c.test.ts": 3 };
  const forward = packShards(["a.test.ts", "b.test.ts", "c.test.ts"], timings, 2);
  const backward = packShards(["c.test.ts", "b.test.ts", "a.test.ts"], timings, 2);
  deepEqual(forward, backward);
});

test("packShards weights a file without a timing as UNTIMED_MS", () => {
  const shards = packShards(["known.test.ts", "new.test.ts"], { "known.test.ts": 10 }, 2);
  equal(shards.reduce((sum, shard) => sum + shard.ms, 0), 10 + UNTIMED_MS);
});

test("packShards rejects a shard count that is not a positive integer", () => {
  throws(() => packShards(["a.test.ts"], {}, 0), /positive integer/);
  throws(() => packShards(["a.test.ts"], {}, 1.5), /positive integer/);
});

test("verifyShards passes a balanced, complete packing", () => {
  const files = ["a.test.ts", "b.test.ts"];
  const timings = { "a.test.ts": 10, "b.test.ts": 10 };
  const report = verifyShards(files, packShards(files, timings, 2), timings);
  equal(report.ok, true, JSON.stringify(report));
  equal(report.spread, 1);
  deepEqual(report.untimed, []);
});

test("verifyShards fails a file left in no shard and a file in two shards", () => {
  const files = ["a.test.ts", "b.test.ts", "c.test.ts"];
  const timings = { "a.test.ts": 1, "b.test.ts": 1, "c.test.ts": 1 };
  const missing = verifyShards(files, [{ index: 1, files: ["a.test.ts", "b.test.ts"], ms: 2 }], timings);
  equal(missing.ok, false);
  deepEqual(missing.missing, ["c.test.ts"]);

  const doubled = verifyShards(
    files,
    [
      { index: 1, files: ["a.test.ts", "b.test.ts"], ms: 2 },
      { index: 2, files: ["b.test.ts", "c.test.ts"], ms: 2 },
    ],
    timings,
  );
  equal(doubled.ok, false);
  deepEqual(doubled.duplicates, ["b.test.ts"]);
});

test("verifyShards fails a shard entry that is not a known test file", () => {
  const files = ["a.test.ts"];
  const report = verifyShards(files, [{ index: 1, files: ["a.test.ts", "ghost.test.ts"], ms: 2 }], { "a.test.ts": 1 });
  equal(report.ok, false);
  deepEqual(report.unknown, ["ghost.test.ts"]);
});

test("verifyShards fails when the slowest shard is over the balance limit", () => {
  const files = ["big.test.ts", "small.test.ts"];
  const timings = { "big.test.ts": 100, "small.test.ts": 1 };
  const shards = [
    { index: 1, files: ["big.test.ts"], ms: 100 },
    { index: 2, files: ["small.test.ts"], ms: 1 },
  ];
  const report = verifyShards(files, shards, timings);
  equal(report.ok, false);
  ok(report.spread > BALANCE_LIMIT, `spread ${report.spread}`);
});

test("verifyShards lists untimed files without failing on them", () => {
  const files = ["a.test.ts", "b.test.ts"];
  const report = verifyShards(files, packShards(files, { "a.test.ts": UNTIMED_MS }, 2), { "a.test.ts": UNTIMED_MS });
  equal(report.ok, true, JSON.stringify(report));
  deepEqual(report.untimed, ["b.test.ts"]);
});

test("parseTimings reads whole-millisecond files and rejects a malformed file", () => {
  deepEqual(parseTimings('{"unit":"ms","files":{"a.test.ts":12}}'), { "a.test.ts": 12 });
  throws(() => parseTimings('{"files":{"a.test.ts":"slow"}}'), /not a duration/);
  throws(() => parseTimings('{"files":[]}'), /must be an object/);
});

test("formatTimings sorts the files and rounds to whole milliseconds, and parses back", () => {
  const text = formatTimings({ "b.test.ts": 2.6, "a.test.ts": 1.2 });
  ok(text.endsWith("\n"));
  deepEqual(parseTimings(text), { "a.test.ts": 1, "b.test.ts": 3 });
  ok(text.indexOf("a.test.ts") < text.indexOf("b.test.ts"));
});

test("resolveShard rejects a shard outside 1 to the shard count", () => {
  throws(() => resolveShard(repoRoot, 0), /between 1 and 8/);
  throws(() => resolveShard(repoRoot, SHARD_COUNT + 1), /between 1 and 8/);
});

test("the committed shards cover every test file exactly once, within the balance limit", () => {
  const files = listAllTestFiles(repoRoot);
  const union = [];
  for (let index = 1; index <= SHARD_COUNT; index += 1) union.push(...resolveShard(repoRoot, index));
  deepEqual([...union].sort(), files);
  ok(new Set(union).size === union.length, "no file is in two shards");
});

test("--verify-shards passes on the repository and names the shard count", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [noSkipsTool, "--verify-shards"], { cwd: repoRoot, env, encoding: "utf8" });
  equal(result.status, 0, `${result.stdout}${result.stderr}`);
  ok(result.stdout.includes(`verified ${SHARD_COUNT} unit shards`), result.stdout);
});
