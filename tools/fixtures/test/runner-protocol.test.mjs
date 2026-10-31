import { test } from "node:test";
import { deepEqual } from "node:assert/strict";
import { check } from "../runner-protocol/generate.mjs";

test("runner protocol vectors are reproducible in check mode", () => {
  deepEqual(check(), []);
});
