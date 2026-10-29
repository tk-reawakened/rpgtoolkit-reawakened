# #777 — Interruption recovery checkpoint proposal

**Status: proposal for owner review, not an approved rule or implemented behavior.** Owner direction and evidence are in [recovery-direction.md](recovery-direction.md). The separate #776 ledger audit defines neither this proposal nor its acceptance; coordinate with its eventual approved ledger/identity/validation contract. This document changes no normative spec, G1, normal `Save`/`Load`, or existing VM snapshot guarantee.

## Recommended contract — pending owner ruling

### 1. Capture only a coherent, explicitly acknowledged boundary

A recovery checkpoint represents committed game progress, a board identity and an arrival location, not a serialised continuation of an in-progress scene or battle. The exact ledger fields and identity/version checks belong to #776; this proposal does not invent them.

Recommend that a checkpoint is **eligible only when all** of the following hold at one consistent observation point:

1. The engine has finished every phase of a simulation tick; no debugger `openTick` or half-applied phase is captured. The active board and player arrival position are known, and no board load, transition, boot/reset or game-over transition is in progress.
2. There is no active battle, menu/dialogue or other interaction whose continuation would be discarded by board re-entry; no unresolved game-owned transaction or event/effect whose partial outcome would be represented inconsistently in the ledger. Capture neither a mid-battle ledger nor an inferred encounter restart. A pre-battle checkpoint is useful only if it actually exists and has been validated.
3. No relevant host request is outstanding or ambiguously committed, including asset/board loads, blob reads/writes and external side effects. A successful response alone is not proof that an external effect can be rolled back. A pending operation must complete to a known committed state or fail without partial effects; if its outcome cannot be established within the available time, keep the previous checkpoint. Deferred image effects and board previews must not leave the captured owners inconsistent.
4. The game or a trusted game-owned checkpoint policy has explicitly identified this point as safe for re-entering the board and replaying its entry program. An engine can check its own queues and phases, but cannot infer from a tick boundary that a multi-tick authored quest transaction is complete or that a non-blocking board script will not mutate a flag next tick. An explicit author/policy declaration is therefore recommended; it is not proof of correctness for arbitrary game code. Do not advance gameplay or run callbacks between the eligibility decision and the ledger capture.
5. The checkpoint data passes the approved ledger's structural, version, identity and cross-owner consistency validation. The precise game identity, migration and integrity rules remain #776 decisions, not a new hash definition here.

These are conservative necessary conditions, not an assertion that current code already exposes a complete predicate. The implementation must identify owners and an observable way to establish each one; unknown or unavailable evidence means **not eligible**, never a guessed success. Background board threads need not all terminate merely because they exist, but a policy cannot certify a point if their ongoing work leaves a multi-tick game transaction unresolved. The author-facing declaration mechanism, default policy for games that do not declare a point, and exact set of excluded interactions require the owner's decision below.

### 2. Interruption signal is best effort

Keep a previously promoted checkpoint during ordinary play. A runner receiving an applicable interruption/lifecycle signal requests a capture at the next eligible point, only while the host actually permits it; the request must not fabricate a signal, force gameplay forward through a cutscene, wait indefinitely for I/O, or claim success on a deadline. If no safe point or validated publication is reached, retain the previous generation. Sudden process loss, OS termination, and hosts that do not deliver or extend a lifecycle signal may prevent this attempt entirely. If no validated checkpoint exists, report recovery unavailable rather than invent one. The host's signal mapping, deadline and durable storage guarantees need platform-specific implementation and tests (#782/#783).

Recommendation: maintain checkpoints opportunistically at declared safe points during normal play, not only when a shutdown callback occurs. The frequency/retention policy is an owner choice; this is not a promise of zero lost progress or a fixed interval.

### 3. Validate then promote without losing the previous generation

For each game/profile recovery slot, serialize the captured ledger into a new candidate distinct from the currently selected generation. Write it completely, read the stored bytes back, and validate the read-back candidate for the same identity, compatible version, completeness, integrity, cross-owner consistency and recoverability under the approved ledger contract. A write acknowledgement, parse alone, or successful validation of only the in-memory copy is insufficient. Do not mutate live game state to validate.

Only after successful read-back validation atomically promote a pointer to that candidate. Serialize or otherwise order competing promotions so an older attempt cannot silently replace a later successful one. Until the pointer switch commits, keep the previous validated candidate and pointer usable. A failed write/read/validation/promotion, crash or signal deadline leaves the old pointer selected; after a committed switch, restart selection must see the complete new candidate, never a partial pointer or unvalidated bytes. The host contract must specify atomicity and durability—including when the pointer and candidate become durable—for each supported storage backend; where it cannot provide the guarantee, do not advertise successful durable recovery. Retention/garbage collection occurs only after safe promotion and must not remove a generation still needed for fallback.

On startup, read the selected generation and validate again before use; if it is invalid or incompatible, do not apply partial state. Preserve any separately retained earlier validated candidate and offer it only after revalidation; if none qualifies, report recovery unavailable. Do not automatically overwrite a normal user save slot. Exact retention count and user-facing diagnostics are owner choices.

### 4. Restore ledger, reopen board, return paused

Recommendation: recovery is a separate path from normal snapshot `Load`:

