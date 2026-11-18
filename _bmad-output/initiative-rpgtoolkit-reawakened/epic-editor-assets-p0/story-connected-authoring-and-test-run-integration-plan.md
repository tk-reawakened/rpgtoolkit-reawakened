---
type: feature
title: "Connected authoring and test run integration"
ticket: 12
status: done
---

# Connected authoring and test run integration

## Scope

Connect board placements, character definitions, existing item graphics, artwork, programs and run actions using shared visits and explicit save and revision boundaries. Full item behavior editing is delivered later in 29.7.

Use foundation focused visits and pickers for select/create/open with confirmation and return; distinguish local placements from shared definitions and unknown uses, refresh views of one authored document, keep running games revision-fixed, and distinguish preview, board test and normal startup.

## Acceptance and verification

A creator visits a placed item's delivered sprite definition and its board-owned placement program, edits graphics/script through actual providers, returns to the original board selection, saves and runs the chosen board or normal game with the correct revision. Verify local overrides and shared definition identity; full item behavior forms and the family-wide journey are accepted in 29.7/29.6.

Use the shared document lifecycle and preserve same-version unknown data; exercise relevant failure/cancel, keyboard access and save/reopen paths rather than relying on preview alone. Follow `discovery/inception-proposal.md`, `docs/editor-features.md` and G2/G7; do not claim checks passed without executing them.

## Dependencies and decision gate

Prerequisites: 12.3, 12.5, 12.7, 12.8, 12.11, 11.8 and 11.9. Owner sequencing on 2026-11-16 removes the former 12.6 dependency after that work moved to 29.7. This story proves broad services using retained editors; 29.6 later consumes them. There is no gate on Epic 29. Recheck actual providers before implementation.

## Frozen delivery intent and decisions

Complete the retained P0 linked-source journey, not the deferred full item editor: visit an item placement's shared graphics and board-owned programs, edit through the delivered providers, return to the same board selection, explicitly save, and launch the correct saved revision.

The owner's overnight Epic 12 instruction delegates implementation choices, review triage and merging. This worktree starts at the fully locally verified 12.11 candidate `942a47026c52ba96bdeca0d713a80a9f8e1058e5` while PR #3085 completes its repository gates. Rebaseline on the merged current main before publishing this story; do not bypass the 12.11 prerequisite.

Binding editor outcomes are recorded first in `docs/editor-features.md#p0-connected-authoring`. Reuse ADR 0022 visits, pickers, document history, pending-edit barriers and immutable run snapshots. `docs/design/editor-design-language.md` applies: native controls and existing DOM command collection, not a second focus, navigation or command framework.

* Both placement-program links are local overrides. The item and character graphics providers retain their shared document identity; no invented reference count or unknown-use scan is required.
* Fix #3040 in the real definition/artwork loaders, including their nested assets. Use the existing document-owned project-layout convention and exact-case filesystem paths; do not introduce duplicate root-level fixtures to conceal incorrect resolution.
* Wire source visits through actual retained providers. Only offer an editable source where a provider exists; preserve preview support without claiming a new raster or native-clip editor.
* Verify saved-source refresh through the joined journey first. Reuse the existing hide/show and visit lifecycle where it already remounts a view; fix an observed stale retained preview if necessary, without polling or changing the deterministic runtime.
* A running game stays on its captured saved revision. Exercise later source edits against that running instance and then a new run, with board-test versus normal-startup behavior observable in the actual player.
* Preserve same-version residue and unrelated board/definition fields. Rare malformed-animation allocation hardening remains backlog #3067; it is not a prerequisite for this ordinary authoring journey.

## Delivery tasks

- [x] Verify retained provider, source-visit and run boundaries against the merged prerequisite.
- [x] Complete shared definition graphics/source visits and owning-game preview resolution, including #3040.
- [x] Complete Choose/Open for both board-owned placement-program references with clear local/shared labels.
- [x] Prove actual artwork and script edits, Return, selection/history, explicit Save, cancellation and save/reopen in the browser and packaged native editor.
- [x] Prove the actual player's saved revision, immutable running instance, selected-board test and normal startup using the authored fixture and existing run services.
- [x] Run affected local checks first, independently review the resulting diff, triage ordinary blockers versus backlog edges, then push and merge the passing PR.

