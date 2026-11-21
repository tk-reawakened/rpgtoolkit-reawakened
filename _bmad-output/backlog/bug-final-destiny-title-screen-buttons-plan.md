---
title: "Final Destiny title screen is missing its button images"
type: bugfix
ticket: 12
created: 2026-11-21
status: in-progress
baseline_revision: 70e337bdc3495158547e3a9d74115a8b156df880
route: full
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

**Problem:** The unchanged Final Destiny title has clickable button slots but no button images. Its TK2 three-argument `CheckButton` call also fails, which can route a click to New Game regardless of the selected slot.

**Approach:** Reuse the existing image-button overlay and keep its hit slot independent. Add the optional slot output to `checkbutton` without changing two-argument behavior, then prove the title image and New Game route using the unchanged fixture in the headless runner.

## Boundaries & Constraints

**Always:** Follow `docs/spec/engine/rpgcode-functions.md` as the contract. Keep image and hit geometry tied to the same numeric slot. Replacement and clear remove both records. Missing images draw no pixels without disabling the slot. Keep the fixture unchanged and use no headed browser.

**Never:** Do not inspect or modify legacy game source. Do not broaden the change into menu redesign or general asset-loading changes. Do not alter unrelated worktrees or root-checkout changes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid button asset | `setbutton(file, slot, x, y, w, h)` | Keyed image blits 1:1 and slot remains independently clickable | No error |
| Missing or undecodable asset | Valid slot, unavailable image | No image pixels; slot stays enabled | Existing asset diagnostics only |
| Slot replacement | Same numeric slot set twice | One current image and hit rectangle remain | No stale press is revived |
| Slot clearing | Selected slot or no arguments | Paired image and hit slot are removed | No error |
| CheckButton hit/miss | Two or three arguments | Return remains 1/0; optional output writes slot/0 | No error |

</frozen-after-approval>

## Code Map

- `packages/core/src/save/sections/input.ts` already defines `InputImageButton` and `InputButtonSlot`; reuse both without changing save shape.
- `packages/core/src/render/ui.ts` already composes image-button records as magenta-keyed blits and places them in the UI overlay.
- `packages/core/src/script/packs/movement.ts` defines `SET_BUTTON`, `CHECK_BUTTON`, and applies both button effects; it currently creates only the hit slot and accepts only two checkbutton arguments.
- `packages/core/src/raster/raster.ts` skips unavailable textures without throwing, supporting a visible-image failure that leaves input state intact.
- `packages/runner-harness/src/closing.ts` schedules deterministic host input and captures real game frames; extend its run options with pointer records for the unchanged fixture proof.
- `packages/runner-headless/test/closing.test.ts`, `packages/core/test/input.test.ts`, and `packages/core/test/ui.test.ts` are the focused regression-test homes.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/core/src/script/packs/movement.ts` -- store an image record and a matching hit slot; atomically replace/clear both; add the optional by-reference slot output.
- [ ] `packages/core/test/input.test.ts` and `packages/core/test/ui.test.ts` -- cover rendering, hit/miss output, replacement, clearing, and missing images.
- [ ] `packages/runner-harness/src/closing.ts` and `packages/runner-headless/test/closing.test.ts` -- inject a deterministic pointer click into the unchanged Final Destiny fixture and assert title image plus loaded board.
- [ ] `CHANGELOG.md` and closing baselines -- record the behavior and regenerate only outputs changed by the normal headless generator.
- [ ] Run focused tests, project typecheck/test/lint/closing gates, then request independent review and fix blocking findings.

**Acceptance Criteria:**
- Given the unchanged Final Destiny fixture, when the headless runner captures the title, then it contains a button-image blit and a click on New Game reaches a board without a CheckButton arity error.
- Given a button slot, when it is replaced or cleared, then image and hit region change or disappear together; an unavailable asset adds no pixels but leaves the hit region clickable.
- Given `checkbutton(x,y)` or `checkbutton(x,y,&slot)`, when the point hits or misses, then the existing 1/0 result is preserved and the optional output is the numeric slot or 0.

## Implementation Notes

Full route: this is one title-screen goal spanning script state, UI rendering, and a fixture-driven headless proof. The owner’s direct implementation instruction approves the image behavior and scope.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `node --test packages/core/test/input.test.ts packages/core/test/ui.test.ts packages/runner-headless/test/closing.test.ts` -- focused regressions pass.
- `pnpm typecheck` -- project types pass.
- `pnpm test` -- complete local test suite passes.
- `pnpm lint` -- project lint passes.
- `pnpm closing` -- unchanged fixture suite matches regenerated intentional baselines.

**Manual checks:**
- Confirm no Final Destiny fixture file changed and no headed browser started.
