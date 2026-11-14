---
type: feature
title: "Art library reuse evidence decision"
ticket: 2
status: draft
risk: high
---

## Intent

Compare maintained pixel-editor libraries and a native implementation against all T-36 operations, G6 licensing including transitive dependencies, host embedding, keyboard access, offline operation and AD-19 document integration before any art dependency is installed.

## Scope and acceptance

Document evidence and rejected alternatives; no component is selected in advance, no GPL/MPL dependency or legacy source. A rejected candidate is not admitted; rejection does not prohibit other qualifying libraries or permissively licensed code within our own editor.

## Verification

A person reviews reproducible candidate, version, license and transitive evidence, working host integration findings, coverage and limitations, and approves either a qualifying choice or the in-house route.

## Dependencies and decisions

Prerequisites: 11.1. Apply the epic Notes, format specs, AD-18/19/20/22/29 and connected-authoring direction; T-36 maps to CAP-16. Preserve version and residue, use the existing shared model and browser, and route host access through platform-services. Where provider or host capability is unavailable, preserve data and report the limitation; do not simulate it.

A person-reviewed evidence decision is REQUIRED before production art-library admission. Exact-version installs in throwaway directories are permitted only to produce reproducible research evidence; they do not admit a dependency to this product.

Owner decision (2026-11-13), recorded in [ADR 0031](../../../docs/adr/0031-owned-art-editor-with-permissive-reuse.md): build our own integrated art editor, with suitable libraries, copied/adapted permissively licensed code and selective forks permitted. This approves the product direction, not a particular component, production install or completed 13.2 acceptance. Keep the working host-integration, licence/provenance, keyboard/offline and complete T-36 coverage/ownership matrix evidence. T-36 implementation belongs to 13.3, not the 13.2 exit gate. No new artwork format or expanded feature scope is approved by this decision.

## Evidence outcome (2026-11-14)

Fresh isolated evaluation is recorded in [story-13.2-candidate-evidence.md](../../../docs/findings/pixel-art-platform/story-13.2-candidate-evidence.md). Dotting 2.1.18's React/ReactDOM peers and component-owned history block direct use under ADR 0025, but do not prohibit algorithm adaptation. JollyPixel 7.0.0 is framework-neutral and its published `PixelArtCanvas` accepts an injected `PixelDocument`, disabled local history, event callbacks and external snapshots. The new Chromium probe exercises a real pointer stroke and proves the public staging/reconciliation seam; it does not prove EditorDocument authority. Its callback runs after its mutable buffer changes, so adapter work must translate and reconcile host commands rather than accept local history. The official Jolly docs/demo remained non-interactive/unavailable.

**Recommendation:** carry JollyPixel 7.0.0 forward as the leading reversible staging-canvas adapter candidate, supplemented by targeted framework-free operations for missing T-36 features; do not admit it to production yet. Use the published `history.enabled:false`, injected `PixelDocument`, `onBufferUpdated` and `loadSnapshot` seams to keep a host-owned `EditorDocument`/history authoritative. The required adapter maps each post-mutation vendor event to exactly one host command and restores host snapshots after external edit/undo/redo or a rejected write. The test-only `.brd` check proves that existing BoardDocument refuses art pixels, and existing browser/VS Code runs prove `.gam` only; no art document has accepted or persisted a pixel command. Art-specific two-view/shared-history, keyboard, strict-CSP, offline-local-asset, save/conflict and render-on-board evidence remain open. ADR 0031 already approves the owned-editor direction and ordinary internal modules; a person must review the evidence and actual art-host findings before closing 13.2. Any exact external package, copied/adapted code or bundled asset still needs its G6/source/provenance/notice review and person approval before production admission. T-36 implementation belongs to 13.3. Keep 13.2 incomplete.
