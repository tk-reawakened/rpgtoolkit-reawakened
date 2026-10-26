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
8. Battle music and cues play through the media object; after `boardReturned` the engine restores music from the active board, not by looking up `battle.boardKey`. `BattleSection` contains no battle audio; playback state is saved in the independent audio section. The null-audio runner produces the same cue stream.

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
- `defeated` status, ruled at inception: it is a row in the EMIT-13 standard-events table, emitted by the battle package on the enemy actor once per enemy per battle with `{ cause: "damage" | "status" | "script", source: actorId | null }`. The package re-emits it on the game as `stock_battle.defeated` for global listeners (package namespace, EMIT-8 and EMIT-13; corrected from `battle.defeated` by entry 7.1, 2026-10-25); there is no `battle` emitter.
- Waits on epic-rpgcode-platform (Epic 19), epic-actors (Epic 20) and epic-media-objects (Epic 21), which sit before this epic in the initiative; the initiative `[[epic]]` `after` for this epic names them.
- Handoff: Jensen, 2026-10-19: the AD-26 core `battle` phase is being removed/repurposed (battle is a package, not a core phase). Epic 20 (20.1) rules the spine amendment; this epic's inception must not assume a core battle phase.
- Handoff: Jensen, 2026-10-19: `fallen` is a core actor event (Epic 20: fires only on the transition into the fallen state, `detail` `{ cause, source }`). `defeated` belongs to this package: emitted once per enemy per battle, and added as a row to the EMIT-13 standard-events table (`rpgcode-modules-and-objects.md`) when Epic 7 is incepted. Use the EMIT-13 naming convention (past tense notifications; `before` plus present for cancelable).
