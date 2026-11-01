import { deepEqual } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { formatSource } from "../src/index.ts";

/**
 * The formatting baseline (TOOL-7, G5): the `fmt --check` state of the
 * dogfooding set, committed and reviewed like a golden. The set is not yet
 * canonical - the corpus was authored before the formatter - and every file that
 * would change is recorded with its reason rather than silently rewritten.
 * Applying the rewrite is a separate, reviewable corpus change; this baseline's
 * job is to detect drift between the two.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const baseline = JSON.parse(readFileSync(join(repoRoot, "golden/format-baseline.json"), "utf8")) as {
  readonly checked: readonly string[];
  readonly wouldChange: readonly { readonly file: string; readonly reasons: readonly string[] }[];
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

function record(): { readonly checked: string[]; readonly wouldChange: { readonly file: string; readonly reasons: string[] }[] } {
  const files = [...programs(join(repoRoot, "stock")), ...programs(join(repoRoot, "packages/core/test/fixtures/authored"))]
    .map((path) => relative(repoRoot, path))
    .sort();
  const checked: string[] = [];
  const wouldChange: { readonly file: string; readonly reasons: string[] }[] = [];
  for (const file of files) {
    const source = readFileSync(join(repoRoot, file), "utf8");
    const { text, changed } = formatSource(source);
    checked.push(file);
    if (!changed) continue;
    const before = source.split("\n");
    const after = text.split("\n");
    const reasons = new Set<string>();
    for (let line = 0; line < Math.max(before.length, after.length); line += 1) {
      if (before[line] === after[line]) continue;
      if ((before[line] ?? "").trimStart() === (after[line] ?? "").trimStart()) reasons.add("indentation (brace depth, four spaces)");
      else reasons.add("canonical lower-case spelling of a registered command");
    }
    wouldChange.push({ file, reasons: [...reasons] });
  }
  return { checked, wouldChange };
}

test("the dogfooding set is exactly the committed formatting baseline", () => {
  deepEqual(record(), baseline);
});
