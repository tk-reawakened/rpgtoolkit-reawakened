/**
 * RPGCode line coverage of a spec run (TOOL-5, docs/spec/engine/rpgcode-tooling.md#tool-5-coverage).
 *
 * A `CoverageProbe` watches one counted run. The VM's step observer fires before each instruction runs, when the
 * running thread's top frame still points at it, so the probe reads the exact program and instruction index from
 * the frame (never a guess from source positions) and counts it. At the end of the run, a line's count is the
 * largest count of any one instruction on it; every instruction of a listed file makes its line executable, so the
 * lines of uncalled functions are listed with 0. Runs then add up line by line.
 *
 * Nothing here enters the simulation: the counts live on the host beside the run (G1, G3).
 */

import type { Program, ScriptServices, VmState } from "@tk-reawakened/core";

export type SpecLineCoverage = { readonly line: number; readonly hits: number };
export type SpecFileCoverage = { readonly file: string; readonly lines: readonly SpecLineCoverage[] };
export type SpecCoverage = { readonly files: readonly SpecFileCoverage[] };

/** Per file path, per executable line, the count. */
export type LineCounts = Map<string, Map<number, number>>;

/**
 * Where an instruction's position belongs: the project path of its file, or `null` for a line that is not
 * reported (the bundled library, the lines the runner appends).
 */
export type PositionFilter = (file: string, line: number) => string | null;

export type CoverageProbe = {
  /** The step observer: count the instruction `threadId`'s top frame is about to run. */
  readonly step: (threadId: number) => void;
  /** This run's line counts: per line, the largest count of any one of its instructions. */
  readonly finish: () => LineCounts;
};

export function createCoverageProbe(vm: () => VmState, services: () => ScriptServices, place: PositionFilter): CoverageProbe {
  const counts = new Map<Program, number[]>();
  return {
    step: (threadId) => {
      const thread = vm().threads.find((item) => item.id === threadId);
      const frame = thread?.frames[thread.frames.length - 1];
      if (frame === undefined) return;
      const program = services().programs.get(frame.program);
      let perOp = counts.get(program);
      if (perOp === undefined) {
        perOp = new Array<number>(program.ops.length).fill(0);
        counts.set(program, perOp);
      }
      if (frame.ip >= 0 && frame.ip < perOp.length) perOp[frame.ip]! += 1;
    },
    finish: () => {
      const lines: LineCounts = new Map();
      for (const [program, perOp] of counts) {
        // A `return` outside every statement's range is the one the compiler adds at the end of a body or file: it
        // is not a statement and makes no line executable (TOOL-5 coverage rule 2).
        const inStatement = new Array<boolean>(program.ops.length).fill(false);
        for (const range of program.statements) for (let at = range.start; at < range.end; at += 1) inStatement[at] = true;
        program.ops.forEach((op, index) => {
          if (op.op === "return" && !inStatement[index]) return;
          const file = place(op.pos.file, op.pos.line);
          if (file === null) return;
          let fileLines = lines.get(file);
          if (fileLines === undefined) {
            fileLines = new Map();
            lines.set(file, fileLines);
          }
          fileLines.set(op.pos.line, Math.max(fileLines.get(op.pos.line) ?? 0, perOp[index]!));
        });
      }
      return lines;
    },
  };
}

/** Add `from` into `into`, line by line; a line only one side lists keeps its count. */
export function addCounts(into: LineCounts, from: LineCounts): void {
  for (const [file, fromLines] of from) {
    let intoLines = into.get(file);
    if (intoLines === undefined) {
      intoLines = new Map();
      into.set(file, intoLines);
    }
    for (const [line, hits] of fromLines) intoLines.set(line, (intoLines.get(line) ?? 0) + hits);
  }
}

const byCodeUnit = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

/** The public, ordered form: files by path in code-unit order, lines ascending. */
export function toCoverage(counts: LineCounts): SpecCoverage {
  return {
    files: [...counts.keys()].sort(byCodeUnit).map((file) => ({
      file,
      lines: [...counts.get(file)!].sort((left, right) => left[0] - right[0]).map(([line, hits]) => ({ line, hits })),
    })),
  };
}

/** Read public coverage back into counts, so reports can be added up. */
export function fromCoverage(coverage: SpecCoverage): LineCounts {
  return new Map(coverage.files.map((file) => [file.file, new Map(file.lines.map((item) => [item.line, item.hits]))]));
}

/** Sum several coverages line by line (a project report is the sum of its file reports). */
export function mergeCoverage(coverages: readonly SpecCoverage[]): SpecCoverage {
  const total: LineCounts = new Map();
  for (const coverage of coverages) addCounts(total, fromCoverage(coverage));
  return toCoverage(total);
}

/**
 * LCOV text (TOOL-5 coverage rule 6): per file `SF:`, one `DA:<line>,<count>` per executable line, `LF:`, `LH:` and
 * `end_of_record`, each line ending in `\n`. Coverage with no files is the empty text.
 */
export function toLcov(coverage: SpecCoverage): string {
  let text = "";
  for (const file of coverage.files) {
    text += `SF:${file.file}\n`;
    for (const item of file.lines) text += `DA:${item.line},${item.hits}\n`;
    text += `LF:${file.lines.length}\n`;
    text += `LH:${file.lines.filter((item) => item.hits > 0).length}\n`;
    text += "end_of_record\n";
  }
  return text;
}
