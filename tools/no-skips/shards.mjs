// Unit-test shards (epic 28, #1886): the package test files are packed into a fixed number of CI shards by their
// measured wall-clock time, so the slowest shard is close to the mean instead of one shard per package.
//
// This module is pure. `run.mjs` reads the committed timings file and calls it; the tests call it directly.
// The packing is deterministic: the same files and timings always give the same shards, so the balance check in
// CI reads only committed data and cannot flake.

export const SHARD_COUNT = 8;
export const TIMINGS_FILE = "tools/no-skips/shard-timings.json";
// The weight given to a test file with no recorded timing. It is conservative for a new file, and `verifyShards`
// reports every untimed file so the committed timings can be refreshed.
export const UNTIMED_MS = 1000;
// The slowest shard may be at most this many times the mean shard time (the "within about 25%" of #1886).
export const BALANCE_LIMIT = 1.25;

/**
 * Packs `files` into `count` shards by longest-processing-time-first: files are taken from slowest to fastest and
 * each goes to the currently lightest shard (lowest index on a tie). Each shard lists its files sorted.
 *
 * @param {string[]} files the test file paths to pack
 * @param {Record<string, number>} timings recorded milliseconds per file; a file without one gets UNTIMED_MS
 * @param {number} [count] the number of shards
 * @returns {{ index: number, files: string[], ms: number }[]} shards numbered from 1
 */
export function packShards(files, timings, count = SHARD_COUNT) {
  if (!Number.isInteger(count) || count < 1) throw new Error(`shard count must be a positive integer, got ${count}`);
  const items = files.map((file) => ({ file, ms: Object.hasOwn(timings, file) ? timings[file] : UNTIMED_MS }));
  items.sort((a, b) => b.ms - a.ms || compare(a.file, b.file));
  const shards = Array.from({ length: count }, (_, position) => ({ index: position + 1, files: [], ms: 0 }));
  for (const item of items) {
    let lightest = shards[0];
    for (const shard of shards) if (shard.ms < lightest.ms) lightest = shard;
    lightest.files.push(item.file);
    lightest.ms += item.ms;
  }
  for (const shard of shards) shard.files.sort(compare);
  return shards;
}

/**
 * Checks a packing against the files it must cover: every file in exactly one shard, and the slowest shard within
 * BALANCE_LIMIT of the mean. `spread` is the slowest shard's time over the mean (1 is perfect).
 *
 * @param {string[]} files every test file that must be assigned
 * @param {{ index: number, files: string[], ms: number }[]} shards from packShards
 * @param {Record<string, number>} timings used to report untimed files
 */
export function verifyShards(files, shards, timings) {
  const assigned = new Map();
  for (const shard of shards) {
    for (const file of shard.files) assigned.set(file, (assigned.get(file) ?? 0) + 1);
  }
  const known = new Set(files);
  const missing = files.filter((file) => !assigned.has(file));
  const duplicates = [...assigned.entries()].filter(([, count]) => count > 1).map(([file]) => file).sort(compare);
  const unknown = [...assigned.keys()].filter((file) => !known.has(file)).sort(compare);
  const untimed = files.filter((file) => !Object.hasOwn(timings, file)).sort(compare);
  const total = shards.reduce((sum, shard) => sum + shard.ms, 0);
  const mean = shards.length === 0 ? 0 : total / shards.length;
  const slowest = shards.reduce((max, shard) => Math.max(max, shard.ms), 0);
  const spread = mean === 0 ? 0 : slowest / mean;
  const ok =
    files.length > 0 &&
    missing.length === 0 &&
    duplicates.length === 0 &&
    unknown.length === 0 &&
    (mean === 0 || spread <= BALANCE_LIMIT);
  return { ok, missing, duplicates, unknown, untimed, spread, mean, slowest, files: files.length };
}

/** Parses the committed timings file: an object of test file path to whole milliseconds. */
export function parseTimings(text) {
  const data = JSON.parse(text);
  const files = data === null || typeof data !== "object" ? undefined : data.files;
  if (files === null || typeof files !== "object" || Array.isArray(files)) {
    throw new Error(`timings must be an object with a "files" object`);
  }
  for (const [file, ms] of Object.entries(files)) {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) throw new Error(`timing for ${file} is not a duration`);
  }
  return files;
}

/** The timings file's text for the given per-file milliseconds: sorted keys, whole milliseconds, a trailing newline. */
export function formatTimings(timings) {
  const files = {};
  for (const file of Object.keys(timings).sort(compare)) files[file] = Math.round(timings[file]);
  return `${JSON.stringify({ unit: "ms", note: "Wall-clock time of each test file run alone; regenerate with --record-timings (#1886).", files }, null, 2)}\n`;
}

function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
