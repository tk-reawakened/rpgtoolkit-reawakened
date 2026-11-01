/**
 * `tkr script docs` — generate a quick reference from the registered catalogue.
 */

import { FIRST_PARTY_PLUGINS, type ResolvedPlugin } from "@tk-reawakened/core";
import { projectHelp } from "@tk-reawakened/script-tools";
import { readFileSync, writeFileSync } from "node:fs";
import { emptySummary, makeResult, stableStringify, type ScriptResult } from "../result.ts";

const plugins: ResolvedPlugin[] = FIRST_PARTY_PLUGINS.map((definition) => ({ definition }));

export type DocsResult = {
  readonly result: ScriptResult;
  readonly text: string;
};

function renderQuickReference(): string {
  const entries = projectHelp(plugins);
  const lines: string[] = ["# RPGCode quick reference", ""];
  for (const entry of entries) {
    const alias = entry.isAlias ? ` (alias of \`${entry.canonicalName}\`)` : "";
    const params = entry.params.map((p) => p.variadic ? `[${p.name}...]` : p.byRef ? `&${p.name}` : p.name).join(", ");
    lines.push(`## \`${entry.name}\`${alias}`);
    lines.push("");
    lines.push(`${entry.summary}`);
    lines.push("");
    lines.push(`Parameters: \`${params}\``);
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

export function runDocs(check: boolean, out: string | null, json: boolean): DocsResult {
  const rendered = renderQuickReference();

  let changed = false;
  let writtenPath: string | null = null;

  if (check) {
    const baselinePath = out ?? "baselines/tkr-script-docs.md";
    const baseline = readFileSync(baselinePath, "utf8");
    changed = baseline !== rendered;
  } else if (out !== null) {
    writeFileSync(out, rendered, "utf8");
    writtenPath = out;
  }

  const exitCode = check && changed ? 1 : 0;
  const result = makeResult("docs", exitCode, [], emptySummary, { reference: rendered, changed, written: writtenPath });
  const text = json ? stableStringify(result) : rendered;
  return { result, text };
}
