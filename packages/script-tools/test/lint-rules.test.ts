import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { commandDocumentation, foldAscii, FIRST_PARTY_PLUGINS, type ResolvedPlugin } from "@tk-reawakened/core";
import { applyEdits, buildIndex, formatSource, lint, sliceRange, type IndexDocument, type LintOptions } from "../src/index.ts";

/**
 * The rule families of docs/spec/engine/rpgcode-tooling.md#tool-3-rules and the
 * assessment contract of #tool-3-assessment (#2073), plus the #2077 arity
 * controls. Every rule has a positive case and the negative cases its "never
 * reports when" column names.
 */

const plugins: ResolvedPlugin[] = FIRST_PARTY_PLUGINS.map((definition) => ({ definition }));

function indexOf(text: string, dialect?: "tk3" | "tk2"): IndexDocument {
  return buildIndex([{ name: "main.prg", ref: { kind: "inline", text, ir: "1", ...(dialect === undefined ? {} : { dialect }) } }]);
}

function run(text: string, extra: Partial<LintOptions> = {}) {
  return lint(indexOf(text), { plugins, dialect: "tk3", sources: { "main.prg": text }, ...extra });
}

function rules(text: string, rule: string, extra: Partial<LintOptions> = {}): [number, string][] {
  return run(text, extra).diagnostics.filter((d) => d.rule === rule).map((d) => [d.range.start.line, sliceRange(text, d.range)]);
}

// #2077 ---------------------------------------------------------------------

test("#2077: a callable parameter named like a command is not checked against the command's arity", () => {
  const text = "function caller(start) { start() }\ncaller(() => 1)\n";
  deepEqual(rules(text, "lint/command-arity"), []);
});

test("#2077: a user method named like a command is not checked against the command's arity", () => {
  const text = "class Player { public: method wav() { return 1 } }\np = Player()\np->wav()\n";
  deepEqual(rules(text, "lint/command-arity"), []);
});

test("#2077: a captured local or a reassigned name may run a bound callable first, so it is not checked", () => {
  const captured = "function outer() {\n    local(start) = () => 1\n    run = () => start()\n    return run\n}\n";
  deepEqual(rules(captured, "lint/command-arity"), []);
  const reassigned = "mediaplay = (f) => f\nmediaplay()\n";
  deepEqual(rules(reassigned, "lint/command-arity"), []);
});

test("#2077 controls: a genuine wrong-arity command still warns and a correct call stays clean", () => {
  deepEqual(rules("start()\n", "lint/command-arity"), [[1, "start"]]);
  deepEqual(rules('wav("a.wav")\n', "lint/command-arity"), []);
  // A parameter in one function does not hide the command in another.
  deepEqual(rules("function a(start) { start() }\nfunction b() { start() }\n", "lint/command-arity"), [[2, "start"]]);
});

// unused variables ----------------------------------------------------------

test("an explicit function local nothing reads is reported at its declaration", () => {
  const text = "function f() {\n    local(x) = 1\n    return 2\n}\n";
  deepEqual(rules(text, "lint/unused-variable"), [[2, "local"]]);
  const [found] = run(text).diagnostics.filter((d) => d.rule === "lint/unused-variable");
  ok(found !== undefined && /`x`/.test(found.message));
});

test("a local that is read, passed, called, captured, used as a receiver or named in a string is not reported", () => {
  const cases = [
    "function f() {\n    local(x) = 1\n    return x\n}\n",
    "function f() {\n    local(x) = 1\n    mwin(x)\n}\n",
    "function f() {\n    local(x) = () => 1\n    x()\n}\n",
    "function f() {\n    local(x) = 1\n    return () => x\n}\n",
    "function f() {\n    local(x) = 1\n    x.a = 2\n}\n",
    "function f() {\n    local(x) = 1\n    x += 1\n}\n",
    'function f() {\n    local(x) = 1\n    mwin("x")\n}\n',
  ];
  for (const text of cases) deepEqual(rules(text, "lint/unused-variable"), [], text);
});

test("same-name locals in two functions are judged separately; program-level and parameter names are out of scope", () => {
  const text = "function a() {\n    local(x) = 1\n}\nfunction b(y) {\n    local(x) = 1\n    return x\n}\nlocal(z) = 1\n";
  deepEqual(rules(text, "lint/unused-variable"), [[2, "local"]]);
});

test("rpgcode or bindingOf in a function makes its unused-local check unassessed, not clean", () => {
  const text = 'function f() {\n    local(x) = 1\n    rpgcode("mwin(x)")\n}\n';
  const result = run(text);
  deepEqual(result.diagnostics.filter((d) => d.rule === "lint/unused-variable"), []);
  ok(result.summary.unassessed.some((entry) => entry.rule === "lint/unused-variable" && entry.reason === "dynamic-reference"));
});

