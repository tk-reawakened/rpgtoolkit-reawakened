---
title: 'Rule save compatibility across compiler versions'
type: 'spike'
ticket: 24
created: '2026-10-30'
status: 'in-progress'
baseline_revision: '3e084ca5'
risk: 'high'
review: 'full'
context:
  - 'docs/spec/formats/save-game.md'
  - 'docs/spec/engine/interruption-recovery.md'
  - 'docs/spec/engine/rpgcode-runtime.md'
---

## Intent

**Problem:** The owner's direction is that normal save files reliably migrate versions, and that compatibility is judged on compatible assets and format rather than strict version equality. The shipped contract does the opposite for the compiler version: a different `schema.compiler`, or any program reference whose `compiler` differs, refuses the whole save before a single section migration runs (owner ruling 2026-10-27, `docs/spec/formats/save-game.md:74-109`). The two directions cannot both stand as written.

**Approach:** Record what the compiler check actually protects, the exact observable limit and the tests that lock it, then present alternatives with consequences and one recommended policy. The owner decides; the policy is then written into `docs/spec/formats/save-game.md` in its own docs commit, and any runtime change is a separate story. **No runtime change is made by this spike.**

## Proposal and owner decision

**Question:** When may a normal save made by a different compiler build load, and what happens to the saved instruction positions it carries?

**Recommended policy (one sentence):** compiler compatibility rules on saved *instruction positions* — a thread resumes only when every intervening compiler version is recorded as position-preserving, otherwise that thread restarts from its saved program source — while the *envelope's data sections* migrate forward by their own versions; a save from a newer build is refused whole and leaves the live game unchanged.

Three parts, which must be written as separate rules and not merged:

1. **Sections migrate; positions do not.** A section version describes the shape of saved data, and its migration is a pure forward transform on the JSON (add fields, reshape, replace a placeholder) that needs no knowledge of the old compiler. A compiler version describes the *meaning of an `ip`* inside `vm.threads[].frames` — and only there. It cannot be migrated by transforming data; it is either still valid or has to be abandoned.
2. **A thread resumes only under a recorded position claim.** The contract carries one table of compiler versions, each row naming why the version was bumped and whether saved instruction positions remained valid (`preserved` / `changed`). If every version between the save and the running build is `preserved`, threads resume at their saved `ip` and operand stack after the section migrations. If any version in that range is `changed`, each position-bearing thread restarts from its saved program source — the same restart the existing `restore.source-changed` path performs, dropping the call stack and resetting locals — while every other section still loads with its migrated data. The restart is proved at load time by the existing `compileRestoredPrograms` pass, so a save whose restart cannot compile is refused before commit.
3. **Newer refuses; recovery stays strict.** A save whose compiler or section version is newer than the running build is refused whole (`restore.compiler-mismatch` / `restore.shape`), with the live game unchanged. A recovery candidate keeps the stricter like-for-like rule from #779: a paused board's entry and thread positions must reproduce exactly, so a compiler difference still refuses recovery and the player makes a new capture.

Program-reference compiler labels follow from (1): a frame's `program.compiler` is the position claim for that thread; an object record's `program.compiler` and a `vm.defOwners[*].compiler` carry no instruction position, are recompiled from source at load, and would stop refusing the save on their own.

**Decision (Jensen, 2026-10-DD):** *pending — this section is filled by the owner's ruling before the spec commit.*

## Evidence

### The ruling and its two refusal paths

- The normative rule is `docs/spec/formats/save-game.md:74-109` ("Compiler mismatch: refuse the whole save"). It refuses on `schema.compiler` *or* any program reference — every frame's `program`, every object record's `program`, every `vm.defOwners` entry — and places changed *source* on a separate per-thread restart rule.
- Normal `Load` enters at `restoreGameSave` (`packages/core/src/save/game-save.ts:113-114`): `refuseOtherCompiler(root.schema.compiler)` then `refuseOtherProgramCompilers(root)`, before the audio projection is parsed (`:115-160`), before the audio schema check (`:151-152`), and before `restoreGameState` (`:161`).
- Direct snapshot restore repeats both checks at `packages/core/src/save/snapshot.ts:959-960`, before `migrateEvents`, `migrateActors`, `validateActorsShape`, `migrateBattle`, `migrateMenuSections`, the section-presence loop, `migrateVm`, `migrateSprites`, `migrateInput`, `migrateTriggers`, `migrateAudio`, `validateBattleSection` and `validateShape` (`:965-985`).
- `refuseOtherCompiler` / `refuseOtherProgramCompilers` are defined at `packages/core/src/save/snapshot.ts:904-935`; the second walks frames in order, then objects, then `defOwners`, so the error names the first offending field.
- The recovery candidate uses the same envelope (`restoreRecoveryCandidate`, `game-save.ts:173-177`), and `docs/spec/engine/interruption-recovery.md:16` states that ordinary save compatibility is separate from recovery, which requires compatible assets rather than an exact version number.