1. Validate the selected recovery generation and restore the approved game ledger, including flags, before evaluating board loading conditions or starting any entry script. On failure, keep the prior live game unchanged and present a recoverable error.
2. Resolve and load the saved board and dependencies using the restored ledger. Reconstruct the saved player location and other approved board-owned state, avoiding transient snapshot threads/events or a second copy of board threads. The board's usual entry lifecycle is prepared exactly once; flags supplied by the game guard its one-time logic. If setup fails, do not expose a half-restored game.
3. Present the recovered board **paused**. Asset replies and necessary non-simulation setup may complete while paused, but neither ordinary simulation ticks nor board threads/entry program instructions run before the player's explicit Resume. Focus gain, a host signal or a zero-tick `advance` must not by itself resume gameplay. Suppress stale held input so the resume action is not replayed as gameplay input.
4. On Resume, start the board threads and entry program exactly once using the approved board-entry ordering; then gameplay follows the ordinary scheduler. If the entry program displays dialogue or otherwise waits for player input, allow that interaction according to normal rules rather than requiring the program to finish without input. Neither duplicate one-time effects nor an assumption that all entry scripts are idempotent is acceptable; the game's persisted flags are its one-time guard.

The precise split between non-simulation board preparation and board-entry side effects is not implemented today and needs owner approval. In particular, loading the board for display must not itself start scripts or leak a partial restore. Paused recovery must not depend on window focus or debugger pause semantics.

## Failure and acceptance examples

- Interrupt during an active fight, a partial quest operation, a menu, a board transition, an unresolved file/host write, a missing asset reply, or a breakpoint-open tick: no fresh eligible checkpoint is claimed. Recovery selects the most recent previously promoted compatible candidate if one exists; no ledger-derived battle restart is invented.
- At an explicitly safe, fully settled point, capture a committed inventory/flag/position update. An interruption between any pair of candidate write, read, validation and pointer switch yields either the old validated generation or the complete new validated generation, never partial or mixed data. Include failed writes, corrupted readback, changed game identity, invalid/migrated data and concurrent attempts.
- Re-entry test: a board's item-loading condition and enter program both observe restored flags; the one-time reward is not repeated. Assert entry starts once after explicit Resume, no tick or script runs while paused, and stale input/focus gain cannot resume it. Cover asynchronous board assets, setup failure, missing previous checkpoint and a board entry that waits for player input.
- Regression: normal `Save`/`Load` keeps VM continuation and mid-battle snapshot behavior, including G1; recovery's re-entry path does not replace or weaken it. Existing mid-battle snapshot tests do not demonstrate that a ledger can reconstruct a battle.

## Existing evidence and implications

- Fixed phase order and breakpoint mid-tick behavior: `packages/core/src/engine/engine.ts:118-134,2266-2321,2324-2369`; `packages/core/test/engine.test.ts:321-334,752-763`. A complete tick is necessary but does not by itself show an authored multi-tick operation has committed.
- Existing save waits for in-flight assets, deferred image/preview effects and other blob operations before serializing; `packages/core/src/engine/engine.ts:1105-1121` and `packages/core/test/save-continuation.test.ts:53-127`. This is precedent, not an implementation of the proposed recovery predicate or proof of external transaction durability.
- Ordinary `Load` validates and reconstructs full state/services, and rolls back failed application: `packages/core/src/save/game-save.ts:15-18,62-73,109-123`; `packages/core/src/engine/engine.ts:730-770,1207-1234`. Normal restored startup skips board entry: `docs/spec/engine/main-loop-and-startup.md#reawakened-boot-sequence`; `packages/core/test/engine-boot.test.ts:396-404`. This proposal is a different workflow.
- Ordinary board arrival installs the board, resets triggers, places the player, posts music and events, and starts board threads and its entry program: `packages/core/src/engine/engine.ts:1565-1611`. Board item visibility may depend on variables: `packages/core/src/sprites/model.ts:279-302`. The ledger-before-board ordering is essential, but current `arrive` does not expose the proposed paused split.
- Focus loss gates ticks; focus gain permits them again, and `paused` reports breakpoint state: `packages/core/src/engine/engine.ts:2144-2171,2324-2369`; `packages/core/src/ports/engine.ts:28-42,54-70`. Blob request/reply ports have no atomic promotion contract: `packages/core/src/ports/requests.ts:14-43`; `packages/core/src/ports/input.ts:56-68`.
- Existing fresh-engine mid-battle full-snapshot continuation is tested, not ledger restart: `packages/core/test/battle-fresh-load.test.ts:234-291`; current battle save rule is `docs/spec/engine/battle.md#bat-13`. [Guardrails G1–G3](../../../docs/guardrails.md) remain binding.

## Smallest owner decisions

1. **Boundary policy:** approve the conservative conjunction above, including explicit game/policy acknowledgement; choose what an unmodified game with no declaration does (recommended: no new recovery checkpoint unless a documented trusted default can establish equivalent safety). Which interactions and external operations must block capture remain explicitly enumerated during implementation, not silently assumed.
2. **Pause and entry:** approve preparing the board paused and running its entry program only after explicit Resume, with no simulation before then; alternatively choose entry execution during recovery setup and define how waiting for player input behaves while paused.
3. **Availability and retention:** approve opportunistic capture at safe points plus best-effort signal capture, no fixed schedule; choose minimum fallback retention and whether recovery should be offered automatically or explicitly. Per-host guarantees and unsupported-host reporting are required either way.

The approved ledger contents, migration/identity and validation belong to #776; implementation and host-specific proof belong to #778/#782/#783/#779. Approval of this proposal alone does not close those tickets or amend BAT-13; #780 handles the eventual evidence reconciliation with #753's sole closure sweep.
