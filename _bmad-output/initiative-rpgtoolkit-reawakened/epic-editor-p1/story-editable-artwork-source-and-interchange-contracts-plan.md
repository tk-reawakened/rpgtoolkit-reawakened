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

## Rulings and approval boundary

The owner approved `{source, frame, region}` for managed artwork and `{file, rect}` for plain raster, with stable native frame and region IDs. The owner approved direction is a YAML manifest plus lossless PNG pixel payloads, and the bounded first exchange: plain PNG with explicit rectangles, PNG + JSON Hash limited to frame bounds, trim geometry and durations, and no external named slices. The approval is of these directions only: exact fields, extension/version, encoding, pixel semantics, import/export algorithms, recipes, timing lowering, recovery and generated freshness below remain proposals.

The latest direction advances **plain PNG with explicit pixel rectangles** and **PNG + JSON Hash limited to frame bounds, trim geometry and durations** as the first exchange baseline. Defer external named slices, not native named regions. These exact field, extension, version, file-layout, pixel, validation, exchange, and publication rules below are **proposals for review**, not rulings. Merging this plan does not register a contract, approve a final wire shape, authorize 13.22 implementation, or close #2320.

### Approved references and proposed semantics

Use one closed, mutually exclusive sample: managed `{source, frame, region}` or raster `{file, rect}`. Both paths are project-relative. A managed sample never carries a second crop or generated raster path. Tile transparency and playback stay outside both reference records.

```yaml
managed: {source: art/village-pond.tkrart, frame: ripple-01, region: bank-ne}
raster: {file: art/imported/odd-grid.png, rect: [39, 5, 32, 32]}
```

`managed` and `raster` are labels for alternatives, not wrapper fields; `.tkrart` remains a candidate extension. Frame IDs are unique within a source, region IDs name one logical region within that source, and geometry is recorded in each frame. Renames, reorder and geometry changes do not change IDs. A duplicate frame gets a new ID. Missing per-frame region geometry is an error, not inherited. Moving a named region changes consuming crops on rebuild. A missing source, frame or region preserves the authored reference and never selects a neighbour.

## Proposed native wire

### Stamp, path, identity and records

