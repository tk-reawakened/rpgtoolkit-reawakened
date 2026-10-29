---
id: 2
type: story
title: "Pin pre-vector board run-overrun behavior"
tracker_id: "#641"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/641"
parent: epic-deferred-work
status: done
context: ["spec - docs/spec/formats/board.md", "ledger - deferred-work.md lines 170-175"]
---

# Pin pre-vector board run-overrun behavior

## Goal
Protect the documented legacy behavior when a pre-vector board run marker exceeds the remaining board cells.

## Acceptance
1. Use a hand-authored byte fixture that places an overrun run marker near the end of the board; do not construct the fixture with the writer under test.
2. Assert the resulting cells and warning behavior required by the board format specification.
3. Retain the existing negative-LUT-index refusal coverage without duplicating it.
4. The test fails on silent truncation, writing beyond the logical board, or omission of the specified warning.

## Verification
Run the focused board-format tests and the headless golden suite.

## Exclusions
No format change, no writer changes, no unrelated board parser refactor.

## Plan Change Log

- 2026-10-28 (completed): marked ticket done following merge of PR #729 (`4ff93c93`, Fixes #641), whose CI run was green on every job including `golden` and `golden-bun`. Acceptance is covered by `packages/core/test/format-board-pre-vector.test.ts:316` ("pre-vector final runs clamp to the grid, warn, and leave following fields aligned"), which builds the bytes by hand, asserts the clamped cells, the `tile matrix run covers 17 cells but only 11 remained` warning (and that an exactly-fitting run stays silent) and the following-field alignment; the negative-LUT refusal stays covered once, by `packages/core/test/format-board.test.ts:722`. The rule itself landed doc-first in `docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector` ("Overlong final runs") from owner-relayed extraction round 13 (`docs/provenance/facts-round-13.md`); no runtime behavior or golden file changed.

