---
title: "Battle starts and setup: random encounters, Fight and FightEnemy"
type: 'feature'
ticket: 9
created: '2026-10-19'
status: in-progress
baseline_revision: '4255ec6f520af495d3aa2db8ed2553cb685ea3ab'
risk: "high"
context:
  - "spec - docs/spec/engine/battle.md as ruled by 7.1 (BAT-9, BAT-14)"
  - "spec - docs/spec/engine/plugins-and-battle.md#e-70, #e-71"
  - "handoff - entry 5.11 random-encounter fighter handoff"
  - "code - packages/core/src/sprites/encounters.ts"
  - "spec - docs/spec/engine/main-loop-and-startup.md#reawakened-phases (as ruled by 20.1)"
---

## Intent

Start a battle from every legacy entry point. The 5.11 random-encounter handoff already posts a plain-data result (`battle.randomEncounter`, `battle.customFight`, `battle.noEnemies`); this entry consumes it. A drawn encounter (`battle.randomEncounter`) hydrates the enemies with 20.5, builds party 0 and party 1 in the battle section, calls the registered `battle` command and waits for the outcome. A custom encounter (`battle.customFight`: the main file names a fight program) carries no fighters, so this entry runs that program in place of the draw and the program names its own enemies with `FightEnemy` (owner ruling, 2026-10-26).

`Fight` and `FightEnemy` start a battle directly with the same setup. An empty encounter pool shows the exact no-enemies message and starts nothing.

## Boundaries

No loop, damage, status, AI or rewards (7.4 to 7.8). No UI (7.11). It repoints the 5.11 `battle` phase registration to the phase ruled by 20.1; it does not re-rule the phase list.

## Key Decisions

1. **Handoff is the only coupling.** The start path reads the plain-data handoff and never imports movement internals. The drawn handoff names the board, the drawn enemy records and the background; the custom request names the board, the player and the program and has no enemy records; a missing field is a located error, not a default.

2. **Parties (BAT-9, R11-Q14).** Party 0 is the drawn enemies (1 to 4, each count equally likely, each drawn independently from the matching skill level, so an enemy may repeat; the draw belongs to the 5.11 handoff), hydrated with 20.5 in handoff order. Party 1 is every occupied slot of the actor store's ordered party (the order Epic 8 will use for the party menu), fallen members included and starting fallen, with each entry's charge initialised by 7.4. An empty party is a located error; a party whose members are all fallen is not, and the outcome path resolves it. `skill = -1` remains only in the legacy callback and is not part of the Reawakened battle package/start contract.

3. **Background and `canRun`.** The `.bkg` background image comes from the encounter or the `Fight` argument and is recorded in the section and loaded by 7.11. `canRun` is false if any one enemy in the fight forbids running, for `Fight` and `FightEnemy` alike; their run and win programs still apply (7.8).

4. **No enemies.** When the pool is empty, the start path shows the exact message from the spec ("No enemies of skill level N found." with N substituted) and returns without creating a battle. It does not call the package and does not register a phase.

5. **Custom fight program (amended 2026-10-26; owner ruling).** A random encounter draws and a custom encounter is spelled out. When the main file names a fight program, `battle.customFight` carries no fighters and the engine draws nothing (BAT-9 rule 2): the start path runs the program through the `executeProgram` frame push on a new engine-started thread, in place of the draw and of the package start, with the request as `context` and `source`/`target` null. The program names its enemies with `FightEnemy`, which gives the same setup (decision 2), the same `canRun` rule (decision 3) and the same outcome path as any scripted fight; `Fight` and `FightEnemy` never start the program again. A program name that matches no file is the catchable `program.missing` and no battle starts. *Rejected:* the engine passing the main file's pool or a drawn list to the program, and a per-encounter enemy-list field in the main file or on the board (a format change 3.1 stores nothing for).

6. **Missing package.** With no battle package and no custom program, the battle clears immediately and returns to the board with a diagnostic naming the missing package, rather than hanging. It does not run the run-away, win or lose path. This matches the spec's "without a battle plugin battles end immediately". A custom program still runs without the package; its `Fight` or `FightEnemy` call is the catchable `battle.package-missing`.

7. **Phase.** The 5.11 `battle` phase registration is repointed to the phase ruled by 20.1; the phase-list test is updated deliberately in the same commit and the change is noted in the PR. No core `battle` phase is assumed.

## Acceptance