// unused labels --------------------------------------------------------------

test("a function label nothing names is reported; branch, on error goto, a call or a string keeps it", () => {
  deepEqual(rules("function f() {\n    :spare\n    return 1\n}\n", "lint/unused-label"), [[2, ":"]]);
  const kept = [
    "function f() {\n    branch(:top)\n    :top\n}\n",
    "function f() {\n    on error goto :bad\n    return 1\n    :bad\n    resumenext()\n}\n",
    'function f() {\n    branch(":top")\n    :top\n}\n',
  ];
  for (const text of kept) deepEqual(rules(text, "lint/unused-label"), [], text);
});

test("a computed branch target makes the scope's label check unassessed", () => {
  const result = run("function f(where) {\n    branch(where)\n    :top\n}\n");
  deepEqual(result.diagnostics.filter((d) => d.rule === "lint/unused-label"), []);
  ok(result.summary.unassessed.some((entry) => entry.rule === "lint/unused-label" && entry.reason === "dynamic-reference"));
});

test("a program-level label needs a closed project, where any program may name it", () => {
  const open = run(":top\nmwin(\"x\")\n");
  deepEqual(open.diagnostics.filter((d) => d.rule === "lint/unused-label"), []);
  ok(open.summary.unassessed.some((entry) => entry.rule === "lint/unused-label" && entry.reason === "incomplete-project"));
  const project = { closed: true as const, entryPoints: [] };
  deepEqual(rules(":top\nmwin(\"x\")\n", "lint/unused-label", { project }), [[1, ":"]]);
  const document = buildIndex([
    { name: "a.prg", ref: { kind: "inline", text: ":top\n", ir: "1" } },
    { name: "b.prg", ref: { kind: "inline", text: "branch(:top)\n", ir: "1" } },
  ]);
  deepEqual(lint(document, { plugins, dialect: "tk3", project }).diagnostics.filter((d) => d.rule === "lint/unused-label"), []);
});

// unreachable code ------------------------------------------------------------

test("the first statement after return or the built-in end, done or stop is unreachable", () => {
  deepEqual(rules('function f() {\n    return 1\n    mwin("a")\n    mwin("b")\n}\n', "lint/unreachable-code"), [[3, "mwin"]]);
  for (const end of ["end()", "done", "stop()"]) {
    deepEqual(rules(`${end}\nmwin("a")\n`, "lint/unreachable-code"), [[2, "mwin"]], end);
  }
});

test("a label, a nested block or a class declaration does not make following code unreachable", () => {
  deepEqual(rules('end()\n:again\nmwin("a")\n', "lint/unreachable-code"), []);
  deepEqual(rules('function f(a) {\n    if (a) {\n        return 1\n    }\n    mwin("a")\n}\n', "lint/unreachable-code"), []);
  deepEqual(rules("end()\nclass Thing { public: method go() { return 1 } }\n", "lint/unreachable-code"), []);
});

test("an overridden terminator or an error handler means a later statement may run", () => {
  deepEqual(rules('function f(end) {\n    end()\n    mwin("a")\n}\n', "lint/unreachable-code"), []);
  deepEqual(rules('end = () => 1\nend()\nmwin("a")\n', "lint/unreachable-code"), []);
  const handled = run('function f() {\n    on error resume next\n    return g()\n    mwin("a")\n}\n');
  deepEqual(handled.diagnostics.filter((d) => d.rule === "lint/unreachable-code"), []);
  ok(handled.summary.unassessed.some((entry) => entry.rule === "lint/unreachable-code" && entry.reason === "dynamic-reference"));
});

// deprecated and obsolete commands --------------------------------------------

test("a deprecated or obsolete command is reported with its catalogue replacement and reason, without a fix", () => {
  const [deprecated] = run('wav("a.wav")\n').diagnostics.filter((d) => d.rule === "lint/deprecated-command");
  ok(deprecated !== undefined);
  ok(deprecated.message.includes("`mediaplay`") && deprecated.message.includes("Retained so existing Toolkit 3.1 games"), deprecated.message);
  equal(deprecated.fix, undefined);
  const [obsolete] = run("x = iif(1, 2, 3)\n").diagnostics.filter((d) => d.rule === "lint/obsolete-command");
  ok(obsolete !== undefined && obsolete.message.includes("?: operator"), obsolete?.message);
  equal(obsolete.fix, undefined);
});

