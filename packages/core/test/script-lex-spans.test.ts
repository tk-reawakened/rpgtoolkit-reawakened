import { deepEqual, equal } from "node:assert/strict";
import test from "node:test";
import { tokenize } from "../src/index.ts";

/**
 * The token span convention (docs/spec/engine/rpgcode-tooling.md#tool-3):
 * `col` and `endCol` are UTF-16 code units of the decoded source, 1-based and
 * inclusive, a token never spans a line, and a zero-width token has
 * `endCol === col`. The CR of a CRLF does not count, because it precedes the
 * line break. These tests pin the convention on the cases that would expose a
 * byte-based or code-point-based reading.
 */

function spans(text: string): Array<[string, number, number, number]> {
  return tokenize(text).map((token) => [token.kind, token.line, token.col, token.endCol]);
}

test("columns are 1-based and inclusive, one statement per line", () => {
  deepEqual(spans("x = 1\n"), [
    ["identifier", 1, 1, 1],
    ["op", 1, 3, 3],
    ["number", 1, 5, 5],
    ["end", 1, 6, 6],
    ["eof", 2, 1, 1],
  ]);
});

test("a tab counts as one column, not as a stop of four or eight", () => {
  const tokens = tokenize("\tx = 1\n");
  equal(tokens[0]?.col, 2);
  equal(tokens[1]?.col, 4);
});

test("a CRLF file places the next line's first token at column 1, the CR not counted", () => {
  const tokens = tokenize("x = 1\r\ny = 2\r\n");
  const secondLine = tokens.filter((token) => token.line === 2);
  equal(secondLine[0]?.kind, "identifier");
  equal(secondLine[0]?.col, 1);
  equal(secondLine[0]?.endCol, 1);
  equal(secondLine[2]?.col, 5);
});

test("a Windows-1252 byte is one column: the decoded string is UTF-16 code units", () => {
  // `"caf\u00e9"` is the decoded form of a Win-1252 `0xE9`; one code unit, one column.
  const tokens = tokenize('mwin("caf\u00e9")\n');
  const text = tokens.find((token) => token.kind === "string");
  equal(text?.col, 6);
  equal(text?.endCol, 11);
  // A supplementary-plane character is two code units, so it advances the column by two.
  const astral = tokenize('mwin("\u{1F600}")\n');
  const emoji = astral.find((token) => token.kind === "string");
  equal(emoji?.col, 6);
  equal(emoji?.endCol, 9);
});

test("a string token includes both quotes and never its trailing content", () => {
  const tokens = tokenize('  "ab" x\n');
  equal(tokens[0]?.kind, "string");
  equal(tokens[0]?.col, 3);
  equal(tokens[0]?.endCol, 6);
  equal(tokens[1]?.col, 8);
});

test("a type sigil belongs to the identifier's span", () => {
  const tokens = tokenize("name$ = x!\n");
  equal(tokens[0]?.kind, "identifier");
  equal(tokens[0]?.col, 1);
  equal(tokens[0]?.endCol, 5);
  equal(tokens[2]?.col, 9);
  equal(tokens[2]?.endCol, 10);
});

test("multi-character operators span their whole text", () => {
  deepEqual(spans("a <= b\n").slice(1, 3), [
    ["op", 1, 3, 4],
    ["identifier", 1, 6, 6],
  ]);
  deepEqual(spans("a == b\n").slice(1, 3), [
    ["op", 1, 3, 4],
    ["identifier", 1, 6, 6],
  ]);
});

test("a continued line's tokens are measured against the continued line", () => {
  const tokens = tokenize("if (a _\n  && b) { }\n");
  const and = tokens.find((token) => token.kind === "op" && token.text === "&&");
  equal(and?.line, 2);
  equal(and?.col, 3);
  equal(and?.endCol, 4);
});

test("comments leave no token, and the token after one keeps its column", () => {
  const tokens = tokenize("x = 1 // trailing comment\n/* block\ncomment */ y = 2\n");
  const y = tokens.filter((token) => token.kind === "identifier")[1];
  equal(y?.line, 3);
  equal(y?.col, 12);
});

test("a semicolon end token is one column wide, a newline end token is zero wide", () => {
  const tokens = tokenize("x;y\n");
  const ends = tokens.filter((token) => token.kind === "end");
  equal(ends[0]?.col, 2);
  equal(ends[0]?.endCol, 2);
  equal(ends[1]?.col, 4);
  equal(ends[1]?.endCol, 4);
});

test("slicing the source with a token's span yields exactly that token's text", () => {
  const text = "\tx <<= \"a b\" // note\n  name$ = 1\n";
  const lines = text.split("\n");
  for (const token of tokenize(text)) {
    if (token.kind === "end" || token.kind === "eof") continue;
    const sliced = (lines[token.line - 1] ?? "").slice(token.col - 1, token.endCol);
    switch (token.kind) {
      case "identifier":
        equal(sliced, token.name === "name" ? "name$" : token.name);
        break;
      case "op":
        equal(sliced, token.text);
        break;
      case "number":
        equal(Number(sliced), token.value);
        break;
      case "string":
        equal(sliced, `"${token.value}"`);
        break;
    }
  }
});
