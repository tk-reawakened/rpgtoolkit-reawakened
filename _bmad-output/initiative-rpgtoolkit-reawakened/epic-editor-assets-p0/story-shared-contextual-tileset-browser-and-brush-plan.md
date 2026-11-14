---
type: feature
title: "Shared contextual tileset browser and brush"
ticket: 2
status: done
---

# Shared contextual tileset browser and brush

## Scope

Provide one retained-context browser and targetable brush selection for boards, tile bitmaps and animations with accessible explicit source-edit and brush actions.

Keep last active editor and browser selection/scroll despite focus changes; offer visible default plus keyboard and context-menu actions, no broadcast, no source mutation on selection, and an explicit unavailable P1 source editor action.

## Implementation decisions

- Keep one host-owned `BrowserSession` per project/workspace, carrying source path, scroll offset and selected brush. Every mounted browser view subscribes to all three; switching boards does not reset context or edit either board.
- Open the visible browser from the focused board cell with **L**, moving focus to its source selector. Selecting a tile or animation only chooses the brush; a separate board action paints one cell on the active board. Native buttons provide Enter/Space behavior.
- Browse `.tst`, `.iso`, `.gph`, `.tan` and `.tbm` sources. Use the canonical tile-texture decoder and tile-bitmap compositor for previews, including `.gph` references and 16px tiles doubled to the 32px bitmap cell. Bitmap placement and source editing remain unavailable and explicitly explained until their providers exist.
- Constrain the tile list with the shared exported stylesheet in both host bundles. Protect async source changes with a request generation; restore scroll only after the new items mount.
- Shift+F10 and the platform context menu open the same action group. Give it an enabled close action when source editing and bitmap placement are unavailable; Escape returns focus to the invoking control.


## Acceptance and verification

Switching boards preserves browser selection without painting, targets only the active board, exposes both keyboard and menu actions, and explains unavailable source editing until the P1 provider exists.

Use the shared document lifecycle and preserve same-version unknown data; exercise relevant failure/cancel, keyboard access and save/reopen paths rather than relying on preview alone. Follow `discovery/inception-proposal.md`, `docs/editor-features.md` and G2/G7; do not claim checks passed without executing them.

## Dependencies and decision gate

Prerequisites: 1, 11.4. None newly identified; check the linked proposal and actual providers before implementation.
