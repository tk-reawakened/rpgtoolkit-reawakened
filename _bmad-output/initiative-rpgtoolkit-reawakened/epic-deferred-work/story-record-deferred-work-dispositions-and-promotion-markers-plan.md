---
id: 12
type: story
title: "Record deferred-work dispositions and promotion markers"
tracker_id: "#851"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/851"
parent: epic-deferred-work
created: '2026-10-31'
status: 'done'
baseline_revision: '3c7c7190'
route: 'oneshot'
route_source: 'auto'
risk: 'low'
review: 'quick'
context: []
---

## Intent

Epic 23 Done-when 2 needs each finding that is resolved, duplicated or waiting on a ruling to keep its ledger entry with its disposition recorded, and each promoted finding to name where it went. The ledger had 54 findings, 20 `## Resolved` lines and no record of the tickets cut under Epic 23.

## Implementation Notes

Docs only, appended as a new `## Promotion and disposition record` section; no historical entry was edited. Findings were re-checked at the audit revision `c8b7772f`; venues delivered after that pin are cited at their own merge commit, and the findings already recorded under `## Resolved` are not repeated.

## Verification

- The new section names a venue for every promoted ticket (23.1–23.15), a spec or code anchor for every finding resolved in substance, and the four findings awaiting an owner ruling (#642, #680, #854, #855).
- `ls`/`grep` checks confirm each cited anchor exists: `docs/spec/formats/legacy/older-binary-versions.md` OWNER notes, `docs/spec/formats/README.md:120-121`, `docs/editor-features.md:184-192`, `packages/core/src/engine/boot.ts:34`, `packages/core/src/formats/registry/core-decoders.ts`.
