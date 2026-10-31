---
id: 33
type: story
title: "Reference oracle for lights and shading: lit scenes"
parent: epic-board-rendering
tracker_id: "#401"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/401"
tracker_status: done
covers: [CAP-6]
after: [4, 13]
hitl: false
risk: medium
---

# Reference oracle for lights and shading: lit scenes

## Description

Extends the 4.4/4.17 independent oracle (`golden/scenes`, `golden/reference`, `golden/ledger.json`, `tools/fixtures/reference/render.py` and `SCHEMA.md`, and the authored fixture generator) with lit scenes so 4.13's light and shading arithmetic has a second, independent opinion. The independent Python renderer paints expected pixels from the normative wording alone (`docs/spec/formats/tiles.md#shading`, `docs/spec/formats/board.md#lights` and shading, and `docs/spec/engine/display-input-audio.md#reawakened-light-and-raster-arithmetic` E-17); the core engine's output must match exactly. The authored board is mid-grey rather than white, with a coloured tile strip and no transparent-key pixels, and covers an ellipse falloff, a gradient, a clipped gradient, overlapping lights including a very bright light that exercises the final clamp, and a night look with strongly negative board ambient plus one centred ellipse light; all lights are static baked board data, with no runtime or sprite-attached light. This checks conformance to the Reawakened specification wording, not legacy parity; round-7 question 8 covers the original's falloff.

## Acceptance Criteria

Verify: The five S-LIGHT-* scenes pass through the real engine (`createEngine` + `composeBoard` + raster) and match the reference PNGs by decoded RGBA exactly; the ledger marks every new row `independent-reference` and gating with this entry as producer; `node tools/fixtures/author/generate.mjs --check` and `python3 tools/fixtures/reference/render.py --check` pass; and scaled 4× nearest-neighbour previews are supplied for owner review.

## References

- parent — _bmad-output/initiative-rpgtoolkit-reawakened/epic-board-rendering/epic-board-rendering.md
- reference - docs/spec/formats/tiles.md#shading, docs/spec/formats/board.md#tile-shading, docs/spec/formats/board.md#lights
- reference - docs/spec/engine/display-input-audio.md#reawakened-light-and-raster-arithmetic
- code - tools/fixtures/reference/render.py and tools/fixtures/author/generate.mjs