### What the compiler version actually protects

- `COMPILER_VERSION = "2"` (`packages/core/src/script/program.ts:47`) is the only carrier of "how the step array was numbered". The schema-bump rule says a change to any `*State` type *or* to `StepOp` needs a section bump *or* a compiler bump plus a previous-version fixture (`packages/core/src/save/state.ts:12-18`). The single number therefore conflates saved-data-shape changes with instruction-position changes.
- A saved position lives only in a frame: `ip` plus `operands` (the partially evaluated expression stack), `Frame` at `packages/core/src/script/state.ts:93-99` and the restart shape at `packages/core/src/script/vm.ts:2964-2985`. Object records hold `handle`, `className`, `program`, `members`, `keys` (`docs/spec/engine/rpgcode-modules-and-objects.md:337`); `defOwners` is a definition→program map; `CallableValue` is `def` + `captures` + `receiver` + optional `owner` (`packages/core/src/ports/value.ts:40-47`). None of those carries an `ip`, and each is recompiled from source at load.
- The one real bump, 1 → 2, was a wholesale IR rewrite: `cae78909` replaced the tracer IR with the full linear `StepOp` IR and an operand stack ("linear StepOp IR with pos stamping, operand stack preservation across yields"). That is a *positions-changed* bump; a compiler-1 save's `ip` cannot be read against the compiler-2 step array.

### The migration machinery the check bypasses

Every one of these migrates forward and is exercised only by compiler-2 fixtures today (`packages/core/src/save/snapshot.ts`):

| Section | Current | Migration | Fixture |
|---|---|---|---|
| `events` | 1 | added when absent (`:650-655`) | schema-1 fixture has no section |
| `actors` | 2 | v1 records carried forward, newer rejected (`:225-247`, `docs/spec/engine/actors.md:320-323`) | `actors-v1.json` |
| `battle` | 2 | v1 placeholder replaced (`:68-79`) | `battle-v1.json` |
| `party`/`inventory`/`menu` | 2 | v1 empty placeholder replaced, newer rejected (`menu/migrate.ts:16-36`) | `menu-v1.json` |
| `vm` | 5 | v2→3 effects, v3→4 thread/block fields, v4→5 `files` (`:89-137`) | `v2-vm.json`, `v3-vm.json`, `v4-vm.json` |
| `sprites`/`triggers`/`input`/`audio`/`engine` | 2/2/2/2/1 | shape and placeholder migrations (`:138-300`) | mixed |
| `schema.compiler` | `"2"` | **no migration exists** — the only gate with no escape | `compiler-1-snapshot.json` |

All committed save fixtures except `compiler-1-snapshot.json` declare `schema.compiler = "2"` (measured over `packages/core/test/fixtures/save/*.json`). `save-migration.test.ts:217` iterates the older fixtures for the audio-placeholder migration and explicitly skips the compiler-1 save (`if (raw.schema.compiler !== "2") continue;`), so the migration chain has never once been exercised across a compiler boundary.

### Measured limit (probe on `3e084ca5`, scratch script, not committed)

- The compiler-1 fixture is refused untouched with `restore.compiler-mismatch` ("the snapshot's compiler 1 does not match 2").
- Relabelling `schema.compiler` alone still refuses, now located at `vm.threads[0].frames[0].program.compiler` — the per-program check is a second, independent gate.
- Relabelling **both** compiler fields restores cleanly: `schema.compiler` 2, `vm` 5, `audio` 2, and an `events` section is created. In other words the section migrations *can* carry this envelope; only the compiler gate stops it. Caveat: that fixture's single frame is at `ip 0` with an inline program, so this proves the envelope path, not position resumption.
- A newer section version is refused per section in most cases (`actors 99` → "newer than supported version 2"; `menu 99` → "must be exactly 1 or 2"; `sprites 99` → invalid schema; `vm 99` → refused by shape requirements), **but a newer `engine` version (99) was accepted**. "A newer save is refused" is therefore not uniformly true today, and part 3 above needs the missing guard.

### Tests that lock the current behaviour

- `packages/core/test/save-compiler-refusal.test.ts` — 7 tests: control compatible save resumes; a changed file source restarts only that thread; a missing program is refused whole; compiler mismatch is reported even when the audio projection is malformed; an object-program mismatch is reported before malformed schema and audio; a missing object program refuses before commit; and a failed load leaves the game and its request-id counter exactly as a refused-for-absence load does.
- `packages/core/test/script-state.test.ts:66-125` — 5 tests: a different `schema.compiler` and a missing section; the compiler-1 fixture refused "before reading payload"; a frame program, a file-backed owner program and a `vm.defOwners` entry from another compiler each refused whole rather than restarted.
- `packages/core/test/save-migration.test.ts` — the section-migration chain and fixtures, all compiler-2 (see the skip at `:217`).

