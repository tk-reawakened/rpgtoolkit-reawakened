import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import { compileInline, compileTk2 } from "@tk-reawakened/core";
import { analyse, applyEdits, legacyFixes, sameLowering, DIAGNOSTIC_ONLY_ROWS } from "../src/index.ts";

/**
 * The legacy quick fixes (docs/spec/engine/rpgcode-dialects.md:57-69). Each one
 * is a span edit over the source, re-parsed after the fix, and the four that are
 * rewrites of the same program are proved by the TK2 frontend lowering both the
 * original and the fixed text to the identical instruction array - identical ops
 * mean identical behaviour for every input (G3 determinism).
 */

function fixFor(source: string, rule: string): { readonly text: string; readonly ops: readonly unknown[] } {
  const fix = legacyFixes(source).find((item) => item.rule === rule);
  ok(fix, `${rule} offered for ${JSON.stringify(source)}; got ${JSON.stringify(legacyFixes(source).map((item) => item.rule))}`);
  const text = applyEdits(source, fix.edits);
  equal(analyse(text).ok, true, `the fixed program compiles: ${JSON.stringify(text)}`);
  return { text, ops: compileInline(text, "<tk2>").ops };
}

test("unquoted #Mwin argument becomes a quoted 3.1 call, with the same lowering", () => {
  const source = "#Mwin(Hello there)";
  const { text, ops } = fixFor(source, "dialect/unquoted-command-argument");
  equal(text, 'mwin("Hello there")');
  equal(sameLowering(source, text), true, "the TK2 reading and the fixed 3.1 reading lower the same");
  ok(ops.length > 0);
});

test("#ReturnMethod(x) becomes `return x`, with the same lowering", () => {
  const source = "function f() {\n  #ReturnMethod(1 + 2)\n}";
  const { text, ops } = fixFor(source, "dialect/return-method");
  equal(text, "function f() {\n  return 1 + 2\n}");
  equal(sameLowering(source, text), true, "the TK2 reading and the fixed 3.1 reading lower the same");
  ok(ops.length > 0);
});

test("an obsolete # control line is removed", () => {
  const source = "#Dos\nx = 1";
  const fix = legacyFixes(source).find((item) => item.rule === "dialect/obsolete-control");
  ok(fix);
  equal(applyEdits(source, fix.edits), "\nx = 1");
  equal(analyse(applyEdits(source, fix.edits)).ok, true);
});

test("an ignored sigil is dropped, with the same lowering", () => {
  const source = "x! = 1\nname$ = \"a\"";
  const fixes = legacyFixes(source).filter((item) => item.rule === "dialect/sigil");
  equal(fixes.length, 2);
  const fixed = applyEdits(source, fixes.flatMap((item) => [...item.edits]));
  equal(fixed, 'x = 1\nname = "a"');
  equal(sameLowering(source, fixed), true);
});

test("a fix that would leave a syntax error is not offered", () => {
  // `#Mwin` with an argument that would not survive quoting is still quoted; an
  // otherwise broken program keeps only the edits that leave it compiling.
  const fixes = legacyFixes("x = )\n#Dos");
  deepEqual(fixes.map((fix) => fix.rule), []);
});

test("the rows whose rewrite would change behaviour are diagnostic-only", () => {
  deepEqual([...DIAGNOSTIC_ONLY_ROWS], ["if (x = 5)", "m[key]", "loose text lines"]);
  for (const source of ["if (x = 5) {\n  y = 1\n}", "m[key] = 1", "Hello there"]) {
    deepEqual(legacyFixes(source).map((fix) => fix.rule), [], source);
  }
});
