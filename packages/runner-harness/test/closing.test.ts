// The closing suite's own behaviour on small authored games (G7): drift detection, expected failures, batching
// independence and the ledger. The real sample games are covered by the headless runner's test and `pnpm closing`.
import { deepEqual, equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createEmptyBoard, utf8Encode, writeBoard } from "@tk-reawakened/core";
import {
  checkClosingSuite,
  closingLedgerRows,
  formatClosingBaseline,
  parseClosingPlan,
  runClosingGame,
  runClosingSuite,
  type ClosingGamePlan,
  type ClosingPlan,
} from "../src/closing.ts";
import { encodeRgbaPng } from "../src/png.ts";
import { compareClosingBatchTickHashes } from "../src/closing-ticks.ts";

/** `assert.ok` for the repository's minimal assertion declarations. */
function ok(condition: boolean, message?: string): void {
  equal(condition, true, message);
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const bundled = new Map<string, Uint8Array>([["media/fonts/tkr-8x8.fnt", readFileSync(join(repoRoot, "media", "fonts", "tkr-8x8.fnt"))]]);

function board(): Uint8Array {
  const written = writeBoard({ ...createEmptyBoard(), sizeX: 8, sizeY: 6 });
  if (!written.ok) throw new Error(written.error.message);
  return written.value;
}

/** A game that draws a line of text, waits for a key, then ends its start-up program and enters its board. */
function authoredFiles(options: { readonly withPlayer?: boolean } = {}): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  files.set("Boards/start.brd", board());
  files.set("Prg/start.prg", utf8Encode('text(1, 1, "hello")\nwait()\nend()\n'));
  if (options.withPlayer !== false) files.set("Chrs/hero.tem", new Uint8Array([0]));
  return files;
}

const GAME: ClosingGamePlan = {
  name: "authored",
  dialect: "tk3",
  main: { synthesised: { startupPrg: "start.prg", initBoard: "start.brd", initChar: "hero.tem" } },
  expect: { outcome: "boots" },
};

const PLAN: ClosingPlan = {
  schema: 1,
  seed: 1,
  width: 128,
  height: 96,
  maxTicks: 60,
  bundled: ["media/fonts"],
  batches: [60, 7, 1],
  keys: [{ tick: 10, name: "ENTER", code: "Enter" }],
  frames: [{ label: "title", tick: 5 }, { label: "board", tick: 20 }, { label: "later", tick: 40 }],
  games: [GAME],
};

test("an authored game boots, enters its board and gives the same hashes for every batch size", () => {
  const run = runClosingGame(PLAN, GAME, authoredFiles(), bundled);
  deepEqual(run.batchProblems, []);
  equal(run.record.outcome, "boots");
  equal(run.record.bootStage, "running");
  equal(run.record.board, "boards/start.brd");
  deepEqual(run.record.diagnostics, []);
  equal(run.record.ticks, 40);
  deepEqual(run.record.checkpoints.map((checkpoint) => checkpoint.tick), [5, 10, 20, 40]);
  const [title, board, later] = run.record.frames;
  if (title === undefined || board === undefined || later === undefined) throw new Error("expected three frames");
  equal(title.png, "golden/regression/closing/authored-title.png");
  equal(board.png, "golden/regression/closing/authored-board.png");
  // Nothing moves on a static board, so the later frame is the board frame and owns no PNG of its own.
  equal(later.sameAs, "board");
  equal(later.png, undefined);
  ok(title.pixelHash !== board.pixelHash);
  deepEqual([...run.images.keys()], [title.png, board.png]);
  const again = runClosingGame(PLAN, GAME, authoredFiles(), bundled);
  deepEqual(again.record, run.record);
});

test("closing observation fires for booted games, preserves frames and records deterministic program boundaries", () => {
  const plain = runClosingGame(PLAN, GAME, authoredFiles(), bundled);
  const first = runClosingGame(PLAN, GAME, authoredFiles(), bundled, { trace: true });
  const second = runClosingGame(PLAN, GAME, authoredFiles(), bundled, { trace: true });
  deepEqual(first.record, plain.record);
  deepEqual(first.batchProblems, []);
  deepEqual(first.census, second.census);
  const census = first.census;
  if (census === undefined) throw new Error("missing census");
  equal(Object.values(census.opcodeHistogram).reduce((sum, count) => sum + count, 0) > 0, true);
  equal(census.commandHistogram.text, 1);
  equal(census.commandHistogram.wait, 1);
  equal(census.commandHistogram.end, 1);
  equal(census.bootSequence.some((asset) => asset.file === "main.gam"), true);
  equal(census.bootSequence.some((asset) => asset.file === "prg/start.prg" && asset.executed), true);
  const span = census.programSpans[0];
  if (span === undefined || span.finish === null) throw new Error("missing finished startup span");
  equal(span.source, "prg/start.prg");
  equal(span.status, "finished");
  for (const boundary of [span.start, span.lastStep, span.finish]) equal(boundary.stateHash, census.stateHashes.find((hash) => hash.tick === boundary.tick)?.stateHash);
  for (const [path, image] of plain.images) deepEqual(first.images.get(path), image);
});

