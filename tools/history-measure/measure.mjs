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
const SESSION_BOARD = "docs/spec/examples/game/Game/Example/Boards/village.brd";
const RESULTS = "docs/findings/history-measurement/results.json";
const SESSION_EDITS = 500;
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

// Each session edit changes one cell and saves the whole board, so every save is a
// new full-content history entry. The matrix is re-read after each save to prove the
// bytes written are the board intended.
function runSession() {
  const fileBytes = new Uint8Array(readFileSync(join(root, SESSION_BOARD)));
  const base = decode(fileBytes, SESSION_BOARD);
  const cells = base.tileMatrix.length;
  const lutIndices = base.lut.length - 1;
  const matrix = [...base.tileMatrix];
  const baselineMatchesFile =
    Buffer.compare(Buffer.from(encode({ ...base, tileRuns: encodeRuns(matrix) })), Buffer.from(fileBytes)) === 0;

  const sizes = [];
  const digests = new Set();
  for (let edit = 0; edit < SESSION_EDITS; edit++) {
    matrix[(edit * CELL_STRIDE) % cells] = 1 + (edit % lutIndices);
    const bytes = encode({ ...base, tileMatrix: matrix, tileRuns: encodeRuns(matrix) });
    const back = decode(bytes, `session edit ${edit}`);
    if (!sameArray(back.tileMatrix, matrix)) {
      throw new Error(`session edit ${edit} did not re-read to the matrix it wrote`);
    }
    sizes.push(bytes.length);
    digests.add(sha256(bytes));
  }
  const bytes = distribution(sizes);
  return {
    board: SESSION_BOARD,
    cells,
    edits: SESSION_EDITS,
    baselineMatchesFile,
    distinctDigests: digests.size,
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
  const session = runSession();
  const boardSizes = {
    corpusMedian: corpus.median,
    corpusP90: corpus.p90,
    corpusMax: corpus.max,
    sessionMean: session.bytes.mean,
  };

  return {
    method: {
      windows: "fixed window opened at the first save; saves inside it merge (window-model.mjs)",
      saveRates: "constant saves per hour, sustained for 24 hours: an upper bound, not a usage estimate",
      megabyte: "1 MB = 1,000,000 bytes",
      corpusSource: ASSET_INVENTORY,
      corpusNote: "sizes from the inventory; no content dedup assumed",
    },
    roundTrip: { files: roundTrip.length, outcomes, details: roundTrip },
    corpusBoards: { count: corpus.count, bytes: corpus },
    session,
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
  console.log(`session: baseline matches file ${results.session.baselineMatchesFile}, distinct digests ${results.session.distinctDigests}/${results.session.edits}, mean ${results.session.bytes.mean.toFixed(1)} bytes`);
  for (const row of results.storage) {
    console.log(`window ${row.windowSeconds}s, ${row.savesPerHour}/h: ${row.entriesPerHour} entries/h, ${row.mbPerDay.corpusP90.toFixed(1)} MB/day at corpus p90`);
  }
  console.log(`wrote ${RESULTS}`);
}
