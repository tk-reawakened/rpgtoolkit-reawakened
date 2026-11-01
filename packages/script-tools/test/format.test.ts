import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import { compileInline } from "@tk-reawakened/core";
import { formatChanged, formatCheck, formatSource } from "../src/index.ts";

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
  equal(formatSource(source, { dialect: "tk3" }).text, "function f() {\n    x = 1\n}\n");
});

test("a custom width applies", () => {
  equal(formatSource("function f() {\nx = 1\n}\n", { dialect: "tk3", indentWidth: 2 }).text, "function f() {\n  x = 1\n}\n");
});

test("canonical names are lower-cased, including pack commands and reserved words", () => {
  const source = "Function f() {\n    IF (TRUE AND NotContains) {\n        RETURN MWin(\"x\")\n    }\n    CLEARBUFFER()\n}\n";
  equal(
    formatSource(source, { dialect: "tk3" }).text,
    "function f() {\n    if (true and NotContains) {\n        return mwin(\"x\")\n    }\n    clearbuffer()\n}\n",
  );
});

test("string contents, comments, label spelling and #include text are untouched", () => {
  const source = '#include "Lib/MyFile.Prg"\nfunction f() {\n    :MyLabel\n    x = "Function MWin"\n    // Function MWin stays\n    y = 1\n}\n';
  equal(formatSource(source, { dialect: "tk3" }).text, source);
});

test("a file without a final newline keeps it that way", () => {
  const source = "function f() {\nx = 1\n}";
  const formatted = formatSource(source, { dialect: "tk3" }).text;
  equal(formatted.endsWith("\n"), false);
  equal(formatted, "function f() {\n    x = 1\n}");
});

test("CRLF endings and a Windows-1252 byte survive, and the result is idempotent", () => {
  const source = 'function f() {\r\nx = MWin("caf\u00e9")\r\n}\r\n';
  const once = formatSource(source, { dialect: "tk3" }).text;
  equal(once.includes("\r\n"), true);
  equal(once.includes('"caf\u00e9"'), true);
  equal(formatSource(once, { dialect: "tk3" }).text, once);
});

test("idempotent on a deliberately messy program", () => {
  const source = "/* block\n   comment */\nFunction F(){\nIF(TRUE){\nRETURN MWin(\"x\")\n}\n}\n";
  const once = formatSource(source, { dialect: "tk3" }).text;
  equal(formatSource(once, { dialect: "tk3" }).text, once);
});

test("behaviour is preserved: the original and the formatted text lower identically", () => {
  const source = "function f() {\n    x = MWin(\"Hi\")\n    IF (TRUE) {\n        RETURN x\n    }\n    CLEARBUFFER()\n}\n";
  const formatted = formatSource(source, { dialect: "tk3" }).text;
  equal(ops(source), ops(formatted));
});

test("formatChanged is the --check answer: 0 nothing to change, 1 otherwise", () => {
  equal(formatChanged("function f() {\n    x = 1\n}\n", { dialect: "tk3" }), false);
  equal(formatChanged("function f() {\nx = 1\n}\n", { dialect: "tk3" }), true);
  equal(formatChanged("x = MWin(\"a\")\n", { dialect: "tk3" }), true);
  ok(formatSource("x = MWin(\"a\")\n", { dialect: "tk3" }).text === 'x = mwin("a")\n');
});

test("a file the scanner cannot read still gets its indentation, not a crash", () => {
  const source = "function f() {\n  @\n}\n";
  equal(formatSource(source, { dialect: "tk3" }).text, "function f() {\n    @\n}\n");
});

test("a TK2 file is returned unchanged with an explicit skip reason, never as formatted", () => {
  const source = "Hello there\nthreadSleep(getThreadId(), 0.05)\n";
  const result = formatSource(source, { dialect: "tk2" });
  equal(result.text, source, "byte-identical");
  equal(result.changed, false);
  equal(result.skipped, "tk2-dialect");
  equal(formatChanged(source, { dialect: "tk2" }), false);
});

test("a bulk --check reports skipped files with their reason, never as clean", () => {
  const check = formatCheck([
    { path: "clean.prg", source: "function f() {\n    x = 1\n}\n", dialect: "tk3" },
    { path: "messy.prg", source: "function f() {\nx = 1\n}\n", dialect: "tk3" },
    { path: "legacy.prg", source: "Hello there\n", dialect: "tk2" },
  ]);
  deepEqual(check.changed, ["messy.prg"]);
  deepEqual(check.skipped, [{ path: "legacy.prg", reason: "tk2-dialect" }]);
});
