---
type: feature
title: "Neighbour aware auto tiling"
ticket: 8
status: draft
risk: high
---

## Intent

Implement T-25 painting from the normative clean-room specification [autotiling.md](../../../docs/spec/editor/autotiling.md): its `AUTOTILES_` naming rule, 52-slot tile table, eight-neighbour corner gating and 3 × 3 reshape, re-evaluating affected neighbours.

## Scope and acceptance

Show missing role assignments and tested arrangements. The legacy order is the spec's table, settled in 13.7 (#1732); do not substitute a generic blob order for it.

**Owner direction (2026-11-26):** autotiling only affects the editor, so ours may be friendlier than the original (see T-25). What must be kept is using and importing original `AUTOTILES_` sets. Boards need no import step, because they store ordinary tile references.

- **Recognise** an original set when its **file name** (not the whole path) starts with `AUTOTILES_` in any letter case and it loads as a `.tst` or `.iso`. Sets in sub-folders count. Let an author also mark any tileset as using the 52-slot layout without renaming it.
- **Warn, never refuse,** where the original accepted silently: fewer than 52 tiles (name the missing shapes and show them as gaps, not blanks), a square set on an isometric board or the reverse, and autotiling switched on with an ordinary set chosen.
- **Show state** the original never showed: a visible autotile indicator, and a note when Shift limits the reshape to one set.
- **Preview** an imported set as its 47 shapes using its own tiles, so wrongly ordered art is obvious. Nothing can check art automatically.
- Fill and Rectangle may work in autotile mode; the original refused them.

Also consume the approved native rule contract through 27.13 and the scene editing route from 12.16. Label native role assignments explicitly; native role order is not the legacy 52-slot order, and generating a native set does not make it an original-format set. Entry 27 supplies the generator and sandbox later; this entry owns the painting command they call, not duplicate terrain logic.

## Verification

Painting and erasing match the spec's tile table and reshape rules, checked against hand-read cases and the spec example in `docs/spec/editor/examples/autotiling/` (which `docs/spec/tools/test_autotile_example.py` already checks). Original `AUTOTILES_` sets import with the warnings above, and painting or erasing recomputes adjacent cells across board edges and undo/redo.

## Dependencies and decisions

Prerequisites: 1, 12.1, 12.2, 7, 27.13, 12.16. Apply the epic Notes, [autotiling.md](../../../docs/spec/editor/autotiling.md) and the approved native and legacy format specifications; T-25 maps to CAP-16. Preserve undo/history ownership and re-evaluate the affected neighbourhood through the actual board/scene provider.
