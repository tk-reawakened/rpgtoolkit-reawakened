---
type: feature
title: "Make character moves and equipment understandable"
ticket: 4
status: draft
tracker_id: "#2965"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2965"
---

# Make character moves and equipment understandable

## User outcome

An author can see which moves a character can use, understand how they become available, and configure the character's equipment slots and accessory names.

## Scope and dependencies

CAP-15/CAP-18, T-51 and T-53. Depends on 29.1 and extends existing character commands. This is character assignment/eligibility authoring; creating a new special-move or item editor is not part of the story.

## Acceptance criteria

1. Show configured moves as a readable list with a selected row's details, clear add/replace/remove actions and a useful empty state. Preserve support for the documented 200 slots without rendering 200 empty forms by default.
2. Each row keeps its original slot identity. Filtering, selection and display ordering do not compact or rewrite sparse saved slots. Replacement preserves the intended unlock data; removal follows the existing explicit command semantics. An unedited slot is unchanged after save.
3. Retain the explicit special-moves enable/disable control and category name; an empty displayed list is not a substitute for the stored enable flag. Preserve slot data according to the documented command contract. Show all three eligibility mechanisms: minimum experience, minimum level, and variable equals value. Summaries explicitly reflect the documented **any-condition / OR** behavior, including current handling of zero/empty values; do not silently present an AND rule or invent an enabled-state encoding.
4. Selecting a move reveals the relevant fields and reference actions in context. A missing reference is identified. Open/replace use actual shared capabilities; no dummy or pretend editor action passes acceptance. #2609 and 29.6 retain ownership of provider integration.
5. Equipment presents supported body-slot eligibility and up to ten accessory names in understandable groups. Explain that these define allowed equipment slots and names, not starting inventory or items already worn. Empty accessory names and disabled body slots retain their documented meaning.
6. Add, replace and remove a move; edit each unlock mechanism and accessory settings; then undo/redo and save/reopen. Sparse high-index slots, unrelated rules and other character data remain intact. Invalid input is identified beside its field without losing accepted edits.
7. The workflow works with keyboard selection and field focus at the epic's target widths. Light/dark captures include an empty state, a populated move with its unlock summary, and equipment settings.

## Implementation boundaries

Retain the existing character shape, per-field commands and reference identifiers. Do not add a learned-move inventory, new condition language, item assignment model or custom trait system. Use a shared list/detail pattern introduced here only where it serves real content.

## Verification

Test sparse-slot preservation, actual OR eligibility summaries at meaningful boundaries, reference failure/cancel, undo and round-trip outcomes. If disabled conditions or sentinel behavior is unclear in `docs/`, clarify the normative contract before implementation rather than infer it from legacy code or screenshots.

## Sources

- `docs/editor-features.md`, T-51 and T-53.
- `docs/spec/formats/character.md#layout`.
- `docs/spec/engine/progression-and-levels.md#special-moves`.
- `docs/adr/0022-shared-editor-authoring-contracts.md`; 29.1 experience contract; research F-07.

## Completion record

Not implemented. Record sparse-data, eligibility and visual workflow evidence when delivered.
