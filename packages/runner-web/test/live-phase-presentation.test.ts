import { equal } from "node:assert/strict";
import { test } from "node:test";
import { createAssetIndex, createEmptyBoard, createEngine, inputResetRegistration, PACKAGE_ROOT, surfaceBytesEncodedForDiagnostics, writeBoard, type GameState } from "@tk-reawakened/core";
import { livePhaseRegistrations, markLiveResetRegistrations } from "../src/live-session.ts";

function bytes(result: { readonly ok: true; readonly value: Uint8Array } | { readonly ok: false; readonly error: { readonly message: string } }): Uint8Array {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

test("live runner phase wiring stays within the deferred screen-encoding budget", () => {
  const registrations = livePhaseRegistrations({
    interactive: true,
    menuKey: { action: "menu", code: "KeyM" },
    pixelMovement: 0,
    programRef: () => null,
    audioRun: () => {},
  });
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 16,
    height: 16,
    maxTicks: 1,
    program: "end()\n",
    phaseRegistrations: registrations,
    resetRegistrations: markLiveResetRegistrations([inputResetRegistration()]),
  });
  const before = surfaceBytesEncodedForDiagnostics();
  const request = engine.advance(0, []).requests[0];
  if (request?.kind !== "asset") throw new Error("expected board request");
  const board = bytes(writeBoard(createEmptyBoard()));
  engine.advance(1, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: board } }]);
  engine.advance(1, []);
  equal(surfaceBytesEncodedForDiagnostics() - before, 0);
});

test("live runner reset registration keeps redraw to one fresh-screen encoding", () => {
  let resetRequested = false;
  const resetInputRef: { value: GameState["input"] | null } = { value: null };
  const latestStateRef: { value: GameState | null } = { value: null };
  const registrations = livePhaseRegistrations({
    interactive: true,
    menuKey: { action: "menu", code: "KeyM" },
    pixelMovement: 0,
    programRef: () => null,
    audioRun: (state, postEffect) => {
      latestStateRef.value = state;
      if (!resetRequested) return;
      resetInputRef.value = state.input;
      resetRequested = false;
      postEffect?.("engine", { thread: 0, name: "reset", kind: "state-write", args: [], out: {}, result: null, patch: null, wait: null, request: null });
    },
  });
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 16,
    height: 16,
    maxTicks: 1,
    program: "end()\n",
    phaseRegistrations: registrations,
    resetRegistrations: markLiveResetRegistrations([inputResetRegistration()]),
  });
  const board = bytes(writeBoard(createEmptyBoard()));
  const beforeInitialFrames = surfaceBytesEncodedForDiagnostics();
  let report = engine.advance(0, []);
  for (let attempts = 0; attempts < 5; attempts += 1) {
    const request = report.requests.find((entry) => entry.kind === "asset");
    if (request === undefined) break;
    report = engine.advance(1, [{ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: board } }]);
  }
  engine.advance(1, []);
  equal(surfaceBytesEncodedForDiagnostics() - beforeInitialFrames, 0);
  const stateBeforeReset = latestStateRef.value as GameState | null;
  if (stateBeforeReset === null) throw new Error("expected live phase to observe engine state");
  const screenBeforeReset = stateBeforeReset.surfaces.entries["0"];
  if (screenBeforeReset === undefined) throw new Error("expected a presented screen before reset");
  const beforeResetDispatch = surfaceBytesEncodedForDiagnostics();
  resetRequested = true;
  report = engine.advance(1, []);
  const resetInputValue = resetInputRef.value as GameState["input"] | null;
  const stateAfterReset = latestStateRef.value as GameState | null;
  if (resetInputValue === null) throw new Error("expected the audio phase to request reset");
  if (stateAfterReset === null || stateAfterReset.input === resetInputValue || stateAfterReset.input.pointerPlane !== null) {
    throw new Error("expected the built-in reset registration to clear transient input and its pointer plane");
  }
  for (let attempts = 0; attempts < 5; attempts += 1) {
    const request = report.requests.find((entry) => entry.kind === "asset");
    if (request === undefined) break;
    report = engine.advance(1, [{ tick: report.tickAfter, event: { kind: "asset", reqId: request.reqId, bytes: board } }]);
  }
  engine.advance(1, []);
  const stateAfterRedraw = latestStateRef.value as GameState | null;
  if (stateAfterRedraw === null) throw new Error("expected live state after reset");
  const screenAfterReset = stateAfterRedraw.surfaces.entries["0"];
  if (screenAfterReset === undefined || screenAfterReset === screenBeforeReset || screenAfterReset.rev === 0) {
    throw new Error("expected reset to install and redraw the presented screen");
  }
  equal(surfaceBytesEncodedForDiagnostics() - beforeResetDispatch, 1024);
});
