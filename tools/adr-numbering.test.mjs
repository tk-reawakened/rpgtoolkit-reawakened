import assert from "node:assert/strict";
import test from "node:test";
import { findDuplicateAdrNumbers } from "./adr-numbering.mjs";

test("different ADR filenames cannot reuse a numeric prefix", () => {
  assert.deepEqual(
    findDuplicateAdrNumbers(["0012-first-decision.md", "12-second-decision.md"]),
    [{ number: "12", filenames: ["0012-first-decision.md", "12-second-decision.md"] }],
  );
});

test("distinct ADR numbers pass without reporting duplicates", () => {
  assert.deepEqual(
    findDuplicateAdrNumbers(["0012-first-decision.md", "0013-second-decision.md"]),
    [],
  );
});
