---
title: "Battle starts and setup: random encounters, Fight and FightEnemy"
type: 'feature'
ticket: 9
created: '2026-10-19'
status: draft
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

2. **Parties (BAT-9, R11-Q14).** Party 0 is the drawn enemies (1 to 4, each count equally likely, each drawn independently from the matching skill level, so an enemy may repeat; the draw belongs to the 5.11 handoff), hydrated with 20.5 in handoff order. Party 1 is every occupied slot of the actor store's ordered party (the order Epic 8 will use for the party menu), fallen members included and starting fallen, with each entry's charge initialised by 7.4. An empty party is a located error; a party whose members are all fallen is not, and the outcome path resolves it. `skill` is -1 on the random path.

3. **Background and `canRun`.** The `.bkg` background image comes from the encounter or the `Fight` argument and is recorded in the section and loaded by 7.11. `canRun` is false if any one enemy in the fight forbids running, for `Fight` and `FightEnemy` alike; their run and win programs still apply (7.8).

4. **No enemies.** When the pool is empty, the start path shows the exact message from the spec ("No enemies of skill level N found." with N substituted) and returns without creating a battle. It does not call the package and does not register a phase.

5. **Custom fight program (amended 2026-10-26; owner ruling).** A random encounter draws and a custom encounter is spelled out. When the main file names a fight program, `battle.customFight` carries no fighters and the engine draws nothing (BAT-9 rule 2): the start path runs the program through the `executeProgram` frame push on a new engine-started thread, in place of the draw and of the package start, with the request as `context` and `source`/`target` null. The program names its enemies with `FightEnemy`, which gives the same setup (decision 2), the same `canRun` rule (decision 3) and the same outcome path as any scripted fight; `Fight` and `FightEnemy` never start the program again. A program name that matches no file is the catchable `program.missing` and no battle starts. *Rejected:* the engine passing the main file's pool or a drawn list to the program, and a per-encounter enemy-list field in the main file or on the board (a format change 3.1 stores nothing for).

6. **Missing package.** With no battle package and no custom program, the battle clears immediately and returns to the board with a diagnostic naming the missing package, rather than hanging. It does not run the run-away, win or lose path. This matches the spec's "without a battle plugin battles end immediately". A custom program still runs without the package; its `Fight` or `FightEnemy` call is the catchable `battle.package-missing`.

7. **Phase.** The 5.11 `battle` phase registration is repointed to the phase ruled by 20.1; the phase-list test is updated deliberately in the same commit and the change is noted in the PR. No core `battle` phase is assumed.

## Acceptance

1. A random handoff starts a battle with the drawn enemies, the board background and the ruled `canRun`.
2. The no-enemies handoff shows the exact message, creates no battle and registers no phase.
3. `Fight` and `FightEnemy` create the ruled parties and background, with fallen party members included and starting fallen; one enemy that forbids running makes `canRun` false; an empty party is a located error and a fallen party resolves through the outcome.
4. A random encounter on a game whose main file names a fight program runs that program, with the request (trigger, board, actor, program) as `context` and `source`/`target` null, no fighters in the request, no enemy drawn and no random number taken by the engine; a program that calls `FightEnemy` gets the full setup and the stock battle through to its outcome; a program name that matches no file is a catchable `program.missing` and no battle starts.
5. A game with no battle package ends the battle immediately with a diagnostic and no hang.
6. The phase list matches the 20.1 ruling and the phase test update is deliberate.

## Verification

Handoff start tests (random, custom, no-enemies), `Fight`/`FightEnemy` tests, a missing-package test, custom-fight tests (the program runs with the request as `context`, no random number is taken, `FightEnemy` from the program reaches the outcome, determinism, save and restore, a missing program), and the phase-list test. Full suite, typecheck and lint.

## Plan Change Log

- 2026-10-26 (owner ruling, Jensen; applied by the director): a random encounter draws from the main file's list; a custom encounter is spelled out. Resolved without a format change: the custom request stays as 5.11 posts it (no fighters, no draw), the engine runs its `program`, and the program names its enemies with `FightEnemy`. The intent, key decisions 1, 5 and 6 and acceptance 4 are rewritten; BAT-9, E-70, the random-encounters rule, the main-loop phase paragraph and the `executeProgram` caller table are amended first, in a docs-only change. The first build of this entry (#673) left acceptance 4 unmet because the request could not run; the follow-up code change builds it.
- 2026-10-26 (handoff to 7.12): with this ruling a program that runs its own battle loop takes its setup from the package's setup-only entry points (`stockBattle.prepareEnemies`, `stockBattle.prepareRandom`). The epic's Done-when 4 and entry 7.12 ask for that with the package absent; entry 7.12 proves the path and rules any public setup surface it needs.