### A refused save leaves the game unchanged

`restoreGameSave` is pure; the engine's game-load branch (`packages/core/src/engine/engine.ts:1421-1436`) calls `applyLoadedGame` only after it returns, and on a `ScriptError` it pushes the located diagnostic and replies `{ ok: false, value: message }` to the waiting `Load`. The spec records that a refused load restores every engine counter it touched, including the request-id counter (`save-game.md:98-100`), and the last test above locks it.

### Precedent worth weighing

The project already refuses to migrate a save shape no player could hold — the pre-`keys` class-instance record keeps `vm` version 5 with no migration "because the product has no released saves to protect" (`docs/spec/engine/rpgcode-modules-and-objects.md:337`, citing ADR 0009). Compatibility is therefore a forward promise this project chooses to make, not a legacy burden it inherited, and the cost of the recommendation should be judged against that.

## Alternatives and consequences

| # | Alternative | Consequence |
|---|---|---|
| A | **Keep the refusal** (status quo). | Every compiler bump invalidates every existing save, including saves made minutes earlier by the previous release. Zero work, but it contradicts the owner's direction and makes "reliably migrate versions" true only for section data. |
| B | **Relabel and resume**: accept any older compiler and restore its `ip` unchanged. | Measured above: the compiler-1 fixture then "restores cleanly", which is exactly why it is tempting — and exactly why it is unsafe. A compiler-1 `ip` indexes the pre-rewrite step array; resuming it can execute the wrong instruction, silently corrupt state or crash mid-thread. |
| C | **Restart every thread whenever the compiler differs** (no version table). | Data survives, no guessing, small implementation. But it discards position continuity even for a bump that never touched instruction numbering, and it turns every thread restart into a replay. |
| D | **Position-claim table + per-thread restart on `changed`** (recommended). | Continuity where the positions are provably still valid, a documented replay where they are not, refusal only for a newer build. Needs one table row per compiler bump and a way to keep a `preserved` claim honest. |
| E | **Split `irVersion` from `schema.compiler`** as its own saved field. | Cleanest long-term data model, but it changes the save shape (a `schema` section bump) to express something the version table already answers, and it must be done in a save-format change rather than here. Reasonable later, alongside a real IR change. |
| F | **Accept a compiler difference only when the save has no live frames.** | Almost every real save has at least one thread, so the benefit is negligible and the rule adds a special case for saves that are not interesting. |

## Consequences of the recommendation

- **The contract gains one table, not one more flag.** `docs/spec/formats/save-game.md` records each compiler version with its reason and a `positions: preserved|changed` claim. The existing 1 → 2 row is `changed`. A bump for a pure state-shape change is `preserved`.
- **A `preserved` claim must be checkable.** No step-op golden exists today; a compiler-IR fingerprint over a fixture program corpus (hash of each program's lowered `StepOp` list) makes an unintended position shift fail CI, so the claim cannot rot silently. Adding it is part of the follow-up story, not this spike.
- **Restart is a documented exposure, not a new one.** A `changed` bump replays any thread that was mid-run, so a cutscene can show again and a script can award twice — the same exposure the existing `restore.source-changed` rule already accepts for one changed file. It happens only on a position-changing bump, and the alternative is refusing the whole save.
- **Section guards get one small fix.** The `engine` section's missing newer-version check is closed so "newer refuses" is actually true for every section.
- **Recovery does not change.** #779's like-for-like rule (assets, format, paused positions) keeps refusing a compiler difference for a recovery candidate; the player captures again. The two rules stay separate so neither is weakened by the other.
- **Follow-up work is a separate story:** write the table and rules into the contract, then implement resume-under-`preserved`, restart-under-`changed` (plus recompiled object/owner refs), the `engine` guard, a compiler-2 fixture from the current build consumed by a compiler-3 build as the first `preserved` rehearsal, the compiler-1 fixture as the first `changed` restart test, and the unchanged-live-game assertions.

## Open questions for the owner

1. Is the replay exposure in part 2 acceptable — a mid-scene thread re-running from its start after a position-changing compiler bump, in exchange for loading the save at all?
2. Does recovery keep the strict like-for-like rule (no compiler difference, ever), or should it also take the restart path?
3. Should the follow-up adopt the compiler-IR fingerprint now, or only when a second compiler bump is actually planned?
