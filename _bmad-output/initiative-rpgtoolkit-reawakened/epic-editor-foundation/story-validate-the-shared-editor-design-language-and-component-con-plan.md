---
title: "Validate the shared editor design language and component contracts"
type: feature
ticket: 22
created: 2026-11-17
status: done
baseline_revision: 399ad2bcde28d63a8d707d7043154bfbb21d4cfc
route: full
route_source: auto
risk: medium
review: thorough
review_source: auto
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 2
context:
  - "{project-root}/docs/guardrails.md"
  - "{project-root}/docs/design/editor-design-language.md"
  - "{project-root}/docs/design/board-authoring.md"
---

<frozen-after-approval reason="human-owned intent — standing authorization to choose and continue">

## Intent

**Problem:** The accepted common direction lacks measured real-content examples and a concrete migration handoff; website swatches and historical mockups are not validated layouts.

**Approach:** Validate the existing language with an actual-editor engineering gallery, candidate semantic styles and measured contrast; publish contracts and migration inventory for 11.23.

## Boundaries & Constraints

**Always:** Real host-web/editor-ui models and documented/authored fixtures; native controls, #2703 tokens, PR #2950 commands/Save, document authority and platform-services. Trace accepted decisions; distinguish validated candidates from shipped styles. Record revision/fingerprint, fixture, host/version, viewport, measured pane and theme. Pace browser operations; clean owned resources.

**Never:** Product dashboard, fake provider/control/state, CSS-echo tests, production restyle, framework/dock/library/format/runtime change, or enlarged 11.13 scope. Use the existing item view; unfinished item/enemy authoring stays #1722/#1734. Specialized 29/30 layouts remain separate.

## I/O & Edge-Case Matrix

| Scenario | Input / state | Expected output / behavior | Error handling |
| --- | --- | --- | --- |
| Real content | Sparse/populated board, character, current item, artwork, animation, program and game settings | Annotated actual-view captures and reusable-boundary inventory | Missing content/provider is named, never replaced with a fake outcome |
| Theme / pane | Light, dark, forced high contrast; normal and measured 640px document panes | Recorded real dimensions, focus/selection and readable semantic pairs | A failed measurement is explicit and tracked, not a green label |
| Document states | Actual empty/loading, dirty/saving/failed/read-only transitions | Explain next action and data owner without color-only state | No synthesized successful save or styled fake document state |
| Broken candidate / launch | Unreadable pair, failed build/host/fixture | Nonzero command and diagnostic evidence | Close only owned browser/server; preserve source fixtures |

</frozen-after-approval>

## Code Map

- Execution checkout: dedicated `feat/2987-editor-design-contracts` ticket worktree. Resolve all listed source paths there, not the session's parent checkout.
- `docs/design/{editor-design-language,board-authoring}.md` — accepted common/specialized boundaries; Epics #2968/#2985 retain future workflows.
- `packages/editor-ui/src/{tileset-art,tileset-browser,program-view}.css` — tokens, shared controls/shell/views, separate unthemed program chrome; do not edit shipping CSS here.
- `tools/browser/editor-web/{index.html,main.tsx,page.ts}` and `tools/browser/{build,serve}.mjs` — actual workbench/server. Existing editor browser specs supply OPFS seed, visible opening/creation and screenshot patterns.
- `packages/host-web/src/{index,workbench}.ts`, `editor-ui/src/mount.ts`, `editor-model/src/kinds.ts` — real view dispatch and measurable `.tkr-editor-pane`; no enemy provider.
- `docs/spec/examples/{game,versions}/` — small authored inputs. Delivered 11.4/#1702 preserves identity/visits/copy-in; ADR 0028 docking remains separate. Use scoped 11.22; no active-initiative configuration change.

## Tasks & Acceptance

**Execution:**
- [x] `tools/editor-design/palette.mjs` — isolated candidate palettes/prototype CSS and WCAG role math; no production imports.
- [x] `tools/editor-design/gallery.mjs` — opt-in serial real-workbench capture CLI, existing build/server/OPFS patterns, cleanup and source-fixture preservation; not added to ordinary CI browser workload.
- [x] `package.json` — expose `editor:design-gallery`; no dependency change.
- [x] `docs/design/editor-design-language.md` — authority trace, measured type/spacing/tokens/states, host mapping, placement/scope/actions/active-target contract.
- [x] `docs/design/editor-design-validation.md` plus captures — annotated examples, contrast/provenance and concrete 11.23 migration boundaries; explicit gaps/owners.

