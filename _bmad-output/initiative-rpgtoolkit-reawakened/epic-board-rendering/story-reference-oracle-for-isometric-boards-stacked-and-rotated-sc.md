---
id: 17
type: story
title: "Reference oracle for isometric boards: stacked and rotated scenes"
parent: epic-board-rendering
tracker_id: "#400"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/400"
tracker_status: done
covers: [CAP-6]
after: [1, 4]
hitl: false
risk: low
---

# Reference oracle for isometric boards: stacked and rotated scenes

## Description

The producer of every isometric expected image, before its consumer: authors from `docs/spec` alone, in entry 4's scene schema, a small iso-stacked board (`coordType` 1) and a small iso-rotated board (`coordType` 2, effective grid `(sizeX + sizeY)` square) with an `.iso` tileset, a 2D tileset tile on an iso board (the `iso2d` projection of entry 1), layered tiles, a sprite pair for draw order, shading and a camera clamp case; extends entry 4's Python reference with tile-to-pixel conversion, the diamond pour, board pixel sizes and both draw orders; commits the PNGs and ledger rows. No sample game has an iso board (every corpus board is `coordType` 0 or 4), so these scenes are the only iso oracle.

## Acceptance Criteria

Verify: Both iso scenes and their reference PNGs regenerate with `--check` (decoded RGBA), the reference renders the `grass.iso` tile identically to `docs/spec/examples/renders/grass_iso.png`, the board pixel sizes equal the formulas of `docs/spec/formats/board.md#board-pixel-dimensions`, and the ledger lists both scenes as independent-reference with this entry as producer.

## References

- parent — _bmad-output/initiative-rpgtoolkit-reawakened/epic-board-rendering/epic-board-rendering.md
- reference - docs/spec/formats/tiles.md#isometric-tiles, docs/spec/formats/board.md#coordinates
