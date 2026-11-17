---
type: feature
title: "Establish the character workspace and visual direction"
ticket: 1
status: draft
tracker_id: "#2962"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2962"
---

# Establish the character workspace and visual direction

## User outcome

An author understands where to change a character's identity, appearance, abilities, equipment and growth without first scrolling through every field. The editor has the visual character of TK Reawakened and remains a readable working tool.

## Scope and dependencies

Implements the experience foundation of CAP-15/CAP-18 and contributes to #2959. Depends on delivered character field coverage 12.5 (#1716). Read the epic's selected inputs and source-status distinctions first. Inspect the current editor and PR #2950 before changing shared chrome; reuse its final commands and Save integration. Do not wait for all of epic 12 to finish.

## Acceptance criteria

1. Record actual walkthroughs of opening an existing character, beginning a new one, changing its look/stats, and reaching an advanced binding. Use authored sparse and populated fixtures. Capture the current state and identify the concrete interaction and hierarchy changes; do not treat historical screenshots as a fresh audit.
2. Write the agreed character experience contract under `docs/` in a documentation commit before implementation. Map every T-50–T-54 control to its destination. The contract includes navigation, preview behavior, field grouping, accessible names, error/empty states and data/view-state ownership. No supported control disappears behind an unavailable destination.
3. Deliver a working character workspace with recognizable identity context and direct access to the task groups. Overview, Appearance, Moves, Equipment, Progression and Advanced are the starting grouping to evaluate. Selecting a section does not modify the document, reset unsaved accepted edits, discard undo or create a second model.
4. Apply reusable semantic styles inspired by the website palette and restrained framing. Gold emphasis identifies selected/primary states; focus and error states also have non-color cues. Light, dark and host high-contrast modes remain legible. Avoid per-field cards and fixed marketing-page spacing.
5. At 1280×720 and in a 640px-wide editor pane, character identity and starting values are discoverable without scrolling past stance configuration. Navigation and primary actions are reachable; section content can scroll but the whole editor does not require horizontal scrolling.
6. All navigation works by keyboard, exposes its selected state to assistive technology, and leaves focus in a meaningful location. Use native/semantic browser controls and the project's established navigation pattern; do not invent custom focus machinery without need.
7. Review real captures of representative first views and section navigation before marking downstream stories ready. Record the commit, fixture, viewport, theme and host. Resolve actionable findings in this story or a linked defect; a static mockup alone is not completion.

## Implementation boundaries

Own the character composition/layout and its navigation; introduce only the shared presentation primitives needed here. Keep feature-specific changes in 29.2–29.5. Coordinate edits to the shared character view so those stories extend the same layout rather than replacing each other's file wholesale. Retain the shared sprite behavior used by items. A universal Database or new formats/IDs are not part of this story.

## Verification

Exercise navigation with unsaved accepted edits, focused keyboard controls, narrow-pane resizing and retained document identity. Use focused component checks for meaningful state/focus behavior and actual browser/VS Code visual evidence. Do not write tests that only mirror CSS declarations. Follow the repository's fast-test and paced host-operation rules.

## Sources

- `docs/editor-features.md`, T-50–T-54; `docs/spec/formats/character.md#layout`.
- `docs/adr/0022-shared-editor-authoring-contracts.md`, document identity, lifecycle and view state; ADR 0025 and ADR 0031.
- Epic input documents: party decisions, EA-04/EA-06, SC-14/SC-15 and website palette. Older Database proposals remain proposals.

## Completion record

Not implemented. Add the documentation commit, visual review, captures and executed checks here when delivered.
