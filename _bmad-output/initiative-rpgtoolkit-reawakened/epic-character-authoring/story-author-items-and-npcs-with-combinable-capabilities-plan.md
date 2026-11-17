---
type: feature
title: "Author items and NPCs with combinable capabilities"
ticket: 7
status: draft
risk: high
tracker_id: "#1722"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1722"
---

# Author items and NPCs with combinable capabilities

## User outcome

An author creates an NPC/board object, equipment or a usable item and configures the relevant behavior in the common workspace. Multiple roles can coexist on the same item definition.

## Ownership and dependencies

Moved from 12.6 on 2026-11-16, retaining GitHub #1722 and its history. The former slot is retired. CAP-15/CAP-18, T-55 and shared T-52. Implementation waits for Epics 12 and 13, then 29.1, 29.3, sprite provider 12.4 and board placement/override owner 12.11. This is full unfinished functionality, not only visual polish.

## Acceptance criteria

1. Edit name/handle, description, buy/sell prices and key-item flag. Present NPC/board behavior, equipment and usable-item tasks through enabled capabilities; equipment/menu/board/battle flags remain independently editable and combinable. No exclusive type, name-based inference or implicit migration is introduced.
2. Enabling/disabling a capability changes only its flag. Its saved fields remain intact and undoable; re-enabling restores their presentation. Inactive capabilities stay discoverable without burying an NPC's everyday appearance/interaction controls beneath inventory pricing.
3. Equipment exposes supported body/accessory slots, accessory name, HP/DP/FP/SMP bonuses, equip/remove programs and battle animation. Character eligibility supports all or defined entries with documented slot identity and preservation.
4. Menu and battle uses independently expose signed HP/SMP effects and their respective programs. Equipment and battle animation controls refer to the one shared animation field described by the format; do not create independent stored values. Explain positive/negative values and use contexts in game-author language.
5. Board behavior exposes the default background/multitask program and activation program. Explain activation for NPC interaction and board objects using the documented behavior; do not imply automatic inventory pickup. Reuse 29.3 for supported sprites, timing and bases.
6. A visit from an actual board placement clearly edits the shared definition, retains the originating selection and preserves position and local program overrides. Returning does not silently replace overrides with definition defaults. Board-instance editing remains with the board owner.
7. Reference pick/open/create routes use real supported providers with cancellation/failure preservation and useful missing-resource messages. Commands are registered and available in the palette; controls dispatch them, including capability toggles and field edits.
8. Save/reopen, undo/redo and conflict/reload preserve every edited and unrelated supported field, inactive capability values, sparse eligibility entries and same-version residue. Prove each offered legacy version's writer path; do not silently upgrade when a version-preserving writer is absent.
9. NPC, equipment and usable-item fixtures plus a mixed-capability case prove these outcomes in real hosts. Actual menu/equipment/battle behavior follows the chosen provider: item eligibility constrains equipment, whereas the documented menu-use action does not apply it to the party target. A key-item flag alone must not be described as enforcing an engine rule.

## Verification and sources

Focused model/component checks cover each capability and their combinations, the shared animation field, toggling with retained values, eligibility, placement scope, reference failure and persistence. Real host visits and actual equip/use/activation observations feed 29.6. Use fast tests and paced host protocols.

Normative sources: docs/editor-features.md T-52/T-55; docs/spec/formats/item.md#layout and #board-items-vs-inventory-items; docs/spec/formats/board.md#items-placed-on-the-board-sprites; docs/spec/engine/plugins-and-battle.md#epic-85-item-action-proposal; ADR 0022/0031. Commit any missing UX/behavior contract under docs/ before code (G7).

## Completion record

Draft, not implemented. Retain #1722 as the sole issue; record fixtures, version evidence, real-host/game results and checks when delivered.
