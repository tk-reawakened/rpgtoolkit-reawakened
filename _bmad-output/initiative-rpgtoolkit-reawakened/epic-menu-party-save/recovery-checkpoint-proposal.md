# #777 — Interruption recovery checkpoint proposal

**Status: owner-approved contract, not yet implemented.** The owner approved all remaining recommendations following the prompt decision. Normative summary: [interruption recovery](../../../docs/spec/engine/interruption-recovery.md); evidence and prior direction: [recovery-direction.md](recovery-direction.md). Ledger contents and identity remain #776's contract. G1 and normal `Save`/`Load` remain unchanged.

## Approved contract

### 1. Capture only a coherent, explicitly acknowledged boundary

A recovery checkpoint represents committed game progress, a board identity and an arrival location, not a serialised continuation of an in-progress scene or battle. The exact ledger fields and identity/version checks belong to #776; this proposal does not invent them.

A checkpoint is **eligible only when all** of the following hold at one consistent observation point:

1. The engine has finished every phase of a simulation tick; no debugger `openTick` or half-applied phase is captured. The active board and player arrival position are known, and no board load, transition, boot/reset or game-over transition is in progress.
2. There is no active battle, menu/dialogue or other interaction whose continuation would be discarded by board re-entry; no unresolved game-owned transaction or event/effect whose partial outcome would be represented inconsistently in the ledger. Capture neither a mid-battle ledger nor an inferred encounter restart. A pre-battle checkpoint is useful only if it actually exists and has been validated.
3. No relevant host request is outstanding or ambiguously committed, including asset/board loads, blob reads/writes and external side effects. A successful response alone is not proof that an external effect can be rolled back. A pending operation must complete to a known committed state or fail without partial effects; if its outcome cannot be established within the available time, keep the previous checkpoint. Deferred image effects and board previews must not leave the captured owners inconsistent.
4. The game or a trusted game-owned checkpoint policy has explicitly identified this point as safe for re-entering the board and replaying its entry program. An engine cannot infer from a tick boundary that an authored multi-tick transaction is complete. An author/policy declaration is required but is not proof of correctness for arbitrary game code. Do not advance gameplay or run callbacks between eligibility and capture.
5. The checkpoint data passes the approved ledger's structural, version, identity and cross-owner consistency validation. The precise game identity, migration and integrity rules remain #776 decisions, not a new hash definition here.

These are conservative necessary conditions, not an assertion that current code already exposes a complete predicate. Implementation must identify owners and an observable way to establish each one; unknown or unavailable evidence means **not eligible**. Background board threads need not all terminate merely because they exist, but a policy cannot certify an unresolved multi-tick transaction. The declaration mechanism and concrete excluded operations require implementation design.

**Approved compatibility policy.** Without an author declaration or trusted policy establishing equivalent safety, no new checkpoint is eligible; this has a significant compatibility cost for unmodified legacy games. Design a trusted compatibility policy that may nominate settled pre-battle or reconstructible screen/board-entry boundaries, subject to all eligibility checks. Those labels alone do not prove safety; if it cannot be established, retain an earlier validated checkpoint. A pre-battle candidate does not imply mid-battle restart.

### 2. Interruption signal is best effort

Keep a previously promoted checkpoint during ordinary play. A runner receiving an applicable interruption/lifecycle signal requests a capture at the next eligible point, only while the host actually permits it; the request must not fabricate a signal, force gameplay forward through a cutscene, wait indefinitely for I/O, or claim success on a deadline. If no safe point or validated publication is reached, retain the previous generation. Sudden process loss, OS termination, and hosts that do not deliver or extend a lifecycle signal may prevent this attempt entirely. If no validated checkpoint exists, report recovery unavailable rather than invent one. The host's signal mapping, deadline and durable storage guarantees need platform-specific implementation and tests (#782/#783).

Maintain checkpoints opportunistically at safe points during normal play, including points established by an approved trusted compatibility policy, not only at shutdown. No fixed interval or zero-loss guarantee is promised.

### 3. Validate then promote without losing the previous generation

For each game/profile recovery slot, serialize the captured ledger into a new candidate distinct from the currently selected generation. Write it completely, read the stored bytes back, and validate the read-back candidate for the same identity, compatible version, completeness, integrity, cross-owner consistency and recoverability under the approved ledger contract. A write acknowledgement, parse alone, or successful validation of only the in-memory copy is insufficient. Do not mutate live game state to validate.

Only after successful read-back validation atomically promote a pointer to that candidate. Serialize or otherwise order competing promotions so an older attempt cannot silently replace a later successful one. Until the pointer switch commits, keep the previous validated candidate and pointer usable. A failed write/read/validation/promotion, crash or signal deadline leaves the old pointer selected; after a committed switch, restart selection must see the complete new candidate, never a partial pointer or unvalidated bytes. The host contract must specify atomicity and durability—including when the pointer and candidate become durable—for each supported storage backend; where it cannot provide the guarantee, do not advertise successful durable recovery. Retention/garbage collection occurs only after safe promotion and must not remove a generation still needed for fallback.

On startup, validate the selected generation again before use; never apply partial invalid state. Retain the current promoted generation and one preceding validated generation per game/profile, plus any separate candidate being written. On failed revalidation, offer the preceding generation only after validating it again; if neither qualifies, report recovery unavailable. Never overwrite a normal user save slot.

**Accepted owner decision — restart prompt:** “Ask if the player would like to continue where they left off.” Show the prompt only when eligible validated interruption recovery is available. Proposed display wording: “Would you like to continue where you left off?” Continue selects recovery and returns the player paused; a separate explicit Resume starts entry and gameplay. Decline proceeds with normal launch without overwriting normal save slots. Checkpoint disposition after decline remains undecided.

