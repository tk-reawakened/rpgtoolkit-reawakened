import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkAdrNumbering, findDuplicateAdrNumbers } from "./adr-numbering.mjs";

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

function withAdrDirectory(files, run) {
  const directory = mkdtempSync(join(tmpdir(), "adr-numbering-"));
  try {
    for (const filename of files) writeFileSync(join(directory, filename), "");
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("filesystem check rejects duplicate ADR numbers", () => {
  withAdrDirectory(["0012-first-decision.md", "12-second-decision.md"], (directory) => {
    assert.throws(() => checkAdrNumbering(directory), /Duplicate numeric ADR prefixes/);
  });
});

test("filesystem check accepts distinct ADR numbers", () => {
  withAdrDirectory(["0012-first-decision.md", "0013-second-decision.md"], (directory) => {
    assert.doesNotThrow(() => checkAdrNumbering(directory));
  });
});
