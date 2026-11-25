import { deepEqual, equal, match, ok } from "node:assert/strict";
import test from "node:test";
import { advanceScriptTick, compileInline, createGameState, createScriptServices, startProgram, UI_PLUGIN, type ScriptDialect } from "@tk-reawakened/core";
import { formatSource, transformSource, type ScriptTransformId, type ScriptTransformResult } from "../src/index.ts";

/**
 * Story 13.16 (docs/spec/engine/rpgcode-tooling.md#tool-11-transforms): the four transforms over the providers the
 * package already has. Every accepted rewrite is also run in the real engine and must say the same thing.
 */

const run = (transform: ScriptTransformId, text: string, dialect: "tk2" | "tk3" = "tk3", established = true): ScriptTransformResult =>
  transformSource({ transform, text, dialect, established });

/** What the program shows, run in the real UI plugin. */
function said(text: string, dialect: ScriptDialect): unknown[] {
  const program = compileInline(text, "<proof>", dialect);
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, program.ref);
  advanceScriptTick(state, createScriptServices(state, [{ definition: UI_PLUGIN }]));
  return state.vm.effects.filter((effect) => effect.name === "mwin").map((effect) => effect.args[0]);
}

const MESSY = 'IF (x == 1) {\nMWIN("Hello")\n  // keep MWIN in a comment\n}\nMwin(hello)';

test("the formatter's two jobs can be asked for separately and together give the formatter's result", () => {
  const both = formatSource(MESSY, { dialect: "tk3" }).text;
  const indentOnly = formatSource(MESSY, { dialect: "tk3", jobs: { capitalisation: false } }).text;
  const caseOnly = formatSource(MESSY, { dialect: "tk3", jobs: { indent: false } }).text;
  equal(indentOnly, 'IF (x == 1) {\n    MWIN("Hello")\n  // keep MWIN in a comment\n}\nMwin(hello)', "indent alone keeps every spelling");
  equal(caseOnly, 'if (x == 1) {\nmwin("Hello")\n  // keep MWIN in a comment\n}\nmwin(hello)', "capitalisation alone keeps every line's leading white space and the comment");
  equal(formatSource(caseOnly, { dialect: "tk3", jobs: { capitalisation: false } }).text, both, "one job after the other is the whole formatter");
  for (const jobs of [{ indent: false }, { capitalisation: false }, {}]) {
    const once = formatSource(MESSY, { dialect: "tk3", jobs }).text;
    equal(formatSource(once, { dialect: "tk3", jobs }).text, once, `idempotent with ${JSON.stringify(jobs)}`);
  }
});

test("format and canonical-case are the TOOL-4 results, refusing Toolkit 2.x and unassessed source with their reason", () => {
  const format = run("format", MESSY);
  equal(format.status, "changed");
  equal(format.text, formatSource(MESSY, { dialect: "tk3" }).text);
  equal(format.target, "in-place");
  const caseOnly = run("canonical-case", MESSY);
  equal(caseOnly.text, 'if (x == 1) {\nmwin("Hello")\n  // keep MWIN in a comment\n}\nmwin(hello)');
  equal(run("format", 'if (x) {\n    mwin("a")\n}\n').status, "unchanged");

  const tk2 = run("format", "Mwin(hello)\n", "tk2");
  equal(tk2.status, "refused");
  equal(tk2.text, "Mwin(hello)\n");
  equal(tk2.reason?.code, "tk2-dialect");
  const unassessed = run("canonical-case", "Mwin(hello)\n", "tk3", false);
  equal(unassessed.status, "refused");
  equal(unassessed.reason?.code, "unassessed");
  equal(unassessed.text, "Mwin(hello)\n");
});

