<!-- Owner-relayed fact sheet, clean-room extraction round 13 (ADR 0006). Facts are not rulings; specification changes follow separately (G7). -->

# Clean-room extraction, round 13 — movement mode and pre-vector runs (owner-relayed)

- **Source consulted:** the answerer inspected the original applications and exercised an isolated compiled decoding harness; the full Windows applications were not run.
- **Answerer:** engineer, relayed by Jensen; identity not otherwise stated.
- **Date:** 2026-10-28.
- **Versions:** released 3.1.0 and final source, as reported; revision identifiers not supplied.
- **Confidence:** movement facts were relayed without a confidence label. Run-overflow facts were reported as certain from source inspection; the engine decoding loop was also exercised in isolation. The editor and the absence of an overflow warning were not observed through the full UI.
- **Questions:** whether movement mode is per game or board and how it relates to vectors; how minor 2 and 3 pre-vector boards handle an oversized final tile run.
- **Review:** not reviewed by a separate agent; behavior prose only, relayed by the owner.

**D1. Movement mode.** In 3.1 the game file established the initial game-wide choice between whole-tile and smaller pixel movement. Older game files without the setting defaulted to tile movement. RPGCode could change the mode at runtime.

**D2. Collision geometry.** Board vectors defined collision boundaries and other regions independently of movement mode. Vector collision did not require pixel movement; a game could retain tile-stepped movement.

**D3. Pre-vector run overflow.** For otherwise valid minor 2 and 3 pre-vector boards, the 3.1.0 editor and engine filled the remaining grid cells from an oversized final run, discarded the excess repetitions, and continued with the following fields. Neither reported an overflow-specific warning in that loading path, according to the source inspection. They did not enlarge the board or reject it solely for the oversized run.

**D4. Harness scope.** The answerer reports testing the released engine's decoding loop in isolation with exact-fit and oversized runs, including one after an earlier cell, and checking that the following field was read correctly. Sanitizers reported no errors. This was not a full application run.

## Doubts in the relay

Resolved: both minor versions and both applications follow the same reported overflow behavior. Still open: whether Reawakened should retain its additional warning is a product decision, not a legacy fact.

## Disposition

Nothing below is a ruling.

| Fact | Touches | Effect |
|---|---|---|
| D1–D2 | Game movement and board collision specifications | Check existing rules for agreement; do not infer that vectors select a movement mode. |
| D3–D4 | Pre-vector board specification and issue #641 | Specify clamping separately from vector-board run retention. The existing Reawakened warning must not be presented as a legacy warning. |
