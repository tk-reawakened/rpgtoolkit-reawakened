/**
 * Project lint findings for one open document (TOOL-3; #2074;
 * docs/spec/engine/rpgcode-tooling.md#tool-1-project).
 *
 * The linter is the shared `lint()` of `script-tools`, run with the same
 * plugins and the project's `tkr-lint.json` as `tkr script check`. It runs only
 * for an assessed document whose buffer compiled, because a partial or
 * guessed reading would invent findings: in a Toolkit 2.x project `nope()` is
 * dialogue, not an unknown command.
 *
 * Index rules can report a finding from an include, but only give us a range.
 * Publish those findings only at sites unique to the document's own unit.
 * Parsed rules and text rules already check the document's own source.
 */

import type { ResolvedPlugin, ScriptDialect } from "@tk-reawakened/core";
import { lint, readLintConfig, type IndexDocument, type IndexPos, type IndexProgram, type LintConfig, type LintResult } from "@tk-reawakened/script-tools";

/** The code of the diagnostic that reports an unusable `tkr-lint.json`, as `tkr script check` does. */
export const CONFIG_CODE = "tkr.config";

const INDEX_RULES = new Set(["lint/unknown-command", "lint/command-arity", "lint/shadowed-builtin", "lint/unresolved-include"]);

export type LintConfigRead =
  | { readonly ok: true; readonly config: LintConfig }
  | { readonly ok: false; readonly message: string };

/** Read the project's lint configuration; absent is the defaults, malformed is a reported problem. */
export function readProjectLintConfig(file: { readonly uri: string; readonly text: string } | null): LintConfigRead {
  if (file === null) return { ok: true, config: {} };
  let value: unknown;
  try {
    value = JSON.parse(file.text);
  } catch (error) {
    return { ok: false, message: `tkr-lint.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const parsed = readLintConfig(value);
  return parsed.ok ? { ok: true, config: parsed.config } : { ok: false, message: `tkr-lint.json: ${parsed.problems.join("; ")}` };
}

function siteKey(line: number, column: number): string {
  return `${line}:${column}`;
}

/** Every site start of the program, with the units it occurs in. */
function siteUnits(program: IndexProgram): Map<string, Set<string>> {
  const units = new Map<string, Set<string>>();
  // A site's range starts at its column only when it has both ends (`rangeOf`); otherwise at column 1.
  const add = (unit: string, line: number, col: number | undefined, endCol?: number): void => {
    const key = siteKey(line, col !== undefined && endCol !== undefined ? col : 1);
    const set = units.get(key) ?? new Set<string>();
    set.add(unit);
    units.set(key, set);
  };
  const addPos = (pos: IndexPos): void => add(pos.file, pos.line, pos.col, pos.endCol);
  for (const call of program.calls) addPos(call.pos);
  for (const reference of program.references) addPos(reference.pos);
  for (const listener of program.listeners) addPos(listener.pos);
  for (const include of program.includes) add(include.file, include.line, include.col, include.endCol);
  for (const fn of program.functions) add(fn.file, fn.line, fn.col, fn.endCol);
  for (const label of program.labels) add(label.file, label.line, label.col, label.endCol);
  for (const cls of program.classes) {
    add(cls.file, cls.line, cls.col, cls.endCol);
    for (const member of cls.members) add(cls.file, member.line, member.col, member.endCol);
    for (const method of cls.methods) add(cls.file, method.line, method.col, method.endCol);
  }
  return units;
}

/**
 * The findings for `program` that belong to its own unit. `source` is the
 * document text; the text-based dialect rules run on it only for a 3.1 project,
 * because in a Toolkit 2.x project that syntax is the program's own dialect.
 */
export function documentLint(
  program: IndexProgram,
  source: string,
  dialect: ScriptDialect,
  plugins: readonly ResolvedPlugin[],
  config: LintConfig,
): Pick<LintResult, "diagnostics" | "summary"> {
  const document: IndexDocument = { schema: "tkr-index/1.0", programs: [program], diagnostics: [] };
  const result = lint(document, {
    plugins,
    config,
    dialect,
    ...(dialect === "tk3" && program.diagnostics.length === 0 ? { sources: { [program.name]: source } } : {}),
    resolveIncludes: true,
  });
  const units = siteUnits(program);
  const diagnostics = result.diagnostics.filter((found) => {
    if (!INDEX_RULES.has(found.code)) return true;
    const at = units.get(siteKey(found.range.start.line, found.range.start.column));
    return at?.size === 1 && at.has(program.key);
  });
  return { diagnostics, summary: result.summary };
}
