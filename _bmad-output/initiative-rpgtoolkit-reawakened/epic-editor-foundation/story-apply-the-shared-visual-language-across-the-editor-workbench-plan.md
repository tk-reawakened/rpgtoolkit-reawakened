---
title: "Apply the shared visual language across the editor workbench and controls"
type: feature
ticket: 23
created: 2026-11-17
status: in-review
baseline_revision: 4ff4ed3dee07c66119867f5a859a797797a4b798
route: full
route_source: pinned
risk: medium
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
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
- [x] `tools/editor-design/gallery.mjs`, `states.mjs` and `tools/editor-vscode-test/design-proof.ts` plus existing VS Code runner/probe — collect unchanged-product BEFORE from an isolated capture-tooling commit; add explicit shipping mode, actual host theme/version and durable frame/fixture/input metadata. Never certify candidate overlays.
- [x] `packages/editor-ui/src/tileset-art.css` — shared branded fallback roles with native host bridges, neutral stages, type/spacing and forced-color tokens; fix #3017.
- [x] `packages/editor-ui/src/tileset-browser.css` — migrate common workbench/navigation/forms/lists/status/feedback/toolbar/shelves and target scaling, focus/read-only/disabled states; fix #3027/#3028 without changing handlers.
- [x] `packages/editor-ui/src/program-view.css` — common program chrome and usable narrow optional panels; fix #3032, preserve code preferences and native VS Code text ownership.
- [x] `tools/browser/editor-web/{main.tsx,index.html}` and `tools/browser/tests/editor-web-host.spec.ts` — real pending-opening feedback/control recovery (#3031), with a meaningful native-read regression rather than styling-source assertions.
- [x] `docs/design/editor-style-delivery.md` — actual before/after evidence, measured roles/scaling/keyboard/ownership and complete inventory handoff to 29.1/30.1; name unavailable providers and existing #2698 explicitly.

**Acceptance Criteria:**
- Given the shipped editor, when checking every current family in both hosts/themes, then actual captures and computed roles prove consistent common styling with explicit native/standalone ownership.
- Given real keyboard and document operations, when testing narrow/scaled layouts and pending/error states, then controls remain reachable and identity/undo/save/targeting still work without layout/theme edits dirtying data.
- Given the migration inventory, when consuming the delivered styles in 29.1/30.1, then no second palette/component authority or hidden omitted surface is needed.

## Implementation Notes

- Final comparison is [448 retained actual-host PNGs and ten full portable receipts](../../../docs/design/captures/editor-style/2026-11-17/index.json): each phase has 107 browser surface/return frames, 36 browser landing/read-only/I/O-state frames across three themes and 81 actual VS Code Web frames. BEFORE records 3,728 / 631 / 2,936 measured violations; AFTER records zero in every mode. All applicable backing-byte/dirty-state invariants pass; native source/build bytes stay unchanged and all 26 fixture receipts are preserved.
- Capture-only BEFORE `1d0b666818fadea23a06d9f8648c459f0a40c032` matches six pinned-main `4ff4ed3dee07c66119867f5a859a797797a4b798` production browser inputs and native CSS. AFTER is `a6f545712a8f44a6f4e57d22537b5d966ce53b76`; both phases use identical capture algorithms. Referenced host/UI outputs were rebuilt from source before bundling. Initial captures exposed stale `dist` (#3107) and are historical, not accepted comparison evidence.
- Actual host: Node 24.21.0 / Chromium 156.0.8078.4 / VS Code 1.148.0-insider, pinned to workbench commit `863bc0ba9e89df07ecf700ce40f2fa35b2a3b123` in both phases. Native themes, normal/640px panes, separate opened board properties, the composed character provider and representative 200% root text are real-host observations, not a desktop/PWA simulation. Board cases await actual preview settlement (#3117); known decoder defect #2698 remains visibly reported.
- Local browser functional coverage passed 40/40 with one worker, including retained P0 board objects, save/undo/reopen/refusal/recovery/launch/targeting and Monaco CSP positive/negative cases. The actual native board-object route separately passed definition visits, native confirmation and saved-record checks. Existing program/settings/form/Preferences coverage passed 85/85; all ordinary cases were under one second. Removed the CSS-source-spelling test (#3092), not re-pinned it.
- The real pending-opening case holds a native read, causes actual removed-entry refusal, preserves choice, restores the file, retries to the real form and independently compares backing bytes. [Both opening counterfactuals](../../../docs/design/captures/editor-style/2026-11-17/opening-regression-negative.json) fail when disabling or pending feedback is removed; exact restored source passes.
- [Paint counterfactuals with 17 retained PNGs](../../../docs/design/captures/editor-style/2026-11-17/paint-guard-negatives.json) reject removed browser/native focus, hidden selected-label glyphs at 1:1, unbacked board warnings at 1.23:1 and white-on-white help. The first removed-label-outline experiment exposed false-green width/color-only focus (#3120); both guards now reject unpainted styles. Final AFTER follows exact CSS restoration.
- The real light-theme New board validation screenshot exposes the pre-existing browser validity bubble overlapping the inline error; this is disclosed and tracked as #3146, not treated as a passing non-overlap assertion.
- The native helper is included in its dedicated strict TypeScript project (#3116); final typechecks, scoped lint, core dependency and provenance checks pass. The ticket store validates 551 tracker IDs and 440 plans. Independent verification-gap and intent rereviews of final code `a6f5457` found no remaining concrete findings; their review was read-only. PR gates remain separate.

## Plan Change Log

- 2026-11-17: Approved recommended choices under the owner's standing instruction to make implementation decisions, test locally, and continue to gated merge. Baseline is the merged 11.22 closure. Large disjoint implementation slices may run in parallel under the session's higher-priority engineering policy; all real-host operations remain serial. No production styling changes precede both hosts' before capture.

- 2026-11-17: Refined the capture gate to isolate evidence from concurrent implementation: commit only capture tooling, then collect BEFORE in a separate worktree whose production CSS/browser entry hashes match baseline `9b0e39e341ccb76740e04f53294b866f7a63bb63`. Product edits may proceed in the implementation worktree; no build or product edit occurs in the BEFORE checkout during its serial host runs. AFTER uses the finished implementation. This replaces the initial same-checkout ordering above without changing the frozen behavioral contract.

## Review Triage Log

All four pinned lenses completed before triage. Each finding was judged separately before grouping; descriptive intent differences are not silently converted into defects.

| Finding | Verdict / route | Evidence and disposition |
| --- | --- | --- |
| BH1: no durable CI rendered-style replacement | medium / patch | The opt-in gallery is automated but neither CI nor the foundation suite invokes it; the suite does run the real program test. Add rendered state assertions there, not CSS spelling. #3122. |
| BH2: pressed controls omit required state marker | medium / patch | `gallery.mjs:203–204,254` records pressed selection but requires a marker only for `aria-selected`; a real program toggle supplies the reachable case. #3123. |
| BH3: state appearance omitted from result | medium / patch | `states.mjs:9–15` captures the nine real I/O states without paint/layout measurements; `gallery.mjs:1114` aggregates only `captures`. Add state-time measurements and aggregate their failures. #3124. |
| BH4: pending opening has no retained frame | false | `states.mjs:39–59` holds the actual native GAM read and retains `state-loading-project.png`; the accepted states receipt already contains it. Missing state measurement is BH3, not a missing screenshot. |
| BH5: limited helper sampling overclaims all text | false | `gallery.mjs:264` already includes all visible `label` elements in its selector, and delivery text explicitly calls computed/raster samples regression guards, not complete certification. The result is zero **measured** violations, not an all-text certificate. Clarify exact sample scope when documenting the new state measurements. |
| BH6: landing/enlarged state theme only dark | medium / patch | `captureShippingLanding` and readonly capture hardcode dark, and the CLI rejects `--theme` with states-only. Exercise the existing theme option for all supported actual browser modes. #3125. |
| BH7: opening receipt lacks appearance/source provenance | low / patch | Its limits explicitly say functional guards, not styling; a real pending PNG exists separately, disproving the screenshot subclaim. The implementation/mutation hashes do omit an explicit implementation path; add it without changing results. #3128. |
| BH8: landing family omitted from inventory table | low / patch | Opening is described in layout prose, but the declared complete family table lacks its explicit browser/native ownership row. Direct documentation correction. #3126. |
| BH9: functional results lack reproduction commands | low / patch | The delivery recipe reproduces galleries but not the reported 40/85 cases and native board-object proof. Add the exact executed commands and environment. #3127. |
| BH10: plain program font remains fixed 14px | false | This is the code-content fallback, not supporting UI chrome. The frozen contract and delivery distinguish preserved code typography from relative common controls; the change intentionally does not recolor/resize authored code preferences. |
| VG1: pressed-state styling lacks assertion | medium / patch | Pre-verified independent gap evidence identifies the same reachable program toggle and omitted predicate as BH2. Preserve the requirement and prove actual pressed/unpressed paint differs without borrowing focus. #3123. |
| IA1: shared CSS versus native workbench chrome | false | The frozen host boundary preserves native chrome; shared custom-editor presentation, not native workbench redesign, is the intended surface. |
| IA2: native program capture does not prove shared Monaco panels | false | The native record explicitly identifies native text ownership; actual browser program captures exercise the changed shared supporting panels. No claim transfers one proof to the other. |
| IA3: VS Code Web is not installed desktop proof | false | Both frozen constraints and delivery expressly forbid that claim; real VS Code Web is the recorded native extension host, with no desktop/PWA evidence invented. |
| IA4: native Settings remain native | false | This is the specified ownership boundary, not an omitted common custom form. |
| Rereview 1: selection guard accepts focus as persistent paint | medium / patch | Browser `indicatorRatio` included outline; actual focused Bookmarks retained 11.36:1 focus while neutralized selection paint was invisible. Compare persistent selected/neutral paint without counting focus. #3134. |
| Rereview 2: native host records selection without asserting paint | medium / patch | Native board captured `Tiles (1)` as selected but originally checked only generic boundary. Actual selected-paint removal now fails that native case while independent Vectors focus remains 3.60:1. #3135. |
| Rereview 3: validation dialog excluded from layout | medium / patch | Default layout selector excludes all dialogs, including New board. Dedicated actual dialog mode now measures its 22 real controls and scroll reachability. #3136. |
| Rereview 4: per-theme state runs can overwrite each other | low / patch | `--states-only --theme` runs one theme per output directory by design; document three distinct destinations so all evidence survives. #3125. |
| Rereview 5: shelf test did not measure marker contrast | medium / patch | Nontransparent positive-height paint can blend into its backing. Real creator regression now checks marker-to-adjacent-surface contrast as well as visibility. #3133. |
| Rereview 6: New board errors lacked semantic danger treatment | low / patch | Actual validation error used ordinary ink. Reuse existing semantic error foreground/surface/border and preserve role=alert/native validation. #3137. |
| Selection-counterfactual follow-up: comparator false green | medium / patch | Initial signatures included nonpaint geometry/hidden pseudo-elements. Both real hosts incorrectly passed with selected paint removed; paint-only signatures make that same perturbation fail. #3138. |
| Rereview 7: selected cue contrast can come from unrelated paint | medium / patch | The comparator can observe a negligible or zero-width selected change while an unchanged generic border supplies the 3:1 ratio. Bind selected-state contrast to the changed, actually drawn cue itself; verify with a near-invisible cue counterfactual. #3139. |
| Native proof violates style CSP while sampling selection | medium / patch | The first neutralization helper set an inline transition style, violating the real VS Code Web policy. Compare without inline styles and fail the native proof on observed style-CSP violations. #3140. |
| Matched native captures use different auto-downloaded workbench versions | medium / patch | The previous before/after run used 1.147 and 1.148 insiders. Pin both design runs to the same VS Code Web commit and verify the recorded host versions before treating the comparison as matched. #3141. |
| Native proof can use stale built CSS | medium / patch | A source perturbation failed in Chromium but falsely passed in native because the extension's copied CSS had not been rebuilt. Require byte equality for each copied shared stylesheet before native capture, then rebuild before the counterfactual and restored positive. #3142. |
| Neutral clone drops focus and hover | medium / patch | Both independent rereviews identified that a hidden neutral clone cannot retain the original's `:focus-visible`/`:hover`; transient paint could masquerade as selection. Compare and restore the actual control synchronously, settling transitions without inline styles. #3143. |
| Subpixel selected cue can satisfy contrast alone | medium / patch | Independent rereview found that positive computed size accepted a practically invisible marker. Require at least one CSS pixel of thickness and pseudo-element width and height before counting it as a selected cue; exercise subpixel-only negative and restored positive in real hosts. #3144. |
| Forced-colors same-element comparison reuses cached selected fill | medium / patch | The real browser matrix failed selected controls despite the system Highlight paint. Diagnostic samples showed neutral CSS was black while the compositing cache still returned the prior selected fill. Invalidate that element's cached layer before neutral sampling and after restoring selection. #3145. |

Grouping after individual verdicts: BH2/VG1 share #3123. All other surviving corrections retain their own tracked defect; BH4/BH5/BH10 and IA1–IA4 are refuted above. The edge-case lens returned no findings. No intent or frozen-plan loopback is required.

## Design Notes

Use existing CSS/native layout, not a new component framework. A natural wrapping header/status row is preferable to absolute overlays; subordinate program panels may stack while retaining their existing toggles. Native VS Code settings remain native. Actual VS Code Web is real-host evidence, not desktop simulation; installed-PWA/desktop claims require their own real runtime and are not invented here.

## Verification

- Opt-in browser shipping gallery and actual VS Code before/after capture, serially: all supplied families, normal/measured640, supported themes, actual keyboard and representative enlarged-text/long-name cases. Inspect images; verify source/fixture fingerprints and fail on measured contrast/layout defects.
- Focused existing `program-view`/`settings-view` and browser host/lifecycle/program/artwork/board/animation regressions; new native pending-read case in isolation with reported duration. New ordinary unit cases, if needed, must each stay below one second.
- Run affected TypeScript checks, scoped ESLint, provenance and canonical stock/store checks after integration. No mid-flight worker checks. Preserve/inspect actual error diagnostics; record any unexpected failure as a bug.
- Independently review final source and evidence with pinned thorough workflow; fix/recheck before publishing. Merge only exact reviewed-head green gates, reconcile metadata and clean/preserve each worktree. No engine/golden changes are expected.
- CI attempt 2 exposed #3152: the filesystem event test's isolated VS Code fake lacked the theme/configuration APIs newly read on probe activation. Extend that fake without changing its created/changed and persisted-byte assertions. The complete 13-test proof prerequisite passed locally (zero skips; affected case 12 ms). The exact macOS desktop lane also passed locally, including all five launch cases, input, authored board, and inventory; the original remote macOS job had no assigned runner (#3149).
