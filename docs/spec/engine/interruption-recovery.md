# Interruption recovery

**Owner-approved rule, not yet implemented** (#777). Interruption recovery is distinct from normal `Save`/`Load` and saveable VM snapshots; it does not weaken [G1](../../guardrails.md) or change existing mid-battle snapshot continuation. The approved contract and source evidence are in [the recovery decision](../../../_bmad-output/initiative-rpgtoolkit-reawakened/epic-menu-party-save/recovery-checkpoint-proposal.md). Ledger fields, identity, migrations and validation belong to #776.

## Stable checkpoint

Capture only after a full simulation tick at a consistent point with an active board and known player position: no open debugger tick, board transition, boot/reset/game-over transition, active battle, menu/dialogue or other discarded interaction, unresolved transaction/effect or relevant outstanding or ambiguously committed host request. A game or trusted policy must explicitly identify the point as safe for board re-entry; a tick boundary alone does not prove authored multi-tick logic complete. Unknown eligibility means no capture. Do not advance gameplay between eligibility and ledger capture.

Without a declaration or trusted policy establishing equivalent safety, do not create a new checkpoint. This may leave legacy games without recovery. Implement a trusted legacy compatibility policy that can nominate settled pre-battle and reconstructible screen/board-entry points only when all safety conditions are established; these labels alone are not proof. No mid-battle ledger-based battle restart is assumed.

## Capture and publication

Capture opportunistically at eligible points during play, and try on host interruption signals while time and platform permit; never force gameplay forward or promise success after abrupt termination. If capture or publication fails, preserve the last validated checkpoint; if none exists, recovery is unavailable.

Write a separate candidate, read the stored bytes back and validate identity, version, integrity, completeness and ledger consistency before atomically switching the durable recovery pointer. Serialize competing promotions. Keep the previous validated generation usable until promotion completes. Retain the current and one previous validated generation per game/profile; candidates in progress are separate. Revalidate before recovery and use an earlier generation only if it also validates. Hosts must define their atomicity and durability guarantees; unsupported guarantees must not be advertised. Normal save slots are not overwritten.

## Recovery and pause

Only when eligible validated interruption recovery is available, ask if the player would like to continue where they left off; suggested wording: “Would you like to continue where you left off?” Decline proceeds with normal launch without overwriting normal save slots; checkpoint disposition on decline is undecided. Continue validates and restores the ledger before board loading conditions and board preparation, then presents the recovered board paused. Setup failure must not expose partial state. No simulation tick, board thread or entry-program instruction runs before explicit Resume; focus gain and zero-tick advancement do not resume. On Resume start board threads and the entry program exactly once in ordinary entry order; a waiting entry program may accept normal input. Game flags guard one-time logic. Asset replies and non-simulation preparation may run while paused, without starting scripts or exposing a partial restore.

Implementation and tests are tracked by #778, #782, #783 and #779; #780 reconciles BAT-13 evidence and #753 remains the sole Epic 7 closure sweep. Existing behavior evidence is cited in the decision document; this rule is not a claim that these capabilities have shipped.
