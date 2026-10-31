---
type: epic
title: "Actors: one data model for party members, enemies and NPCs, with behaviours and stock packages"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-3", "CAP-9", "CAP-10", "CAP-11"]
assignee: ""
risk: high
status: done
tracker_id: "#490"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/490"
---

# Actors: one data model for party members, enemies and NPCs, with behaviours and stock packages

## Description

One actor model for everything that has stats and a life in the game: party members, enemies and NPCs. Board sprites are a separate section whose records may reference an actor. Core owns the actor DATA and the interpretation rules that hold for any game (fallen, status countdown, equipment bonuses, level-up default). Everything specific to one battle implementation is RPGCode in a package. Behaviours let a package override a default; actors save data and a behaviour name only, and behaviours are re-attached by name when a save loads. The epic also scaffolds the two stock packages, `stock-battle` and `stock-menu`, and the `.gam` plugins mapping that names them.

## Outcome

A game's party, enemies and NPCs are one plain-data actor model. A Zelda-style game with 12 hearts and an FF-style game with 9999 HP are two battle scripts over the same actors. A save holds only data and behaviour names, so it cannot go stale against new package code, and a missing package gives core defaults and a diagnostic rather than a refused load. The stock packages exist as real packages for Epics 7 and 8 to fill.

## Done when

1. The actor model inventory (every stat and state of character, enemy, item and status, with source field, type, writer, rule owner and evidence, plus a separate sprite-state table for board presence) is written in docs/spec and approved.
2. Party members, enemies and NPCs are plain-data actors in one owned section, loaded from the legacy data, readable and writable from RPGCode through the owner. Board sprites are a separate section whose records may reference an actor.
3. The core rules fallen (default HP <= 0), status countdown (`advanceStatus(n)`), equipment bonuses and level-up default work from data and are hooks with core defaults.
4. A package registers named behaviours that override the hooks; an actor carries only the behaviour name.
5. Saves hold actor data and behaviour names only (no callables); load re-attaches behaviours by name; a missing behaviour gives the core default and a diagnostic, never a refused load.
6. Actors, boards and the game emit the ruled events through Epic 19's emitters, and stock actor code re-emits `stock-rpg.fallen` on the game.
7. `stock-battle` and `stock-menu` exist as loadable packages; new-project templates list them in `.gam` plugins; legacy `tk3fight.dll` and `tk3menu.dll` map in memory to them.
8. Two authored battle scripts (12 hearts, 9999 HP) run over the same actor model with a save mid-fight, pinned in goldens; every legacy golden is unchanged.

## Boundaries

Core actor data, its interpretation rules, loading, hydration, save section and script exposure; the two stock package shells; the `.gam` mapping as core data. Does not include ATB, damage formulas, AI levels or battle UI (Epic 7, the stock battle package), menu screens and inventory rules (Epic 8), or the editor's save action. Movement, collision and triggers of board sprites stay Epic 5's observable behaviour.

## References

- spec - `_bmad-output/initiative-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened.md`, section Capabilities (CAP-3, CAP-9, CAP-10, CAP-11)
- spine - `_bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md`, AD-10, AD-26, AD-32
- constraint - `docs/guardrails.md`, G1, G2, G3, G7
- reference - `docs/spec/engine/plugins-and-battle.md#e-72` to E-79, E-85, E-99; `docs/spec/formats/character.md`, `enemy.md`, `item.md`, `battle-data.md`, `main-file.md`
- discovery - `discovery/inception-proposal.md`, `discovery/actor-readiness.md`; `epic-battle/discovery/all-rpgcode-battle-architecture.md`
- owner decisions - the 2026-10-19 party session (all recorded in Notes)

## Notes

### Scope and boundary

