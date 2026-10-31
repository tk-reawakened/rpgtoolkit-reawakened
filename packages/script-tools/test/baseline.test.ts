import { deepEqual } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { FIRST_PARTY_PLUGINS, type ResolvedPlugin } from "@tk-reawakened/core";
import { buildIndex, lint, type Diagnostic } from "../src/index.ts";

/**
 * The dogfooding baseline (TOOL-7, G5): the linter's findings over `stock/`,
 * committed and reviewed like a golden. A change here is a change to what this
 * repository's own RPGCode reports, so it is deliberate and visible in the diff.
 * The `resolveIncludes` rule is off: stock's scripts name files this repository
 * does not ship, and without a game tree "missing" cannot be told from "elsewhere".
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const baseline = JSON.parse(readFileSync(join(repoRoot, "golden/lint-baseline.json"), "utf8")) as {
  readonly files: readonly string[];
  readonly diagnostics: readonly { readonly file: string; readonly rule: string | undefined; readonly line: number; readonly column: number; readonly message: string }[];
};

const plugins: ResolvedPlugin[] = FIRST_PARTY_PLUGINS.map((definition) => ({ definition }));

function records(): { readonly file: string; readonly rule: string | undefined; readonly line: number; readonly column: number; readonly message: string }[] {
  const found: { file: string; rule: string | undefined; line: number; column: number; message: string }[] = [];
  for (const file of baseline.files) {
    const text = readFileSync(join(repoRoot, file), "utf8");
    const document = buildIndex([{ name: file, ref: { kind: "inline", text, ir: "1" } }]);
    const result = lint(document, { plugins, sources: { [file]: text } });
    for (const diagnostic of result.diagnostics as readonly Diagnostic[]) {
      found.push({ file, rule: diagnostic.rule, line: diagnostic.range.start.line, column: diagnostic.range.start.column, message: diagnostic.message });
    }
  }
  return found;
}

test("stock/ reports exactly the committed baseline", () => {
  deepEqual(records(), baseline.diagnostics);
});

test("the baseline is empty because every stock name resolves (not because the rules are off)", () => {
  deepEqual(baseline.diagnostics, []);
  const text = "nope()\n";
  const document = buildIndex([{ name: "probe.prg", ref: { kind: "inline", text, ir: "1" } }]);
  deepEqual(lint(document, { plugins }).diagnostics.map((found) => found.rule), ["lint/unknown-command"]);
});
