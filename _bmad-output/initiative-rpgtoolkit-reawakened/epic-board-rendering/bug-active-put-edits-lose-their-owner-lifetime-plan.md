---
ticket: 36
status: done
---

# Active Put edits lose their owner lifetime

## Implementation
At end-of-phase cleanup, build the set of active thread owners and rebuild each affected cell's history in command order. Keep board-scoped edits and program edits whose owners are active, rebase each retained edit on the previous survivor or original board tile, then show the latest survivor. When a thread is removed early, synchronously expire its edits before any subsequent engine work can reuse its numeric id; do not change thread-id allocation.

## Code map
- `packages/core/src/script/vm.ts`: expose the `onThreadRemoved` cleanup hook and invoke it after a successful `threadKill`.
- `packages/core/src/events/dispatch.ts` and `packages/core/src/script/package-startup.ts`: notify the same hook after removing threads in their lifecycle paths.
- `packages/core/src/engine/engine.ts`: wire the callback and expire edits after item/board lifecycle removals.
- `packages/core/src/world/effects.ts`: expire finished or absent owners at end of phase and retain the surviving ordered history.
- `packages/core/test/script-board-builtins.test.ts`: cover distinct cells, both completion orders, `LayerPut`, and killing the highest-id owner before same-phase id reuse.
- `docs/spec/engine/rpgcode-functions.md`: record the normative tile edit order and synchronous removal lifetime before implementation.

## Acceptance

The active owner remains visible after another finishes; overlapping writes restore the latest live edit in either completion order; the highest-id killed owner's edit expires before same-phase id reuse; board-scoped `LayerPut` remains visible.

## Verification

Regression tests cover reported, overlapping, and same-phase killed-owner reuse cases.

Merged PR #795 as `240af5f43926bed8d1d7851a3ef80ab6eac465f9`. Focused board and thread tests passed 34/34; the full strict suite passed 2305 tests with no skips, together with typecheck, lint, goldens, graph, catalogue, command-docs, licence, provenance and corpus checks. GitHub CI and the required gate passed on `d5faeb83`.
