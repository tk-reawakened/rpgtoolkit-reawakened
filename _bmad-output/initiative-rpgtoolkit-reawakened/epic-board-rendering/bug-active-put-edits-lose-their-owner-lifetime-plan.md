---
ticket: 36
status: in-progress
---

# Active Put edits lose their owner lifetime

## Implementation

Build the set of thread owners that remain active, then rebuild each affected cell's edit history in command order. Keep board-scoped edits and program edits whose owners are in that active set; a finished or unregistered (killed) owner expires. Rebase each kept edit's prior tile on the previous kept edit or the original board tile. Set each cell to its latest kept edit, or restore its original tile when none remain.

## Code map

- `packages/core/src/world/effects.ts`: expire program edits and retain the surviving ordered history.
- `packages/core/test/script-board-builtins.test.ts`: cover distinct cells, both completion orders for overlapping writes, board-scoped `LayerPut`, and a killed owner removed from the thread table.
- `docs/spec/engine/rpgcode-functions.md` and `docs/spec/engine/rpgcode-language.md#e-93`: record the normative tile edit order and thread finish/kill lifetime before the implementation.

## Acceptance

The active owner remains visible after another owner finishes; either completion order for overlapping writes restores the latest live edit and then the original tile; a killed overlapping owner expires even after it is unregistered, and board-scoped `LayerPut` remains visible.

## Verification

Regression tests were added for the reported, overlapping, and killed-owner cases but not run, as requested. The coordinator will run the repository checks once after this workstream lands.
