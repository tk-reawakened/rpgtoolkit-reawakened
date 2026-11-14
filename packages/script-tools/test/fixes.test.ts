import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import { advanceScriptTick, compileInline, createGameState, createScriptServices, startProgram, UI_PLUGIN, type ScriptDialect } from "@tk-reawakened/core";
import { applyEdits, legacyFixes, sameLowering, tk2ConversionRefusal } from "../src/index.ts";

function migrate(source: string): string {
  const actions = legacyFixes(source, "tk2");
  equal(actions.length, 1, `one atomic migration for ${JSON.stringify(source)}`);
  equal(actions[0]!.rule, "dialect/tk2-to-tk3");
  const fixed = applyEdits(source, actions[0]!.edits);
  equal(sameLowering(source, fixed), true, `${source} keeps its behavior`);
  return fixed;
}

test("Toolkit 2 migration retains argument boundaries and values", () => {
  equal(migrate("#threadSleep(1, 2)"), "threadSleep(1, 2)");
  equal(migrate("#Mwin(hello, world)"), 'Mwin("hello", "world")');
  equal(migrate("#Mwin(Hello there)"), 'Mwin("Hello there")');
  equal(migrate("#Mwin(name$)"), "Mwin(name)");
  equal(sameLowering("#threadSleep(1, 2)", 'threadsleep("1, 2")'), false);
  equal(sameLowering("#Mwin(hello, world)", 'mwin("hello, world")'), false);
});

test("migration preserves the values seen by real UI commands", () => {
  const source = '#name$ = "Ada"\n#score! = 3\n#Mwin(name$)\n#Mwin(score! ^ 2)\n#Mwin(Hello there!)';
  const fixed = migrate(source);
  const effects = (text: string, dialect: ScriptDialect): unknown[] => {
    const program = compileInline(text, "<migration>", dialect);
    const state = createGameState({ seed: 0 });
    startProgram(state.vm, program.ref);
    advanceScriptTick(state, createScriptServices(state, [{ definition: UI_PLUGIN }]));
    return state.vm.effects.filter((effect) => effect.name === "mwin").map((effect) => effect.args[0]);
  };
  deepEqual(effects(source, "tk2"), ["Ada", "9", "Hello there!"]);
  deepEqual(effects(fixed, "tk3"), ["Ada", "9", "Hello there!"]);
});

test("migration preserves quoted equality and embedded hash dialogue at runtime", () => {
  const source = '#a$ = "p=q"\n#If (a$ = "p=q") {\nHi #there\n}\n#If (a$ = "p==q") {\nWrong branch\n}';
  const fixed = migrate(source);
  deepEqual(mwinText(source, "tk2"), ["Hi #there"]);
  deepEqual(mwinText(fixed, "tk3"), ["Hi #there"]);
});

test("migration keeps literal backslashes, inline prefixes and equals dialogue", () => {
  const source = '#a$ = "x\\"\n#If (a$ = "x\\") { #matched$ = "yes" }\n#If (a$ = "y\\") { #matched$ = "no" }\nHi #there = friend\n#Mwin(a$)\n#Mwin(matched$)';
  const fixed = migrate(source);
  const expected = ["Hi #there = friend", "x\\", "yes"];
  deepEqual(mwinText(source, "tk2"), expected);
  deepEqual(mwinText(fixed, "tk3"), expected);
  equal(sameLowering(source, fixed.replace('a == "x\\"', 'a = "x\\"')), false);
  equal(sameLowering(source, fixed.replace("Hi #there = friend", "Hi there = friend")), false);
});

test("migration preserves sigilled assignments, non-lvalue text and literal backslashes", () => {
  const source = '#index = 2\nvalues[index!]$ = 11\nvalues[3]! = 12\n1 + 1 = 2\nA+B = friendship\nHi #there = C:\\temp\n#Mwin(values[2])\n#Mwin(values[3])';
  const fixed = migrate(source);
  const expected = ["1 + 1 = 2", "A+B = friendship", "Hi #there = C:\\temp", "11", "12"];
  deepEqual(mwinText(source, "tk2"), expected);
  deepEqual(mwinText(fixed, "tk3"), expected);
});

test("conversion explains its refusal of literal quotes without suppressing executable code", () => {
  const source = 'Hi #there = "friend"';
  deepEqual(mwinText(source, "tk2"), ['Hi #there = "friend"']);
  deepEqual(legacyFixes(source, "tk2"), []);
  ok(tk2ConversionRefusal(source)?.includes("double quote"));
  equal(tk2ConversionRefusal('#Mwin("friend")'), null);
});

