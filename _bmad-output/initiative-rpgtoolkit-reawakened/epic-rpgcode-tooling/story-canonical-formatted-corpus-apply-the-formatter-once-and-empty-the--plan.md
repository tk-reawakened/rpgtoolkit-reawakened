---
title: "Canonical-formatted corpus: apply the formatter once and empty the baseline"
ticket: 13
status: done
---

## Intent

Make `tkr script fmt --check` a gate. The formatter (10.7) proved the rewrite is behaviour-preserving, but the corpus was still non-canonical, so the baseline recorded thirty files that would change. This entry applies that rewrite once, as a reviewable data change, and leaves the baseline empty.

## Findings settled first

1. **A TK2 file's text is data.** Six authored battle/program fixtures are Toolkit 2.x loose-text programs: a bare line is dialogue, so a 3.1 rewrite changes what the game says. The formatter now takes a required `dialect`; for `tk2` it returns the source byte-identical with `reason: "tk2-dialect"`, and `formatCheck` reports those files as **skipped with the reason**, never as clean. TOOL-4 records that the formatter is a 3.1 formatter and that converting TK2 text is the quick fixes' job.
2. **R-42 moves a hash for a text-only edit.** Saved state carries each program's source hash, so formatting a program moves its per-tick hashes even with identical lowered instructions. The zelda and ff rows of `golden/actors/battle-scripts.json` and one pinned hash in `battle-custom-program.test.ts` were re-recorded, each with a comment stating the cause.

## What changed

- `formatSource(source, { dialect })`, `formatChanged`, `formatCheck`; TOOL-4's dialect paragraph.
- 24 corpus files rewritten (49 checked 3.1 files, 25 already canonical), 6 TK2 files untouched by the guard.
- `golden/format-baseline.json` is now `{ checked: 49, tk2: 6, wouldChange: [] }`, and the test fails if any 3.1 file stops being canonical or a TK2 file is counted as clean.

## Landing

Merged as **`17b375555f2d38a4ae720e5a74a0786c8d6d01dd`** — "chore(10.13): canonical corpus, dialect guard and the hashes R-42 moves" (PR [#997](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/997), squash). Issue #996 closed.

24 files rewritten, 25 already canonical, 6 TK2 files refused by the dialect guard; `golden/format-baseline.json` is empty (`checked: 49`, `tk2: 6`, `wouldChange: []`). The zelda/ff per-tick rows and one custom-program hash were re-recorded because R-42 puts each program's source hash in the saved state, with the cause stated beside them; no engine golden moved.

The CI failure that first blocked it was a real defect: the commit's pathspec omitted `stock/`, so the baseline claimed canonical text while the committed files were not, and the unit shard had also been reading the fetched corpus. Both fixed; the shard was verified green in a fixture-free checkout.
