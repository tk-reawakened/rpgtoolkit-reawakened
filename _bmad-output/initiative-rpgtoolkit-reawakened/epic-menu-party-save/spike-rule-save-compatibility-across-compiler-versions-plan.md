---
title: 'Rule save compatibility across compiler versions'
type: 'chore'
ticket: 24
created: '2026-10-30'
status: 'done'
baseline_revision: '3e084ca5'
risk: 'high'
review: 'full'
context: ['docs/spec/formats/save-game.md', 'docs/spec/engine/interruption-recovery.md', 'docs/spec/engine/rpgcode-runtime.md']
---

## Intent

**Problem:** The owner's direction is that normal save files reliably migrate versions, and that compatibility is judged on compatible assets and format rather than strict version equality. The shipped contract does the opposite for the compiler version: a different `schema.compiler`, or any program reference whose `compiler` differs, refuses the whole save before a single section migration runs (owner ruling 2026-10-27, `docs/spec/formats/save-game.md:74-109`). The two directions cannot both stand as written.

**Approach:** Record what the compiler check actually protects, the exact observable limit and the tests that lock it, then present alternatives with consequences and one recommended policy. The owner decided; the policy is recorded in `docs/spec/formats/save-game.md` in its own commit, and the implementation is a separate story. **No runtime change is made by this spike.**

## Proposal and owner decision

**Question:** When may a normal save made by a different compiler build load, and what happens to the saved instruction positions it carries?

**Decision (Jensen, 2026-10-30): separate the instruction version from the save's data versions.** A dedicated `irVersion` carrier, not a per-version compatibility table.

**Accepted policy:**

