---
type: feature
title: "Set collision and walk-behind on tiles and assets, and place packs that stay packs"
ticket: 17
created: '2026-11-21'
status: in-review
baseline_revision: 'bf348bf443572f9b7a390bdacc1c3305bdd3c925'
route: full
route_source: auto
risk: high
review: quick
review_source: pinned
lenses_ran: [quick, data-and-runtime]
context: ["docs/guardrails.md", "docs/spec/formats/native-tile.md", "docs/spec/formats/native-asset-pack.md", "docs/spec/formats/native-scene.md"]
---

# Set collision and walk-behind on tiles and assets, and place packs that stay packs

<frozen-after-approval reason="owner approved #1852 and the fence-first verification flow">

## Intent

**Problem:** Authors have to redraw collision and walk-behind regions wherever they place art. A tile-sized collision box can make a narrow fence block the entire tile.

**Approach:** In both editors, give the native asset browser access to the tile or pack asset's own collision and walk-behind editor. Place and manipulate linked pack assets as single objects in native scenes; reuse the existing compiler.

## Boundaries & Constraints

**Always:** Save geometry in the standalone `.tkrtle` tile or the owning `.tkrpack` asset, not `.tkrtst`, `.tkrscn` or `.brd`. Use the approved integer, anchor-relative vector forms, including open solid barriers and closed walk-behind regions. Save placement identity, pack path, asset ID, floor and board-pixel anchor, never a copy of the asset. Keep author text, unrelated properties, plugin data, undo and save under the owning document's lifecycle.

**Never:** Introduce a full-cell flag as another format field; infer collision from a picture; add native controls to legacy board editing; change the compiled board or player format. Unsupported lowering keeps its existing refusal.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Fence | A native tile with a narrow barrier | Edit once, paint in a scene, build; the player crosses empty parts of the tile but not the barrier. | Cancelling a draft writes nothing. |
| Walk behind | A pack asset with visible art and an under region | The built board can draw the player behind it independently of collision. | Invalid paths, coordinates and regions are rejected. |
| Place, move, copy, delete | Compatible pack asset and scene | One selectable placement retains its source; copy gets a new ID; derived records follow the build. | Missing sources remain visible and editable/removable as references, not silently dropped. |

</frozen-after-approval>

## Code Map

- `packages/native-data/src/{tile,asset-pack,scene}.ts`: validated codecs; reuse the existing text splice/preservation helper and add only scoped writer operations. See [tile geometry](../../../docs/spec/formats/native-tile.md#geometry-and-program-activation), [pack fields](../../../docs/spec/formats/native-asset-pack.md#fields), and [scene pack placements](../../../docs/spec/formats/native-scene.md#pack-placements).
- `packages/editor-model/src/{terrain-scene-project,terrain-scene-document,scene-tile-collision,scene-pack-vectors,scene-pack-images}.ts`: inventory, text commands, existing lowering. Do not change lowering without an observed defect.
- `packages/editor-ui/src/terrain-scene-view.tsx` is the shared native asset picker and scene editor. Mount owner geometry controls in both hosts. The browser uses shared document commands; VS Code uses the authoritative `TextDocument` and `WorkspaceEdit` per [ADR 0022 D2](../../../docs/adr/0022-shared-editor-authoring-contracts.md#d2--who-owns-a-documents-content).

## Tasks & Acceptance

- [x] Add native tile/pack owner source editors across hosts; verify exact unrelated bytes, cancellation and normal undo/save/reopen.
- [x] Add source navigation and native scene placement/selection/editing across hosts; verify ordered linked records and generated output on movement/copy/removal.
- [x] Prove a narrow fence and walk-behind in the built board, and the complete editing journeys in Chromium and VS Code.

Given an asset already used in more than one placement, editing its owner must change those placements' derived output on rebuild without changing the other placements' scene text.

## Implementation Notes

The runtime proof exposed [#3312](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3312): the board emitted a pack image and the correct walk-behind vector but did not redraw the image over the player. The specification amendment landed first on this branch (`49c4f655a`); the renderer now includes covered board-image rows for the pack's normal-position image draw, preserving transparent pixels and blending the sprite silhouette only once under overlapping regions.

The real Chromium journey exposed a placement draft race after Copy ([#3313](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3313)). Draft fields now derive the selected record immediately, so a deferred effect cannot replace a new coordinate. The separate pack catalogue reports malformed files without adding unrelated pack bytes as scene build dependencies ([#3314](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3314)); a scene using the bad pack still refuses the build.

## Plan Change Log

## Review Triage Log

| Finding | Verdict | Evidence and disposition |
|---|---|---|
| Both lenses: isometric pack brush used square-grid coordinates | Medium | #3316: corrected through the existing board projection helpers, with exact coordinates asserted for all layouts. |
| Quick: draft could change its owner after a source change | Medium | #3319: draft pins the owning asset. The regression removes the asset through document restore and proves no geometry is transferred. |
| Both lenses: repeated renderer lookups scaled with actors × board images | Medium | First active under vector now resolves images once per frame. Deterministic lookup budget and pixel proofs passed; wall-clock samples do not isolate the change. |
| Data/runtime: malformed unreferenced pack stopped a build | Medium | #3314: model regression proves the catalogue reports the bad file while builds only read packs they use. |
| Data/runtime: explicit empty lists refused the first placement | High | #3317: accept a valid empty list, including `writeScene` output, without rewriting surrounding comments. |
| Both lenses: valid references could appear missing | Medium | #3318: resolve the compiler's folded identity and open the canonical source; existing cross-game links resolve without becoming new palette choices. |

## Verification

Run targeted source-preservation, placement, build and runtime proof tests. Verify native editing through the live production browser workbench and the packaged VS Code Web extension. Run graph checks before pushing and require the GitHub CI gate before merging.

Local evidence on Node 24.21.0: 49 focused codec, model, UI and built-runtime assertions passed. The real Chromium and packaged VS Code Web journeys both saved, undid/redid and reopened the fence owner, placed/moved/copied a linked pack, rebuilt two placements after an owner-only edit without changing the scene bytes, and deleted one placement from the compiled board. The legacy import proofs showed the native-only explanation. Targeted typecheck and lint, the dependency graph, generated help freshness and headless goldens passed.
