/**
 * `analyse`: the one entry that reports whether a program is valid, as the
 * TOOL-3 diagnostic model (docs/spec/engine/rpgcode-tooling.md#tool-3).
 *
 * It reads the buffer through the core compiler - `compileInline`, the same
 * path the engine uses for an in-memory program - so the scanner dialect, the
 * redirect table and the compile checks are identical to a run. The parser
 * throws on the first failure, so an invalid program yields exactly one
 * diagnostic, located at the token the compiler named.
 */

import { compileInline, ScriptError } from "@tk-reawakened/core";
import { rangeOf, type Diagnostic } from "./diagnostics.ts";

export type AnalyseOptions = {
  /** The file name a diagnostic carries; defaults to the compiler's `<inline>` key. */
  readonly file?: string;
};

export type Analysis = {
  readonly file: string;
  /** True when the buffer compiled; `diagnostics` is then empty. */
  readonly ok: boolean;
  readonly diagnostics: readonly Diagnostic[];
};

export function analyse(source: string, options: AnalyseOptions = {}): Analysis {
  const file = options.file ?? "<inline>";
  try {
    compileInline(source, file);
    return { file, ok: true, diagnostics: [] };
  } catch (error) {
    if (!(error instanceof ScriptError)) throw error;
    const pos = error.pos ?? { file, line: 1 };
    return {
      file,
      ok: false,
      diagnostics: [
        {
          code: error.code,
          severity: "error",
          range: rangeOf({ ...pos, file: pos.file === "" ? file : pos.file }, source),
          message: error.message,
        },
      ],
    };
  }
}