1. **Two identities, one carrier each.** Per-section versions (and the `schema` version) describe saved *data shape*; they migrate forward. A new `schema.ir` — mirrored by `ProgramRef.ir` — describes the meaning of a saved instruction position. `schema.compiler` retires; it was doing both jobs badly.
2. **`ir` changes only when positions change.** A data-shape change bumps the affected section version (or `schema`) and leaves `ir` alone, so a save from any release whose instruction numbering is unchanged resumes at its saved `ip` and operand stack after the section migrations. `ir` is bumped exactly when the step set, the lowering, or the emission order changes what an `ip` means.
3. **An older `ir` restarts the position-bearing threads from source.** The envelope and every data section still migrate; each thread whose frames carry an older `ir` restarts from its saved program source at load time — the existing `restore.source-changed` restart: root frame at `ip 0`, call stack dropped, locals reset. The restart is compiled before commit through `compileRestoredPrograms`, so an uncompilable restart refuses the save and leaves the game unchanged. Saves written before the split map `compiler "2"` → `ir "1"` and any other compiler value → `ir "0"` ("positions not valid"), so a compiler-1 save migrates its data and restarts its thread instead of vanishing.
4. **A newer `ir` or a newer section version refuses the whole save** with a located diagnostic (`restore.ir-mismatch` supersedes `restore.compiler-mismatch` for instruction versions), and the live game is unchanged.
5. **Position-free references never gate the save.** Object records, `vm.defOwners` entries and callables carry no `ip`; they are recompiled from source at load, and only a missing or uncompilable program refuses (the existing `program.missing` / `program.include-missing` checks). A `def` that only a restarted program defined is reported as unknown, as today.
6. **Recovery stays strict** (owner decision, #779): a recovery candidate needs like-for-like assets *and* format, including `ir`. A difference refuses the candidate without touching stored bytes; the player captures again. Normal-save migration does not loosen recovery.
7. **A fingerprint keeps the field honest** (owner decision): a hash of each corpus program's lowered `StepOp` list becomes a CI golden, so a lowering change that forgets to bump `ir` fails CI instead of silently misreading saved positions.

## Evidence

### The ruling and its refusal sites

- The normative rule is `docs/spec/formats/save-game.md:74-109` ("Compiler mismatch: refuse the whole save"). It refuses on `schema.compiler` *or* any program reference — every frame's `program`, every object record's `program`, every `vm.defOwners` entry — and places changed *source* on a separate per-thread restart rule.
- Normal `Load` enters at `restoreGameSave` (`packages/core/src/save/game-save.ts:113-114`): `refuseOtherCompiler(root.schema.compiler)` then `refuseOtherProgramCompilers(root)`, before the audio projection is parsed (`:115-160`), before the audio schema check (`:151-152`), and before `restoreGameState` (`:161`).
- Direct snapshot restore repeats both checks at `packages/core/src/save/snapshot.ts:959-960`, before `migrateEvents`, `migrateActors`, `validateActorsShape`, `migrateBattle`, `migrateMenuSections`, the section-presence loop, `migrateVm`, `migrateSprites`, `migrateInput`, `migrateTriggers`, `migrateAudio`, `validateBattleSection` and `validateShape` (`:965-985`).
- `refuseOtherCompiler` / `refuseOtherProgramCompilers` are defined at `packages/core/src/save/snapshot.ts:904-935`; the second walks frames in order, then objects, then `defOwners`, so the error names the first offending field.
- Two more gates repeat the same check deeper in: `validateProgramRef` (`snapshot.ts:340-357`, called for frames at `:415`, object programs at `:471` and `defOwners` at `:640`) and `verifyRestoredHandles` (`packages/core/src/script/restore-check.ts:86-100`). The comment above `verifyRestoredHandles` still says a program "that an older compiler built, is skipped: its thread restarts from source on its next turn" (`:104-110`) — the pre-ruling behaviour, now unreachable. The accepted policy revives that intent for an older `ir`, so the comment and the surviving gates must move together.
- The recovery candidate uses the same envelope (`restoreRecoveryCandidate`, `game-save.ts:173-177`), and `docs/spec/engine/interruption-recovery.md:16` states that ordinary save compatibility is separate from recovery, which requires compatible assets rather than an exact version number.

### What the compiler version actually protects

- `COMPILER_VERSION = "2"` (`packages/core/src/script/program.ts:47`) is the only carrier of "how the step array was numbered". The schema-bump rule says a change to any `*State` type *or* to `StepOp` needs a section bump *or* a compiler bump plus a previous-version fixture (`packages/core/src/save/state.ts:12-18`). The single number therefore conflates saved-data-shape changes with instruction-position changes — the defect the accepted policy removes.
- A saved position lives only in a frame: `ip` plus `operands` (the partially evaluated expression stack), `Frame` at `packages/core/src/script/state.ts:93-99` and the restart shape at `packages/core/src/script/vm.ts:2964-2985`. Object records hold `handle`, `className`, `program`, `members`, `keys` (`docs/spec/engine/rpgcode-modules-and-objects.md:337`); `defOwners` is a definition→program map; `CallableValue` is `def` + `captures` + `receiver` + optional `owner` (`packages/core/src/ports/value.ts:40-47`). None of those carries an `ip`, and each is recompiled from source at load. `ProgramRef` carries `compiler` in both variants (`program.ts:61-89`) and uses it only in the cache key (`:125-126`).
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
- A newer section version is refused per section in most cases (`actors 99` → "newer than supported version 2"; `menu 99` → "must be exactly 1 or 2"; `sprites 99` → invalid schema; `vm 99` → refused by shape requirements), **but a newer `engine` version (99) was accepted**. "A newer save is refused" is therefore not uniformly true today, and the policy's part 4 needs the missing guard.

### Tests that lock the current behaviour

- `packages/core/test/save-compiler-refusal.test.ts` — 7 tests: control compatible save resumes; a changed file source restarts only that thread; a missing program is refused whole; compiler mismatch is reported even when the audio projection is malformed; an object-program mismatch is reported before malformed schema and audio; a missing object program refuses before commit; and a failed load leaves the game and its request-id counter exactly as a refused-for-absence load does.
- `packages/core/test/script-state.test.ts:66-125` — 5 tests: a different `schema.compiler` and a missing section; the compiler-1 fixture refused "before reading payload"; a frame program, a file-backed owner program and a `vm.defOwners` entry from another compiler each refused whole rather than restarted.
- `packages/core/test/save-migration.test.ts` — the section-migration chain and fixtures, all compiler-2 (see the skip at `:217`).

### A refused save leaves the game unchanged

`restoreGameSave` is pure; the engine's game-load branch (`packages/core/src/engine/engine.ts:1421-1436`) calls `applyLoadedGame` only after it returns, and on a `ScriptError` it pushes the located diagnostic and replies `{ ok: false, value: message }` to the waiting `Load`. The spec records that a refused load restores every engine counter it touched, including the request-id counter (`save-game.md:98-100`), and the last test above locks it.

### Precedent worth weighing

The project already refuses to migrate a save shape no player could hold — the pre-`keys` class-instance record keeps `vm` version 5 with no migration "because the product has no released saves to protect" (`docs/spec/engine/rpgcode-modules-and-objects.md:337`, citing ADR 0009). Compatibility is therefore a forward promise this project chooses to make, not a legacy burden it inherited, and the cost of the accepted policy should be judged against that.

## Alternatives and consequences

| # | Alternative | Consequence |
|---|---|---|
| A | **Keep the refusal** (status quo). | Every compiler bump invalidates every existing save, including saves made minutes earlier by the previous release. Zero work, but it contradicts the owner's direction and makes "reliably migrate versions" true only for section data. |
| B | **Relabel and resume**: accept any older compiler and restore its `ip` unchanged. | Measured above: the compiler-1 fixture then "restores cleanly", which is exactly why it is tempting — and exactly why it is unsafe. A compiler-1 `ip` indexes the pre-rewrite step array; resuming it can execute the wrong instruction, silently corrupt state or crash mid-thread. |
| C | **Restart every thread whenever the compiler differs.** | Data survives with no guessing, but it replays running scripts even when only a data shape changed — exactly the common case the owner wants to keep continuous. |
| D | **Per-version `preserved`/`changed` compatibility table** on the existing compiler number. | Delivers the same behaviour as E but keeps the conflated carrier and adds a claim per release that must be checked and maintained. Superseded by E: a dedicated `ir` makes every bump a position change by definition, so no table is needed. |
| E | **Separate `irVersion` from the data versions** (accepted). | One carrier per job: section versions migrate data, `ir` alone decides resume-or-restart. Costs a save-shape change (`schema` 1→2, `vm` 5→6, `ProgramRef.compiler` → `ProgramRef.ir`), a renamed diagnostic, and re-recorded goldens — the honest price of fixing the conflation. |
| F | **Accept a compiler difference only when the save has no live frames.** | Almost every real save has at least one thread, so the benefit is negligible and the rule adds a special case for saves that are not interesting. |

## Consequences of the accepted policy

- **Save shape changes once.** `schema` goes to version 2: `ir` is added and `compiler` is dropped, with a v1 fixture whose migration maps `compiler "2"` → `ir "1"` and any other compiler → `ir "0"`. `vm` goes to version 6: `ProgramRef.compiler` becomes `ProgramRef.ir`, with a v5 fixture. `COMPILER_VERSION` retires in favour of `IR_VERSION = "1"`. The state hash changes with the `schema` field set, so the goldens are re-recorded in that story.
- **The diagnostic is renamed.** A newer `ir` reports `restore.ir-mismatch`; `restore.compiler-mismatch` retires with the gate. A refused load still leaves the game and its counters unchanged.
- **Four gates become one rule.** `game-save.ts:113-114`, the two `refuseOtherProgramCompilers`/`refuseOtherCompiler` calls at `snapshot.ts:959-960`, `validateProgramRef`'s compiler check (`:344-352`) and the `defOwners` gate in `verifyRestoredHandles` (`restore-check.ts:86-100`) are replaced by: migrate data, compare each frame's `ir`, restart or refuse. The stale "older compiler restarts" comment becomes the real behaviour for an older `ir`.
- **Restart is a documented exposure, not a new one.** A restarted thread replays from its root program, so a cutscene can show again and a script can award twice — the same exposure the existing `restore.source-changed` rule accepts for one changed file. It happens only when `ir` actually moved, and the alternative is refusing the whole save.
- **Section guards get one small fix.** The `engine` section's missing newer-version check is closed so "newer refuses" is true for every section.
- **The fingerprint is required, not optional.** `ir` is now the only thing standing between a saved `ip` and a wrong instruction, so a step-op fingerprint over a fixture corpus must fail CI when lowering changes without an `ir` bump.
- **Recovery does not change.** #779's like-for-like rule keeps refusing a recovery candidate across an `ir` difference; the player captures again. The two rules stay separate so neither is weakened by the other.
- **Follow-up implementation story (#814):** the save-shape migrations and fixtures, `IR_VERSION`, the resume/restart rule with the mapped legacy sentinel, the `engine` newer-version guard, the `restore.ir-mismatch` rename, the compiler-1 fixture as the first restart test, a newer-`ir` refusal test, the unchanged-live-game assertions, and the step-op fingerprint golden.

## Completion evidence

Merged PR #813 (evidence) and PR #815 (policy) as `b3f1c340d27a7efcb40d4008a4d03e0f755cbd3e`.

## Owner decisions recorded

1. Save-compatibility carrier: **separate `irVersion` field** (option E), not the per-version table.
2. Recovery: **keep the strict like-for-like rule**; a compiler/IR difference still refuses a recovery candidate.
3. Position-claim integrity: **add the compiler-IR fingerprint now**, not only when the next bump is planned.
4. The policy is recorded in `docs/spec/formats/save-game.md#save-compatibility-and-instruction-versions-owner-ruling`; implementation is #814.