test("a game that cannot boot reports its diagnostic and records only the frames it reached", () => {
  const files = authoredFiles({ withPlayer: false });
  const run = runClosingGame(PLAN, { ...GAME, expect: { outcome: "stopped", epic: "none-yet", reason: "authored without a player" } }, files, bundled);
  equal(run.record.outcome, "stopped");
  equal(run.record.bootStage, "stopped");
  // The start-up program runs until its key wait; the stop comes when it ends with no player, before the board frames.
  deepEqual(run.record.frames.map((frame) => frame.label), ["title"]);
  ok(run.record.ticks > 10 && run.record.ticks < 20, `stopped at tick ${run.record.ticks}`);
  equal(run.images.size, 1);
  ok(run.record.diagnostics.some((diagnostic) => diagnostic.code === "asset.missing" && diagnostic.message.includes("hero.tem")), JSON.stringify(run.record.diagnostics));
  ok(run.record.diagnostics.some((diagnostic) => diagnostic.code === "startup.no-player"));
});

/** Record the plan's single game, as `pnpm closing:record` would, and return the committed-file stand-ins. */
function recorded(plan: ClosingPlan = PLAN) {
  const runs = runClosingSuite(plan, () => authoredFiles(), bundled);
  const pngs = new Map<string, Uint8Array>();
  for (const run of runs) for (const [path, image] of run.images) pngs.set(path, encodeRgbaPng(image));
  const ledger = { schema: 1, goldens: [{ path: "golden/reference/S-01.png", scene: "S-01", class: "independent-reference", gating: true, producer: "4.4" }, ...closingLedgerRows(runs)] };
  return { runs, pngs, baseline: formatClosingBaseline(runs), ledger: JSON.stringify(ledger) };
}

test("the check passes against its own recording", () => {
  const { runs, pngs, baseline, ledger } = recorded();
  const result = checkClosingSuite(PLAN, runs, baseline, (path) => pngs.get(path), ledger);
  equal(result.ok, true, result.lines.join("\n"));
});

test("the check fails when a state hash, a draw hash or a game's outcome drifts", () => {
  const { runs, pngs, baseline, ledger } = recorded();
  const state = baseline.replace(/"stateHash": "([0-9a-f]{16})"/, '"stateHash": "0000000000000000"');
  const stateResult = checkClosingSuite(PLAN, runs, state, (path) => pngs.get(path), ledger);
  equal(stateResult.ok, false);
  ok(stateResult.lines.some((line) => line.includes("authored: record drifted from the committed baseline (state hash at tick 5")), stateResult.lines.join("\n"));
  const draw = baseline.replace(/"drawHash": "([0-9a-f]{16})"/, '"drawHash": "ffffffffffffffff"');
  const drawResult = checkClosingSuite(PLAN, runs, draw, (path) => pngs.get(path), ledger);
  ok(drawResult.lines.some((line) => line.includes("frame title drawHash")), drawResult.lines.join("\n"));
  const expectedFailure: ClosingPlan = { ...PLAN, games: [{ ...GAME, expect: { outcome: "stopped", epic: "later", reason: "claimed broken" } }] };
  const outcomeResult = checkClosingSuite(expectedFailure, runs, baseline, (path) => pngs.get(path), ledger);
  ok(outcomeResult.lines.some((line) => line.includes("outcome is boots but the plan expects stopped")), outcomeResult.lines.join("\n"));
});

test("the check fails when a committed PNG differs by one pixel or is missing", () => {
  const { runs, pngs, baseline, ledger } = recorded();
  const path = "golden/regression/closing/authored-title.png";
  const image = runs[0]?.images.get(path);
  if (image === undefined) throw new Error(`${path} was not produced`);
  const changed = { w: image.w, h: image.h, rgba: new Uint8Array(image.rgba) };
  changed.rgba[0] = (changed.rgba[0] ?? 0) ^ 0xff;
  const tampered = new Map(pngs).set(path, encodeRgbaPng(changed));
  const different = checkClosingSuite(PLAN, runs, baseline, (name) => tampered.get(name), ledger);
  ok(different.lines.some((line) => line.includes(`${path}: first differing pixel {"x":0,"y":0`)), different.lines.join("\n"));
  const missing = checkClosingSuite(PLAN, runs, baseline, () => undefined, ledger);
  ok(missing.lines.some((line) => line.includes(`${path} is absent`)));
  const absent = checkClosingSuite(PLAN, runs, undefined, (name) => pngs.get(name), ledger);
  ok(absent.lines.some((line) => line.includes("golden/regression/closing.json is absent")));
});

