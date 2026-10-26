---
title: "Player actions and damage: attacks, criticals, specials and items"
type: 'feature'
ticket: 5
created: '2026-10-19'
status: in-progress
baseline_revision: '4255ec6f520af495d3aa2db8ed2553cb685ea3ab'
risk: "high"
context:
  - "spec - docs/spec/engine/battle.md as ruled by 7.1 (BAT-4, BAT-5)"
  - "spec - docs/spec/engine/plugins-and-battle.md#e-74, #e-79"
  - "spec - docs/spec/formats/battle-data.md (.spc flags), docs/spec/formats/item.md"
  - "code - packages/core/src/script/packs/graphics.ts (animation rows)"
---

## Intent

Implement the player's three actions in the stock package: Fight (a physical attack), Special Move (FP and SMP drain with an SMP cost) and Item (a fight HP/SMP effect through an inventory port). Ordinary-attack damage follows the E-74 rule of `plugins-and-battle.md` unchanged (an integer luck percentage from -10 to +9, then the critical draws, DP unless critical, minimum 1); specials and items follow BAT-5 (no luck, critical or DP; items cap at maximum).

Everything goes through the actor's damage/heal methods, so `fallen` fires once and the state stays in one place.

## Boundaries

No loop (7.4), no status round effects (7.6), no AI (7.7), no rewards (7.8), no UI (7.11). The inventory port is a seam, not an implementation: Epic 8 owns items, and this entry ships a test double and a posted consume effect.

## Key Decisions

1. **Ordinary attack.** The E-74 rule recorded from facts round 10 is the only damage rule: one seeded whole-percentage draw from -10 to +9 in exact integer arithmetic with the fraction dropped toward zero, then the offensive and defensive critical draws, DP unless critical, floor 1, HP or SMP never below 0. The draw order is luck, offensive, defensive. This entry cites it and writes no second formula, no `[0.9, 1.1]` multiplier and no rounding rule of its own. A test table pins the edges (a supplied amount of 1, the -10 and +9 draws, DP larger than damage).

2. **Criticals.** `takeCrit` and `giveCrit` are -1 when absent; a side with -1 makes no draw and consumes no random number. A critical bypasses DP; the floor of 1 still applies. `attackall` and `drainall` never critically hit and apply their amount to each living target.

3. **Specials and pools.** A special has no luck, critical, DP or floor of 1: its FP comes off the target's HP, its target-SMP off the target's SMP, its cost off the user's SMP, each stopping at 0 and, by the BAT-5 departure, at the maximum for a heal. A move with 0 FP does no damage. An unaffordable special (cost above current SMP) is not selectable and a direct call raises `battle.unaffordable`. SMP 0 is not death. Order after the effect: the user's special animation, the move's animation over the target, the move's program, its status effect, then the amounts shown.

4. **Items.** The fight effect is `{ kind: "inventory.consume", item, target, hp?, smp? }`, posted as a plain-data effect. The test double consumes it and asserts exactly one effect per use. The battle never edits an item list and never assumes a bag shape; Epic 8 chooses that.

5. **Animation and status.** Animations are requested through the existing animation path and the status through the actor method, in the BAT-5 order. The action returns after the request, not after a host callback, so the loop stays in game time.

6. **Death once.** A lethal hit calls the actor's damage method once and `fallen` fires once. The package then emits `defeated` once per enemy per battle (BAT-12, built by 7.8's helper), so two damage paths cannot double-emit; a lethal hit on a player emits no `defeated`.

## Acceptance

- [x] The seeded damage table reproduces the ruled values at the edges; a critical bypasses DP; the minimum is 1; SMP damage clamps. Tests: `battle-actions.test.ts` — “luck swing edges: -10 and +9 percent, truncation toward zero, minimum 1”; “DP is subtracted and the damage floor is 1 when DP exceeds the damage”; “critical draws: offensive first and short-circuits defensive, -1 draws nothing, limit 0 always skips DP”; “attackAmount supplies the base: pool selects SMP, and a product beyond 32 bits stays exact”.
- [x] A special's FP/SMP drain and SMP cost are applied and clamp; an unaffordable special is unavailable and a direct call raises a stable error. Tests: `battle-actions.test.ts` — “special move clamps HP, SMP and the user's cost; no luck, DP, critical or floor”; “an unaffordable special move mutates nothing, draws nothing and reports battle.unaffordable”.
- [x] An item posts exactly one inventory consume effect through the test double and never edits the item list. Test: `battle-actions.test.ts` — “item adds clamped HP and SMP, posts exactly one consume effect and changes no inventory”.
- [x] `attackall` applies to every target without criticals. Test: `battle-actions.test.ts` — “attackall emits beforeDamage once per target and fallen once for each lethal hit”.
- [ ] `drainall` applies without criticals. `battle-damage.test.ts` — “stock battle sends one cancelable beforeDamage for every damage path” exercises a drainall amount but does not assert the no-critical property.
- [ ] A lethal hit through any of the three actions fires the actor's `fallen` once. `battle-actions.test.ts` proves this for attackall, but the merged tests do not demonstrate exactly-once `fallen` behavior for each of Fight, Special Move, and Item.
- [ ] For an enemy hit, the package then emits `defeated` once (7.8). This is 7.8 behavior and no merged test cited here proves it for this ticket.
- [x] No wall clock or unseeded randomness is used; the same seed and action stream reproduce the same damage. Test: `battle-actions.test.ts` — “the same action stream and seed give the same state hash; another seed does not”.

## Verification

A seeded damage table test, a critical/DP test, a pool/clamp test, a special affordability test, an item-port test with the double, an all-target test, and a `fallen`-once test. Full suite, typecheck and lint.
