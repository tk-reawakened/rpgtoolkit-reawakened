---
type: feature
title: "Art library reuse evidence decision"
ticket: 2
status: in-review
risk: high
created: 2026-11-14
baseline_revision: e379d86a8d6794030b78f619ffbb827a73f92477
route: full
route_source: auto
review: thorough
review_source: auto
review_loop_iteration: 1
lenses_ran: ["model-boundary", "interaction-host"]
review_base_revision: 750b5eadf61dc85aabd4208965c5d4325f13a39c
review_head_revision: a46ef9e9c6d42bd4fd7fad0abac65eb7b5008d03
---

<frozen-after-approval reason="existing owner-approved direction and story admission gate; not approval of the implementation below">

## Intent

Choose reusable components for our owned editor using the published research, not a new whole-application selection. Verify pinned licence/provenance and transitives, full T-36 coverage, browser-led interaction, keyboard access, offline hosts and shared document/history integration before admission.

## Scope and acceptance

Document evidence and rejected alternatives; no component is selected in advance, no GPL/MPL dependency or legacy source. A rejected candidate is not admitted; rejection does not prohibit other qualifying libraries or permissively licensed code within our own editor.

## Verification

A person reviews reproducible component/adaptation evidence, working host integration, coverage gaps and ownership boundaries, and approves admitted components or specific in-house implementations. No qualifying component is assumed selected; do not reopen the owned-editor decision.

## Dependencies and decisions

Prerequisites: 11.1. Apply the epic Notes, format specs, AD-18/19/20/22/29 and connected-authoring direction; T-36 maps to CAP-16. Preserve version and residue, use the existing shared model and browser, and route host access through platform-services. Where provider or host capability is unavailable, preserve data and report the limitation; do not simulate it.

A person-reviewed evidence decision is REQUIRED before production art-library admission. Exact-version installs in throwaway directories are permitted only to produce reproducible research evidence; they do not admit a dependency to this product.

Owner decision (2026-11-13), recorded in [ADR 0031](../../../docs/adr/0031-owned-art-editor-with-permissive-reuse.md): build our own integrated art editor, with suitable libraries, copied/adapted permissively licensed code and selective forks permitted. This approves the product direction, not a particular component, production install or completed 13.2 acceptance. Keep the working host-integration, licence/provenance, keyboard/offline and complete T-36 coverage/ownership matrix evidence. T-36 implementation belongs to 13.3, not the 13.2 exit gate. No new artwork format or expanded feature scope is approved by this decision.

</frozen-after-approval>

## Evidence outcome (2026-11-14)

Fresh isolated evaluation is recorded in [story-13.2-candidate-evidence.md](../../../docs/findings/pixel-art-platform/story-13.2-candidate-evidence.md). Dotting 2.1.18's React/ReactDOM peers and component-owned history block direct use under ADR 0025, but do not prohibit algorithm adaptation. JollyPixel 7.0.0 is framework-neutral and its published `PixelArtCanvas` accepts an injected `PixelDocument`, disabled local history, event callbacks and external snapshots. The new Chromium probe exercises a real pointer stroke and proves the public staging/reconciliation seam; it does not prove EditorDocument authority. Its callback runs after its mutable buffer changes, so adapter work must translate and reconcile host commands rather than accept local history. The official Jolly docs/demo remained non-interactive/unavailable.

**Recommendation:** keep JollyPixel 7.0.0 as the leading external staging-canvas candidate, not an admitted dependency. Separately, use a small owned legacy-TST implementation to test actual document authority and host integration without first adopting an external canvas. The package probe does not prove that adapter, and the owned experiment does not prove a JollyPixel adapter. The findings record observed host behavior and coverage gaps. A person must review those findings and approve the specific component or in-house implementation before 13.2 closes. External packages, copied/adapted code and assets still require their exact-version licence/provenance/notice review. Keep 13.2 incomplete until its gate is met.

## Code Map

- `packages/editor-model/src/tileset-art-document.ts` and its focused test: reuse `BinaryDocument` and the core regular-TST reader/writer; expose row-major stored-size pixels and one accepted paint command. Preserve file details, unrelated tiles and residue.
- `packages/editor-model/src/kinds.ts`, `index.ts`: register the experimental `.tst` kind alongside the existing main, board, character and item kinds. Preserve the typed command union and generic recovery lifecycle.
- `packages/editor-ui/src/tileset-art-view.tsx`, its CSS and focused test: Preact/native Canvas view with private gesture staging, keyboard access and visible save errors; no second history. `mount.ts` retains board preferences and sprite project-file access.
- `packages/host-web/src/index.ts` and `tools/browser/editor-web/`: use the existing Workbench/Files tree and shared mounted document. An extra view owns no second document lease. Keep newer project-open rollback/race handling.
- `packages/host-vscode/src/extension.ts`, extension manifest/build and `tools/editor-vscode-test/`: use actual custom editors, native working-copy history/save and orderly native reload. Preserve the existing settings, sprite, board and CSP proofs.
- `docs/findings/pixel-art-platform/story-13.2-candidate-evidence.md` and existing isolated probes: keep the full T-36 coverage/ownership matrix, candidate comparison and reproducible provenance separate from owned-host evidence.

## Tasks & Acceptance

**Execution:**

- [x] Produce pinned candidate/provenance evidence and the complete T-36 coverage/ownership matrix without installing a product dependency.
- [x] Implement the reversible regular-TST model/view experiment and real host registration on the existing shared document.
- [x] Reconcile concurrent work at `597d7c3e4f0939229b19775538c2efa13de59c20`; preserve the canonical browser workbench, sprite editors and board tools.
- [x] Verify the integrated revision through configured type checks, model/component regressions and both actual host surfaces. The findings distinguish exercised behavior from the remaining checklist, not a claim to complete T-36 or all of 13.1/13.3.
- [x] Independently review the model/boundary and interaction/host slices, track defects, fix and reverify; publish exact findings and remaining ownership/coverage limits.
- [ ] Obtain person review of the fresh art-host findings before story closure, as published. The owner merged the package-evidence docs in PR #2347; ordinary reversible internal modules require no new product-direction vote.