test("migration preserves unprefixed calls and angle dialogue execution", () => {
  const source = '#Method foo(n) {\n#result = n\n}\n#friend$ = "Ada"\nfoo(x = 1)\nMwin("x=y")\nHi #there = <friend>\n#Mwin(result!)';
  const fixed = migrate(source);
  const expected = ["x=y", "Hi #there = Ada", "1"];
  deepEqual(mwinText(source, "tk2"), expected);
  deepEqual(mwinText(fixed, "tk3"), expected);
});

test("migration keeps digit-leading and multiple calls and refuses qualified dependencies", () => {
  const source = '#Method 1foo(n) {\n#first = n\n}\n#Method bar(n) {\n#second = n\n}\n1foo(x = 1); bar(y = 2)\n#Mwin(first!)\n#Mwin(second!)';
  const fixed = migrate(source);
  deepEqual(mwinText(source, "tk2"), ["1", "2"]);
  deepEqual(mwinText(fixed, "tk3"), ["1", "2"]);
  deepEqual(legacyFixes("system.foo(x = 1)", "tk2"), []);
});

test("migration preserves expression call effects and then-angle dialogue", () => {
  const source = '#Method foo(n) {\n#calls = calls + 1\n#ReturnMethod(n)\n}\n#friend$ = "Ada"\nfoo(x = 1) + 2\nfoo(y = 2)[2]\n!foo(z = 3)\nHi then <friend>\n#Mwin(calls!)\n#Mwin(x!)\n#Mwin(y!)\n#Mwin(z!)';
  const fixed = migrate(source);
  const expected = ["Hi then Ada", "3", "1", "2", "3"];
  deepEqual(mwinText(source, "tk2"), expected);
  deepEqual(mwinText(fixed, "tk3"), expected);
});

test("migration preserves assignment-like dialogue and explains quoted refusal", () => {
  const source = '#index = 2\nvalues[index!]$ = 7\nScore = 5 points\nHi = my friend\n#Mwin(values[2])';
  const fixed = migrate(source);
  const expected = ["Score = 5 points", "Hi = my friend", "7"];
  deepEqual(mwinText(source, "tk2"), expected);
  deepEqual(mwinText(fixed, "tk3"), expected);
  const quoted = 'Hello = "friend" is here';
  deepEqual(mwinText(quoted, "tk2"), [quoted]);
  deepEqual(legacyFixes(quoted, "tk2"), []);
  ok(tk2ConversionRefusal(quoted)?.includes("double quote"));
});

test("migration preserves inline prefixed commands after assignment", () => {
  const source = 'x = 1; #Mwin(hi); #Mwin("a #there")\n#Mwin(x!)';
  const fixed = migrate(source);
  deepEqual(mwinText(source, "tk2"), ["hi", "a #there", "1"]);
  deepEqual(mwinText(fixed, "tk3"), ["hi", "a #there", "1"]);
});

test("mixed legacy forms are converted together and retain comments and CRLF", () => {
  const source = "* keep this comment\r\n#If (x = 5) {\r\n  #y! = 1\r\n}\r\nHello there\r\n#threadSleep(1, 2) * keep this too\r\n";
  const fixed = migrate(source);
  equal(fixed, '* keep this comment\r\nIf (x == 5) {\r\n  y = 1\r\n}\r\nmwin("Hello there")\r\nthreadSleep(1, 2) // keep this too\r\n');
});

test("TK2 dialogue trims surrounding whitespace and preserves mixed-code lowering (#2147)", () => {
  const source = "  Hello there   \n#score! = 1\n  Farewell, friend!  ";
  const fixed = migrate(source);
  equal(fixed, '  mwin("Hello there")\nscore = 1\n  mwin("Farewell, friend!")');
});

test("a quoted star stays in dialogue and a trailing comment survives", () => {
  equal(migrate('  #Mwin("a * b") * KEEP\r\n'), '  Mwin("a * b") // KEEP\r\n');
});

test("method and return spellings migrate without changing the function", () => {
  const source = "#Method f(a) {\n  #ReturnMethod(a + 2)\n}";
  const fixed = migrate(source);
  ok(compileInline(fixed).functions.f);
});

test("a control call is not silently removed", () => {
  const source = "#Dos\nx = 1";
  const fixed = migrate(source);
  ok(fixed.includes("Dos"));
  equal(sameLowering(source, "\nx = 1"), false);
});

function mwinText(source: string, dialect: ScriptDialect): unknown[] {
  const program = compileInline(source, "<migration>", dialect);
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, program.ref);
  advanceScriptTick(state, createScriptServices(state, [{ definition: UI_PLUGIN }]));
  return state.vm.effects.filter((effect) => effect.name === "mwin").map((effect) => effect.args[0]);
}

