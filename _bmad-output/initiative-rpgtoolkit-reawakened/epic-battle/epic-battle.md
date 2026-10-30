---
type: epic
title: "Battles run on core rules with a default UI"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-9"]
assignee: ""
risk: medium
---

# Battles run on core rules with a default UI

## Description

Battles follow the charge-bar rules, damage, status effects, enemy AI levels and custom AI, rewards and levelling. The stock RPGCode battle package drives core battle operations and draws a default UI from draw lists; a game can replace it with its own fight program.

## Outcome

Players fight legacy battles with the legacy outcomes; the CAP-9 success check, seeded battles matching the stated formulas, is the signal.

## Done when

1. Seeded battles reproduce the E-72 to E-78 formulas and outcomes that `docs/spec/engine/battle.md` rules (the tests run over the core battle state with the stock package loaded).
2. Random and scripted battle starts work, and win, run and lose outcomes, rewards and level-up behave as E-77, E-78 and 20.1's default level-up equation state.
3. The four AI levels and a custom AI program pick targets and moves as E-76 states.
4. A custom RPGCode fight program drives every ruled battle operation of the rebuilt E-79 surface with the stock package absent.
5. The default battle UI renders an owner-approved deterministic golden image using the existing 3.1 drawing primitives.
6. A mid-battle save restores the same fighters, charge, background, `canRun` and outcome, and the state hash is identical; the `battle` section holds fighter references and charge only.
7. The `stock_battle` package loads by name and is mapped in `.gam`; a game without a battle package ends a battle immediately with a diagnostic rather than hanging.
8. Battle music and cues play through the media object; after `boardReturned` the engine restores music from the active board, not by looking up `battle.boardKey`. A failed `beforePlay` listener rejects the music-start request only; it does not reject or stop battle start. `BattleSection` contains no battle audio; playback state is saved in the independent audio section. The null-audio runner produces the same cue stream.
9. Review follow-ups 7.21–7.32 are resolved with merged evidence or owner-approved rules; the 7.33 closeout sweep is complete and every follow-up child issue is closed before #503 closes.

## Boundaries

Battle state (fighter references and charge), the stock battle package's loop, damage, status round effects, enemy AI, outcomes, music cues and default battle UI, and the battle built-ins. Actor stats and status effects stay on the actor (Epic 20); battle state holds no copy of them. Not menus, items, gold, inventory implementation or save UI (epic menu-party-save): the battle posts plain-data effects and a test double stands in. Visual identity with the stock plugin is a nice-to-have.

## References

- spec - _bmad-output/initiative-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened.md, section Capabilities
- spine - _bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md, AD-8, AD-10, AD-12, AD-26
- constraint - docs/guardrails.md, section G3
- reference - docs/spec/engine/plugins-and-battle.md#e-70 to E-79
- reference - docs/spec/formats/battle-data.md, docs/spec/engine/audio-media.md#audio-state
- discovery - _bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/discovery/all-rpgcode-battle-architecture.md

## Notes

