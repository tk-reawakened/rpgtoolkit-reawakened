---
id: 9
type: bug
title: "Refuse a shade layer that under-covers the grid"
tracker_id: "#847"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/847"
parent: epic-deferred-work
created: '2026-10-31'
status: 'done'
baseline_revision: 'c8b7772f4d0c9d15fcd14f066dcaf16d1ca89d70'
route: 'oneshot'
route_source: 'auto'
risk: 'medium'
review: 'quick'
context: []
---

## Intent

`writeBoard` wrote each shade layer's records verbatim while `readBoard` consumes them until they cover the grid, so an under-covering layer was read into the following fields. The writer now refuses a short layer.

## Verification

- `node --test packages/core/test/format-board.test.ts`: 32 passed, 2 fixture skips; the new case refuses a half-covered layer with the layer index, the covered count and the section, and proves exact coverage still writes the same bytes.
- `pnpm typecheck`, `pnpm lint`, `pnpm golden` passed.
