import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import { compileInline } from "@tk-reawakened/core";
import { formatChanged, formatSource } from "../src/index.ts";

/**
 * The formatter (docs/spec/engine/rpgcode-tooling.md#tool-4): re-indent by brace
 * depth and normalise canonical names to lower case, and nothing else. It is
 * idempotent, behaviour-preserving and leaves comments, strings, label spelling,
 * continuations and the absence of a final newline exactly as they were.
 */

function ops(text: string): string {
  return JSON.stringify(compileInline(text, "<fmt>").ops.map((op) => ({ ...op, pos: undefined })));
}

test("re-indents by brace depth with the default four spaces", () => {
  const source = "function f() {\nx = 1\n}\n";
  equal(formatSource(source).text, "function f() {\n    x = 1\n}\n");
});

test("a custom width applies", () => {
  equal(formatSource("function f() {\nx = 1\n}\n", { indentWidth: 2 }).text, "function f() {\n  x = 1\n}\n");
});

test("canonical names are lower-cased, including pack commands and reserved words", () => {
  const source = "Function f() {\n    IF (TRUE AND NotContains) {\n        RETURN MWin(\"x\")\n    }\n    CLEARBUFFER()\n}\n";
  equal(
    formatSource(source).text,
    "function f() {\n    if (true and NotContains) {\n        return mwin(\"x\")\n    }\n    clearbuffer()\n}\n",
  );
});

test("string contents, comments, label spelling and #include text are untouched", () => {
  const source = '#include "Lib/MyFile.Prg"\nfunction f() {\n    :MyLabel\n    x = "Function MWin"\n    // Function MWin stays\n    y = 1\n}\n';
  equal(formatSource(source).text, source);
});

test("a file without a final newline keeps it that way", () => {
  const source = "function f() {\nx = 1\n}";
  const formatted = formatSource(source).text;
  equal(formatted.endsWith("\n"), false);
  equal(formatted, "function f() {\n    x = 1\n}");
});

test("CRLF endings and a Windows-1252 byte survive, and the result is idempotent", () => {
  const source = 'function f() {\r\nx = MWin("caf\u00e9")\r\n}\r\n';
  const once = formatSource(source).text;
  equal(once.includes("\r\n"), true);
  equal(once.includes('"caf\u00e9"'), true);
  equal(formatSource(once).text, once);
});

test("idempotent on a deliberately messy program", () => {
  const source = "/* block\n   comment */\nFunction F(){\nIF(TRUE){\nRETURN MWin(\"x\")\n}\n}\n";
  const once = formatSource(source).text;
  equal(formatSource(once).text, once);
});

test("behaviour is preserved: the original and the formatted text lower identically", () => {
  const source = "function f() {\n    x = MWin(\"Hi\")\n    IF (TRUE) {\n        RETURN x\n    }\n    CLEARBUFFER()\n}\n";
  const formatted = formatSource(source).text;
  equal(ops(source), ops(formatted));
});

test("formatChanged is the --check answer: 0 nothing to change, 1 otherwise", () => {
  equal(formatChanged("function f() {\n    x = 1\n}\n"), false);
  equal(formatChanged("function f() {\nx = 1\n}\n"), true);
  equal(formatChanged("x = MWin(\"a\")\n"), true);
  ok(formatSource("x = MWin(\"a\")\n").text === 'x = mwin("a")\n');
});

test("a file the scanner cannot read still gets its indentation, not a crash", () => {
  const source = "function f() {\n  @\n}\n";
  equal(formatSource(source).text, "function f() {\n    @\n}\n");
});
