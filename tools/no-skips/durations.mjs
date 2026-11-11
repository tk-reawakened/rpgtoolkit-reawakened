// The 1-second test rule (AGENTS.md, owner rule 2026-10-28; epic 28, #1892): ordinary unit tests finish
// in under one second, and a slower test needs a logged exception that says why.
//
// This module is pure: it reads the TAP text the runner already writes and decides, given the exception
// ledger, which tests break the rule. It does not run tests or read the ledger itself, so it can be
// tested without a CI run. The ledger is the exception log from #1896; until that lands, callers pass an
// empty ledger and the report is advisory.
//
// Node's TAP reporter writes, for every test, its name and a YAML block with `duration_ms` and `type`:
//
//   ok 1 - name            (indented by two spaces per nesting level)
//     ---
//     duration_ms: 1202.2
//     type: 'test'
//     ...
//
// Top-level entries are the test files; their nested `type: 'test'` entries are the individual tests.
//
// A run over several files has a file entry per file. A run over a single file prints its tests at the top
// level with no file entry, so their file is their own name (CI shards always run several files).

export const SLOW_TEST_MS = 1000;
export const SUMMARY_SLOWEST = 20;

const RESULT = /^( *)(?:not )?ok \d+ - (.*?)\s*$/;
const DURATION = /^ *duration_ms: ([0-9.]+)\s*$/;
const TYPE = /^ *type: '(test|suite)'\s*$/;

/**
 * Reads every test's duration from TAP text.
 *
 * @param {string} text the TAP report
 * @returns {{ file: string, name: string, ms: number }[]} one entry per `type: 'test'` result, in report order.
 *   `file` is the top-level (file) entry the test is nested in, or the test's own name when it is a file-level test.
 */
export function parseTapDurations(text) {
  const results = [];
  // Node prints a file's own result line after its nested tests, so a nested test's file is not known until
  // the next top-level line; `unnamed` holds the nested results waiting for that line.
  let unnamed = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const result = RESULT.exec(line);
    if (result !== null) {
      const [, indent, name] = result;
      current = { file: indent.length === 0 ? name : undefined, name, ms: undefined, type: undefined };
      results.push(current);
      if (indent.length === 0) {
        for (const nested of unnamed) nested.file = name;
        unnamed = [];
      } else {
        unnamed.push(current);
      }
      continue;
    }
    if (current === null) continue;
    const duration = DURATION.exec(line);
    if (duration !== null && current.ms === undefined) {
      current.ms = Number(duration[1]);
      continue;
    }
    const type = TYPE.exec(line);
    if (type !== null && current.type === undefined) current.type = type[1];
  }
  return results
    .filter((entry) => entry.type === "test" && entry.ms !== undefined)
    .map(({ file, name, ms }) => ({ file: file ?? "", name, ms }));
}

/**
 * Decides which tests break the rule. A ledger entry is `{ rule: "test-duration", where, budget, resolution }`
 * (#1896's schema): `where` is `<test file>#<test name>` and `budget` is the most the test may take, in
 * milliseconds.
 *
 * Findings, in order of severity:
 * - `unlogged`: a test over SLOW_TEST_MS with no ledger entry.
 * - `over-budget`: a logged test over its entry's budget.
 * - `remove`: a logged test that is now under SLOW_TEST_MS, so its entry should be removed.
 *
 * @param {{ file: string, name: string, ms: number }[]} tests from parseTapDurations
 * @param {{ rule: string, where: string, budget: number }[]} ledger the exception ledger's entries
 * @returns {{ kind: string, file: string, name: string, ms: number, budget?: number }[]}
 */
export function evaluateDurations(tests, ledger) {
  const entries = ledger.filter((entry) => entry.rule === "test-duration");
  const keyOf = (file, name) => `${file}#${name}`;
  const findings = [];
  for (const test of tests) {
    const entry = entries.find((candidate) => candidate.where === keyOf(test.file, test.name));
    if (test.ms > SLOW_TEST_MS && entry === undefined) {
      findings.push({ kind: "unlogged", ...test });
    } else if (entry !== undefined && test.ms > entry.budget) {
      findings.push({ kind: "over-budget", ...test, budget: entry.budget });
    }
  }
  for (const entry of entries) {
    const test = tests.find((candidate) => keyOf(candidate.file, candidate.name) === entry.where);
    if (test !== undefined && test.ms <= SLOW_TEST_MS) {
      findings.push({ kind: "remove", file: test.file, name: test.name, ms: test.ms, budget: entry.budget });
    }
  }
  return findings;
}

/**
 * The step-summary Markdown and the workflow annotation lines for a shard. Names are escaped so a test name
 * cannot inject a Markdown table cell or an annotation property.
 *
 * @param {{ file: string, name: string, ms: number }[]} tests
 * @param {{ kind: string, file: string, name: string, ms: number, budget?: number }[]} findings
 */
export function formatDurationReport(tests, findings) {
  const slowest = [...tests].sort((a, b) => b.ms - a.ms).slice(0, SUMMARY_SLOWEST);
  const lines = [
    "### Slowest tests (rule: under 1 s, AGENTS.md)",
    "",
    "| ms | test | file |",
    "| ---: | --- | --- |",
    ...slowest.map((test) => `| ${Math.round(test.ms)} | ${cell(test.name)} | ${cell(test.file === test.name ? "" : test.file)} |`),
  ];
  if (findings.length > 0) {
    lines.push("", "### Rule findings", "");
    for (const finding of findings) lines.push(`- ${describe(finding)}`);
  }
  // Unlogged tests are listed in the summary only: one annotation per slow test would flood the Files tab.
  // Annotations are for logged exceptions that need attention.
  const annotations = findings.filter((finding) => finding.kind !== "unlogged").map((finding) => annotation(finding));
  return { markdown: `${lines.join("\n")}\n`, annotations };
}

/** One line a reader can act on; `kind` says what to do. */
export function describe(finding) {
  const took = `${Math.round(finding.ms)} ms`;
  // A file-level test is its own file entry; naming the file again would only repeat the test name.
  const where = finding.file && finding.file !== finding.name ? ` (${finding.file})` : "";
  switch (finding.kind) {
    case "unlogged":
      return `${finding.name}${where} took ${took}; log an exception with its reason in the exception ledger (#1896) or make it faster.`;
    case "over-budget":
      return `${finding.name}${where} took ${took}, over its ledger budget of ${finding.budget} ms.`;
    case "remove":
      return `${finding.name}${where} now takes ${took}; remove its ledger entry.`;
    default:
      return `${finding.name}${where}: ${took}`;
  }
}

function annotation(finding) {
  // A GitHub annotation message: the newlines and percent signs are escaped (workflow command syntax).
  const message = describe(finding).replace(/%/gu, "%25").replace(/\r/gu, "%0D").replace(/\n/gu, "%0A");
  const file = finding.file.replace(/%/gu, "%25").replace(/:/gu, "%3A").replace(/,/gu, "%2C");
  return `::warning file=${file}::${message}`;
}

function cell(text) {
  return String(text).replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ");
}
