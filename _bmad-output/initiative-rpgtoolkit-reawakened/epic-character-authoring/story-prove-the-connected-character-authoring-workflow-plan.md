---
type: feature
title: "Prove connected character item and enemy authoring"
ticket: 6
status: draft
risk: high
tracker_id: "#2967"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2967"
---

# Prove connected character item and enemy authoring

## User outcome

An author completes a party character, NPC, equipment, usable item and battle enemy, follows their related assets without losing context, saves and uses the results in a real game from each shipped editor host.

## Scope and dependencies

CAP-15/CAP-16/CAP-18, T-50–T-56. After the Epic 12/13 gates, depends on 29.2–29.5, 29.7, 29.8, shared services 11.4/11.6/11.7/11.8 and actual move/status editors 13.10. Story 12.12 already supplies the broad visit/run boundary. This story owns definition-family presentation/integration and final acceptance; Epic 30 owns the board canvas/inspector experience, not a prerequisite for proving existing board placement services.

## Acceptance criteria

1. Follow actual supported animation/profile, special-move and script references. Return to the same definition, section, selected stance/row and sensible focus/scroll with accepted edits intact. Replacement versus opening/editing a reference are distinct registered actions.
2. Missing/deleted assets, unsupported providers, cancelled picks and failed saves preserve accepted data and show useful messages. A missing provider is unmet acceptance, never successful mocked navigation. Recheck #2609 and #2652 and reference their real fixes or outstanding failures.
3. The character journey edits identity/stats, nondefault bindings, appearance, a conditional move, equipment/accessories and growth; visits links; saves, closes and reopens; then assigns it through the actual game settings and observes authored appearance/stats and a representative move/progression boundary in the runner.
4. The NPC journey starts from a board placement, visits its shared item definition, edits appearance and board programs, returns to the original selection and preserves local placement overrides. Observe actual activation/background behavior from the saved data; distinguish definition defaults from local overrides.
5. Equipment and usable-item journeys cover slots/accessory names, bonuses, eligibility, prices/key flag, equip/remove scripts, independent menu/battle effects and use programs. Include a combined-capability fixture, retained inactive values and the shared equipment/battle animation field. Observe actual equip/use outcomes according to documented provider rules, including the menu-use eligibility distinction.
6. The enemy journey edits stats, standard/custom battle stances, moves/weaknesses/strengths, tactics, critical/escape settings and rewards/programs, follows real move/script providers, visits the actual encounter-pool owner, saves/reopens and loads the exact definition in a real battle. Clearly distinguish round-tripped data from behavior the chosen battle provider supports.
7. All five journeys exercise undo/redo across sections, a reload/conflict path, persisted-value inspection and exact saved-revision game use. Preserve unknown data and same-version format; the editors do not own party membership, board placement or runtime inventory.
8. Run the journeys in web/PWA and actual VS Code, including native Save, hidden/reopened views and identity. Exercise every shipped standalone editor consuming the shared UI. Component harnesses, player-only shells and shared-code assertions cannot substitute for host evidence; record unmet host acceptance explicitly.
9. Complete representative edits and navigation by keyboard and palette commands, including numeric geometry and growth-table alternatives. Verify accessible labels, focus return, validation and selected states; capture light/dark layouts and high contrast at the epic's target widths.
10. Publish repeatable walkthroughs and captures with commit, fixture, host/version, viewport, theme and observed game results. Map the full T-50–T-56 union, #2959 and the moved T-55/T-56 acceptance to evidence. Report broad integration evidence back to #1723 and Epic 30; close only actually resolved issues.

## Implementation boundaries

One editable document per URI; existing platform-services for navigation/save/launch. Reuse final shared command/Save/Run contracts from #2950/#2924. Fix family-specific presentation/integration here; provider/lifecycle defects retain their named owners. Do not introduce a new board inspector or a parallel launch coordinator.

## Verification and sources

Use small authored fixtures and focused checks, then paced real-host proofs with bounded retries. New unit tests stay below one second or carry the required explanation; applicable repository and lifecycle/round-trip gates pass. Sources: docs/editor-features.md T-50–T-56; docs/spec/formats/{character,item,enemy,battle-data}.md; docs/spec/engine/progression-and-levels.md and plugins-and-battle.md; ADR 0022; 29.1 contract and the consolidation record.

## Completion record

Not implemented. Record the host/result matrix, persisted-value and actual-game observations, captures, repeatable commands and remaining defects.
