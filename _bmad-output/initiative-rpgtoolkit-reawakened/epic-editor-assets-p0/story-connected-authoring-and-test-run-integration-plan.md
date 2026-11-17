---
type: feature
title: "Connected authoring and test run integration"
ticket: 12
status: in-progress
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

- [ ] Verify retained provider, source-visit and run boundaries against the merged prerequisite.
- [ ] Complete shared definition graphics/source visits and owning-game preview resolution, including #3040.
- [ ] Complete Choose/Open for both board-owned placement-program references with clear local/shared labels.
- [ ] Prove actual artwork and script edits, Return, selection/history, explicit Save, cancellation and save/reopen in the browser and packaged native editor.
- [ ] Prove the actual player's saved revision, immutable running instance, selected-board test and normal startup using the authored fixture and existing run services.
- [ ] Run affected local checks first, independently review the resulting diff, triage ordinary blockers versus backlog edges, then push and merge the passing PR.

## Verification and delivery receipts

Pending implementation. Record only checks actually executed: affected model/UI tests, configured type checks and lint, the joined real-browser journey, and the corresponding packaged native proof. Reuse existing broad prerequisite receipts where unchanged; no golden rerecording or runtime hot-path change is planned.
