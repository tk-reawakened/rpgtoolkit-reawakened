# Interruption recovery

**Owner-approved rule, not yet implemented** (#777). Interruption recovery is distinct from normal `Save`/`Load` and saveable VM snapshots; it does not weaken [G1](../../guardrails.md) or change existing mid-battle snapshot continuation. The approved contract and source evidence are in [the recovery decision](../../../_bmad-output/initiative-rpgtoolkit-reawakened/epic-menu-party-save/recovery-checkpoint-proposal.md). Ledger fields, identity, migrations and validation belong to #776.

## Stable checkpoint

Capture only after a full simulation tick at a consistent point with an active board and known player position: no open debugger tick, board transition, boot/reset/game-over transition, active battle, menu/dialogue or other discarded interaction, unresolved transaction/effect or relevant outstanding or ambiguously committed host request. A game or trusted policy must explicitly identify the point as safe for board re-entry; a tick boundary alone does not prove authored multi-tick logic complete. Unknown eligibility means no capture. Do not advance gameplay between eligibility and ledger capture.

Without a declaration or trusted policy establishing equivalent safety, do not create a new checkpoint. This may leave legacy games without recovery. Implement a trusted legacy compatibility policy that can nominate settled pre-battle and reconstructible screen/board-entry points only when all safety conditions are established; these labels alone are not proof. No mid-battle ledger-based battle restart is assumed.

## Capture and publication

Capture opportunistically at eligible points during play, and try on host interruption signals while time and platform permit; never force gameplay forward or promise success after abrupt termination. If capture or publication fails, preserve the last validated checkpoint; if none exists, recovery is unavailable.

Write a separate candidate, read the stored bytes back and validate identity, version, integrity, completeness and ledger consistency before atomically switching the durable recovery pointer. Serialize competing promotions. Keep the previous validated generation usable until promotion completes. Retain the current and one previous validated generation per game/profile; candidates in progress are separate. Revalidate before recovery and use an earlier generation only if it also validates. Hosts must define their atomicity and durability guarantees; unsupported guarantees must not be advertised. Normal save slots are not overwritten.

## Reference recovery store layout

The layout below is the reference used by core's `save/recovery-store` promotion and selection functions. **It is optional for hosts**: a host may store candidates any way it likes provided it offers the same observable guarantees — complete game-scoped generations, read-back validation before an atomic pointer switch, and the current plus one previous validated generation retained. A host that cannot make the pointer switch atomic and durable must not advertise durable interruption recovery.

Paths are `gameId`-relative below the game's durable save area and use `/` separators. The `gameId` is one path segment and cannot be empty or contain `/`, `\`, NUL, `.` or `..`.

| Path | Contents |
|---|---|
| `<gameId>/recovery/current.json` | The durable pointer, replaced only by an atomic write. |
| `<gameId>/recovery/generations/<generation>/candidate.bin` | The candidate bytes exactly as captured. |
| `<gameId>/recovery/generations/<generation>/meta.json` | The read-back validation result for that generation. |

A **generation** is a positive integer written as twelve zero-padded decimal digits, so lexical path order is numeric order. Promotion uses the highest existing generation plus one and never reuses a generation. The pointer is canonical JSON with exactly the keys `version`, `gameId`, `generation`, `tick` and `ledgerHash`: `version` is the pointer version, `generation` names the selected generation, and `tick` and `ledgerHash` are the validated candidate's tick and ledger hash. `meta.json` is canonical JSON with exactly the keys `version`, `generation`, `tick` and `ledgerHash`; it records completeness and equality for that generation and never substitutes for revalidating the candidate bytes.

### Promotion

1. Validate the captured candidate bytes first. A refused candidate writes nothing and leaves the pointer untouched.
2. Write the new generation's `candidate.bin`, read those bytes back and validate the read-back; its tick and ledger hash must equal the first validation exactly.
3. Write `meta.json`, then replace `current.json` with an atomic write.
4. Read the pointer back and require it to name the new generation with exactly the validated tick and ledger hash. A pointer read-back failure restores the previous pointer when it was readable and reports promotion failure. The previous validated generation stays usable until this step succeeds.
5. Best-effort prune older generations, retaining the promoted generation and one preceding validated generation. A host without removal keeps the extra generations; selection still validates whichever it reads.

Promotion is synchronous and creates no cross-process lock, so a host serializes competing promotions as the contract requires. Candidate and pointer bytes are opaque to the store: identity, version, integrity, completeness and ledger consistency are the injected validator's responsibility.

### Selection

Selection reads and shape-checks the pointer, then reads the pointed generation's candidate and metadata, revalidates the bytes and requires its tick and ledger hash to match both the pointer and the metadata. A missing or corrupt pointer, a missing or malformed candidate or metadata, a mismatched result or a validator refusal is never returned. In that case selection scans generation directories newest first, fully revalidates each candidate, returns the newest valid one and atomically repairs the pointer best-effort; a failed repair does not make the already-validated candidate invalid. If no generation validates, recovery is unavailable and selection returns nothing. Selected bytes are always the bytes that just passed validation.

## Recovery and pause

Only when eligible validated interruption recovery is available, ask if the player would like to continue where they left off; suggested wording: “Would you like to continue where you left off?” Decline proceeds with normal launch without overwriting normal save slots; checkpoint disposition on decline is undecided. Continue validates and restores the ledger before board loading conditions and board preparation, then presents the recovered board paused. Setup failure must not expose partial state. No simulation tick, board thread or entry-program instruction runs before explicit Resume; focus gain and zero-tick advancement do not resume. On Resume start board threads and the entry program exactly once in ordinary entry order; a waiting entry program may accept normal input. Game flags guard one-time logic. Asset replies and non-simulation preparation may run while paused, without starting scripts or exposing a partial restore.

Implementation and tests are tracked by #778, #782, #783 and #779; #780 reconciles BAT-13 evidence and #753 remains the sole Epic 7 closure sweep. Existing behavior evidence is cited in the decision document; this rule is not a claim that these capabilities have shipped.
