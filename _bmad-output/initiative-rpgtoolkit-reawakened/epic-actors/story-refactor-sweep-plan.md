---
type: 'feature'
title: "Refactor sweep"
ticket: 14
tracker_id: "#479"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/479"
parent: epic-actors
created: '2026-10-19'
status: done
baseline_revision: '0975a26b54f8d7bf569f463a02b783b16ec0ea98'
risk: "low"
review: thorough
context: ["{project-root}/docs/guardrails.md", "spec - docs/spec/engine/actors.md", "epic - _bmad-output/initiative-rpgtoolkit-reawakened/epic-actors/epic-actors.md, Done when"]
---

# Refactor sweep

## Intent

**Problem.** Entries 20.1 to 20.13 built the actor model across the core, the script surface and two
stock packages, each landing its own barrel, registration and doc edit. The sweep has to establish
that exactly one actor representation survived, that the shared seams name the final shape, and that
the epic's Done-when holds against the merged code rather than against the plans.

**Approach.** Audit the four named seams (actors barrel, section list, built-in registrations,
catalogue and command docs) and the epic's eight Done-when items against the merged tree, then fix
only the drift the audit finds. Two drifts were found and corrected; no runtime behaviour changed
and nothing was removed, because no second actor representation exists to remove.

## Boundaries

**Always:** follow G1–G7; keep every observable behaviour, golden and hash unchanged; cite the
specification or the owner decision behind each edit; leave package-owned follow-ups with their
owners (the stock game bridge is 20.15, dialogue `talked` is 8.12).

**Never:** change actor rules, save shapes, goldens, or other sessions' worktrees; invent an owner
ruling; remove exported core API that other worktrees may consume.

## Tasks & Acceptance

- [x] `docs/spec/engine/actors.md:24` — the actor kind list said "`party`, `enemy`, `npc`, or board
      sprite", contradicting the owner decision of 2026-10-19 ("board sprites are not actors") and
      the same page's own rule at line 81. The kind list now names the three `ACTOR_KINDS` the code
      accepts and points at the sprite section.
- [x] `packages/core/src/save/sections.ts:1-7` — the header named the sections "owned elsewhere" as
      `sprites`, `triggers`, `battle`, `audio`, `events` and omitted `actors`, `party`, `inventory`
      and `menu`, which the barrel also re-exports. Each is now named.
- [x] Audit: one actor representation, barrels, registrations, catalogue and command docs (evidence
      below); no production code removed.

**Acceptance:** the Done-when is checked item by item with evidence; no second actor
representation, duplicate stat store or obsolete barrel remains; the full suite, goldens and gates
pass.

## Done-when audit

Item numbers are the epic's own list (`epic-actors.md`, Done when).

