/**
 * The state hash cadence (docs/spec/engine/runners.md#state-hash-cadence, issue #1890): an `"on-request"` engine's
 * reports carry no hash, and `engine.stateHash()` returns exactly what an `"every-advance"` engine reports.
 */

import { equal, ok } from "node:assert/strict";
import test from "node:test";
import { fnv1a64ScannedBytes } from "../src/canon/fnv1a.ts";
import {
  createAssetIndex,
  createEmptyBoard,
  createEngine,
  PACKAGE_ROOT,
  writeBoard,
  type EngineInit,
  type InputRecord,
} from "../src/index.ts";

const PROGRAM = ["total = 1", "function grow(n) {", "    return n * 2", "}", "total = grow(total)", "wait(2)", "total = grow(total)"].join("\n");

function init() {
  return {
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 8,
    program: PROGRAM,
  } satisfies EngineInit;
}

function boardReply(reqId: number): InputRecord {
  const board = writeBoard(createEmptyBoard());
  if (!board.ok) throw new Error(board.error.message);
  return { tick: 0, event: { kind: "asset", reqId, bytes: board.value } };
}

test("an on-request engine omits the report hash and stateHash() matches the every-advance report", () => {
  const every = createEngine(init());
  const onRequest = createEngine({ ...init(), stateHashInReports: "on-request" });
  const firstEvery = every.advance(0, []);
  const firstOnRequest = onRequest.advance(0, []);
  // Permit small program/request fingerprints (87 bytes here), but no whole-state report hash.
  const idle = createEngine({ ...init(), program: "", stateHashInReports: "on-request" });
  const before = fnv1a64ScannedBytes();
  idle.advance(0, []);
  const REPORT_HASH_SCAN_BUDGET = 128;
  ok(fnv1a64ScannedBytes() - before <= REPORT_HASH_SCAN_BUDGET, "on-request advance must skip the whole-state hash");
  ok(!("stateHash" in firstOnRequest), "the on-request report has no stateHash field");
  equal(onRequest.stateHash(), firstEvery.stateHash);
  const request = firstEvery.requests[0];
  if (request?.kind !== "asset") throw new Error("expected board asset request");
  const batches: Array<[number, readonly InputRecord[]]> = [[0, [boardReply(request.reqId)]], [1, []], [3, []]];
  for (const [ticks, inputs] of batches) {
    const report = every.advance(ticks, inputs);
    onRequest.advance(ticks, inputs);
    // Reading twice changes nothing, and the every-advance engine's own read agrees with its report.
    equal(onRequest.stateHash(), report.stateHash);
    equal(onRequest.stateHash(), report.stateHash);
    equal(every.stateHash(), report.stateHash);
  }
});

// Compile-time evidence: a caller must narrow a runtime-selected mode before reading a report hash.
function checkHashReportTypes(options: EngineInit): void {
  const dynamic = createEngine(options).advance(0, []);
  // @ts-expect-error A runtime-selected mode may omit the hash.
  const unsafe: string = dynamic.stateHash;
  const explicit = createEngine({ ...options, stateHashInReports: "on-request" }).advance(0, []);
  // @ts-expect-error An on-request report never carries the hash.
  const absent: string = explicit.stateHash;
  const defaulted: string = createEngine({ ...options, stateHashInReports: "every-advance" }).advance(0, []).stateHash;
  void [unsafe, absent, defaulted];
}
void checkHashReportTypes;
