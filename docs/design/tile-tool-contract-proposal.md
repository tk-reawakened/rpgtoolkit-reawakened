# Proposal: tile, tileset and tool documents

**Status: non-normative design proposal. Nothing on this page is implemented, registered, approved or schema-checked.** The registry in [native-contracts.md](../spec/formats/native-contracts.md#the-registry) holds `.tkrtile` for a tileset and has no row for a tile or a tool. No reader, writer, checker, schema or rename rule reads the YAML below. Every field name, diagnostic code and vocabulary here is a *proposed spelling* for the coordinated adoption described in [Painting a world](terrain-scene-formats.md); until that adoption is approved and the contracts in `docs/spec/formats/` are amended, the existing [tileset contract](../spec/formats/native-tileset.md) and [scene contract](../spec/formats/native-scene.md) are the only normative text.

The examples are illustrative excerpts. They are not fixtures, they are not claimed to build with any existing code, and they do not show a complete project. They were written from this repository's own specifications only (G7); [Tiled](https://doc.mapeditor.org/en/stable/manual/terrain/) and [LDtk](https://ldtk.io/docs/general/auto-layers/auto-layer-rules/) informed the problem, and neither format is adopted.

**Owner decision since this draft:** reusable tiles store explicit anchor-relative walk-behind polygons using the [asset pack vector vocabulary](../spec/formats/native-asset-pack.md#fields), separately from solid collision. This supersedes the `wallCapUnder` flag and footprint-derived walk-behind proposed below. The revised contract must allow a fence to block only at its authored solid outline while its upper artwork draws in front, without hand-drawn scene vectors at each placement. The examples below predate the decision and are not cutover fixtures.

## What this page decides, and what it leaves

It proposes concrete shapes for three documents the owner has directed: a tile (`.tkrtle`), a tileset (`.tkrtst`, the renamed `.tkrtile`) and a tool (`.tkrtol`). It proposes how they refer to each other, how animated sheets and shared phase are expressed, how missing rules and missing tools are reported, and where a tool's trust ends and a plugin's begins. It does **not** specify the scene's painted-region shape (a companion proposal owns that), the editable artwork source ([#2320](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2320)), isometric geometry, or an executable plugin interface for editor tools. The clean cutover of `.tkrtile` to `.tkrtst` (no alias, no migration tool) is the owner's direction recorded in [Painting a world](terrain-scene-formats.md); this page only says what the replacement contract would contain.

## In plain words

A **tile** is one reusable thing you can paint with. Its document says where its picture is, how it animates, and whether you can walk on it. A **tileset** is a shelf of tiles plus the terrain recipes that say which tile goes where when you paint a pond. A **tool** is a named, configurable way of painting; its document is just a description, and the thing that actually does the painting is provided by the editor or by a plugin you installed yourself. The scene keeps what you painted. A file never gains power by naming a tool or a plugin.

## One owner for every fact

The rule of this proposal is that each fact has exactly one authoritative home. Other documents *refer*; they never restate. Where a second document must check a fact, it states a *constraint* that is verified, never silently reconciled.

| Fact | Single owner | Others may |
|---|---|---|
| Picture bytes | the image file for a standalone raster; for layered or managed artwork, the editable artwork source, whose contract ([13.21](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2320)) is not yet specified (see [managed artwork](#managed-artwork-and-pixel-representability)) | Refer to it by path |
| Which pixels are this tile (its rectangle, or its cels) | the **tile** | Nothing; there is no sheet-wide grid |
| Tile size | derived from the tile's rectangle | A tileset may *expect* a size and report a mismatch |
| Animation timeline and its own phase offset | the **tile** | A tileset may *require* lockstep and report a mismatch |
| Collision, role, `wallCapUnder` | the **tile** | A tileset never repeats them |
| Which tiles belong to a palette | the **tileset** (`tiles`) | A scene refers to a tile directly |
| Terrain recipe: neighbour model, rules, variants, coverage promise, pinned resolver | the **tileset** (`terrains`) | A scene refers to `{tileset, terrain}` |
| Role of a tile *within a terrain* (edge, corner, fill) | the **tileset rule that names it** | A tile never declares a terrain role, because one tile can play different roles in different terrains |
| Painted coverage, floor, explicit placements and overrides | the **scene** | A build reads it |
| Tool's display name, parameter declarations, targets, named implementation | the **tool** | The editor reads it |
| Tool's code | the **host** (built in) or an **installed plugin** | A tool document names it; it never contains it |
| Plugin-private state | `pluginData.<plugin id>` of the document it describes | Preserved when the plugin is absent |
| Generated `.tst`, `.tan`, `.brd`, PNG, build report | the **build** | Never an editable authority, never read back as input |

Rejected duplications, each of which would give a fact two homes: a tileset that copies a tile's collision or art; a tile that names its terrain role; a sheet grid stored beside per-tile rectangles; a tool that stores a default terrain or recipe; a scene that stores generated tile choices as the source of a region (the scene keeps coverage and explicit overrides, see [Painting a world](terrain-scene-formats.md#scene-retain-intent-and-hand-work)); an output slot table that the build rewrites and then treats as input.

Also rejected: a tool that deletes manual work as a side effect of painting (clearing an override is the editor's explicit action); and a variation key built from labels that can be renamed without changing a recipe (rule ids, terrain ids).

## Stable references

All documents are identified by their project-relative path with extension, as the [shared identity rules](../spec/formats/native-contracts.md#identity) already say. This proposal adds no document-level `id` anywhere.

| Reference | Spelling (proposed) | Resolves to | Rename effect |
|---|---|---|---|
| A tile | `{tile: tiles/water/fill.tkrtle}` | one registered `.tkrtle` whose stamp says `tile` | Renaming the file rewrites every such mapping |
| A terrain | `{tileset: tiles/village.tkrtst, terrain: pond-water}` | one `terrains[].id` in one `.tkrtst` | Renaming the file rewrites `tileset`; renaming the id rewrites `terrain` |
| A cel inside a tile | `cel: ripple-1` (a scalar, document-local) | one `cels[].id` of the same tile | Local; never crosses a document |
| A rule inside a terrain | `id: outer-nw` (document-local) | one rule of that terrain | Local label used in diagnostics. It is **not** a variation input, so renaming it never changes selected art |
| A tool | by path, `tools/terrain-brush.tkrtol` | one registered `.tkrtol` | Nothing in a scene, tile or tileset names a tool (below) |
| An implementation (tool or resolver) | `{provider: builtin, id: …, version: …}` or `{provider: plugin, plugin: …, id: …, version: …}` | a host-provided implementation | A plugin id is never a path and is never rewritten ([identity rule 8](../spec/formats/native-contracts.md#identity)) |

Consequences, all proposed:

1. **A tile is referenced by its document path alone.** This replaces the existing `{tileset, tile: local-id}` spelling, because a standalone `.tkrtle` must not depend on a tileset that happens to list it; otherwise the tile would have two competing identities, its path and its local id inside a particular tileset. A terrain keeps the two-field spelling because its local id genuinely lives inside the tileset document, as the [existing contracts](../spec/formats/native-tileset.md#references-and-identity) already spell it. No fragment syntax (`path#id`) is introduced.
2. **One finder, one inventory.** Every place a tile reference may occur is a mapping with the key `tile` whose value is a path. The inventory of locations is shared with the [scene proposal](terrain-scene-contract-proposal.md#where-references-are-replacement-and-additions) and is exactly: `tilePalette[].tile`, `floors[].boundarySources.walkableTiles[].tile` and `tileOverrides[].tile.tile` in a scene; `tiles[].tile`, `terrains[].rules[].use.tile` and `terrains[].rules[].variants[].tile` in a tileset; and for terrains, `terrainRegions[].terrain.tileset` and `terrainRegions[].terrain.terrain` in a scene. A rename of a tile document must change every one of those scalars and nothing else. Rename fixtures must show, for each location, the changed scalar and, unchanged, the surrounding comments, quoting, key order and every `pluginData` byte. The tool cannot find a reference inside `pluginData` or a script, and must say so rather than imply completeness ([rename](../spec/formats/native-contracts.md#rename)).
3. **Moving a tile inside its sheet keeps its identity.** The tile's path is unchanged and only its `rect` is edited. Until the editable artwork source defines stable region identifiers, a region is a pixel rectangle; this proposal invents no region id and does not equate a rectangle with an identity that survives repainting the sheet.
4. **Deleting or retargeting a referenced tile lists its known uses and the places it cannot search**, and never redirects silently. A missing or ambiguous target is diagnosed, not substituted ([Painting a world](terrain-scene-formats.md#tiles-and-terrain-recipes)).
5. **A `.tkrtol` references no other native document.** It names an implementation and nothing else, so no tool rename or removal can dangle a scene, tile or tileset reference, and no document needs a "which tool made this" field.

## The tile document (`.tkrtle`)

A proposed contract name `tile`, one document per tile. Closed top-level fields: the stamp, `name`, `projection`, `role`, `collision`, `wallCapUnder` (optional), `kitbash` (optional, carried over unchanged from the [tileset contract](../spec/formats/native-tileset.md#tile-art-operations)), `visual`, and the shared optional `tags`, `metadata`, `pluginData`. `role` and `collision` keep the vocabularies of the existing tile record.

A still tile, one rectangle of a sheet:

```yaml
# tiles/grass/main.tkrtle — proposed shape, not a valid fixture for any reader
contract: tile
version: 1.0.0-pre.1
name: Meadow Grass
projection: 2d
role: floor
collision: walkable
visual:
  file: art/village-sheet.png
  transparent: {mode: alpha}
  rect: [0, 0, 32, 32]            # [x, y, width, height] in source pixels
```

An animated tile, a connected-water piece whose frames come from cels in one sheet:

```yaml
# tiles/water/fill.tkrtle — proposed shape, not a valid fixture for any reader
contract: tile
version: 1.0.0-pre.1
name: Pond water, open
projection: 2d
role: floor
collision: solid
visual:
  file: art/pond-sheet.png
  transparent: {mode: alpha}
  cels:                            # drawn pictures, in no particular order
    - {id: ripple-0, rect: [0, 0, 32, 32]}
    - {id: ripple-1, rect: [32, 0, 32, 32]}
    - {id: ripple-2, rect: [64, 0, 32, 32]}
  timeline:                        # the order and durations the author intends
    phaseMs: 0
    frames:
      - {cel: ripple-0, ms: 250}
      - {cel: ripple-1, ms: 250}
      - {cel: ripple-2, ms: 250}
      - {cel: ripple-1, ms: 250}   # a cel may be used again
```

A hand-painted bank, referenced by a scene as an explicit placement and not part of any terrain rule:

```yaml
# tiles/water/bank-mossy.tkrtle — proposed shape, not a valid fixture for any reader
contract: tile
version: 1.0.0-pre.1
name: Mossy bank
projection: 2d
role: decorative
collision: walkable
wallCapUnder: false
visual:
  file: art/pond-sheet.png
  transparent: {mode: alpha}
  rect: [0, 96, 32, 32]
```

Rules, all proposed:

1. `visual` has `file`, `transparent` (alpha or colour key exactly as in the [existing source rule](../spec/formats/native-tileset.md#sources)) and **exactly one** of `rect` (a still tile) or `cels` plus `timeline` (an animated tile). A tile with neither, or both, is an error.
2. There is **no `size` field and no sheet grid.** A tile's pixel size is the size of its rectangle; every cel of one tile has the same size, or the tile is an error. A tileset that expects `cellSize` verifies it; it does not own it.
3. All coordinates are exact non-negative integers. Every rectangle has width and height of at least 1; a zero-width or zero-height rectangle is `tile-rect-invalid`. A rectangle must lie inside the image after decoding, or the tile is reported `tile-art-out-of-bounds`. Partial or implied cells do not exist, because no grid exists.
4. `cels` is a non-empty ordered list with unique local ids (lowercase kebab-case). Every `timeline.frames[].cel` must name one; every cel need not be used (an unused cel is a note, not an error).
5. `wallCapUnder` reuses the spelling and meaning of the [isometric-block field](../spec/formats/native-tileset.md#isometric-blocks): an under region for the tile footprint, independent of `collision`. At the time of this proposal, geometry for standalone isometric tiles was not designed. See the [current raised-art limits](../spec/formats/native-tileset.md#not-decided-here).
6. A tile with an `.tkrtle` extension whose stamp is not `tile`, or the reverse, is the existing extension/contract mismatch problem.

### Managed artwork and pixel representability

**Managed artwork.** In this shape `visual.file` names a **standalone raster whose pixels are authoritative**. The editable artwork source (layers, frames, regions; [13.21](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2320)) is not specified yet, and the [graphics design](native-graphics-authoring.md#editing-and-identity) says a raster generated from a layered source is a build output, not a second editable authority. A file path plus a rectangle cannot select a source frame, and nothing in this shape lets a reader tell an ordinary raster from a managed export. **This proposal infers nothing from file names or locations.** Therefore a tile is authored against a standalone raster only. Binding a tile to a managed source needs a source-owner reference and a frame selector from the artwork contract, added to `visual` as a declared dependency of that contract and not invented here. Once that contract can identify a file as the export of a managed source, a tile that names such a file as `visual.file` is a problem (`tile-art-managed-output`) and a build must refuse a stale export rather than build from it. Until then the responsibility is the author's, and the editor must not present a managed export as a standalone raster.

**Pixel representability.** A tile document accepts any positive rectangle, but a tileset's legacy output cannot. Before writing a generated `.tst`, the build validates every emitted crop against the tileset's `outputBinding.detail`, using the [tile data table](../spec/formats/tiles.md#tile-data), and refuses with a located problem naming the tile, the cel and, for a pixel, its coordinates. It never resizes, resamples, quantizes or alters a pixel to make a crop fit.

- **Size** (`tile-output-size-mismatch`): detail 1, 3 and 5 need exactly 32×32; detail 2, 4 and 6 need exactly 16×16 (drawn doubled). Detail 150 (isometric) is not designed here.
- **Transparency, details 1 and 2** (`tile-output-pixel-unrepresentable`): the target has no alpha and reserves opaque RGB (0, 1, 2) as the transparent colour. In alpha mode every pixel must be fully transparent (written as that colour) or fully opaque; a partly transparent pixel, or an opaque pixel whose RGB is (0, 1, 2), has no exact mapping. In colour-key mode the key colour is written as the transparent colour, and a non-key pixel whose RGB is (0, 1, 2) is refused the same way.
- **Details 3 to 6** (`tile-output-pixel-unrepresentable`): transparency is index 255, and every opaque pixel must be exactly a [DOS palette](../spec/formats/tiles.md#dos-palette) colour other than index 255 (the first sixteen entries only for details 5 and 6); no nearest-colour choice is made.

## Animated sheets and cels

Four words, used consistently:

| Word | Meaning |
|---|---|
| **Sheet** | An image file. It may hold the cels of one tile or of many; its layout is not stored anywhere but in the rectangles that point into it. |
| **Cel** | One drawn picture: a rectangle of a sheet, with a local id. |
| **Frame** | One entry of a timeline: a cel and a duration. The same cel may appear in many frames (the example above lists `ripple-1` twice, which is how a ping-pong order is written). There is no separate loop mode in this proposal. |
| **Timeline** | The ordered frames of a tile, repeating from the first frame after the last. |

**Time is exact.** A frame's `ms` is an integer of at least 1. The cycle length is the sum. The clip contract's `delay` is a floating number of seconds with one value for all frames ([clip time](../spec/formats/native-animation-clip.md#rules)); this proposal deliberately uses per-frame integer milliseconds so equality and phase comparison are exact (G3), and does **not** claim a tile timeline is an animation clip or converts to one.

**Phase.** `phaseMs` (default 0) is the tile's own offset into its cycle at board time zero, an integer in `[0, cycle)`. No per-placement or random phase exists, because it would not be reproducible from authored data. **Nonzero `phaseMs` is valid authored data but has no lowering to the legacy target.** `.tan` has no phase field, so a nonzero value is refused for **every** animated tile that would be built, whatever its terrain's `sync` value and whether the tile is reached directly or through a rule, with `animation-phase-unrepresentable`. It stays refused until a mapping that also preserves the static first frame is specified and shown on the target. Independent phase is not offered; an author who wants a different start writes a different timeline whose first frame is the intended static look.

**Connected pieces share one phase by a tileset requirement, not by copying.** A terrain may declare `sync: lockstep`. Under it, every tile the terrain's rules use must have the same cycle length, the same sequence of `ms` and the same `phaseMs`; the check reports `terrain-sync-mismatch` and names the first differing tile. That is a check of authored documents only. The tile still owns its timeline: the tileset states a requirement and never overrides a tile's frames. `sync: independent` says only that no coordination is required between the terrain's tiles; it offers no independent phase and does not lift any gate below. Connected animated water that stays in step is a goal of this proposal. It is **gated**, not dropped and not approximated: it needs the playback proof described next, which does not exist, and this page makes no claim that any current runtime plays such tiles or keeps them in step.

**What must be shown before a build lowers an animated tile.** Two different kinds of fact bound the lowering, and the first never proves the second. *Encoding* facts come from the [`.tan` format](../spec/formats/tiles.md#animated-tile-tan): one integer speed `1..200` (frame delay `1000 / speed` ms), a frame list of tile references, empty frames allowed, each frame's tile [in its own slot](../spec/formats/board.md#animated-tiles). *Runtime* facts are what the target does when it plays the built board. A correctly written `.tan`, including an exactly representable speed, shows that a file is well formed; it does **not** show that anything animates. This page makes **no claim that any current runtime plays an animated tile or keeps several in step.** Reading `packages/core/src/world/hydrate.ts` (not executed), the hydrated board selects one frame with `frameAt` when the board is hydrated and stores it as an ordinary tile, so a lowered `.tan` may show a static frame; the scene proposal records the same reading with `compose.ts` ([animated lowering](terrain-scene-contract-proposal.md#animated-lowering-proposed)). That is evidence for the gate, not a finding that anything is or will be fixed. Behavior on the target must be proven before the build lowers anything animated. Whatever is not proven or not exact is refused with a located problem and is never rounded, merged, dropped, approximated or left to chance. None of this exists as a built feature.

1. **Playback gate.** The build lowers an animated native tile only after a test on the target, playing a built board across ticks, shows that the frames of a lowered tile advance. Until then every animated tile is refused with `animation-playback-unproven`, whatever its terrain's `sync` value and whether it is reached directly or through a rule. A tile with no timeline is not affected.
2. **Candidate mapping, not a proven one.** A native timeline would lower to one generated `.tan` whose frames reference generated tiles, one per *distinct cel*; a reused cel can reuse its generated tile. This is the only shape the format admits, and it is a candidate until item 1 holds.
3. **Timing: necessary conditions only.** A timeline can lower exactly only if every frame has the same `ms`, `1000 / ms` is an integer speed in `1..200`, and, because the current tick rounding in `packages/core/src/time/time.ts` and `hydrate.ts` is `max(1, round(60 / speed))` ticks at 60 ticks per second, `60 / speed` is a whole number so the rounded ticks equal the authored time. With integer milliseconds that leaves `50, 100, 200, 250, 500` and `1000` (speeds 20, 10, 5, 4, 2, 1). `25 ms` fails: speed 40 is a valid wire value, but 60 / 40 rounds to 2 ticks, about 33.3 ms. `120 ms` fails: no integer speed. Unequal durations fail. A failure is `animation-timing-unrepresentable`. **Passing is necessary and not sufficient**: `250 ms` passing says only that encoding and tick rounding do not rule it out, and it is still refused under item 1 until playback and the observed frame durations are shown on the target. Whether repeating frames at a common base period could express unequal durations is an **open decision** needing a worked proof.
4. Native timelines have **no implicit empty frames**. A deliberately blank frame requires a fully transparent cel. Mapping the `.tan` habit of empty middle frames is an import concern and is not decided here.
5. **Nonzero `phaseMs` is refused** for every animated tile on this target ([phase](#animated-sheets-and-cels)).
6. **Lockstep is gated by the same proof.** A `lockstep` terrain is refused for the legacy target until a golden test of a built scene shows that equal-cycle tiles **play** (item 1) and stay in step across ticks, not merely that their frames agree at one tick. Nothing here asserts they are in step by construction. Lifting the gate is a change to this rule backed by that test. A terrain of still tiles has nothing to gate.
7. A tile shown as a static frame is the first frame, so a native timeline's first frame should be the intended static look; this is a requirement on authors that the editor can only warn about.
8. Output-slot allocation for generated `.tst` entries and `.tan` files, and the legacy-slot stability guarantee, are in [open decision 3](#open-decisions).

## The tileset document (`.tkrtst`)

The proposed replacement for the `.tkrtile` tileset keeps the contract name `tileset`. It becomes a palette plus recipes: it no longer defines tiles.

```yaml
# tiles/village.tkrtst — proposed shape, not a valid fixture for any reader
contract: tileset
version: 1.0.0-pre.1
name: Village
expects: {projection: 2d, cellSize: [32, 32]}     # constraints on members, not a second copy of their facts
tiles:                                           # the palette: references only
  - {tile: tiles/grass/main.tkrtle}
  - {tile: tiles/water/fill.tkrtle}
  - {tile: tiles/water/edge-n.tkrtle}
  - {tile: tiles/water/edge-e.tkrtle}
  - {tile: tiles/water/edge-s.tkrtle}
  - {tile: tiles/water/edge-w.tkrtle}
  - {tile: tiles/water/outer-nw.tkrtle}
  - {tile: tiles/water/outer-ne.tkrtle}
  - {tile: tiles/water/outer-se.tkrtle}
  - {tile: tiles/water/outer-sw.tkrtle}
  - {tile: tiles/water/inner-nw.tkrtle}
  - {tile: tiles/water/inner-ne.tkrtle}
  - {tile: tiles/water/inner-se.tkrtle}
  - {tile: tiles/water/inner-sw.tkrtle}
  - {tile: tiles/water/bank-mossy.tkrtle}
terrains:
  - id: pond-water
    name: Pond water
    resolver: {provider: builtin, id: neighbour-match, version: 1.0.0}
    neighbours: blob-8        # the declared rule model: eight neighbours, reduced (see below)
    outside: other            # optional; defaults to `other`; written out here so the edge rule is visible
    coverage: partial         # `complete` makes any uncovered pattern a problem
    sync: lockstep            # every tile used here shares one timeline and phase
    rules:
      - {id: fill,     when: {n: same, e: same, s: same, w: same, ne: same, se: same, sw: same, nw: same}, use: {tile: tiles/water/fill.tkrtle}}
      - {id: edge-n,   when: {n: other, e: same, s: same, w: same, se: same, sw: same}, use: {tile: tiles/water/edge-n.tkrtle}}
      - {id: edge-e,   when: {e: other, n: same, s: same, w: same, sw: same, nw: same}, use: {tile: tiles/water/edge-e.tkrtle}}
      - {id: edge-s,   when: {s: other, n: same, e: same, w: same, ne: same, nw: same}, use: {tile: tiles/water/edge-s.tkrtle}}
      - {id: edge-w,   when: {w: other, n: same, e: same, s: same, ne: same, se: same}, use: {tile: tiles/water/edge-w.tkrtle}}
      - {id: outer-nw, when: {n: other, w: other, e: same, s: same, se: same}, use: {tile: tiles/water/outer-nw.tkrtle}}
      - {id: outer-ne, when: {n: other, e: other, w: same, s: same, sw: same}, use: {tile: tiles/water/outer-ne.tkrtle}}
      - {id: outer-se, when: {s: other, e: other, n: same, w: same, nw: same}, use: {tile: tiles/water/outer-se.tkrtle}}
      - {id: outer-sw, when: {s: other, w: other, n: same, e: same, ne: same}, use: {tile: tiles/water/outer-sw.tkrtle}}
      - {id: inner-nw, when: {n: same, e: same, s: same, w: same, nw: other, ne: same, se: same, sw: same}, use: {tile: tiles/water/inner-nw.tkrtle}}
      - {id: inner-ne, when: {n: same, e: same, s: same, w: same, ne: other, nw: same, se: same, sw: same}, use: {tile: tiles/water/inner-ne.tkrtle}}
      - {id: inner-se, when: {n: same, e: same, s: same, w: same, se: other, nw: same, ne: same, sw: same}, use: {tile: tiles/water/inner-se.tkrtle}}
      - {id: inner-sw, when: {n: same, e: same, s: same, w: same, sw: other, nw: same, ne: same, se: same}, use: {tile: tiles/water/inner-sw.tkrtle}}
outputBinding: {target: tiles/village-built.tst, detail: 1}
```

### Stable output slots

The [approved cutover decisions](terrain-scene-formats.md#approved-cutover-decisions) require persistent 1-based slots. The proposed wire shape puts those allocations under `outputBinding`, separate from palette display order. This excerpt illustrates the binding for a smaller set, not the complete pond above:

```yaml
outputBinding:
  target: tiles/village-built.tst
  detail: 1
  slots:
    - {slot: 1, tile: tiles/grass/main.tkrtle}
    - {slot: 2, reserved: true}
    - {slot: 3, tile: tiles/water/fill.tkrtle, cel: ripple-0}
    - {slot: 4, tile: tiles/water/fill.tkrtle, cel: ripple-1}
```

- A row has exactly one of three shapes: `{slot, tile}` for a still member, `{slot, tile, cel}` for an animated member's cel, or `{slot, reserved: true}`. `tile` names a member of the palette; a cel ID is local to that tile. All slots from 1 through the largest allocated slot must have exactly one row. The maximum is 32767 for the signed legacy tile-count field. No build may infer missing rows from existing output bytes or palette order.
- A still member receives one slot; every distinct cel of an animated member receives one slot, including intentionally transparent cels. Repeated references to one cel in its timeline reuse that slot. Refuse duplicate bindings and incompatible still/cel references, reporting the row or the member missing its allocation. A tile rename rewrites declared paths in the slot table without changing their numbers.
- Emit tiles in numeric slot order. A removed tile or cel leaves a reserved row, even if it was the last slot. Encode reserved rows using the target detail's transparent value. Normal editing appends newly allocated slots; it never compacts the table or reuses a reservation. A single document cannot prove whether a manual edit reassigned an old slot, so do not claim that a successful check guarantees historical compatibility.
- A build has no authority to allocate, remove or repair authored rows. If it cannot preserve an allocation, refuse the affected build and keep the previous output stale. A `.tan` output is still a separate generated file; its referenced cel numbers are taken only from this binding. Playback, timing and ownership checks still apply.

Acceptance proof: build three visibly distinct slots, reorder the palette and slot rows, and compare the actual output bytes. Retire the middle and final slots separately; both must decode as transparent without moving a surviving slot. Append a new cel and check that existing `.tstN` references and `.tan` frame lists still resolve to their original cels. Refuse duplicate, missing and out-of-range slots without rewriting the YAML or the previous output.

### How a terrain recipe is read

1. **`same` and `other`.** The input is the scene's **resolved ownership**, not raw coverage. For a cell owned by a region of terrain `T`, a neighbour is `same` if and only if its owner, **after the scene's overlap rule**, is a region whose terrain is the same full `{tileset, terrain}` reference as `T`. An unowned cell, a cell owned by another terrain (even when a region of `T` still lists that cell in its authored coverage beneath it) and an erased cell are `other`. Manual overrides are ignored by the test. A neighbour past the floor edge takes the terrain's `outside` value, which is optional and **defaults to `other`**, so this page and the scene proposal treat edges alike. The ownership derivation is the [scene proposal's](terrain-scene-contract-proposal.md#neighbours).
2. **Rule models are declared, not hard-coded.** `neighbours` selects the set of neighbours a rule may test. Two initial values are proposed as examples of a closed, extensible vocabulary: `cardinal-4` (`n e s w`) and `blob-8` (all eight). `blob-8` carries the usual reduction: a diagonal neighbour is relevant only when both cardinal neighbours beside it are `same`. Under that reduction a cell has 47 distinct situations; that figure is arithmetic from the definition and is **not yet proven by a test**. 47 is a property of `blob-8`, never a requirement of the contract; a recipe using `cardinal-4` needs 16.
3. **A rule's `when` names only the neighbours it cares about; omitted neighbours are `any`.** A *situation* is the model's canonical reduced mask: the neighbours **present** under the reduction, each `same` or `other`. A rule matches a situation if and only if every neighbour it names is present in that situation with the named value. A named neighbour that is absent from a situation (an irrelevant diagonal) makes the rule not match that situation. The same matcher is used by the tileset coverage check and by builds. A rule that matches no situation at all (for example `{n: other, ne: same}` under `blob-8`, where `ne` is never present while `n` is `other`) is reported `terrain-rule-unsatisfiable`.
4. **Coverage and overlap are checked, not assumed.** The tileset check expands every distinct situation of the model. A situation matched by no rule is `terrain-pattern-uncovered`: a *problem* when the terrain says `coverage: complete`, a *note* with the count when it says `partial`. In the example, 13 rules cover 13 of 47 `blob-8` situations, so the check would report a note with 34 uncovered. **At most one rule may match any situation.** Two rules that both match one situation are `terrain-rule-ambiguous`, whether they name the same tile or different tiles, because weights, rule ids or list order would otherwise decide the art; there is no "first rule wins" and no precedence. Weighted choice exists only inside one rule's `variants`. This check is about the recipe alone and does not depend on any scene: placing a manual override never changes whether a recipe is valid.
5. **Every tile used by a rule must be listed in `tiles`** (`terrain-tile-not-member`), so the palette is the whole truth of what the set contains, and each referenced `.tkrtle` must resolve.
6. **Transformations are not in the first cut.** Flipping or rotating a piece would require the build to generate extra pixels for a legacy target that has no such operation. Each orientation is an explicit tile. Whether to allow declared transformations is an [open decision](#open-decisions).
7. **Variations** extend `use` to `variants`, each with a positive integer `weight`:

   ```yaml
   - id: fill
     when: {n: same, e: same, s: same, w: same, ne: same, se: same, sw: same, nw: same}
     variants:
       - {tile: tiles/water/fill.tkrtle, weight: 8}
       - {tile: tiles/water/fill-lily.tkrtle, weight: 1}
   ```

   The choice for a cell is a pure function of declared inputs only: the floor's `id` (supplied by the scene), the cell coordinates, the **situation** the matched rule covers (its canonical reduced mask), the terrain's optional integer `seed` (default 0), and the matched rule's `variants` (tiles, weights and order). Renameable labels are deliberately **not** inputs: neither the rule `id` nor the terrain `id` participates, so renaming either never changes selected art; at most one rule matches a situation, so the situation identifies the rule. The floor `id` is an input the scene supplies; a floor rename makes earlier output **stale** ([scene proposal](terrain-scene-contract-proposal.md#variation)). Editing `variants`, weights or `seed` also changes the build inputs and is reported on the next build as such. The integer function itself has to be specified and golden-tested by the contract; no runtime random source, clock or iteration order may enter. Editing unrelated cells must not change another cell's variant. `use` and `variants` are mutually exclusive.
8. **The resolver is pinned.** `resolver` names the host-provided implementation that interprets the recipe, with an exact `version`. Identical documents, identical art bytes and the same resolver version give identical output, and the build records those inputs (below). Changing the recipe, a member tile or the pin changes the build inputs; a previously built output must then be reported stale, never current. A host that has the resolver `id` but not that `version` reports `terrain-resolver-version-unavailable` and lists the versions it has; upgrading the pin is an explicit, reviewable edit of this document.
9. **Which resolvers exist.** [Recommendation:] the first cut admits only built-in resolvers, so any contributor with the project can reproduce any build. A plugin-supplied resolver would make "can this be built" depend on an author-installed native plugin ([ADR 0008](../adr/0008-rpgcode-packages-and-trust-baseline.md)); the shape accepts `provider: plugin` so the choice can be made later without changing documents. See [open decisions](#open-decisions).

## The tool document (`.tkrtol`)

A tool document is data: a name, what scene data it edits, its parameters, and the implementation it asks the host for. It is not a script, it has no code, it carries no reference to any other native document, and it cannot install, enable or start anything.

A built-in tool:

```yaml
# tools/terrain-brush.tkrtol — proposed shape, not a valid fixture for any reader
contract: tool
version: 1.0.0-pre.1
name: Terrain brush
description: Paint a terrain region cell by cell.
implementation: {provider: builtin, id: terrain-brush, version: 1.0.0}
targets: [terrain-region]
requests: [scene.terrain.edit]
parameters:
  - {id: terrain, name: Terrain, type: terrain-ref, required: true}
  - {id: size, name: Brush size, type: integer, default: 1, min: 1, max: 16}
  - {id: shape, name: Shape, type: enum, values: [square, circle], default: square}
```

A tool supplied by an installed plugin:

```yaml
# tools/shore-brush.tkrtol — proposed shape, not a valid fixture for any reader
contract: tool
version: 1.0.0-pre.1
name: Shoreline brush
implementation: {provider: plugin, plugin: com.example.shoreline, id: shore-brush, version: 1.2.0}
targets: [terrain-region, tile-placement]
requests: [scene.terrain.edit, scene.tile.place]
parameters:
  - {id: terrain, name: Terrain, type: terrain-ref, required: true}
  - {id: bank, name: Bank tile, type: tile-ref}
  - {id: wobble, name: Wobble, type: number, default: 0.25, min: 0, max: 1}
pluginData:
  com.example.shoreline:
    version: 1.0.0
    data: {presets: [calm, windy]}
```

Rules, all proposed:

1. Closed top-level fields: the stamp, `name`, `description` (optional), `implementation`, `targets`, `requests` (optional), `parameters` (optional), and the shared `tags`, `metadata`, `pluginData`.
2. `implementation` is exactly `{provider: builtin, id, version}` or `{provider: plugin, plugin, id, version}`; `plugin` follows the [plugin id grammar](../spec/engine/rpgcode-modules-and-objects.md#pkg-2). `version` is the exact implementation interface the document was written against. It is a different number from the plugin *package* version and from any plugin data block's version, exactly as [ADR 0024](../adr/0024-plugin-data-contributions.md) keeps data versions separate from package versions.
3. `targets` names the kinds of scene data the tool may produce, from a vocabulary owned by the scene contract (`terrain-region` and `tile-placement` are used here as placeholders for that vocabulary). A tool writes **only ordinary scene data defined by the scene contract**: regions, coverage, explicit placements and overrides. It never writes a core field of a tile or tileset, and never stores recipes, generated tile choices or a copy of its own parameters in the scene. **A tool never deletes manual work.** It may add an override on a cell that has none; changing or clearing an existing override is the editor's explicit, visible *Clear override* action ([scene proposal](terrain-scene-contract-proposal.md#erase-proposed)), never a tool parameter or a side effect of painting. Its output is readable and editable without it ([Painting a world](terrain-scene-formats.md#tools-and-plugins)).
4. `requests` are the host operations the tool asks for. Like the [manifest host requests of ADR 0008](../adr/0008-rpgcode-packages-and-trust-baseline.md), they are **informational: displayed, not enforced**, because the owner has recorded that there is no capability model yet. The names above are placeholders. A stricter capability model needs its own decision.
5. `parameters` is an ordered list with unique local ids and a closed type vocabulary: `integer`, `number`, `boolean`, `enum`, `tile-ref`, `terrain-ref`. `min`, `max`, `values` and `default` are plain data of the declared type. **A `tile-ref` or `terrain-ref` parameter never has a default in the document**, because a default would make the tool a holder of a reference to another native document and a second owner of that choice. The user's current selection is editor state, not a stored fact; where a host persists it, it is host settings ([ADR 0022 D6](../adr/0022-shared-editor-authoring-contracts.md#d6--settings)), not a native document.
6. Parameter values chosen when painting are not saved in the scene. A tool that needs to remember something about a region (for example, a preset) keeps it in its own `pluginData.<plugin id>` block on the scene. The shared rule that a block exists only at the top level of a document, with no per-region door, applies ([ADR 0024 decision 7](../adr/0024-plugin-data-contributions.md)); whether a region may carry a nested door is the scene contract's question.
7. **Nothing in a scene, tile or tileset has a field that names a tool.** Tools are discovered from the host and the project's `tools/` folder and selected by the editor. This keeps the scene complete without any tool and removes a class of dangling reference.

## Tool, plugin and resolver: where trust sits

| Thing | What it is | Needs trust? | Who decides |
|---|---|---|---|
| `.tkrtol` document | Data | No more than any text file. It can only name an implementation, list typed parameters and display requests. It is validated and shown without running anything. | Nobody; reading it is safe by construction |
| Built-in implementation (tool or resolver) | Code shipped with the editor | It is the host's own code | The editor release |
| Plugin implementation | Native plugin code the host loads with the host's authority | **Yes, and it is the author's choice**: [ADR 0008](../adr/0008-rpgcode-packages-and-trust-baseline.md) keeps native plugins author-installed only. A project file or a package cannot install one. | The person who installs it on this machine |
| `pluginData` block | Data | None to preserve; code is never run from it | The owning plugin, when installed |

What follows:

1. **Naming is not permission.** A `.tkrtol` or a tileset that names a plugin does not install, download, enable, update or execute it. The host reports the plugin as missing and, at most, tells the person what the project wants; any installation is a separate, explicit act.
2. **A tool document cannot widen itself.** It carries no executable, no URL, no path to run, no scripting hook; labels and descriptions are display text and are never interpreted. A parameter value that looks like a path is only honoured when its declared type is `tile-ref` or `terrain-ref`, and then it resolves under the native identity rules.
3. **The implementation validates parameters.** A document may narrow ranges and defaults only within what the implementation declares; a violation is `tool-parameter-invalid`. A document cannot add a parameter type.
4. **Resolvers carry stronger obligations than tools.** A tool's work is saved as scene data and can be inspected. A resolver's work becomes the build, so it must be deterministic from its declared inputs, with no clock, no unseeded randomness and no input or output beyond them (G3, G2). That is a rule on the implementation, enforceable for built-ins and testable only by contract tests for a plugin.
5. **A plugin that supplies tools or resolvers needs an editor contribution mechanism that does not exist.** The existing plugin catalogue and its `contributes` entries describe **data** contributions ([ADR 0024](../adr/0024-plugin-data-contributions.md), decision 1); there is no host interface through which a plugin supplies an editor tool or a build resolver. Adding it is a separate ADR with its own trust discussion. Whether an RPGCode package can ever be one is not claimed: the VM that contains such packages exposes the game's host requests, not editor documents.
6. **A missing implementation is not a missing authority.** The documents keep their meaning without the implementation, as the table below shows.

## Missing rules, missing tools: proposed diagnostics

Report shape follows the existing reader and checker convention: a `kind` of `problem` or `note`, the document path, a location inside the document, an explanation, and a line when known ([checker](../spec/formats/native-contracts.md#checker)). A build report adds the scene location (floor, region, cell). Codes are proposed spellings only; the contract pages would define the exact set, and the existing `plugin-absent`, `plugin-data-newer` and related checks continue to apply to `pluginData`.

### At reading and checking time (no build)

| Code | Kind | Raised when | Located at |
|---|---|---|---|
| `tile-art-missing` | problem | `visual.file` missing or unreadable | tile `visual.file` |
| `tile-art-out-of-bounds` | problem | a `rect` or cel rectangle lies outside the decoded image | tile `visual.rect` or `visual.cels[i].rect` |
| `tile-rect-invalid` | problem | a rectangle or cel has width or height below 1 | tile `visual.rect` or `visual.cels[i].rect` |
| `tile-art-managed-output` | problem, **reserved** | `visual.file` is identified as the export of a managed artwork source. It cannot be raised until the artwork contract can say so; no inference from names or locations ([managed artwork](#managed-artwork-and-pixel-representability)) | tile `visual.file` |
| `tile-timeline-invalid` | problem | empty timeline, `ms` below 1, unknown cel, unequal cel sizes, `phaseMs` outside the cycle | tile `visual.timeline…` |
| `tile-size-mismatch` | problem | a member's rectangle size differs from the tileset's `expects.cellSize` | tileset `tiles[i]` |
| `tile-projection-mismatch` | problem | a member's `projection` differs from `expects.projection` | tileset `tiles[i]` |
| `terrain-tile-unresolved` | problem | a rule or palette entry names a path that is not a registered `.tkrtle` | tileset `terrains[i].rules[j]` or `tiles[i]` |
| `terrain-tile-not-member` | problem | a rule uses a tile not listed in `tiles` | tileset `terrains[i].rules[j]` |
| `terrain-rule-unsatisfiable` | problem | a rule matches no situation of its model, for example one that names a diagonal the reduction never leaves present alongside its other conditions | rule `when` |
| `terrain-rule-ambiguous` | problem | two rules both match one situation, **whether they name the same tile or different tiles**; weights and ids never decide between rules | both rules |
| `terrain-pattern-uncovered` | problem when `coverage: complete`, otherwise note | a situation of the model matches no rule; the report states the situation and, for a note, the count | terrain |
| `terrain-sync-mismatch` | problem | a `lockstep` terrain uses tiles whose cycle, frame boundaries or `phaseMs` differ | terrain; first differing tile |
| `terrain-model-unsupported` | problem | `neighbours` is not a value the named resolver version supports | terrain |
| `terrain-resolver-missing` | problem for any build of the terrain; note for opening | the host has no implementation with that `id` for that `provider` | terrain `resolver` |
| `terrain-resolver-version-unavailable` | problem for any build; note for opening | the host has the `id` but not the pinned `version`; lists those it has | terrain `resolver` |
| `tileset-iso-blocks-unsupported` | problem | a `.tkrtst` contains `isoBlocks`, whose faces name sources this revision no longer has | tileset `isoBlocks` |
| `tool-implementation-missing` | note | the named built-in or plugin implementation is not available here | tool `implementation` |
| `tool-implementation-version-unavailable` | note | the implementation exists but not at the stated `version` | tool `implementation` |
| `tool-parameter-invalid` | problem | a default, bound or enum value is outside what the implementation declares | tool `parameters[i]` |
| `tool-target-unsupported` | problem | `targets` names a kind the implementation or scene contract does not offer | tool `targets` |

A missing tool never makes a scene, tile or tileset unreadable, never blocks a build, and never deletes or rewrites anything. A missing resolver blocks the build of the terrains that need it, and only those.

### At build time

| Code | Kind | Raised when | Outcome |
|---|---|---|---|
| `terrain-pattern-unmatched` | problem | a cell **owned by a region of the terrain and not overridden** has a neighbour situation no rule matches. A cell with a manual override is never sent to the resolver, so it cannot raise this | The cell gets no generated tile; **no tile is chosen from unrelated rules**; the build fails; the scene is unchanged |
| `terrain-resolver-missing`, `terrain-resolver-version-unavailable` | problem | as above, for a terrain a scene region uses | The build of that scene fails |
| `animation-playback-unproven` | problem | an animated tile would be lowered while playback of lowered tiles on the target has not been shown ([gate](#animated-sheets-and-cels)); raised whatever `sync` says | The tile is not generated; the build fails |
| `animation-timing-unrepresentable` | problem | a tile's timeline fails the necessary conditions: one `ms` for all frames, an integer `.tan` speed, whole ticks at the current rounding; for example `25 ms`. Passing them does not clear the playback gate | The affected tile is not generated; nothing is rounded |
| `animation-phase-unrepresentable` | problem | (a) any animated tile with nonzero `phaseMs`, or (b) a `lockstep` terrain while the playback and shared-phase test does not exist. The message states which | The affected tile or terrain is not generated; the build fails |
| `tile-output-size-mismatch`, `tile-output-pixel-unrepresentable` | problem | an emitted crop does not fit the tileset's `outputBinding.detail`, located at the tile, cel and pixel ([pixel representability](#managed-artwork-and-pixel-representability)) | Nothing is resized or altered; the build fails before any write |
| `tile-output-unresolved`, `tile-output-ambiguous` | problem | a tile the build uses (referenced directly or produced by a rule) has no candidate tileset with an `outputBinding`, or more than one; or a tile both rule-produced and directly referenced has a candidate set other than its terrain's tileset alone ([ownership](#generated-art-ownership-outside-edits-and-partial-writes)) | The build fails in preflight, before any write |
| `output-destination-collision` | problem | two tilesets claim one generated path, or a generated path is a native document, a source image or a `.brd` | The build fails in preflight |
| `output-edited-outside` | problem | a generated file on disk is missing, differs from its recorded digest, or exists with no record | The build stops and does not overwrite; the author chooses |
| `build-output-partial` | problem | a file of the output set could not be written | Status `failed`, never `current`; written and unwritten files are listed |
| `build-output-stale` | note | the previous output was built from different inputs than the current ones | The old output may be shown only labelled as the last successful build, never as current |

An unmatched-pattern report names everything needed to fix it without guessing:

```text
problem terrain-pattern-unmatched
  scene     Boards/pond.tkrscn   floor ground   region pond-main   cell [14, 9]   (owned, not overridden)
  terrain   tiles/village.tkrtst  pond-water      (resolver builtin neighbour-match 1.0.0)
  situation n:other e:same s:same w:same se:other sw:same
  rules     13 declared, none match this situation; 34 of 47 situations are uncovered
  effect    build failed; Boards/pond.tkrscn unchanged; last successful output is stale
```

The `situation` line is in the model's canonical form; it lists only the neighbours the model treats as present. A cell with a manual override is never sent to the resolver, so a pattern the recipe lacks beneath an override is not reported while the override stands; removing the override can then expose it. An editor can show the same cell as a marked hole in its own preview, labelled as a preview, but a preview is not an output.

**Build record.** Every build would report, as one digest or one list the next build can compare: the **inputs** (the scene, each referenced tileset and tile document, each source image, and each resolver `id` and `version`); for each tile used, its **owning tileset**, that tileset's `outputBinding` (target and detail) and the **whole candidate set** ([ownership](#generated-art-ownership-outside-edits-and-partial-writes)); the **outputs** (every generated file, the scene's `.brd` included in a scene build, by normalized path with a digest of the bytes written); and a status (`current`, `stale`, `failed`, or `none`). Recording the candidate set means a membership change, such as a second tileset now listing a tile, makes earlier output stale instead of silently current. Where the record is stored is the build's decision and not an authority; it is a report, and nothing reads it back as a source.

### Generated art: ownership, outside edits and partial writes

1. **Each tile used has exactly one output owner, and its candidate set is recorded.** Only a tileset's `outputBinding` produces `.tst` output. For every tile the build uses, whether it is referenced directly (a scene palette entry, a contour source, an override) or produced by a terrain rule, the **candidate set** is every `.tkrtst` in the project that lists the tile in `tiles` and has an `outputBinding`. The owner is its one member. Zero candidates is `tile-output-unresolved`; more than one is `tile-output-ambiguous`; a preflight finds both before anything is written. A tile that is **both** produced by a rule of a terrain in tileset `T` and referenced directly requires the candidate set to be exactly `{T}`: any other tileset that also lists it makes it `tile-output-ambiguous`, so the two uses can never resolve to different `.tst` outputs. The reference spelling stays `{tile: path}`. This is the choice the scene proposal recommends ([owner review 13](terrain-scene-contract-proposal.md#owner-review-consequential-choices-proposed)); in the examples, `bank-mossy` is listed by `village.tkrtst` only.
2. **Destination ownership is checked across the whole project.** Every generated path (each tileset's `.tst` target and the `.tan` files its animated tiles produce) is normalized under the [identity rules](../spec/formats/native-contracts.md#identity). A path claimed by two tilesets, or equal to a native document, a source image or a scene's `.brd`, is `output-destination-collision`. The check is project-wide because a second tileset overwriting an earlier output would change an earlier board's art without changing its recorded inputs. `.tan` file names must be derived by a rule the contract defines from the owning tileset's target and the tile's path; a tile rename can change a name, which is reported as a note, and an old generated file is never deleted automatically.
3. **Outside edits are detected, as for the `.brd`.** Input freshness cannot see an edited or deleted generated file, so the record carries output digests. Before overwriting, the build compares each existing generated file with its recorded digest. A difference, a deletion, or an existing file with no record makes the build **stop** with `output-edited-outside` instead of overwriting, the equivalent of the existing [`.brd` rule](../spec/formats/native-scene.md#build-from-a-scene-to-a-board) (build rule 5), which keeps applying to the `.brd` itself beside this check. The author's choice resolves it; nothing is silently replaced. Where the record is kept is open, as for the `.brd` hash.
4. **A multi-file write is not assumed atomic, and a scene build's `.brd` is part of the set.** The build validates and prepares every file first, the generated tileset outputs and, in a scene build, the `.brd` as **one prepared output set**, writes each to a temporary name, and moves files into place only when all are ready. It never marks the build `current` unless every file of the set was written and its digest recorded. If any step fails the status is `failed` with `build-output-partial`, the written and unwritten files are listed (the `.brd` among them), and the previous record is not replaced.

### What a missing implementation does, case by case

| Case | Opens? | Edits | Build |
|---|---|---|---|
| Tool implementation missing | Yes; tool is listed as unavailable with its reason | Everything the editor itself can do; ordinary scene data stays editable | Unaffected |
| Plugin absent that owns `pluginData` on a scene | Yes; block preserved byte for byte and noted `plugin-absent` | The rest of the scene | Unaffected unless the plugin's block is *also* a required build input, which no contract here allows |
| Resolver missing or pin unavailable | Yes; the tileset and scene open and the painted coverage is retained | Painting continues; the preview is labelled and cannot be called a build | **Fails for the affected terrains** with `terrain-resolver-missing`; a previous output is shown only as the last successful build |
| Rule pattern missing | Yes | Yes, including adding the missing rule | **Fails for the unmatched cell(s)** that are owned and not overridden, with `terrain-pattern-unmatched` |
| A writer cannot preserve unknown plugin data | Reads | Write refused with a located error | n/a |

## Relation to the existing tileset contract

If adopted, the replacement `.tkrtst` contract would differ from the [current draft](../spec/formats/native-tileset.md) as follows. This is a proposal of disposition, not an edit of that page.

| Existing key | Proposed disposition |
|---|---|
| `contract: tileset`, `version`, shared `tags`/`metadata`/`pluginData` | Retained; extension becomes `.tkrtst` |
| `name` | Retained |
| `projection`, `cellSize` | Moved under `expects` as verified constraints |
| `sources` (id, file, grid, transparent) | Dropped from the tileset. `file` and `transparent` move to each tile's `visual`; the sheet grid is dropped because each tile's rectangle is authoritative |
| `tiles[]` (id, name, source, cell, role, collision, kitbash) | Each becomes a `.tkrtle` document; the tileset's `tiles` becomes a list of `{tile: path}` references. The local tile id is replaced by the document path |
| `isoBlocks[]` | **Excluded from this revision, with a located refusal.** Every existing face names a local source id and cell, and local sources no longer exist, so no face could resolve. A `.tkrtst` containing `isoBlocks` is rejected (`tileset-iso-blocks-unsupported`, located at the key); nothing is converted, aliased or carried with unresolvable faces, and no migration tool is offered. Isometric blocks need their own design. The alternative, a `{tile: path}` route for each face with its tint, is [open decision 13](#open-decisions) |
| `autotiles[]` (`blob-47`, `base`, `border`, `innerCorner`, `exportOrder: t25-canonical`) | Superseded by `terrains` with declared rule models; the fixed 47-piece mode is one option, not the contract. The legacy `t25-canonical` export ordering would need to be re-expressed against the output binding; not decided |
| `outputBinding` (`target`, `detail`) | Retained. It makes the tileset the sole output owner of its member tiles ([ownership](#generated-art-ownership-outside-edits-and-partial-writes)) |
| Reference `{tileset, tile: local-id}` | Replaced by `{tile: path}` for a tile and `{tileset, terrain}` for a terrain |

The scene contract's palette entries and `boundarySources.walkableTiles` entries use the old spelling today ([scene references](../spec/formats/native-scene.md#reference-forms)); the scene proposal and the cutover must change them in the same coordinated edit. Registry rows for the three extensions follow the shared rule that code and page change together and a test fails if they differ:

| Extension | Contract | Contract page |
|---|---|---|
| `.tkrtle` | `tile` | to be written |
| `.tkrtst` | `tileset` | `native-tileset.md`, amended |
| `.tkrtol` | `tool` | to be written |

(The existing rule of one extension per contract, `.tkr` plus three or more lowercase letters, is satisfied by all three spellings.)

## Open decisions

Entries below retain their design history; decisions explicitly marked approved take precedence over earlier examples.

1. **Tile reference spelling `{tile: path}` versus keeping `{tileset, tile: local-id}`.** Recommended: path alone, so a tile has one identity. Alternative: keep the pair and make tiles tileset-local, which defeats a standalone `.tkrtle`.
2. **Region identity inside editable art.** Recommended: pixel rectangles now; adopt a stable region id when [13.21](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2320) defines one, as a minor addition.
3. **Output-slot allocation and deletions (approved).** The owner approved explicit tile and cel slots with no implicit reuse. See [stable output slots](#stable-output-slots) for the proposed wire shape and build checks. Palette order is not an allocation policy.
4. **Unequal frame durations in the legacy target.** Recommended: refuse with `animation-timing-unrepresentable` until a repetition scheme is proven to give identical timing.
5. **Playback, shared phase and nonzero phase.** Recommended: every animated tile stays refused for the legacy target (`animation-playback-unproven`) until a test on the target, playing a built board across ticks, shows the frames advance; lockstep additionally waits for a golden test that equal-cycle tiles stay in step across ticks; nonzero `phaseMs` stays refused until a mapping that preserves the static first frame is shown ([above](#animated-sheets-and-cels)). No playback claim is made for any current runtime.
6. **Declared transformations (flip, rotate).** Recommended: none in the first cut; each orientation is a tile.
7. **Plugin-supplied resolvers.** Recommended: built-in only in the first cut, shape left open for plugins.
8. **Plugin-supplied tools and a capability model.** Needs a separate ADR; this page proposes only the document and informational `requests`.
9. **Variation hash function and weight semantics.** Needs a specified integer function and golden values before a recipe's variation is called reproducible.
10. **Overlapping terrains and floor interplay**, and what a `same` neighbour means across regions. Owned by the scene proposal; this page reads the scene's resolved ownership, compared by the full `{tileset, terrain}` reference ([recipe reading](#how-a-terrain-recipe-is-read), item 1).
11. **`wallCapUnder` and iso geometry on tiles.** Depend on a design for isometric tiles and the [raised-art limits](../spec/formats/native-tileset.md#not-decided-here).
12. **Shape of the checker classes** (`native-art` and `native-scene` exist; whether these codes live under new classes or existing ones).
13. **Raised isometric blocks (approved boundary).** Preserve authors' face and geometry data and refuse affected builds until the projected overlay is proven. Flat terrain does not wait for that proof.
14. **Binding a tile to managed artwork.** Needs a source-owner reference and frame selector from the artwork contract ([13.21](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2320)); until then tiles use standalone rasters only and nothing is inferred from file names.

## Evidence a later implementation would have to produce

Not run, not claimed: the 13-rule pond (13 of 47 situations covered; the uncovered count reproduced by a test); a rule naming `{ne: other}` with `n` and `e` omitted matching only situations where `ne` is present, with the same matcher used by the coverage check and by builds; two overlapping rules, including two naming the same tile, rejected before any variant is chosen; a lake cell beside mud resolved with the mud neighbour `other` even though the lake's authored coverage lists it; an unmatched cell reported at its exact location with the build failing and the scene byte-identical, and an overridden cell not reported; inner and outer corners placed correctly; a lockstep terrain passing the sync check and a one-frame mismatch failing `terrain-sync-mismatch`; **a test that plays a built board across ticks and shows whether a lowered animated tile's frames advance, and what durations are observed**, with every animated tile refused until it passes; `250 ms` and `25 ms` evaluated against the necessary timing conditions only (the first passing them, the second failing), `120 ms` failing the wire format, and nonzero `phaseMs` refused on a direct tile and under `sync: independent`; lockstep refused until a golden test shows equal-cycle tiles playing and staying in step; the same declared inputs giving the same variants across runs, across unrelated edits and across a rule or terrain rename; a deletion from a palette not shifting a surviving legacy slot; a tile with zero candidate tilesets, and one with two, refused before any write; a tile both produced by a terrain rule and directly referenced, with a second listing tileset, refused as `tile-output-ambiguous`; a membership change making earlier output stale through the recorded candidate set; two tilesets claiming one destination refused; an edited, deleted or unrecorded generated file refusing the overwrite; a scene build where the `.brd` is one file of the prepared set, a failed move leaving the build `failed` with the `.brd` listed among the written or unwritten files; a half-transparent pixel, a pixel equal to (0, 1, 2) and a crop of the wrong size refused with a location; a `.tkrtst` with `isoBlocks` refused; a tile moved in its sheet without changing its path or any reference; rename of a `.tkrtle` changing every inventory scalar of both documents and no other byte, `pluginData` and comments included; a tool document naming a missing plugin opening, listing the tool as unavailable and changing nothing, and a tool never deleting an override; a missing resolver failing the build of its terrain only; and each preservation test shown to fail against a writer that regenerates documents ([preservation](../spec/formats/native-contracts.md#preservation)).

## References

- [Painting a world](terrain-scene-formats.md), the owner direction this proposal elaborates; [native graphics authoring](native-graphics-authoring.md).
- [Tileset contract](../spec/formats/native-tileset.md), [scene contract](../spec/formats/native-scene.md), [shared native rules](../spec/formats/native-contracts.md), [animation clip contract](../spec/formats/native-animation-clip.md).
- [Animated tile `.tan`](../spec/formats/tiles.md#animated-tile-tan), [board animated tiles](../spec/formats/board.md#animated-tiles), [authoring lowering](../spec/formats/tkr-authoring.md#5-lowering--build-contract).
- [ADR 0024 plugin data contributions](../adr/0024-plugin-data-contributions.md), [ADR 0008 plugin trust baseline](../adr/0008-rpgcode-packages-and-trust-baseline.md), [ADR 0022 shared editor contracts](../adr/0022-shared-editor-authoring-contracts.md).
