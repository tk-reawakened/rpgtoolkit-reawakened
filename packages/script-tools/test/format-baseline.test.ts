import { deepEqual, equal } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { formatCheck, formatSource } from "../src/index.ts";

/**
 * The formatting baseline (TOOL-7, G5): the `fmt --check` state of the
 * dogfooding set, committed and reviewed like a golden. The 3.1 set is canonical
 * - the rewrite landed as its own reviewable commit (entry 10.13) - so the
 * baseline is empty. The Toolkit 2.x fixtures are **not** in the checked set and
 * are not silently clean either: the formatter refuses them with `tk2-dialect`,
 * and this test asserts that refusal and the unchanged text. Any future commit
 * that introduces non-canonical 3.1 text fails here with the file named.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const baseline = JSON.parse(readFileSync(join(repoRoot, "golden/format-baseline.json"), "utf8")) as {
  readonly checked: readonly string[];
  readonly tk2: readonly string[];
  readonly wouldChange: readonly string[];
};

function programs(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...programs(path));
    else if (entry.name.toLowerCase().endsWith(".prg")) found.push(path);
  }
  return found;
}

function corpus(): string[] {
  return [...programs(join(repoRoot, "stock")), ...programs(join(repoRoot, "packages/core/test/fixtures/authored"))]
    .map((path) => relative(repoRoot, path))
    .sort();
}

test("the dogfooding set is exactly the committed baseline: 49 canonical 3.1 files and 6 TK2 files", () => {
  const all = corpus();
  deepEqual([...baseline.checked, ...baseline.tk2].sort(), all);
  deepEqual(baseline.wouldChange, []);
});

test("every 3.1 file is canonical: formatting would change nothing", () => {
  for (const file of baseline.checked) {
    const source = readFileSync(join(repoRoot, file), "utf8");
    const result = formatSource(source, { dialect: "tk3" });
    equal(result.changed, false, `${file} is canonical`);
  }
});

test("every TK2 file is refused with its reason and returned unchanged, never counted as clean", () => {
  const files = corpus().map((path) => {
    const source = readFileSync(join(repoRoot, path), "utf8");
    return { path, source, dialect: baseline.tk2.includes(path) ? ("tk2" as const) : ("tk3" as const) };
  });
  for (const file of files) {
    if (!baseline.tk2.includes(file.path)) continue;
    const result = formatSource(file.source, { dialect: "tk2" });
    equal(result.text, file.source, `${file.path} is byte-identical`);
    equal(result.skipped, "tk2-dialect");
  }
  const check = formatCheck(files);
  deepEqual(check.changed, []);
  deepEqual(
    check.skipped.map((entry) => entry.path),
    [...baseline.tk2],
  );
});
