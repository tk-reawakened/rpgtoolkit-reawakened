// Tests for tools/no-skips/durations.mjs (the 1-second test rule, epic 28 #1892). Every test here is fast:
// the TAP literal is real `node --test --test-reporter=tap` output, and the rules are pure functions.
import { test } from "node:test";
import { deepEqual, equal, match, ok } from "node:assert/strict";
import {
  SLOW_TEST_MS,
  describe as describeFinding,
  evaluateDurations,
  formatDurationReport,
  parseTapDurations,
} from "../durations.mjs";

// Real TAP: one fast top-level test, and a suite (file) holding one nested slow test.
const TAP = `TAP version 13
# Subtest: quick one
ok 1 - quick one
  ---
  duration_ms: 1.578974
  type: 'test'
  ...
# Subtest: group
    # Subtest: slow one
    ok 1 - slow one
      ---
      duration_ms: 1202.288726
      type: 'test'
      ...
    1..1
ok 2 - group
  ---
  duration_ms: 1202.967003
  type: 'suite'
  ...
1..2
# tests 2
`;

test("parseTapDurations reads each test's duration and file, and ignores suites", () => {
  deepEqual(parseTapDurations(TAP), [
    { file: "quick one", name: "quick one", ms: 1.578974 },
    { file: "group", name: "slow one", ms: 1202.288726 },
  ]);
});

test("parseTapDurations attributes nested tests to the top-level file entry before them", () => {
  const text = `TAP version 13
# Subtest: packages/a/test/one.test.ts
    # Subtest: first
    ok 1 - first
      ---
      duration_ms: 10
      type: 'test'
      ...
ok 1 - packages/a/test/one.test.ts
  ---
  duration_ms: 12
  type: 'suite'
  ...
# Subtest: packages/b/test/two.test.ts
    # Subtest: first
    ok 1 - first
      ---
      duration_ms: 1500
      type: 'test'
      ...
ok 2 - packages/b/test/two.test.ts
  ---
  duration_ms: 1501
  type: 'suite'
  ...
`;
  deepEqual(parseTapDurations(text), [
    { file: "packages/a/test/one.test.ts", name: "first", ms: 10 },
    { file: "packages/b/test/two.test.ts", name: "first", ms: 1500 },
  ]);
});

test("parseTapDurations reads a failing test's duration too, and tolerates CRLF", () => {
  const text = "# Subtest: x\r\nnot ok 1 - broken\r\n  ---\r\n  duration_ms: 1400\r\n  type: 'test'\r\n  ...\r\n";
  deepEqual(parseTapDurations(text), [{ file: "broken", name: "broken", ms: 1400 }]);
});

test("a test over the limit with no ledger entry is unlogged", () => {
  const tests = [{ file: "f.test.ts", name: "slow", ms: 1200 }];
  deepEqual(evaluateDurations(tests, []), [{ kind: "unlogged", file: "f.test.ts", name: "slow", ms: 1200 }]);
});

test("the limit is strict: exactly 1000 ms is not over the rule", () => {
  equal(SLOW_TEST_MS, 1000);
  deepEqual(evaluateDurations([{ file: "f", name: "edge", ms: 1000 }], []), []);
  deepEqual(evaluateDurations([{ file: "f", name: "edge", ms: 1000.5 }], []).map(({ kind }) => kind), ["unlogged"]);
});

test("a logged test within its budget is accepted", () => {
  const tests = [{ file: "f.test.ts", name: "slow", ms: 1200 }];
  const ledger = [{ rule: "test-duration", where: "f.test.ts#slow", budget: 1500 }];
  deepEqual(evaluateDurations(tests, ledger), []);
});

test("a logged test over its budget fails with over-budget", () => {
  const tests = [{ file: "f.test.ts", name: "slow", ms: 1600 }];
  const ledger = [{ rule: "test-duration", where: "f.test.ts#slow", budget: 1500 }];
  deepEqual(evaluateDurations(tests, ledger), [
    { kind: "over-budget", file: "f.test.ts", name: "slow", ms: 1600, budget: 1500 },
  ]);
});

test("a ledger entry whose test is now under the limit asks for its removal", () => {
  const tests = [{ file: "f.test.ts", name: "slow", ms: 40 }];
  const ledger = [{ rule: "test-duration", where: "f.test.ts#slow", budget: 1500 }];
  deepEqual(evaluateDurations(tests, ledger), [
    { kind: "remove", file: "f.test.ts", name: "slow", ms: 40, budget: 1500 },
  ]);
});

test("an entry whose test no longer exists is not a finding, and other rules' entries are ignored", () => {
  const ledger = [
    { rule: "test-duration", where: "gone.test.ts#missing", budget: 1500 },
    { rule: "G3", where: "f.test.ts#slow", budget: 1 },
  ];
  // `slow` has no test-duration entry (the G3 entry is another rule's), so it is unlogged; the stale entry is silent.
  deepEqual(evaluateDurations([{ file: "f.test.ts", name: "slow", ms: 1200 }], ledger), [
    { kind: "unlogged", file: "f.test.ts", name: "slow", ms: 1200 },
  ]);
});

test("the report lists the slowest tests and keeps unlogged tests out of the annotations", () => {
  const tests = [
    { file: "a.test.ts", name: "fast", ms: 3 },
    { file: "a.test.ts", name: "slow", ms: 1200 },
    { file: "b.test.ts", name: "logged", ms: 1600 },
  ];
  const ledger = [{ rule: "test-duration", where: "b.test.ts#logged", budget: 1500 }];
  const findings = evaluateDurations(tests, ledger);
  const { markdown, annotations } = formatDurationReport(tests, findings);
  match(markdown, /\| 1600 \| logged \| b\.test\.ts \|/u);
  match(markdown, /### Rule findings/u);
  deepEqual(annotations, ["::warning file=b.test.ts::logged (b.test.ts) took 1600 ms, over its ledger budget of 1500 ms."]);
});

test("the report shows at most the 20 slowest tests", () => {
  const tests = Array.from({ length: 25 }, (_, index) => ({ file: "f", name: `t${index}`, ms: index }));
  const { markdown } = formatDurationReport(tests, []);
  equal(markdown.match(/^\| \d+ \|/gmu).length, 20);
  match(markdown, /^\| 24 \| t24 \| f \|/mu);
});

test("test names are escaped so they cannot break the Markdown table or the annotation", () => {
  const tests = [{ file: "a:b,c.test.ts", name: "x | y\nz", ms: 2000 }];
  const { markdown, annotations } = formatDurationReport(tests, []);
  match(markdown, /\| 2000 \| x \\\| y z \| a:b,c\.test\.ts \|/u);
  equal(annotations.length, 0);
  const findings = evaluateDurations([{ file: "a:b,c.test.ts", name: "p%q", ms: 1600 }], [
    { rule: "test-duration", where: "a:b,c.test.ts#p%q", budget: 1500 },
  ]);
  const { annotations: lines } = formatDurationReport([], findings);
  match(lines[0], /^::warning file=a%3Ab%2Cc\.test\.ts::/u);
  ok(!lines[0].includes("p%q"), "the percent sign in the name is escaped in the message");
});

test("describe names the action for each finding kind", () => {
  match(describeFinding({ kind: "unlogged", file: "f", name: "n", ms: 1200 }), /log an exception/u);
  match(describeFinding({ kind: "over-budget", file: "f", name: "n", ms: 1600, budget: 1500 }), /over its ledger budget/u);
  match(describeFinding({ kind: "remove", file: "f", name: "n", ms: 40 }), /remove its ledger entry/u);
});