## Verification and delivery receipts

Rebased prerequisite: PR #3085 merged as `4ff4ed3dee07c66119867f5a859a797797a4b798`; its 12.11 closure receipt is committed before this implementation.

The joined real-browser journey passed locally in 14.6 seconds, and the packaged VS Code web-workbench journey passed using cached SDK build `8a14f0cc1b08d531eb83255ea3764ae22aa932b5`. Screenshots were visually inspected and preserved at `/private/tmp/tkr-1723-browser-connected.png` and `/private/tmp/tkr-1723-native-connected.png`. Both journeys check actual source bytes, full bitmap RGBA, retained animation and board pixels, Bitmap → Animation Return, the original stored slot, distinct shared/local records, cancelled picking, and executed saved programs in board versus normal-game runs. Both old running instances advance additional ticks after source Save without changing their captured manifest or executed revision; fresh runs observe the new bytes.

Local gates passed: production and proof type checks; 809 affected model/UI/host tests; 13 native harness tests; lint; generated help and bundle checks; command docs; dependency graph; provenance; catalogue; headless goldens; and closing baselines for all eight games (including six documented expected failures). No golden was rerecorded. The native strict-CSP build guard was perturbation-verified: removing the Vorbis alias in an isolated build process made the actual guard reject `player.js`, and rebuilding with the alias succeeded. The native real-player journey additionally checks zero player WebAssembly instantiations and no CSP page errors. The scene loader copies only launch-time file-map references (O(file count), no byte copies); it adds no per-tick work.

## Code Review

The first frozen diff was independently reviewed through blind, edge, intent and verification-gap lenses. The edge review reported no findings. Patch the observed ordinary blockers; do not turn the broader authoring matrix into this story's prerequisites.

* Fixed chooser support for previewable GIFs (#3118), and replaced canvas-presence checks with discriminating initial and saved/reactivated animation pixels.
* Added the actual different-animation choice, confirmation, explicit shared-definition Save and exact whole-file checks; a mocked picker is not the acceptance proof.
* Fixed the missing `editor:acceptance` native entry (#3105). The browser uses its Run panel; native VS Code uses real saved `launch.json` configurations and public Run and Debug commands (ADR 0037).
* Fixed observed retained linked-artwork refresh (#3111), scene runs missing the frozen project program loader (#3114), and linked bitmap first paint (#3121). These are not deferred edge cases.
* Backlogged broader physical activation execution, nested-root portrait and linked-TST matrix coverage in #3119; no corresponding product defect was demonstrated. The separate background-message/setup-completion timing issue remains #3115. Neither blocks the retained journey.
* Rejected an OPFS-leak claim: standard Playwright test contexts discard isolated origin storage. Rejected treating the fixed 168-KiB test fixture's serialization as a production-loader defect. Rejected an exact source-workspace-path restriction because the valid acceptance suite uses owned temporary fixture copies.

The independent final runtime review returned no findings. The final host review found the ordinary Bitmap → Animation browser Return omission (#3165), fixed by recording the calling document as the source-visit origin and verified in both actual journeys. Two additional observed native blockers were fixed: hidden player contexts no longer discard a running instance (#3129), and strict-CSP browser bundles exclude the eager Vorbis decoder without weakening policy (#3130; docs-first `e4cd9cac642ecaca12852b625239ae55517e575d`). Standalone desktop SF3 is unchanged.

## Merged receipt

PR [#3166](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3166) merged on 2026-11-18 as `da18e5956839d96740f8f1ebe2cf6c9eaf67ed6f`, after the independently reviewed two-parent candidate `3e924da628f8fcf18c91f86da23e571ee53b75e1` passed the browser and VS Code journeys, type checks, lint and help checks again against current main. All 20 repository checks, including the required gate, passed. Issue #1723 and its fixed bugs are closed; #3115 and #3119 remain open backlog.
