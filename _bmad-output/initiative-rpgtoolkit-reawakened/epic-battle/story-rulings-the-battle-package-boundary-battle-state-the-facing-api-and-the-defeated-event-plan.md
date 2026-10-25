---
title: "Rulings: the battle package boundary, battle state, the facing API and the defeated event"
type: 'feature'
ticket: 1
created: '2026-10-19'
status: draft
baseline_revision: '4255ec6f520af495d3aa2db8ed2553cb685ea3ab'
risk: "high"
context:
  - "spec - docs/spec/engine/plugins-and-battle.md#e-70 to E-79, the `fightInform` codes and the callback table"
  - "spec - docs/spec/formats/battle-data.md (.bkg, .ste, .spc)"
  - "spec - docs/spec/engine/rpgcode-modules-and-objects.md (EMIT-8, EMIT-13)"
  - "spec - docs/spec/engine/actors.md as ruled by 20.1"
  - "spine - _bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md, AD-10, AD-26"
  - "facts - docs/provenance/facts-round-10.md, docs/provenance/facts-round-11.md"
  - "discovery - _bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/discovery/all-rpgcode-battle-architecture.md"
  - "discovery - _bmad-output/initiative-rpgtoolkit-reawakened/epic-rpgcode-platform/discovery/step-budget-spike.md"
---

## Intent

Rule before code. `docs/spec/engine/battle.md` (anchored BAT-1 to BAT-15) settles the 2026-10-19 boundary for the stock battle package and the core: the core owns the actor data and the `battle` section (fighter references and charge), and the `stock_battle` RPGCode package owns the loop, charge rate, damage, status round effects, AI, the sequence after an outcome, music cues and UI. The page also settles the `BattleSection` shape, the rebuild mapping of E-79's callbacks 114-132, the `defeated` event, R-57, R-16, R-11, outcomes 0-4, the no-enemies message, the party source, battle music and the default UI's primitives, using the owner-relayed 3.1 facts of extraction round 11.

The page's fifteen rows: BAT-1 boundary, BAT-2 `BattleSection`, BAT-3 API and the callback mapping, BAT-4 loop, tick and charge, BAT-5 damage, specials and items, BAT-6 status, BAT-7 AI, BAT-8 outcomes, running and rewards, BAT-9 starts and the party source, BAT-10 music, BAT-11 UI primitives, BAT-12 events and `defeated`, BAT-13 save/restore and reset, BAT-14 package loading and the no-package path, BAT-15 determinism, hazards not reproduced and golden policy.

Amendments: E-71's steps become package steps; E-72 to E-79 gain a pointer to `battle.md` where the legacy protocol and the rebuild differ (notably `fightTick`, which the package's loop replaces); R-57 is closed; E-79's "rules in the core" wording is superseded; EMIT-13's `defeated` row gains its detail fields and the `stock_battle.defeated` re-emit; AD-10's `battle` row says fighter references and charge, with status effects on the actor; the `.spc` flag note says 0 = usable. The `save/sections.ts` comment and the placeholder itself are code, so 7.2 changes them with the section's shape.

## Boundaries

Documentation only. No TypeScript, fixtures or package code. Builds on 20.1's actor boundary and does not re-rule actor ownership, fallen/revived, status lifetime, equipment or the level-up equation; `progression-and-levels.md` settles R-16 and this entry cites it rather than writing a second curve. Does not implement the battle section (7.2), the API (7.3) or any package behaviour.

## Key Decisions

1. **Split and legacy mapping (BAT-1).** The core owns the actor model and the `battle` section; the `stock_battle` package owns everything else about how a fight plays. `fightTick` is not a core operation. The one battle-specific core operation is the outcome adapter of BAT-8. *Rejected:* a core rules engine behind the default UI, which keeps two rule owners.

2. **`BattleSection` shape (BAT-2).** One active battle: `id`, `boardKey`, `background`, `canRun`, `outcome` (0-4 or null) and two ordered parties of `{ party, actorId, charge }`. Status effects, HP and SMP stay on the actor. A dangling or duplicate reference is a located load diagnostic. Reset clears the section. *Rejected:* a battle-local copy of stats.

3. **The facing API (BAT-3).** `battle.partySize`, `fighter`, `charge` / `addCharge` / `setCharge` / `releaseCharge`, `chargePercent`, `canRun`, `outcome` / `finish(code)`, plus the actor's stat and status methods, with the full 114-132 mapping table, including the two callbacks that have no rebuild counterpart (124, 130). *Rejected:* a bespoke `fight*` callback object.

