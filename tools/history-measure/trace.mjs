// A real wall-clock editing-hour trace for ADR 0022 D12.8 (story 11.14, issue #1828).
//
//   node tools/history-measure/trace.mjs --out <dir> [--seconds 3600] [--seed 1828] [--boards a.brd,b.brd,c.brd]
//
// WHAT THIS IS. An AUTOMATED, seeded, paced workload, not a person. A script plays the part of a creator painting
// boards: it makes accepted edit gestures through the real editor document (`openBoardDocument` + `apply`), lets the
// autosave debounce (D11.1: one second after the last accepted edit) fire a real `save()`, which runs the real board
// writer, the real read-before-write comparison and a real durable write (write + fsync) on the host file system, and
// then records the saved bytes the way the history store does: SHA-256, a content-addressed blob when the hash is new,
// and one entry file. Every operation takes the wall-clock time it really takes on this machine, and every one is
// logged to `events.jsonl` with its timestamp, sizes and latencies.
//
// WHAT THIS IS NOT. The gesture timing (burst length, gap between strokes, pauses, board dwell, share of fills) is the
// script's assumption, written down in `plan` below; it was not observed from a person. The merge-window comparison is
// therefore a comparison over this workload, and the shape of the gaps matters to the answer: `analyze.mjs` reports
// both what this trace shows and how sensitive each window is to the assumed pause lengths.
//
// The script writes under --out only, with synchronous appends so a killed run keeps every line it had logged, and
// flushes the last pending autosave before it writes `summary.json`.
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync, writeSync } from "node:fs";
import { cpus, loadavg, platform, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { BinaryReader, readBoard, writeBoard } from "@tk-reawakened/core";
import { createDocumentIdentity, openBoardDocument } from "@tk-reawakened/editor-model";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, token, index, all) => (token.startsWith("--") ? [...pairs, [token.slice(2), all[index + 1]]] : pairs), []));
if (args.out === undefined) throw new Error("--out <directory> is required (use a durable path, not /tmp)");
const OUT = resolve(args.out);
const SECONDS = Number(args.seconds ?? 3600);
const SEED = Number(args.seed ?? 1828);
const CORPUS = args.corpus ?? "/Users/jensen/.omp/wt/wt-20261115-212920-57e1d90/fixtures/legacy";
const BOARDS = (args.boards ?? "Caoquest/Boards/town2.brd,Caoquest/Boards/town3.brd,Caoquest/Boards/start.brd").split(",");
const DEBOUNCE_MS = 1000;

