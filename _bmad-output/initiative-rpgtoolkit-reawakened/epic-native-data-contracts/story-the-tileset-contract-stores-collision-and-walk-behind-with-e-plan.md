---
title: 'Native tileset contract'
type: 'feature'
ticket: 11
created: '2026-11-18'
status: 'in-review'
baseline_revision: 'ea5933275515e884003424e1623d74e17d45795b'
route: 'full'
risk: 'high'
context: []
---

<frozen-after-approval reason="story scope and explicit owner-review gate">

## Intent

Specify a pre-release native tileset contract with collision and walk-behind authored with the tile, the common native stamp and path identity. Account for every key of the existing authoring draft. Jensen's approval of the specification page is an explicit acceptance criterion and has not been obtained.

## Boundaries & Constraints
Follow the native contract and ADRs 0005 and 0019. Register `.tkrtile` in the specification and package in the same change as the contract. Do not treat delegated implementation choices as evidence that Jensen reviewed or approved this page.

</frozen-after-approval>

## Implementation Notes

The draft `docs/spec/formats/native-tileset.md` records proposed shapes, its key-disposition table and consequential recommendations for owner review. The registry and authoring-draft references accompany it; approval and verification remain outstanding.

## Review Triage Log

## Verification

Run the registry test, documentation link checks and provenance scan after the registry update. Approval remains a separate unmet gate.
- Registry test: 7/7 passed; provenance: 1,712 files, zero violations; draft page relative links and anchors passed. Owner review remains pending.
