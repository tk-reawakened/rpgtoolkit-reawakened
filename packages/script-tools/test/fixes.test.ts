import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import { advanceScriptTick, compileInline, createGameState, createScriptServices, startProgram, UI_PLUGIN, type ScriptDialect } from "@tk-reawakened/core";
import { applyEdits, legacyFixes, sameLowering } from "../src/index.ts";

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

test("mixed legacy forms are converted together and retain comments and CRLF", () => {
  const source = "* keep this comment\r\n#If (x = 5) {\r\n  #y! = 1\r\n}\r\nHello there\r\n#threadSleep(1, 2) * keep this too\r\n";
  const fixed = migrate(source);
  equal(fixed, '* keep this comment\r\nIf (x == 5) {\r\n  y = 1\r\n}\r\nmwin("Hello there")\r\nthreadSleep(1, 2) // keep this too\r\n');
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

test("ambiguous bracket indexing is not rewritten pending #2050", () => {
  deepEqual(legacyFixes("#m[key] = 1", "tk2"), []);
  deepEqual(legacyFixes("#m[1key] = 1", "tk2"), []);
  deepEqual(legacyFixes("#m[key$] = 1", "tk2"), []);
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

test("uncompilable, unsupported or comment-ambiguous input never gets an edit", () => {
  for (const source of ["x = )\n#Dos", "< unsupported >", '#Mwin(hi) // comment']) {
    deepEqual(legacyFixes(source, "tk2"), []);
  }
});
