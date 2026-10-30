---
ticket: 36
type: bug
status: in-progress
---

# Active Put edits lose their owner lifetime

## Implementation

Rebuild each affected cell's edit history in command order. Keep board-scoped edits and program edits whose owners remain active, and rebase each kept edit's prior tile on the previous kept edit or the original board tile. Set each cell to its latest kept edit, or restore its original tile when none remain.

## Code map

- `packages/core/src/world/effects.ts`: expire program edits and retain the surviving ordered history.
- `packages/core/test/script-board-builtins.test.ts`: cover distinct cells, both completion orders for overlapping writes, and board-scoped `LayerPut`.
- `docs/spec/engine/rpgcode-functions.md`: record the normative tile edit lifetime and overlap order before the implementation.

## Acceptance

The active owner remains visible after another owner finishes; either completion order for overlapping program edits restores the latest live edit and then the original tile; board-scoped `LayerPut` survives program expiry.

## Verification

Regression tests were added but not run, as requested. The coordinator will run the repository checks once after this workstream lands.
