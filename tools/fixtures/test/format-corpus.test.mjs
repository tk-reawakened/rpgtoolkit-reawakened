// The formatter over the fetched corpus (TOOL-4, TOOL-7). This runs in the checks
// job after `pnpm fixtures:fetch`, never in a unit shard: the tree is fetched, not
// committed. Every program formats to byte-identical text on a second run, and the
// original and formatted text lower to the same instructions (positions ignored)
// wherever the original compiles. Two named rewrites prove the comparison is not
// vacuous.
import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const core = await import(`${root}/packages/core/dist/index.js`);
const tools = await import(`${root}/packages/script-tools/dist/index.js`);

function programs(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...programs(path));
    else if (entry.name.toLowerCase().endsWith(".prg")) found.push(path);
  }
  return found;
}

function lowered(text) {
  try {
    return JSON.stringify(core.compileTk2(text).ops.map((op) => ({ ...op, pos: undefined })));
  } catch {
    return null;
  }
}

test("the fetched corpus formats idempotently and preserves every program that compiles", () => {
  const files = programs(join(root, "fixtures", "legacy"));
  ok(files.length > 0, "the corpus is fetched");
  let compared = 0;
  const mismatched = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const once = tools.formatSource(source, { dialect: "tk3" }).text;
    equal(tools.formatSource(once, { dialect: "tk3" }).text, once, `${relative(root, file)} is idempotent`);
    const before = lowered(source);
    if (before === null) continue;
    const after = lowered(once);
    if (after === null) mismatched.push(`${relative(root, file)}: formatted text no longer compiles`);
    else if (before !== after) mismatched.push(`${relative(root, file)}: lowering changed`);
    compared += 1;
  }
  ok(compared > 0, "at least one corpus program compiled both before and after");
  deepEqual(mismatched, []);
});

test("the comparison runs against real rewrites, not no-ops", () => {
  let changed = 0;
  for (const name of ["ChimeranEmpire/Prg/Blacksmith.prg", "ChimeranEmpire/Prg/Project.prg"]) {
    const file = join(root, "fixtures", "legacy", name);
    const source = readFileSync(file, "utf8");
    const formatted = tools.formatSource(source, { dialect: "tk3" }).text;
    ok(formatted !== source, `${name} is actually rewritten`);
    equal(lowered(source), lowered(formatted), `${name} lowers identically`);
    changed += 1;
  }
  equal(changed, 2);
});
