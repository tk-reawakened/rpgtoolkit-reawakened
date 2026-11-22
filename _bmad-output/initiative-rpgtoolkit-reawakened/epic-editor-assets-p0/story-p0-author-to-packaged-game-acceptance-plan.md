---
type: feature
title: "P0 author to packaged game acceptance"
ticket: 14
status: in-progress
route: full
route_source: auto
risk: high
baseline_revision: 396282ad103577cfb40df611400395c6a38c78e5
context: ["docs/guardrails.md", "docs/editor-features.md", "docs/spec/formats/packaging-and-paths.md"]
---

# P0 author to packaged game acceptance

<frozen-after-approval reason="creator-to-player acceptance for Epic 12">

## Intent

Prove that a creator can start with a new project in either the browser editor or VS Code Web, author a small game, reopen it, and play the exact package they exported. Component tests and in-editor previews cannot establish that those steps work together.

## Boundaries & Constraints

Create the project independently with each host's real wizard. Use the actual authoring, Save and export controls. Fixtures may supply source artwork and the explicitly documented non-graphical item behavior (owner transfer 2026-11-16); they may not stand in for authored results. Full item behavior editing remains in Epic 29. Do not run the player against the editor's source directory or rebuild the archive in the test. Keep desktop execution out of this story; Epic 15 consumes the proof.

## Acceptance Criteria

- Given an empty destination in each host, the wizard creates a new project and the creator saves meaningful changes to game settings, board and links/start, tiles and stamp, board objects, character and item graphics/placement, animation, and RPGCode. Exercise native scene/asset edits and legacy import where applicable, preserving source and build ownership.
- Given those edits, cancellation leaves the affected bytes untouched; use a keyboard path for an edit and verify saved values after reopening. For saved assets with unknown same-version bytes, assert that the retained bytes survive the targeted edit.
- Given export review, cancelling produces no release; accepting yields the archive and descriptor. Verify descriptor size/hash against the exact bytes. In an isolated runner with no source folder, boot that archive into its authored board, send real input, and observe a game effect tied to the authored changes.

</frozen-after-approval>

## Code Map

- `tools/browser/tests/editor-web-host.spec.ts` already exercises the real browser wizard and export controls. Add a dedicated `editor-*.spec.ts` that binds the new destination to OPFS using the existing folder-picker boundary.
- `tools/editor-vscode-test/web-proof.ts` (`runVscodeNewProjectProof`) already drives the real destination picker; `run.mjs` owns the backing workspace and webview lifecycle. Extend that harness for the second independent run; do not clone the browser-authored project.
- Reuse small UI actions from `tools/editor-vscode-test/{board-properties,board-objects,animation,connected-authoring,native-geometry}-proof.ts` where they fit. Separate authoring steps from existing fixture-specific assertions rather than repeatedly opening other demo projects.
- Extract the exact-byte handoff from `tools/browser/tests/package-export-boot.spec.ts`: descriptor verification, HTTP range serving, and real runner boot. Reuse it for both exports. Make the exported archive/descriptor and playback oracle reusable by the desktop acceptance story.

## Tasks & Verification

1. Wire the authoring steps to both real hosts. After each saved edit, verify the affected document's authored value; reopen before export and assert the linked documents still resolve.
2. Wire each host's reviewed export and run playback against only the generated archive bytes. Assert observable input-driven behavior as well as successful boot.
3. Run each new Playwright/VS Code Web journey locally, then gate both in their existing CI lanes. Pace browser and webview operations, using bounded waits for observable state rather than fixed sleeps.

## Implementation Notes

The prerequisite set is closed on GitHub. This plan targets `main` at the merged Epic 12 refactor, not the older primary checkout.

## Dependencies and decision gate

Prerequisites: 12.13, 11.6, 11.7, 11.8, 11.10 and 9.16. The new-project wizard must exist before this fresh-project journey. Desktop consumes this proof in 15.10.
