// Measures what history costs to store, for ADR 0022 D12.8 (story 11.14).
// Run through `pnpm history:measure`, which builds @tk-reawakened/core first.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BinaryReader, readBoard, writeBoard } from "@tk-reawakened/core";
import { SAVE_RATES_PER_HOUR, WINDOWS_SECONDS, distribution, entriesPerHour } from "./window-model.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ASSET_INVENTORY = "docs/findings/native-data-boundaries/data/assets.jsonl";
const SYNTHETIC_BOARD = "docs/spec/examples/game/Game/Example/Boards/village.brd";
const RESULTS = "docs/findings/history-measurement/results.json";
const SYNTHETIC_SAVES = 500;
// Multiplier coprime with the cell count, so consecutive edits visit different cells.
const CELL_STRIDE = 7919;
const MB = 1_000_000;
const HOURS_PER_DAY = 24;

function describe(error) {
  return error?.message ?? JSON.stringify(error);
}

function decode(bytes, name) {
  const result = readBoard(new BinaryReader(bytes, name));
  if (!result.ok) throw new Error(`readBoard ${name}: ${describe(result.error)}`);
  return result.value;
}

function encode(board) {
  const result = writeBoard(board);
  if (!result.ok) throw new Error(`writeBoard: ${describe(result.error)}`);
  return result.value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sameArray(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

// Canonical run-length encoding of a flat tile matrix, as convertPreVectorBoard
// does: a single cell is a bare index, a longer run is a marker.
export function encodeRuns(matrix) {
  const runs = [];
  for (const lutIndex of matrix) {
    const last = runs[runs.length - 1];
    if (last && last.lutIndex === lutIndex) last.count++;
    else runs.push({ lutIndex, count: 1, marker: false });
  }
  for (const run of runs) run.marker = run.count > 1;
  return runs;
}

function repoBoards() {
  return execFileSync("git", ["ls-files", "*.brd"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function roundTripOutcome(path) {
  const bytes = new Uint8Array(readFileSync(join(root, path)));
  const read = readBoard(new BinaryReader(bytes, path));
  if (!read.ok) return { path, outcome: "read-failed", reason: describe(read.error) };
  const written = writeBoard(read.value);
  if (!written.ok) return { path, outcome: "write-failed", reason: describe(written.error) };
  const identical = Buffer.compare(Buffer.from(written.value), Buffer.from(bytes)) === 0;
  return { path, outcome: identical ? "identical" : "differs", bytes: bytes.length, outputBytes: written.value.length };
}

function corpusBoardSizes() {
  return readFileSync(join(root, ASSET_INVENTORY), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((record) => record.extension?.toLowerCase() === ".brd")
    .map((record) => record.bytes);
}

// Generate one synthetic save sequence. It has no clock or timestamps and is not
// an observation of an editing session. Each save changes one cell, then verifies
// the written bytes by reading the board back.
function runSyntheticSequence() {
  const fileBytes = new Uint8Array(readFileSync(join(root, SYNTHETIC_BOARD)));
  const base = decode(fileBytes, SYNTHETIC_BOARD);
  const cells = base.tileMatrix.length;
  const lutIndices = base.lut.length - 1;
  const matrix = [...base.tileMatrix];
  const baselineMatchesFile =
    Buffer.compare(Buffer.from(encode({ ...base, tileRuns: encodeRuns(matrix) })), Buffer.from(fileBytes)) === 0;

  const sizes = [];
  const digests = new Set();
  for (let save = 0; save < SYNTHETIC_SAVES; save++) {
    matrix[(save * CELL_STRIDE) % cells] = 1 + (save % lutIndices);
    const bytes = encode({ ...base, tileMatrix: matrix, tileRuns: encodeRuns(matrix) });
    const back = decode(bytes, `synthetic save ${save}`);
    if (!sameArray(back.tileMatrix, matrix)) {
      throw new Error(`synthetic save ${save} did not re-read to the matrix it wrote`);
    }
    sizes.push(bytes.length);
    digests.add(sha256(bytes));
  }
  const bytes = distribution(sizes);
  return {
    kind: "synthetic-single-board-save-sequence",
    board: SYNTHETIC_BOARD,
    cells,
    saves: SYNTHETIC_SAVES,
    timestamped: false,
    elapsedTimeMeasured: false,
    baselineMatchesFile,
    distinctDigests: digests.size,
    repeatedSaveCount: SYNTHETIC_SAVES - digests.size,
    bytes: { ...bytes, mean: bytes.sum / bytes.count },
  };
}

function storageRows(boardSizes) {
  const rows = [];
  for (const windowSeconds of WINDOWS_SECONDS) {
    for (const savesPerHour of SAVE_RATES_PER_HOUR) {
      const perHour = entriesPerHour(savesPerHour, windowSeconds);
      const perDay = perHour * HOURS_PER_DAY;
      const mbPerDay = Object.fromEntries(
        Object.entries(boardSizes).map(([label, bytes]) => [label, (perDay * bytes) / MB]),
      );
      rows.push({ windowSeconds, savesPerHour, entriesPerHour: perHour, entriesPerDay: perDay, mbPerDay });
    }
  }
  return rows;
}

export function measure() {
  const roundTrip = repoBoards().map(roundTripOutcome);
  const outcomes = {};
  for (const row of roundTrip) outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + 1;

  const corpus = distribution(corpusBoardSizes());
  const syntheticSequence = runSyntheticSequence();
  const boardSizes = {
    corpusMedian: corpus.median,
    corpusP90: corpus.p90,
    corpusMax: corpus.max,
    syntheticSequenceMean: syntheticSequence.bytes.mean,
  };

  return {
    method: {
      windows: "fixed-window arithmetic over synthetic evenly spaced saves (window-model.mjs)",
      saveRates: "scenario inputs extrapolated over 24 hours; not observed usage",
      scope: "measured board-size corpus and single-board scenarios only; no timestamped editing-hour trace or project-wide model",
      megabyte: "1 MB = 1,000,000 bytes",
      corpusSource: ASSET_INVENTORY,
      corpusNote: "sizes from the inventory; no content dedup assumed",
      scenarioNote: "each storage row applies one board size; it is not a project estimate or upper bound",
    },
    roundTrip: { files: roundTrip.length, outcomes, details: roundTrip },
    corpusBoards: { count: corpus.count, bytes: corpus },
    syntheticSequence,
    storage: storageRows(boardSizes),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const results = measure();
  const out = join(root, RESULTS);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`round trip: ${JSON.stringify(results.roundTrip.outcomes)}`);
  console.log(`corpus boards: ${results.corpusBoards.count}, median ${results.corpusBoards.bytes.median}, p90 ${results.corpusBoards.bytes.p90}, max ${results.corpusBoards.bytes.max}`);
  console.log(`synthetic sequence: baseline matches file ${results.syntheticSequence.baselineMatchesFile}, distinct digests ${results.syntheticSequence.distinctDigests}/${results.syntheticSequence.saves}, repeated saves ${results.syntheticSequence.repeatedSaveCount}, mean ${results.syntheticSequence.bytes.mean.toFixed(1)} bytes`);
  for (const row of results.storage) {
    console.log(`window ${row.windowSeconds}s, ${row.savesPerHour}/h: ${row.entriesPerHour} entries/h, ${row.mbPerDay.corpusP90.toFixed(1)} MB/day at one p90-size board scenario`);
  }
  console.log(`wrote ${RESULTS}`);
}
