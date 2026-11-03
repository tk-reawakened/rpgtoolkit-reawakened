// Epic 8 full-engine restore acceptance (#595): actual Save bytes pass through
// the engine's blob boundary, then Load restores/replays them. The small number
// of engine ticks is required to exercise boot, request/reply, and VM phases;
// save projection itself is intentionally an integrated (slower) contract.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { TextDecoder, TextEncoder } from "node:util";
import {
  assetKey, createAssetIndex, createEmptyBoard, createEmptyMainFile, createEngine, createGameState,
  hashGameState, IR_VERSION, restoreGameSave, restoreGameState, snapshot, startThread, writeBoard, writeMainFile,
  type AssetKey, type GameState, type InputRecord,
} from "../src/index.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PATHS = ["main.gam", "boards/start.brd", "prg/start.prg"];
type Game = {
  readonly files: Map<AssetKey, Uint8Array>;
  readonly engine: ReturnType<typeof createEngine>;
  state(): GameState | null;
};

function boot(program: string): Game {
  const main = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, startupPrg: "start.prg", initBoard: "start.brd" });
  if (!main.ok) throw new Error(main.error.message);
  const board = writeBoard({ ...createEmptyBoard(), properties: { ...createEmptyBoard().properties, start: { x: 32, y: 32, layer: 1 } } });
  if (!board.ok) throw new Error(board.error.message);
  const files = new Map<AssetKey, Uint8Array>([
    [assetKey("main.gam"), main.value],
    [assetKey("boards/start.brd"), board.value],
    [assetKey("prg/start.prg"), encoder.encode("end()\n")],
  ]);
  const paths = [...PATHS];
  let latest: GameState | null = null;
  let started = false;
  const engine = createEngine({
    seed: 5, assetIndex: createAssetIndex(paths), assetRoot: { kind: "package" },
    mainFile: "main.gam", gameIdentity: "epic-8-restore-acceptance", width: 64, height: 64, maxTicks: 400,
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    phaseRegistrations: [{ phase: "events", run: (state) => {
      latest = state;
      if (started || state.engine.boot?.stage !== "running") return;
      started = true;
      startThread(state.vm, { ref: { kind: "inline", text: program, ir: IR_VERSION }, kind: "board", owner: "script" });
    } }],
  });
  return { files, engine, state: () => latest };
}

type Run = { saved: Uint8Array | null; readonly hashes: string[]; readonly codes: string[] };
function run(game: Game, loadBytes: Uint8Array | null, ticks = 40): Run {
  let replies: InputRecord[] = [];
  let saved: Uint8Array | null = null;
  const hashes: string[] = [];
  const codes: string[] = [];
  for (let i = 0; i < ticks; i++) {
    const report = game.engine.advance(1, replies);
    replies = [];
    codes.push(...report.diagnostics.map(({ code }) => code));
    hashes.push(report.stateHash);
    for (const request of report.requests) {
      if (request.kind === "asset") replies.push({ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: game.files.get(request.key) ?? null } });
      else if (request.kind === "saveBlob") {
        saved = new Uint8Array(request.bytes);
        replies.push({ tick: report.tickAfter, event: { kind: "blob.saved", reqId: request.reqId, ok: true } });
      } else if (request.kind === "loadBlob") replies.push({ tick: report.tickAfter, event: { kind: "blob.loaded", reqId: request.reqId, bytes: loadBytes } });
    }
  }
  return { saved, hashes, codes };
}

const SAVER = 'counter = counter + 1\nSave("slot")\ncounter = counter + 1\nthreadsleep(1)\ncounter = counter + 1\nend()\n';
const LOADER = 'counter = 9\nLoad("slot")\nafter = counter\nend()\n';
function capture(): Uint8Array {
  const result = run(boot(SAVER), null);
  ok(result.saved !== null, "real Engine Save emitted bytes");
  return result.saved;
}
function mutate(bytes: Uint8Array, change: (root: Record<string, unknown>) => void): Uint8Array {
  const root = JSON.parse(decoder.decode(bytes)) as Record<string, unknown>;
  change(root);
  return encoder.encode(JSON.stringify(root));
}
function globals(game: Game): Record<string, unknown> {
  const state = game.state();
  ok(state !== null);
  return state.vm.globals as Record<string, unknown>;
}

