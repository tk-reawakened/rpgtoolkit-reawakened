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
- `tools/browser/editor-web/main.tsx` owns real browser opening chrome (#3031); disable its existing controls through a native fieldset in `index.html`, not a parallel loading controller. Existing host APIs/models retain authority.
- `tools/editor-design/gallery.mjs`, `palette.mjs`, `states.mjs` already supply actual fixture/OPFS/browser capture, contrast and native-state proof. Add explicit SHIPPING evidence without enabling candidate CSS; preserve 11.22's archival record.
- `tools/editor-vscode-test/design-proof.ts` adds the opt-in capture beside `run.mjs`, `web-proof.ts`, `probe-extension/extension.js` and `lifecycle.ts`, which provide actual VS Code Web launch/file opening/frames and owned cleanup. Keep native proof imports package-local (G2.3), not in the separate browser-design namespace. No shipped desktop editor or editor PWA installation path was found; the existing PWA is the player.

## Tasks & Acceptance

**Execution:**
- [ ] `tools/editor-design/gallery.mjs`, `states.mjs` and `tools/editor-vscode-test/design-proof.ts` plus existing VS Code runner/probe — collect unchanged-product BEFORE from an isolated capture-tooling commit; add explicit shipping mode, actual host theme/version and durable frame/fixture/input metadata. Never certify candidate overlays.
- [ ] `packages/editor-ui/src/tileset-art.css` — shared branded fallback roles with native host bridges, neutral stages, type/spacing and forced-color tokens; fix #3017.
- [ ] `packages/editor-ui/src/tileset-browser.css` — migrate common workbench/navigation/forms/lists/status/feedback/toolbar/shelves and target scaling, focus/read-only/disabled states; fix #3027/#3028 without changing handlers.
- [ ] `packages/editor-ui/src/program-view.css` — common program chrome and usable narrow optional panels; fix #3032, preserve code preferences and native VS Code text ownership.
- [x] `tools/browser/editor-web/{main.tsx,index.html}` and `tools/browser/tests/editor-web-host.spec.ts` — real pending-opening feedback/control recovery (#3031), with a meaningful native-read regression rather than styling-source assertions.
- [ ] `docs/design/editor-style-delivery.md` — actual before/after evidence, measured roles/scaling/keyboard/ownership and complete inventory handoff to 29.1/30.1; name unavailable providers and existing #2698 explicitly.

**Acceptance Criteria:**
- Given the shipped editor, when checking every current family in both hosts/themes, then actual captures and computed roles prove consistent common styling with explicit native/standalone ownership.
- Given real keyboard and document operations, when testing narrow/scaled layouts and pending/error states, then controls remain reachable and identity/undo/save/targeting still work without layout/theme edits dirtying data.
- Given the migration inventory, when consuming the delivered styles in 29.1/30.1, then no second palette/component authority or hidden omitted surface is needed.

## Implementation Notes

- Actual browser BEFORE: Node 24.21.0 / Chromium 156.0.8078.4, isolated capture-only revision `d29a33c0345ebe3d1d2576366d040802fd571ca6`, 93 surface/probe frames in 45.15s. The command finished non-green with measured old-style violations, not a runtime failure. All seeded OPFS bytes matched their fixtures before/after and no unsaved document status remained. Five production CSS/browser entry hashes were separately verified identical to baseline `9b0e39e341ccb76740e04f53294b866f7a63bb63`.
- The initial capture-only run at `35a2a5d54bc403382b5eab33a1d941d20390ab0e` failed with the missing output binding (#3048); no frames were claimed from it. The subsequent complete receipt is retained. Source review also filed #3044/#3045 and native-proof defects #3050–#3053; repairs precede their corresponding actual runs.
- Program container queries parse in the actual esbuild CSS parser with zero warnings. The edit tool's older CSS grammar warned about valid modern syntax; no runtime/platform restriction was bypassed.
- Local pending-opening regression passed 1/1 in real Chromium (1.2s test, 4.6s runner): actual held native read, disabled competing controls, real removed-entry read failure, preserved choice, restored-file retry to the real form, independent unchanged backing-byte check. This is a browser integration case, not an ordinary unit test. The first over-anchored CLI grep selected no tests and is not counted as verification.
- Local existing browser coverage passed 39/39 with one worker in 87.07s: host/lifecycle/program/artwork/board properties/canvas/animation/tile-bitmap behavior, actual save/undo/recovery/launch/targeting and Monaco CSP positive/negative scenarios. This is functional regression proof, not a final visual or native-host claim.
- The new opening case failed both real counterfactuals: leaving the fieldset enabled failed its disabled-control assertion; removing pending status failed its opening-label assertion. Exact source hashes and observed failures are retained in `docs/design/captures/editor-style/2026-11-17/opening-regression-negative.json`. Restoring the exact source then passed 1/1 (1.3s case, 4.7s runner).
- The first focused actual native run exposed missing page navigation (#3059); the runner now uses the established workbench bootstrap and retains a failure PNG outside cleanup. The next local run reached the actual VS Code workbench and exposed native picker-label/setting-ID mismatch. No incomplete native matrix is claimed as acceptance.
- Corrected-probe browser BEFORE completed 107 actual surface/return frames in 54.96s at capture-only `8b4d904a618d9ae5af7110a083011b9880e68c25`: real Preferences and command palette included, seeded bytes preserved, no final dirty status, five production entry/CSS hashes still identical to baseline. Its non-green result records existing style/layout failures. Native-I/O state/landing/read-only proof remains a separate required run.
- Actual VS Code Web BEFORE completed all 73/73 retained, SHA-256-verified frames in 61.61s at `86d736051363c095d4c1528d4bba5f49e10ac4c4`: nine real resource cases including the byte-identical long-path program alias, normal/640px panes, four native themes and restored 200% root text. VS Code 1.147.0-insider / Chromium 156.0.8078.4 / Node 24.21.0; 26 fixture receipts plus source/build hashes unchanged. Its 1,989 measured old-style violations are a completed BEFORE result, not a green migration.
- Scoped ESLint and affected `editor-ui`/browser TypeScript checks passed locally in 3.28s after moving the native helper/imports package-locally (#3083). Subsequent native selector/fixture edits receive their own final scoped check; this does not claim a final-head all-gate pass.
- Focused narrow dark checks passed 21 actual frames, including the bounded Preferences panel (#3086). Removing the competing selected-state outline restored a 21:1 forced-colors program focus indicator (#3087), but subsequent image inspection found UA text backplates hiding selected labels despite computed colors passing (#3094). Preserve the user's system selection pair without backplates; the new actual screenshot-text guard fails the bad state at 1:1 while the outline still measures 21:1. A final complete matrix is required.
- Existing model/DOM behavior coverage passed 85/85 across program, settings, game-settings form and Preferences in 4.74s; every case was below one second. Removed the obsolete CSS-source-spelling test (#3092), rather than re-pinning the accent implementation. Actual rendered native/browser evidence owns appearance verification.
- The complete local AFTER matrix exposed doubled-text header shrinkage (#3095), clipped native-file-input geometry in the reachability probe (#3096), unpainted closed-disclosure controls being sampled (#3097), a partial character-provider root (#3098), residual native focus (#3099), and duplicate icon/help rules using action fill as focus ink (#3100). Repairs retain the assertions rather than lowering thresholds. Actual opened board properties are now a separate native case; the complete native matrix contains 81 frames.
- Local architecture, provenance and canonical store checks passed: two allowed core dependencies, 1,692 files scanned with zero provenance violations, and 551 tracker IDs / 440 plans / 35 folders validated. Scoped lint and affected TypeScript checks also passed after the initial measurement repairs; final capture additions receive their own check.

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