const plan = {
  workload: "automated-seeded-paced-script",
  note: "Gesture timing is this script's assumption, not an observation of a person.",
  seed: SEED,
  debounceMs: DEBOUNCE_MS,
  burstGestures: "3-24 gestures per burst",
  gestureGapSeconds: "lognormal, median 2.0 s, clipped to 0.3-20 s",
  pauseSeconds: "70% uniform 8-60 s; 25% uniform 60-180 s; 5% uniform 180-480 s",
  gestureMix: "80% brush stroke (1-40 cells), 5% erase stroke, 12% rectangle fill (up to 25 x 20 cells), 3% undo of the last edit",
  boardDwellMinutes: "8-20 minutes on one board before moving to the next of the working set",
  manualSave: "15% of bursts end with Ctrl+S 0.3-0.9 s after the last gesture",
  beforeRun: "about 3 per hour: a run saves every dirty document with reason before-run",
  boards: BOARDS,
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const between = (low, high) => low + rng() * (high - low);
const whole = (low, high) => Math.floor(between(low, high + 1));
const normal = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

const PROJECT = join(OUT, "project");
const HISTORY = join(PROJECT, ".tkr-history");
for (const folder of [join(PROJECT, "Boards"), join(HISTORY, "blobs"), join(HISTORY, "entries")]) mkdirSync(folder, { recursive: true });
const LOG = join(OUT, "events.jsonl");
const log = (event) => appendFileSync(LOG, `${JSON.stringify({ at: Date.now(), ...event })}\n`);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const ok = (value) => ({ ok: true, value });
const fail = (code, message) => ({ ok: false, error: { code, message } });

function durableWrite(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "w");
  try {
    writeSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

// Seed the project: each working-set board is read from the corpus and written once with the real writer, so the
// project starts with files the editor can round-trip. These seed writes are not saves and are not counted.
const seeded = [];
for (const relative of BOARDS) {
  const source = new Uint8Array(readFileSync(join(CORPUS, relative)));
  const read = readBoard(new BinaryReader(source, relative));
  if (!read.ok) throw new Error(`${relative}: ${JSON.stringify(read.error)}`);
  const written = writeBoard(read.value);
  if (!written.ok) throw new Error(`${relative}: ${JSON.stringify(written.error)}`);
  const path = `Boards/${relative.split("/").pop()}`;
  durableWrite(join(PROJECT, path), written.value);
  seeded.push({ path, sourceBytes: source.byteLength, seedBytes: written.value.byteLength });
}

let pendingReason = "auto";
let pendingGestures = 0;
const counters = { saves: 0, newBlobs: 0, blobBytes: 0, entryBytes: 0, historyFailures: 0 };

function historyRecord(path, bytes) {
  const t0 = performance.now();
  const hash = sha256(bytes);
  const t1 = performance.now();
  const blobPath = join(HISTORY, "blobs", hash);
  let isNew = false;
  try {
    statSync(blobPath);
  } catch {
    isNew = true;
    durableWrite(blobPath, bytes);
  }
  const t2 = performance.now();
  const entry = { id: `${Date.now().toString(36)}-${counters.saves.toString(36)}`, path, savedAt: Date.now(), reason: pendingReason, sha256: hash, size: bytes.byteLength, groupId: null };
  const entryBytes = Buffer.from(JSON.stringify(entry));
  durableWrite(join(HISTORY, "entries", `${entry.id}.json`), entryBytes);
  const t3 = performance.now();
  if (isNew) {
    counters.newBlobs += 1;
    counters.blobBytes += bytes.byteLength;
  }
  counters.entryBytes += entryBytes.byteLength;
  return { sha256: hash, newBlob: isNew, hashMs: t1 - t0, blobMs: t2 - t1, entryMs: t3 - t2 };
}

let lastHistory = null;
const storage = {
  async readProject(_project, path) {
    try {
      return ok(new Uint8Array(readFileSync(join(PROJECT, path))));
    } catch (error) {
      return error?.code === "ENOENT" ? fail("not-found", `${path} does not exist.`) : fail("io-error", String(error));
    }
  },
  async writeProject(_project, path, bytes) {
    try {
      durableWrite(join(PROJECT, path), bytes);
      lastHistory = historyRecord(path, bytes);
      return ok(undefined);
    } catch (error) {
      counters.historyFailures += 1;
      return fail("io-error", String(error));
    }
  },
};

const docs = [];
for (const entry of seeded) {
  const opened = await openBoardDocument(storage, createDocumentIdentity("history-trace", entry.path));
  if (!opened.ok) throw new Error(`could not open ${entry.path}: ${JSON.stringify(opened.error)}`);
  docs.push({ path: entry.path, doc: opened.document, lastEditId: null, gestures: 0, timer: null });
}

// ---- The plan: every accepted-edit gesture the hour will contain, fixed by the seed before the clock starts. ----
const actions = [];
{
  let t = 3000;
  let board = 0;
  let dwellEnd = t + between(8, 20) * 60_000;
  const end = SECONDS * 1000 - 4000;
  const runTimes = [0.22, 0.5, 0.78].map((f) => f * SECONDS * 1000);
  let nextRun = 0;
  while (t < end) {
    const n = whole(3, 24);
    let last = t;
    for (let i = 0; i < n && t < end; i += 1) {
      const roll = rng();
      const kind = roll < 0.8 ? "draw" : roll < 0.85 ? "erase" : roll < 0.97 ? "rectangle" : "undo";
      actions.push({ t, type: "gesture", board, kind, seed: whole(0, 2 ** 30) });
      last = t;
      t += Math.min(20, Math.max(0.3, Math.exp(Math.log(2) + 0.7 * normal()))) * 1000;
    }
    if (nextRun < runTimes.length && last >= runTimes[nextRun]) {
      actions.push({ t: last + between(0.5, 1.5) * 1000, type: "before-run" });
      nextRun += 1;
    } else if (rng() < 0.15) {
      actions.push({ t: last + between(0.3, 0.9) * 1000, type: "manual", board });
    }
    const pauseRoll = rng();
    t = last + (pauseRoll < 0.7 ? between(8, 60) : pauseRoll < 0.95 ? between(60, 180) : between(180, 480)) * 1000;
    if (t > dwellEnd) {
      board = (board + 1) % BOARDS.length;
      dwellEnd = t + between(8, 20) * 60_000;
    }
  }
  actions.sort((a, b) => a.t - b.t);
}

const startedAt = Date.now();
writeFileSync(join(OUT, "start.json"), `${JSON.stringify({
  startedAt,
  startedIso: new Date(startedAt).toISOString(),
  seconds: SECONDS,
  host: { platform: platform(), release: release(), cpus: cpus().length, node: process.version },
  plan,
  seeded,
  plannedActions: actions.length,
  plannedGestures: actions.filter((a) => a.type === "gesture").length,
}, null, 2)}\n`);
log({ type: "start", seconds: SECONDS, seeded });

const elapsed = () => Date.now() - startedAt;
const sleep = (ms) => new Promise((done) => setTimeout(done, Math.max(0, ms)));
let chain = Promise.resolve();
const saveDoc = (entry, reason) => {
  clearTimeout(entry.timer);
  entry.timer = null;
  chain = chain.then(async () => {
    if (!entry.doc.getSnapshot().dirty) return;
    pendingReason = reason;
    pendingGestures = entry.gestures;
    lastHistory = null;
    const begun = performance.now();
    const result = await entry.doc.save(reason);
    const saveMs = performance.now() - begun;
    const usage = process.cpuUsage();
    if (!result.ok) {
      log({ type: "save-failed", elapsedMs: elapsed(), path: entry.path, reason, failure: result.failure });
      return;
    }
    counters.saves += 1;
    const gestures = pendingGestures;
    entry.gestures = 0;
    const stat = statSync(join(PROJECT, entry.path));
    log({
      type: "save",
      elapsedMs: elapsed(),
      n: counters.saves,
      path: entry.path,
      reason,
      gesturesSinceLastSave: gestures,
      bytes: stat.size,
      ...lastHistory,
      saveMs,
      historyMs: lastHistory === null ? null : lastHistory.hashMs + lastHistory.blobMs + lastHistory.entryMs,
      cumulativeNewBlobs: counters.newBlobs,
      cumulativeBlobBytes: counters.blobBytes,
      cumulativeEntryBytes: counters.entryBytes,
      loadavg1: loadavg()[0],
      cpuUserMs: usage.user / 1000,
      cpuSystemMs: usage.system / 1000,
    });
  });
  return chain;
};

function perform(action) {
  const entry = docs[action.board];
  const doc = entry.doc;
  const roll = mulberry32(action.seed);
  const snapshot = doc.getSnapshot();
  const { width, height } = snapshot.grid;
  const palette = snapshot.lut.filter((name) => name !== "");
  if (action.kind === "undo") {
    const undone = doc.undo();
    log({ type: "gesture", elapsedMs: elapsed(), path: entry.path, kind: "undo", accepted: undone.ok });
    if (undone.ok) entry.gestures += 1;
    return;
  }
  const tile = action.kind === "erase" ? "" : palette[Math.floor(roll() * palette.length)];
  const layer = Math.floor(roll() * snapshot.layers);
  const cells = [];
  if (action.kind === "rectangle") {
    const w = 2 + Math.floor(roll() * 24);
    const h = 2 + Math.floor(roll() * 19);
    const x0 = Math.floor(roll() * Math.max(1, width - w));
    const y0 = Math.floor(roll() * Math.max(1, height - h));
    for (let y = y0; y < Math.min(height, y0 + h); y += 1) for (let x = x0; x < Math.min(width, x0 + w); x += 1) cells.push({ layer, x, y, tile });
  } else {
    let x = Math.floor(roll() * width);
    let y = Math.floor(roll() * height);
    const length = 1 + Math.floor(roll() * 40);
    for (let i = 0; i < length; i += 1) {
      cells.push({ layer, x, y, tile });
      x = Math.min(width - 1, Math.max(0, x + Math.floor(roll() * 3) - 1));
      y = Math.min(height - 1, Math.max(0, y + Math.floor(roll() * 3) - 1));
    }
  }
  const gesture = action.kind === "rectangle" ? "rectangle" : action.kind === "erase" ? "erase" : "draw";
  const applied = doc.apply({ type: "set-tiles", gesture, cells });
  log({ type: "gesture", elapsedMs: elapsed(), path: entry.path, kind: action.kind, cells: cells.length, accepted: applied.ok, ...(applied.ok ? {} : { rejection: applied.rejection.reason }) });
  if (!applied.ok) return;
  entry.gestures += 1;
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => void saveDoc(entry, "auto"), DEBOUNCE_MS);
}

let finished = false;
async function finish(interrupted) {
  if (finished) return;
  finished = true;
  for (const entry of docs) await saveDoc(entry, "auto");
  await chain;
  const usage = process.cpuUsage();
  const summary = {
    interrupted,
    startedAt,
    endedAt: Date.now(),
    wallSeconds: (Date.now() - startedAt) / 1000,
    processCpuSeconds: (usage.user + usage.system) / 1e6,
    ...counters,
    maxHeartbeatGapMs: heartbeatGapMax,
  };
  log({ type: "end", ...summary });
  writeFileSync(join(OUT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  process.exit(0);
}
process.on("SIGTERM", () => void finish(true));
process.on("SIGINT", () => void finish(true));

let heartbeatGapMax = 0;
let lastBeat = Date.now();
const beat = setInterval(() => {
  const now = Date.now();
  heartbeatGapMax = Math.max(heartbeatGapMax, now - lastBeat - 30_000);
  lastBeat = now;
  const usage = process.cpuUsage();
  log({ type: "heartbeat", elapsedMs: elapsed(), loadavg1: loadavg()[0], rssMb: process.memoryUsage().rss / 1e6, cpuSeconds: (usage.user + usage.system) / 1e6 });
}, 30_000);

for (const action of actions) {
  await sleep(action.t - elapsed());
  if (action.type === "gesture") perform(action);
  else if (action.type === "manual") void saveDoc(docs[action.board], "manual");
  else for (const entry of docs) void saveDoc(entry, "before-run");
}
await sleep(SECONDS * 1000 - elapsed());
clearInterval(beat);
await finish(false);
