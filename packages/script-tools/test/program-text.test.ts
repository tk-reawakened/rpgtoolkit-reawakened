import { deepEqual, equal } from "node:assert/strict";
import test from "node:test";
import { classifyProgram, programBookmarks, publicCommandNames } from "../src/index.ts";

/** TOOL-10 colouring and bookmarks (docs/spec/engine/rpgcode-tooling.md#tool-10). */

function described(source: string): string[] {
  const lines = source.split("\n");
  return classifyProgram(source).map((token) => {
    const text = lines[token.line]!.slice(token.start, token.start + token.length);
    const modifiers = token.modifiers.length === 0 ? "" : `+${token.modifiers.join("+")}`;
    return `${token.line}:${token.type}${modifiers}:${text}`;
  });
}

test("comments of every form, strings, numbers, keywords and built-in calls", () => {
  const source = [
    "// a note",
    "** legacy",
    "* star line",
    'if (x == 1.5e2) { mwin("hi") }',
    "x = 12 // trailing",
  ].join("\n");
  deepEqual(described(source), [
    "0:comment:// a note",
    "1:comment:** legacy",
    "2:comment:* star line",
    "3:keyword:if",
    "3:number:1.5e2",
    "3:function+defaultLibrary:mwin",
    '3:string:"hi"',
    "4:number:12",
    "4:comment:// trailing",
  ]);
});

test("a block comment is split per line and marks its later lines as continuations", () => {
  const tokens = classifyProgram("a = 1 /* one\ntwo */ b = 2\n/* three */");
  deepEqual(
    tokens.filter((token) => token.type === "comment").map((token) => [token.line, token.start, token.length, token.type, token.continuation === true]),
    [
      [0, 6, 6, "comment", false],
      [1, 0, 6, "comment", true],
      [2, 0, 11, "comment", false],
    ],
  );
});

test("an unfinished string and an unclosed block comment are still classified", () => {
  deepEqual(described('x = "oops'), ['0:string:"oops']);
  deepEqual(described("/* never closed\nstill"), ["0:comment:/* never closed", "1:comment:still"]);
});

test("LEX-2: a run that starts with a digit but is not a number is an identifier", () => {
  deepEqual(described("a = 2x + 1e + 3"), ["0:number:3"]);
});

test("members after . and -> are never keywords or commands", () => {
  deepEqual(described("o->if = 1\no.mwin = 2"), ["0:number:1", "1:number:2"]);
});

test("a built-in name is a command only as a call or alone on its line", () => {
  deepEqual(described("end\nx = end\nmwin (\"a\")"), ["0:function+defaultLibrary:end", '2:function+defaultLibrary:mwin', '2:string:"a"']);
});

test("function and method declare a name; labels and #include are classified", () => {
  deepEqual(described('#include "lib.prg"\nfunction Greet(a) {\n:again\n    branch(:again)\n}'), [
    "0:macro:#include",
    '0:string:"lib.prg"',
    "1:keyword:function",
    "1:function+declaration:Greet",
    "2:label::again",
    "3:function+defaultLibrary:branch",
    "3:label::again",
  ]);
});

test("a global marker is not a label, and a Toolkit 2 # prefix leaves the command coloured", () => {
  deepEqual(described(":x = 5"), ["0:number:5"]);
  deepEqual(described("#Mwin(\"Hello\")"), ['0:function+defaultLibrary:Mwin', '0:string:"Hello"']);
});

test("the CR of a CRLF is never part of a token", () => {
  const tokens = classifyProgram("// note\r\nx = 1\r\n");
  deepEqual(tokens.map((token) => [token.line, token.start, token.length]), [[0, 0, 7], [1, 4, 1]]);
});

test("a custom command set replaces the default", () => {
  const tokens = classifyProgram("mwin(1)\nzap(2)", { commandNames: new Set(["zap"]) });
  deepEqual(tokens.filter((token) => token.type === "function").map((token) => token.line), [1]);
  equal(publicCommandNames().has("mwin"), true);
});

test("bookmarks list comments that start their line, skip trailing, ruled and later block lines", () => {
  const source = [
    "// Setup the party",
    "x = 1 // trailing is not a bookmark",
    "//----------",
    "** Second part",
    "* Third",
    "/* A block",
    "   continues here */",
    "/**/",
    "    // indented",
  ].join("\n");
  deepEqual(
    programBookmarks(source).map((bookmark) => [bookmark.line, bookmark.name]),
    [[0, "Setup the party"], [3, "Second part"], [4, "Third"], [5, "A block"], [8, "indented"]],
  );
});

test("#2782 only a whitespace-preceded final underscore continues the line", () => {
  for (const source of ["x = 1+_\n* comment", "x = 1 _;\n* comment", "x = 1 _ ** trailing\n* comment"]) {
    equal(classifyProgram(source).filter((token) => token.line === 1 && token.type === "comment").length, 1);
    equal(programBookmarks(source).at(-1)?.name, "comment");
  }
  for (const source of ["x = 1 _\n* comment", "x = 1 _ // trailing\n* comment"]) {
    equal(classifyProgram(source).filter((token) => token.line === 1 && token.type === "comment").length, 0);
  }
});

test("#2783 destructor declarations retain method-name colouring", () => {
  deepEqual(described("method ~Thing() {}"), ["0:keyword:method", "0:function+declaration:~Thing"]);
  deepEqual(described("x = ~Thing()"), []);
});
