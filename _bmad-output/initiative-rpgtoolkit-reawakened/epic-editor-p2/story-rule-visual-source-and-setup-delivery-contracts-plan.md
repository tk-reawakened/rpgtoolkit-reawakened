---
type: feature
title: "Rule visual source and setup delivery contracts"
ticket: 1
status: done
risk: high
---

# Rule visual source and setup delivery contracts

## Scope

Specifies and obtains owner approval for the structured event source/code boundary, visual fixture representation against 11.9, and setup installer, uninstaller, targets, signing and unsupported-host semantics without changing the selected hosts.

Document example event and fixture representations, ownership and behavior when switching views or editing unsupported code; decide supported setup formats, target platforms, distribution, installer/uninstaller safety, signing and failure/cancel behavior, with approval before consumers start.

Include T-45's small screen-layout canvas: define coordinate/placement authority, generated commands and the numeric/keyboard editing alternative. Also settle skin authoring explicitly: `docs/spec/formats/main-file.md` records `skinButton` and `skinWindow` as preserved legacy fields ignored by the engine. Name the authoritative document and whether preview is editor-only or requires a separately specified runtime consumer; record and pin any new provider before 14.4 starts. Do not invent a separate skin format or claim those legacy fields already affect gameplay.

## Acceptance and verification

A person approves documented source authority, lossless unsupported-code handling, fixture storage and executable mapping, and package/install safety and capability rules with examples.

## Dependencies and decisions

Requires 11.1. The owner approved the published [ADR 0045 recommendations](../../../docs/adr/0045-visual-source-skin-and-setup-delivery-contracts.md#owner-decisions) on 2026-11-25: 1A, 2A, 3A, 4A and 5C. No decision from 14.11 or an unpublished amendment is included.

| Acceptance clause | Ruling and handoff |
|---|---|
| Source, layout and lossless unsupported code | [TOOL-12 visual events](../../../docs/spec/engine/rpgcode-tooling.md#tool-12-visual-events) shows the message and placement examples, admission rule and untouched opaque source. 14.2 and 14.3 own implementation and proof. |
| Named skin document and preview | [Native Skin](../../../docs/spec/formats/main-file.md#editor-skin-authoring) is the sole authority, named in the 14.4 plan under 3A. Preview is editor-only and no runtime provider is required. 14.4 fixes the file spelling before implementation. |
| Fixture mapping | [TOOL-12 visual fixtures](../../../docs/spec/engine/rpgcode-tooling.md#tool-12-visual-fixtures) maps visual inputs to saved TOOL-5 source. 14.7 owns the real-engine proof. |
| Setup and install safety | [T-72 launcher-based setup](../../../docs/spec/formats/packaging-and-paths.md#reawakened-setup-delivery) covers review, cancellation, integrity, install, removal and save handling. 14.6 owns clean-recipient proof on a capable player; no native targets or signing are approved. |