This is a candidate standalone document: `.tkrart`, `contract: artwork-source`, `version: 1.0.0-pre.1`; the extension and stamp must agree. It is a document, not plugin data or a PNG sidecar inferred from a filename, because tiles and recipes refer to its ID ([native document test](../../../docs/spec/formats/native-contracts.md#block-or-document)). Use one UTF-8 YAML mapping and the shared [stamp, version, path identity and preservation rules](../../../docs/spec/formats/native-contracts.md#stamp). Preserve shared `tags`, `metadata`, and `pluginData`. Core keys are closed and ordered; every field below, including empty lists and `recipe: null`, is required. Reject duplicate keys, aliases, anchors, merge keys, explicit tags and unsupported core versions/shapes. Opening never upgrades.

The source ID is its project-relative path including extension, using the shared ASCII-folded identity and rename behavior. Proposed stricter source-path rules: write normalized lowercase ASCII paths with `/`; non-ASCII path characters remain case-sensitive. Refuse absolute paths, URI/drive forms, `..`, backslashes, control characters, folded collisions, ambiguous resolution and resolution outside the project through host links. Normalize empty or `.` segments as shared native paths do; reject an empty result. Plugin-owned strings are not interpreted as paths.

| Record | Proposed exact core fields and meaning |
|---|---|
| Source | `canvas: [width,height]`; `layers: Layer[]`; `regions: Region[]`; `frames: Frame[]`; `retired: {layers: Id[], frames: Id[], regions: Id[]}`. At least one frame. |
| `Layer` | `{id,name,visible,opacity}`: local ID, non-empty display name, boolean, integer `0..255`. Array order bottom to top. |
| `Region` | `{id,name}`: source-local ID and non-empty display name. |
| `Frame` | `{id,name,durationMs,cels,regions,recipe,overrides}`: ID, non-empty name, positive integer ms, `Cel[]`, `RegionRect[]`, `Recipe|null`, `Patch[]`. Array order is art-preview/exchange order, not tile playback. |
| `Cel` | `{layer,png,offset}`: existing layer ID, native payload path, `[x,y]`; unique layer per frame. Missing cel draws nothing. |
| `RegionRect` | `{region,rect}`: existing region ID and `[x,y,width,height]` in this frame's composite canvas; unique per region, no inheritance; overlap allowed. |
| `Recipe` | `{inputs}`: nonempty ordered `{sample,offset}` list. Each `sample` is exactly one approved reference shape. This is raster assembly, not a terrain/projection program. |
| `Patch` | `{png,offset}`: native PNG path and destination `[x,y]`. Array order is application order; patch pixels replace, including alpha-zero erase. |

`Id` matches `[a-z][a-z0-9-]{0,63}`. Layer, frame and region namespaces are separate and unique within the source. IDs do not change with labels, order, geometry or pixel edits. Duplicating a frame makes a fresh frame ID; a new logical region gets a fresh region ID. Deletion retires IDs; active and retired sets cannot overlap. Reuse requires explicit undo/restore of that same entity. This applies to layer IDs too. Recipe dependency graph uses `(source,frame)` nodes; reject cycles before compose. Persistent terrain rules, anchors, collision and walk-behind stay with tile/tileset owners.

### Pixel coordinates, alpha, bounds, and payload

- Integers are top-left origin, x right, y down. Rectangles are half-open, nonnegative origin, positive dimensions, wholly within source. No source crop clips, resizes, rotates or guesses a grid. Signed placement offset `[-8192,8192]` locates stored top-left pixel; clip only at destination canvas.
- Proposed aggregate refusal bounds for the source and transitive recipe dependencies: UTF-8 YAML <=4 MiB and <=32,768 core nodes; dimensions <=8,192 each and <=16,777,216 pixels per raster/canvas; duration `1..2,147,483,647` ms; <=128 layers, <=4,096 regions, <=1,024 frames, <=4,096 cels, <=8,192 region rectangles, <=4,096 recipe inputs and <=4,096 patches. Sum unique decoded raster inputs <=16,777,216 pixels (64 MiB RGBA); sum all frame canvases <=16,777,216 pixels. Sum unique managed encoded PNG payloads across the complete dependency closure <=512 MiB, each <=128 MiB; count each distinct canonical normalized payload path once (its filename embeds the digest). Stat sizes are preflight only. Read each opened payload through a bounded stream into non-managed staging, charging observed bytes before accepting every chunk against both per-file and aggregate caps; abort on overflow/change. Hash the staged bytes and verify the filename digest, then decode only that verified staged content within its checked dimensions. Compose <=67,108,864 pixel visits per build. Stream frames; cap live RGBA buffers at 256 MiB. Hash import/export also cap 1,024 frames, 16,777,216-pixel sum each for frame canvases, atlas and decoded inputs, 67,108,864 pixel copies and 256 MiB live buffers; every selected, managed or generated PNG is <=128 MiB, JSON <=1 MiB. Check counts and overflow-safe arithmetic before allocation; detect cycles before loading. Any exceeded bound refuses before managed writes/publication; this is an enforceable proposal limit, not a catch-after-allocation target.
- Native payloads are immutable `.tkr-artwork-pixels/<lowercase-sha256-of-complete-PNG-bytes>.png`. Validate digest before reuse. Manifest references only; don't infer ownership, overwrite, or auto-delete by name. Source rename rewrites references, not payload names. Package exclusion remains an admission decision.
- Native managed payloads are canonical PNG: exactly `IHDR`, one or more `IDAT`, `IEND`, valid CRCs; static non-interlaced 8-bit RGBA type 6; no other chunks. Encode decoded samples as straight RGBA in sRGB; preserve all channels in stored payloads. No profile conversion. Missing stored pixels are zero RGBA. Fully empty cel may be omitted; blank frame remains explicit.
- Compose transparent zero canvas: ordered recipe inputs, visible cels bottom-to-top, then patches. Source-over is full opacity for inputs, cel alpha is scaled by layer opacity. For source alpha `s`, opacity `o`, destination alpha `d`: `a=roundHalfUp(s*o/255)`, `n=a*255+d*(255-a)`, result alpha `roundHalfUp(n/255)` and each straight channel `roundHalfUp((src*a*255+dst*d*(255-a))/n)` (`0` when `n=0`). `roundHalfUp(n/d)=floor((n+floor(d/2))/d)`. Normalize zero-alpha composite pixels to zero RGBA. This is encoded-space blend, not linear-light; compositing loses hidden layer RGB. No implicit key, palette, mask, group, scaling or blend mode.

### Save, failure, recovery and generated freshness

Use [ADR 0022 D4](../../../docs/adr/0022-shared-editor-authoring-contracts.md#d4-operations-that-touch-several-documents) and [D12 checkpoint groups](../../../docs/adr/0022-shared-editor-authoring-contracts.md#d12-history-and-checkpoint-groups), not a new atomic transaction. Capture source revision and referenced PNG bytes; validate all destinations, compare disk baselines, then durably record prior manifest, intended writes and created paths in the group before first write. Verify/reuse payload bytes; write new immutable PNGs in path order; publish manifest last through authoritative text document. Mark that revision clean only after durable host receipt for its manifest and every new payload. Later edits stay dirty. Preserve unknown plugin bytes and unrelated text by owned splices; refuse if unable.

On conflict retain both local dirty work and external bytes. Stop at first failed write, show per-file written/reused, failed and pending. Before manifest publication old manifest/payloads remain referenced; orphan writes may remain. During manifest write, incomplete bytes may remain: reading them back is no durability guarantee. Prior revision is recoverable only if the checkpoint really contains its bytes and dependent payloads. Never delete unreceipted or referenced files automatically. Retry against refreshed baseline. Ordinary image-file history coverage is not assumed; checkpoint every managed source payload write and report when recovery is unavailable. #2321 owns host-level save/reopen/failure proof.

Output owner declares targets and allocations, never inferred by file name. Artwork document contains no runtime slots, target paths, caches or save timestamps. Target owner tracks freshness outside authored YAML: generator/version, target binding, sorted transitive `(path,SHA-256(input bytes))`, and emitted output SHA-256. Current only if all match present inputs and output. Dirty/unresolved inputs, external mutation, missing output or partial write mean stale/conflict. Preflight targets and refuse overwriting sources or outside edits. Stop on write failure and list per-file results. A successful subset is not a current build/export; don't launch/package target as successful. This rebuildable record is not a second authoring authority or new format here.

## Proposed first exchange profile

**PNG alone:** a standalone external raster or sheet is an explicitly selected, read-only `{file,rect}` input; this contract does not rewrite the original image or claim to preserve its source bytes inside the managed document. A user-selected import into a new managed source decodes the selected rectangle and stores canonical RGBA PNG payloads; the external original remains untouched. No crop means full image. Rectangles, additional frames and durations are explicit. A grid tool may calculate choices, but PNG conveys no grid, margins, gaps, names or timing. PNG export is a new composite image containing only pixels; it does not update the native source.

**PNG input:** Common exchange accepts static non-interlaced PNG types 0, 2, 3, 4, 6 at 8 bits and grayscale/indexed 1/2/4 bits. Expand grayscale to equal RGB, indexed through palette, honor `tRNS` and alpha, otherwise alpha 255. No key guessing. Accept sRGB tag or untagged; refuse ICC, explicit non-sRGB transfer/chromaticities, APNG, 16-bit, interlaced or unknown pixel encodings. Decode only after per-file and aggregate caps; when explicitly imported as managed artwork, synthesize new canonical type-6 RGBA payload bytes from decoded samples. The external original is untouched and its ancillary metadata/encoding are not carried into managed payloads. Copying as a plain external raster preserves original bytes by not writing them. This does not approve legacy color-key conversion or a same-version raster writer.

**PNG + JSON Hash:** user selects exact image and one UTF-8 JSON object (<=1 MiB). Top-level keys are exactly `frames` (required) and `meta` (optional); reject duplicates before projection. Require nonempty `frames` object. JSON object order is not a general interchange guarantee: require an explicit creator-supplied total ordering of frame keys for every import, otherwise refuse; never infer order from key names. Each frame has exactly `frame,rotated,trimmed,spriteSourceSize,sourceSize,duration`; key is a nonempty exporter name, never native ID. Require `rotated:false`, boolean trimmed, positive integer ms; closed integer rect `{x,y,w,h}` and size `{w,h}`. Check PNG dimensions and all overflow-safe bounds, equal frame/trim dimensions, one sourceSize, and `trimmed:false` only with full-canvas bounds. Reconstruct zero-filled canvas by copying atlas rect at trim offset. Assign new native IDs in explicitly accepted order; infer no named regions. `meta` does not define pixels: reject `meta.scale` except `1`/`"1"`; if `meta.size` exists require match; never follow `meta.image`, use selected paired PNG. Ignore/report other `meta` keys.

Apply the aggregate bounds above to both Hash import and export; enforce them before allocations. Ignore and report named slices, tags, pivots, layers, padding/grid intent, exporter keys and unknown extension data; external named slices are deferred. Reject malformed fields, unsupported encoding, rotation, bounds mismatch, mixed canvas, file mismatch or limit violation before writing, with file/field location. JSON Array and editable third-party project binaries are outside baseline.

Export each native composite in source-frame order within the same aggregate frame/canvas/operation/working-buffer limits. At composition, normalize zero-alpha pixels to zero RGBA, so hidden RGB in source cels is already lost before Hash export; trimming to the minimal bounding rectangle whose alpha is nonzero (blank frame uses `[0,0,1,1]`) causes no further hidden-RGB loss. Pack left-to-right, top-aligned, zero margin/gap; refuse atlas over limits. JSON Hash keys are `frame_000001.png` etc., `rotated:false`, truthful trim fields, original duration and `meta` `{image:<PNG basename>,format:"RGBA8888",size:{w,h},scale:"1"}`. This pair is not atomic: preflight outputs, write PNG then JSON, stop at first failure, report each path as written/failed/pending with retry-remaining/leave-as-is. Partial pair is not successful exchange. Export never modifies the source; import never overwrites a managed source, and its partial writes are reported/recoverable via ADR 0022, not rollback. Hash round-trips the normalized composite RGBA, canvas, order and durations, not original PNG bytes, atlas packing, layers, IDs, recipes, patches, region names, padding/grid intent or ignored metadata. Report each excluded category. No third-party named slices.


### Reference examples

Roof: frame `rest` at 64x32 holds `roof-west` rect `[0,0,32,32]` and `roof-east` rect `[32,0,32,32]`; tiles sample both stable IDs. Layer/opacity changes regenerate both; deleting east makes consumer fail and never current. PNG exchange keeps composite only. The digest strings in the YAML illustration stand in for authored payload bytes, not supplied fixtures. Water: three frames `ripple-01`, `blank`, `ripple-02`, each with west/east region rects; blank frame has zero cels but remains explicit. Tile timelines independently allocate slots `1,2,3` west and `4,5,6` east and reference 200 ms cels phase zero. Existing proof maps first/blank/second/loop at ticks `0-11/12-23/24-35/36` for a 5 fps `.tan`. 70/130/250 ms survive as source/exchange data but cannot be silently rounded into that legacy target.

```yaml
contract: artwork-source
version: 1.0.0-pre.1
canvas: [64, 32]
layers:
  - {id: shingles, name: Shingles, visible: true, opacity: 255}
  - {id: shadow, name: Shadow, visible: true, opacity: 128}
regions:
  - {id: roof-west, name: West roof}
  - {id: roof-east, name: East roof}
frames:
  - id: rest
    name: Rest
    durationMs: 200
    cels:
      - {layer: shingles, png: .tkr-artwork-pixels/1111111111111111111111111111111111111111111111111111111111111111.png, offset: [0, 0]}
      - {layer: shadow, png: .tkr-artwork-pixels/2222222222222222222222222222222222222222222222222222222222222222.png, offset: [0, 0]}
    regions:
      - {region: roof-west, rect: [0, 0, 32, 32]}
      - {region: roof-east, rect: [32, 0, 32, 32]}
    recipe: null
    overrides: []
retired: {layers: [], frames: [], regions: []}
```

Kitbash: 64x64 recipe assembles wall raster `[0,0,64,32]` at `[0,32]`, roof west/east managed 32x32 regions at `[0,0]`/`[32,0]`, then 8x8 window patch at `[28,40]`. Roof rebuild preserves patch; dependency cycle blocks composition; flattening loses inputs/offsets/patch.

External odd-grid: PNG selection `[39,5,32,32]` from margin 5, cell 32, gap 2; require image at least 71x37. Grid intent isn't stored. Given recorded LibreSprite example, frame 2's atlas rect `[16,5,2,3]` restores at source offset `[2,3]` onto 9x7, not atlas or origin coordinates. Preserve partial alpha. Out-of-bounds crop rejects; repack can change atlas only.

```json
{
  "frames": {
    "frame_0.png": {"frame":{"x":5,"y":5,"w":3,"h":3},"rotated":false,"trimmed":true,"spriteSourceSize":{"x":1,"y":1,"w":3,"h":3},"sourceSize":{"w":9,"h":7},"duration":70},
    "frame_1.png": {"frame":{"x":10,"y":5,"w":4,"h":2},"rotated":false,"trimmed":true,"spriteSourceSize":{"x":4,"y":2,"w":4,"h":2},"sourceSize":{"w":9,"h":7},"duration":130},
    "frame_2.png": {"frame":{"x":16,"y":5,"w":2,"h":3},"rotated":false,"trimmed":true,"spriteSourceSize":{"x":2,"y":3,"w":2,"h":3},"sourceSize":{"w":9,"h":7},"duration":250}
  },
  "meta": {"image":"sheet-horizontal.png","format":"RGBA8888","size":{"w":23,"h":13},"scale":"1"}
}
```

Isometric: optional source regions `top/left/right` may select `[0,0,32,32]`, `[32,0,32,32]`, `[64,0,32,32]` on a 96x32 sheet. These are pixel crops, not projected geometry. Flat diamond may use current flat output; raised build refuses until #1846 establishes projection, draw order, collision, walk-behind in both layouts. Faces/anchors/geometry remain authored; raster exchange loses names/geometry.

## Owner decision packet — proposal, not ruling

Review and explicitly approve or amend the proposed wire details above before any normative specification, registry/schema or #2321 implementation. Plan merge alone ratifies none of those details.
**Decision requested:** explicitly approve or amend the proposed source ownership, interchange, timing/lowering and preservation rules before they are made normative. Merging this plan approves none of the proposed wire details and does not close #2320. Terrain-design direction is context, not contract approval.

### Status and dependencies

| Item | Status and boundary |
|---|---|
| First exchange | **Ruled direction:** native manifest + lossless PNG payloads; plain PNG with explicit rectangles; PNG + JSON Hash only for bounds, trim and durations; defer external named slices; native stable IDs remain. Per-file wire and exchange algorithms remain proposals. |
| Interchange IDs/order | **Proposed:** exporter keys never supply native IDs; every import requires explicit creator-supplied total frame ordering, otherwise refuse. JSON member/key order is never implicit. |
| Output slots and raised isometric | **Ruled in [#1846](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1846#issuecomment-7040777980):** stable explicit slots, no implicit renumbering or reuse; flat terrain can proceed independently. Preserve raised source and refuse its build until projected overlay is specified and proven. Do not re-decide or implement that work here. |
| Prerequisites | Asset-pack 27.12 [#1847](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1847) is complete. Tileset 27.11 [#1846](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1846) remains open for owner review of the current pre-release [tileset contract](../../../docs/spec/formats/native-tileset.md), although filename cutover, retained output slots and substantial compiler work have already landed. Prep and a ruling can proceed now; formal 13.21 closure still requires its declared prerequisites, approved normative contract and acceptance evidence. |
| Downstream creator journeys (not 13.21 gates) | Open [#2324](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2324) (13.25) explicitly owns the multi-cell water authoring, save/reopen and independent runner-state acceptance. Open [#2326](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2326) (13.27) owns terrain-recipe generation and sandbox creator acceptance, downstream of 13.26 → 13.23 → 13.3 → 13.22 → 13.21. Neither broader creator journey gates 13.21 closure. Do not route new work to already-closed [#1733](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1733) or [#1851](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1851); [#2321](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2321) owns persistent source editing. |


**Disposable storage probe (not shipped behavior).** In a deterministic 128-cel sparse fixture (256×192 canvas, repeated 16×12 motifs), all tested representations reconstructed exact RGBA. PNG payload plus manifest: full canvas 6,371,481 bytes/129 files with stored-deflate, 84,055/129 with zlib level 6; cropped with offsets 81,831/129 and 72,159/129; cropped plus sharing identical PNG payloads 23,005/17 and 21,796/17. Counts include manifest. Pixel edit rewrote one payload (full: 49,764 or 653 bytes; cropped: 624 or 544); move-only edit changed manifest only for cropped forms, while full-canvas rewrote its PNG. A separate alpha-only raw-raster crop check lost `[83,21,5,0]`; it shows why raw raster cropping cannot preserve hidden RGB. The proposed compositor instead normalizes zero-alpha output pixels, so source-layer hidden RGB is lost at composition and Hash trim adds no further loss. Probe used existing repository PNG encoder/decoder and YAML parser with Node 26.13.0, fflate 0.8.3, zlib 1.2.12. Synthetic results are not general size guarantees.

**Interchange evidence (owner-provided).** Local Aseprite `1.3.18.6-arm64-trial` refused Save; no real odd-grid or moving-slice export/re-export was verified. Official [CLI](https://www.aseprite.org/docs/cli) Hash/Array and `--list-slices` documentation and [published example 1](https://gist.github.com/dacap/db18e5747a4b6e208d3c) / [example 2](https://gist.github.com/dacap/a32adb9248320326733a) show frame/duration/trim/source-offset and slice key/bound shapes, insufficient to approve interchange. A full licensed Aseprite exporter run is needed only before claiming modern-Aseprite compatibility or adding deferred external named-slice support; it is not a gate for the plain-PNG/explicit-rectangle and bounded PNG+JSON Hash first exchange. Flattened PNG carries pixels and explicitly declared metadata only—not inferred stable IDs, layers, or grid intent.

**LibreSprite export evidence (independently verified).** LibreSprite 1.3 arm64 exported the supplied fixture in JSON Hash format. The Aseprite trial limitation above remains: it is separate and was not worked around. Reproducible invocations (with `$D` set to the fixture/export directory):

```sh
LIBRESPRITE=/Applications/LibreSprite.app/Contents/MacOS/libresprite
"$LIBRESPRITE" --batch --sheet "$D/sheet-horizontal.png" --data "$D/sheet-horizontal.json" --format json-hash --sheet-type horizontal --trim --shape-padding 2 --border-padding 5 --filename-format 'frame_{frame}.png' "$D/fixture.aseprite" -v
"$LIBRESPRITE" --batch --sheet "$D/sheet-rows.png" --data "$D/sheet-rows.json" --format json-hash --sheet-type rows --trim --shape-padding 2 --border-padding 5 --filename-format 'frame_{frame}.png' "$D/fixture.aseprite" -v
```

Both PNGs are 23×13 RGBA8888 and decode to identical pixels. JSON Hash records three generated keys (`frame_0.png`–`frame_2.png`) with atlas rectangles `(5,5,3,3)`, `(10,5,4,2)`, `(16,5,2,3)`, `trimmed: true`, `rotated: false`, source canvas 9×7, source offsets `(1,1)`, `(4,2)`, `(2,3)`, and durations 70, 130, 250 ms. The rectangles and command options corroborate 5 px outer padding and 2 px inter-frame gaps for both tested layouts. Decoded PNG alpha has 287 alpha-zero pixels, 9 alpha-255 pixels, and 3 partial-alpha pixels (64, 128, 192); trim metadata preserves the source offsets, and alpha is not reduced to a color key. The JSON has no named-slice records or stable authored frame IDs; it records neither padding intent nor a grid definition, and its `meta.image` is a machine-local export path. A targeted repository search for JSON Hash metadata fields found no shipped importer, so this verifies export artifacts only—not import or round-trip support. These results do not establish behavior for packed or other padding modes; the exporter separately reports packed ignores padding, not independently re-verified here.

The artifact evidence validates explicit exported rectangles for this fixture; it does not establish named-slice support or infer grid intent.

**Refusal probes (disposable prototypes, not repository-host behavior).** In-place sequential overwrite plus injected second-companion refusal kept the old manifest but left it pointing to one new and one old payload (partial/stale). Writing immutable new payloads first and publishing the manifest last preserved old manifest and payload bytes and reopened exact old RGBA after publication refusal, leaving two orphan staged PNGs (196 bytes). This supports preserving old references while allowing orphans; neither probe proves transaction or crash atomicity. Scripts and outputs were removed after recording findings.

Flat output may proceed independently; preserve raised source and refuse raised builds pending projected-overlay specification and proof. The contradictory #1846 wording remains pending exact spec cleanup outside this PR.

Published `aseprite-io@0.1.0` is not approved for editing or untrusted input: [#2320's evaluation](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2320#issuecomment-7001367322) records four repaired upstream defects but no fixed release verification. It is not adopted as a native editable codec.
### Timing and lowering evidence at `f81cd32a4ab22c0ea59adc58e89644a7398a088c`

[PR #3248](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3248), merged as `ca1b70f873aa5cc1e9668e76dc310b47cdc9ccde`, retained ordered frames and dependencies on a held board. The [board specification](../../../docs/spec/formats/board.md#animated-tiles) describes fixed-tick selection, blank frames and shared phase. Its committed [headless runner proof](../../../packages/runner-headless/test/animated-board-playback.test.ts) uses two cells with the same 5 fps `.tan`, verifies first/blank/second/loop at ticks 0/11, 12, 24 and 36, and compares real `saveBlob`/`loadBlob` continuation with uninterrupted draws. The [repair plan](../../backlog/bug-animated-board-tiles-stay-static-plan.md) records that this proof failed on the pre-fix baseline. Thus held-board playback, those boundaries and that save continuation are proven for that fixture; they are not merely proposed.

Merged [PR #3642](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3642) proves the bounded compiler-to-player path: authored scene, two tile docs, tileset binding and ordinary PNG raster input go through the real compiler, then exact emitted board, tileset and two TAN bytes run in headless engine. The fixture checks both cell references/slots/positions, pixels including alpha-zero cel, and 200 ms phase-zero loop at ticks 0, 11, 12, 24, 36. This does not prove managed compositing, interchange, arbitrary timing, publication transaction or creator journeys.

The existing `.tan` has one speed per animation and runtime rounds `60/speed` to nearest whole tick, minimum one: 5 fps is 12 ticks/cel, 3-cel loop 36; 7 fps is 9 ticks, not exact 1/7 second ([format](../../../docs/spec/formats/tiles.md#animated-tile-tan), [hydrate implementation](../../../packages/core/src/world/hydrate.ts)). Proposed export refuses schedules it cannot exactly encode; no rounding. Transition/revisit phase beyond this bounded proof needs an approved rule and focused evidence.

**Proposed lowering seam.** Resolve managed `{source,frame,region}` to its exact composite crop; resolve raster `{file,rect}` to decoded pixels; apply the tile's existing transparency and encode to existing output formats. Artwork frame order and `durationMs` do not automatically populate tile playback. A creator must separately author the tile `timeline.frames`, cels and phase; copying/selecting source durations is an explicit creator action, not an implicit wire mapping. Gameplay follows only that tile timeline. For the current legacy target, map only these uniform phase-zero tile-timeline durations:

| Per-cel duration | `.tan` speed | Tick boundary |
|---:|---:|---|
| 50 ms | 20 fps | 3 ticks |
| 100 ms | 10 fps | 6 ticks |
| 200 ms | 5 fps | 12 ticks |
| 250 ms | 4 fps | 15 ticks |
| 500 ms | 2 fps | 30 ticks |
| 1000 ms | 1 fps | 60 ticks |

Keep numbered slots for each explicitly authored tile cel, including blank/unused, in its owner's existing allocation. The proposed artwork source has no connected-group identity, and current terrain-recipe `sync` does not define generic connected tile-animation groups. Do not require lockstep/zero phase universally: if a separately approved target contract declares such a group, its owner must specify the shared sequence/phase rule; until then connected-animation linkage remains unresolved downstream. Output is the existing `.tst` allocation table, `.tan` cel sequence, and `.brd` references. No artwork ID enters the player format and no placement/revisit phase is invented. Reject unsupported or nonuniform schedules without rounding; target implementation and broader compositing proof remain gated.


### Explicit approval and implementation gates

Review the exact proposed native fields, pixel rules, PNG/JSON Hash subset and losses, save/recovery/freshness behavior, examples and runtime boundary together. The proposal is not normative and authorizes no registry/schema or production change. Formal 13.21 closure still requires explicit approval and publication of the normative artwork contract and acceptance evidence, plus owner review of the current pre-release tileset contract for 27.11 #1846 and the declared prerequisites. #2324 water authoring/save/reopen and #2326 terrain sandbox are downstream creator journeys, not #2320 closure gates. Plan merge alone approves no final wire contract and closes no issue.