const REVIEW = (word: string): string => `[${word}] reads the variable ${word}; write ["${word}"] if a literal key was meant`;

test("a bare TK2 index stays a variable index and is flagged for review (#2050)", () => {
  const source = "#m[key] = 1\n#m[key!] = 2\n#m[1key] = 3";
  const actions = legacyFixes(source, "tk2");
  equal(actions[0]!.title, "Preview Toolkit 2.x conversion in an unsaved 3.1 file (3 bare indices to review)");
  deepEqual(actions[0]!.reviews, [
    { line: 1, index: "key", message: REVIEW("key") },
    { line: 2, index: "key", message: REVIEW("key") },
    { line: 3, index: "1key", message: REVIEW("1key") },
  ]);
  equal(migrate(source), [
    `m[key] = 1 // TKR review: ${REVIEW("key")}`,
    `m[key] = 2 // TKR review: ${REVIEW("key")}`,
    `m[1key] = 3 // TKR review: ${REVIEW("1key")}`,
  ].join("\n"));
  equal(sameLowering("#m[key] = 1", 'm["key"] = 1'), false, "quoting the index would change the program");
});
test("many bare indices retain review order and line endings without repeated whole-file scans", () => {
  const body = ["#m[first][second] = 1", ...Array.from({ length: 512 }, (_, index) => `#m[key${index}] = 1`)];
  const source = body.join("\r\n");
  const originalSplit = String.prototype.split;
  let fullFileLineSplits = 0;
  Object.defineProperty(String.prototype, "split", {
    configurable: true,
    writable: true,
    value: function (this: string, separator?: string | RegExp, limit?: number): string[] {
      if (separator === "\n" && this.includes("m[first][second]") && this.includes("m[key511]")) fullFileLineSplits++;
      return Reflect.apply(originalSplit, this, [separator, limit]) as string[];
    },
  });

  const actions = (() => {
    try {
      return legacyFixes(source, "tk2");
    } finally {
      Object.defineProperty(String.prototype, "split", { configurable: true, writable: true, value: originalSplit });
    }
  })();

  ok(fullFileLineSplits <= 8, `full-file line splitting should be bounded independently of index count; got ${fullFileLineSplits}`);
  equal(actions.length, 1);
  const fix = actions[0]!;
  equal(fix.reviews?.length, 514);
  deepEqual(fix.reviews?.slice(0, 3).map(({ line, index }) => [line, index]), [
    [1, "first"],
    [1, "second"],
    [2, "key0"],
  ]);
  deepEqual(fix.reviews?.slice(-1).map(({ line, index }) => [line, index]), [[513, "key511"]]);
  const converted = applyEdits(source, fix.edits);
  equal(converted.split("\r\n").length, body.length);
  equal(converted.includes("\n"), true);
  equal(converted.replaceAll("\r\n", "").includes("\n"), false, "CRLF endings are preserved");
  equal(converted.split("\r\n")[0], `m[first][second] = 1 // TKR review: ${REVIEW("first")}; ${REVIEW("second")}`);
});


test("a variable whose value differs from its spelling indexes by value in both dialects", () => {
  const source = '#key$ = "other"\n#m[key$]$ = "by value"\n#m["key"]$ = "literal"\n#Mwin(m["other"])\n#Mwin(m["key"])\n#Mwin(m[key$])';
  const fixed = migrate(source);
  deepEqual(mwinText(source, "tk2"), ["by value", "literal", "by value"]);
  deepEqual(mwinText(fixed, "tk3"), ["by value", "literal", "by value"]);
  deepEqual(legacyFixes(source, "tk2")[0]!.reviews?.map((item) => item.line), [2, 6]);
});

test("literal, nested and computed indices are converted with only bare words flagged", () => {
  equal(legacyFixes('#m["key"] = 1', "tk2")[0]!.reviews, undefined);
  equal(legacyFixes("#m[a! + 1] = 1\n#m[2] = 1\n#m[true] = 1", "tk2")[0]!.reviews, undefined);
  equal(migrate("#m[a! + 1] = 1"), "m[a + 1] = 1");
  equal(migrate("#m[k!][j$] = 1"), `m[k][j] = 1 // TKR review: ${REVIEW("k")}; ${REVIEW("j")}`);
  equal(migrate('#m[n["x"]] = 1'), 'm[n["x"]] = 1');
  equal(migrate("#Mwin(m[key]) * note"), `Mwin(m[key]) // note // TKR review: ${REVIEW("key")}`);
  equal(migrate("  #If (m[key] = 1) {\r\n  }\r\n"), `  If (m[key] == 1) { // TKR review: ${REVIEW("key")}\r\n  }\r\n`);
});

