import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import { analyse, rangeOf, sliceRange } from "../src/index.ts";

/**
 * `analyse()` is the TOOL-3 diagnostic entry (docs/spec/engine/rpgcode-tooling.md#tool-3):
 * it compiles the buffer through the core compiler, and an invalid buffer yields
 * one diagnostic whose range slices exactly the token the compiler named.
 */

test("a valid program analyses clean", () => {
  const analysis = analyse("greeting = \"hi\"\r\nmwin(greeting)\r\n", { file: "startup.prg" });
  equal(analysis.file, "startup.prg");
  equal(analysis.ok, true);
  deepEqual(analysis.diagnostics, []);
});

test("the compiler's object dialect is what analyse reads, so a class program is valid", () => {
  const source = "class counter {\n  public:\n  var value\n  method bump() {\n    this->value = this->value + 1\n  }\n}\n";
  const analysis = analyse(source, { file: "objects.prg" });
  equal(analysis.ok, true, JSON.stringify(analysis.diagnostics));
});

test("a syntax error names the token, and the range slices it exactly", () => {
  const source = "x = 1\r\nx = )\r\n";
  const analysis = analyse(source, { file: "broken.prg" });
  equal(analysis.ok, false);
  equal(analysis.diagnostics.length, 1);
  const [diagnostic] = analysis.diagnostics;
  ok(diagnostic);
  equal(diagnostic.code, "syntax.error");
  equal(diagnostic.severity, "error");
  deepEqual(diagnostic.range, { start: { line: 2, column: 5 }, end: { line: 2, column: 5 } });
  equal(sliceRange(source, diagnostic.range), ")");
  equal(diagnostic.rule, undefined);
  equal(diagnostic.fix, undefined);
  equal(typeof diagnostic.message, "string");
});

test("a lexical error after a tab, a CRLF and a Windows-1252 byte still slices the offending character", () => {
  const source = 'mwin("caf\u00e9")\r\n\tx = \u00a7\r\n';
  const analysis = analyse(source);
  const [diagnostic] = analysis.diagnostics;
  ok(diagnostic);
  equal(diagnostic.code, "syntax.error");
  deepEqual(diagnostic.range, { start: { line: 2, column: 6 }, end: { line: 2, column: 6 } });
  equal(sliceRange(source, diagnostic.range), "\u00a7");
});

test("a compile error is reported at its own token too", () => {
  const source = "method nowhere::thing() {\n}\n";
  const analysis = analyse(source);
  const [diagnostic] = analysis.diagnostics;
  ok(diagnostic);
  equal(diagnostic.code, "compile.unknown-class");
  equal(sliceRange(source, diagnostic.range), "thing");
});

test("a diagnostic with no token behind it falls back to the whole line, CR not counted", () => {
  const source = "abc\r\n";
  deepEqual(rangeOf({ file: "x.prg", line: 1 }, source), {
    start: { line: 1, column: 1 },
    end: { line: 1, column: 3 },
  });
  equal(sliceRange(source, rangeOf({ file: "x.prg", line: 1 }, source)), "abc");
});

test("a span-bearing position maps to its inclusive token range", () => {
  const source = '\tmwin("x")\n';
  const range = rangeOf({ file: "x.prg", line: 1, col: 2, endCol: 5 }, source);
  deepEqual(range, { start: { line: 1, column: 2 }, end: { line: 1, column: 5 } });
  equal(sliceRange(source, range), "mwin");
});

test("a zero-width range slices nothing, as TOOL-3 states", () => {
  const source = "x = 1\n";
  equal(sliceRange(source, { start: { line: 1, column: 6 }, end: { line: 1, column: 6 } }), "");
});