- Decision: Jensen, 2026-10-19, amended 2026-10-20: new epic 20, "Actors": party members, NPCs and enemies as one plain-data model, with behaviours, hydration and the stock packages `stock-battle` and `stock-menu`. Board sprites are not actors: a sprite is a board-scoped presence (transform, geometry, movement, animation playback) that may reference an actor by `actorId`. Sprite state is tabulated separately in the inventory.
- Decision: Jensen, 2026-10-19: core owns actor DATA and the INTERPRETATION rules that hold for any game: fallen (default HP <= 0), status-effect lifetime as a countdown (`advanceStatus(n)`; the battle script decides when a "round" passes), equipment bonuses and the level-up default. Everything specific to a battle implementation (ATB charge +3 per tick, 75 and 123, damage formulas, AI levels 0 to 3, UI, and the 3.1 `.ste` "each round while charged" semantics) is RPGCode in the stock battle package. A 12-heart real-time game and a 9999-HP FF-style game are two battle scripts over the same actors. Supersedes the narrower 2026-10-18 all-RPGCode note; aligns with E-79.
- Decision: Jensen, 2026-10-19: Epic 7 (epic-battle) becomes "the stock battle package", built on Epics 19 and 20; its initiative `after` adds 19 and 20 and its breakdown is a later inception. Source conflict: epic-battle Done when 1 to 4 (core formulas, AI levels in core) is annotated and re-sliced at that inception.
- Decision: Jensen, 2026-10-19: AD-26's core `battle` phase is removed or repurposed, because battle is a package, not a core phase. 20.1 rules the amendment; 19.15 reconciles the phase list.
- Principle: 3.1 is a compatibility layer, not the model (initiative Notes, 2026-10-19; ADR 0009).

### Data, stats and saves

- Decision: Jensen, 2026-10-19: AD-10 / StatsPort resolved. Actors own their stats (level and experience included). Legacy `.tem`-named stat globals (`HP!`, `Level!`) are live read/write aliases resolving to the actor stat: one owner, no copies. Costs: one deliberate golden re-record for the save shape (G5), reset clears the actor section, and the virtual-variable port (`script/virtuals.ts`, read-only today) needs a write path, built in 20.4. `kill()` on an alias or other protected name is a catchable `kill.system-owned` error and changes nothing (replaces "reset to the .tem default"); a write to a read-only alias is `assign.read-only`. (A-1 resolved here.)
- Decision: Jensen, 2026-10-19: level and experience are stats. Abilities (derived values, level-up, the experience curve, damage taken) are standard equations with code defaults, overridable by behaviours. 20.1 rules the default level-up equation (resolving R-16); 20.2 lists each as a defaulted equation; 20.6 builds them as hooks; Epic 7 inherits the rule.
- Decision: Jensen, 2026-10-19, amended 2026-10-20: pattern: data gives default behaviour and a behaviour overrides it (fallen, level-up and damage-taken are hooks with core defaults). The model is a store: actor records are plain data, and operations go through an action/service layer that validates and commits patches. Records never hold methods or callables; a hydrated RPGCode wrapper may expose method-shaped calls that dispatch through the service. Every core section follows the same pattern (AD-10, `ActorAction`, `BoardAction` and so on).
- Decision: Jensen, 2026-10-19: actors save DATA only (stats, status counters, a behaviour NAME such as `stock-rpg.hero`). On load, behaviours are hydrated by name from installed packages; a missing behaviour gives the core default plus a diagnostic, never a refused load. Package version governs code, so saves cannot go stale. Script closures (threads parked mid-wait, locals) remain saved per 18.6; script state is the only place callables are saved.
- Decision: Jensen, 2026-10-19: "fallen" is a state (default HP <= 0, behaviour-overridable), never a removal: actors stay in the party and revival is the state changing back. Built in 20.6 (state) and 20.9 (events).
- Decision: Jensen, 2026-10-19: the actor model inventory (20.2) is an early entry every other entry reads: every stat and state of character .tem, enemy .ene, item .itm and status .ste with source field, type, writer, core-rule versus battle-rule and evidence.

### Behaviours, packages and hydration

