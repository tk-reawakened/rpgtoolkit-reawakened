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
