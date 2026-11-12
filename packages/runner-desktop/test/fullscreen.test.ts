import { deepEqual, equal } from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { trackPlayerFullscreen } from "../src/fullscreen.ts";

test("macOS fullscreen retries a wrong-display landing once and restores the window on exit", async (t) => {
  t.mock.method(console, "info", () => {});
  const primary = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
  const secondary = { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } };
  const original = { x: 2000, y: 120, width: 960, height: 720 };
  const screen = {
    getAllDisplays: () => [primary, secondary],
    getDisplayMatching: ({ x }: { x: number }) => x < secondary.bounds.x ? primary : secondary,
  };
  let bounds = { x: 100, y: 100, width: 960, height: 720 };
  let fullscreen = false;
  const toggles: boolean[] = [];
  const window = Object.assign(new EventEmitter(), {
    getBounds: () => bounds,
    getNormalBounds: () => original,
    isDestroyed: () => false,
    isFullScreen: () => fullscreen,
    setBounds: (next: typeof original) => { bounds = next; },
    setFullScreen: (next: boolean) => { toggles.push(next); },
  });
  trackPlayerFullscreen(window, screen, true);
  bounds = original;
  window.emit("move");

  fullscreen = true;
  bounds = primary.bounds;
  window.emit("enter-full-screen");
  await setImmediate();
  deepEqual(toggles, [false]);

  fullscreen = false;
  window.emit("leave-full-screen");
  await setImmediate();
  deepEqual(bounds, original);
  deepEqual(toggles, [false, true]);

  // If the native retry fails too, it must not loop through another transition.
  fullscreen = true;
  bounds = primary.bounds;
  window.emit("enter-full-screen");
  await setImmediate();
  deepEqual(toggles, [false, true]);

  fullscreen = false;
  bounds = original;
  window.emit("leave-full-screen");
  fullscreen = true;
  bounds = secondary.bounds;
  window.emit("enter-full-screen");
  await setImmediate();
  equal(screen.getDisplayMatching(bounds).id, secondary.id);
  deepEqual(toggles, [false, true]);
});
