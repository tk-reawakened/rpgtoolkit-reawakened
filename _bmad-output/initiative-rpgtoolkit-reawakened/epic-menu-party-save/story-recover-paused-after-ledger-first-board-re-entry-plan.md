---
title: "Recover paused after ledger-first board re-entry"
type: 'feature'
ticket: 20
status: in-progress
created: '2026-10-30'
risk: "high"
context:
  - "normative - docs/spec/engine/interruption-recovery.md#recovery-and-pause"
  - "startup order - docs/spec/engine/main-loop-and-startup.md#reawakened-boot-sequence"
  - "ledger - packages/core/src/save/ledger.ts"
  - "recovery store - packages/core/src/save/recovery-store.ts"
  - "checkpoint capture - packages/core/src/engine/engine.ts"
  - "re-entry audit - RecoveryReentryMap"
---

## Intent

Accept only a host-validated recovery candidate for a recovery launch, run the main file, required assets, normal startup program and player-presence check first, then restore the candidate's durable ledger and prepare its saved board. Expose the restored board paused; start its board and item threads and entry program once, in ordinary entry order, only on an explicit `resumeRecovery()`. Keep normal Save/Load and boot unchanged when no recovery candidate is supplied.

## Owner-resolved defaults

- Game startup program runs normally before ledger restoration. The listeners and services it creates remain live; candidate event listeners, queues and dispatch state are not restored.
- Item multitask threads are created/started only after explicit Resume.
- Ledger trigger progress and saved player placement survive board preparation; do not run the ordinary trigger reset, player placement or deactivation path.
- A missing or changed required board or entry-program asset refuses recovery without exposing partial state. The host keeps its previous validated checkpoint.

## Boundaries

- The prompt and Continue/decline decision are host-side. Core only accepts a recovery candidate when the host chooses Continue; a missing candidate follows ordinary boot. No storage, prompt, or checkpoint disposition policy is added.
- Keep the validated-candidate boundary explicit. Recovery candidates contain canonical save state and a versioned required-asset fingerprint manifest; hosts validate the manifest via `restoreRecoveryCandidate`. Older candidates without a manifest are refused because required-asset compatibility cannot be verified, while normal saves remain unchanged. Recovery projects/applies only `GameLedgerV1` progress and never resumes the candidate's ordinary VM continuation or transient event/input/UI/audio/engine state.
- Preserve game startup-created event registrations/services. Restore durable script graph and actor state without importing candidate listener, queue or dispatch state or invalidating live service wiring.
- Recovery board preparation is separate from ordinary `arrive`: restore flags and time before loading conditions and animated board assets; preserve durable board edits, triggers and sprite placement; do not start board threads, item threads or entry instructions during preparation.
- `resumeRecovery()` is one-shot and independent of `advance`, focus changes, `advance(0)` and debugger continuation. It starts ordinary board-entry threads/program in their usual order, then releases the recovery pause.
- Do not change ordinary boot, snapshot Save/Load continuation, serialization bytes, or host storage behavior when no candidate is supplied.

## Implementation map

- `docs/spec/engine/interruption-recovery.md`: state startup-first ordering, all four resolved defaults, host-owned prompt/Continue selection, recovery init input, failure/retention behavior and the engine/host seam.
- `packages/core/src/engine/engine.ts` and `packages/core/src/ports/engine.ts`: accept candidate bytes in init, restore through the canonical save validator and ledger projection, stage the board asynchronously, commit only after all required assets/entry sources are available, gate simulation and provide one-shot `resumeRecovery()`.
- `packages/core/src/save/ledger.ts` and save/world/sprite/triggers runtime modules: implement a narrow inverse ledger application and a recovery-only board/sprite/trigger install that preserves durable state while excluding VM continuation and transient host state.
- `packages/runner-harness/src/script-host.ts`, fixtures and engine test doubles: keep the public engine contract complete.
- `packages/core/test/engine-boot.test.ts` and focused save/engine tests: cover startup-before-recovery, paused/no-work until Resume, exactly-once entry, trigger/placement preservation, deferred item threads, no-candidate equivalence, missing/changed required assets with no partial state, and normal save/load unchanged.
- `CHANGELOG.md`: record the shipped recovery behavior.

## Acceptance

The normative #779 checks pass: host-side prompt and Continue select a paused recovery; startup has run before ledger restore; restored flags govern board loading and entry; no board/item thread or entry instruction runs before explicit Resume; recovery Resume starts entry exactly once in ordinary order; trigger progress and saved placement remain intact; decline/no candidate follows ordinary boot; missing/changed required board or entry assets expose no partial state and cannot replace the host's previous validated checkpoint; existing save/load continuation and ordinary boot are unchanged.

## Verification

Run the focused recovery/boot tests (including the engine boot and save-continuation suites) and then the repository verification gate from the isolated worktree after implementation is complete. The main agent owns verification after this implementation lands.

## Unresolved

None among the four owner-assigned runtime defaults. Host prompt presentation, validation, durable storage/promotion and checkpoint disposition on decline remain host responsibilities and are not implemented by this core change.
