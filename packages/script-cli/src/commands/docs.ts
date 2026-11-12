/**
 * `tkr script docs` — generate the quick reference and the language reference from the
 * registered catalogue (docs/spec/engine/rpgcode-tooling.md#tool-9, `commandDocumentation()`).
 *
 * Both parts come from one source, the plugin registration metadata the command-docs gate already
 * validates, and are plain Markdown with no date, path or counter in them, so the same catalogue gives the
 * same bytes. The language reference is searchable as text: every command has one `## ` heading named by its
 * spelling, and the contents list at the top holds each spelling once in alphabetical order.
 */

import { FIRST_PARTY_PLUGINS, foldAscii, type CommandParamDocumentation, type ResolvedPlugin } from "@tk-reawakened/core";
import { projectHelp, type HelpEntry } from "@tk-reawakened/script-tools";
import { readFileSync, writeFileSync } from "node:fs";
import { emptySummary, makeResult, stableStringify, usageDiagnostic, type ScriptResult } from "../result.ts";

const plugins: ResolvedPlugin[] = FIRST_PARTY_PLUGINS.map((definition) => ({ definition }));

export type DocsResult = {
  readonly result: ScriptResult;
  readonly text: string;
  /** One line saying what happened, for stderr when `--json` keeps stdout for the envelope. */
  readonly human: string;
};

function paramLabel(param: CommandParamDocumentation): string {
  return param.variadic ? `[${param.name}...]` : param.byRef ? `&${param.name}` : param.name;
}

function renderQuickReference(entries: readonly HelpEntry[]): string {
  const lines: string[] = ["# RPGCode quick reference", ""];
  for (const entry of entries) {
    const alias = entry.isAlias ? ` (alias of \`${entry.canonicalName}\`)` : "";
    lines.push(`## \`${entry.name}\`${alias}`);
    lines.push("");
    lines.push(`${entry.summary}`);
    lines.push("");
    lines.push(`Parameters: \`${entry.params.map(paramLabel).join(", ")}\``);
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

function compareFolded(left: string, right: string): number {
  const a = foldAscii(left);
  const b = foldAscii(right);
  if (a !== b) return a < b ? -1 : 1;
  return left === right ? 0 : left < right ? -1 : 1;
}

function paramDetails(param: CommandParamDocumentation): string {
  const parts: string[] = [];
  if (param.summary !== null) parts.push(param.summary);
  if (param.type !== null) parts.push(`Type: ${param.type}.`);
  if (param.unit !== null) parts.push(`Unit: ${param.unit}.`);
  if (param.optional) parts.push("Optional.");
  if (param.default !== null) parts.push(`Default: ${param.default}`);
  if (param.ifOmitted !== null) parts.push(`If omitted: ${param.ifOmitted}`);
  if (param.range !== null) {
    const bounds = [param.range.min === undefined ? null : `at least ${param.range.min}`, param.range.max === undefined ? null : `at most ${param.range.max}`].filter((part) => part !== null);
    parts.push(`Range: ${[...bounds, param.range.note ?? null].filter((part) => part !== null).join(", ")}.`);
  }
  for (const value of param.values) parts.push(`\`${value.value}\`: ${value.summary}`);
  return parts.join(" ");
}

function renderLanguageReference(entries: readonly HelpEntry[]): string {
  const lines: string[] = ["# RPGCode language reference", ""];
  const spellings = entries.map((entry) => entry.name).sort(compareFolded);
  lines.push("Contents:", "");
  for (const name of spellings) lines.push(`- \`${name}\``);
  lines.push("");
  for (const entry of [...entries].sort((left, right) => compareFolded(left.name, right.name))) {
    lines.push(`## \`${entry.name}\``, "");
    if (entry.isAlias) lines.push(`Alias of \`${entry.canonicalName}\`.`, "");
    lines.push(`Syntax: \`${entry.name}(${entry.params.map(paramLabel).join(", ")})\``, "");
    if (entry.summary !== null) lines.push(entry.summary, "");
    if (entry.behaviour !== null) lines.push(entry.behaviour, "");
    if (entry.params.length > 0) {
      lines.push("Parameters:", "");
      for (const param of entry.params) lines.push(`- \`${paramLabel(param)}\`${paramDetails(param) === "" ? "" : `: ${paramDetails(param)}`}`);
      lines.push("");
    }
    if (entry.returns !== null) lines.push(`Returns: ${entry.returns.summary}${entry.returns.unit === undefined ? "" : ` (${entry.returns.unit})`}`, "");
    if (entry.waits !== null) lines.push(`Waits (${entry.waits.kind}): ${entry.waits.summary}`, "");
    if (entry.throws.length > 0) {
      lines.push("Errors:", "");
      for (const thrown of entry.throws) lines.push(`- \`${thrown.code}\`: ${thrown.when}`);
      lines.push("");
    }
    if (entry.examples.length > 0) {
      lines.push("Examples:", "");
      for (const example of entry.examples) {
        const code = typeof example === "string" ? example : example.code;
        lines.push("```", code, "```", "");
        if (typeof example !== "string" && example.caption !== undefined) lines.push(example.caption, "");
        if (typeof example !== "string" && example.result !== undefined) lines.push(`Result: ${example.result}`, "");
      }
    }
    if (entry.replacedBy !== null) lines.push(`Replaced by: ${entry.replacedBy.kind === "command" ? `\`${entry.replacedBy.name}\`` : entry.replacedBy.text}${entry.reason === null ? "" : ` (${entry.reason})`}`, "");
    if (entry.see.length > 0) lines.push(`See: ${entry.see.join(", ")}`, "");
  }
  return lines.join("\n") + "\n";
}

/** The whole generated reference: the quick reference, then the language reference. */
export function renderReference(): string {
  const entries = projectHelp(plugins);
  return `${renderQuickReference(entries)}\n${renderLanguageReference(entries)}`;
}

export function runDocs(check: boolean, out: string | null, json: boolean): DocsResult {
  const rendered = renderReference();
  const finish = (exitCode: 0 | 1 | 2, diagnostics: ScriptResult["diagnostics"], payload: unknown, human: string, printed: string = human): DocsResult => {
    const result = makeResult("docs", exitCode, diagnostics, emptySummary, payload);
    return { result, text: json ? stableStringify(result) : printed, human };
  };

  if (check) {
    // `--check` compares with the committed reference, so it needs a file to compare with.
    if (out === null) return finish(2, [usageDiagnostic("<cli>", "tkr script docs --check needs --out <the committed reference file>")], { reference: "", changed: false, written: null }, "tkr script docs: --check needs --out <the committed reference file>\n");
    let committed: string;
    try {
      committed = readFileSync(out, "utf8");
    } catch (error) {
      const message = `cannot read the committed reference ${out}: ${error instanceof Error ? error.message : String(error)}`;
      return finish(2, [usageDiagnostic(out, message)], { reference: "", changed: false, written: null }, `tkr script docs: ${message}\n`);
    }
    const changed = committed !== rendered;
    return finish(changed ? 1 : 0, [], { reference: rendered, changed, written: null }, changed ? `tkr script docs: the generated reference differs from ${out}\n` : `tkr script docs: ${out} matches the generated reference\n`);
  }
  if (out !== null) {
    writeFileSync(out, rendered, "utf8");
    return finish(0, [], { reference: rendered, changed: false, written: out }, `tkr script docs: wrote ${out}\n`);
  }
  return finish(0, [], { reference: rendered, changed: false, written: null }, "tkr script docs: wrote the reference to stdout\n", rendered);
}
