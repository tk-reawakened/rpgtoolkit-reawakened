---
title: 'The asset-pack contract stores collision and walk-behind with each asset'
type: 'feature'
ticket: '12'
created: '2026-11-17'
status: 'in-review'
baseline_revision: 'ea5933275515e884003424e1623d74e17d45795b'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - docs/guardrails.md
  - docs/spec/formats/native-contracts.md
  - docs/adr/0019-tkr-authoring-formats.md
  - docs/adr/0005-independent-product-v1-and-native-format.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The draft asset-pack shape is not a native contract: it uses document-level identity, has no closed-field/plugin-block rules, and scene references identify packs by an ID instead of their path. The first-release pack must preserve art-linked collision and walk-behind data.

**Approach:** Write a reviewable pre-release `.tkrpack` contract from authoring draft §4, align it with the shared native rules, and add its extension to the specification and package registries with a conformance test. Use conservative recommendations and label genuine owner choices; Jensen's approval of the page remains pending.

## Boundaries & Constraints

**Always:** Derive from repository docs only (G7); use the common stamp, path identity, closed top-level contract fields and sole open `pluginData` dictionary; retain each asset's anchor, visuals, solid collision and under walk-behind vectors; account for every draft key; add `.tkrpack` in both registries in this change.

**Never:** Consult legacy source; implement readers, writers, scene-reference migration or runtime behavior; claim Jensen reviewed/approved the draft; mark the story done or merge it.

</frozen-after-approval>

## Code Map

- `docs/spec/formats/tkr-authoring.md` §4 (lines 198–277) -- input shape and every key that needs a disposition; leave its shared draft banner alone.
- `docs/spec/formats/native-contracts.md` -- common stamp, reserved/closed keys, identity by path, plugin block envelope/preservation, extension registry table. Use its current rules without resolving owner-open questions in that shared contract.
- `docs/adr/0019-tkr-authoring-formats.md` amendment points 3 and 5, and `docs/adr/0005-independent-product-v1-and-native-format.md` second amendment -- three authoring formats move forward; packs keep solid and under vectors with art.
- `packages/native-data/src/registry.ts` -- `REGISTRY` lists each supported native extension; add `.tkrpack` / `asset-pack` beside `.tkranm`.
- `packages/native-data/test/registry.test.ts` -- shipped-registry assertion and spec-table parity test; extend expected entries, and retain the table-driven parity assertion.

## Tasks & Acceptance

**Execution:**
- [x] `docs/spec/formats/native-asset-pack.md` -- define the draft pre-release contract, worked example, full key-disposition table, reference shape, and explicit owner-review notes.
- [x] `docs/spec/formats/native-contracts.md` -- add the `.tkrpack` registry row linking to its contract page.
- [x] `packages/native-data/src/registry.ts` -- register `.tkrpack` as `asset-pack`.
- [x] `packages/native-data/test/registry.test.ts` -- update the shipped-registry expectation; existing parity assertion proves the spec and package registry agree.

**Acceptance Criteria:**
- Given every key and nested key in authoring draft §4, when the disposition table is reviewed, then each is mapped, renamed, or dropped with its reason.
- Given a pack document, when checked against the page, then its first two keys are `contract`/`version`, its document identity is its path, its core schema is closed, and top-level `pluginData` is the only extension door.
- Given a scene asset reference, when it selects an asset, then the reference includes the pack document path and a pack-local asset ID, not a synthetic pack ID.
- Given the spec and package registry, when the registry conformance test is run, then `.tkrpack` maps to `asset-pack` in both.
- Given the draft's approval criterion, when this artifact is delivered, then it remains explicitly pending Jensen's review; no approval or completion is claimed.

## Implementation Notes

The draft contract, registry rows and registry expectation are prepared. Approval is not recorded: Jensen's spec review and decisions listed on the page remain pending. Tests, builds, lint, format, Git and merge operations were not run in this isolated assignment; the parent owns verification and integration.

## Design Notes

Use path-valued `pack` plus pack-local `asset` as the reference instead of inventing an ID-like compound string or a URI fragment. Keep stable asset `id` values inside the pack but derive the pack document ID from its lowercase project path. Preserve anchors and visuals and make `solid` and `under` explicit core properties, not free-form data or plugin fields. Recommend scene-coordinate vectors relative to the asset anchor and make any interpretation not settled by source material conspicuous for owner review.

## Verification

**Manual checks:**
- Compare the disposition matrix against each scalar, mapping key, and nested field in `tkr-authoring.md` §4.
- Inspect links and extension/contract parity; the parent runs the registry, docs, and link checks after integration.
- Registry test: 7/7 passed; provenance: 1,712 files, zero violations; draft page relative links and anchors passed. Owner review remains pending.