- Decision: epic set approved by the user, 2026-10-10.
- Waits on legacy-formats because: enemy, special-move, status-effect and background data.
- Waits on rpgcode-vm because: battle built-ins and custom programs.
- Waits on movement-triggers because: random battle start and fighter state.
- Decision: envelope re-sliced against the architecture spine, 2026-10-10.
- Decision: Jensen, 2026-10-15: `docs/spec/` replaces `docs/format-spec.md` and `docs/engine-features.md` as the normative spec (ADR 0007, entry 1.13); the owner attests it is clean (extraction-log round 4).
- Evidence (rule at inception, R-57): docs/spec/engine/plugins-and-battle.md gives the charge model (+3 per tick, ±2 per speed/slow effect, act at 75 for players and 123 for enemies), `skill` always −1, outcome codes 0–4, `fightInform` codes 6 and 7 never sent, the AI table and the "No enemies of skill level N found." message. R-11: the 3.1 editor writes the `.spc` battle/menu flags inverted. R-16: the original uses `experienceIncrease` three different ways; choose one rule for E-78. Source: discovery/docs-spec-reconciliation.md.
- Architecture Decision: Jensen, 2026-10-18: The entire battle engine (ATB loop, formulas, AI, UI, transitions) will be implemented directly in RPGCode using Epic 18 callables, dictionaries, and screen primitives (see `discovery/all-rpgcode-battle-architecture.md`). Partly superseded on 2026-10-19: the default UI uses the existing 3.1 drawing primitives; no `drawBox`/`drawBar` is added (7.1, BAT-11).
- Waits on epic-rpgcode-first-class-functions (Epic 18) because: lambdas, dictionary objects, and registerPlugin middleware for the battle loop and battle hooks.
- Decision: Jensen, 2026-10-19: this epic is now **the stock battle package**, built on Epic 19 (`epic-rpgcode-platform`: objects, packages, `registerPlugin`, emitters) and Epic 20 (`epic-actors`: the actor model, behaviours, hydration, the `stock_battle` package shell). The ATB loop, damage formulas, AI levels 0 to 3 and the battle UI are RPGCode in that package.
- Decision: Jensen, 2026-10-19: boundary (supersedes the narrower reading of the 2026-10-18 note and aligns with E-79 "rules in core, battle systems drive core ops"). Core owns actor DATA and the interpretation rules that hold for any game: fallen (default HP <= 0), status-effect lifetime as a countdown (`advanceStatus(n)`; the battle script decides when a round passes), equipment bonuses, level-up default from data. Everything specific to a battle implementation is RPGCode in this package: ATB charge (+3 per tick, 75 and 123), damage formulas, AI levels, UI, and the 3.1 `.ste` "each round while charged" semantics. A Zelda-style game with 12 hearts and an FF-style game with 9999 HP are two battle scripts over the same actor model.
- Resolved at inception, 2026-10-19: the Done when list above is reconciled with the package boundary. There is no core battle phase and no core rules engine; the core owns the actor model and the `battle` section, and the `stock_battle` package owns the loop, damage, status round effects, AI, outcomes sequence, music cues and UI.
- Decision: inception completed 2026-10-19; 13 entries in build order (`tickets.toml`). Entry 1 (7.1) is a docs-only owner checkpoint (plan and done); entry 11 (7.11, the default UI) is an owner checkpoint at plan and done; the rest are agent-lane.
- Decision: Jensen, 2026-10-28: the complete BAT-11 screen, all five screen decisions, target-list presentation and golden frames are approved; the normative ruling is `docs/spec/engine/battle.md#bat-11-screen`.
- `defeated` status, ruled at inception: it is a row in the EMIT-13 standard-events table, emitted by the battle package on the enemy actor once per enemy per battle with `{ cause: "damage" | "status" | "script", source: actorId | null }`. The package re-emits it on the game as `stock_battle.defeated` for global listeners (package namespace, EMIT-8 and EMIT-13; corrected from `battle.defeated` by entry 7.1, 2026-10-25); there is no `battle` emitter.
- Waits on epic-rpgcode-platform (Epic 19), epic-actors (Epic 20) and epic-media-objects (Epic 21), which sit before this epic in the initiative; the initiative `[[epic]]` `after` for this epic names them.
- Handoff: Jensen, 2026-10-19: the AD-26 core `battle` phase is being removed/repurposed (battle is a package, not a core phase). Epic 20 (20.1) rules the spine amendment; this epic's inception must not assume a core battle phase.
- Handoff: Jensen, 2026-10-19: `fallen` is a core actor event (Epic 20: fires only on the transition into the fallen state, `detail` `{ cause, source }`). `defeated` belongs to this package: emitted once per enemy per battle, and added as a row to the EMIT-13 standard-events table (`rpgcode-modules-and-objects.md`) when Epic 7 is incepted. Use the EMIT-13 naming convention (past tense notifications; `before` plus present for cancelable).
- Reopened 2026-10-29 at the owner's request after the Epic 7 review; original ticket statuses for 7.1–7.20 stay as recorded, preserving history but not revalidating the parent's Done-when items; new follow-up entries 7.21–7.33 are not complete.
- Review exclusions confirmed against current main: no generic audio runner parity duplicate (#691), no repeated direct-start/no-enemy or gold/custom-API coverage already in 7.9/7.18 (#512/#690), and `ai(level)` actor ownership is already tested in `packages/core/test/battle-ai.test.ts:684`.
- Owner decisions 2026-10-29: 7.25 diagnoses wrong-kind restored fighters and keeps them unusable in place; 7.26 retains the RNG and corrects its wording; 7.27 recognizes registered plugin or game-file battle systems and documents the missing-handler diagnostic. These decisions do not themselves establish merged implementation or tracker closure.
- Decision: 2026-10-26 — Per the owner's instruction, keep ticket 7.13's dependency/sequence unchanged while adding follow-up tickets 7.15–7.20; the new tickets do not gate 7.13.

## Done-when audit record (historical 2026-10-28; current follow-up status 2026-10-29)

Rows 1–8 reproduce the labels and evidence recorded by the 2026-10-28 audit against `origin/main` `2be5fcf3`; they are not a current re-validation. Review follow-ups 7.21–7.32 record newly identified behavior defects, unresolved rules, and evidence gaps. Row 9 records current status against `origin/main` `cf09f12c`. Preserve the historical ticket statuses and completed plan checkboxes; do not treat prior "met" labels as proof that the full criteria were satisfied.

| # | Done when | Evidence cited in the 2026-10-28 audit | Status (rows 1–8 are historical labels; row 9 is current) |
|---|---|---|---|
| 1 | Seeded battles reproduce the E-72 to E-78 formulas and outcomes | `packages/core/test/battle-loop.test.ts` (30 tests: seeded 75/123 thresholds, seeded bounds, oracle timeline), `battle-actions.test.ts` (37), `battle-damage.test.ts` (2) | met |
| 2 | Random and scripted starts; win, run and lose outcomes, rewards and level-up | `battle-start.test.ts` (10), `battle-outcomes-stock.test.ts` (12: the 2-in-5 run roll on both sides, a blocked run keeping the turn, simultaneous falls, reward order), `battle-outcomes-core.test.ts` (4); `packages/core/src/script/builtins/pure.ts:104-105` returns `1 + draw % max`, and `stock/stock_battle/startup.prg:309` uses `random(5) <= 2`. Since `2^32 = 5 × 858,993,459 + 1`, the accepted roll is 1,717,986,919 of 4,294,967,296 draws (`2/5 + 3/(5 × 2^32)`), matching BAT-8 and `docs/spec/engine/rpgcode-functions.md:17` | met |
| 3 | The four AI levels and a custom AI program | `packages/core/test/battle-ai.test.ts` (13: four levels, draw order, level-based healing, no living player draws nothing, custom AI program, ERR-2 on a program error) | met |
| 4 | A custom RPGCode fight program drives every ruled E-79 operation with the stock package absent | `battle-custom-program.test.ts` (4: every operation through the public API, outcomes 0/2/4 against 1/3, no internals access), `battle-custom-fight.test.ts` (18) | met |
| 5 | The default battle UI renders an owner-approved deterministic golden | `golden/battle-ui/frames.json` with `command.png`, `defeated.png`, `revive.png`, `special.png`, `target.png`; `battle-ui-screen.test.ts` and the `battle-ui-*.test.ts` suite; owner approval 2026-10-28 (`docs/spec/engine/battle.md#bat-11-screen`) | met |
| 6 | A mid-battle save restores fighters, charge, background, `canRun` and outcome with an identical state hash, and `battle` holds references and charge only | `battle-save-golden.test.ts` with `packages/core/test/fixtures/save/battle-v2-out.json` (only the root `battle` section differs), `battle-fresh-load.test.ts:244` (two brand-new engines loading the same mid-battle save run the same state hashes) | met |
| 7 | `stock_battle` loads by name and is mapped in `.gam`; a game without it ends a battle with a diagnostic instead of hanging | `packages/core/src/formats/main-file/reader.ts` (`NEW_PROJECT_PACKAGE_PLUGINS`), `battle-start.test.ts:442` and `:472`, `engine.test.ts:403`, `stock-packages.test.ts:206`, `battle-custom-fight.test.ts:556` | met |
| 8 | Battle music and cues play through the media object; `boardReturned` restores active-board music; a failed `beforePlay` rejects only the music start; `BattleSection` has no audio; the null-audio runner sees the same cue stream | `battle-cues.test.ts` (15), `battle-cues-engine.test.ts` (4) | met |
| 9 | Resolve review follow-ups 7.21–7.32 and complete 7.33 closeout sweep; verify every child issue closed | No follow-up work or child issues are on `main`; 7.21–7.33 are drafted only in the owner-review worktree, and no new follow-up work is claimed complete | open |

The 2026-10-28 audit labeled rows 1–8 "met"; those labels are preserved only as historical status, not as a present claim that the full criteria were satisfied. Review follow-ups 7.21–7.32 capture the observed behavior and evidence gaps. Original ticket statuses and completed plan checkboxes are not rewritten. The exact one-based `random(5)` mapping and accepted run-roll count are verified in current code/spec, but that fact alone does not close the other gaps. The owner reopened #503 after the review; it remains open until the actual Done-when criteria and all follow-up child issues are verified.

### Follow-up evidence inventory (2026-10-30)

Baseline: `95a44313a17afa52d10664960943a754c38f37f6`. The historical table above is unchanged; its row 9 describes the earlier baseline, not the state below. GitHub reports issues #741–#752 closed. The links and tests below identify merged evidence for each follow-up; they are not a fresh execution of those tests or an independent proof of every original Done-when criterion.

| Follow-up | Acceptance-by-acceptance evidence and limits |
|---|---|
| 7.21 / #741 | PR #761: `battle-outcomes-core.test.ts:290-305` and `battle-outcomes-stock.test.ts:624-652` check codes 0–4, including handled 1/3, both participants and an unchanged bystander. `battle-outcomes-stock.test.ts:655-676` checks later status ticks make loss outrank a successful run. These assertions check the final cleanup and ordering outcome, not an independent trace of every cleanup instruction. |
| 7.22 / #742 | PR #764: `battle-ai.test.ts:761-800` checks lethal status, one custom-AI call, ineffective attack, and a living control. `battle-actions.test.ts:486-527` separately checks fallen attackers' moves and items; it does not prove those actions during the lethal-status custom AI turn. **Open evidence gap:** 7.35 / #806 owns the combined-scenario verification; no runtime defect is asserted. |
| 7.23 / #743 | PR #767: `battle-ui-background.test.ts:56-83` checks the authored tile-bitmap pixels and an empty-background fallback. The default battle UI rig also supplies an authored PNG for its golden frames (`battle-ui-rig.ts:417-421,464-468`); these fixtures do not independently establish every supported background format. The parent criterion 5 audit owns any remaining format evidence, not a claim of a regression. |
| 7.24 / #744 | PR #765: `battle-outcomes-core.test.ts:247-281` starts a battle, loses, runs the game-over program and checks the next battle's ID differs; `battle-api.test.ts:403-416` checks counter fallback and lag. |
| 7.25 / #745 | The owner comparison and rejected alternatives are in `spike-rule-wrong-kind-actor-references-in-restored-battles-plan.md:21-44`; BAT-2 records the ruling. PR #775 also separately implements it in `packages/core/src/battle/model.ts`; `battle-state.test.ts:95-137` covers wrong-team entries and diagnostics. The spike's own AC says no runtime change; the combined PR includes that additional implementation, rather than a docs-only PR. |
| 7.26 / #746 | The owner decision and exact arithmetic are in `spike-rule-e-74-equal-probability-wording-against-random-plan.md:22-46`; `plugins-and-battle.md#e-74` records the mapping, 16 heavy and four light buckets and rejected exact-uniform alternative. PR #775 did not change the random implementation. |
| 7.27 / #747 | The conflict, owner decision and rejected alternative are in `spike-resolve-the-custom-battle-handler-contract-conflict-plan.md:15-44`; BAT-9 and BAT-14 distinguish missing and registered handlers. `battle-custom-fight.test.ts:610-632` exercises both. PR #775 includes a separate #745 runtime change, not a handler behavior change. |
| 7.28 / #748 | PR #755: `battle-cues-engine.test.ts:480-563` drives movement over a tile boundary, observes the engine-created battle, victory, context and deterministic replay; it does not inject a prebuilt handoff. |
| 7.29 / #749 | PR #760: `battle-custom-fight.test.ts:1194-1240` uses a main-file custom fight with stock absent and asserts names, five enemy and five player stances and the attack alias. |
| 7.30 / #750 | PR #768: `battle-outcomes-stock.test.ts:736-771` checks exact `cause`/`source` keys, known source and local/game deliveries; `battle-custom-fight.test.ts:1129-1169` checks custom details and no game re-emission when stock is absent. `battle-damage.test.ts:150-185` checks detail keys, mutation and HP/SMP clamping; `battle-actions.test.ts:831-853` checks one item-origin dispatch and cancellation. |
| 7.31 / #751 | PR #771: `battle-fresh-load.test.ts:214-291,319-343` exercises real load, twelve aligned hash/frame comparisons and reset of battle, continuation and pinned animations. Its comparison explicitly substitutes surfaces, request state and audio cue ID; the ticket's literal **full-state hash equality** is unproven. **Open contract/evidence gap:** 7.34 / #805 owns the unmodified comparison and, if necessary, an owner ruling; neither #751 nor the parent criterion is silently weakened. |
| 7.32 / #752 | PR #756: `battle-cues-engine.test.ts:385-392` checks a won fight, active board B, saved board A and distinguishable B music. PR #772 links the separately open audio defect #758. Live parent #503 criterion 8 previously required the saved `battle.boardKey`; it was corrected to the active board on 2026-10-30 under the established 2026-10-26 owner ruling in `docs/spec/engine/battle.md#bat-10`. The historical row above is unchanged. |

**Still open or not established:** #753 itself and parent #503 remain open. #758 owns the voice-binding failure after a canceled board-music start. #806 owns the combined lethal-status custom-AI move/item evidence. #805 owns the literal unmodified whole-state hash question, with owner adjudication if the existing save/load contracts conflict with it. Interruption recovery does not promise restarting an active battle from a ledger; #779 remains in progress and #780 owns the later BAT-13-specific reconciliation. The #753 evidence sweep records these routes but does not wait on #780: #780 itself follows #779 and #753.

**Parent closure ownership:** The eventual #503 closure owner must revalidate criteria 1–5 and 7–8 against the current base, including the remaining supported-format evidence and #758, and criterion 6 against #805 and the subsequent #780 reconciliation. Criteria 1–8 retain historical labels rather than a fresh assertion-by-assertion proof. Criterion 9 and parent closure also require #753, #805 and #806 and any other relevant children to be verified closed; they are not prerequisites for completing the #753 evidence record itself. These are evidence limits, not findings that each behavior is broken.
