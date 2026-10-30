# Interruption recovery

**Owner-approved rule, partially implemented (#777, #782, #783; #779 implementation in progress).** The reference recovery store's promotion and selection are implemented in core (#783); #782 provides explicit checkpoints and the conservative pre-battle candidate API. Ledger-first paused re-entry is specified here and implemented in this branch. Interruption recovery is distinct from normal `Save`/`Load` and saveable VM snapshots; it does not weaken [G1](../../guardrails.md) or change existing mid-battle snapshot continuation. The approved contract and source evidence are in [the recovery decision](../../../_bmad-output/initiative-rpgtoolkit-reawakened/epic-menu-party-save/recovery-checkpoint-proposal.md). Ledger fields, identity, migrations and validation belong to #776.

<a id="stable-checkpoint"></a>
## Stable checkpoint

A recovery checkpoint represents committed game progress, a board identity and an arrival location, not a serialized continuation of an in-progress scene or battle. A game explicitly marks a settled script point as safe with [`checkpoint()`](rpgcode-functions.md#program-flow-errors--debugging), or the engine may nominate the conservative coherent pre-commit state immediately before battle state changes. A tick boundary alone does not prove authored multi-tick logic is complete; the script author's declaration is not proof of correctness for arbitrary game code.

For an explicit checkpoint request, unknown eligibility means no capture. It requires a running boot, no open tick, no pending host request or blob operation, no deferred image effect or board preview, no board transition or video, no active battle, no menu screens, an active board and selected player, and no failed engine. The pre-battle callback is the sole open-tick exception: it may capture the current open tick immediately before battle commit while `battle === null`, provided every other eligibility condition holds. Do not advance gameplay or run callbacks between checking eligibility and serialization.

### Candidate API and capture timing

`Engine.recoveryCandidate()` returns `{ bytes: Uint8Array, tick: number }` or `null`. The bytes are canonical JSON containing the normal game-save state and audio projection plus a versioned `recoveryAssets` manifest of required board, dependency and program fingerprints. Normal save slots and `snapshotGameSave` bytes are unchanged. Hosts validate candidates with `restoreRecoveryCandidate` as well as their identity, integrity and ledger checks; `restoreGameSave` alone does not validate the recovery manifest. Older candidates captured without a manifest cannot establish that required assets are unchanged and must be refused for recovery rather than silently upgraded; the host retains its prior stored generation until a new candidate is validated and promoted. Fingerprints detect asset changes but are not cryptographic authentication.

For an explicit request, `checkpoint()` only records the request; it does not wait, capture synchronously or advance gameplay. The engine serializes only when the runner asks for a candidate at an eligible settled point. For pre-battle capture, the engine serializes in the validated before-start callback at the coherent pre-commit point, even if the current open tick remains. A request is one-shot: that call consumes it whether it returns bytes or `null`; a serialization failure also returns `null` and clears the request. With no pending explicit request or queued pre-battle candidate, the API returns `null`.
When an explicit request and a pre-battle candidate are both pending, an eligible explicit capture supersedes and discards the older candidate. If the explicit request is ineligible, the queued pre-battle candidate is returned once instead.

The battle owner may invoke an optional before-start callback only after validating the battle start and immediately before changing battle state. The engine applies all eligibility checks except the no-open-tick rule, with `battle === null`; the callback may capture the coherent pre-commit ledger while a script-issued battle still has its current tick open. It serializes then and holds the candidate across battle start so the runner can retrieve it once after the battle has begun. This is a checkpoint of the pre-battle state, not a promise or mechanism to restart a battle from its ledger. A rejected start does not invoke the callback.

The core neither validates candidate identity, version, integrity or ledger consistency nor writes host storage. On `null`, serialization failure, validator refusal or publication failure, the host keeps its previous validated checkpoint. It validates and promotes returned bytes according to its storage guarantees; an unsafe or unavailable candidate never replaces that checkpoint.

## Capture and publication

The engine returns candidates only for explicit script requests and the conservative pre-battle policy above. A host may call `recoveryCandidate()` on an applicable interruption/lifecycle signal while time and platform permit; the call is best effort and cannot force gameplay forward, wait indefinitely for I/O or promise success after abrupt termination. No fixed capture interval or zero-loss guarantee is promised.

The host validates the candidate bytes before publication, reads stored bytes back and revalidates identity, version, integrity, completeness and ledger consistency before atomically switching the durable recovery pointer. Serialize competing promotions. Keep the previous validated generation usable until promotion completes. Retain the current and one previous validated generation per game/profile; candidates in progress are separate. Revalidate before recovery and use an earlier generation only if it also validates. Hosts must define their atomicity and durability guarantees; unsupported guarantees must not be advertised. Normal save slots are not overwritten.

## Reference recovery store layout

The layout below is the reference used by core's `save/recovery-store` promotion and selection functions. **It is optional for hosts**: a host may store candidates any way it likes provided it offers the same observable guarantees — complete game-scoped generations, read-back validation before an atomic pointer switch, and the current plus one previous validated generation retained. A host that cannot make the pointer switch atomic and durable must not advertise durable interruption recovery.

Paths are `gameId`-relative below the game's durable save area and use `/` separators. The `gameId` is one path segment: it cannot be empty, cannot contain `/`, `\` or NUL, and cannot be `.` or `..`.

| Path | Contents |
|---|---|
| `<gameId>/recovery/current.json` | The durable pointer, replaced only by an atomic write. |
| `<gameId>/recovery/generations/<generation>/candidate.bin` | The candidate bytes exactly as captured. |
| `<gameId>/recovery/generations/<generation>/meta.json` | The read-back validation result for that generation. |

A **generation** is a positive integer written as twelve zero-padded decimal digits, so lexical path order is numeric order. Promotion uses the highest existing generation plus one and never reuses a generation. The pointer is canonical JSON with exactly the keys `version`, `gameId`, `generation`, `tick` and `ledgerHash`: `version` is the pointer version, `generation` names the selected generation, and `tick` and `ledgerHash` are the validated candidate's tick and ledger hash. `meta.json` is canonical JSON with exactly the keys `version`, `generation`, `tick` and `ledgerHash`; it records completeness and equality for that generation and never substitutes for revalidating the candidate bytes.

### Promotion

1. Validate the captured candidate bytes first. A refused candidate writes nothing and leaves the pointer untouched.
2. Write the new generation's `candidate.bin`, read those bytes back and validate the read-back; its tick and ledger hash must equal the first validation exactly.
3. Write `meta.json`, read it back and confirm it records the validated generation, then replace `current.json` with an atomic write.
4. Read the pointer back and require it to name the new generation with exactly the validated tick and ledger hash. A pointer read-back failure restores the previous pointer when it was readable and reports promotion failure. The previous validated generation stays usable until this step succeeds.
5. Best-effort prune older generations, retaining the promoted generation and the newest older generation that revalidates. If no older generation validates, the newest remaining generation is kept so a transient read or validation failure does not delete the only fallback. A host without removal keeps the extra generations; selection still validates whichever it reads.

Promotion is synchronous and creates no cross-process lock, so a host serializes competing promotions as the contract requires. Candidate and pointer bytes are opaque to the store: identity, version, integrity, completeness and ledger consistency are the injected validator's responsibility.

### Selection

Selection reads and shape-checks the pointer, then reads the pointed generation's candidate and metadata, revalidates the bytes and requires its tick and ledger hash to match both the pointer and the metadata. A missing or corrupt pointer, a missing or malformed candidate or metadata, a mismatched result or a validator refusal is never returned. In that case selection scans generation directories newest first, fully revalidates each candidate, returns the newest valid one and atomically repairs the pointer best-effort; a failed repair does not make the already-validated candidate invalid. If no generation validates, recovery is unavailable and selection returns nothing. Selected bytes are always the bytes that just passed validation.

A host read that throws is **unreadable**, not corrupt: selection may still return an older validated generation, but it does not repair or demote the pointer when the pointer read threw, when the pointed generation was unreadable, or when any generation newer than the selected one was unreadable. Only an absent or corrupt pointer, candidate or metadata, or a content mismatch, may be repaired to a selected generation.

## Recovery and pause

The prompt and the choice are host-side. Only when a validated candidate is available, the host asks “Would you like to continue where you left off?” Decline uses ordinary boot and does not overwrite normal save slots; checkpoint disposition on decline is undecided. Continue creates a recovery launch by passing the selected validated candidate's `bytes` as `BootInit.recoveryCandidate`. With no recovery candidate, boot and saved-game loading retain their existing behavior.

Recovery boot runs the ordinary main-file and asset setup, package/service construction, `initChar`, game-wide `startupPrg` to completion, and player-presence check first. Startup-created listeners and services remain installed. After the player check, recovery takes precedence over the ordinary `SavedGamePort.restored()`/`initBoard` branch: the engine restores the candidate's durable ledger, including flags/globals, script graph, party, actors, inventory, board progress, sprites, trigger progress, RNG and time, without restoring candidate listeners, event queues or dispatch state, VM continuation, or other transient state. Restored flags are in place before board loading conditions, board dependencies and item visibility are evaluated.

The engine then loads the ledger's board and required dependencies, verifies that the required board and entry-program assets remain compatible with the candidate, and prepares the recovered board without calling ordinary `arrive`. Preparation overlays durable board and sprite state, keeps the saved player placement and trigger progress, and creates no board or item multitask threads. A missing or changed required board or entry-program asset, or any other setup failure, refuses recovery without exposing partial state; the host keeps its previous validated checkpoint. The candidate is not a continuation snapshot for recovery, and its event/listener/queue state is never installed.

After preparation, the engine exposes the board for drawing and reports host requests, diagnostics and loading through the ordinary engine API, but keeps simulation paused. No simulation tick, board-thread instruction, item-thread instruction or entry-program instruction runs before explicit Resume. Focus gain, debugger continuation and `advance(0)` do not resume. The host observes launch state through `Engine.recoveryStatus()`: `none` when no candidate was supplied, `loading` during recovery preparation, `paused` when the recovered board is ready, `resumed` after explicit Resume, and `failed` when setup is refused. The host calls the one-shot `Engine.resumeRecovery()` when the player explicitly chooses Resume; it starts board threads and the entry program exactly once in ordinary board-entry order, starts item multitask threads only then, and releases the pause. A waiting entry program accepts ordinary input after Resume. The host owns the prompt, Continue/decline decision, candidate validation and retention; it can observe preparation and failure through normal `advance()` loading/diagnostic results. Normal `Save`/`Load` and full snapshot continuation are unchanged.

The #779 core implementation and focused tests are included in this branch; the host still owns prompt presentation, candidate validation, durable storage/promotion and checkpoint disposition on decline. #780 reconciles BAT-13 evidence and #753 remains the sole Epic 7 closure sweep. Existing behavior evidence is cited in the decision document.