- Decision: Jensen, 2026-10-20: behaviours register through a separate `registerBehaviour(name, hooks)` call, never a `registerPlugin` key. The hook list is closed and defined by core; unknown names or hooks diagnose; registrations are session data rebuilt at package start-up and never saved; resolution is behaviour first, then core default. The loader implementation dependency is 19.17 (#562); 19.16 is the closed docs handoff. <!-- OWNER: confirm hook names/signatures -->
- Decision: Jensen, 2026-10-20: package names and namespaces are lower-case underscore identifiers (`^[a-z][a-z0-9_]*$`, with no leading or trailing underscore), so stock ids are `stock_battle` and `stock_menu` and behaviour names are dotted, for example `stock_rpg.hero`. Supersedes the earlier hyphen-grammar note.
- Decision: Jensen, 2026-10-20: generic OOP-12 host-object hydration, the actor `actor:<id>` object/emitter identity, and the `kill.system-owned`/`assign.read-only` checks are owned by 20.4; host methods are session data and saved records carry a type name plus data only. <!-- OWNER: confirm generic hydration ownership -->
- Decision: Jensen, 2026-10-19, amended 2026-10-21: new project templates list `stock_battle` and `stock_menu` in `.gam` plugins (".gam is the csproj of the toolkit"). Legacy `fightPlugin = tk3fight.dll` and `menuPlugin = tk3menu.dll` map in memory to the stock packages and are written explicitly only when saved from the editor.
- Assumption A-2 (to confirm): package distribution form and how packages reach the editor are undecided. Taken: the catalogue and loader implementation are 19.17 (#562), with 19.16 retained as the closed docs handoff; stock packages are authored `.prg` source under a repo `stock/` folder, referenced by name from `.gam`; hosts bundle them. <!-- OWNER: confirm package descriptor/distribution form -->
- Assumption A-3 (to confirm): whether party or battle need to be built-in emitters (same item as Epic 19's A-3). Taken: no.

### Events

- Decision: Jensen, 2026-10-19, amended 2026-10-20: EMIT-13 naming and set. Notifications are past-tense lowerCamelCase; cancelable pre-events are `before` plus the present; actor events need no prefix; package events re-emitted on shared emitters (game, board, media) carry the package namespace prefix. Standard events: `fallen`, `revived`, `statusChanged`, `leveledUp`, `entered`, `left`, `talked`, board `beforeEnter` (cancelable) and the game `error`; `beforeDamage` is the battle-thread cancelable event. `source` is an actor id or null. `fallen` fires only on the transition into fallen, with `cause` (damage, status, script); `defeated` belongs to the battle package. Board unload unregisters its emitter and drops its listeners. 20.1 records the table; 20.9 emits the actor/board set and owns dialogue events.
- Decision: Jensen, 2026-10-19: custom event types on actors are allowed and an asset may declare them (EMIT-12). Declarations are asset data read by name on load, never saved on the actor, and advisory at runtime (an undeclared type gives a located `emit.undeclared-type` diagnostic and still runs); strictness is tooling (Epics 10 and 11). Declarations may not reuse built-in names.
- Decision: Jensen, 2026-10-20: EMIT-11 engine-originated cancelable sends are settled in 20.1. The reusable, short, budgeted, non-waiting path is built by 20.9 for `beforeEnter`; Epic 21.4 consumes it for `beforePlay` without a duplicate. <!-- OWNER: confirm cross-epic handoff -->

### Spike result and sequencing

- Decision: Jensen, 2026-10-19: if the 19.2 spike showed the stock ATB tick or cancelable emits did not fit `STEP_BUDGET`, this epic's design would change; 20.1 applies the result.
- Handoff: the 19.2 result (`epic-rpgcode-platform/discovery/step-budget-spike.md`) is GO, with two conditions (recorded by 19.15). (1) The stock battle is NOT one script thread that steps every fighter: one thread per fighter has 435 to 658 steps spare against `STEP_BUDGET` with up to three listeners per event (63 with eight), while one thread for all four overruns whenever two fighters act in one tick. So the stock battle runs one thread per fighter, or the core owns the charge accumulator and calls into script only when a fighter acts. (2) A cancelable emit parks its emitter: about two ticks with a hand-built wait, and EMIT-16 rules one tick for the first-class `event.dispatch` wait that 19.11 built, which battle timing plans for. 20.1 applies both.
- Sequenced: after 19.1 and the 19.2 spike for 20.1; the inventory (20.2) then feeds every other entry; lane A core/actors (20.3, 20.5, 20.6, 20.7, 20.8, 20.10), lane B script bindings (20.4), lane C packages and `.gam` (20.11, 20.12).
- Handoff: Epic 7 builds the stock battle in `stock-battle` over this model; Epic 8 builds menu, party and inventory in `stock-menu` and the party save section; Epic 9 consumes both via the manifest. New-project templates (20.12) are core data; the editor epics (11, 12) consume them and own the explicit-write-on-save action.
- Handoff: Jensen, 2026-10-22: move the blocked `talked` bridge (#564) from Epic 20.16 to Epic 8.12; Epic 8 owns the dialogue-completion interaction wrapper and queued `dialogue.completed` producer, while Epic 20 continues to own the actor emitter and package infrastructure consumed by the bridge.