test("update converts a Toolkit 2.x program to a 3.1 copy that says the same thing, flags bare indices and keeps every comment", () => {
  const source = '* intro\n#name$ = "Ada"\n#Mwin(Hello there)\n#If (name$ = "Ada") {\n  Welcome to town\n  #Mwin(bye) * trailing\n}\n#m[key] = 1\n';
  const result = run("update", source, "tk2");
  equal(result.status, "changed");
  equal(result.target, "copy", "a conversion never replaces the Toolkit 2.x original");
  equal(result.text, '* intro\nname = "Ada"\nMwin("Hello there")\nIf (name == "Ada") {\n  mwin("Welcome to town")\n  Mwin("bye") // trailing\n}\nm[key] = 1 // TKR review: [key] reads the variable key; write ["key"] if a literal key was meant\n');
  deepEqual(result.reviews.map(({ line, index }) => ({ line, index })), [{ line: 8, index: "key" }]);
  deepEqual(result.steps.map(({ id, applied }) => ({ id, applied })), [{ id: "tk2-to-tk3", applied: true }]);
  const body = source.replace(/\n#m\[key\] = 1\n$/, "\n");
  const converted = run("update", body, "tk2").text;
  deepEqual(said(converted, "tk3"), said(body, "tk2"), "the real engine shows the same messages before and after");
  deepEqual(said(converted, "tk3"), ["Hello there", "Welcome to town", "bye"]);
});

test("update lists each unsupported fragment of a Toolkit 2.x program with its line and changes nothing", () => {
  const quote = run("update", 'Mwin(ok)\nShe said "hi"\n', "tk2");
  equal(quote.status, "refused");
  equal(quote.reason?.code, "unsupported-fragments");
  equal(quote.text, 'Mwin(ok)\nShe said "hi"\n');
  deepEqual(quote.unsupported.map(({ line, code }) => ({ line, code })), [{ line: 2, code: "dialogue-quote" }]);

  const many = run("update", '#Mwin(ok)\nOne "a"\nTwo "b"\n#x = 1 // not Toolkit 2.x\n#Include(other.prg)\n', "tk2");
  equal(many.status, "refused");
  deepEqual(many.unsupported.map(({ line, code }) => ({ line, code })), [
    { line: 2, code: "dialogue-quote" },
    { line: 3, code: "dialogue-quote" },
    { line: 4, code: "comment-marker" },
    { line: 5, code: "dynamic-source" },
  ]);

  const broken = run("update", "#If (x {\n", "tk2");
  equal(broken.status, "refused");
  ok(broken.unsupported.some((fragment) => fragment.code === "compile-error"), "a Toolkit 2.x compile failure is named");
  const include = run("update", "#Include(other.prg)\n", "tk2");
  equal(include.reason?.code, "unsupported-fragments");
  equal(include.unsupported[0]?.code, "dynamic-source");
});

test("update drops the ignored sigils of a 3.1 program in place, proved under the project's dialect", () => {
  const source = 'x! = 1\nname$ = "a"\nmwin(x)\n';
  const result = run("update", source);
  equal(result.status, "changed");
  equal(result.text, 'x = 1\nname = "a"\nmwin(x)\n');
  equal(result.target, "in-place");
  equal(run("update", result.text).status, "unchanged", "idempotent");
  deepEqual(said(result.text, "tk3"), said(source, "tk3"));
});

test("an unassessed 3.1 edit is offered only when it holds under the Toolkit 2.x reading too, and the spots are named otherwise", () => {
  // Read as Toolkit 2.x this line is dialogue, so dropping the sigil would change what it says.
  const source = "foo(name$)\nx! = 1\n";
  const established = run("update", source, "tk3", true);
  equal(established.status, "changed", "with the dialect established only the 3.1 reading must hold");
  equal(established.text, "foo(name)\nx = 1\n");
  const loose = run("update", source, "tk3", false);
  equal(loose.status, "changed", "the sigil that is safe in both readings is still dropped");
  equal(loose.text, "foo(name$)\nx = 1\n");
  deepEqual(loose.unsupported.map(({ line, code }) => ({ line, code })), [{ line: 1, code: "reading-dependent" }]);
  const only = run("update", "foo(name$)\n", "tk3", false);
  equal(only.status, "refused");
  equal(only.reason?.code, "unsupported-fragments");
  equal(only.text, "foo(name$)\n");
});

test("cleanup drops sigils and formats a 3.1 program, and reports # lines instead of making them run", () => {
  const source = 'x! = 1\nIF (x == 1) {\nMWIN("a")\n}\n#mwin("dead")\n';
  const result = run("cleanup", source);
  equal(result.status, "changed");
  equal(result.text, 'x = 1\nif (x == 1) {\n    mwin("a")\n}\n#mwin("dead")\n');
  deepEqual(result.steps.map(({ id, applied }) => ({ id, applied })), [{ id: "sigil", applied: true }, { id: "format", applied: true }]);
  deepEqual(result.unsupported.map(({ line, code }) => ({ line, code })), [{ line: 5, code: "legacy-prefix-line" }]);
  deepEqual(said(result.text, "tk3"), said(source, "tk3"));
  deepEqual(said(result.text, "tk3"), ["a"], "the # line is still dead, as before");
  equal(run("cleanup", result.text).status, "unchanged", "idempotent");
  equal(run("cleanup", '#include "other.prg"\nmwin("a")\n').unsupported.length, 0, "an #include directive is not a dead line");
});

test("cleanup of a Toolkit 2.x program converts it and then formats the 3.1 copy, skipping the format stage when it is not proved", () => {
  const source = '#Mwin(Hello there)\n#IF (a! = 1) {\n#Mwin(yes)\n}\n';
  const result = run("cleanup", source, "tk2");
  equal(result.status, "changed");
  equal(result.target, "copy");
  equal(result.text, 'mwin("Hello there")\nif (a == 1) {\n    mwin("yes")\n}\n');
  deepEqual(result.steps.map(({ id, applied }) => ({ id, applied })), [{ id: "tk2-to-tk3", applied: true }, { id: "format", applied: true }]);
  deepEqual(said(result.text, "tk3"), said(source, "tk2"));
  const refusedBecause = run("cleanup", 'Mwin(ok)\nShe said "hi"\n', "tk2");
  equal(refusedBecause.status, "refused");
  equal(refusedBecause.text, 'Mwin(ok)\nShe said "hi"\n');
});

test("an unassessed 3.1 cleanup skips its format stage and says why", () => {
  const result = run("cleanup", "#mwin(\"a\")\n", "tk3", false);
  const format = result.steps.find((step) => step.id === "format");
  equal(format?.applied, false);
  match(format?.reason ?? "", /unassessed/);
});

test("a line the lexer refuses is never turned into a command by removing its leading character", () => {
  // U+00A0 is a Windows-1252 byte; it is not indentation, and dropping it would make the line run.
  const source = '\u00a0mwin("x")\n';
  const result = formatSource(source, { dialect: "tk3" });
  equal(result.text, source, "a non-breaking space is left where it is");
  equal(result.changed, false);
  equal(formatSource('\u00a0mwin("x")\nif (a) {\nmwin("b")\n}\n', { dialect: "tk3" }).text, '\u00a0mwin("x")\nif (a) {\n    mwin("b")\n}\n', "the other lines are still formatted");
});

test("a Toolkit 2.x source that does not compile is refused even when there is nothing to rewrite", () => {
  const invalid = run("update", "#If (x {\n#Mwin(ok)\n", "tk2");
  equal(invalid.status, "refused");
  ok(invalid.unsupported.some((fragment) => fragment.code === "compile-error"), "the compile failure is named");
});

test("a star comment is a whole-line comment, so a # on the next line is still reported", () => {
  const source = "* example /*\n#mwin(\"dead\")\n";
  const result = run("cleanup", source);
  deepEqual(result.unsupported.filter((fragment) => fragment.code === "legacy-prefix-line").map((fragment) => fragment.line), [2]);
  equal(result.text, source, "nothing proved a rewrite");
});

test("a block comment that closes on a star line does not hide the legacy # that follows", () => {
  const source = "/* note\n */\n#mwin(\"dead\")\n";
  const result = run("cleanup", source);
  deepEqual(result.unsupported.filter((fragment) => fragment.code === "legacy-prefix-line").map((fragment) => fragment.line), [3]);
});

test("inline star comments, quotes within block comments, and include tails never mask the next legacy # line", () => {
  const lines = [
    'mwin("live") ** /* line comment',
    '#mwin("first dead line")',
    '/* a quote in a comment: " */',
    '#mwin("second dead line")',
    '#include "safe.prg" /* ignored directive tail',
    '#mwin("third dead line")',
  ];
  const result = run("cleanup", `${lines.join("\n")}\n`);
  deepEqual(result.unsupported.filter((fragment) => fragment.code === "legacy-prefix-line").map((fragment) => fragment.line), [2, 4, 6]);
});

test("format refuses a program that does not compile instead of offering a plausible rewrite", () => {
  const invalid = "IF (1) {\n";
  const format = run("format", invalid);
  equal(format.status, "refused");
  equal(format.reason?.code, "not-proven");
  equal(format.text, invalid);
  ok(format.unsupported.some((fragment) => fragment.code === "compile-error"));
  const tidy = run("canonical-case", "mwin(\"ok\")\n");
  equal(tidy.status, "unchanged");
});
