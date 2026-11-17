// Analyses one real trace written by trace.mjs for ADR 0022 D12.8/D12.11 (story 11.14).
//
//   node tools/history-measure/analyze.mjs <trace-dir> [--out docs/findings/history-measurement/trace-results.json]
//
// Everything printed is computed from the trace's own events.jsonl (timestamps, sizes, latencies) and from the committed
// corpus inventory. The merge-window comparison replays the recorded saves through the same rule the shipped store applies
// (an `auto` save merges into the document's latest entry when that entry is `auto` and its window has not elapsed).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const dir = resolve(args[0] ?? "");
const out = args.includes("--out") ? resolve(args[args.indexOf("--out") + 1]) : null;
const WINDOWS = [10, 60, 300];
const MIB = 1_048_576;

const events = readFileSync(join(dir, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const start = JSON.parse(readFileSync(join(dir, "start.json"), "utf8"));
const summary = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
const saves = events.filter((event) => event.type === "save");
const gestures = events.filter((event) => event.type === "gesture" && event.accepted);
const beats = events.filter((event) => event.type === "heartbeat");

const sorted = (values) => [...values].sort((a, b) => a - b);
const pick = (values, quantile) => { const s = sorted(values); return s.length === 0 ? null : s[Math.min(s.length - 1, Math.ceil(quantile * s.length) - 1)]; };
const stats = (values) => ({ count: values.length, min: pick(values, 0), median: pick(values, 0.5), p90: pick(values, 0.9), p99: pick(values, 0.99), max: pick(values, 1), mean: values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length });

// Replay: per path, a list of surviving entries { reason, windowStart, sha, size }.
function replay(windowSeconds) {
  const windowMs = windowSeconds * 1000;
  const byPath = new Map();
  let created = 0;
  for (const save of saves) {
    const list = byPath.get(save.path) ?? [];
    byPath.set(save.path, list);
    const latest = list.at(-1);
    if (save.reason === "auto" && latest?.reason === "auto" && save.elapsedMs - latest.windowStart < windowMs) {
      list[list.length - 1] = { ...latest, sha: save.sha256, size: save.bytes };
    } else {
      list.push({ reason: save.reason, windowStart: save.elapsedMs, sha: save.sha256, size: save.bytes });
      created += 1;
    }
  }
  const surviving = [...byPath.values()].flat();
  const distinct = new Map(surviving.map((entry) => [entry.sha, entry.size]));
  return { windowSeconds, entriesCreated: created, entriesSurviving: surviving.length, distinctContents: distinct.size, contentBytes: [...distinct.values()].reduce((a, b) => a + b, 0) };
}

// The longest gap between consecutive accepted gestures that a window would still bridge, to show how pause-sensitive each is.
const gaps = gestures.slice(1).map((gesture, index) => (gesture.elapsedMs - gestures[index].elapsedMs) / 1000);
const pauseShare = (limit) => gaps.filter((gap) => gap <= limit).length / Math.max(1, gaps.length);

const inventory = readFileSync(join(root, "docs/findings/native-data-boundaries/data/assets.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const covered = new Set([".gam", ".brd", ".tst", ".tbm", ".prg", ".tem", ".itm"]);
const byExtension = {};
for (const record of inventory) {
  const extension = (record.extension ?? "").toLowerCase();
  (byExtension[extension] ??= []).push(record.bytes);
}
const corpusCovered = Object.fromEntries([...covered].map((extension) => [extension, byExtension[extension] === undefined ? null : { ...stats(byExtension[extension]), over8MiB: byExtension[extension].filter((bytes) => bytes > 8 * MIB).length }]));
const perGame = new Map();
for (const record of inventory) {
  const game = record.game;
  const entry = perGame.get(game) ?? { coveredBytes: 0, coveredFiles: 0, uncoveredBytes: 0, uncoveredFiles: 0 };
  if (covered.has((record.extension ?? "").toLowerCase()) && record.bytes <= 8 * MIB) { entry.coveredBytes += record.bytes; entry.coveredFiles += 1; }
  else { entry.uncoveredBytes += record.bytes; entry.uncoveredFiles += 1; }
  perGame.set(game, entry);
}
const projectCovered = stats([...perGame.values()].map((entry) => entry.coveredBytes));

const hours = summary.wallSeconds / 3600;
const saveBytes = stats(saves.map((save) => save.bytes));
const windows = WINDOWS.map(replay).map((row) => ({ ...row, entriesPerHour: row.entriesCreated / hours, contentBytesPerHour: row.contentBytes / hours }));
// Storage scenarios per editing hour at each window, two size assumptions, and the hours of editing to reach 1 GiB.
const sizeAssumptions = {
  measuredEditorWrittenMean: saveBytes.mean,
  corpusBoardP90LegacySize: corpusCovered[".brd"]?.p90 ?? null,
  corpusTilesetMaxLegacySize: corpusCovered[".tst"]?.max ?? null,
};
const storage = windows.flatMap((row) => Object.entries(sizeAssumptions).filter(([, size]) => size !== null).map(([label, size]) => ({
  windowSeconds: row.windowSeconds,
  sizeAssumption: label,
  bytesPerEntry: size,
  mibPerEditingHour: (row.entriesPerHour * size) / MIB,
  editingHoursToOneGiB: 1024 / ((row.entriesPerHour * size) / MIB),
})));

const result = {
  trace: {
    kind: "automated seeded paced script through the real editor document, board writer and a durable file store; not a person",
    startedIso: start.startedIso,
    wallSeconds: summary.wallSeconds,
    interrupted: summary.interrupted,
    host: start.host,
    plan: start.plan,
    seeded: start.seeded,
    maxHeartbeatGapMs: summary.maxHeartbeatGapMs,
    processCpuSeconds: summary.processCpuSeconds,
    loadavg1: stats(beats.map((beat) => beat.loadavg1)),
    rssMb: stats(beats.map((beat) => beat.rssMb)),
  },
  counts: {
    acceptedGestures: gestures.length,
    gesturesPerHour: gestures.length / hours,
    saves: saves.length,
    savesPerHour: saves.length / hours,
    byReason: Object.fromEntries([...new Set(saves.map((save) => save.reason))].map((reason) => [reason, saves.filter((save) => save.reason === reason).length])),
    newBlobs: summary.newBlobs,
    repeatedContent: saves.length - new Set(saves.map((save) => `${save.path}:${save.sha256}`)).size,
    historyFailures: summary.historyFailures,
  },
  gestureGapSeconds: { ...stats(gaps), shareWithin10s: pauseShare(10), shareWithin60s: pauseShare(60), shareWithin300s: pauseShare(300) },
  savedBytes: saveBytes,
  latencyMs: { save: stats(saves.map((save) => save.saveMs)), history: stats(saves.map((save) => save.historyMs)), hash: stats(saves.map((save) => save.hashMs)), blobWrite: stats(saves.filter((save) => save.newBlob).map((save) => save.blobMs)), entryWrite: stats(saves.map((save) => save.entryMs)) },
  mergeWindows: windows,
  storage,
  corpus: { coveredTypes: corpusCovered, projectsCoveredBytes: projectCovered, projects: perGame.size, note: "legacy file sizes from the asset inventory; most legacy boards do not round-trip through the vector writer, whose output for the traced boards was far smaller" },
};
if (out !== null) writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
