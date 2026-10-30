---
title: "Promote validated recovery candidates atomically"
type: 'feature'
ticket: 19
status: done
created: '2026-10-29'
risk: "high"
context:
  - "normative - docs/spec/engine/interruption-recovery.md#capture-and-publication"
  - "normative - docs/spec/engine/interruption-recovery.md#reference-recovery-store-layout"
  - "contract - _bmad-output/initiative-rpgtoolkit-reawakened/epic-menu-party-save/recovery-checkpoint-proposal.md"
  - "ledger - docs/spec/formats/save-game.md#game-ledger-and-savable-continuation"
---

## Intent

Add the host-agnostic half of interruption recovery: a pure promotion and selection algorithm over an injected recovery store (#783). Promotion writes a separate candidate generation, validates the stored read-back and only then atomically switches the game-scoped pointer, retaining the current and one previous validated generation. Selection revalidates the pointed generation before returning it and falls back newest-first when the pointer or candidate is unusable. Never return bytes that did not just pass validation.

## Contract and boundaries

- `packages/core/src/save/recovery-store.ts` is pure and synchronous: no host APIs, no I/O, no clock and no game logic (G2, G3).
- `RecoveryStorage` is the only host seam: `read(path)` (null when absent), `write(path, bytes)`, `writeAtomic(path, bytes)`, `list(prefix)` and an optional `remove(path)`. Paths are gameId-relative below the host's durable save area; the module supplies them all.
- The validator callback (`validate(bytes)`) owns game identity, version, integrity, completeness and ledger consistency and returns `{ tick, ledgerHash }` or throws. The store compares only those returned values, so no game-specific rule lives here.
- Promotion order: validate the in-memory candidate first; write a new generation's candidate; read it back and validate; require the read-back tick and ledger hash to equal the first validation; write generation metadata; atomically replace the pointer; read the pointer back. A failure before the switch leaves the previous pointer selected; a pointer read-back failure restores the previous pointer when it was readable.
- Selection order: shape-check the pointer; read that generation's candidate and metadata; validate the candidate and require its result to agree with both the pointer and the metadata. Any missing, corrupt or mismatching piece falls back to a newest-first scan of every generation, validates each fully, returns the newest valid candidate and repairs the pointer best effort. A throwing host read is *unreadable*, not corrupt: selection may return an older valid generation but does not repair the pointer when the pointer read threw, when the pointed generation was unreadable, or when any generation newer than the selected one was unreadable.
- Retention: after a committed switch, prune generations other than the new current and the newest older generation that revalidates. When no older generation validates, keep the newest remaining generation so a transient unreadable candidate is not deleted. Pruning is best effort and only runs when the host exposes `remove`; keeping extra generations stays safe because selection revalidates everything it reads.
- Normal save/load, the VM snapshot, the ledger projection and the engine's save gate are unchanged. This ticket does not wire a host adapter, capture eligibility (#782) or ledger-first re-entry (#779).

## Implementation map

- `packages/core/src/save/recovery-store.ts`: exported `RecoveryStorage`, `RecoveryPointer`, `RecoveryCandidateMeta`, `ValidatedRecovery`, `RecoveryValidation`, `RecoveryValidate`, `RecoveryPromoteOptions`, `RecoverySelectOptions`, `RecoveryStoreError`, `RECOVERY_STORE_VERSION`, `promoteRecovery` and `selectRecovery`.
- Reference layout: `<gameId>/recovery/current.json`, `<gameId>/recovery/generations/<12-digit generation>/candidate.bin` and `.../meta.json`; the pointer and metadata are canonical JSON built with `canon`.
- `packages/core/src/save/index.ts` re-exports the API.
- `packages/core/test/recovery-store.test.ts`: an in-memory `RecoveryStorage` with injected write, atomic-write, read-override and removal behaviour covers success, refused validation, candidate/metadata/pointer write failures, missing or differing read-back, pointer read-back mismatch and restore, corrupt pointer, missing candidate, invalid newest generation fallback, changed candidate versus metadata, missing metadata, stale pointer repair, unreadable pointed candidate/metadata without pointer demotion, a throwing pointer read without repair, an unreadable newer generation during a scan without repair, corrupt-candidate repair, two-generation retention, validated pruning after a failed pointer switch, a corrupt newer generation with a valid older one, the no-validation retention fallback, a host without removal, per-game isolation and an unsafe gameId.

## Acceptance

Host-specific failure injection proves selection never exposes an unvalidated candidate and retains the current plus one previous validated generation. A failed promotion at any step before the pointer switch leaves the previous pointer selected. Selection returns `null` when no generation validates and repairs a missing or stale pointer when a valid generation exists. A throwing read on the pointer, the pointed candidate/metadata, or a generation newer than the selected one returns a fallback without repairing or demoting the pointer; absent or corrupt content still repairs it.

## Verification

Merged PR #802 as `3d006cac6e30455a4c70cba978d33b45924f2361`. Focused recovery-store tests passed 26/26; the full strict suite passed 2368 tests with no skips, and all repository checks passed. Independent reviews found and fixed unvalidated pruning retention and transient-read pointer demotion.

## Unresolved

- The serialized candidate and its validator belong to #778/#776; this module only compares the validator's result and never parses candidate bytes.
- A host adapter must implement `writeAtomic` with real durable atomicity (temporary file plus rename, or an equivalent storage primitive) and must serialize competing promotions across processes. Without those guarantees a host must not advertise durable interruption recovery.
- Capture eligibility and signal handling belong to #782; ledger-first paused re-entry belongs to #779.