test("every tagged catalogue name and alias is reported with its own status; ordinary built-ins are not", () => {
  const entries = commandDocumentation(plugins);
  const names = new Set(entries.filter((entry) => entry.tags.includes("deprecated") || entry.tags.includes("obsolete")).map((entry) => foldAscii(entry.name)));
  ok(names.size >= 20, `expected the catalogue's tagged names, found ${names.size}`);
  const text = [...names].map((name) => `${name}()`).join("\n") + "\nmwin(\"x\")\n";
  const result = run(text);
  const found = result.diagnostics.filter((d) => d.rule === "lint/deprecated-command" || d.rule === "lint/obsolete-command");
  deepEqual(found.map((d) => sliceRange(text, d.range)), [...names]);
  for (const diagnostic of found) {
    const name = sliceRange(text, diagnostic.range);
    const status = diagnostic.rule === "lint/obsolete-command" ? "obsolete" : "deprecated";
    ok(entries.some((entry) => foldAscii(entry.name) === name && entry.tags.includes(status) && (entry.reason === null || diagnostic.message.includes(entry.reason))), `${name}: ${diagnostic.message}`);
  }
});

test("a method, a file-qualified call or a rebound name is not reported as the retired command", () => {
  deepEqual(rules("class P { public: method wav() { return 1 } }\np = P()\np->wav()\n", "lint/deprecated-command"), []);
  deepEqual(rules("function f(wav) {\n    wav(1)\n}\n", "lint/deprecated-command"), []);
  deepEqual(rules('sounds.wav("a.wav")\n', "lint/deprecated-command"), []);
});

// style -----------------------------------------------------------------------

test("a line the formatter would rewrite is a hint whose one edit is the formatter's output", () => {
  const text = "function f() {\nMWIN(\"x\")\n}\r\n";
  const result = run(text);
  const found = result.diagnostics.filter((d) => d.rule === "style/format");
  deepEqual(found.map((d) => [d.severity, d.range.start.line, sliceRange(text, d.range)]), [["hint", 2, 'MWIN("x")']]);
  const fixed = applyEdits(text, found.flatMap((d) => d.fix ?? []));
  equal(fixed, formatSource(text, { dialect: "tk3" }).text);
  deepEqual(run(fixed).diagnostics.filter((d) => d.rule === "style/format"), []);
});

test("style is unassessed without a 3.1 dialect or the source text, and never rewrites Toolkit 2.x", () => {
  const text = "MWIN(\"x\")\n";
  const reasons = (options: Partial<LintOptions>, document = indexOf(text)) =>
    lint(document, { plugins, ...options }).summary.unassessed.filter((entry) => entry.rule === "style/format").map((entry) => entry.reason);
  deepEqual(reasons({ sources: { "main.prg": text } }), ["unknown-dialect"]);
  deepEqual(reasons({ dialect: "tk3" }), ["missing-source"]);
  deepEqual(reasons({ dialect: "tk2", sources: { "main.prg": text } }), ["unsupported-dialect"]);
});

// unused functions --------------------------------------------------------------

test("unused functions are unassessed unless the project is declared closed", () => {
  const result = run("function spare() { return 1 }\n");
  deepEqual(result.diagnostics.filter((d) => d.rule === "lint/unused-function"), []);
  deepEqual(result.summary.unassessed.filter((entry) => entry.rule === "lint/unused-function").map((entry) => entry.reason), ["incomplete-project"]);
});

test("in a closed project a function with no static use is a hint; a call, read, string or entry point is a use", () => {
  const project = { closed: true as const, entryPoints: ["onload"] };
  const text = 'function spare() { return 1 }\nfunction called() { return 1 }\nfunction held() { return 1 }\nfunction named() { return 1 }\nfunction onLoad() { return 1 }\ncalled()\nh = held\non("tick", "named")\n';
  const found = run(text, { project }).diagnostics.filter((d) => d.rule === "lint/unused-function");
  deepEqual(found.map((d) => [d.severity, d.range.start.line]), [["hint", 1]]);
  ok(found[0]!.message.includes("no static use"), found[0]!.message);
  const document = buildIndex([
    { name: "lib.prg", ref: { kind: "inline", text: "function shared() { return 1 }\n", ir: "1" } },
    { name: "main.prg", ref: { kind: "inline", text: "shared()\n", ir: "1" } },
  ]);
  deepEqual(lint(document, { plugins, dialect: "tk3", project }).diagnostics.filter((d) => d.rule === "lint/unused-function"), []);
});