**Acceptance Criteria:**
- Given each current surface family, when capturing normal/640px panes in three themes, then actual content and annotations distinguish current UI, candidate presentation and future work.
- Given keyboard use and actual document-state transitions, when inspecting examples, then selection/focus, labels, ownership and truthful persistence states are identifiable without color alone.
- Given rendered candidate pairs, when measuring contrast, then normal text reaches 4.5:1 and control/focus boundaries 3:1; an unreadable candidate fails the command.
- Given the handoff, when building 11.23, then every current shared surface has a source/component owner and native VS Code mapping, without new authority or 29/30 dependencies.

## Implementation Notes

- Standing authorization remains unattended implementation, local verification and gated PR merge; no routine owner prompt.
- Initial source/capture baseline is `399ad2bcde28d63a8d707d7043154bfbb21d4cfc`. Fast-forwarded to gated main `5ce9dbbda611d35f8c376ecdc1052837c028b11e` after #3016; that also brings concurrent board-properties delivery. Preserve the frozen baseline and record final capture revision plus built-input hashes.
- The gallery keeps real fixture bytes in isolated OPFS. Sparse examples use existing format readers/writers (minimal settings, one-cell board, cleared sprite graphics references, one uniform tile, empty program) and the authored minimal chest animation. No missing enemy provider or invented document state.
- First real browser attempt captured settings/board/character/item/tileset at both sizes, then exposed an asynchronous nested-folder race. #3026 records bootstrap defects; navigation now waits for each actual folder and expanded state instead of treating an instantaneous zero count as absence. Final matrix proof remains required.
- Contrast math controls passed black/white 21:1, identical colors 1:1 and rejection of an unreadable palette. Palette calculations are not rendered-control proof; the gallery now samples real computed control/background colors and actual keyboard focus.
- Final pinned-Node 24.21.0 / Chromium 156.0.8078.4 matrix completed locally in 56.88s: 120 actual surface frames plus nine actual native-I/O/history/validation state frames, with measured 640px candidate panes and built-input fingerprints. Source baseline 5ce9dbb; captures include exact working-input hashes, not a false exact-commit claim.
- Actual white-on-white controls failed the rendered guard at 1:1 despite unchanged passing palette math; restored before final proof. Scoped ESLint passed. State subjects are scrolled into view; saving asserts actual “Saving…” and history asserts the preview is in the viewport.
- Existing board descriptor warning #2698 is explicitly annotated. Common migration defects #3017/#3027/#3028 and pending-opening feedback #3031 are handed to 11.23, not hidden by a prototype or counted fixed here.

## Plan Change Log

## Review Triage Log

