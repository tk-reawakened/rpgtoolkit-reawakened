import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import { FIRST_PARTY_PLUGINS, type ResolvedPlugin } from "@tk-reawakened/core";
import { analyse, applyEdits, buildIndex, lint, readLintConfig, RULES } from "../src/index.ts";

/**
 * The linter (docs/spec/engine/rpgcode-tooling.md#tool-3): rules read the index
 * and the catalogue, a config changes severities and ignores deliberately, and
 * the summary names what was turned off.
 */

const plugins: ResolvedPlugin[] = FIRST_PARTY_PLUGINS.map((definition) => ({ definition }));

function indexOf(text: string) {
  return buildIndex([{ name: "main.prg", ref: { kind: "inline", text, ir: "1" } }]);
}

test("every rule has a stable id, a default severity and a rationale", () => {
  deepEqual(
    RULES.map((rule) => [rule.id, rule.defaultSeverity, rule.fix]),
    [
      ["lint/unknown-command", "error", false],
      ["lint/command-arity", "warning", false],
      ["lint/shadowed-builtin", "warning", false],
      ["lint/unresolved-include", "warning", false],
      ["dialect/sigil", "warning", true],
      ["dialect/return-method", "warning", false],
      ["dialect/obsolete-control", "warning", false],
      ["dialect/unquoted-command-argument", "warning", false],
    ],
  );
  for (const rule of RULES) ok(rule.rationale.length > 0);
});

test("a call nothing defines is an unknown command; a catalogue call is not", () => {
  const result = lint(indexOf('nope()\nmwin("x")\n'), { plugins });
  deepEqual(result.diagnostics.map((d) => [d.rule, d.severity, d.range.start.line]), [["lint/unknown-command", "error", 1]]);
  equal(result.summary.diagnostics, 1);
  equal(result.summary.ignoredRanges, 0);
});

test("spec API names are available only to specs, without hiding unknown calls", () => {
  const source = 'it("case", () => { expect(1).toBe(1); typo() })';
  const document = buildIndex([
    { name: "checks.SPEC.PRG", ref: { kind: "inline", text: source, ir: "1" } },
    { name: "game.prg", ref: { kind: "inline", text: source, ir: "1" } },
  ]);
  const result = lint(document, { plugins });
  deepEqual(result.programs.filter((name) => name === "checks.SPEC.PRG"), ["checks.SPEC.PRG"]);
  equal(result.diagnostics.filter((d) => d.message.includes("typo")).length, 2);
  ok(result.diagnostics.some((d, i) => result.programs[i] === "game.prg" && d.message.includes("`expect`")));
});

test("a call with the wrong number of parameters reports the command's bounds", () => {
  const result = lint(indexOf("mwin()\n"), { plugins });
  const [found] = result.diagnostics;
  ok(found);
  equal(found.rule, "lint/command-arity");
  equal(found.severity, "warning");
  ok(/mwin/.test(found.message), found.message);
});

test("a script function that reuses a command name is reported", () => {
  const result = lint(indexOf("function mwin(a) { return a }\n"), { plugins });
  deepEqual(result.diagnostics.map((d) => d.rule), ["lint/shadowed-builtin"]);
});

test("an include nothing served is reported", () => {
  const result = lint(indexOf('#include "missing.prg"\n'), { plugins, resolveIncludes: true });
  deepEqual(result.diagnostics.map((d) => d.rule), ["lint/unresolved-include"]);
});

test("the config changes severity, turns a rule off, and ignores by rule and line", () => {
  const document = indexOf('nope()\nmwin()\n');
  const configured = lint(document, {
    plugins,
    config: { severity: { "lint/unknown-command": "info", "lint/command-arity": "off" }, ignore: [{ rule: "lint/unknown-command", line: 1 }] },
  });
  deepEqual(configured.diagnostics, []);
  deepEqual(configured.summary.disabledRules, ["lint/command-arity"]);
  equal(configured.summary.ignoredRanges, 1);
});

test("config validation rejects an unknown rule id or severity instead of ignoring it", () => {
  const unknownRule = readLintConfig({ severity: { "lint/nope": "warning" } });
  equal(unknownRule.ok, false);
  const badSeverity = readLintConfig({ severity: { "lint/unknown-command": "fatal" } });
  equal(badSeverity.ok, false);
  const notAnObject = readLintConfig([]);
  equal(notAnObject.ok, false);
  const good = readLintConfig({ severity: { "lint/unknown-command": "info" }, ignore: [{ file: "main.prg", line: 2 }] });
  equal(good.ok, true);
  const empty = readLintConfig({});
  equal(empty.ok, true);
});

test("the dialect rules warn without offering unproven fixes", () => {
  const text = "#Mwin(Hello there)\n#ReturnMethod(1 + 2)\n#Dos\nx! = 1\n";
  const document = indexOf(text);
  const result = lint(document, { plugins, sources: { "main.prg": text } });
  deepEqual(
    result.diagnostics.map((found) => found.rule),
    ["dialect/unquoted-command-argument", "dialect/return-method", "dialect/obsolete-control", "dialect/sigil"],
  );
  for (const found of result.diagnostics.slice(0, 3)) {
    equal(found.fix, undefined, `${found.rule} must not have an unproven edit`);
  }
  const sigil = result.diagnostics[3]!;
  ok(sigil.fix !== undefined && sigil.fix.length > 0);
  const fixed = applyEdits(text, sigil.fix);
  equal(analyse(fixed).ok, true, JSON.stringify(analyse(fixed).diagnostics));
});

test("the dialect rules are off when their source is not supplied", () => {
  const result = lint(indexOf("#Dos\n"), { plugins });
  deepEqual(result.diagnostics, []);
});
