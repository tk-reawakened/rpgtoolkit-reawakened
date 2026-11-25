---
type: feature
title: "Clean board image export"
ticket: 14
status: done
risk: medium
---

## Intent

Export the current view or entire board as PNG using the shared AD-29 compositor without overlays; encode indexed PNG when there are 256 colours or fewer and true-colour PNG above that boundary.

## Scope and acceptance

The owner-approved `docs/spec/formats/images.md#storage-policy` supersedes the legacy T-32 PNG/JPEG/BMP inventory for authored exports. Do not reopen that selection or implement JPEG/BMP writers. Preserve original imported image bytes; this rule concerns newly generated pictures.

## Verification

Compare decoded output pixels with the actual composition for view/whole-board and content options, assert indexed versus true-colour encoding at the 256-colour boundary, and exercise cancellation and unavailable host output.

## Dependencies and decisions

Prerequisites: 13, 4.14, 4.15, 4.18. Apply the epic Notes, format specs, AD-18/19/20/22/29 and connected-authoring direction; T-32 maps to CAP-16. Preserve version and residue, use the existing shared model and browser, and route host access through platform-services. Where provider or host capability is unavailable, preserve data and report the limitation; do not simulate it.

## Status

**Built 2026-11-25 (13.14, #1739).** [PR #3427](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3427) merged as `6222cb1f6399c2ff755cf5bcf146f0827b068737`; [#1739](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1739) is closed as completed.

### Closure verification

Acceptance was audited against `origin/main` at `6222cb1f6399c2ff755cf5bcf146f0827b068737`.

| Acceptance clause | Committed test evidence |
| --- | --- |
| Exported pixels match composition for current-view and whole-board options | `packages/editor-model/test/board-preview.test.ts:88–125` compares the preview with the engine’s `viewbrd` pixels and checks a current-view crop. `tools/browser/tests/editor-board-canvas.spec.ts:383–485` decodes both production downloads and matches their pixel hashes to independently derived, overlay-free expected compositions; the view expectation explicitly handles viewport padding. |
| Indexed PNG through 256 distinct colours and true-colour above the boundary | `packages/editor-model/test/scene-png.test.ts:22–55` verifies indexed colour at exactly 256 RGBA colours, true-colour-alpha at 257, and exact decoded RGBA preservation. |
| Cancellation and unsupported host output | `packages/editor-ui/test/board-view.test.ts:983–995` verifies unsupported hosts explain the limitation and disable preparation. Lines 997–1050 defer the export-specific preview, cancel, then resolve it late and assert no ready state or save occurs. |

Focused verification at the pinned revision:

- `pnpm build && node --test packages/editor-model/test/board-preview.test.ts packages/editor-model/test/scene-png.test.ts packages/editor-ui/test/board-view.test.ts` — 44/44 passed, 0 skipped.
- `TKR_BROWSER_SUITE=editor-web PLAYWRIGHT_PORT=4183 pnpm browser:test --grep 'production browser board export downloads the current view and full board from the registered action'` — 1/1 passed on immediate retry (7.7s). The merged PR CI retry also passed the full `browser (editor-web)` lane (run 45531749286, attempt 2, job 138934454348).
- **Observed focus variance:** The preceding focused run failed at `editor-board-canvas.spec.ts:413` after Ctrl+S/Ctrl+Z (`Expected: focused`, `Received: inactive`); the immediate retry passed. Tracked separately in [#3453](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3453), distinct from #3374’s saved-test read race. This is not a stability claim.
