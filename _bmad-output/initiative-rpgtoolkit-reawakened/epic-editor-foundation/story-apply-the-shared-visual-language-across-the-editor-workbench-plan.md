---
title: "Apply the shared visual language across the editor workbench and controls"
type: feature
ticket: 23
created: 2026-11-17
status: in-progress
baseline_revision: 9b0e39e341ccb76740e04f53294b866f7a63bb63
route: full
route_source: pinned
risk: medium
review: thorough
review_source: pinned
lenses_ran: []
review_loop_iteration: 0
context:
  - "{project-root}/docs/guardrails.md"
  - "{project-root}/docs/design/editor-design-language.md"
  - "{project-root}/docs/design/editor-design-validation.md"
---

<frozen-after-approval reason="owner-delegated implementation choices; continue without routine prompts">

## Intent

**Problem:** The validated common language is not consistently applied to the actual workbench. Existing narrow chrome overlaps, read-only fields resemble disabled controls, program side panels squeeze code, and native theme bridges contain a misspelling.

**Approach:** Extend the existing semantic styles once, migrate current surfaces and prove the actual shipping appearance and authoring behavior in the browser and real VS Code workbench. Deliver common presentation, not specialized editor redesigns.

## Boundaries & Constraints

**Always:** Preserve document identity, active-view targeting, commands, undo/save, platform-services, native host chrome/colors, authored pixels, author-selected code typography/colors, CSP and framework decisions. Use semantic/native controls, relative type sizing, readable paired roles, neutral art stages, real host/fixture/version/revision fingerprints and paced serial host operations. Every migration family is delivered or names an existing real owner.

**Never:** Candidate overlays as shipped proof; fake providers, focus machinery or save outcomes; runtime/format/dependency/docking changes; reopen #2703 or replace PR #2950; add the specialized 29/30 hierarchy, missing item/enemy providers or Git. Do not call the browser editor an installed PWA or VS Code Web a desktop application.

## I/O & Edge-Case Matrix

| Scenario | Input / state | Expected behavior | Failure handling |
| --- | --- | --- | --- |
| Host/theme | Standalone light/dark/forced colors; actual VS Code themes | Common roles remain readable; host colors/chrome win; artwork/code preferences survive | Record actual measured failures, never a green CSS echo |
| Space | Normal/640px pane, long identity, enlarged text | Controls wrap/relocate without overlap; code and document remain usable; named shelves reopen | Fix discovered layout failures without dropping commands |
| Controls | Selected plus keyboard focus; disabled/read-only/invalid | Distinct outline/state words/native semantics; enabled read-only values readable | Existing handlers/model retain authority |
| Authoring | Browse/theme/layout; edit/undo/save; different Files selection | Presentation changes do not dirty content; edits and commands affect the active captured document | Preserve draft/bytes on real refusal and allow existing recovery |
| Project opening | Native GAM read pending or rejected | Truthful pending status; competing open actions disabled; controls recover | Existing open error remains visible, no guessed project |

</frozen-after-approval>

## Code Map

