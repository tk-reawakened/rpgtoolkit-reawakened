---
id: 12
type: bug
title: "Final Destiny title screen is missing its button images"
parent: none
covers: []
after: ["spike-setbutton-image-semantics"]
assignee: ""
tracker_id: "#2153"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2153"
refined: true
hitl: false
risk: medium
severity: P2
---

# Final Destiny title screen is missing its button images

## Description

The Final Destiny title screen is no longer entirely black: the title text is visible, and PR #2570 corrected stale intro text. The remaining reported failure is that New Game is clickable but its button image is not drawn. The fixture's unchanged startup must show the title and its button images after the SetButton visual contract is approved.

## Reproduction

1. Launch the unchanged Final Destiny fixture through the Electron renderer.
2. Advance to its title screen and capture the frame before selecting New Game.
3. Actual: the title text is visible and New Game is clickable, but the button image is absent.
4. Expected: the title screen renders the button images while retaining the existing clickable bounds.

## Cause Hypothesis

The current `setbutton` contract specifies a clickable slot but does not specify whether the supplied file is rendered; the implementation may therefore omit the visual draw without contradicting the documented behavior.

## Acceptance Criteria

1. **The unchanged title-screen fixture renders its buttons under the approved contract**
   **Given** the Final Destiny fixture and the owner-approved SetButton rule
   **When** its startup reaches the title screen
   **Then** the title and button images are visible and New Game remains clickable at the documented bounds.
2. **Tests cover the reported screen and the button lifecycle**
   **Given** the title-screen regression suite
   **When** it runs against the unchanged fixture
   **Then** it proves the title image blit, New Game click reaching the board, same-slot replacement, paired clearing, and the image behavior when an asset is unavailable.
3. **Or: no change is needed, with proof**
   **Given** the unchanged fixture and approved rule
   **When** the title screen is rendered
   **Then** the images already appear as required, or the report is mistaken, with pixel evidence recorded in Notes; this supersedes criteria 1 and 2.

## References

- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2153
- related issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2569
- merged correction — PR #2570 (stale screen text)
- spec — docs/spec/engine/rpgcode-functions.md, `setbutton` command catalogue entry

## Notes

- Decision: The owner approved the `setbutton` image and slot lifecycle in `docs/spec/engine/rpgcode-functions.md#reawakened-setbutton-images` (2026-11-21); the prerequisite spike records its evidence.
