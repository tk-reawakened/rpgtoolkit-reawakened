/**
 * `tkr script index` — write the TOOL-6 machine-readable index.
 */

import { buildIndex, type IndexDocument } from "@tk-reawakened/script-tools";
import { readFileSync, writeFileSync } from "node:fs";
import { collectSourceFiles } from "../files.ts";
import { emptySummary, makeResult, stableStringify, type ScriptResult } from "../result.ts";

export type IndexResult = {
  readonly result: ScriptResult;
  readonly text: string;
};

export function runIndex(paths: readonly string[], check: boolean, out: string | null, json: boolean): IndexResult {
  const sources = collectSourceFiles(paths);
  const document = buildIndex(
    sources.map((file) => ({ name: file.name, ref: { kind: "inline", text: file.source, ir: "1" } })),
    {},
  );

  const rendered = stableStringify(document);
  let changed = false;
  let writtenPath: string | null = null;

  if (check) {
    const baselinePath = out ?? "baselines/tkr-script-index.json";
    const baseline = readFileSync(baselinePath, "utf8");
    changed = baseline !== rendered;
  } else if (out !== null) {
    writeFileSync(out, rendered, "utf8");
    writtenPath = out;
  }

  const summary = { ...emptySummary, files: sources.length };
  const exitCode = check && changed ? 1 : 0;
  const result = makeResult("index", exitCode, [], summary, { document, changed, written: writtenPath });
  const text = json ? stableStringify(result) : rendered;
  return { result, text };
}
