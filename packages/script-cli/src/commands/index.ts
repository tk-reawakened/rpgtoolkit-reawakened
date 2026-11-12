/**
 * `tkr script index` — write the TOOL-6 machine-readable index.
 */

import { buildIndex, type IndexDocument } from "@tk-reawakened/script-tools";
import { readFileSync, writeFileSync } from "node:fs";
import { collectSourceFiles } from "../files.ts";
import { emptySummary, makeResult, stableStringify, usageDiagnostic, type ResultDiagnostic, type ScriptResult } from "../result.ts";

export type IndexResult = {
  readonly result: ScriptResult;
  readonly text: string;
  /** One line saying what happened, for stderr when `--json` keeps stdout for the envelope. */
  readonly human: string;
};

export function runIndex(paths: readonly string[], check: boolean, out: string | null, json: boolean): IndexResult {
  const sources = collectSourceFiles(paths);
  const document = buildIndex(
    sources.map((file) => ({ name: file.name, ref: { kind: "inline", text: file.source, ir: "1" } })),
    {},
  );
  const summary = { ...emptySummary, files: sources.length };
  const rendered = stableStringify(document);
  const finish = (exitCode: 0 | 1 | 2, diagnostics: readonly ResultDiagnostic[], payload: unknown, human: string, printed: string = human): IndexResult => {
    const result = makeResult("index", exitCode, diagnostics, summary, payload);
    return { result, text: json ? stableStringify(result) : printed, human };
  };

  if (check) {
    // `--check` compares with the committed document, so it needs a file to compare with.
    if (out === null) {
      const message = "tkr script index --check needs --out <the committed index file>";
      return finish(2, [usageDiagnostic("<cli>", message)], { document, changed: false, written: null }, `${message}\n`);
    }
    let committed: string;
    try {
      committed = readFileSync(out, "utf8");
    } catch (error) {
      const message = `cannot read the committed index ${out}: ${error instanceof Error ? error.message : String(error)}`;
      return finish(2, [usageDiagnostic(out, message)], { document, changed: false, written: null }, `tkr script index: ${message}\n`);
    }
    const changed = committed !== rendered;
    return finish(changed ? 1 : 0, [], { document, changed, written: null }, changed ? `tkr script index: the index differs from ${out}\n` : `tkr script index: ${out} matches the index\n`);
  }
  if (out !== null) {
    writeFileSync(out, rendered, "utf8");
    return finish(0, [], { document, changed: false, written: out }, `tkr script index: wrote ${out}\n`);
  }
  return finish(0, [], { document, changed: false, written: null }, "tkr script index: wrote the index to stdout\n", rendered);
}
