---
title: "Carry saves across instruction versions"
ticket: 25
status: done
---

## Intent

Implement the owner-approved #809 policy: a save records data shape in its per-section versions and the meaning of a saved instruction position in `schema.ir` (mirrored by `ProgramRef.ir`). Data sections migrate forward; a thread resumes only when its instruction version is current, an older one restarts that thread from its saved source, and a newer one refuses the whole save.

Contract: `docs/spec/formats/save-game.md#save-compatibility-and-instruction-versions-owner-ruling`.

## What changed

- `IR_VERSION = "1"` replaces `COMPILER_VERSION`; `ProgramRef.compiler` becomes `ProgramRef.ir` (and the compiled-program cache key follows).
- `schema` is version 2 with `ir` instead of `compiler`; `vm` is version 6. A version-1 save maps `compiler "2"` to `ir "1"` and any other compiler to `ir "0"` ("positions not valid"); the `vm` migration renames every frame, object and `defOwners` reference the same way.
- `restoreGameState` migrates the schema section first, refuses a newer `schema.ir` with `restore.ir-mismatch` before payload validation, then runs every section migration and applies the thread rule: a frame with an older `ir` restarts its thread (root frame at `ip 0`, call stack, locals and saved wait dropped) and the loaded state's `schema.ir` becomes the running version. Position-free references (object programs, `defOwners`, callables) are recompiled from source and never gate the save.
- The four former compiler gates (`game-save.ts`, both `restoreGameState` helpers, `validateProgramRef`, `verifyRestoredHandles`) are replaced by shape validation plus the thread rule. `restore.compiler-mismatch` is retired.
- Recovery passes `requireCurrentIr`, so any instruction-version difference refuses a candidate with `restore.ir-mismatch` and stored bytes are untouched.
- The `engine` section gains the missing newer-version guard.
- The game-ledger projection's `compiler` becomes `ir` and `GAME_LEDGER_VERSION` moves to 2.
- New `packages/core/test/script-ir-fingerprint.test.ts` pins a hash of each corpus program's lowered `StepOp` stream (source positions excluded); changing the lowering without re-recording fails the test, and the message tells the author to bump `IR_VERSION` if a saved `ip` now means a different instruction.
- Save fixtures from before the split (`v2-vm.json`, `v3-vm.json`, `v4-vm.json`, `compiler-1-snapshot.json`, the battle fixtures) exercise both migrations. `battle-v2-{out,mid}.json` are regenerated to the current shape because they are current-save goldens.

## Verification

Merged PR #817 as `f463bccfed61a683a52b063c1b126ab2c43f4ab1`. `packages/core/test/save-instruction-version.test.ts` passes 15/15, covering resume, older-`ir` restart, newer-`ir` refusal with an unchanged game, position-free references, recovery strictness, and the unchanged request counter. `script-state.test.ts` adds the compiler-1 fixture load (data migrated, thread restarted, current `ir` recorded), and `save-migration.test.ts` passes 20/20 with the schema-2/vm-6 chain. The full suite passes 2394 tests with no skips after deliberately re-recording the state-hash goldens (`golden:record`, `closing:record`, `golden/actors/battle-scripts.json`, the corpus and battle-custom-program pins, the ledger envelope vector); only the schema and instruction-version fields moved, which is the reason for every re-recorded hash. `typecheck` and `lint` pass, and every repository check passed.

## Unresolved

None for this story. A future position-changing compiler bump must add a save fixture from the previous build and update the fingerprint in the same change.
