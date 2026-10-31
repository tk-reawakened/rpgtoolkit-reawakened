---
title: "Correct the loader page's claim about restore hydration"
ticket: 19
status: done
---

## Intent

`docs/spec/engine/rpgcode-package-loader.md` claimed the engine owns no saved-state hydration and told a restore
host to rebuild package startups itself. The merged engine does it inside `applyLoadedGame`
(`packages/core/src/engine/engine.ts:928`), so a host following the page rebuilt them a second time.

## Implementation Notes

Docs-only, one paragraph. The replacement states what the engine does — scratch-state startup, `restore.shape` on
an installed start-up failure, hydration, startup against the restored services, restored programs compiled, VM
handles verified — names the code reference, and keeps `SavedGamePort.restored()` as the skip-initial-board signal
only. It is marked as an implementation note for entry 19.19 / issue #850: it records merged behaviour and invents
no owner ruling.

## Verification

- Read against `applyLoadedGame` at `packages/core/src/engine/engine.ts:928-968` on `50fd8d35`; every clause in
  the new sentence maps to a call in that function (`createPluginLayers`, `makeServices(..., true, ...)`,
  `restore.shape`, `Object.assign(state, candidate)`, `runPackageStartup`, `compileRestoredPrograms`,
  `verifyRestoredHandles`).
- Docs-only gates: `pnpm provenance` and `pnpm lint` green; no code, test, golden, lockfile or CI file changes.

## Notes

No owner attribution or date is added; the sentence is attributed to the ticket. No spec rule changes.

## Merged

PR #861 merged by squash as `02fb6fa0447149f8b4ead09d469dcfae72370149` (in `origin/main`); issue #850 closed
completed by that merge. Docs-only: `pnpm provenance` (715 files, 0 violations) and `pnpm lint` green.
