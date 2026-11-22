import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Exercise the REAL CLI path (top-level `await main()`, the real timers) without Electron (#2169). An unref'd timer in
// a dependent clock lets the event loop drain and Node exits 13 ("unsettled top-level await") instead of finishing.
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const cli = join(root, "tools", "desktop", "measure.mjs");

const baseline = JSON.parse(readFileSync(join(root, "golden", "regression", "closing.json"), "utf8"));
const demo = baseline.games.demo.frames.find((frame) => frame.label === "board" && frame.tick === 120);
const good = {
  resolvedBy: "argument",
  error: null,
  scheme: "app",
  serviceWorkers: 0,
  tick: 120,
  stateHash: demo.stateHash,
  drawHash: demo.drawHash,
};
const gpu = { ...good, error: "render-webgl2: shader compilation failed: no info log (the WebGL context may be lost)" };

function run({ mode, extra = [] }) {
  const dir = mkdtempSync(join(tmpdir(), "desktop-measure-cli-"));
  const pkg = join(dir, "fake.tpk");
  writeFileSync(pkg, "package");
  writeFileSync(`${pkg}.json`, JSON.stringify({
    schema: 1, file: "fake.tpk", sha256: "a".repeat(64), size: 7, gameId: "g", title: "Fake", version: "1",
  }));
  const helper = join(dir, "helper.mjs");
  const count = join(dir, "count.txt");
  writeFileSync(helper, `
    import { appendFileSync, writeFileSync } from "node:fs";
    appendFileSync(process.env.MEASURE_CLI_COUNT, "x");
    const report = process.env.DESKTOP_MEASURE_REPORT;
    if (process.env.MEASURE_CLI_MODE === "crash") process.exitCode = 7;
    else if (process.env.MEASURE_CLI_MODE === "always-gpu") writeFileSync(report, process.env.MEASURE_CLI_GPU_REPORT);
    else if (process.env.MEASURE_CLI_MODE === "retry" && report.endsWith("report-attempt-1.json")) writeFileSync(report, process.env.MEASURE_CLI_GPU_REPORT);
    else writeFileSync(report, process.env.MEASURE_CLI_REPORT);
  `);
  const out = join(dir, "out.json");
  const result = spawnSync(process.execPath, [cli, "--case", "argument", "--game", pkg, "--out", out, ...extra], {
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      DESKTOP_MEASURE_COMMAND: JSON.stringify([process.execPath, helper]),
      MEASURE_CLI_MODE: mode,
      MEASURE_CLI_COUNT: count,
      MEASURE_CLI_REPORT: JSON.stringify(good),
      MEASURE_CLI_GPU_REPORT: JSON.stringify(gpu),
    },
  });
  return { dir, out, count, result };
}

test("the real CLI exits 0 from a written report", { timeout: 5000 }, () => {
  const { dir, result } = run({ mode: "good" });
  try {
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the real CLI exits 0 after a GPU report and a real backoff retry", { timeout: 5000 }, () => {
  const { dir, count, result } = run({ mode: "retry", extra: ["--attempts", "2", "--backoff-ms", "20"] });
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(count, "utf8").length, 2, "the retry must really run a second attempt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the real CLI exits 1, not 13, when the child exits without a report", { timeout: 5000 }, () => {
  const { dir, out, result } = run({ mode: "crash", extra: ["--timeout-ms", "5000"] });
  try {
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /exit code 7/);
    assert.match(JSON.parse(readFileSync(out, "utf8")).error, /exit code 7/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the real CLI exits 1, not 13, after exhausting GPU attempts", { timeout: 5000 }, () => {
  const { dir, result } = run({ mode: "always-gpu", extra: ["--attempts", "2", "--backoff-ms", "5"] });
  try {
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /infrastructure/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
