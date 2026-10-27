// Owner ruling 2026-10-27 (docs/spec/formats/save-game.md#compiler-mismatch-refuse-the-whole-save-owner-ruling):
// a save made by another compiler is refused whole and the live game is left
// unchanged. This drives the real engine's `Load` against a captured save whose
// compiler version has been altered, and against the untouched save as a control.
import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { TextDecoder, TextEncoder } from "node:util";
import {
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyMainFile,
  COMPILER_VERSION,
  createEngine,
  startThread,
  writeBoard,
  writeMainFile,
  type AssetKey,
  type GameState,
  type InputRecord,
} from "../src/index.ts";

const encoder = new TextEncoder();
const PATHS = ["main.gam", "boards/start.brd", "prg/start.prg"];

type Game = { readonly files: Map<AssetKey, Uint8Array>; readonly engine: ReturnType<typeof createEngine>; state(): GameState | null };

/**
 * A boot-mode game whose start-up program just ends and whose script `program` runs
 * as an inline thread once the game is running. An inline program has no source
 * hash, so it is never subject to the per-thread source-changed restart.
 */
function boot(program: string, startPrg = "end()\n"): Game {
  const main = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, startupPrg: "start.prg", initBoard: "start.brd" });
  if (!main.ok) throw new Error(main.error.message);
  const empty = createEmptyBoard();
  const board = writeBoard({ ...empty, properties: { ...empty.properties, start: { x: 32, y: 32, layer: 1 } } });
  if (!board.ok) throw new Error(board.error.message);
  const files = new Map<AssetKey, Uint8Array>([
    [assetKey("main.gam"), main.value],
    [assetKey("boards/start.brd"), board.value],
    [assetKey("prg/start.prg"), encoder.encode(startPrg)],
  ]);
  let latest: GameState | null = null;
  let started = false;
  const engine = createEngine({
    seed: 5,
    assetIndex: createAssetIndex(PATHS),
    assetRoot: { kind: "package" },
    mainFile: "main.gam",
    gameIdentity: "compiler-refusal-test",
    width: 64,
    height: 64,
    maxTicks: 400,
    startup: {
      presence: { hasPlayer: () => true },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
    phaseRegistrations: [{
      phase: "events",
      run: (state) => {
        latest = state;
        if (started || state.engine.boot?.stage !== "running") return;
        started = true;
        startThread(state.vm, { ref: { kind: "inline", text: program, compiler: COMPILER_VERSION }, kind: "board", owner: "script" });
      },
    }],
  });
  return { files, engine, state: () => latest };
}

/** Run a game to completion, answering assets and optionally handing `loadBytes` to a Load. */
function run(game: Game, loadBytes: Uint8Array | null): { saved: Uint8Array | null; codes: string[] } {
  let replies: InputRecord[] = [];
  let saved: Uint8Array | null = null;
  const codes: string[] = [];
  for (let guard = 0; guard < 60; guard += 1) {
    const report = game.engine.advance(1, replies);
    replies = [];
    codes.push(...report.diagnostics.map((diagnostic) => diagnostic.code));
    for (const request of report.requests) {
      if (request.kind === "asset") {
        replies.push({ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: game.files.get(request.key) ?? null } });
      } else if (request.kind === "saveBlob") {
        saved = new Uint8Array(request.bytes);
        replies.push({ tick: report.tickAfter, event: { kind: "blob.saved", reqId: request.reqId, ok: true } });
      } else if (request.kind === "loadBlob") {
        replies.push({ tick: report.tickAfter, event: { kind: "blob.loaded", reqId: request.reqId, bytes: loadBytes } });
      }
    }
  }
  return { saved, codes };
}

type Json = { schema: { compiler: string }; vm: { threads: { frames: { program: { compiler: string } }[] }[] } };
function tamper(bytes: Uint8Array, edit: (json: Json) => void): Uint8Array {
  const json = JSON.parse(new TextDecoder().decode(bytes)) as Json;
  edit(json);
  return encoder.encode(JSON.stringify(json));
}

const SAVER = 'marker = 1\nSave("slot")\nmarker = 5\nend()\n';
// Marker 9 is set before Load; a restored save would put marker back to 1 and
// resume the saver, which then writes 5. A refused load leaves 9 and runs on.
const LOADER = 'marker = 9\nLoad("slot")\nafter = marker\nend()\n';

function capturedSave(): Uint8Array {
  const { saved } = run(boot(SAVER), null);
  ok(saved !== null, "the saver produced a save");
  return saved;
}

test("control: a compatible save restores and resumes the saved thread", () => {
  const loader = boot(LOADER);
  const { codes } = run(loader, capturedSave());
  const globals = loader.state()!.vm.globals as Record<string, unknown>;
  equal(globals.marker, 5, `the restored thread ran on after Save: ${JSON.stringify(codes)} ${JSON.stringify(globals)}`);
  equal(globals.after, undefined, "the loader's own continuation was replaced by the save");
  equal(codes.includes("restore.compiler-mismatch"), false);
});

for (const [label, edit] of [
  ["the snapshot's schema.compiler", (json: Json) => { json.schema.compiler = "1"; }],
  ["a thread frame's program compiler", (json: Json) => {
    const thread = json.vm.threads.find((entry) => entry.frames.length > 0);
    ok(thread !== undefined, "the save holds a running thread");
    thread.frames[0]!.program.compiler = "1";
  }],
] as const) {
  test(`a save with ${label} from another compiler is refused whole and the live game is unchanged`, () => {
    const loader = boot(LOADER);
    const { codes } = run(loader, tamper(capturedSave(), edit));
    const state = loader.state()!;
    const globals = state.vm.globals as Record<string, unknown>;

    ok(codes.includes("restore.compiler-mismatch"), `diagnostics: ${JSON.stringify(codes)}`);
    equal(globals.marker, 9, "no part of the save was applied");
    equal(globals.after, 9, "the calling thread kept running after Load failed");
    equal(state.vm.threads.some((thread) => thread.status === "waiting"), false, "the failed Load left no thread parked");
  });
}

test("a changed file source is not a compiler mismatch: the save loads and only that thread restarts", () => {
  // The saved thread is the start-up program, a file-backed program with a source
  // hash. The loading game ships a different start.prg, so on restore that one
  // thread restarts from the current source (restore.source-changed) while the
  // save itself is accepted: the loader's own continuation is still replaced.
  const { saved } = run(boot("end()\n", 'marker = 1\nSave("slot")\nmarker = 5\nend()\n'), null);
  ok(saved !== null, "the saver produced a save");
  const loader = boot(LOADER, "marker = 7\nend()\n");
  const { codes } = run(loader, saved);
  const globals = loader.state()!.vm.globals as Record<string, unknown>;
  equal(codes.includes("restore.compiler-mismatch"), false, JSON.stringify(codes));
  equal(globals.after, undefined, "the load was accepted and replaced the loader's continuation");
  equal(globals.marker, 7, "the saved thread restarted from the current start.prg source");
});
