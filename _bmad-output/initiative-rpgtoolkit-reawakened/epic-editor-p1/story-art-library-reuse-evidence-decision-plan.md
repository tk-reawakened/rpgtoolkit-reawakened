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

A human-approved evidence decision is required before selecting or installing any art library.

Owner decision (2026-11-13), recorded in [ADR 0031](../../../docs/adr/0031-owned-art-editor-with-permissive-reuse.md): build our own integrated art editor, with suitable libraries, copied/adapted permissively licensed code and selective forks permitted. This approves the product direction, not a particular component, install or completed 13.2 acceptance. Keep the working host-integration, licence/provenance, keyboard/offline and full T-36 coverage evidence requirements; the research proposal alone does not close this story. No new artwork format or expanded feature scope is approved by this decision.