test("full-engine Save bytes load mid-script and produce canonical deterministic replay hashes", () => {
  const bytes = capture();
  ok(bytes.length > 1000);
  const text = decoder.decode(bytes);
  ok(text.startsWith("{") && text.includes('"counter":1'));
  const captured = restoreGameSave(text, createGameState({ seed: 5 }).audio).state;
  const canonical = snapshot(captured);
  const roundTrip = restoreGameState(canonical);
  equal(snapshot(roundTrip), canonical, "the saved state has a stable canonical representation");
  equal(hashGameState(roundTrip), hashGameState(captured), "canonical hash survives restoration of the real save bytes");
  const reference = boot(SAVER);
  run(reference, null);
  equal(globals(reference).counter, 3, "the uninterrupted reference completed the Save continuation");
  const first = boot(LOADER);
  const firstRun = run(first, bytes);
  equal(globals(first).counter, 3, "the saved thread resumed after Save and completed its continuation");
  const loadedState = first.state();
  const referenceState = reference.state();
  ok(loadedState !== null && referenceState !== null, "both engine runs expose their final state");
  const loadedCanonical = JSON.parse(snapshot(loadedState)) as Record<string, unknown>;
  const referenceCanonical = JSON.parse(snapshot(referenceState)) as Record<string, unknown>;
  // VM and engine bookkeeping differ because the loaded run also executes a Load caller.
  // Surfaces are a derived presentation-resource cache: their revision counters need not
  // match after Load. Audio cueId is monotonic and Load emits its own reset cue, so only
  // that counter is excluded; all other canonical audio fields are compared exactly.
  for (const section of [
    "world", "sprites", "actors", "party", "inventory", "triggers", "battle",
    "menu", "input", "ui", "camera", "fx", "audio", "rng", "events",
  ] as const) {
    if (section === "audio") {
      const { cueId: _loadSpecificCueId, ...loadedAudio } = loadedCanonical.audio as Record<string, unknown>;
      const { cueId: _referenceCueId, ...referenceAudio } = referenceCanonical.audio as Record<string, unknown>;
      deepEqual(loadedAudio, referenceAudio, "post-Load audio state matches uninterrupted execution apart from its next cue ID");
    } else {
      deepEqual(loadedCanonical[section], referenceCanonical[section], `post-Load ${section} matches uninterrupted execution`);
    }
  }
  const second = boot(LOADER);
  const secondRun = run(second, bytes);
  equal(globals(second).counter, 3);
  deepEqual(firstRun.hashes, secondRun.hashes, "same real save bytes replay to the same per-tick state hashes");
  equal(firstRun.codes.includes("restore.ir-mismatch"), false);
  equal(secondRun.codes.includes("restore.ir-mismatch"), false);
});

test("full-engine Load refuses newer IR and restarts an older-IR saved thread", () => {
  const saved = capture();
  const newer = mutate(saved, (root) => {
    const schema = root.schema as Record<string, unknown>;
    schema.ir = String(Number(IR_VERSION) + 1);
  });
  const refused = boot(LOADER);
  const refusal = run(refused, newer);
  ok(refusal.codes.includes("restore.ir-mismatch"));
  equal(globals(refused).counter, 9, "refusal preserves the live value instead of adopting saved counter=1");
  equal(globals(refused).after, 9, "the calling thread continues after refused Load without replacing live state");

  const older = mutate(saved, (root) => {
    const vm = root.vm as { threads: { frames: { program: { ir: string } }[] }[] };
    const thread = vm.threads.find((candidate) => candidate.frames.length > 0);
    ok(thread !== undefined, "save includes the running Save thread");
    thread.frames[0]!.program.ir = "0";
  });
  const restarted = boot(LOADER);
  const replay = run(restarted, older);
  equal(globals(restarted).counter, 4, "older-IR thread restarted from source over restored counter");
  equal(replay.codes.includes("restore.ir-mismatch"), false, "older thread is restarted, not refused");
});
