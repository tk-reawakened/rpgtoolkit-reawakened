---
title: "Capture stable interruption checkpoints on host signals"
type: 'feature'
ticket: 18
status: done
created: '2026-10-29'
risk: "high"
context:
  - "normative - docs/spec/engine/interruption-recovery.md#stable-checkpoint"
  - "normative - docs/spec/engine/rpgcode-functions.md#program-flow-errors--debugging"
  - "contract - _bmad-output/initiative-rpgtoolkit-reawakened/epic-menu-party-save/recovery-checkpoint-proposal.md"
  - "ledger - docs/spec/formats/save-game.md#game-ledger-and-savable-continuation"
  - "owner interface - packages/core/src/save/recovery-store.ts"
---

## Intent

Expose canonical game-save bytes only at a settled, explicitly requested recovery point, and capture the conservative coherent pre-commit state immediately before battle state changes. The engine provides the host a one-shot `{ bytes, tick }` candidate; it performs no storage, recovery-ledger validation, publication or board re-entry. A rejected or unavailable capture returns `null`, allowing the host to retain its last validated checkpoint. Normal Save/Load and full mid-battle snapshots remain unchanged.

## Contract and boundaries

- Add a no-argument, non-waiting `checkpoint()` RPGCode command. Its callback requests capture; it does not serialize synchronously, advance a tick, wait for host I/O, or certify arbitrary game logic. A candidate is available only once the engine next observes a fully settled eligible state.
- Expose `Engine.recoveryCandidate(): { bytes: Uint8Array; tick: number } | null`. A requested candidate is consumed on return, including when capture serialization fails; an ineligible request falls back to a queued pre-battle candidate once, but an eligible explicit capture supersedes and discards an older queued pre-battle candidate. An unavailable capture returns `null` and does not replace host storage or a prior validated checkpoint.
- For explicit checkpoints, eligibility is conservative and evaluated against one state generation: boot is running, no tick is open, no pending host request/blob/image effect/board preview, no board transition or video, no active battle, no menu screens, a board and selected player are present, and the engine has not failed. The pre-battle callback may run during the current open tick, but only when every other eligibility condition holds and `battle === null`. A checkpoint request is mandatory for ordinary capture.
- The battle owner receives an optional before-start callback. It runs after battle-start validation and before any battle-state mutation. Because script-issued starts run inside a tick, the engine may capture the coherent pre-commit state while that tick remains open, provided every other eligibility condition holds with `battle === null`; the candidate remains available after battle starts and is returned once. Rejected starts and invalid eligibility must not change battle behavior or leak an unsafe candidate.
- Document `checkpoint()` in the RPGCode command catalogue with plain-language behavior first, then deterministic behavior (no arguments, no wait, marks the current settled point as safe for interruption recovery). Document candidate eligibility, one-shot consumption, pre-battle ordering, canonical save bytes and host retention in the normative interruption-recovery page.
- Keep the existing `snapshotGameSave` serialization as the candidate format. Do not add candidate validation, ledger logic, host storage, signal listeners or recovery/re-entry logic. Do not modify ordinary save bytes, snapshot continuation or existing golden files.

## Implementation map

- `docs/spec/engine/rpgcode-functions.md`: add the `checkpoint()` command row and its simple-first deterministic description.
- `docs/spec/engine/interruption-recovery.md`: specify the explicit script request, candidate API, engine eligibility exclusions, one-shot consumption, failure behavior, and pre-battle capture point. Clarify that the host keeps its previous validated checkpoint unless it validates and promotes a returned candidate.
- `packages/core/src/script/`: add the optional capture callback to `ScriptServices`/`CommandView` and bind the `checkpoint` builtin without changing existing callers or making it wait.
- `packages/core/src/battle/` and `packages/core/src/engine/engine.ts`: add/wire the optional pre-start callback; expose `Engine.recoveryCandidate()` and share one conservative eligibility/capture path between explicit requests and pre-battle capture.
- `packages/core/test/`: add focused engine/builtin/battle tests for eligible checkpoint bytes restoring to the same ledger hash; unsafe battle, menu, pending request/effect, transition/video and failed/open-tick states; request consumption and serialization failure; pre-battle callback ordering and one-shot delivery after battle start. Keep existing normal-save and golden fixtures byte-for-byte unchanged.

## Acceptance

The requested and pre-battle paths return only canonical save candidates from a complete, eligible state and return each candidate once. Unsafe capture returns `null`, so a host can retain its previous validated checkpoint. Tests prove ledger-hash-equivalent restore for a safe checkpoint, reject every named unsafe state, prove callback ordering before battle mutation and candidate availability after battle begins, and preserve ordinary save and golden behavior. The command and API are specified before implementation.

## Verification

Merged PR #803 as `d995404ed57e8be754628df7a665d0c343f0678e`. Focused engine-boot tests passed 42/42; the full strict suite passed 2374 tests with no skips, and all repository checks passed. Independent reviews found and fixed the open-tick pre-battle gap and stale pre-battle priority.

## Unresolved

- Host interruption-signal wiring, durable storage and validated atomic promotion remain host/#783 responsibilities; this engine API only returns a candidate. Ledger validation and paused recovery re-entry remain #776/#779 responsibilities.
- The explicit command identifies a point as safe by author assertion; eligibility guards engine-observable hazards but cannot prove an authored multi-tick transaction is semantically complete.
