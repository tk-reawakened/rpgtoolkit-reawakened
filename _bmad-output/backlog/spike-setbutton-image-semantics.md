---
id: 11
type: spike
title: "Specify SetButton image rendering and lifecycle"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#2569"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2569"
refined: false
hitl: true
risk: high
---

# Specify SetButton image rendering and lifecycle

## Description

`setbutton` accepts a file argument, but the prior function contract described only a clickable slot. Issue #2153 showed that the unchanged Final Destiny title can create clickable slots while drawing no button images. The owner resolved the question in favor of a visible image overlay that remains independent of the hit rectangle.

## Decision

The owner approved drawing the supplied image at the slot's pixel coordinates while retaining the independently sized click rectangle. Replacing a numeric slot replaces both its image and hit rectangle; clearing selected slots removes both, and clearing without arguments removes all. A missing or undecodable image contributes no pixels but leaves the hit rectangle enabled. The full contract is recorded in `docs/spec/engine/rpgcode-functions.md#reawakened-setbutton-images`.

The existing UI renderer already composes image-backed buttons as keyed blits, while `setbutton` previously created only the click slot. The unchanged Final Destiny fixture's observed title draw list contains text and no button-image blits. The authored UI test also demonstrates the existing image-button overlay path. This evidence supports the implementation without reading or changing legacy game source.

## Approach

1. Compare image-backed slots, hit-test-only slots, and optional images that preserve click geometry.
2. Use the clean-room function spec, authored UI fixture, and unchanged Final Destiny draw list to assess image timing, slot replacement, clearing, click geometry, and asset failure.
3. Record the owner-approved rule in the function spec before implementing the waiting title-screen fix.

## Acceptance Criteria

1. **The candidate contracts are compared against the observable cases**
   Verify: comparison covers image drawing, slot replacement, `clearButtons`, click geometry, and missing-asset behavior.
2. **A deterministic fixture demonstrates the selected contract**
   Verify: the unchanged Final Destiny fixture draws its button image and retains clickable bounds; regression cases cover replacement, clearing, and missing images.
3. **The approved contract is recorded where the waiting ticket can find it**
   Verify: `docs/spec/engine/rpgcode-functions.md#reawakened-setbutton-images` defines the image and lifecycle behavior.
4. **The owner has accepted the contract**
   Verify: the dated owner decision is recorded in the spec.

## References

- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2569
- waiting ticket — `_bmad-output/backlog/bug-final-destiny-title-screen-buttons.md` (#2153)
- spec — `docs/spec/engine/rpgcode-functions.md#reawakened-setbutton-images`

## Notes

- Decision: The owner approved image rendering with independent hit geometry, same-slot replacement, paired clearing, and a clickable slot when the image asset is unavailable (2026-11-21).
- Risk: high — a bad implementation leaves title controls invisible; outside the ticket's regression criteria, run the headless closing suite against the unchanged fetched game fixtures.
