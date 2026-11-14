---
type: feature
title: "Shared sprite graphics stances and bases"
ticket: 4
status: draft
---

# Shared sprite graphics stances and bases

## Scope and accepted design

Build one shared character/item sprite editor and one binary document model. Register `.tem` and `.itm` kinds in the existing registry and route them through the standard document/workspace lifecycle; do not copy a model or add another decoder.

Support eight walk and idle directions, character battle/custom stances, ANM and animated-GIF filename assignment and preview, the `*` direction-template wizard, seconds-per-step and idle delay, and separate collision/activation polygons. Provide a picture preview with a bottom-centre origin crosshair, editable polygon points through both pointer geometry and numeric controls, independent shape presets and cross-kind base import. Save and reopen both actor kinds.

Preserve the opened file minor version. Expose controls only when the format stores them; never silently upgrade. Reject values that the same-version writer cannot round-trip exactly and preserve unknown bytes through the established document contract.

## Acceptance and verification

- A character and item use the same view/model implementation, distinct `.tem`/`.itm` paths and values persist after save/reopen.
- Walk and idle each expose S, N, E, W, NW, NE, SW and SE. The template wizard replaces exactly one `*` and assigns those eight suffixes. Character-only attack, defend, special-move, die and rest slots are exposed; custom stances can be added, renamed, removed and assigned an animation.
- `.anm` and animated `.gif` files selected by project-relative filename use the core format/image providers for preview. Preview respects animation timing and shows the sprite-origin crosshair at bottom centre.
- Speed and idle delay are seconds, editable only for versions that store them.
- Collision and activation have independent point lists, at least three whole-pixel points each, and can be edited by SVG pointer interaction or accessible numeric controls; presets and import replace the pair without conflating the two shapes.
- Save/reopen retains assignments, timings, custom stances and distinct bases. Read-only/malformed/unsupported inputs do not become writable by the editor.
- Keep UI keyboard-accessible and provide labels, statuses and a numeric geometry alternative.

Use the shared document lifecycle and same-version read/write contract; exercise failure, accessibility and save/reopen behavior. Follow `discovery/inception-proposal.md`, `docs/editor-features.md` T-52, G2/G7, and the format contracts in `docs/spec/formats/character.md`, `item.md`, and `animation.md`. Verify existing ANM/GIF providers from `@tk-reawakened/core`; do not consult legacy sources or implement a second decoder.

## Dependencies and implementation decisions

Prerequisites: 11.3, 11.4, 2.6 and 16.12 for animated GIF decoding; all are closed. Use the current `.tem` and `.itm` reader/writer and the established workspace registry, without auto-upgrading legacy minors. Use one shared sprite document/component; adapt each file kind through its codec and version-gate controls from the normative format contract. Use the core `readAnimation`, `decodeTexture` and `decodeGif` providers for preview, and the existing document save/reopen lifecycle for persistence.
