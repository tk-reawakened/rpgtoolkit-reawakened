# Interruption recovery

**Owner-approved rule, partially implemented (#777).** The reference recovery store's promotion and selection are implemented in core (#783); #782 provides explicit checkpoints and the conservative pre-battle candidate API. Paused ledger-first re-entry (#779) remains. Interruption recovery is distinct from normal `Save`/`Load` and saveable VM snapshots; it does not weaken [G1](../../guardrails.md) or change existing mid-battle snapshot continuation. The approved contract and source evidence are in [the recovery decision](../../../_bmad-output/initiative-rpgtoolkit-reawakened/epic-menu-party-save/recovery-checkpoint-proposal.md). Ledger fields, identity, migrations and validation belong to #776.

## Stable checkpoint

A recovery checkpoint represents committed game progress, a board identity and an arrival location, not a serialized continuation of an in-progress scene or battle. A game explicitly marks a settled script point as safe with [`checkpoint()`](rpgcode-functions.md#program-flow-errors--debugging), or the engine may nominate the conservative coherent pre-commit state immediately before battle state changes. A tick boundary alone does not prove authored multi-tick logic is complete; the script author's declaration is not proof of correctness for arbitrary game code.

For an explicit checkpoint request, unknown eligibility means no capture. It requires a running boot, no open tick, no pending host request or blob operation, no deferred image effect or board preview, no board transition or video, no active battle, no menu screens, an active board and selected player, and no failed engine. The pre-battle callback is the sole open-tick exception: it may capture the current open tick immediately before battle commit while `battle === null`, provided every other eligibility condition holds. Do not advance gameplay or run callbacks between checking eligibility and serialization.

### Candidate API and capture timing

`Engine.recoveryCandidate()` returns `{ bytes: Uint8Array, tick: number }` or `null`. `bytes` is the normal canonical game-save serialization, not a recovery-specific ledger or continuation format. For an explicit request, `checkpoint()` only records the request; it does not wait, capture synchronously or advance gameplay. The engine serializes only when the runner asks for a candidate at an eligible settled point. For pre-battle capture, the engine serializes in the validated before-start callback at the coherent pre-commit point, even if the current open tick remains. A request is one-shot: that call consumes it whether it returns bytes or `null`; a serialization failure also returns `null` and clears the request. With no pending explicit request or queued pre-battle candidate, the API returns `null`.

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

Only when eligible validated interruption recovery is available, ask if the player would like to continue where they left off; suggested wording: “Would you like to continue where you left off?” Decline proceeds with normal launch without overwriting normal save slots; checkpoint disposition on decline is undecided. Continue validates and restores the ledger before board loading conditions and board preparation, then presents the recovered board paused. Setup failure must not expose partial state. No simulation tick, board thread or entry-program instruction runs before explicit Resume; focus gain and zero-tick advancement do not resume. On Resume start board threads and the entry program exactly once in ordinary entry order; a waiting entry program may accept normal input. Game flags guard one-time logic. Asset replies and non-simulation preparation may run while paused, without starting scripts or exposing a partial restore.

Implementation and tests are tracked by #778, #782, #783 and #779; #780 reconciles BAT-13 evidence and #753 remains the sole Epic 7 closure sweep. Existing behavior evidence is cited in the decision document; this rule is not a claim that these capabilities have shipped.