- [ ] A random handoff starts a battle with the drawn enemies, the board background and the ruled `canRun`. The named handoff test verifies the enemy sources and background without a second draw but does not assert `canRun`: `packages/core/test/battle-start.test.ts` — “random encounter handoff uses its drawn enemies without drawing again”.
- [ ] The no-enemies handoff shows the exact message, creates no battle and registers no phase. `packages/core/test/engine.test.ts` proves the message and no battle, but no named test asserts that no phase was registered.
- [ ] `Fight` and `FightEnemy` create the ruled parties and background, with fallen party members included and starting fallen; one enemy that forbids running makes `canRun` false; an empty party is a located error and a fallen party resolves through the outcome. Tests prove the `FightEnemy` setup and the empty-party/outcome cases, but no named test proves the full setup clause for `Fight`.
- [x] A random encounter on a game whose main file names a fight program runs that program with the request as `context`, `source`/`target` null, no fighters or engine draw; `FightEnemy` gets the full setup and stock battle through its outcome; a missing program is catchable and starts no battle. Tests: `packages/core/test/battle-custom-fight.test.ts` — “a custom encounter runs the main file's program with the request as its context, loads no enemy and takes no random number”; “a program that spells its enemies out with FightEnemy gets the BAT-9 setup and a complete stock battle”; “a custom program name that matches no file is a catchable program.missing and starts no battle”.
- [x] A game with no battle package ends the battle immediately with a diagnostic and no hang. Test: `packages/core/test/engine.test.ts` — “engine displays no-enemies handoffs, runs custom starts as a program, and rejects absent stock_battle”.
- [x] The phase list matches the 20.1 ruling and the phase test update is deliberate. Test: `packages/core/test/engine.test.ts` — “engine runs the fixed phase order, registers audio after animation, and pauses on focus loss”.

## Verification

Handoff start tests (random, custom, no-enemies), `Fight`/`FightEnemy` tests, a missing-package test, custom-fight tests (the program runs with the request as `context`, no random number is taken, `FightEnemy` from the program reaches the outcome, determinism, save and restore, a missing program), and the phase-list test. Full suite, typecheck and lint.

## Plan Change Log

- 2026-10-26 (owner ruling, Jensen; applied by the director): a random encounter draws from the main file's list; a custom encounter is spelled out. Resolved without a format change: the custom request stays as 5.11 posts it (no fighters, no draw), the engine runs its `program`, and the program names its enemies with `FightEnemy`. The intent, key decisions 1, 5 and 6 and acceptance 4 are rewritten; BAT-9, E-70, the random-encounters rule, the main-loop phase paragraph and the `executeProgram` caller table are amended first, in a docs-only change. The first build of this entry (#673) left acceptance 4 unmet because the request could not run; the follow-up code change builds it.
- 2026-10-26 (handoff to 7.12): with this ruling a program that runs its own battle loop takes its setup from the package's setup-only entry points (`stockBattle.prepareEnemies`, `stockBattle.prepareRandom`). The epic's Done-when 4 and entry 7.12 ask for that with the package absent; entry 7.12 proves the path and rules any public setup surface it needs.

- 2026-10-26 (owner ruling, Jensen; applied by the director): `skill = -1` is a legacy-callback-only value; it is not part of the Reawakened battle package/start contract.

## Implementation Evidence

- Acceptance 4 (2026-10-26). The engine's `battle` applier turns `battle.customFight` into a thread that runs the internal `__battle_custom_fight` command (`packages/core/src/script/packs/battle.ts`), which decodes and validates the request, loads no enemy, takes no random number and runs the named program through `executeProgram` with the request as `context` and `source`/`target` null. A request that carries fighters, a blank program or a malformed field is a located `battle.bad-handoff`; a program name that matches no file is the catchable `program.missing`. `Fight` and `FightEnemy` never start the program.
- Tests, all in `packages/core/test/battle-custom-fight.test.ts` unless named: the program runs with the request as its `context`, no enemy loaded and the RNG untouched; bad requests (fighters, blank or absent program, absent board, wrong trigger); `FightEnemy` from the program gives the written enemies in the written order and a complete stock battle through outcome 2 with the loop's first seeded charges equal to the game's first draws; one to four enemies accepted, none and five refused; determinism across runs; save and restore at seven points from the enemy-file waits to the outcome adapter; `program.missing`; no `stock_battle` package (the program runs, its `FightEnemy` is `battle.package-missing`); the same through a booted engine (program runs on a new thread, `program.missing` is reported and the game carries on, `FightEnemy` reaches the stock loop with the written enemies and no draw). `random-encounter.test.ts`: the evaluator's custom request has exactly `trigger`, `board`, `actor` and `program`, and takes only the chance roll (none for type 1). `engine.test.ts`: the custom request in a scene without programs reports `program.missing`.
