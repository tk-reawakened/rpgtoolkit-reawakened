---
type: feature
title: "Complete structured event authoring"
ticket: 3
status: draft
risk: high
---

# Complete structured event authoring

## Scope

Adds categorized command templates, typed asset and scalar inputs, insertion, deletion, ordering, conditions and waits within the ruled representable subset, with explicit code display and safe handling of nonrepresentable text.

Cover the T-45 categories (Text, Display, Player, Fight, Control, Items, Variables, Input and Info) within the [TOOL-12 admission rule](../../../docs/spec/engine/rpgcode-tooling.md#tool-12-visual-events). Record supported commands here when the recogniser exists; each must save and reopen as the same card. The legacy template count is not a required inventory, and unrepresentable source stays opaque.

Implement the T-45 screen-layout canvas as another editor for the admitted card's coordinates and size, not as a separate document. Follow TOOL-12 for selection, numeric/keyboard placement and the existing ADR 0038 action rule. Save/reopen and undo preserve the same program text; run representative output and compare it with the authored placement.

## Acceptance and verification

Representative commands from every supported category generate clean runnable RPGCode, keyboard editing and undo work, and handwritten unsupported content is never silently regenerated.

## Dependencies and decisions

Requires 14.2, 11.4. Follow the approved contracts and capability declarations; do not assume unimplemented provider behavior.
