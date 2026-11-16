import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { createDiagnosticsMode, diagnosticsRequested, exposeDiagnosticsMode, isDiagnosticsToggle, type DiagnosticsHook } from "../src/diagnostics-mode.ts";

// docs/spec/engine/runners.md#diagnostics-mode: off by default, on by flag, F3 toggles, tooling can switch it.

test("diagnostics mode is off unless the address asks for it", () => {
  equal(diagnosticsRequested(""), false);
  equal(diagnosticsRequested("?package=fixtures/packages/demo.tpk"), false);
  for (const search of ["?diagnostics", "?diagnostics=1", "?diagnostics=on", "?a=1&diagnostics=TRUE"]) equal(diagnosticsRequested(search), true, search);
  for (const search of ["?diagnostics=0", "?diagnostics=false", "?diagnostics=OFF"]) equal(diagnosticsRequested(search), false, search);
});

test("F3 is the toggle and no other key is", () => {
  equal(isDiagnosticsToggle({ code: "F3" }), true);
  equal(isDiagnosticsToggle({ code: "KeyD" }), false);
  equal(isDiagnosticsToggle({ code: "F2" }), false);
});

test("listeners run on a change only, and can stop listening", () => {
  const mode = createDiagnosticsMode(false);
  const seen: boolean[] = [];
  const stop = mode.onChange((on) => seen.push(on));
  mode.set(false);
  mode.toggle();
  mode.set(true);
  mode.toggle();
  stop();
  mode.toggle();
  deepEqual(seen, [true, false]);
  equal(mode.on(), true);
});

test("tooling switches the mode through the page hook, and removing the hook leaves another page's hook alone", () => {
  const mode = createDiagnosticsMode(false);
  const target: { __tkrDiagnostics?: DiagnosticsHook } = {};
  const remove = exposeDiagnosticsMode(mode, target);
  equal(target.__tkrDiagnostics?.(), false);
  equal(target.__tkrDiagnostics?.(true), true);
  equal(mode.on(), true);
  equal(target.__tkrDiagnostics?.(false), false);
  const replacement: DiagnosticsHook = () => true;
  target.__tkrDiagnostics = replacement;
  remove();
  equal(target.__tkrDiagnostics, replacement);
});