- `packages/editor-ui/src/tileset-art.css` owns `--tkr-*` roles, host bridges and art stages. Fix `quickInput.background`; retain one family, not a second theme system.
- `tileset-browser.css` owns common controls/shell/views. Absolute topbar/status layering and reserved search margins cause #3028; replace with ordinary responsive flow while retaining one shared Save/Run surface. Its disabled selector wrongly includes enabled `[readonly]` (#3027).
- `program-view.css` owns program chrome; fixed 14/18rem side panels and literal light colors cause #3032. Wrap/stack optional panels; leave Monaco/native text and author preferences alone.
- `tools/browser/editor-web/main.tsx` owns real browser opening chrome (#3031); existing host APIs/models do not need a parallel loading controller.
- `tools/editor-design/gallery.mjs`, `palette.mjs`, `states.mjs` already supply actual fixture/OPFS/browser capture, contrast and native-state proof. Add explicit SHIPPING evidence without enabling candidate CSS; preserve 11.22's archival record.
- `tools/editor-vscode-test/run.mjs`, `web-proof.ts`, `probe-extension/extension.js`, `lifecycle.ts` provide actual VS Code Web launch/file opening/frames and owned cleanup. Add theme/capture/version hooks, not another host. No shipped desktop editor or editor PWA installation path was found; the existing PWA is the player.

## Tasks & Acceptance

**Execution:**
- [ ] `tools/editor-design/{gallery.mjs,vscode-proof.ts}` plus existing VS Code runner/probe — capture before styles change; add explicit shipping mode, actual host theme/version and durable frame/fixture/input metadata. Never certify candidate overlays.
- [ ] `packages/editor-ui/src/tileset-art.css` — shared branded fallback roles with native host bridges, neutral stages, type/spacing and forced-color tokens; fix #3017.
- [ ] `packages/editor-ui/src/tileset-browser.css` — migrate common workbench/navigation/forms/lists/status/feedback/toolbar/shelves and target scaling, focus/read-only/disabled states; fix #3027/#3028 without changing handlers.
- [ ] `packages/editor-ui/src/program-view.css` — common program chrome and usable narrow optional panels; fix #3032, preserve code preferences and native VS Code text ownership.
- [ ] `tools/browser/editor-web/main.tsx` and `tools/browser/tests/editor-web-host.spec.ts` — real pending-opening feedback/control recovery (#3031), with a meaningful native-read regression rather than styling-source assertions.
- [ ] `docs/design/editor-style-delivery.md` — actual before/after evidence, measured roles/scaling/keyboard/ownership and complete inventory handoff to 29.1/30.1; name unavailable providers and existing #2698 explicitly.

**Acceptance Criteria:**
- Given the shipped editor, when checking every current family in both hosts/themes, then actual captures and computed roles prove consistent common styling with explicit native/standalone ownership.
- Given real keyboard and document operations, when testing narrow/scaled layouts and pending/error states, then controls remain reachable and identity/undo/save/targeting still work without layout/theme edits dirtying data.
- Given the migration inventory, when consuming the delivered styles in 29.1/30.1, then no second palette/component authority or hidden omitted surface is needed.

## Implementation Notes

## Plan Change Log

- 2026-11-17: Approved recommended choices under the owner's standing instruction to make implementation decisions, test locally, and continue to gated merge. Baseline is the merged 11.22 closure. Large disjoint implementation slices may run in parallel under the session's higher-priority engineering policy; all real-host operations remain serial. No production styling changes precede both hosts' before capture.

- 2026-11-17: Refined the capture gate to isolate evidence from concurrent implementation: commit only capture tooling, then collect BEFORE in a separate worktree whose production CSS/browser entry hashes match baseline `9b0e39e341ccb76740e04f53294b866f7a63bb63`. Product edits may proceed in the implementation worktree; no build or product edit occurs in the BEFORE checkout during its serial host runs. AFTER uses the finished implementation. This replaces the initial same-checkout ordering above without changing the frozen behavioral contract.

## Review Triage Log

## Design Notes

Use existing CSS/native layout, not a new component framework. A natural wrapping header/status row is preferable to absolute overlays; subordinate program panels may stack while retaining their existing toggles. Native VS Code settings remain native. Actual VS Code Web is real-host evidence, not desktop simulation; installed-PWA/desktop claims require their own real runtime and are not invented here.

## Verification

- Opt-in browser shipping gallery and actual VS Code before/after capture, serially: all supplied families, normal/measured640, supported themes, actual keyboard and representative enlarged-text/long-name cases. Inspect images; verify source/fixture fingerprints and fail on measured contrast/layout defects.
- Focused existing `program-view`/`settings-view` and browser host/lifecycle/program/artwork/board/animation regressions; new native pending-read case in isolation with reported duration. New ordinary unit cases, if needed, must each stay below one second.
- Run affected TypeScript checks, scoped ESLint, provenance and canonical stock/store checks after integration. No mid-flight worker checks. Preserve/inspect actual error diagnostics; record any unexpected failure as a bug.
- Independently review final source and evidence with pinned thorough workflow; fix/recheck before publishing. Merge only exact reviewed-head green gates, reconcile metadata and clean/preserve each worktree. No engine/golden changes are expected.
