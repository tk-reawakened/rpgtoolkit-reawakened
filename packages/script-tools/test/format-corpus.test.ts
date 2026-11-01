import { deepEqual, equal, ok } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compileInline, compileTk2, ScriptError } from "@tk-reawakened/core";
import { formatSource } from "../src/index.ts";

/**
 * The formatter over the **committed** corpus (stock plus the authored 3.1
 * fixtures): idempotent, and the original and formatted text lower to the same
 * instruction array (positions ignored). It reads only files in the repository,
 * so this shard needs no network fetch; the fetched `fixtures/legacy` sweep runs
 * in `fixtures:test`, where the tree exists.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

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

const TK2 = new Set(["battle-action-wait.prg", "battle-loop.prg", "battle-outcome-levelup.prg", "battle-status-wait.prg", "program-call-error.prg", "program-call-wait.prg"]);

function committed(): { readonly path: string; readonly source: string; readonly dialect: "tk3" | "tk2" }[] {
  const files = [...programs(join(repoRoot, "stock")), ...programs(join(repoRoot, "packages/core/test/fixtures/authored"))].sort();
  return files.map((path) => ({
    path: relative(repoRoot, path),
    source: readFileSync(path, "utf8"),
    dialect: TK2.has(path.split("/").pop() ?? "") ? "tk2" : "tk3",
  }));
}

test("the committed corpus formats idempotently and preserves every program that compiles", () => {
  let compared = 0;
  const mismatched: string[] = [];
  for (const file of committed()) {
    if (file.dialect === "tk2") continue;
    const once = formatSource(file.source, { dialect: "tk3" }).text;
    equal(formatSource(once, { dialect: "tk3" }).text, once, `${file.path} is idempotent`);
    const before = lowered(file.source);
    if (before === null) continue;
    const after = lowered(once);
    if (after === null) {
      mismatched.push(`${file.path}: the formatted text no longer compiles`);
      continue;
    }
    if (before !== after) mismatched.push(`${file.path}: lowering changed`);
    compared += 1;
  }
  ok(compared > 0, "at least one committed program compiled both before and after");
  deepEqual(mismatched, []);
});

test("the authored files the rewrite made canonical report no change", () => {
  for (const name of ["battle-actions.prg", "battle-ai.prg"]) {
    const source = readFileSync(join(repoRoot, "packages/core/test/fixtures/authored", name), "utf8");
    equal(formatSource(source, { dialect: "tk3" }).changed, false, `${name} is canonical`);
  }
});

test("the formatter's output for a committed 3.1 file compiles", () => {
  const text = formatSource(readFileSync(join(repoRoot, "stock/stock_rpg/startup.prg"), "utf8"), { dialect: "tk3" }).text;
  ok(compileInline(text).ops.length > 0);
});
