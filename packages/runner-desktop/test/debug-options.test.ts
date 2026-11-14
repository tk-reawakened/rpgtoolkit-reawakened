import { deepEqual, throws } from "node:assert/strict";
import { test } from "node:test";
import { parseDesktopDebugOptions } from "../src/debug-options.ts";

test("desktop debug options retain project defaults unless an override is requested", () => {
  deepEqual(parseDesktopDebugOptions([]), { drawVectorsFlags: null, pathColor: null, forceFps: false, diagnostics: false });
  deepEqual(parseDesktopDebugOptions(["--debug", "board,path", "--debug-sprites", "--debug-colour", "#0a14FF", "--fps"]), {
    drawVectorsFlags: 7, pathColor: { r: 10, g: 20, b: 255 }, forceFps: true, diagnostics: false,
  });
  deepEqual(parseDesktopDebugOptions(["--debug", "board", "--debug", "path", "--debug-colour", "#ffffff", "--debug-colour", "#0a14ff"]), {
    drawVectorsFlags: 5, pathColor: { r: 10, g: 20, b: 255 }, forceFps: false, diagnostics: false,
  });
});

test("desktop debug options reject malformed selections and colours", () => {
  throws(() => parseDesktopDebugOptions(["--debug"]), /--debug requires/);
  throws(() => parseDesktopDebugOptions(["--debug", "board,unknown"]), /Unknown --debug overlay/);
  throws(() => parseDesktopDebugOptions(["--debug-colour", "red"]), /--debug-colour requires/);
  throws(() => parseDesktopDebugOptions(["--debug-colour"]), /--debug-colour requires/);
  throws(() => parseDesktopDebugOptions(["--debug", "board", "--debug", "unknown"]), /Unknown --debug overlay/);
  throws(() => parseDesktopDebugOptions(["--debug-colour", "#ffffff", "--debug-colour"]), /--debug-colour requires/);
});
