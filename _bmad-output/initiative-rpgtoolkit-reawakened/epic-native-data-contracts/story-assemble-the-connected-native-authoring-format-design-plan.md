---
ticket: 15
tracker_id: "#3233"
status: built
assignee: ""
---

# Connected native format design delivery

Baseline: `56ffdf084a4d61fd1d3b2429ca36c2643f350293`. Docs-only design; no runtime, reader, writer or schema implementation is claimed. Merge/CI remains separate from local design completion.

## Delivered scope

- `docs/design/native-authoring-format-set.md`: family inventory, recommended project root, presentation ownership, plugin boundaries, import/build mapping and first connected proof.
- `docs/design/native-graphics-authoring.md`: image/tileset/pack/clip/scene ownership, stable identity versus legacy slots, transparency and projection, shared/local edits, source/output authority and existing layered-art providers.
- `docs/design/native-definition-formats.md`: character, item/NPC, enemy, move, effect and battle-background preservation targets without inventing unapproved extensions.
- ADR 0005 records the owner's direction without retiring direct legacy editing or silently widening first-release implementation scope. Existing native authoring overview links the design without changing schemas.
- Epic 27 entries 15–17 mirror #3233–#3235. Epic 11 metadata and Epic 30 annotations consume the new ownership direction. Existing #1808, #1846, #2320 and #2321 retain family/graphics ownership.

## Local verification and review

- `node tools/provenance/scan.mjs`: 1699 files, zero violations.
- Scoped Markdown checker: nine affected documents, 108 local links/anchors, zero errors.
- Two illustrative YAML blocks parse with the repository's YAML library; no claim of schema acceptance.
- Issue preflight store validation: 561 tracker IDs, 449 plans, 35 folders valid before this evidence plan was added.
- Scoped ticket-status checks: no undeclared or unpinned dependencies after initiative declarations. Coarse epic-order conflicts remain for valid late-stage dependencies and are tracked in #3236; independent entry-level review found no story cycle. Do not remove required providers to silence them.
- Independent cross-reviews: GraphicsDesign reviewed project/metadata ownership and dependencies; DefinitionDesign reviewed graphics and scene annotation scope. Neither reported a concrete blocker. Parent reviewed definition claims against current clean-room format docs and integrated the layered-art source ownership correction.
- No builds, UI proofs, runtime suite or schema tests: no executable behavior or schema changed.

## Next work

#3234 owns exact contract fields, field ledgers, schemas and coordinated presentation cutover. #3235 owns the connected import/edit/build/run proof. #3183 remains open for metadata lifecycle and grouping rules; the earlier #3220 sidecar-oriented draft is superseded, not evidence that its contract was completed.
