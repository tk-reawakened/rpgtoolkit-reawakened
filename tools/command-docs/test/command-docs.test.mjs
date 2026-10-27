import { deepEqual, equal, match, throws } from "node:assert/strict";
import { test } from "node:test";
import { parseSpecTable } from "../spec-table.mjs";
import { check } from "../check.mjs";

const command = (name, doc) => ({ name, aliases: [], params: [], call: () => ({ value: null }), ...(doc === undefined ? {} : { doc }) });
const plugin = (id, commands) => ({ definition: { id, version: "1.0.0", commands } });

test("spec parser preserves punctuation, aliases, obsolete notes and sections", () => {
  const rows = parseSpecTable(`## Fixtures\n\n| Command | Signature | Purpose | Notes |\n|---|---|---|---|\n| \`canonical\` | void canonical() | Keep commas, periods and (parentheses). |  |\n| \`alias\` | void alias() | Keep commas, periods and (parentheses). | alias of \`canonical\` |\n| \`old\` | void old() | Obsolete. | obsolete: raises an error |\n`);
  deepEqual(rows, [
    { name: "canonical", purpose: "Keep commas, periods and (parentheses).", section: "Fixtures" },
    { name: "alias", purpose: "Keep commas, periods and (parentheses).", section: "Fixtures", aliasOf: "canonical" },
    { name: "old", purpose: "Obsolete.", section: "Fixtures", obsolete: true },
  ]);
});

test("spec parser rejects malformed command rows", () => {
  throws(() => parseSpecTable("## Fixtures\n| Command | Signature | Purpose | Notes |\n|---|---|---|---|\n| not backticked | void x() | Purpose |  |"), /malformed command name/);
});

test("check accepts documented synthetic commands", () => {
  const result = check({
    plugins: [plugin("fixture", [command("hello", { summary: "Say hello.", behaviour: "Writes one line and does not wait." })])],
    rows: [{ name: "hello", purpose: "Say hello." }],
    allowlist: [],
  });
  deepEqual(result.diagnostics, []);
  equal(result.documentation[0].name, "hello");
});

test("check projects independent tags, alias tags and runner support", () => {
  const result = check({
    plugins: [plugin("fixture", [({
      ...command("hello", {
        summary: "Say hello.",
        behaviour: "Writes one line and does not wait.",
        tags: ["legacy", "deprecated"],
        replacedBy: { kind: "command", name: "hello" },
        reason: "Use the maintained spelling.",
        support: { headless: { level: "full" } },
      }),
      aliases: ["hi"],
    })])],
    rows: [{ name: "hello", purpose: "Say hello." }],
    allowlist: [],
  });
  deepEqual(result.diagnostics, []);
  deepEqual(result.documentation.map((entry) => entry.tags), [["legacy", "deprecated"], ["legacy", "deprecated", "alias"]]);
  deepEqual(result.documentation[0].support, { headless: { level: "full" } });
});

test("check reports missing support notes", () => {
  const result = check({
    plugins: [plugin("fixture", [command("hello", {
      summary: "Say hello.",
      behaviour: "Writes one line and does not wait.",
      support: { headless: { level: "partial" } },
    })])],
    rows: [{ name: "hello", purpose: "Say hello." }],
    allowlist: [],
  });
  equal(result.diagnostics.some((item) => item.code === "support.note"), true);
});

test("check reports missing docs and native summary mismatch", () => {
  const result = check({
    plugins: [plugin("fixture", [command("missing"), command("hello", { summary: "Wrong.", behaviour: "No wait." })])],
    rows: [{ name: "hello", purpose: "Say hello." }],
    allowlist: [],
  });
  equal(result.diagnostics.some((item) => item.code === "doc.required" && item.key === "fixture/missing"), true);
  equal(result.diagnostics.some((item) => item.code === "native.summary-mismatch" && item.key === "fixture/hello"), true);
});

test("check rejects duplicate and stale allowlist keys", () => {
  const result = check({ plugins: [plugin("fixture", [command("old")])], rows: [], allowlist: ["fixture/old", "fixture/old", "fixture/missing"] });
  equal(result.diagnostics.some((item) => item.code === "allowlist.duplicate"), true);
  equal(result.diagnostics.some((item) => item.code === "allowlist.stale" && item.key === "fixture/missing"), true);
});

test("check requires every public battle built-in and alias to have a spec row", () => {
  const doc = { summary: "Set it.", behaviour: "No wait." };
  const battle = [{ ...command("known", doc), aliases: ["knownalias"] }, command("fixturemissing", doc), command("__internal", { ...doc, access: "internal" })];
  const result = check({ plugins: [plugin("battle", battle)], rows: [{ name: "known", purpose: "Set it." }], allowlist: [] });
  const missing = result.diagnostics.filter((item) => item.code === "native.row-missing").map((item) => item.key).sort();
  deepEqual(missing, ["battle/fixturemissing", "battle/knownalias"]);
  const other = check({ plugins: [plugin("fixture", [command("norow", doc)])], rows: [], allowlist: [] });
  equal(other.diagnostics.some((item) => item.code === "native.row-missing"), false);
});
