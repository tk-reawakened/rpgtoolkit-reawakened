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

## Owner-approved reference shapes and proposed semantics

The owner approved the two reference shapes in [#2320](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2320#issuecomment-7040778407): project-relative source plus stable source-local frame ID and region ID, or project-relative raster file plus rectangle. The remaining semantics in this plan are recommendations, not an approved normative contract. In particular, the artwork owns region geometry in each frame; coordinates and display order are not identity. Moving a named region updates its consumers on rebuild; deleting a referenced frame or region reports the unresolved reference instead of selecting a neighboring entry. Never infer managed ownership from a filename or treat a generated PNG as the source.

Tiles choose source frames and regions and own their runtime-facing playback sequence. Tilesets own terrain rules and synchronization requirements; scenes own painted regions and hand-placed overrides. An external source edit invalidates dependent outputs; missing sources or conflicts preserve the authored references and prevent the affected output from being marked current.

The worked examples below are a decision packet, not a schema or implementation authorization. The [merged terrain design](../../../docs/design/terrain-scene-formats.md) is a design baseline, not a normative replacement. The earlier held-board blocker in [#3244](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3244) was fixed by [#3248](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3248); its scope and the remaining gates are distinguished below.

### Approved reference shapes; remaining details for review

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

## Owner decision packet — recommendation, not a ruling

**Decision requested:** approve or amend the source ownership, interchange, timing/lowering and preservation recommendations together, then approve the resulting normative documents explicitly. Merging this plan approves none of them, selects no codec, and does not close 13.21. Existing direction to continue from the terrain design is not approval of this contract.

### Status and dependencies

| Item | Status and boundary |
|---|---|
| Source references | **Ruled:** the two shapes above. The owner did not approve a codec or the rest of this contract. |
| Output slots and raised isometric | **Ruled in [#1846](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1846#issuecomment-7040777980):** stable explicit slots, no implicit renumbering or reuse; flat terrain can proceed independently. Preserve raised source and refuse its build until projected overlay is specified and proven. Do not re-decide or implement that work here. |
| Prerequisites | Asset-pack 27.12 [#1847](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1847) is complete. Tileset 27.11 [#1846](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1846) remains open despite the filename cutover and allocation plan. This packet and an owner ruling can be prepared now; formal 13.21 closure also requires its declared prerequisites, the approved normative contract and its acceptance evidence. |
| Scene compiler | [#1850](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1850) is closed; its comment links the pond workflow to #1733/#1851. Its closure is not itself evidence that this specific animated pond was compiled and played. Use those existing owners for the end-to-end proof; do not duplicate their compiler work. |

### Options and recommended contract

| Decision | Recommendation for owner review | Alternative and why not recommended |
|---|---|---|
| Editable source | One project-owned structured source identifies a canvas, ordered layers (visibility, opacity and blend), stable frames, per-frame region rectangles, recipe inputs/parameters and explicit overrides; keep pixels in losslessly stored payloads. Plain imported images remain editable image sources. A composited or generated PNG is a derived output, never a second editable authority. Decide admission, extension, versioning and exact storage only after a catalogue review. | Flattened PNG alone is simple and interoperable but loses layers, frame identity and recipes. Making a third-party editable file the sole authority could improve exchange but binds preservation to a codec not yet selected or proven. |
| Interchange | Support explicit PNG image and sheet import/export, with an explicitly versioned, documented metadata representation for canvas dimensions, origin, grid margins/gaps, named regions, frame order and durations. Preserve alpha where representable; conversion to a colour key must report collisions and loss before writing. A plain PNG without metadata is pixels only, not a silently inferred editable timeline. Select the metadata convention through owner review, not by assuming generic JSON compatibility. | PNG-only is widely usable but cannot carry timing or layer/recipe semantics; a selected external editable format might retain more, but cannot be promised until its actual codec passes preservation, security and licence gates. Import must retain the original or refuse unsupported data rather than silently destroying it. |
| Timing | Retain authored frame order and exact durations in source metadata. For a legacy target, emit a shared phase-zero, equal-rate sequence only when every duration is exactly representable by the target and all connected cells use the same tick schedule; otherwise refuse that target with a precise diagnostic, preserving the source. A future target or runtime change needs its own approved spec/ADR, not an invented output in this plan. | Rounding every requested duration or pretending independent preview clocks are synchronized silently changes the result. A global restriction to equal-rate source frames would unnecessarily discard authoring data. |
| Regeneration and recovery | Record source/dependency and output fingerprints, generator version and slot reservations; stage outputs, detect external changes before replacement, and report per-file success or failure. Mark only outputs whose recorded inputs and bytes match current state as current. Preserve authored data, unresolved references and overrides on conflict or interruption; recovery uses the existing checkpoint contract, not a claim of atomic multi-file save. | Blind overwrite loses outside edits; calling the entire build current after partial success conceals stale output. Keeping generated files as authoritative loses the ability to regenerate reliably. |

Published `aseprite-io@0.1.0` is not approved for editing or untrusted input: [#2320's evaluation](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2320#issuecomment-7001367322) records four repaired upstream defects but no fixed release verification. No codec is selected here.

### Timing and lowering evidence at `9f2008fe95e95fdb70d2c3a3ab9ac838135f0519`

[PR #3248](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3248), merged as `ca1b70f873aa5cc1e9668e76dc310b47cdc9ccde`, retained ordered frames and dependencies on a held board. The [board specification](../../../docs/spec/formats/board.md#animated-tiles) describes fixed-tick selection, blank frames and shared phase. Its committed [headless runner proof](../../../packages/runner-headless/test/animated-board-playback.test.ts) uses two cells with the same 5 fps `.tan`, verifies first/blank/second/loop at ticks 0/11, 12, 24 and 36, and compares real `saveBlob`/`loadBlob` continuation with uninterrupted draws. The [repair plan](../../backlog/bug-animated-board-tiles-stay-static-plan.md) records that this proof failed on the pre-fix baseline. Thus held-board playback, those boundaries and that save continuation are proven for that fixture; they are not merely proposed.

The separate [#1846 probe](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1846#issuecomment-7029742932) used two distinct `.tan` files with distinct cels, equal 5 fps and phase zero through the real headless engine. It is an in-memory probe, not a persistent native-compiler golden. Neither proof establishes unequal per-frame durations, arbitrary/nonzero start phase, board re-entry semantics, browser/desktop presentation, or the full native source-to-pond compiler workflow. These are evidence gaps, not newly confirmed defects.

The existing `.tan` stores one speed for the whole animation ([format](../../../docs/spec/formats/tiles.md#animated-tile-tan)); the runtime rounds `60 / speed` to the nearest whole tick, minimum one ([implementation](../../../packages/core/src/world/hydrate.ts)). For example, speed 5 gives 12 ticks per cel, so a three-cel loop is 36 ticks; speed 7 gives 9 ticks, not an exact 1/7 second. A proposed export must calculate the actual tick schedule and refuse a request it cannot represent exactly, rather than claim the encoded speed supplies arbitrary durations. Placement/revisit phase beyond the proven cases remains an explicit owner/runtime decision.

### Worked decisions and failure behavior

1. **Roof:** one source frame `rest` contains a 64×32 composite and stable `roof-west` and `roof-east` 32×32 regions. Two tile outputs sample those regions and retain their existing explicit slots. A layer edit invalidates both outputs; a missing region keeps both references and last outputs but neither affected output is called current. PNG export preserves composite pixels and alpha, not layers or region identity unless accompanied by the selected metadata.
2. **Water:** two source frames each contain the whole connected pond, with named west/east cell regions. Each cell's emitted `.tan` references its corresponding per-frame tile slots. For equal 12-tick cels at phase zero, both have the same boundaries; the distinct-file probe supports that target behavior, but the actual generated pond still needs the existing compiler-to-headless proof. A blank cel emits an empty frame entry. An unequal-duration source is retained but refused for this legacy lowering unless an approved exact representation is shown.
3. **Kitbash:** a house recipe refers to reusable wall and roof inputs and a separately authored window override. Rebuilding after a roof edit preserves the window override and stable slots; a missing roof or an externally modified generated output stops replacement and reports the affected paths. A flattened PNG exchange preserves only the composite, not the recipe or override.
4. **External sheet:** import a PNG with left margin 5 px, 32 px cells and 2 px gap; the second column begins at x=39. Preserve the image and record the explicit `[39, 5, 32, 32]` selection, origin and grid metadata; on export report that PNG alone drops the grid and region names. A colour-key target that conflicts with an opaque pixel requires an explicit loss decision, not silent conversion.
5. **Isometric:** flat diamonds may use the separately owned flat path. Three authored faces, anchors, collision and under data remain preserved; a raised build is refused until #1846's projected composition and geometry evidence exists. Region sampling alone proves neither geometry nor draw order.

### Explicit approval and implementation gates

The owner must explicitly approve (1) source authority, identity and admitted container; (2) interchange formats, metadata and loss policy; (3) tick conversion, phase and exact supported lowering; and (4) freshness, conflict and recovery semantics, including the worked cases. Then amend the relevant normative ADR/spec, registry and schema through their owning tickets before dependent implementation. Any missing representability or end-to-end proof must remain a named gate, not a fake preview or implied runtime capability. Approval of only one row or this planning PR is not approval of the overall contract.
