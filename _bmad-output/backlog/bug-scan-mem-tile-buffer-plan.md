---
title: "scan and mem do not preserve or restore tiles at runtime"
type: bugfix
ticket: bug-scan-mem-tile-buffer
created: 2026-11-14
status: in-review
baseline_revision: 3e1e6183355841dcc42cbd1b0cdc3750745fd761
route: oneshot
route_source: manual
risk: medium
review: none
review_source: auto
lenses_ran: []
review_loop_iteration: 0
context: []
assignee: ""
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `scan(x, y, pos)` and `mem(x, y, pos)` are documented to save a tile and lay it back on the screen, but both ran as a generic `world` effect that stores and draws nothing.

**Approach:** Give the pair a real implementation in core, built from a spec rule written first (G7). Owner rulings of 2026-11-14: a tile is the pixels of a one-based 32×32 screen cell, `x` and `y` are tile coordinates, and the buffers are saved game state kept until another `scan` replaces them. Prove it by running RPGCode that scans, changes the destination, and restores through `mem`, asserting real pixels and separate buffer positions.

</frozen-after-approval>

## Verification

**Commands:**
- `node --test packages/core/test/scan-mem.test.ts` -- expected: 6 pass, each well under 1 second.
- Take `SCAN, MEM` out of `GRAPHICS_COMMANDS` and rerun the same file -- expected: all 6 fail; restore the registration and it passes again.
- `pnpm lint` and `tsc -b` -- expected: clean.
- `node --test "packages/core/test/*.test.ts"` -- expected: no new failures.

## Implementation Notes

- Spec first, in its own commit (`3e1e618`): the rows and a new `#reawakened-scan-mem` rule in `docs/spec/engine/rpgcode-functions.md`.
- `packages/core/src/raster/surfaces.ts`: `saveTileBuffer` and `restoreTileBuffer` store each buffer in `surfaces.slots` under a `tile:<pos>` key, so it never shares a slot with `savescreen` and rides along in the existing saved surfaces section. `savescreen` now shares its slot-replacing step with them through `storeSlot`, with no change in behaviour.
- `packages/core/src/script/packs/graphics.ts`: the `scan` and `mem` commands, registered in `GRAPHICS_COMMANDS`, which makes the catalogue drop the generic responders. They keep the `deprecated` tag and reason the old docs carried.
- `packages/core/src/script/catalogue-responders.ts`: the stale `mem` row said `x,y[,layer],mem`; the spec says `x,y,pos`.
- `mem` replaces the destination pixels, alpha included, rather than compositing; a cell scanned from the composed screen is opaque, so it fully covers what was there.

Verification run on 2026-11-14: `scan-mem.test.ts` 6 pass (140, 66, 68, 1, 2 and 2 ms); with the commands unregistered all 6 fail; `pnpm lint` clean; `tsc -b` clean; whole core suite 2964 pass, 25 skipped and 1 fail. The one failure, `battle-ui-background.test.ts` "Final Destiny's text background paints its stored tiles in a stock fight", needs the unfetched `fixtures/legacy/FinalDestiny` files and fails identically with these changes stashed (#2178).

## Open

- Not run: the full `pnpm test` on CI, and any real-game check with a Toolkit 3.1 game that calls `scan` and `mem`.
- The spec rule defines the cell as the screen grid, so a scrolled board's tile (x, y) is not screen cell (x, y). That follows from the owner's "pixels of the tile cell" ruling, but it was my reading of it; it is worth a look if a legacy game scans while the board is scrolled.
