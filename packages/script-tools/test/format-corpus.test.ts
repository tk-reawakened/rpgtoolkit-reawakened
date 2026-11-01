import { deepEqual, equal, ok } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compileInline, compileTk2, ScriptError } from "@tk-reawakened/core";
import { formatSource } from "../src/index.ts";

/**
 * The formatter over the fetched corpus (TOOL-4, TOOL-7): every program formats
 * to byte-identical text on a second run, and the original and formatted text
 * lower to the same instruction array (positions ignored) wherever the original
 * compiles. A file that differs is a formatter bug, not an exclusion.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const corpus = join(repoRoot, "fixtures", "legacy");

function programs(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...programs(path));
    else if (entry.name.toLowerCase().endsWith(".prg")) found.push(path);
  }
  return found;
}

function lowered(text: string): string | null {
  try {
    return JSON.stringify(compileTk2(text).ops.map((op) => ({ ...op, pos: undefined })));
  } catch (error) {
    if (error instanceof ScriptError) return null;
    throw error;
  }
}

test("the corpus rewrites are real, not no-ops: two named files change and still lower identically", () => {
  const named = ["fixtures/legacy/ChimeranEmpire/Prg/Blacksmith.prg", "fixtures/legacy/ChimeranEmpire/Prg/Project.prg"];
  for (const file of named) {
    const source = readFileSync(join(repoRoot, file), "utf8");
    const formatted = formatSource(source).text;
    ok(formatted !== source, `${file} is actually rewritten`);
    const before = lowered(source);
    const after = lowered(formatted);
    ok(before !== null && after !== null, `${file} compiles before and after`);
    equal(before, after, `${file} lowers identically`);
  }
});

test("the fetched corpus formats idempotently and preserves every program that compiles", () => {
  const files = programs(corpus);
  ok(files.length > 0, `the corpus is fetched under ${relative(repoRoot, corpus)}`);
  let compared = 0;
  const mismatched: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const once = formatSource(source).text;
    equal(formatSource(once).text, once, `${relative(repoRoot, file)} is idempotent`);
    const before = lowered(source);
    if (before === null) continue;
    const after = lowered(once);
    if (after === null) {
      mismatched.push(`${relative(repoRoot, file)}: the formatted text no longer compiles`);
      continue;
    }
    if (before !== after) mismatched.push(`${relative(repoRoot, file)}: lowering changed`);
    compared += 1;
  }
  equal(compared > 0, true, "at least one corpus program compiled both before and after");
  deepEqual(mismatched, []);
});