test("the ledger must list exactly the suite's PNGs as gating regression baselines", () => {
  const { runs, pngs, baseline } = recorded();
  const rows = closingLedgerRows(runs);
  equal(rows.length, 2);
  for (const row of rows) {
    equal(row.class, "regression-baseline");
    equal(row.gating, true);
    equal(row.producer, "4.28");
    ok(row.path.startsWith("golden/regression/closing/"));
  }
  const missing = JSON.stringify({ schema: 1, goldens: rows.slice(0, 1) });
  ok(checkClosingSuite(PLAN, runs, baseline, (path) => pngs.get(path), missing).lines.some((line) => line.includes("ledger has no row for golden/regression/closing/authored-board.png")));
  const extra = JSON.stringify({ schema: 1, goldens: [...rows, { ...rows[0], path: "golden/regression/closing/gone.png", scene: "closing:gone:title" }] });
  ok(checkClosingSuite(PLAN, runs, baseline, (path) => pngs.get(path), extra).lines.some((line) => line.includes("gone.png, which the closing suite no longer produces")));
  const wrongClass = JSON.stringify({ schema: 1, goldens: rows.map((row) => ({ ...row, class: "independent-reference" })) });
  ok(checkClosingSuite(PLAN, runs, baseline, (path) => pngs.get(path), wrongClass).lines.some((line) => line.includes("is not a gating regression-baseline row produced by 4.28")));
});

test("a plan is validated before any game runs", () => {
  const text = JSON.stringify(PLAN);
  deepEqual(parseClosingPlan(text), PLAN);
  for (const broken of [
    { ...PLAN, schema: 2 },
    { ...PLAN, batches: [] },
    { ...PLAN, batches: [61] },
    { ...PLAN, frames: [{ label: "a", tick: 1 }, { label: "a", tick: 2 }] },
    { ...PLAN, bundled: ["../elsewhere"] },
    { ...PLAN, games: [{ ...GAME, expect: { outcome: "stopped", epic: "", reason: "x" } }] },
  ]) {
    let message = "";
    try {
      parseClosingPlan(JSON.stringify(broken));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    ok(message.startsWith("closing plan:"), JSON.stringify(broken));
  }
});

test("actual per-tick traces detect state-only and draw-only cross-batch drift between checkpoints", () => {
  const run = runClosingGame(PLAN, GAME, authoredFiles(), bundled);
  const traces = run.batchTickHashes;
  const reference = traces[0];
  if (reference === undefined) throw new Error("missing actual tick observations");
  equal(reference.ticks.length, run.record.ticks);
  equal(reference.ticks[6]?.tick, 7);
  equal(run.record.checkpoints.some((checkpoint) => checkpoint.tick === 7), false);
  deepEqual(traces.map((trace) => trace.batch), PLAN.batches);

  const stateOnly = traces.map((trace) => trace.batch === 7
    ? { ...trace, ticks: trace.ticks.map((tick) => tick.tick === 7 ? { ...tick, stateHash: "state-only-divergence" } : tick) }
    : trace);
  const stateProblems = compareClosingBatchTickHashes(traces, stateOnly);
  ok(stateProblems.some((problem) => problem.includes("batch 7: per-tick hashes differ at tick 7")), stateProblems.join("\n"));
  equal(stateOnly[1]?.ticks[6]?.drawHash, reference.ticks[6]?.drawHash);

  const drawOnly = traces.map((trace) => trace.batch === 1
    ? { ...trace, ticks: trace.ticks.map((tick) => tick.tick === 7 ? { ...tick, drawHash: "draw-only-divergence" } : tick) }
    : trace);
  const drawProblems = compareClosingBatchTickHashes(traces, drawOnly);
  ok(drawProblems.some((problem) => problem.includes("batch 1: per-tick hashes differ at tick 7")), drawProblems.join("\n"));
  equal(drawOnly[2]?.ticks[6]?.stateHash, reference.ticks[6]?.stateHash);

  const skippedTick = traces.map((trace) => trace.batch === 7
    ? { ...trace, ticks: trace.ticks.map((tick) => tick.tick === 7 ? { ...tick, tick: 8 } : tick) }
    : trace);
  ok(compareClosingBatchTickHashes(traces, skippedTick).some((problem) => problem.includes("tick sequence")), "duplicate or skipped tick IDs must fail");
});