**Acceptance Criteria:**

- Given any supported regular-TST detail code, when a representable stroke is accepted, then exactly one shared edit changes only its addressed pixels and preserves original encoding/residue; invalid input or an unrepresentable color changes neither bytes nor history.
- Given two mounted views, when a gesture is held, cancelled or committed, then staging stays private and only an accepted edit reaches the other view; host undo/redo controls that accepted edit rather than a canvas-local stack.
- Given the actual browser and packaged VS Code host, when files are opened, saved, externally changed and reopened, then independent saved-byte oracles agree and other documents remain untouched. A real write refusal preserves dirty accepted pixels and reports failure; resolving a conflict follows the host's advertised save behavior.
- Given keyboard-only drawing, view destruction/recreation, native orderly reload and an already-loaded offline host, when the relevant operation runs, then the observed behavior is recorded without claiming cold/crash recovery or disconnected transport from a different scenario.
- Given the complete evidence packet, when a person reviews its gaps and ownership, then only their specific approval admits an implementation. Neither successful probes nor general owned-editor approval closes this story.

## Implementation Notes

- 2026-11-14: checkpoint `d5ecff7428756201df26cea095d8f28919edcc6b` preserves the owned experiment on the pushed `feat/1726-art-host-prototype` branch. This is experimental source, not production admission.
- 2026-11-14: fresh main added sprite editors, a real browser workbench and board tools. Merge `cca45b2571190d1df267ddf254b5bc9328b38b85` preserves those foundations rather than keeping a competing single-document browser demo. Actual-host checks must now cover that integrated revision.
- Final integrated source at `a46ef9e9c6d42bd4fd7fad0abac65eb7b5008d03` passed the production build and configured model/UI/browser/native-harness type checks; 27 focused model/conformance/component cases; all 12 actual-browser settings/sprite/lifecycle/art cases; and both complete packaged VS Code cancel/keep proof paths, including settings, sprite, board, actual artwork, real failure/conflict, orderly recovery and CSP guards. Every ordinary case reported below one second. Actual browser artwork cases reported 2.8 s and 2.2 s; the complete native run reported 115.26 s.
- Perturbations established that removing row/column conversion fails the asymmetric pixel oracle and hiding a save error after conflict clearance fails the visible-error assertion. Both changes were restored and the focused cases passed.
- Source and fix reviews found no demonstrated remaining defects at the pinned revision. The model reviewer confirmed the conformance case, deliberate native recovery choice and stable source selection. The interaction reviewer confirmed the updated preview-commit, mirror ownership and command-routing slice. The two original perturbations and the observed red release-byte assertion independently guard against conversion/error-visibility/unpreviewed-release regressions.
- Native and browser captures show the actual owned pixel view. No prototype dependency, native layered-art schema, borrowed GPL code or third-party art asset was introduced. Cold offline bootstrap and a disconnected VS Code transport are not inferred from already-loaded offline editing; remaining published coverage/ownership is for the story's person review.

## Plan Change Log

- 2026-11-14: expanded the approved evidence story's execution record to distinguish isolated package evidence from the owned host experiment. Keep the existing human-owned direction/admission gate, full T-36 matrix and unimplemented feature boundaries unchanged.

## Review Triage Log

Two independent read-only reviews ran at `cca45b2571190d1df267ddf254b5bc9328b38b85` against fresh main `597d7c3e4f0939229b19775538c2efa13de59c20`: model/boundary and interaction/host. The latter reported no demonstrated defect; that is not an admission verdict. The model review found the new tileset absent from the existing registered-kind lifecycle table. Triage: **medium / patch**, #2629. Added an authored TST case with real accepted/rejected commands; all 21 conformance checks then passed, individually under 4 ms. Subsequent actual-browser checks also caught mirror remount/brush loss and missing host shortcut delegation (#2630, #2632); their fixes are checked on the real surface, not accepted merely because source review was quiet.

## Design Notes

The view uses browser-native canvas, pointer capture, focus and color input rather than rebuilding those platform behaviors. Private staging is not authoritative document state. Regular-TST representation is deliberately exact: refuse unsupported alpha/reserved colors or unavailable palette colors rather than silently convert the author's file. Native metadata-only snapshot delivery must not cancel an otherwise unchanged gesture.

## Verification Commands

- `pnpm build` and the model/UI/browser/native-harness test type checks: preserve the actual configured runtime and all existing kinds.
- Package the host before copying the extension: `node packages/host-vscode/build.mjs && node extensions/editor/build.mjs`. The latter command alone only copies an existing bundle; the native instrumentation correctly rejected a stale bundle when this prerequisite was missed (#2627).
- `node --test packages/editor-model/test/tileset-art-document.test.ts packages/editor-ui/test/tileset-art-view.test.ts`: prove encoding, command boundaries and visible rejected-save behavior; inspect each reported duration.
- Actual Playwright artwork and existing settings/lifecycle cases: real OPFS handles, independent stored-byte checks, strict CSP and real focus/pointer/keyboard interactions.
- `pnpm --dir tools/editor-vscode-test proof -- --extension extensions/editor --workspace <disposable-authored-workspace> --game example.gam`: retain both native recovery choices, existing settings/sprite/board cases, physical write-refusal and artwork assertions. Never run destructive fixture writes against a user's workspace.
