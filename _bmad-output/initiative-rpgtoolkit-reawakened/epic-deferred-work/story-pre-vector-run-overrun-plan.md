---
id: 2
type: story
title: "Pin pre-vector board run-overrun behavior"
tracker_id: "#641"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/641"
parent: epic-deferred-work
status: ready-for-dev
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
