import assert from "node:assert/strict";
import test from "node:test";
import { parseCreatorTestsBridgeRequest } from "../src/creator-tests-bridge.ts";

const nonce = "a".repeat(36);
const id = "b".repeat(24);

function request(method: string, args: unknown[]): unknown {
  return { type: "creator-tests:request", nonce, id, method, args };
}

test("the correlated bridge accepts an exact three-argument source request", () => {
  assert.deepEqual(parseCreatorTestsBridgeRequest(request("openSource", [".tkr-tests/Prg/wall.spec.prg", 11, 37]), nonce), {
    id,
    method: "openSource",
    args: [".tkr-tests/Prg/wall.spec.prg", 11, 37],
  });
});

test("the bridge rejects nested, incomplete, extra, and out-of-project source requests", () => {
  for (const args of [
    [[".tkr-tests/Prg/wall.spec.prg", 11, 37]],
    [".tkr-tests/Prg/wall.spec.prg", 11],
    [".tkr-tests/Prg/wall.spec.prg", 11, 37, "extra"],
    ["../outside.prg", 11, 37],
    [".tkr-tests/Prg/wall.spec.prg", 0, 37],
  ]) {
    assert.deepEqual(parseCreatorTestsBridgeRequest(request("openSource", args), nonce), { id, method: "invalid", args: [] });
  }
});

test("the bridge accepts only the single validated run payload", () => {
  assert.deepEqual(parseCreatorTestsBridgeRequest(request("run", [{ seed: 7, name: "case" }]), nonce), {
    id,
    method: "run",
    args: [{ seed: 7, name: "case" }],
  });
  assert.deepEqual(parseCreatorTestsBridgeRequest(request("run", [{ seed: 7, name: "case" }, "extra"]), nonce), { id, method: "invalid", args: [] });
});
