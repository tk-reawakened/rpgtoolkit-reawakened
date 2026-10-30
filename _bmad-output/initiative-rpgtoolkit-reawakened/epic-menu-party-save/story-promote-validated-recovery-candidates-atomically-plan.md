---
title: "Promote validated recovery candidates atomically"
type: 'feature'
ticket: 19
status: in-progress
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
- Selection order: shape-check the pointer; read that generation's candidate and metadata; validate the candidate and require its result to agree with both the pointer and the metadata. Any missing, corrupt or mismatching piece falls back to a newest-first scan of every generation, validates each fully, returns the newest valid candidate and repairs the pointer best effort.
- Retention: after a committed switch, prune generations other than the new current and the newest older generation that revalidates. When no older generation validates, keep the newest remaining generation so a transient unreadable candidate is not deleted. Pruning is best effort and only runs when the host exposes `remove`; keeping extra generations stays safe because selection revalidates everything it reads.
- Normal save/load, the VM snapshot, the ledger projection and the engine's save gate are unchanged. This ticket does not wire a host adapter, capture eligibility (#782) or ledger-first re-entry (#779).

## Implementation map

- `packages/core/src/save/recovery-store.ts`: exported `RecoveryStorage`, `RecoveryPointer`, `RecoveryCandidateMeta`, `ValidatedRecovery`, `RecoveryValidation`, `RecoveryValidate`, `RecoveryPromoteOptions`, `RecoverySelectOptions`, `RecoveryStoreError`, `RECOVERY_STORE_VERSION`, `promoteRecovery` and `selectRecovery`.
- Reference layout: `<gameId>/recovery/current.json`, `<gameId>/recovery/generations/<12-digit generation>/candidate.bin` and `.../meta.json`; the pointer and metadata are canonical JSON built with `canon`.
- `packages/core/src/save/index.ts` re-exports the API.
- `packages/core/test/recovery-store.test.ts`: an in-memory `RecoveryStorage` with injected write, atomic-write, read-override and removal behaviour covers success, refused validation, candidate/metadata/pointer write failures, missing or differing read-back, pointer read-back mismatch and restore, corrupt pointer, missing candidate, invalid newest generation fallback, changed candidate versus metadata, missing metadata, stale pointer repair, two-generation retention, validated pruning after a failed pointer switch, a corrupt newer generation with a valid older one, the no-validation retention fallback, a host without removal, per-game isolation and an unsafe gameId.

## Acceptance

Host-specific failure injection proves selection never exposes an unvalidated candidate and retains the current plus one previous validated generation. A failed promotion at any step before the pointer switch leaves the previous pointer selected. Selection returns `null` when no generation validates and repairs a missing or stale pointer when a valid generation exists.

## Verification

`node --test packages/core/test/recovery-store.test.ts`; then `pnpm typecheck`, `pnpm lint`, `pnpm graph`, `pnpm provenance` and the full `pnpm test` suite. The focused test uses no engine boot, rendering or ticks and stays well under the one-second owner rule. Checks are not run in this worktree delivery; the main agent runs them.

## Unresolved

- The serialized candidate and its validator belong to #778/#776; this module only compares the validator's result and never parses candidate bytes.
- A host adapter must implement `writeAtomic` with real durable atomicity (temporary file plus rename, or an equivalent storage primitive) and must serialize competing promotions across processes. Without those guarantees a host must not advertise durable interruption recovery.
- Capture eligibility and signal handling belong to #782; ledger-first paused re-entry belongs to #779.
