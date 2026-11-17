---
type: feature
title: "Establish the shared authoring workspace and visual direction"
ticket: 1
status: draft
risk: medium
tracker_id: "#2962"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2962"
---

# Establish the shared authoring workspace and visual direction

## User outcome

Authors recognize the asset and the task they are performing across a party character, board NPC, equipment, usable item and battle enemy. Shared appearance, references and navigation feel consistent, with the relevant behavior in view.

## Scope and dependencies

CAP-15/CAP-16/CAP-18; T-50–T-56. Implementation waits for the Epic 29 gates: Epics 12 and 13 complete. Retain 12.5 (#1716) as the direct character foundation. Also consume shared design language 11.22 (#2987) and common styling 11.23 (#2988), whose planning prerequisite is PR #2986. Shared work does not wait for this redesign. Inspect current delivered code and PR #2950's final shell/Save contracts before touching shared chrome.

## Acceptance criteria

1. Walk the current delivered tools and inventory what is implemented versus missing. Evaluate five sparse and populated authored examples: party character, NPC, equipment, usable item and enemy. Use real data; prototypes for unfinished item/enemy functions are clearly identified and cannot count as implemented behavior.
2. Commit an implementable UX contract under docs/ before code. Map every T-50–T-56 control to a primary owner and destination; record navigation, preview, grouping, empty/error states, keyboard/focus and data/view-state ownership. Preserve the four independent item capabilities and distinguish shared definitions from placements and runtime instances.
3. Deliver the family layout/navigation and character workspace using the shared primitives from 11.23 using existing document authority. Evaluate task-appropriate section labels across all five examples. Section changes preserve unsaved accepted edits, undo, selected rows and one document identity; no unavailable destination hides an existing control.
4. Show identity and primary controls first. An NPC presentation emphasizes appearance/board behavior; equipment emphasizes slots/bonuses; a usable item emphasizes use contexts/effects; enemies emphasize combat behavior. Other item capabilities remain discoverable and combinable. Do not infer type from names or rewrite/clear fields when changing presentation.
5. Consume 11.23's reusable semantic styles/components under the 11.22 contract, including website-inspired styles and restrained framing. Do not build a competing family-specific style system. Gold distinguishes selected/primary actions; non-color cues distinguish focus/error states. Light, dark and host high-contrast modes remain legible without per-field cards or marketing-page spacing.
6. At 1280×720 and a 640px-wide pane, identity and everyday controls remain discoverable without scrolling through stance configuration or whole-editor horizontal scrolling. Longer sections may scroll. Capture all five representative layouts, marking prototype-only portions honestly.
7. Register navigation and all other user-triggered actions in CommandRegistry and expose them in the palette. Controls dispatch those commands. Keyboard navigation, selected-state semantics, focus return and accessible labels follow established browser patterns.
8. Review working captures of the shared foundation before downstream stories become ready. Record commit, fixture, viewport, theme and host. Track actionable findings as issues. The live item/enemy workflows are completed by 29.7/29.8 and verified by 29.6, not claimed from a static mockup here.

## Implementation boundaries

Own the definition-family composition and navigation; consume common primitives from 11.23 and contribute reusable additions back to that contract only for concrete tasks; 29.2–29.5 retain character-specific work, 29.7 owns item behavior, and 29.8 owns the enemy document integration. No new formats, exclusive actor types, Database system or second document/Save/launch system. Existing native-kind proposals retain their authority and scope.

## Verification and sources

Exercise navigation with unsaved edits, keyboard focus, narrow-pane resizing and retained document identity. Use meaningful component checks and actual browser/VS Code evidence; do not test CSS declarations as behavior. Follow fast-test and paced host-operation rules.

Sources: docs/editor-features.md T-50–T-56; docs/spec/formats/character.md#layout; docs/spec/formats/item.md#board-items-vs-inventory-items; docs/spec/formats/enemy.md#layout; ADR 0022/0025/0031; the owner command rule and the epic's source map/consolidation decision.

## Completion record

Not implemented. Record the documentation commit, visual review, captures and executed checks when delivered.

## Shared styling ownership, 2026-11-16

The owner requested explicit shared design language and styling after the character/board discussions. 11.22 defines and validates the common placement/action/component contract; 11.23 implements it across existing surfaces. This story retains family hierarchy, task grouping and navigation. The broader family scope and Epic 12/13 gates preserve that ownership split.