test("every Toolkit 2 table row converts with identical lowering (rpgcode-dialects.md#tk2-conversion-contract)", () => {
  const rows: readonly (readonly [string, string])[] = [
    ["#Mwin(Hello there)", 'Mwin("Hello there")'],
    ["#threadSleep(1, 2)", "threadSleep(1, 2)"],
    ["#If (x! = 5) {\n}", "If (x == 5) {\n}"],
    ["#While(x! = 5) {\n  #x! = 6\n}", "While (x == 5) {\n  x = 6\n}"],
    ['#x! = 1\n#name$ = "a"', 'x = 1\nname = "a"'],
    ["Hello there", 'mwin("Hello there")'],
    ["See http://example.com /* not code */", 'mwin("See http://example.com /* not code */")'],
    ["#Method f(a!) {\n  #ReturnMethod(a! + 2)\n}", "function f(a) {\n  return(a + 2)\n}"],
    ["* note\n#Mwin(hi) * KEEP", '* note\nMwin("hi") // KEEP'],
    ["#Dos\n#Windows\n#Gone", "Dos\nWindows\nGone"],
    ["@", 'mwin("")'],
    [":top\n#Branch(:top)", ":top\nBranch(:top)"],
  ];
  for (const [source, expected] of rows) equal(migrate(source), expected, source);
});

test("code comment markers TK2 does not define are refused, with dialogue still converted elsewhere", () => {
  for (const source of ["#Mwin(hi) // comment", "#x! = 1 /* note */", "x = 1 // note", "#Mwin(a // b)"]) {
    deepEqual(legacyFixes(source, "tk2"), [], source);
  }
  equal(migrate('#Mwin("a // b")'), 'Mwin("a // b")');
});

test("escaped quotes are not TK2 syntax and get no edit", () => {
  deepEqual(legacyFixes('#Mwin("say \\"hi\\"")', "tk2"), []);
});

test("migration refuses unresolved explicit and implicit dependencies", () => {
  deepEqual(legacyFixes('#Include("lib.prg")', "tk2"), []);
  deepEqual(legacyFixes('#include "lib.prg"\n#Mwin(hi)', "tk2"), []);
  deepEqual(legacyFixes("#lib.hello() * KEEP", "tk2"), []);
  deepEqual(legacyFixes('  #foo.bar("*") * KEEP\r\n', "tk2"), []);
});

test("migration refuses known dynamic program loaders", () => {
  for (const source of [
    '#executeProgram("lib.prg")',
    '#replaceProgram("lib.prg")',
    '#thread("lib.prg",0)',
    '#run("lib.prg")',
    '#change("lib.prg")',
    '#tellThread(1, "Mwin(1)")',
    '#rpgcode("Mwin(1)")',
  ]) deepEqual(legacyFixes(source, "tk2"), [], source);
});

test("3.1 code keeps assignment semantics and never gets a TK2-only edit", () => {
  const source = "if (x = 5) {\n  y = 1\n}\n";
  deepEqual(legacyFixes(source, "tk3"), []);
  deepEqual(legacyFixes(source), []);
});

test("3.1 sigils are removed only after comparing the original 3.1 program", () => {
  const source = 'x! = 1\nname$ = "a"';
  const fixes = legacyFixes(source, "tk3");
  equal(fixes.length, 2);
  equal(applyEdits(source, fixes.flatMap((fix) => [...fix.edits])), 'x = 1\nname = "a"');
});

test("3.1 sigil fixes do not alter possible Toolkit 2 dialogue", () => {
  const uiText = (source: string): unknown[] => {
    const program = compileInline(source, "<sigil>", "tk2");
    const state = createGameState({ seed: 0 });
    startProgram(state.vm, program.ref);
    advanceScriptTick(state, createScriptServices(state, [{ definition: UI_PLUGIN }]));
    return state.vm.effects.filter((effect) => effect.name === "mwin").map((effect) => effect.args[0]);
  };
  deepEqual(uiText("foo(name$)"), ["foo(name$)"]);
  deepEqual(uiText("foo(name)"), ["foo(name)"]);
  deepEqual(legacyFixes("foo(name$)", "tk3"), []);
});

test("uncompilable or unsupported input never gets an edit", () => {
  for (const source of ["#x = )\n#Dos", "< unsupported >"]) {
    deepEqual(legacyFixes(source, "tk2"), []);
  }
});