4. **Loop and charge (BAT-4).** One battle thread; one pass per engine tick; nobody charges while a turn is in progress (R11-Q3); enemies by index then players by index within a pass; a fighter crossing its threshold acts next pass; rate `3 + 2 * speed - 2 * slow` with no floor or ceiling; initial charge a seeded draw from 0 to threshold minus 1. The 60-passes-a-second rate is a Reawakened choice. *Rejected:* one thread per fighter (it only solves simultaneous turns, which 3.1 never has) and a core charge accumulator (a battle rule in the core).

5. **Damage, status and AI (BAT-5 to BAT-7).** The ordinary attack is the E-74 rule of round 10, cited not restated. Specials and items follow R11-Q7. Statuses tick once per turn of their fighter, effect then count, in upper-cased file-name order; disable never ends by itself. The four AI levels follow R11-Q8 with a fixed draw order and an AI error ends only its turn. The departures (heal stops at the maximum, fewer than 1 round lasts until removed, no player-turn disable cancellation, `ai()` rejects a bad level, an empty target set skips the turn) are listed in BAT-5 to BAT-7 and BAT-15.

6. **Outcomes, rewards and `defeated` (BAT-8, BAT-12).** Run succeeds 2 times in 5 and a failed run spends the turn; the win sequence is gold, experience message, level-ups, gold message, one win program; every member gets the full experience; one run program and one win program (the last enemy's that has one); the game-over program replaces the reset. The compatibility adapter applies codes 0, 2 and 4 from generic core operations. `defeated` is emitted on the enemy actor once per enemy per battle; the game re-emit is `stock_battle.defeated`. *Rejected:* a purely package-owned reward sequence (a custom fight program with no package would get no rewards).

7. **Starts, loading, music and UI (BAT-9 to BAT-11, BAT-14).** 1 to 4 enemies, each independently drawn; the whole party fights, fallen members starting fallen; a custom fight program replaces the package loop, not the section or adapter; battle music goes through the media object with source `battle`; the UI uses only existing primitives; with no battle package a battle ends at once with a diagnostic.

8. **Save and determinism (BAT-13, BAT-15).** The section saves fighters and charge only and is validated on load; the hazards listed in BAT-15 are not reproduced.

## Owner review

Approved by the owner (Jensen, 2026-10-25) at the plan checkpoint, and marked OWNER in `battle.md`: the one-thread, 60-passes-a-second loop (BAT-4); the heal-stops-at-maximum, fewer-than-1-round and no-self-disable-cancellation departures (BAT-5, BAT-6); the outcome compatibility adapter in core and the seeded 2-in-5 run draw (BAT-8); the `stock_battle.defeated` re-emit name (BAT-12). The remaining rows record 3.1 facts or earlier owner rulings.

## Acceptance

1. `docs/spec/engine/battle.md` exists with BAT-1 to BAT-15, each row carrying evidence and a rejected alternative, and every Reawakened rule approved by the owner.
2. AD-10's `battle` row says fighter references and charge only, with status effects on actors; the code comment and placeholder are 7.2's, not this entry's.
3. EMIT-13's `defeated` row carries `{ cause, source }`, once per enemy per battle, and the game re-emit is `stock_battle.defeated`.
4. E-71 to E-79 point to `battle.md`; E-79 no longer presents `fightTick` as a rebuild operation; R-57 is closed.
5. R-57, R-16 and R-11 each have one rule with evidence; no later entry depends on an unruled behaviour.
6. A person approves the plan checkpoint and the done checkpoint.

## Verification

Documentation link and anchor check; `pnpm provenance` and `pnpm licence` are unaffected but run in the PR; the owner reads the BAT rows and approves. Grep `docs/spec` and the spine for the old "battle rules in the core" and "status effects in the battle section" wording and confirm each is reconciled.

## Plan Change Log

- 2026-10-25: round 11 facts landed (`docs/provenance/facts-round-11.md`); `battle.md` drafted; loop design changed from one thread per fighter to one battle thread; reward order, run chance, status order, AI healing targets and `.spc` flag meaning corrected from the facts; the `defeated` re-emit is `stock_battle.defeated`; the pending-review items listed above.
