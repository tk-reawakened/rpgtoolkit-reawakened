---
type: feature
title: "Connected authoring and test run integration"
ticket: 12
status: draft
---

# Connected authoring and test run integration

## Scope

Connect board placements, character definitions, existing item graphics, artwork, programs and run actions using shared visits and explicit save and revision boundaries. Full item behavior editing is delivered later in 29.7.

Use foundation focused visits and pickers for select/create/open with confirmation and return; distinguish local placements from shared definitions and unknown uses, refresh views of one authored document, keep running games revision-fixed, and distinguish preview, board test and normal startup.

## Acceptance and verification

A creator visits a placed item's delivered sprite definition and its board-owned placement program, edits graphics/script through actual providers, returns to the original board selection, saves and runs the chosen board or normal game with the correct revision. Verify local overrides and shared definition identity; full item behavior forms and the family-wide journey are accepted in 29.7/29.6.

Use the shared document lifecycle and preserve same-version unknown data; exercise relevant failure/cancel, keyboard access and save/reopen paths rather than relying on preview alone. Follow `discovery/inception-proposal.md`, `docs/editor-features.md` and G2/G7; do not claim checks passed without executing them.

## Dependencies and decision gate

Prerequisites: 12.3, 12.5, 12.7, 12.8, 12.11, 11.8 and 11.9. Owner sequencing on 2026-11-16 removes the former 12.6 dependency after that work moved to 29.7. This story proves broad services using retained editors; 29.6 later consumes them. There is no gate on Epic 29. Recheck actual providers before implementation.
