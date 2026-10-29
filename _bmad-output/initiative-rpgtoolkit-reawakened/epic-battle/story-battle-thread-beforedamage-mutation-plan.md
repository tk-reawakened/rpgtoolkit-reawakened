---
title: "Battle-thread beforeDamage mutation"
ticket: 14
status: done
---

# Battle-thread beforeDamage mutation

## Delivery

- Delivered by PR #608 (`fca7a7f9`, "feat(battle): add cancelable beforeDamage seam"), merged 2026-10-23T17:57:41Z; issue #565 closed COMPLETED at that merge.
- The seam lands where the ticket ruled it belongs: `stock/stock_battle/startup.prg` raises `beforeDamage` across the physical, special, SMP-drain and all-target paths, applied HP/SMP changes go through actor ownership with damage cause and source attribution, and a cancellation leaves the damage unapplied.
- Evidence: `packages/core/test/battle-damage.test.ts`, `packages/core/test/battle-actions.test.ts`, `packages/core/test/battle-scripts.test.ts` and `packages/core/test/actor-behaviour.test.ts` drive the seam through authored RPGCode; the rule is `docs/spec/engine/battle.md` BAT-5/BAT-12 (`beforeDamage` sent with `emitCancelable` on the battle thread for every damage path).