test("a closed project with a missing include, dynamic code or a broken program is unassessed, not clean", () => {
  const project = { closed: true as const, entryPoints: [] };
  const reasonsFor = (document: IndexDocument): string[] =>
    lint(document, { plugins, dialect: "tk3", project }).summary.unassessed.filter((entry) => entry.rule === "lint/unused-function").map((entry) => entry.reason);
  deepEqual(reasonsFor(indexOf('#include "missing.prg"\nfunction spare() { return 1 }\n')), ["incomplete-project"]);
  deepEqual(reasonsFor(indexOf('function spare() { return 1 }\nrpgcode("spare()")\n')), ["dynamic-reference"]);
  const broken = buildIndex([
    { name: "main.prg", ref: { kind: "inline", text: "function spare() { return 1 }\n", ir: "1" } },
    { name: "bad.prg", ref: { kind: "inline", text: "if (\n", ir: "1" } },
  ]);
  deepEqual(reasonsFor(broken), ["invalid-program"]);
});

// assessment and configuration ---------------------------------------------------

test("an index without parsed units, an unknown or Toolkit 2.x dialect, or a failed compile is reported unassessed", () => {
  const text = "function f() {\n    local(x) = 1\n}\n";
  const reasonOf = (document: IndexDocument, dialect?: "tk3" | "tk2"): string[] =>
    [...new Set(lint(document, { plugins, ...(dialect === undefined ? {} : { dialect }) }).summary.unassessed.filter((entry) => entry.rule === "lint/unused-variable").map((entry) => entry.reason))];
  deepEqual(reasonOf(JSON.parse(JSON.stringify(indexOf(text))) as IndexDocument, "tk3"), ["missing-source"]);
  deepEqual(reasonOf(indexOf(text)), ["unknown-dialect"]);
  deepEqual(reasonOf(indexOf(text, "tk2")), ["unmapped-source-span"]);
  deepEqual(reasonOf(indexOf(text), "tk2"), ["unsupported-dialect"]);
  deepEqual(reasonOf(indexOf("if (\n"), "tk3"), ["invalid-program"]);
  deepEqual(reasonOf(indexOf(text, "tk3")), []);
});

test("new rules take the same severity overrides, off switch and ignore list, and an off rule is not listed unassessed", () => {
  const text = "function f() {\n    local(x) = 1\n}\nfunction g() { return 1 }\n";
  const result = run(text, {
    config: { severity: { "lint/unused-variable": "error", "lint/unused-function": "off" }, ignore: [{ rule: "style/format" }] },
  });
  deepEqual(result.diagnostics.filter((d) => d.rule === "lint/unused-variable").map((d) => d.severity), ["error"]);
  ok(result.summary.disabledRules.includes("lint/unused-function"));
  ok(!result.summary.unassessed.some((entry) => entry.rule === "lint/unused-function"));
});

test("findings keep exact UTF-16 ranges on CRLF lines after astral characters", () => {
  const text = 'mwin("\u{1F600}")\r\nfunction f() {\r\n    mwin("\u{1F600}"); local(x) = 1\r\n}\r\n';
  const found = run(text).diagnostics.filter((d) => d.rule === "lint/unused-variable");
  deepEqual(found.map((d) => [d.range.start.line, sliceRange(text, d.range)]), [[3, "local"]]);
});

// interim visual-event-builder evidence ---------------------------------------------

test("the category-representative visual event builder fixture checks clean (interim evidence only, #1744/#1746)", () => {
  const path = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "veb-categories.prg");
  const text = readFileSync(path, "utf8");
  const result = run(text, { project: { closed: true, entryPoints: [] } });
  deepEqual(result.diagnostics, []);
  deepEqual(result.summary.unassessed, []);
});

// review regressions --------------------------------------------------------------

test("#2077 controls: a local elsewhere or a non-callable assignment does not hide a genuine command call", () => {
  deepEqual(rules("function a() {\n    local(start) = 1\n    return start\n}\nstart()\n", "lint/command-arity"), [[5, "start"]]);
  deepEqual(rules('wav = 1\nwav("a.wav")\n', "lint/deprecated-command"), [[2, "wav"]]);
  deepEqual(rules('start = "x"\nstart()\n', "lint/command-arity"), [[2, "start"]]);
});

test("a statement after a terminator whose nested block holds a branch target is not unreachable", () => {
  const text = 'branch(:again)\nend()\nif (x) {\n    :again\n    mwin("a")\n}\n';
  deepEqual(rules(text, "lint/unreachable-code"), []);
});

test("in a closed project, inline programs keep their own functions and an unowned include is unassessed", () => {
  const project = { closed: true as const, entryPoints: [] };
  const document = buildIndex([
    { name: "a.prg", ref: { kind: "inline", text: "function spare() { return 1 }\n", ir: "1" } },
    { name: "b.prg", ref: { kind: "inline", text: "function spare() { return 1 }\n", ir: "1" } },
  ]);
  const result = lint(document, { plugins, dialect: "tk3", project });
  deepEqual(result.programs.filter((_, i) => result.diagnostics[i]!.rule === "lint/unused-function"), ["a.prg", "b.prg"]);
});
