---
type: feature
title: "Art library reuse evidence decision"
ticket: 2
status: draft
risk: high
---

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

## Evidence outcome (2026-11-14)

Fresh isolated evaluation is recorded in [story-13.2-candidate-evidence.md](../../../docs/findings/pixel-art-platform/story-13.2-candidate-evidence.md). Dotting 2.1.18's React/ReactDOM peers and component-owned history block direct use under ADR 0025, but do not prohibit algorithm adaptation. JollyPixel 7.0.0 is framework-neutral and its published `PixelArtCanvas` accepts an injected `PixelDocument`, disabled local history, event callbacks and external snapshots. The new Chromium probe exercises a real pointer stroke and proves the public staging/reconciliation seam; it does not prove EditorDocument authority. Its callback runs after its mutable buffer changes, so adapter work must translate and reconcile host commands rather than accept local history. The official Jolly docs/demo remained non-interactive/unavailable.

**Recommendation:** carry JollyPixel 7.0.0 forward as the leading reversible staging-canvas adapter candidate, supplemented by targeted framework-free operations for missing T-36 features; do not admit it to production yet. Its injected staging document, disabled local history, post-mutation event and external-snapshot APIs support a possible host-authoritative adapter. Actual browser/VS Code runs prove `.gam` behavior only; no art document has accepted or persisted a pixel command. Art-specific two-view/shared-history, keyboard, strict-CSP, offline-local-asset, save/conflict and render-on-board evidence remain open. ADR 0031 already approves the owned-editor direction and ordinary internal modules; a person must review reproducible evidence and actual art-host findings before closing 13.2. Exact external packages, copied/adapted code and bundled assets still need their G6/source/provenance/notice review and person approval before production admission. T-36 implementation belongs to 13.3. Keep 13.2 incomplete.
