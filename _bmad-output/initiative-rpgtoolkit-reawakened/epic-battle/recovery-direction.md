# Interruption recovery: owner direction and evidence

Owner direction, 2026-10-29; planning, not implemented behavior. This supplements the ledger audit in #776 and does not settle its data or hash contract.

## Direction

- Recover from coherent, stable checkpoints. On a host interruption signal, try to capture one if conditions and time allow. A signal is best effort: abrupt termination may not permit capture. Retain the last validated checkpoint if a new one cannot be captured safely.
- Do not overwrite the previous validated save during an attempt. Write a separate candidate, read it back and validate it, then atomically switch the recovery pointer. The previous validated generation remains available until promotion succeeds. Specify host-specific atomicity and failure behavior before implementation.
- Reload the validated game ledger before reopening the recorded board and running its entry program. Game flags are responsible for avoiding repeated one-time game logic. Resume recovery paused until an explicit player action.
- Do not assume a mid-battle ledger can restart an encounter. Stable checkpoint eligibility and behavior while battle or other operations are in progress are still to be ruled; unsafe capture falls back to the previous validated checkpoint. This is not a ruling that a pre-battle checkpoint is always available or sufficient.
- Normal save/load and G1's saveable VM state, including existing mid-battle snapshots, remain in place. Interruption recovery is a distinct workflow, not an override of normal continuation.

## Current behavior, not recovery promises

- Script saves serialize game/VM state only after outstanding asset requests, deferred image effects and other blob requests have cleared; the save thread's response is inserted into the serialized copy (`packages/core/src/engine/engine.ts:1105-1121`; `packages/core/test/save-continuation.test.ts:53-127`). This gate alone does not define a coherent recovery checkpoint.
- `Load` validates and restores state, reconstructs services and compiles saved programs, rolling back on failure (`packages/core/src/engine/engine.ts:730-770,1207-1234`). The restored startup branch skips initial board entry (`docs/spec/engine/main-loop-and-startup.md#reawakened-boot-sequence`; `packages/core/test/engine-boot.test.ts:396-404`). Ordinary board arrival resets triggers, places the player, posts music, and starts board threads and enter program (`packages/core/src/engine/engine.ts:1565-1611`). Recovery re-entry therefore requires its own ordering, not a claim about current Load.
- Window focus gates ticks but focus gain resumes; the reported pause is a debugger breakpoint, not a player recovery pause (`packages/core/src/engine/engine.ts:2144-2171,2324-2369`; `packages/core/src/ports/engine.ts:28-42,54-70`). The host blob API has a write acknowledgment but no specified validated candidate/pointer promotion transaction (`packages/core/src/ports/requests.ts:14-43`; `packages/core/src/ports/input.ts:56-68`).
- Full mid-battle snapshot continuation already has tests (`packages/core/test/battle-fresh-load.test.ts:234-291`); BAT-13's current statement and pending comparison clarification are at `docs/spec/engine/battle.md#bat-13`. Neither establishes ledger-only battle restart.

## Work and unresolved boundaries

#777 owns a checkpoint/recovery contract and unresolved owner decisions: exact safe boundaries, scheduling, transaction and pending-request treatment, recovery failure, and precise pause/entry sequencing. #782 owns host signal and safe capture; #783 owns candidate validation and atomic promotion; #779 owns ledger-first board re-entry and explicit paused recovery. #776/#778 own ledger audit and gaps. #780 reconciles BAT-13 only after the relevant work, citing actual evidence; #753 remains the sole Epic 7 review-evidence sweep and closure record. Neither ticket closes #503 or rewrites historical status on assumption. No unspecified checkpoint details in this note are an approved ruling.
