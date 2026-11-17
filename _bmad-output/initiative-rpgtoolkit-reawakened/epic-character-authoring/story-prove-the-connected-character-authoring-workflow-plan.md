---
type: feature
title: "Prove the connected character-authoring workflow"
ticket: 6
status: draft
tracker_id: "#2967"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2967"
---

# Prove the connected character-authoring workflow

## User outcome

An author can finish a character, follow its linked assets without losing their place, save it, and use it in a real game from each shipped editor host.

## Scope and dependencies

CAP-15/CAP-18 and T-50–T-54. Depends on 29.2–29.5 plus delivered navigation, game settings, program editing and launch services 11.4, 11.6, 11.7 and 11.8. This story owns character-specific presentation/integration and the combined acceptance journey. Story 12.12 (#1723) still owns the broader connected-editor workflow; #2609 owns its existing missing program/special-move provider defect. Recheck these issues before implementation and link the actual provider changes instead of duplicating them.

## Acceptance criteria

1. Follow actual supported animation/profile, special-move and level-up-program references from the character view. Return to the same character document, section, selected row/stance and sensible focus/scroll context, with accepted unsaved edits intact. Reference replacement and edit/open are distinct actions.
2. Missing/deleted assets, unsupported providers, cancelled picks and failed saves produce useful messages and preserve the accepted document. Resolving a failure lets the author continue. An unavailable provider is an unmet connected-workflow dependency, not a successful mocked navigation.
3. A repeatable authored-fixture journey creates or opens a character, assigns a look, edits identity/stats, adds a conditional move, changes equipment/accessories and growth, visits linked assets, saves, closes and reopens. Verify persisted values as well as the visible fields. Exercise undo/redo across section changes and a reload/conflict path.
4. Through the existing owning project/game controls, assign the character to the game's starting party and run the game. Observe the authored appearance and starting values, plus a representative move/progression boundary using the existing runner/test facilities. The character editor does not take ownership of party membership, placement or runtime inventory.
5. Run the full journey in web/PWA and actual VS Code, including native save, hidden/reopened view and file identity behavior. Exercise any shipped standalone editor that consumes the shared UI. A browser-only component harness, player-only shell or shared-code claim cannot substitute for a host result. Record any host not exercised and leave its acceptance unmet.
6. Complete identity/stat editing, stance assignment and numeric shape editing, a move/unlock edit and progression-table review using the keyboard. Check accessible labels, selected states, focus return and validation messages; capture light/dark layouts and verify high contrast at the epic's target widths.
7. Publish actual captures and the repeatable walkthrough with commit, host/version, viewport, theme, fixture and observed results. List defects separately with their existing/new issue IDs. In particular, verify #2652's current state and do not mark its pending-edit failure solved merely because layout changed.
8. Review the completed experience against 29.1's contract, T-50–T-54 coverage and #2959. No missing feature is hidden by removing its navigation. Share the character journey evidence with #1723; close only the issues actually resolved by this work.

## Implementation boundaries

Use one document instance per URI and existing platform-services for navigation, save and launch. Reuse the final #2950 shared-command/Save and #2924 Run work. Do not restore the obsolete bottom Run layout or build a parallel launch coordinator. Fix character-specific integration here; keep broad provider/lifecycle changes with their established issue owners and record explicit blocking dependencies as needed.

## Verification

Use small authored fixtures and focused model/component checks, then paced real-host proofs with bounded retries. Store repeatable commands and evidence references. Ordinary new unit tests must stay under one second or carry the required explanation. Required repository checks and relevant existing lifecycle/round-trip checks must pass; a capture alone cannot establish persistence or game behavior.

## Sources

- `docs/editor-features.md`, T-50–T-54; `docs/spec/formats/character.md#layout`.
- `docs/spec/engine/progression-and-levels.md`; `docs/adr/0022-shared-editor-authoring-contracts.md`.
- 29.1 experience contract and the epic's source/authority map.
- Existing issues #1723, #2609, #2652 and PR #2950; delivered story 12.5 and foundation provider plans.

## Completion record

Not implemented. Add a host/result matrix, repeatable proof commands, captures, observed game results and remaining defects when delivered.
