---
title: "Specify SetButton image rendering and lifecycle"
type: chore
ticket: 11
created: 2026-11-21
status: ready-for-dev
baseline_revision: 70e337bdc3495158547e3a9d74115a8b156df880
route: oneshot
route_source: auto
risk: high
review: ""
review_source: ""
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The current spec does not say whether `setbutton(file, ...)` renders `file`, or define image replacement, clearing, or asset-failure behavior.

**Approach:** Record a clean-room contract using the existing renderer and authored tests as evidence, then implement and prove it as part of the related Final Destiny title fix.

</frozen-after-approval>

## Implementation Notes

The decision was committed docs-first in `70e337bdc3495158547e3a9d74115a8b156df880`. Evidence: the renderer already supports `InputImageButton`; SetButton currently creates only a hit slot; unavailable textures are skipped; the unchanged fixture title has no image-button draw; authored UI tests exercise the existing overlay. Code and fixture proof are shared with the #2153 build plan.

## Verification

**Commands:**
- `node --test packages/core/test/input.test.ts packages/core/test/ui.test.ts packages/runner-headless/test/closing.test.ts` -- proves the spec and unchanged fixture behavior.
