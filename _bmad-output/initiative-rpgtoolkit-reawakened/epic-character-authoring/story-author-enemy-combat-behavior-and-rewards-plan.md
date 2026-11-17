---
type: feature
title: "Author enemy combat behavior and rewards"
ticket: 8
status: draft
risk: high
tracker_id: "#1734"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1734"
---

# Author enemy combat behavior and rewards

## User outcome

An author defines how an enemy looks and fights, what happens on escape/defeat and what it awards, then connects it to the game's actual encounter settings.

## Ownership and dependencies

Moved from 13.9 on 2026-11-16, retaining GitHub #1734 and its history. The former slot is retired. CAP-16/CAP-18, T-56. Implementation waits for Epics 12 and 13, then 29.1/29.3, registration 13.1, actor formats 2.6, lifecycle/navigation/settings 11.3/11.4/11.6 and shared sprite foundation 12.4. Real move/status editors remain in 13.10, already delivered before this epic's gate opens.

## Acceptance criteria

1. Edit name, HP, SMP, FP and DP in the shared workspace, with identity and primary combat settings easy to discover. Preserve complete supported enemy data and same-version residue.
2. Integrate 29.3's real selected-stance/preview controls with enemy standard Rest/Attack/Defend/Special/Die and supported custom stances. Preserve spare/unknown animation slots and documented custom-stance encoding. Enemy data does not gain character/item directional walk/idle, movement timing or board polygons.
3. Present configured special moves, weaknesses and strengths as meaningful lists with real references, preserving sparse slots and unedited data. The original screenshots omit a strengths editor; the normative format and existing story scope still require that data's supported editing/preservation.
4. Edit documented AI levels or the custom AI program, can-run and run-away program, separately labeled critical chances on/by the enemy, XP/gold rewards and defeat program. Show units and explain behavior according to the chosen battle provider; do not infer unimplemented semantics from a field label.
5. Open actual linked animation, move and script providers with retained origin context. Add enemy to game opens the real main-file encounter-pool owner. No fake navigation or competing encounter list satisfies acceptance.
6. Use the shared registry, lifecycle and host services. Register every user-triggered action in CommandRegistry and the palette; controls call the same commands. Undo, cancel, failed picks/saves and view changes preserve accepted edits.
7. Prove same-version writing for every offered enemy version, including minor-0 text if editable. The existing binary writer alone cannot establish text preservation. Implement missing supported writing from normative docs or obtain an explicit docs-first owner ruling; never silently upgrade or claim preservation without evidence.
8. Save, close and reopen a representative nondefault enemy, visit it from an encounter and load the exact saved definition through the real battle provider. Verify fields, custom stances, residue and supported combat/reward behavior separately. Keyboard/theme/narrow-pane evidence and real-host results feed 29.6.

## Verification and sources

Use independently authored enemy fixtures, focused round-trip/command checks and real encounter/battle integration. Preserve the original story's version/unknown-data obligations; no runtime rule is changed merely to fit the form. Existing source mismatches become documented provider work, not guessed behavior.

Sources: docs/editor-features.md T-56; docs/spec/formats/enemy.md#layout and #the-custom-stance-mismatch; docs/spec/formats/legacy/text-formats.md#enemy; docs/spec/engine/plugins-and-battle.md#enemy-ai; docs/spec/formats/battle-data.md; AD-18/19/20/22/29; ADR 0022/0031. Write missing UX contracts under docs/ before implementation.

## Completion record

Draft, not implemented. Retain #1734 as the sole issue; record versions, persisted data, battle-provider limitations, host evidence and executed checks when delivered.
