---
type: feature
title: "Editable artwork source and interchange contracts"
ticket: 21
status: draft
risk: high
---

## Intent

Specify persistent layers, frames, recipes and source-to-output relationships by extending the Epic 27 tile/pack contracts where appropriate, and define standard image/sheet/animation interchange and exact multi-cell timing/lowering before implementation.

## Scope and acceptance

1. Publish normative contracts and worked examples before dependent code, with an owner approval gate. Reconcile with 27.11/27.12 rather than replacing their baseline contracts or inventing a competing family.
2. Specify ownership and stable identity for source images, layers and their order/visibility/opacity, frames, named sheet regions, recipe inputs/parameters/overrides and generated outputs. Distinguish source identity, display order and source coordinates.
3. Decide whether existing native documents suffice. A new document kind needs the catalogue admission test, its ADR/registry/schema and reference/checker rules; no extension is reserved here. Keep structured metadata separate from pixel payloads and explain the Git diff and preservation behavior.
4. Define standard exchange for PNG images/sheets and animation metadata: dimensions/origins/margins/gaps, alpha/key conversion, named regions, frame order and timing, missing sources and explicit loss reporting. Do not silently choose a generic JSON convention or assume support for an external application's editable file.
5. Specify single-tile and multi-cell frame timing, tick conversion, empty frames, loop boundaries and phase when artwork is placed or revisited. Demonstrate the exact lowering to real existing game assets. If existing outputs cannot express the requirement, obtain the required runtime ADR/spec approval before implementation, rather than faking synchronized preview.
6. Define invalidation/regeneration, generated-file ownership, conflicts, per-file save results and checkpoint recovery under ADR 0022. Saving a source does not falsely claim its outputs were all saved.
7. Examples cover a roof spanning cells, layered water frames, a kitbash house with an override, terrain and three-face iso recipes, and an external odd-grid sheet. State each preserved field and every intentionally lossy exchange.
8. Owner approval of this contract is required before 22 and dependent implementation begin. Unsettled schema and timing choices remain explicit decisions for this story, not assumptions assigned to UI builders.

## Verification

The owner approves normative source and interchange contracts with worked roof, water, kitbash and external-sheet examples, preservation and recovery rules, and an explicit mapping to real runtime outputs without an unapproved format or timing assumption.

## Dependencies and decisions

Prerequisites: 27.11, 27.12. Owner-approved breakdown; the corresponding tracker issue is recorded in tickets.toml. Contract choices still require the approval specified in 13.21. Read the [epic](epic-editor-p1.md), [owner refinement decisions](discovery/art-workspace-refinement.md), [research](../../../docs/findings/pixel-art-platform/research.md), [ADR 0022](../../../docs/adr/0022-shared-editor-authoring-contracts.md) and [ADR 0031](../../../docs/adr/0031-owned-art-editor-with-permissive-reuse.md). A-1 maps to CAP-16. No code implements an unsettled format/timing choice before 21's normative approval. Keep model/host boundaries, permissive licensing and fast focused verification; browser-led presentation is not a deterministic-runtime restriction.

## Proposed managed-source reference

Use a project-relative artwork source path plus a stable source-local frame ID and named region ID. The artwork owns region geometry in each frame; coordinates and display order are not identity. Moving a named region updates its consumers on rebuild; deleting a referenced frame or region reports the unresolved reference instead of selecting a neighboring entry. Keep the standalone raster path and pixel rectangle as a separate reference form. Never infer managed ownership from a filename or treat a generated PNG as the source.

Tiles choose source frames and regions and own their runtime-facing playback sequence. Tilesets own terrain rules and synchronization requirements; scenes own painted regions and hand-placed overrides. An external source edit invalidates dependent outputs; missing sources or conflicts preserve the authored references and prevent the affected output from being marked current.

The worked examples must show a roof split across cells, connected water with shared timing, a kitbash override surviving regeneration, three-face isometric artwork with separately proven geometry, and an odd-grid sheet preserving margins and gaps. The source reference and preservation rules can be developed independently of codec adoption. Animated runtime lowering remains gated on held-board playback and phase proof ([#3244](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3244)); the [merged terrain design](../../../docs/design/terrain-scene-formats.md) does not supersede that gate.

### Exact reference shape for review

Use a closed, mutually exclusive reference: a managed sample is `{source, frame, region}`; a raster sample is `{file, rect}`. Both paths use project-relative path rules. An animated tile's cel carries one sample; a still tile carries one directly. A managed sample never carries a second crop rectangle. Transparency and playback settings belong to the consumer, outside the reference.

```yaml
managed: {source: art/village-pond, frame: ripple-01, region: bank-ne}
raster: {file: art/imported/odd-grid.png, rect: [39, 5, 32, 32]}
```

The example keys `managed` and `raster` illustrate alternative values, not wrapper fields. The managed path is illustrative, not a reserved extension. Frame IDs are unique within a source. Region IDs name one logical region within a source; the source records its rectangle for each frame in which it exists. Both IDs survive label changes and reordering. Duplicating a frame assigns a new frame ID. A frame without a named region does not inherit the rectangle from another frame. Rectangles are `[x, y, width, height]` in composited source-frame pixels, with positive size and no implicit clipping or rescaling.

| Case | Expected result |
|---|---|
| Roof split into `roof-west` and `roof-east` in frame `rest` | Both tiles sample the same composited frame; changing a shared roof layer affects both on rebuild. |
| Animated pond bank | Cels for `ripple-01` and `ripple-02` use the same `bank-ne` region ID. Reordering art frames does not change the tile timeline; moving the region updates the sample on rebuild. |
| Kitbash house with an edited window | Changing a recipe input invalidates dependent output. The authored window override remains an input and survives regeneration. |
| Three-face isometric artwork | Face regions can be sampled independently. Sampling does not prove combined placement, collision, draw order or output encoding. |
| External odd-grid PNG | With a left margin of 5, width 32 and gap 2, the second column starts at x=39. The saved rectangle, not an inferred grid, selects the cell. |
| Missing source, frame or frame/region pair | Report the missing reference at the consuming tile or cel. Keep the reference and existing output; never substitute another slice or mark that output current. |

Reconcile this shape with the existing still and animated raster examples before promotion. This proposal does not change the tile wire contract or select a source container, recipe serialization, interchange convention, or runtime lowering.
