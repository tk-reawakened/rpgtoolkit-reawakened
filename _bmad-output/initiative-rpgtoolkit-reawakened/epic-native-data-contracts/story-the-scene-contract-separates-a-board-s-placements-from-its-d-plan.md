---
title: 'Specify native scenes and preserve legacy board data'
type: 'feature'
ticket: 8
created: '2026-11-18'
status: 'in-review'
baseline_revision: '65611327311a59aa5cb9da0c52231319b51134cc'
route: 'full'
route_source: 'auto'
risk: 'high'
context: []
---

<frozen-after-approval reason="owner delegated recommended implementation choices; scene specification still requires direct review">

## Intent

Define a pre-release scene document that separates placements from reusable definitions and can explicitly import a board without losing its stored fields or stable indices. Scenes remain authoring documents that build legacy boards; plain boards remain directly editable.

## Boundaries & Constraints

**Always:** Follow ADR 0019, shared native stamp/path/plugin rules, and document all 75 board fields. Preserve absent versus empty LUT, raw slots, reserved fields and legacy order on conversion. Use path plus local ID for pack and tileset references. Existing separate battle scenes remain separate. Clearly label proposed design and leave the explicit owner review gate open.

**Never:** Consult GPL source, convert on open/save, implement scene runtime loading or editor controls, invent an actor contract, claim direct owner approval, or discard fields without an explicit documented reason.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected | Failure handling |
|---|---|---|---|
| Legacy board | All board fields, empty slots and reserved values | Each field maps to a named scene location or justified omission; indices remain stable | Conversion is explicit and never overwrites an existing scene |
| Reusable art | A tileset or pack document and local ID | Reference uses document path plus local ID; placements retain identity | Missing references are reported |
| Plugin data | An absent plugin's scene block | Top-level opaque block and comments preserved | No nested placement doors in this proposed first cut |

</frozen-after-approval>

## Code Map

- `docs/spec/formats/board.md` fields 1–75 is the authoritative board inventory; tile LUT absence, RLE order, shading, lights, vectors, trigger/item/image slots, reserved fields and board settings need explicit dispositions.
- `docs/spec/formats/tkr-authoring.md` section 2 is the incomplete scene sketch; its current status banner describes missing identity, closed shape and registry choices.
- `docs/spec/formats/native-contracts.md`, `native-tileset.md`, `native-asset-pack.md` and ADR 0019 constrain path identity, plugin envelopes, tile/pack references, explicit conversion and preserved indices.
- `packages/native-data/src/registry.ts` and `packages/native-data/test/registry.test.ts` hold the registry and its parity check; add `.tkrscn` and keep all existing entries.

## Tasks & Acceptance

- [x] Write `docs/spec/formats/native-scene.md` with a proposed contract, example, explicit board-only limitations and a row for each documented board field.
- [x] Update the authoring draft status, shared registry table, package registry and tests together.
- [ ] Complete independent review and publish a draft PR for owner review.
- [ ] Do not mark the story done until the explicit scene-spec approval gate is met.

## Implementation Notes

The proposed specification accounts for all 75 numbered board fields, including stored overshoot cells, and lists explicit limits on the first-cut importer. Jensen reviewed and merged the preceding asset-pack contract; its stale approval status is corrected in the same documentation change. No scene approval is claimed.

## Plan Change Log

## Review Triage Log
- Independent review identified recovery of externally edited boards, playable output paths, observed shade values, nested references, pack lowering and run-stream preservation as substantive gaps. The proposal now addresses them; scene core keys are registered for plugin-envelope collision checking. These corrections are tracked in #3203.
- Addressing generated `wallCapUnder` references requires a future explicit tileset-block reference; the proposal no longer promises support its current reference shape cannot express.
- The separate #1848 work implements the nested art reference checker and rename paths; this scene PR does not claim that work is merged.

## Verification


- Scene registry and checker tests: 17 passed; targeted lint passed. Provenance scanned 1,730 files with zero violations. Ticket-store validation passed. All 75 numbered board rows are present, local links resolve, and the corrected sample parses as YAML.
Run the native registry test, provenance scan and ticket-store validator. Check every board field number 1–75 is accounted for and resolve all relative links. Review the draft against ADR 0019 and the current scene/pack/tileset proposals.