| # | Claim | Evidence in the merged tree |
|---|---|---|
| 1 | Actor model inventory in `docs/spec`, approved | `docs/spec/engine/actors.md:236` (`{#act-inventory}`) — one row per persisted source field with type, writer, rule owner and evidence, plus the separate sprite table at `:322` ("Sprite state (sprites section, separate from actors)"). |
| 2 | Party, enemies and NPCs are plain-data actors in one section; sprites separate and only referencing an actor | `packages/core/src/actors/model.ts:14` (`ACTOR_KINDS = ["party","enemy","npc"]`), `:117` (`ActorsSection`); hydration from the Epic 2 readers in `actors/hydrate.ts:139,160,170`; one save section in `save/sections.ts:43` and `save/state.ts:118,173`; sprites keep no stats and carry only an optional `actorId` (`sprites/model.ts:97-99`), and the rule is stated at `docs/spec/engine/actors.md:81-111`. No other record type holds actor stats (`battle/model.ts:8` stores party/actorId/charge only). |
| 3 | Fallen, status countdown, equipment bonuses and level-up are core defaults | `actors/rules.ts:194-211` (absolute stats patch emitting fallen/revived transitions), `:296` (`advanceStatus`), `:365` (`deriveEquipmentBonuses`), and the closed hook list `:89-93` with core defaults applied when no hook answers. |
| 4 | A package registers named behaviours; an actor carries only the name | `actors/behaviour.ts:112,165` (unknown-hook and missing-behaviour diagnostics), `ActorRecord.behaviour` in `actors/model.ts:105`; package-side registration is session data rebuilt at start-up. |
| 5 | Saves hold data and behaviour names; load re-attaches by name; a missing behaviour gives the core default and a diagnostic | `actors/hydrate.ts`, `save/snapshot.ts` actors migration (v1 → v2, `docs/spec/engine/actors.md:33`), and `behaviour.missing` diagnostic at `actors/behaviour.ts:165` ("using core defaults"). |
| 6 | Events through Epic 19 emitters; stock actor code re-emits `stock-rpg.fallen` | `actors/rules.ts:24-26` transitions, `actors/object.ts:71-72` (queued per actor), emitters in `engine/engine.ts`; the package bridge is the native `bridgefallen` command in `script/stock-rpg.ts:7-28` emitting `stock-rpg.fallen` on the game. `talked` stays with 8.12. |
| 7 | `stock_battle` and `stock_menu` exist; new-project templates list them; legacy DLLs map to them | `stock/stock_battle`, `stock/stock_menu`, `stock/stock_rpg`; `formats/main-file/reader.ts:261` (`NEW_PROJECT_PACKAGE_PLUGINS = ["stock_battle","stock_menu"]`); `engine/boot.ts:72` maps `tk3fight.dll` to `stock_battle` (and the menu counterpart beside it). |
| 8 | Two authored battle scripts (12 hearts, 9999 HP) run over the same actor model with a save mid-fight; legacy goldens unchanged | `golden/actors/battle-scripts.json` (programs `zelda`, `ff`), `packages/core/test/battle-scripts.test.ts:253-284` (hearts rule decides every hit; 9999 HP with armour; "every battle tick saves and restores to the same hash"). No legacy golden was touched. |

Package-owned remainder, unchanged by this sweep: the stock RPG game bridge landed as 20.15 (#563)
and dialogue `talked` is Epic 8.12.

## Seams reconciled

- **Actors barrel** — `actors/index.ts` re-exports model, port, object, hydrate, rules and behaviour,
  and `core/index.ts:16` exports it once; no second actor module exists (`actors/` is the only
  directory holding actor state). `applyActorAction`, `hydratePlayerActor` and the other single-use
  helpers are public core API exercised by the actor tests; they were left in place deliberately.
- **Section list** — `save/sections.ts` now names all nine externally-owned sections; `save/state.ts`
  registers `actors` in `SCHEMA_VERSIONS` and `createGameState`, and `resetLifecycle` clears it with a
  fresh state (`engine/engine.ts:1589`).
- **Built-in registrations** — the actor host type and service are created once in
  `script/vm.ts:183` (`createActorService`, `createActorHostType`) and passed to plugin views
  (`script/plugin.ts:85`); the stat aliases (`HP!`, `Level!`) resolve to the actor owner through
  `script/virtuals.ts:84-123` and keep no copy.
- **Catalogue and command docs** — the actor-facing commands (`hp`, `givehp`, `maxhp`, `getmaxhp`,
  `smp`, `givesmp`, `applystatus`, `giveexp`) are declared once in
  `script/packs/battle.ts` with their docs; `docs/spec/engine/rpgcode-functions.md:399,425,428`
  matches those signatures, and `pnpm catalogue:check`/`command-docs:check` are green.

## Verification

- Focused: `node --test packages/core/test/actors.test.ts packages/core/test/actor-rules.test.ts
  packages/core/test/actor-behaviour.test.ts packages/core/test/battle-scripts.test.ts` — the audit's
  claims above.
- Run here: `node --test` over the four focused files (46 tests, all pass) and `pnpm typecheck`,
  `pnpm lint` (both green) at `c8afdb9f`.
- Left to the pull request's CI, which runs the whole gate set: `pnpm graph`, `pnpm fixtures:*`,
  `pnpm catalogue:check`, `pnpm command-docs:check`, `pnpm golden`, `pnpm golden:bun`, `pnpm licence`,
  `pnpm provenance`, `pnpm no-skips:test`, the unit shards and `gate`. The sweep changes one
  documentation sentence and one source comment, so no golden or hash can move.

## Plan Change Log

- 2026-10-30 (built): audit completed against `origin/main` `27d5e342`. Two drifts fixed (actor kind
  list; section-owner comment). No second actor representation exists, so nothing was removed; the
  package-owned bridge (20.15) and `talked` (8.12) remain with their owners.
