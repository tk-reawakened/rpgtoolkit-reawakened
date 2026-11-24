import type { LineChange } from "@tk-reawakened/editor-model";

/**
 * One block of a comparison the reviewer reads: changed lines with the unchanged lines around them, or a run of
 * unchanged lines folded into a count so a long program shows only what moves.
 */
export type DiffBlock =
  | { readonly kind: "lines"; readonly lines: readonly (LineChange & { readonly original: number | null; readonly result: number | null })[] }
  | { readonly kind: "folded"; readonly count: number };

/** `context` unchanged lines are kept on each side of a change; a longer unchanged run is folded. */
export function diffBlocks(changes: readonly LineChange[], context = 2): readonly DiffBlock[] {
  let original = 0;
  let result = 0;
  const numbered = changes.map((change) => {
    const before = change.kind === "added" ? null : ++original;
    const after = change.kind === "removed" ? null : ++result;
    return { ...change, original: before, result: after };
  });
  const keep = numbered.map(() => false);
  numbered.forEach((change, index) => {
    if (change.kind === "same") return;
    for (let near = Math.max(0, index - context); near <= Math.min(numbered.length - 1, index + context); near += 1) keep[near] = true;
  });
  const blocks: DiffBlock[] = [];
  let run: (typeof numbered)[number][] = [];
  let folded = 0;
  const flush = (): void => {
    if (run.length > 0) blocks.push({ kind: "lines", lines: run });
    run = [];
  };
  numbered.forEach((change, index) => {
    if (keep[index]!) {
      if (folded > 0) {
        flush();
        blocks.push({ kind: "folded", count: folded });
        folded = 0;
      }
      run.push(change);
    } else {
      folded += 1;
    }
  });
  flush();
  if (folded > 0) blocks.push({ kind: "folded", count: folded });
  return blocks;
}
