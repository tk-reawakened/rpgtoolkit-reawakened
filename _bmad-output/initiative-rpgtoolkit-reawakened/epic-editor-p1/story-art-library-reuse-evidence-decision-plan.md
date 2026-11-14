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

A human-approved evidence decision is required before selecting or installing any art library.

Owner decision (2026-11-13), recorded in [ADR 0031](../../../docs/adr/0031-owned-art-editor-with-permissive-reuse.md): build our own integrated art editor, with suitable libraries, copied/adapted permissively licensed code and selective forks permitted. This approves the product direction, not a particular component, install or completed 13.2 acceptance. Keep the working host-integration, licence/provenance, keyboard/offline and full T-36 coverage evidence requirements; the research proposal alone does not close this story. No new artwork format or expanded feature scope is approved by this decision.

## Evidence outcome (2026-11-14)

Fresh isolated evaluation is recorded in [story-13.2-candidate-evidence.md](../../../docs/findings/pixel-art-platform/story-13.2-candidate-evidence.md). Dotting 2.1.18's React/ReactDOM peers and component-owned history do not fit ADR 0025 or the shared document/history contract; JollyPixel's published 7.0.0 is framework-neutral but its published declarations own a `PixelDocument` and expose only its local history configuration (the newer docs/source history adapter is not the published artifact evaluated). Dotting's public Storybook supports a real browser draw interaction; it does not prove host integration. JollyPixel's linked editor/demo pages were unavailable and its reachable docs are not an interactive proof.

**Recommendation:** no production art-library dependency yet. Use targeted framework-free in-house pixel-operation modules and a canvas view over the existing host-owned document/history contract as the smallest reversible foundation. This uses the approved owned-editor direction and does not add a native format, expand scope, or drop any T-36 operation. The exact in-house modules remain subject to the story's person-reviewed approval; no actual art document, shared host/history integration, strict-CSP/offline proof, VS Code webview proof, or complete T-36 implementation has been demonstrated. Preserve the story as incomplete until those acceptance gates are met.
