// A game save must never capture a thread parked on a host request that has no
// answer yet (AD-17, docs/spec/formats/save-game.md#reawakened-full-engine-save-and-load):
// the restore would drop the request and that thread could never resume.
// `finalizeBlobRequests` therefore waits for every other in-flight blob request
// before it serializes a game save.
//
// Two things make the invariant hold: the VM gives every host request a global
// wait, so a parked request freezes the tick and no second thread reaches `Save`
// in the same phase (this test drives both cases and asserts the ordering), and
// the finalizer refuses to snapshot while another blob entry is pending, which
// keeps the invariant structural if the wake rules ever change.
import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { TextDecoder, TextEncoder } from "node:util";
import {
  assetKey,
  IR_VERSION,
  createAssetIndex,
  createEmptyBoard,
  createEmptyMainFile,
  createEngine,
  startThread,
  writeBoard,
  writeMainFile,
  type AssetKey,
  type InputRecord,
} from "../src/index.ts";

const encoder = new TextEncoder();

type Files = Map<AssetKey, Uint8Array>;

/** A boot-mode game with an authored board and a start-up program that just ends. */
function runningGame(): { files: Files; mainBytes: Uint8Array; paths: string[] } {
  const main = { ...createEmptyMainFile(), major: 2, minor: 9, startupPrg: "start.prg", initBoard: "start.brd" };
  const written = writeMainFile(main);
  if (!written.ok) throw new Error(written.error.message);
  const empty = createEmptyBoard();
  const board = writeBoard({ ...empty, properties: { ...empty.properties, start: { x: 32, y: 32, layer: 1 } } });
  if (!board.ok) throw new Error(board.error.message);
  const paths = ["main.gam", "boards/start.brd", "prg/start.prg"];
  const files: Files = new Map([
    [assetKey("main.gam"), written.value],
    [assetKey("boards/start.brd"), board.value],
    [assetKey("prg/start.prg"), encoder.encode("end()\n")],
  ]);
  return { files, mainBytes: written.value, paths };
}

type SavedThread = { readonly id: number; readonly status: string; readonly wait: { readonly kind: string; readonly reply: { readonly ok: boolean } | null } | null };
type SavedState = { readonly vm: { readonly threads: readonly SavedThread[] } };

test("a game save never captures a thread parked on an unanswered host request", () => {
  const game = runningGame();
  let started = false;
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(game.paths),
    assetRoot: { kind: "package" },
    mainFile: "main.gam",
    gameIdentity: "in-flight-test",
    width: 64,
    height: 64,
    maxTicks: 200,
    startup: {
      presence: { hasPlayer: () => true },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
    // Once the game is running, start two ordinary (non-blocking) threads on the
    // same tick: one parks on a file write, the other calls Save.
    phaseRegistrations: [{
      phase: "events",
      run: (state) => {
        if (started || state.engine.boot?.stage !== "running") return;
        started = true;
        startThread(state.vm, {
          ref: { kind: "inline", text: 'h = openfileoutput("log.txt", "files")\nend()\n', ir: IR_VERSION },
          kind: "board",
          owner: "script",
        });
        startThread(state.vm, {
          ref: { kind: "inline", text: 'Save("slot")\nend()\n', ir: IR_VERSION },
          kind: "board",
          owner: "script",
        });
      },
    }],
  });

  let replies: InputRecord[] = [];
  let savedBytes: Uint8Array | null = null;
  let sawFileWrite = false;
  let writeTick = -1;
  let saveTick = -1;
  for (let guard = 0; guard < 40 && savedBytes === null; guard += 1) {
    const report = engine.advance(1, replies);
    replies = [];
    for (const request of report.requests) {
      if (request.kind === "asset") {
        replies.push({ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: game.files.get(request.key) ?? null } });
      } else if (request.kind === "saveBlob" && request.blob.path.endsWith(".sav")) {
        savedBytes = new Uint8Array(request.bytes);
        saveTick = report.tickAfter;
      } else if (request.kind === "saveBlob") {
        sawFileWrite = true;
        writeTick = report.tickAfter;
        // Answer the file write only on the next advance, so the game save has a
        // real chance to be finalized while that request is still in flight.
      }
    }
    if (savedBytes !== null) break;
    if (report.loading && replies.length === 0) {
      const pendingFile = report.requests.find((request) => request.kind === "saveBlob" && !request.blob.path.endsWith(".sav"));
      if (pendingFile !== undefined) {
        replies.push({ tick: report.tickAfter, event: { kind: "blob.saved", reqId: pendingFile.reqId, ok: true } });
      }
    }
  }

  ok(sawFileWrite, "the worker thread really issued a file write request");
  ok(writeTick < saveTick, "the save is finalized only after the file write was answered");
  ok(savedBytes !== null, "the game save reached the host");
  const saved = JSON.parse(new TextDecoder().decode(savedBytes as Uint8Array)) as SavedState;
  const unanswered = saved.vm.threads.filter((thread) => thread.wait?.kind === "blob" && thread.wait.reply === null);
  equal(unanswered.length, 0, `a saved thread must never wait on a request the host never answered: ${JSON.stringify(unanswered.map((thread) => thread.id))}`);
  const answered = saved.vm.threads.filter((thread) => thread.wait?.kind === "blob" && thread.wait.reply !== null);
  equal(answered.length, 1, "the saving thread is the only parked blob thread, and its reply is recorded");

});
