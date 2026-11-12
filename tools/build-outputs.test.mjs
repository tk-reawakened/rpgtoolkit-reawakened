import assert from "node:assert/strict";
import test from "node:test";
import { assertNoBuildOutputCollisions, findBuildOutputCollisions, HOST_BUILD_OUTPUTS, hostBuildOutput } from "./build-outputs.mjs";

test("declared browser, desktop, and mobile artifacts do not collide", () => {
  assert.deepEqual(findBuildOutputCollisions(), []);
  assert.doesNotThrow(() => assertNoBuildOutputCollisions());
  assert.equal(hostBuildOutput("/repo", "desktop", "audio-worklet.js"), "/repo/apps/desktop/audio-worklet.js");
  for (const outputs of Object.values(HOST_BUILD_OUTPUTS)) {
    assert.equal(new Set(outputs).size, outputs.length, "a host must not declare one output twice");
  }
});

test("the output check reports a path claimed by separate hosts", () => {
  const outputs = {
    browser: ["apps/browser/audio-worklet.js"],
    desktop: ["apps/browser/audio-worklet.js"],
  };
  assert.deepEqual(findBuildOutputCollisions(outputs), [
    { path: "apps/browser/audio-worklet.js", hosts: ["browser", "desktop"] },
  ]);
  assert.throws(() => assertNoBuildOutputCollisions(outputs), /apps\/browser\/audio-worklet\.js \(browser, desktop\)/);
});

test("a builder cannot write an undeclared host artifact", () => {
  assert.throws(() => hostBuildOutput("/repo", "mobile", "audio-worklet-desktop.js"), /not declared/);
});