- Independent source-boundary review at the initial baseline found four P2 defects: missing SpriteView/TileBitmapView ownership (#3022), custom-editor versus contributed-view mapping (#3023), rem units reported as fixed pixels (#3024), and a punctuation-mismatched anchor (#3025). Corrected the inventory, host mapping, exact units and fragment; re-check links and final source ownership before closure.
- Source follow-through distinguishes `SettingsView`/`game-settings-form.tsx` for `.gam` from `PreferencesView` for editor preferences; the new board-properties view is included after the main refresh. No production presentation changes belong to this ticket.

## Verification

- Run on Node 24.21.0; inspect actual captures, measured panes, fixture hashes, themes/focus and states. Break a real candidate pair, observe failure, restore it.
- Check contrast math boundaries with a throwaway script and rendered pairs; scoped ESLint, provenance, canonical store and stock preflight pass. No production/golden changes.
- Independently review against fresh main, resolve tracked defects, then merge only with exact-head required gates. User standing-authorized choices/delivery; no unresolved human-only question.

## Code Review

### 2026-11-17 — independent four-lens review

Code review complete: 0 decision-needed, 4 patch groups, 0 deferred, 3 rejected. Standing owner authorization selects applying every direct patch and continuing delivery. Reviewed packet: seven explicit text files, 924 lines / 83,987 bytes, main baseline `5ce9dbbda611d35f8c376ecdc1052837c028b11e`; captures/manifest inspected separately. GitHub main was still that revision when triaging, so no finding was silently treated as a stale merged fix.

| Finding | Source / verdict | Evidence and route |
| --- | --- | --- |
| B1 — no actual writer failure | blind-hunter / medium | LIVE: old state driver had success/conflict only. Patch #3034: actual exclusive native lock yields `NoModificationAllowedError`, draft/bytes survive, release/retry and separate revert prove recovered storage. |
| B2 — failure after starting persistence unproven | blind-hunter / medium | Same missing native-rejection scenario as B1; retained as a separate finding, grouped under #3034. The scoped real-host run now passes nine states. |
| B3 — new reference workflow proof requested | blind-hunter / false | 11.22 changes no reference/visit implementation and promises contracts plus representative existing views, not reimplementation/reproof of all 11.4 workflows. Actual existing owners and outcomes are now explicit; no fake Choose/Create provider is added to missing surfaces. |
| B4 — pattern ownership and I/O implicit | blind-hunter / medium | LIVE: family inventory alone left native-composition boundaries implicit. Patch #3035 adds concrete existing owners, inputs and outcome responsibilities without inventing a universal widget. |
| B5 — preferences host mapping ambiguous | blind-hunter / low | LIVE: clarified from `createWorkbench.openPreferences`/`mountPreferences` and extension `contributes.configuration`: browser shared dialog versus native Settings for `rpgToolkit.editor.*`, no invented contributed PreferencesView. Patch #3035. |
| B6 — full state/theme cross-product requested | blind-hunter / false | The frozen plan's theme/pane matrix covers surface candidates; state scenarios are separately scoped. The record explicitly says state frames are candidate dark/current opening, not a three-theme state certification. Every surface still has actual forced-colors/light/dark proof; full host migration proof remains 11.23. |
| B7 — failure fingerprints requested | blind-hunter / false | The criterion requires nonzero exit and diagnostic evidence, not a valid capture manifest for failed initialization. Input/build exceptions retain their actual path/stack/stderr; runtime failure.txt includes the failing case and actual accessibility tree plus PNG. A failed run is never promoted to a successful provenance manifest. Additional failure-manifest machinery is not required by this bounded contract. |
| B8 — negative control only in prose | blind-hunter / medium | LIVE: #3037 retains actual saved failure samples, exact mutation/command/runtime and restored palette fingerprint. It explicitly does not invent an uncaptured mutation fingerprint. |
| B9 — sparse annotations incomplete | blind-hunter / low | LIVE: #3035 now explains the real sparse contrast for each generated family and links the empty board, distinguishing empty authored content from missing/invalid resources. |
| B10 — action/cancellation outcomes generic | blind-hunter / medium | LIVE: #3035 adds Open/Choose/Create/Apply/Save/Revert/Cancel outcome and return matrix using existing lifecycle/provider authority. |
| E1 — same-timestamp concurrent run collision | edge-case-hunter / low | Actual pre-fix default directory used timestamp only: #3036 adds UUID uniqueness directly. The reviewer's quoted UUID guard was absent, and its shared-OPFS claim is false because each run owns a separate browser context; only the real output collision was fixed. |

- [x] [Review][Patch] Real native write rejection and recovery (#3034), with scoped nine-state proof and refreshed full matrix.
- [x] [Review][Patch] Composition owners, native preferences, action outcomes and sparse annotations (#3035).
- [x] [Review][Patch] Durable truthful rendered-negative receipt (#3037).
- [x] [Review][Patch] Unique default evidence run identity (#3036).

Verification-gap reviewer reported no gaps. Intent-alignment reviewer found the diff implements real-content validation, isolated semantic styles/contrast and a concrete 11.23 handoff, with explicit browser-only/state-sampling/provider limits rather than false cross-host completion.

### Rejected

- B3 false: no new reference implementation or promised all-workflow reproof in this design-validation ticket.
- B6 false: documented state sampling is not a claim of the full state/theme cross-product.
- B7 false: actual nonzero diagnostics satisfy the criterion; valid successful-capture provenance is not fabricated for initialization failure.

### Post-fix independent pass

- `DesignFixLifecycleReview`: no blockers. Traced actual native exclusive-lock rejection through the host adapter, unchanged prior saved bytes and retained draft, prototype restoration/lock abort, retry and independent revert readback, later conflict/history states, and UUID output/context isolation. Checked final exercised-input fingerprints; no build/test rerun by the reviewer.
- `DesignFixEvidenceReview`: no blockers. Independently compared all nine exercised fingerprints, counts/runtime, truthful negative receipt, native configuration/custom-editor mapping, real sparse frames and explicit 11.23 limitations. No build/test rerun by the reviewer.
- Final local checks: 129 frame files and native-error/restored-negative receipts verified; 44 local links/anchors resolved; scoped ESLint and canonical stock/store preflight pass. Production TypeScript, dependencies, goldens and shipped CSS are unchanged.

## Verified merge and closure

- PR #3039 merged on 2026-11-17 at 11:02:58Z as `fb9238707cfe3579fd7aeab63899416cf3143b32`. CI run `44068438324` passed all 20 jobs, including gate, at reviewed PR head `be188b1e3df73226cbef123480bf1c58a1a67136`; this is not an invented exact-head claim about the merge commit.
- Issue #2987 and its fixed unreleased tooling/document defects closed from that PR; the primary Project is marked done in the current sprint. The canonical store derives this ticket's status from this joined plan, so no duplicate TOML state field is introduced.
- Story 11.23/#2988 is the next dependency. Epic #1357 stays open; this closure does not claim production styling, native/PWA visual delivery, specialized 29/30 work or standalone Git #1829 complete.