### 4. Restore ledger, reopen board, return paused

Recovery is a separate path from normal snapshot `Load`:

1. Validate the selected recovery generation and restore the approved game ledger, including flags, before evaluating board loading conditions or starting any entry script. On failure, keep the prior live game unchanged and present a recoverable error.
2. Resolve and load the saved board and dependencies using the restored ledger. Reconstruct the saved player location and other approved board-owned state, avoiding transient snapshot threads/events or a second copy of board threads. The board's usual entry lifecycle is prepared exactly once; flags supplied by the game guard its one-time logic. If setup fails, do not expose a half-restored game.
3. Present the recovered board **paused**. Asset replies and necessary non-simulation setup may complete while paused, but neither ordinary simulation ticks nor board threads/entry program instructions run before the player's explicit Resume. Focus gain, a host signal or a zero-tick `advance` must not by itself resume gameplay. Suppress stale held input so the resume action is not replayed as gameplay input.
4. On Resume, start the board threads and entry program exactly once using the approved board-entry ordering; then gameplay follows the ordinary scheduler. If the entry program displays dialogue or otherwise waits for player input, allow that interaction according to normal rules rather than requiring the program to finish without input. Neither duplicate one-time effects nor an assumption that all entry scripts are idempotent is acceptable; the game's persisted flags are its one-time guard.

The approved split between non-simulation board preparation and board-entry side effects is not implemented today. Loading the board for display must not itself start scripts or leak a partial restore. Paused recovery must not depend on focus or debugger pause semantics.

## Failure and acceptance examples

- Interrupt during an active fight, a partial quest operation, a menu, a board transition, an unresolved file/host write, a missing asset reply, or a breakpoint-open tick: no fresh eligible checkpoint is claimed. Recovery selects the most recent previously promoted compatible candidate if one exists; no ledger-derived battle restart is invented.
- At an explicitly safe, fully settled point, capture a committed inventory/flag/position update. An interruption between any pair of candidate write, read, validation and pointer switch yields either the old validated generation or the complete new validated generation, never partial or mixed data. Include failed writes, corrupted readback, changed game identity, invalid/migrated data and concurrent attempts.
- Re-entry test: a board's item-loading condition and enter program both observe restored flags; the one-time reward is not repeated. Assert entry starts once after explicit Resume, no tick or script runs while paused, and stale input/focus gain cannot resume it. Cover asynchronous board assets, setup failure, missing previous checkpoint and a board entry that waits for player input.
- Prompt test: only an eligible validated interruption recovery produces the offer; Continue selects paused recovery without silently resuming, and decline proceeds to normal launch without overwriting normal save slots. No deletion or retention result on decline is assumed.
- Regression: normal `Save`/`Load` keeps VM continuation and mid-battle snapshot behavior, including G1; recovery's re-entry path does not replace or weaken it. Existing mid-battle snapshot tests do not demonstrate that a ledger can reconstruct a battle.

## Existing evidence and implications

- Fixed phase order and breakpoint mid-tick behavior: `packages/core/src/engine/engine.ts:118-134,2266-2321,2324-2369`; `packages/core/test/engine.test.ts:321-334,752-763`. A complete tick is necessary but does not by itself show an authored multi-tick operation has committed.
- Existing save waits for in-flight assets, deferred image/preview effects and other blob operations before serializing; `packages/core/src/engine/engine.ts:1105-1121` and `packages/core/test/save-continuation.test.ts:53-127`. This is precedent, not an implementation of the proposed recovery predicate or proof of external transaction durability.
- Ordinary `Load` validates and reconstructs full state/services, and rolls back failed application: `packages/core/src/save/game-save.ts:15-18,62-73,109-123`; `packages/core/src/engine/engine.ts:730-770,1207-1234`. Normal restored startup skips board entry: `docs/spec/engine/main-loop-and-startup.md#reawakened-boot-sequence`; `packages/core/test/engine-boot.test.ts:396-404`. This proposal is a different workflow.
- Ordinary board arrival installs the board, resets triggers, places the player, posts music and events, and starts board threads and its entry program: `packages/core/src/engine/engine.ts:1565-1611`. Board item visibility may depend on variables: `packages/core/src/sprites/model.ts:279-302`. The ledger-before-board ordering is essential, but current `arrive` does not expose the proposed paused split.
- Focus loss gates ticks; focus gain permits them again, and `paused` reports breakpoint state: `packages/core/src/engine/engine.ts:2144-2171,2324-2369`; `packages/core/src/ports/engine.ts:28-42,54-70`. Blob request/reply ports have no atomic promotion contract: `packages/core/src/ports/requests.ts:14-43`; `packages/core/src/ports/input.ts:56-68`.
- Existing fresh-engine mid-battle full-snapshot continuation is tested, not ledger restart: `packages/core/test/battle-fresh-load.test.ts:234-291`; current battle save rule is `docs/spec/engine/battle.md#bat-13`. [Guardrails G1–G3](../../../docs/guardrails.md) remain binding.

## Implementation handoff

The owner approved the remaining recommendations: “yes sorry all the others are perfect as written.” The approved ledger contents, migration/identity and validation belong to #776; implementation and host-specific proof belong to #778/#782/#783/#779. No implementation ticket is closed by this ruling. #780 reconciles BAT-13 evidence with #753's sole closure sweep. Checkpoint disposition after decline remains undecided.
