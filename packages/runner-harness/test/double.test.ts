import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import type { InputRecord } from "@tk-reawakened/core";
import { createTestEngine } from "../src/double/test-engine.ts";

const GAMEPAD = { kind: "gamepad", device: 0, connected: false, axes: { x: 0, y: 0 }, buttons: 0 } as const;
test("test double executes key down, pointer, key up and matches literals", () => {
  const engine = createTestEngine();

  const inputs: InputRecord[] = [
    {
      tick: 0,
      event: { kind: "key", name: "A", code: "KeyA", char: null, down: true },
    },
    {
      tick: 1,
      event: { kind: "pointer", x: 100, y: 50, buttons: 1 },
    },
    {
      tick: 2,
      event: { kind: "key", name: "A", code: "KeyA", char: null, down: false },
    },
  ];

  const report = engine.advance(3, inputs);

  equal(report.ticksRun, 3);
  equal(report.tickAfter, 3);
  equal(report.loading, false);
  equal(report.paused, null);
  deepEqual(report.requests, []);
  deepEqual(report.diagnostics, []);
  equal(report.audioCues.length, 1);
  deepEqual(report.audioCues[0], {
    cueId: 1,
    tick: 0,
    kind: "media.volume",
    track: null,
    voice: null,
    asset: null,
    loop: null,
    flags: null,
    positionTicks: null,
    volume: 100,
    targetVolume: null,
    durationTicks: null,
  });

  const dl = engine.drawList(0);
  equal(dl.tick, 3);
  equal(dl.width, 320);
  equal(dl.height, 240);
  // Key A is released, so keys is empty; commands should be fill then pointer rect
  deepEqual(dl.commands, [
    { kind: "fill", rgb: { r: 0, g: 0, b: 0 } },
    {
      kind: "rect",
      rect: { x: 100, y: 50, w: 4, h: 4 },
      rgb: { r: 255, g: 0, b: 0 },
      filled: true,
    },
  ]);
});

test("test double key-up for an unheld key removes nothing and does not throw", () => {
  const engine = createTestEngine();
  const report = engine.advance(1, [
    {
      tick: 0,
      event: { kind: "key", name: "UNHELD", code: "KeyU", char: null, down: false },
    },
  ]);

  equal(report.ticksRun, 1);
  equal(report.audioCues.length, 0);
  const dl = engine.drawList(0);
  deepEqual(dl.commands, [
    { kind: "fill", rgb: { r: 0, g: 0, b: 0 } },
    {
      kind: "rect",
      rect: { x: 0, y: 0, w: 4, h: 4 },
      rgb: { r: 255, g: 0, b: 0 },
      filled: true,
    },
  ]);
});

test("test double throws RangeError on past-stamped and future-stamped input", () => {
  const engine1 = createTestEngine();
  throws(
    () =>
      engine1.advance(2, [
        {
          tick: -1,
          event: GAMEPAD,
        },
      ]),
    RangeError,
  );

  const engine2 = createTestEngine();
  throws(
    () =>
      engine2.advance(2, [
        {
          tick: 2,
          event: GAMEPAD,
        },
      ]),
    RangeError,
  );
});

test("test double pauses while the window has lost focus and resumes with it", () => {
  // docs/spec/engine/main-loop-and-startup.md#e-03: the Paused state runs no game frame, so the tick stands still
  // while the window is inactive and moves again once it is focused.
  const engine = createTestEngine();
  const paused = engine.advance(3, [{ tick: 0, event: { kind: "focus", state: "lost" } }]);
  equal(paused.ticksRun, 0, "no frame runs while unfocused");
  equal(paused.tickAfter, 0, "the clock does not advance while unfocused");
  const stillPaused = engine.advance(2, []);
  equal(stillPaused.ticksRun, 0);
  equal(stillPaused.tickAfter, 0);
  const resumed = engine.advance(2, [{ tick: 0, event: { kind: "focus", state: "gained" } }]);
  equal(resumed.ticksRun, 2, "focus returns the loop to running frames");
  equal(resumed.tickAfter, 2);
});

test("test double increments other counter for remaining events and returns null for pixels", () => {
  const engine = createTestEngine();
  const bytes = new Uint8Array([1, 2, 3]);

  const inputs: InputRecord[] = [
    { tick: 0, event: GAMEPAD },
    { tick: 1, event: { kind: "asset", reqId: 1, bytes } },
    { tick: 2, event: { kind: "blob.loaded", reqId: 2, bytes: null } },
    { tick: 3, event: { kind: "blob.saved", reqId: 3, ok: true } },
    { tick: 4, event: { kind: "blob.listed", reqId: 4, names: ["save1"] } },
    { tick: 5, event: { kind: "extension.result", reqId: 5, result: 42 } },
    { tick: 6, event: { kind: "audio.ended", cueId: 10 } },
    { tick: 7, event: { kind: "video.ended", reqId: 1 } },
  ];

  const report = engine.advance(8, inputs);
  equal(report.ticksRun, 8);
  equal(report.consumed.length, 8);

  const ev1 = report.consumed[1]!.event;
  if (ev1.kind !== "asset" || !ev1.bytes) {
    throw new Error("expected asset event with bytes");
  }
  const consumedBytes = ev1.bytes;
  equal(consumedBytes !== bytes, true);
  equal(consumedBytes.byteOffset, 0);
  deepEqual(consumedBytes, bytes);

  // Surface pixels returns null and setBreakpoints is no-op
  equal(engine.surfacePixels("surf" as never, 1), null);
  engine.setBreakpoints([]);
});

test("test double key-down deduplicates held keys", () => {
  const engine = createTestEngine();
  engine.advance(2, [
    { tick: 0, event: { kind: "key", name: "A", code: "KeyA", char: null, down: true } },
    { tick: 1, event: { kind: "key", name: "A", code: "KeyA", char: null, down: true } },
  ]);

  const dl = engine.drawList(0);
  equal(dl.commands.length, 3);
  deepEqual(dl.commands[1], {
    kind: "rect",
    rect: { x: 0, y: 0, w: 16, h: 16 },
    rgb: { r: 255, g: 255, b: 255 },
    filled: true,
  });
});

test("a paused double defers the first tick's non-focus records, as the engine's pre-tick pass does", () => {
  // The engine consumes only focus/asset/blob/video replies at the current tick while paused and re-queues the rest.
  const engine = createTestEngine();
  engine.advance(1, [{ tick: 0, event: { kind: "focus", state: "lost" } }]);
  const paused = engine.advance(2, [{ tick: 0, event: { kind: "key", name: "A", code: "A", char: "a", down: true } }]);
  equal(paused.ticksRun, 0);
  equal(paused.tickAfter, 0);
  equal(paused.consumed.length, 0, "the key stays queued while the window is inactive");
  equal(paused.audioCues.length, 0, "no cue is emitted while paused");
  // The draw list always has the background fill and the pointer rect; a key would add a third.
  equal(engine.drawList().commands.length, 2, "no key draw command was recorded");
});
