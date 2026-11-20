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

`setbutton` accepts a file argument, but the current function contract describes only a clickable slot and does not say whether or when the image is drawn. The issue's Final Destiny fixture shows clickable but invisible buttons, and ticket #2153 waits on the answer. The owner must approve the user-visible contract before rendering behavior is implemented.

## Approach

1. Compare treating the file as a visible button image, as a hit-test-only asset name, or as an optional visual while preserving click geometry.
2. Check the existing spec and the unchanged Final Destiny fixture for evidence of intended draw timing, slot replacement, clear behavior, and missing-asset behavior; do not infer a ruling from the fixture alone.
3. Recommend drawing the supplied image at the slot's pixel coordinates while retaining its independent hit-test rectangle, with replacement and clear behavior tied to the button slot lifecycle.
4. Have the owner approve the behavior and record the full contract in `docs/spec/engine/rpgcode-functions.md` before ticket #2153 starts.

## Acceptance Criteria

1. **The candidate contracts are compared against the observable cases**
   Verify: the comparison covers image draw timing, slot replacement, `clearButtons`, click geometry, and missing-asset behavior.
2. **A deterministic fixture demonstrates the selected contract**
   Verify: the unchanged Final Destiny fixture shows its button image and clickable bounds, plus replacement and clear cases, without changing its source.
3. **The approved contract is recorded where the waiting ticket can find it**
   Verify: the spec defines the file's visual behavior and lifecycle, and ticket #2153 references the rule.
4. **The owner has accepted the contract**
   Verify: the dated owner decision is recorded in the spec.

## References

- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2569
- waiting ticket — bug-final-destiny-title-screen-buttons.md (#2153)
- spec — docs/spec/engine/rpgcode-functions.md, `setbutton` command catalogue entry

## Notes

- Open question: does the `file` argument draw a visible image, and what are its replacement, clearing, and missing-asset semantics?
- Assumption: button images are meant to be visible while their slots remain clickable; the owner must confirm this before implementation.

- Risk: high — visible title-screen controls may remain absent; outside this ticket's criteria, smoke-test the unchanged Final Destiny fixture in Electron after the rule is approved.
