# Scene terrain regions and manual tile overrides: proposed contract

**Status: non-normative design proposal. Nothing on this page is approved, implemented or accepted by any reader, writer, schema or fixture.** It proposes additions to the approved pre-release scene contract ([native-scene.md](../spec/formats/native-scene.md)) for the scene half of [Painting a world](terrain-scene-formats.md), and is reconciled with the companion [tile, tileset and tool proposal](tile-tool-contract-proposal.md), which owns tiles (`.tkrtle`), tilesets (`.tkrtst`) and tools (`.tkrtol`). It is a **Reawakened rule** for the native scene, not a Toolkit 3.1 behaviour, and is written without reference to any legacy source (guardrail G7). Until the owner approves it and the amendment lands in the scene contract, schema, reader, writer and fixtures together, the scene contract on `main` stands as written: its top level is closed, so a `.tkrscn` carrying the keys below is **an error today**.

Every key, rule, check and diagnostic on this page that the approved scene contract does not already state is marked **[Proposed]**. Where this page says "existing", it means the approved scene contract, unchanged and not restated here. Where it says "the tile proposal", it means [tile-tool-contract-proposal.md](tile-tool-contract-proposal.md), which is equally non-normative; this page depends on it and does not restate it.

**Owner decision since this draft:** the [tile proposal](tile-tool-contract-proposal.md) records explicit tile-owned walk-behind geometry, independent of solid collision. For the revised lowering, place both authored outlines with the resolved tile; do not require the creator to trace them again on each scene. References below to undecided walk-behind or `wallCapUnder` predate this decision. Existing scene readers and runtime behavior are unchanged.

## In plain words

A creator paints a pond on a scene floor. The scene remembers **which cells are pond** (a *terrain region*), not which tile goes in each cell. At build time the pond is turned into the right edge, corner and fill tiles for the board the game plays. If the creator then hand-places a special bank tile on one pond cell, the scene remembers that too, separately, as a *manual override*. The override always wins at its cell. Erasing pond cells never deletes the hand-placed tile, and rebuilding never rewrites the scene.

The scene holds **intent** (shape, hand work). The `.brd` holds **result** (resolved cells). The terrain recipe that turns shape into tiles lives in a tileset, and each tile lives in its own document, not here.

## What this page decides, and what it does not

Decides **[Proposed]**: the YAML of terrain regions and manual overrides; how coverage is written; what wins when a cell has a base tile, a region and an override; how overlapping and erased regions behave; what edits must preserve; the **cutover of the scene's existing native tile references** to the tile proposal's spelling; which problems a reader, project check and build report; worked examples including refusals.

Does not decide, and does not claim exists:

- **The terrain recipe, tile and tileset documents.** They belong to the tile proposal: `terrains[]` with `neighbours`, `outside`, `coverage`, `sync`, `seed`, `rules` and a pinned `resolver`, and a tile's `visual`, `timeline`, `role`, `collision`. This page reads those facts and never copies or overrides them (one owner for every fact). The `.tkrtile` to `.tkrtst` cutover and registry rows are that proposal's concern, and `.tkrtle`, `.tkrtst` and `.tkrtol` are owner direction, not registered extensions.
- **Animation.** Frame timing, shared phase, `.tan` generation and `.tst` slot allocation are the tile proposal's ([animated sheets](tile-tool-contract-proposal.md#animated-sheets-and-cels)). A region carries no timing. Whatever the tile proposal finds unrepresentable for the legacy target, the scene build refuses ([refusal R5](#refusals)).
- **Tools.** The scene never names a tool ([tools and plugins](#tools-plugins-and-a-missing-tool)).
- **Isometric neighbourhoods and collision geometry.** Regions build only on `2d` scenes in this proposal; collision geometry stays with the tile and tileset contracts.
- **Where the build record lives**, as for the `.brd` hash today ([native-scene.md build rule 5](../spec/formats/native-scene.md#build-from-a-scene-to-a-board)).

## Summary of the proposed additions to the scene

| Addition | Kind | Meaning |
|---|---|---|
| `terrainRegions` | new optional top-level list **[Proposed]** | Painted regions: a floor, a terrain reference and an authored coverage. |
| `tileOverrides` | new optional top-level list **[Proposed]** | Explicit per-cell tiles that win over everything else at their cell. |
| terrain reference `{tileset, terrain}` | new reference form **[Proposed]** | Names a tileset document and a terrain id local to it. |
| native tile reference `{tile: <path of a .tkrtle>}` | **replaces** the existing `{tileset, tile: <local id>}` **[Proposed]** | Names one tile document by its path. Applies to every existing native tile place in the scene ([cutover](#cutover-of-the-existing-native-tile-references)). |
| contract revision | version **[Proposed]** | A pre-release revision (`1.0.0-pre.N`, number assigned at cutover) in which these keys and the new tile spelling are valid. |
| U10, V22 to V37 | validation and `.brd` table rows **[Proposed]** | See [validation](#validation) and [what a `.brd` cannot hold](#what-a-brd-cannot-hold). |

Unchanged: `floors[].tiles` stays palette-index runs with exact cover, `tilePalette` stays the board's look-up table slot for slot, existing records keep their slot order, and the rules for `pluginData`, `legacy` and every existing field. Existing tile runs are **not** re-read as terrain shapes.

<a id="reference-forms"></a>
## Reference forms **[Proposed]**

Following the tile proposal's [stable references](tile-tool-contract-proposal.md#stable-references), the scene names native documents in exactly these ways. A tile has one identity, its document path; a terrain keeps a two-field spelling because its id lives inside the tileset document. No fragment syntax is used.

| Form | Where used | Spelling | Resolved by |
|---|---|---|---|
| Native tile | a [palette entry](#cutover-of-the-existing-native-tile-references), a floor's `boundarySources.walkableTiles` entry, a `tileOverrides[].tile` | `{tile: <path of a .tkrtle>}` | The path is a native document ID under the shared [identity rules](../spec/formats/native-contracts.md#identity) and must resolve to one registered `.tkrtle` whose stamp says `tile`. There is **no tile id** in a scene reference. |
| Terrain | `terrainRegions[].terrain` | `{tileset: <path of a .tkrtst>, terrain: <terrain id>}` | The `tileset` path must resolve to one registered `.tkrtst` whose stamp says `tileset`, and `terrain` must name exactly one `terrains[].id` in it. A terrain has no legacy spelling. |
| Legacy tile | the same places as a native tile | `{legacy: <text>}` | Unchanged: carried exactly as stored. |

A scene may refer to **any** registered `.tkrtle`. It is not required to be a member of any tileset's `tiles`; membership is the tileset's concern ([tile membership](tile-tool-contract-proposal.md#how-a-terrain-recipe-is-read), item 5). Whether such a tile can be *built* is a dependency on the tile proposal ([owner review](#owner-review-consequential-choices), item 13).

### Where references are (replacement and additions)

This replaces the scene's [where references are](../spec/formats/native-scene.md#where-references-are) list for native tiles and adds the new locations. The rename tool must discover and rewrite all of them, with no per-project configuration, and refuses rather than skips a reference it cannot read:

| Location | Names | Rewritten by a rename of |
|---|---|---|
| `tilePalette[].tile` | a tile document | that tile's path |
| `floors[].boundarySources.walkableTiles[].tile` | a tile document | that tile's path |
| `tileOverrides[].tile.tile` | a tile document | that tile's path |
| `terrainRegions[].terrain.tileset` | a tileset document | that tileset's path |
| `terrainRegions[].terrain.terrain` | a terrain id local to the `tileset` beside it | that terrain's id |
| `terrainRegions[].floor`, `tileOverrides[].floor` | a floor of this document | that floor's id (the editor rewrites it, as for `floor` today) |

`placedPacks[].pack` and `.asset` are unchanged. The rows `tilePalette[].tileset`, `walkableTiles[].tileset` and the local-tile-id rows of the existing list are **retired**: no scene location names a tileset to reach a tile, and a tile's id inside a tileset is never stored in a scene. A `.tkrtst` rename therefore reaches the scene only through `terrainRegions[].terrain.tileset`.

<a id="cutover-of-the-existing-native-tile-references"></a>
### Cutover of the existing native tile references **[Proposed]**

The existing scene contract spells a native tile `{tileset: <path of a .tkrtile>, tile: <local id>}`. The tile proposal makes a tile its own document and replaces that spelling; the scene must change in the **same coordinated edit** as the registry, specification, readers, writers, checks, fixtures and the scene's own sample, with the owner's clean cutover (no alias, no migration tool). This page assumes the owner's no-alias direction for the `.tkrtile` tileset extension also covers the reference spelling ([owner review](#owner-review-consequential-choices), item 12). Concretely, for the scene contract:

1. **Palette entries (amends palette rule 4).** An entry is `{}`, a legacy tile `{legacy: <text>}`, or a native tile `{tile: <path of a .tkrtle>}`, and nothing else ([palette rule 4](../spec/formats/native-scene.md#the-tile-palette)). The existing rule 4 states that a native animated tile is not in the contract; that sentence is **removed**. `{tile: <path>}` may name a still native tile or an animated native tile (a tile with a `timeline`), while `{legacy: water.tan}` keeps its existing meaning: a legacy animated tile carried exactly as stored. Naming an animated native tile in a palette does not make it buildable; lowering is gated by [animated lowering](#animated-lowering) (R5). Example: the sample's `{tileset: tiles/village.tkrtile, tile: stone-wall-base}` becomes `{tile: tiles/stone/wall-base.tkrtle}`, and its `boundarySources.walkableTiles` entry `{tileset: tiles/village.tkrtile, tile: grass-main}` becomes `{tile: tiles/grass/main.tkrtle}` (paths illustrative).
2. **The retired spelling is rejected in declared native reference fields only.** From the proposed revision on, in the locations of [where references are](#where-references-are-replacement-and-additions): a tile reference that is not exactly `{tile: <path>}`, `{legacy: <text>}` or `{}` (for example a `tileset` key beside `tile`), a tile `path` whose extension is not `.tkrtle`, or a `terrain.tileset` whose extension is not `.tkrtst` (the retired `.tkrtile` included) is a **reader** error: the reference is malformed. A well-formed path whose target is missing, unregistered or of another kind (its stamp) is a **project** error ([V32, V33](#validation)). Nothing outside those fields is scanned or rewritten: `{legacy: ...}` text, programs and inline code, file names, `metadata`, `tags` and `pluginData` payloads are opaque, and a source filename that happens to end in `.tkrtile` there is preserved untouched. The retired spelling is not read, translated or aliased.
3. **Resolution (V15).** Every native tile reference resolves to one registered `.tkrtle` whose stamp says `tile`.
4. **Collision and palette rule 5.** A native entry writes the legacy tile reference of the tile as the build generates it ([build](#resolution)), and contributes the `collision` of the `.tkrtle` as generated vectors, exactly as the existing rule states with the tile document now the owner of `collision` and `role`. Walk-behind is still not promised by a tile reference ([open item](../spec/formats/native-scene.md#not-decided-here)); if the tile proposal adopts `wallCapUnder` on tiles it needs its own geometry decision first, and that sentence of the existing contract would then be revisited by that decision, not by this page.
5. **U5** ("a native tile reference in the palette") keeps its meaning with the new spelling.
6. **Fixtures and the sample** of the scene contract that use the old spelling change in the same edit; the build table of the sample reads the generated reference for the stone tile as before.

The cutover touches only documents of this repository; whether any private project holds the old spelling is not known, and private files are not altered without an explicit operation.

## The three layers of one cell **[Proposed]**

For one cell of one floor there are up to three sources of tile, from lowest to highest:

1. **Base.** The cell's value in the floor's existing `tiles` runs (a palette index; 0 is no tile). Ordinary direct painting lands here. Base is never modified by a region, an override or a build.
2. **Generated.** The tile a terrain recipe picks for the cell, if a terrain region **owns** the cell ([overlap](#overlapping-regions)).
3. **Override.** The explicit tile in `tileOverrides` for that floor and cell, if any.

The **resolved tile** of a cell is the override if one exists, otherwise the generated tile if a region owns the cell, otherwise the base. The built `.brd` receives resolved cells only, together with any pack tile cells under the rule in [pack tile cells](#pack-tile-cells). The scene always keeps all three layers.

Consequences, stated so they are not argued later:

- Painting a region over cells that hold base tiles **hides** them; it does not destroy them. Erasing the region reveals them again. The editor should say so when a region covers non-zero base cells (note T-N4).
- A direct tile edit is routed by the cell's current state, not by the tool: on a cell that is owned or already overridden it edits the override, and only on a cell with neither does it edit base ([direct paint and erase](#direct-paint-and-erase-of-a-tile)).
- A region never edits another region's coverage or any override. An override never edits coverage.

<a id="pack-tile-cells"></a>
### Pack tile cells **[Proposed]**

The approved scene contract lowers a pack placement's visuals to images or **tile cells** (its `layerOffset` can put a cell on another floor) and does not state what wins when such a cell meets a base, generated or override tile at the same board cell. This page does **not** define that precedence. Instead:

1. **Existing lowering is unchanged.** Where no terrain region owns the destination cell and no override exists for it, pack tile cells are lowered exactly as the approved contract and [tkr-authoring.md section 5](../spec/formats/tkr-authoring.md#5-lowering--build-contract) already say. This page does not restate or alter that.
2. **Destination.** For each tile cell a pack placement yields, its destination is the floor whose layer is the placement floor's layer plus the visual's `layerOffset` (when such a floor exists), and the board cell the existing lowering gives.
3. **Overlap is refused until the pack contract states precedence.** If a destination cell on a floor is owned by a terrain region, or has a `tileOverrides` entry (a `{}` override included), the build refuses (R11, `terrain-pack-overlap`), naming the placement and the region or override. No winner is invented.
4. **No effect on ownership or neighbours.** A pack cell is not terrain: it does not change which region owns a cell or any neighbour test.
5. **One final grid.** The native-tile collision and the contour tracer read the **final cell grid** of each floor: the resolved cells with pack tile cells placed by the existing lowering. Because overlap is refused, every cell of that grid has exactly one source, and preview, trace, collision and board agree.

## Terrain regions **[Proposed]**

`terrainRegions` is an ordered list. Unlike the board tables, it is **not** a slot table; nothing in a `.brd` corresponds to a position in it. List order is **paint order** and matters only where regions overlap ([overlap](#overlapping-regions)). Like vectors and items, it is one board-wide list with a `floor` key.

| Field | Required | Shape | Meaning |
|---|---|---|---|
| `id` | yes | local ID | The region's stable identity, unique in this list. Plugin data and tools address the region by it. Never changes when coverage, terrain or order changes. |
| `label` | no | text, never empty | A human label for the editor. Not stored in a `.brd`. |
| `floor` | yes | floor id | The floor the region is painted on. A region has no stored board layer, so there is no `layer` escape (as for pack placements). |
| `terrain` | yes | `{tileset, terrain}` | The terrain the region is made of ([reference forms](#reference-forms)). |
| `coverage` | yes | `{shape, spans}` | The authored shape ([coverage](#coverage)). |

The mapping is closed: a key not listed is an error. A region carries **no variation seed, rule version, timing or tool name**: the seed belongs to the terrain, the resolver pin to the terrain, timing to the tile ([one owner for every fact](tile-tool-contract-proposal.md#one-owner-for-every-fact)). `pluginData` is not allowed inside a region, as for every record of the scene ([plugin data](../spec/formats/native-scene.md#plugin-data-and-placements)).

### Coverage

`coverage` is a closed mapping with two keys. The scene stores what the creator painted, not which tile each cell received.

| Key | Shape | Meaning |
|---|---|---|
| `shape` | text, exactly `tile-grid` | Names the representation. It exists so another shape can be added later without re-reading old ones; **no other value is defined and none is promised**, and a curve, polygon or freeform shape is not claimed. |
| `spans` | list of `[x, y, length]` | The covered cells as horizontal spans: `length` consecutive cells starting at column `x` of row `y`. May be empty. |

Rules for `tile-grid` coverage:

1. **Cell addressing** is the floor's effective grid exactly as for tiles: `size.width` by `size.height` cells, or for `iso-rotated` the rotated `(width + height)` square, zero-based, `x` the column and `y` the row. These are **cells, not pixels**, whatever `pixelCoordinates` says.
2. **Span shape.** `x` and `y` are integers at least 0, `length` an integer at least 1, `x + length` at most the grid width and `y` below the grid height. A span never crosses a row end.
3. **Canonical order.** Spans are sorted by `y` then `x` and **do not overlap**. Two spans that touch (`[2,1,2]` then `[4,1,3]`) are valid; a writer rewriting a region's spans writes them maximal.
4. **Same cells, same text.** Because spans are canonical, equal coverage has one spelling, so an edit produces a minimal text diff.
5. **Empty coverage** (`spans: []`) is valid and builds nothing. It is how an erased region keeps its identity until the creator deletes it (note T-N2).

*Alternative considered:* full-grid runs `[count, flag]` like `tiles`. Rejected for terrain because it is long for a sparse pond on a large board and has two spellings across row boundaries; spans are compact, sorted and exact.

### What the scene hands a terrain, and what it reads from it

The terrain is defined by a tileset, not by the scene. The tile proposal's [terrain recipe](tile-tool-contract-proposal.md#how-a-terrain-recipe-is-read) already declares what is needed; this is the contract between the two **[Proposed]**:

| Fact | Owner | Scene's part |
|---|---|---|
| Neighbour model (`neighbours: cardinal-4` or `blob-8`), which neighbours a rule may test | tileset terrain | Supplies, for each of the eight neighbour positions of a cell, `same` or `other` ([neighbours](#neighbours)) |
| What a cell past the floor edge counts as (`outside`) | tileset terrain | Supplies "outside the grid" for such a position; the terrain's `outside` turns it into `same` or `other` |
| Coverage promise (`complete` or `partial`) and pattern checks | tileset terrain | Reads the unmatched-pattern outcome and refuses ([R1](#refusals)) |
| Rules, variants and weights | tileset terrain | Nothing |
| Variation input | tileset terrain | Supplies only the floor's `id` and the cell; the other inputs (the **situation** the matched rule covers, the terrain's optional integer `seed`, the matched rule's `variants`) are the terrain's own ([variation](#variation)) |
| Pinned resolver (`resolver: {provider, id, version}`) | tileset terrain | Nothing; the scene stores no rule version |
| `sync` (`lockstep` or `independent`) and timelines | tileset terrain and tile | Nothing |
| Tile art, `role`, `collision`, `wallCapUnder`, animation | tile | Reads them only as the build lowers resolved tiles |
| `expects.projection`, `expects.cellSize` | tileset | Reports a mismatch with the scene projection ([V34](#validation)) |

### Variation

A terrain's weighted variation is a pure function of declared inputs ([tile proposal, rule 7](tile-tool-contract-proposal.md#how-a-terrain-recipe-is-read)): the floor's `id`, the cell coordinates, the **situation** the matched rule covers (its canonical reduced neighbour mask), the terrain's optional `seed`, and the matched rule's `variants` (tiles, weights and order). **The scene supplies the floor's `id` and the cell.** Renameable labels are **not** inputs: neither the rule `id` nor the terrain `id` participates, so renaming either never changes selected art, and because at most one rule may match a situation the situation identifies the rule. Consequences, all **[Proposed]**:

1. The region that owns a cell is **not** an input. Two overlapping regions of the same terrain give the same output at a shared cell, and changing a region's `id`, label, list position or coverage never re-chooses a variant of an unrelated cell.
2. The floor `id` **is** an input, so a floor rename can change variants. The rename is an explicit act that already rewrites every `floor` reference; a floor rename makes earlier output **stale** ([build record](#resolved-cell-and-what-the-board-receives)), not silently current. The tile proposal states the same.
3. No clock, unseeded randomness or iteration order may enter. The integer function and its golden values are the tile proposal's open decision.

## Manual tile overrides **[Proposed]**

`tileOverrides` is an ordered list. Order has no meaning; a writer that adds an entry puts it at the sorted position (floor order, then `y`, then `x`), and a reader accepts any order. Each entry pins **one tile to one cell**.

| Field | Required | Shape | Meaning |
|---|---|---|---|
| `id` | no | local ID | An optional stable name, unique in this list, for plugin data keyed by id. |
| `floor` | yes | floor id | The floor the cell is on. |
| `cell` | yes | `[x, y]` | The cell, in the same effective-grid addressing as coverage. Integers, inside the grid. |
| `tile` | yes | `{tile: <path>}`, `{legacy: <text>}` or `{}` | The tile shown at the cell. |

The three `tile` shapes:

- **Native** `{tile: <path of a .tkrtle>}`: the one native tile reference ([reference forms](#reference-forms)).
- **Legacy** `{legacy: <tile reference text>}`: carried exactly as stored, as in a palette entry. Whether the file exists is a warning, never an error.
- **`{}`** means **deliberately no tile**. The cell resolves to palette index 0 even where a region owns it. It is how a creator cuts a hole in terrain without shrinking the region.

Rules:

1. **At most one override per floor and cell** (error otherwise).
2. **An override is explicit and visible.** The editor must show every override and offer an explicit *clear override* action; nothing else removes one.
3. **An override stays where it is.** It is not tied to any region: it keeps its cell when coverage is reshaped, erased, reordered, or the region is deleted. It then acts as a plain explicit tile placement (note T-N1).
4. **An override never changes neighbours.** Neighbour tests use region ownership, not what is displayed ([neighbours](#neighbours)), so hand-placing a bank tile does not re-choose its generated neighbours.
5. **Overrides add nothing to the scene's base.** They are not written to `floors[].tiles`.
6. **A tile need not be a member of the terrain's tileset.** The bank in the example is a tile the terrain's rules never use. Whether a tileset lists it is the tileset's concern.

<a id="resolution"></a>
## Resolution **[Proposed]**

### Ownership and neighbours

For each floor, in list order, each region's covered cells are marked as owned by that region; **a later region replaces an earlier owner** on a shared cell. The result is one owner (or none) per cell. This is derived on every build and never written to the scene.

#### Neighbours

For a cell `c` owned by a region of terrain `T`, each of its eight neighbour positions is `same` or `other` for the purposes of `T`'s rules, as the tile proposal reads them ([same and other](tile-tool-contract-proposal.md#how-a-terrain-recipe-is-read), item 1): a neighbour is `same` if and only if the **owner** of that cell, after the overlap rule above, is a region whose terrain reference is the same `{tileset, terrain}` as `T`. The terrain's `neighbours` model then selects which positions its rules may read. Therefore:

- Two adjacent regions of the **same terrain** merge seamlessly, whichever region owns each cell.
- A cell owned by a **different terrain**, an unowned cell, and an erased cell (no longer in any coverage) are all `other`. Transitions between different terrains are not provided in this proposal.
- A position **outside the grid** is resolved by the terrain's own `outside` value (`same` or `other`), not by the scene. `outside` is optional and **defaults to `other`**, as the tile proposal states.
- **Overrides are ignored by the test.** What a cell displays never changes how its neighbours are chosen.

### Overlapping regions

Overlap is allowed. Regions on different floors never interact; the rules below apply to regions on one floor:

1. **The later region wins** an overlapped cell for ownership and so for the generated tile. The earlier region's `coverage` is **not clipped**: it still lists the cell as authored.
2. Reordering regions, or changing which region is later, changes ownership and so the build. The editor offers explicit raise and lower actions; list position is meaningful and the writer never reorders it on its own.
3. Because coverage is retained, **erasing or deleting the later region makes the earlier region own the cell again**, recomputed from the recipe. Nothing was lost by the overlap.
4. Overlap of two regions of the same terrain gives the same output whichever owns the cell: neighbour tests are by terrain, and variation does not depend on the owner ([variation](#variation)).

Worked ownership, a 5-wide row (`y = 1`), regions in list order `lake` (water) then `mud`:

```yaml
terrainRegions:
  - id: lake
    floor: ground
    terrain: {tileset: tiles/village.tkrtst, terrain: pond-water}
    coverage: {shape: tile-grid, spans: [[0, 1, 5]]}
  - id: mud
    floor: ground
    terrain: {tileset: tiles/village.tkrtst, terrain: mud}
    coverage: {shape: tile-grid, spans: [[2, 1, 2]]}
```

| x | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| authored by `lake` | yes | yes | yes | yes | yes |
| authored by `mud` | | | yes | yes | |
| **owner** | lake | lake | **mud** | **mud** | lake |

For water at `x = 1` and `x = 4`, the neighbours at `x = 2` and `x = 3` are `other`. Erase `mud` (its `spans` becomes `[]`): `lake` owns all five cells again and `x = 2` and `x = 3` become water, recomputed. (The terrain `mud` is illustrative; no tileset in this repository defines it.)

### Erase **[Proposed]**

"Erase" has three distinct meanings; the editor never merges them:

| Action | Writes | Does not touch |
|---|---|---|
| Erase terrain from a region | Removes the cells from **that region's** `spans`. | Other regions, overrides, base. |
| Erase terrain on a floor (any region) | Removes the cells from **every** region on that floor that lists them. | Overrides, base. |
| Clear override | Deletes the one `tileOverrides` entry. | Regions, base. |

<a id="direct-paint-and-erase-of-a-tile"></a>
### Direct paint and erase of a tile **[Proposed]**

A direct tile edit (paint tile `T`, or erase tile) is routed by the cell's state, checking for an override and for ownership **before** touching base:

| Owned by a region | Override present | Direct paint `T` | Direct erase tile |
|---|---|---|---|
| no | no | base cell becomes `T`'s palette index (as today) | base cell becomes 0 (as today) |
| no | yes | the override becomes `T` | the override becomes `{}` |
| yes | no | create an override `T` | create an override `{}` |
| yes | yes | the override becomes `T` | the override becomes `{}` |

Rules:

1. **Base is edited only when the cell is neither owned nor overridden.** Base is never changed under a visible override or region, so what the creator paints or erases is what shows.
2. **Direct erase never deletes an override**; it sets `{}`, a visible hole. Deletion of an override is *clear override* alone. Painting `T` onto an existing override keeps that entry's `id`.
3. **Terrain erase and terrain paint never touch overrides or base.** Painting terrain over a cell that holds an override leaves the override winning (note T-N1 or T-N3 as applicable).
4. If an edit leaves an override equal to what the cell would show without it, the entry stays and note T-N3 is reported; nothing deletes it automatically.

In the pond after step 3, `(2,4)` is overridden and unowned: painting a tile there changes the override and leaves the hidden base alone; erase tile there sets `{}` and the base does not reappear; only *clear override* reveals base.

An erase of terrain that empties a region leaves it with `spans: []` and its `id`; deleting a region is a separate explicit action. Erasing terrain at a cell that holds an override leaves the override at the cell (the editor shows an override outside any region, note T-N1). Terrain erase never fails because of an override.

### Resolved cell and what the board receives

For floor `f`, cell `c`, with `base` the existing palette index at `c`:

```text
override(f, c)            -> the override's tile ({} is index 0)
else owner(f, c) exists   -> the tile the owner's terrain picks for (c, neighbour tests, variation inputs)
else                      -> base(f, c)
```

If an override exists at a cell, the recipe's choice for that cell is **not requested**, so a pattern the recipe lacks at that cell is not a problem while the override stands (removing the override can then expose it).

The build then:

1. Allocates **generated palette entries** after every scene-owned `tilePalette` slot, so no scene-owned index shifts ([order and indices](../spec/formats/native-scene.md#order-and-indices), rule 3). Entries are the distinct tile references the resolution needs and that the palette does not already hold, in order of first use scanning floors in list order, then `y`, then `x`; a reference already in the palette reuses that slot. That order is deterministic; it is not a promise to scripts. **An absent `tilePalette` stays absent** (stored upper bound −1, which the approved contract distinguishes from a present palette) unless lowering needs at least one non-empty entry: only then does the built board get a table, with slot 0 empty followed by the generated entries. A board whose resolved cells are all index 0, including an unchanged empty board or one with only `{}` overrides, keeps no table. These are **board palette indices** only. How a tile's own legacy reference is produced (the `.tst` slot it takes, the `.tan` a timeline lowers to) is the tile and tileset proposal's lowering and its open slot-allocation decision ([open decision 3](tile-tool-contract-proposal.md#open-decisions)); a generated `.tan` reference is an ordinary legacy tile reference the palette already accepts.
2. Checks the **last-cell residue** before writing (R10), then writes the tile stream of resolved cells with the existing board writer rules (maximal runs, split at floor boundaries). The approved format requires the last logical cell of the last floor and the whole `legacy.excessTiles` overshoot to share one run marker, so the overshoot's `index` must equal the **resolved** palette index of that last cell (V19 compares it only with the base cell). If a region or override makes the last cell's resolved index differ, the build refuses: it never appends the old index as a separate run (a reader would take that run as the next board field), never rewrites the residue on its own, and never drops it. The author decides explicitly: update or clear `legacy.excessTiles`, or move the region or override off the last cell. The approved contract says `legacy` is written only by an import, so an explicit author edit of the residue is an amendment this page needs; it is flagged in the [owner review](#owner-review-consequential-choices), item 14.
3. Applies the existing native-tile collision rule **per cell of the final grid**: a native tile there contributes the `collision` its `.tkrtle` states, as generated vectors after the scene's own. Nothing new is added to geometry, and walk-behind is not promised.
4. **[Proposed]** Lets the existing contour tracer for a floor with `boundarySources` read the **final cell grid** ([pack tile cells](#pack-tile-cells)), so preview, trace and board agree. This is a change to the tracer's input and is flagged in the [owner review](#owner-review-consequential-choices).
5. Never writes into the scene, and writes nothing if any check at the build level fails ([refusals](#refusals)).
6. Applies the tile proposal's **output ownership** ([generated art](tile-tool-contract-proposal.md#generated-art-ownership-outside-edits-and-partial-writes)) before anything is written. For **every tile the build uses**, whether referenced directly (a palette entry, a `boundarySources.walkableTiles` contour source, an override) or produced by a terrain rule, the **candidate set** is every `.tkrtst` in the project that lists the tile in `tiles` and has an `outputBinding`, and the owner is its one member. Zero candidates is R9 `tile-output-unresolved`; more than one is R9 `tile-output-ambiguous`. A tile that is both produced by a rule of a terrain in tileset `T` and referenced directly needs a candidate set of exactly `{T}`. The lookup reads tilesets the scene never names, so **tileset membership is an implicit build input**: adding a second tileset that lists an already built tile can turn a success into R9 without changing the scene or any file it names, and the candidate set is recorded so that such a change makes earlier output stale (next item).
7. Reports a **build record** in the form the tile proposal gives ([build record](tile-tool-contract-proposal.md#at-build-time)): the **inputs** (the scene, each referenced tileset and tile document, each source image, each resolver `id` and `version`); for each tile used, its **owning tileset**, that tileset's `outputBinding` (target and detail) and the **whole candidate set**; the **outputs** (every generated file, this scene's `.brd` included, by normalized path with a digest of the bytes written); and a status of `current`, `stale`, `failed` or `none`. This page adds the slot assigned once the tile proposal defines slot allocation, the number of generated cells and palette entries, the number of overrides applied, and each note. The scene does not store the record, so it does not change on every build. A change to the scene, a tile, a tileset, an image, a resolver pin, a floor `id`, or a tile's candidate set, owner, target, detail or slot makes an earlier output **stale** (`build-output-stale`), never silently current. Where the record is kept is open, as for the `.brd` hash.
8. Follows the tile proposal's **output destination, edit and partial-write rules**, which this page adopts by reference and does not restate. In preflight, a generated path claimed by two tilesets, or equal to a native document, a source image or this scene's `.brd`, is `output-destination-collision` (R12). Before overwriting, a generated file that is missing, differs from its recorded digest, or exists with no record stops the build with `output-edited-outside` (R13); this sits beside the existing `.brd` outside-edit rule (R8) and never overwrites. The build writes the tileset outputs and the `.brd` as one prepared set and never assumes a multi-file write is atomic: if any file cannot be written the status is `failed` with `build-output-partial` (R14), the written and unwritten files are listed, and the previous record is not replaced and never reported `current`.

## Worked example: the pond **[Proposed]**

This expands the six-step sequence of [terrain-scene-formats.md](terrain-scene-formats.md#a-concrete-editing-sequence), using the **`pond-water` terrain of the tile proposal** ([tileset example](tile-tool-contract-proposal.md#the-tileset-document-tkrtst): `neighbours: blob-8`, 13 rules whose ids are the piece names below) and its `bank-mossy` tile. **It is not a fixture and is not accepted by any reader today.** Neither the tileset nor the tiles exist in this repository; they are the tile proposal's illustrative documents.

An 8 by 6, `2d` scene with one floor `ground`. Only the affected keys are shown.

### Step 1: paint water

```yaml
contract: scene
version: 1.0.0-pre.N        # proposed revision; number assigned at cutover
projection: 2d
size: {width: 8, height: 6}
floors:
  - id: ground
    tiles: [[48, 1]]        # base: every cell shows palette entry 1
tilePalette:
  - {}
  - {legacy: village.tst1}
terrainRegions:             # proposed
  - id: pond
    label: Village pond
    floor: ground
    terrain: {tileset: tiles/village.tkrtst, terrain: pond-water}
    coverage:
      shape: tile-grid
      spans:
        - [2, 1, 4]
        - [1, 2, 5]
        - [1, 3, 4]
        - [2, 4, 3]
```

The 16 covered cells (`x` across, `y` down), each labelled with the id of the tile proposal's rule that matches it:

```text
      x0   x1   x2   x3   x4   x5   x6   x7
y0    .    .    .    .    .    .    .    .
y1    .    .    oNW  eN   eN   oNE  .    .
y2    .    oNW  iNW  FL   iSE  oSE  .    .
y3    .    oSW  iSW  FL   eE   .    .    .
y4    .    .    oSW  eS   oSE  .    .    .
y5    .    .    .    .    .    .    .    .

FL fill; eN/eE/eS/eW rule edge-n/-e/-s/-w; oXX rule outer-xx; iXX rule inner-xx
```

`(2,2)` matches `inner-nw` because its north-west diagonal is `other` and every other neighbour is `same`; `(4,2)` matches `inner-se` because its south-east diagonal `(5,3)` is `other`. The base (palette entry 1) is untouched under the pond. The build resolves 16 cells to generated entries and the other 32 to base.

### Step 2: hand-place a bank

The artist places the `bank-mossy` tile on the pond cell `(2,4)`. It is an override; `pond` is unchanged.

```yaml
tileOverrides:              # proposed
  - id: bank-sw
    floor: ground
    cell: [2, 4]
    tile: {tile: tiles/water/bank-mossy.tkrtle}
```

The resolved cell `(2,4)` is the bank tile; **every other cell is identical to step 1**, because the neighbour test ignores overrides (override rule 4). The `outer-sw` rule's tile for `(2,4)` is not requested.

### Step 3: erase water under the bank

The artist erases terrain at `(2,4)`. Only `pond`'s fourth span changes; the override is not touched:

```yaml
terrainRegions:             # excerpt: floor and terrain keys omitted
  - id: pond
    coverage:
      shape: tile-grid
      spans:
        - [2, 1, 4]
        - [1, 2, 5]
        - [1, 3, 4]
        - [3, 4, 2]         # was [2, 4, 3]
tileOverrides:
  - id: bank-sw
    floor: ground
    cell: [2, 4]
    tile: {tile: tiles/water/bank-mossy.tkrtle}
```

`(2,4)` is no longer pond but still shows the bank: an explicit placement outside any region (note T-N1). Its former neighbours are re-chosen because the pond's shape changed:

| Cell | Before | After | Why |
|---|---|---|---|
| `(2,3)` | `inner-sw` | `edge-s` | its south neighbour `(2,4)` is no longer `same` |
| `(3,3)` | `fill` | `inner-sw` | its south-west diagonal `(2,4)` is no longer `same` |
| `(3,4)` | `edge-s` | `outer-sw` | its west neighbour `(2,4)` is no longer `same` |

### Step 4: remove the override explicitly

*Clear override* deletes the `bank-sw` entry. `(2,4)` is now unowned, so it resolves to base (palette entry 1). Nothing else changes.

### Step 5: the source art changes

The scene has no knowledge of source art. Tile paths and the terrain id are unchanged, so no scene edit is needed; a moved rectangle in a sheet is a `rect` edit of the `.tkrtle` ([tile identity](tile-tool-contract-proposal.md#stable-references), consequence 3). The previous output is **stale** and the board is not called current until a build runs against the changed inputs.

### Step 6: the resolver is unavailable

The scene opens and every authored key stays editable, including coverage and overrides. A build is refused with `terrain-resolver-missing` or `terrain-resolver-version-unavailable` (R4); the previous `.brd` is not reported as a new successful build.

## Build outcomes

<a id="a-successful-build"></a>
### A successful build **[Proposed]**

**Condition.** The `pond-water` terrain as the tile proposal writes it uses animated tiles and `sync: lockstep`. With those documents the build below is **refused** (R5) until [animated lowering](#animated-lowering) is shown on the target. The following describes a build whose terrain resolves only to tiles with no animation, or to animated tiles once that gate has been met; it does not claim `pond-water` builds today.

Using the scene after step 3: the build writes `Boards/<stem>.brd` as today, whose tile stream has the base for 32 cells, 15 generated tiles from the recipe, and the bank tile at `(2,4)`; the palette is `{}`, `village.tst1`, then the generated entries (including the one built for the bank tile) in first-use order. The record names `tiles/village.tkrtst` `pond-water` with its resolver id and version, 15 generated cells, N generated palette entries, 1 override applied, status `current`, and note T-N1 for `bank-sw`.

<a id="animated-lowering"></a>
### Animated lowering **[Proposed]**

The scene build lowers a resolved animated native tile (a `.tkrtle` with a `timeline`) only when all three of these have been **shown on the target**, the runtime that plays the built board, by playback and not by the encoding of a `.tan` alone:

1. **Playback.** The target advances the frame of a lowered animated tile as ticks pass. That a `.tan` is correctly written does not show that it plays.
2. **Timing.** Each frame's authored `ms` is reproduced in the target's actual ticks. The `.tan` encoding test of the tile proposal (an integer speed in 1 to 200) is necessary and not sufficient.
3. **Phase and sharing.** A nonzero `phaseMs` is refused for **every** animated tile that would be built, whatever its terrain's `sync` and whether the tile is reached directly or through a rule (`animation-phase-unrepresentable`); the `.tan` format has no phase field and no independent phase is offered. A `sync: lockstep` terrain is refused until a golden test of a built scene shows equal-cycle tiles staying in step across ticks (the same `animation-phase-unrepresentable`, reason: lockstep unproven). That test must also show the tiles actually play (item 1), not only that their frames agree at one tick.

`sync: independent` does not lift the gate. It says only that no coordination is required between a terrain's tiles: each tile must still play and lower exactly, and it runs from the board's zero tick, not from an independent phase. Connected water needs a shared phase ([Painting a world](terrain-scene-formats.md#tiles-and-terrain-recipes)), which `independent` does not provide. Until playback and timing are shown, **every** animated native tile is refused in the scene build (R5), whatever the terrain's `sync`, naming the tile and the terrain; until the shared-phase test exists, every `lockstep` terrain is refused as well.

**Evidence on the current runtime**, from reading source at this worktree's revision. It was not produced by running code, and it is evidence for the gate, not a claim that anything is fixed or will be:

- `packages/core/src/world/hydrate.ts` resolves a `.tan` tile by selecting one frame with `frameAt(0, tick, ticksPerFrame(speed), …)` when the board is hydrated (lines 260 and 329) and stores that frame as an ordinary tile. I found nothing in that file that sets `animation` data on a hydrated tile, and `packages/core/src/render/compose.ts` (`selectedTile`, lines 587 to 591) advances only tiles that carry `animation`. On that reading a `.tan` tile keeps the frame chosen at hydration and does not play, which would defeat any animated-water claim even for correctly written frames.
- `ticksPerFrame(speed)` is `max(1, floor(TICKS_PER_SECOND / speed + 0.5))` and `TICKS_PER_SECOND` is 60 (`packages/core/src/time/time.ts`). 125 ms is speed 8, which gives 8 ticks, about 133.3 ms, not 125 ms. The tile proposal now applies both rules (the wire format and this playback rounding) and reaches the same set, which this page reached by its own arithmetic from the same code (**[INFERENCE]**, neither executed): only 50, 100, 200, 250, 500 and 1000 ms survive both unchanged.

### Refusals

A **refusal** is a problem at the build level: the build writes nothing, the scene is untouched, and the previous `.brd` stays as it was and is not reported as current (`build-output-stale` shows it only as the last successful build). A reader or project problem stops the build earlier with the same effect. Each row is **[Proposed]**. `kind` strings are the tile proposal's wherever it names the situation ([build-time codes](tile-tool-contract-proposal.md#at-build-time)): `terrain-pattern-unmatched`, the resolver, animation, `tile-output-*`, `output-destination-collision`, `output-edited-outside` and `build-output-partial` codes are the tile proposal's. `terrain-unresolved`, `tile-unresolved`, `terrain-projection-unsupported`, `terrain-palette-overflow`, `terrain-excess-tiles-mismatch`, `terrain-pack-overlap` and `animation-playback-unproven` are this page's and illustrative. `path` and `message` follow the existing reader problem shape.

| # | Situation | Problem `kind` and `path` | Message (illustrative) |
|---|---|---|---|
| R1 | An owned, non-overridden cell's neighbour situation matches no rule of its terrain. | `terrain-pattern-unmatched`, `terrainRegions[0].coverage.spans[4]` | `pond-water: no rule matches owned cell (6,5), situation n:other e:other s:other w:other. Not substituted.` |
| R2 | The terrain's tileset does not resolve, or the id names no terrain or more than one. | `terrain-unresolved`, `terrainRegions[0].terrain` | `tiles/village.tkrtst has no terrain "pond-water".` |
| R3 | The scene's projection is not `2d`. | `terrain-projection-unsupported`, `terrainRegions[0]` | `Terrain regions build only on 2d scenes; this scene is iso-stacked.` |
| R4 | The terrain's pinned resolver, or its version, is not available. | `terrain-resolver-missing` or `terrain-resolver-version-unavailable`, `terrainRegions[0].terrain` | `Resolver builtin neighbour-match 1.0.0 is not available (available: 0.9.0). The pond remains editable.` |
| R5 | An animated native tile is resolved and [animated lowering](#animated-lowering) is not shown (playback or tick timing), a tile has a nonzero `phaseMs`, or the terrain is `lockstep` and its shared-phase test does not exist. | `animation-playback-unproven`, `animation-timing-unrepresentable` or `animation-phase-unrepresentable`, at `terrainRegions[0].terrain` and the tile path | `Tile tiles/water/fill.tkrtle (terrain pond-water) is animated; playback of lowered tiles on the target is not shown. Refused whatever sync says.` |
| R6 | A generated entry would take a palette index above 32,767. | `terrain-palette-overflow`, `tilePalette` | `The board needs 32,812 tile slots; the maximum is 32,768.` |
| R7 | An override's or palette's native tile does not resolve to a registered `.tkrtle`. | `tile-unresolved`, `tileOverrides[0].tile` | `tiles/water/bank-mossy.tkrtle is not a registered tile document.` |
| R8 | The `.brd` was edited outside since the last build. | existing rule | Existing build rule 5: the overwrite is blocked and the recovery import is offered; unaffected by this proposal, except that recovery cannot restore regions or overrides (U10). |
| R9 | A tile the build uses, referenced directly or produced by a rule, has no candidate tileset with an `outputBinding` or more than one; or it is both rule-produced and directly referenced and its candidate set is not its terrain's tileset alone ([output ownership](#resolved-cell-and-what-the-board-receives), item 6). | `tile-output-unresolved` or `tile-output-ambiguous`, `tileOverrides[0].tile` | `tiles/water/bank-mossy.tkrtle is a member of no tileset with an output binding.` or `... is a member of tiles/village.tkrtst and tiles/water.tkrtst.` See [owner review](#owner-review-consequential-choices), item 13. |
| R10 | A region or override changes the last cell of the last floor so its resolved palette index differs from `legacy.excessTiles`. | `terrain-excess-tiles-mismatch`, `legacy.excessTiles` | `The last cell of floor roof resolves to palette index 7 but legacy.excessTiles continues index 3. Update or clear the residue, or move the region or override off the last cell. Nothing written.` |
| R11 | A pack tile cell lands on a cell owned by a region or holding an override. | `terrain-pack-overlap`, `placedPacks[0]` | `Pack placement lantern-1 yields a tile cell at (3,2) on floor ground, which region pond owns. Precedence is not defined; refused.` |
| R12 | Two tilesets claim one generated path, or a generated path is a native document, a source image or this scene's `.brd`. | `output-destination-collision`, the claiming tileset's `outputBinding.target` | `tiles/a.tkrtst and tiles/b.tkrtst both generate tiles/village-built.tst.` |
| R13 | A generated file is missing, differs from its recorded digest, or exists with no record. | `output-edited-outside`, the file's path | `tiles/village-built.tst differs from its recorded digest. Not overwritten; choose to keep or rebuild.` |
| R14 | A file of the output set could not be written. | `build-output-partial`, the file's path | `Wrote 1 of 2 files; tiles/village-built.tst not written. Status failed; the previous record is kept.` |

A failing R1 scene, the pond with a stray cell:

```yaml
terrainRegions:
  - id: pond
    floor: ground
    terrain: {tileset: tiles/village.tkrtst, terrain: pond-water}
    coverage:
      shape: tile-grid
      spans: [[2, 1, 4], [1, 2, 5], [1, 3, 4], [2, 4, 3], [6, 5, 1]]
```

The single cell `(6,5)` has no `same` neighbour. The tile proposal's `pond-water` rules have no isolated-cell rule (13 rules cover 13 of 47 `blob-8` situations), so the build reports, in the tile proposal's form:

```text
problem terrain-pattern-unmatched
  scene     Boards/pond.tkrscn   floor ground   region pond   cell [6, 5]   (owned, not overridden)
  terrain   tiles/village.tkrtst  pond-water   (resolver builtin neighbour-match 1.0.0)
  situation n:other e:other s:other w:other
  rules     13 declared, none match this situation; 34 of 47 situations are uncovered
  effect    build failed; Boards/pond.tkrscn unchanged; last successful output is stale
```

Nothing is written. The fix is the creator's: remove the cell, extend the pond, add a rule to the tileset, or switch terrain. If `(6,5)` were hand-overridden, R1 would not fire for it, because no tile is requested there. (The scene is shown under `Boards/` as the existing contract requires; V21 warns for any other folder.)

### Reader and project refusals

Fixtures a reader or project check must reject, each with a located problem (**[Proposed]**):

```yaml
terrainRegions:
  - id: pond
    floor: ground
    terrain: {tileset: tiles/village.tkrtst, terrain: pond-water}
    coverage:
      shape: tile-grid
      spans: [[5, 1, 4]]       # x + length = 9 > width 8: V25
  - id: pond                   # duplicate id: V22
    floor: roof                # no such floor: V23
    terrain: {tileset: tiles/village.tkrtile, terrain: pond-water}   # retired extension in a declared field: V27
    coverage: {shape: curve, spans: []}   # unknown shape: V24
tileOverrides:
  - {floor: ground, cell: [2, 4], tile: {tileset: tiles/village.tkrtst, tile: bank-mossy}}  # old tile spelling: V30
  - {floor: ground, cell: [2, 4], tile: {}}    # second override at one cell: V29
tilePalette:
  - {}
  - {tileset: tiles/village.tkrtile, tile: grass-main}   # old spelling, no alias: V8
```

## Validation

**[Proposed]** rows, continuing the existing numbering of [validation](../spec/formats/native-scene.md#validation). "Reader" checks need only the text and the model; "project" checks need the project's files; "build" checks run when building. The `V22` to `V37` numbers are provisional. **V8 and V15 are amended** by the cutover: V8 admits only `{}`, a legacy tile and `{tile: path}`; V15 resolves each native tile to a registered `.tkrtle` whose stamp says `tile`.

| # | Check | Severity | Where |
|---|---|---|---|
| V22 | A region `id` and an override `id` match the local ID grammar and are unique in their own list. | error | reader |
| V23 | Every `floor` of a region or override names a floor of this document; a `layer` key is not accepted on either. | error | reader |
| V24 | `coverage` has exactly `shape` and `spans`; `shape` is `tile-grid`. | error | reader |
| V25 | Every span is `[x, y, length]` of integers in range ([coverage](#coverage), rule 2). | error | reader |
| V26 | Spans are sorted by `y` then `x` and do not overlap. | error | reader |
| V27 | A `terrain` mapping has exactly `tileset` and `terrain`, and `terrain.tileset` ends in `.tkrtst` (the retired `.tkrtile` is rejected here); a region has no key beyond its table. | error | reader |
| V28 | An override `cell` is two integers inside the floor's effective grid. | error | reader |
| V29 | At most one override per floor and cell. | error | reader |
| V30 | An override `tile` is `{}`, a legacy tile or exactly `{tile: <path>}` with a path ending in `.tkrtle`, and nothing else. | error | reader |
| V31 | `terrainRegions`, `tileOverrides` and the `{tile: path}` spelling appear only in a document whose `version` is the proposed revision or later; the retired `{tileset, tile}` mapping and the retired `.tkrtile` extension are rejected in **declared native reference fields only** and nowhere else. | error | reader |
| V32 | Every `terrain.tileset` is a registered tileset document, and `terrain` names exactly one terrain in it. | error | project; build |
| V33 | Every native override tile resolves (V15, extended). | error | project; build |
| V34 | The scene's `projection` equals the tileset's `expects.projection` when declared, and the `projection` of every tile the build resolves, including override and palette tiles. | error | project; build |
| V35 | A legacy override tile names a file that exists. | warning, never blocks | project |
| V36 | The build-level refusals R1, R3 to R7 and R9 to R14. | error | build |
| V37 | A deleted floor, a changed `size` or a rename that would leave coverage or an override unreadable is refused until the author crops, moves or clears them explicitly. | refusal by the editor | editor |

**Notes** (never block, reported so the author sees them):

| # | Note |
|---|---|
| T-N1 | An override sits at a cell no region owns, so it is a plain explicit placement. |
| T-N2 | A region has empty coverage. |
| T-N3 | An override resolves to what the cell would show without it. |
| T-N4 | A region covers cells with non-zero base tiles, which it hides. |

<a id="what-a-brd-cannot-hold"></a>
## What a `.brd` cannot hold **[Proposed]**

One row for the existing table:

| # | Scene feature | Why a `.brd` cannot hold it | What a build does with it |
|---|---|---|---|
| U10 | `terrainRegions` and `tileOverrides`, and which resolved cells were generated or hand-placed | The board stores resolved tile cells and generated vectors, not the shape or the recipe they came from. | The resolved cells are written; coverage, overrides and provenance are not. Reported as a note naming each region and override count. On a plain `.brd` the editor shows terrain painting as unavailable with *convert to a scene*, as for other scene-only features. A recovery import produces base tiles only and cannot restore regions or overrides. |

## Preservation **[Proposed]**

These add to the shared preservation rules ([native-contracts.md](../spec/formats/native-contracts.md#preservation)); nothing here relaxes them.

1. **Edits are splices.** Painting or erasing terrain changes only the affected region's `spans` text; adding or clearing an override adds or removes one entry; reordering regions moves only the affected entries. Comments, quoting, key order and unknown plugin blocks elsewhere stay as written. A writer that cannot do this for an edit refuses with a located error and never regenerates the document.
2. **Authored data is never dropped by a build.** A build never reads authored coverage or overrides back out of the board; it never writes into the scene.
3. **Missing terrain tileset, terrain, tile or resolver.** The document still opens. Coverage, overrides and every other key stay readable and editable; preview of that terrain is unavailable or labelled as a preview, and the affected build refuses (R2, R4, R7). Nothing is substituted.
4. **Stranded cells are never silently removed.** A change to the board's size, or a deleted floor, that would leave coverage or an override out of range is refused until the creator chooses to crop or move them (V37). The editor offers crop and move; it never decides.
5. **Renames.** A rename of a floor, tileset, terrain or tile rewrites every location in [where references are](#where-references-are-replacement-and-additions) in one all-or-nothing step, and the tool refuses a reference it cannot read. Plugin data and scripts cannot be searched and the tool must say so, as the tile proposal also states.
6. **Compatibility.** A reader that does not know the proposed revision rejects the document by the closed contract and does not guess. Existing scenes are not migrated: an existing scene has no regions or overrides, its tile runs are never converted into regions, and its old-spelling native tile entries become errors at the cutover rather than being aliased ([cutover](#cutover-of-the-existing-native-tile-references)).

<a id="tools-plugins-and-a-missing-tool"></a>
## Tools, plugins and a missing tool **[Proposed]**

The scene never names the tool that painted a region, and no key identifies one, matching the tile proposal ([tool, plugin and resolver](tile-tool-contract-proposal.md#tool-plugin-and-resolver-where-trust-sits)). A region and an override are ordinary scene data that stay readable and buildable without any tool installed. A tool that needs data about a region keeps it in its own top-level `pluginData` block, keyed by the region's or override's local `id`, so it does not depend on list position; absent, the block is preserved byte for byte and noted as absent. This answers the tile proposal's question whether a region may carry a nested door: it may not.

The tile proposal's example tools use targets `terrain-region` and `tile-placement`. The scene contract would own that vocabulary. This page proposes `terrain-region` to mean writing `terrainRegions[].coverage`, and `tile-placement` to mean a direct tile edit routed by the [direct paint and erase table](#direct-paint-and-erase-of-a-tile): base on a cell that is neither owned nor overridden, otherwise the override. A tool never deletes an override; clearing one is the editor's explicit *clear override* action.

**Required build behaviour** that is missing (a terrain's resolver) blocks the affected build with R4 and a diagnostic; a cached preview or the last successful output may be shown only if clearly marked. A missing **optional editing tool** does not block a build.

## Reconciliation with the tile proposal

Reconciled with [tile-tool-contract-proposal.md](tile-tool-contract-proposal.md) as last revised. Each point needs a decision by whoever owns the named document; none is settled here.

**Aligned, no longer open:** the variation inputs (floor `id`, cell, situation, terrain `seed`, the rule's `variants`; no rule or terrain labels); the seed belongs to the terrain; `outside` defaults to `other`; the unmatched-pattern report uses `Boards/pond.tkrscn` and fires only for owned, non-overridden cells; every tile the build uses, direct or rule-produced, has exactly one output owner, and a tile that is both rule-produced and directly referenced needs a candidate set of its terrain's tileset alone (R9); the build record carries each used tile's owning tileset, `outputBinding` and whole candidate set, so a membership change makes output stale; this scene's `.brd` is in the output set for destination collisions, output digests and partial-write reporting (R12 to R14); the tick-exact duration set 50, 100, 200, 250, 500 and 1000 ms; nonzero `phaseMs` refused for every animated tile and `independent` offering no independent phase; and the rename inventory including `walkableTiles[].tile`.

**Still open:**

1. **Playback, not only phase.** The tile proposal reasons that tiles are in step by construction because every frame is chosen from tick origin zero. This page's reading of the same code is that `hydrate.ts` chooses one frame at hydration and keeps a static tile, so a tile may not play at all ([evidence](#animated-lowering), a reading and not a test). The golden test that lifts the lockstep gate must show frames advancing across ticks, not only agreeing at one tick.
2. **The animated pond cannot yet build.** `pond-water` is animated and `sync: lockstep`; the walkthrough's acceptance ("runtime output reproducible") cannot be met until playback, timing and shared phase are shown ([condition](#a-successful-build)).
3. **Walk-behind.** The scene says a tile reference does not promise walk-behind. If the tile proposal adopts `wallCapUnder` on tiles, that sentence and the generated-vector rules need that decision's geometry first.
4. **Native animated tiles.** The existing scene contract lists a native animated tile as not decided and its palette rule 4 excludes one; the tile proposal defines one (`timeline`). Adopting it means palette rules 4 and 5 and the "not decided" list change in the same cutover ([cutover](#cutover-of-the-existing-native-tile-references), item 1). The scene needs no new key for it.
5. **Pack tile cells.** The approved scene and pack contracts define no precedence between a pack tile cell and another tile source at the same cell. This page refuses the overlap (R11) rather than choose; the pack contract or the owner has to decide.

<a id="owner-review-consequential-choices"></a>
## Owner review: consequential choices **[Proposed]**

1. **Overlap: later wins; coverage not clipped.** Recommended: paint order is the one rule creators already know, nothing is destroyed, and erasing the upper region restores the lower. *Alternative:* forbid overlap on one floor (an error). Simpler, but forces a destructive clip when painting over another terrain.
2. **Out-of-grid neighbours are the terrain's `outside` value**, as the tile proposal declares per terrain. Recommended over a scene-level rule so a terrain can choose to continue off the board.
3. **A region hides, and does not erase, base tiles.** Recommended: the scene keeps all intent. *Alternative:* painting a region overwrites base runs, which is destructive and cannot be undone by erasing.
4. **`tile-grid` coverage as `[x, y, length]` spans.** Recommended for compactness and one spelling. *Alternative:* full-grid runs like `tiles`.
5. **The neighbour test is `same` or `other`, by terrain**, as the tile proposal reads it. A recipe cannot yet declare "treats sand as a neighbour"; that is a tileset rule-model question.
6. **`{}` as a deliberate no-tile override.** Recommended so a hole can be cut without reshaping. *Alternative:* none; a hole would require changing coverage.
7. **The tracer reads resolved cells.** Recommended so preview, walls and board agree. *Alternative:* the tracer reads base only, which could trace walls through water.
8. **Regions build on `2d` only.** Recommended until isometric adjacency and geometry are specified and proven; an iso scene may hold regions but a build is refused (R3).
9. **The scene holds no variation seed, rule version or build state.** The seed and resolver pin belong to the terrain; the scene supplies the floor `id` and cell. Recommended so the scene does not change on every build and every fact has one owner. Where the build record lives is open.
10. **Revision number and cutover.** The proposed keys and the new tile spelling require a pre-release revision of the scene contract; the number, schema, reader, writer, fixtures and rename-tool locations land together. This page does not choose it.
11. **A scene refers to a tile by path alone.** Recommended (the tile proposal's decision 1): a tile has one identity. *Alternative:* keep `{tileset, tile: id}`, which makes a standalone `.tkrtle` depend on a tileset.
12. **The no-alias cutover extends to the reference spelling.** The owner's direction is stated for `.tkrtile`; this page assumes it covers the old `{tileset, tile}` entries too, so they become errors with no translation. Confirm.
13. **How a tile is built.** The tile proposal's rule, which this page adopts: every tile the build uses has exactly one candidate tileset with an `outputBinding`, recorded with its whole candidate set so that a membership change makes output stale. *Alternatives* (an output target on each tile or project, or naming the tileset in the scene reference) were rejected by the tile proposal. Confirm.
14. **Explicit edit of `legacy.excessTiles`.** The approved contract says `legacy` is written only by an import. A region or override on the last cell needs an explicit author action to update or clear the residue (R10). Recommended: allow that single explicit edit and keep the refusal otherwise. *Alternative:* the author moves the region or override off the last cell.
15. **Pack-cell precedence.** Refused for now (R11). The pack contract or the owner should state the winner before any overlap is allowed.

## Not decided here

- The tileset-side terrain definition, rule models, variation function, resolver versioning, tile documents and the `.tkrtile` to `.tkrtst` cutover (the tile proposal and the owner).
- Animated tiles, connected-water phase, legacy `.tst` slot allocation and `.tan` lowering.
- Isometric and rotated adjacency; collision and walk-behind geometry of generated tiles.
- Transitions between different terrains.
- Whether the build record is a sidecar, a store or something else.
- Whether a future scene might define shapes other than `tile-grid`. None is claimed.

## References

- [Painting a world: scene, tile, tileset and tool formats](terrain-scene-formats.md), the owner direction this page makes exact for the scene.
- [Proposal: tile, tileset and tool documents](tile-tool-contract-proposal.md): [stable references](tile-tool-contract-proposal.md#stable-references), [the tileset document](tile-tool-contract-proposal.md#the-tileset-document-tkrtst), [diagnostics](tile-tool-contract-proposal.md#missing-rules-missing-tools-proposed-diagnostics), [open decisions](tile-tool-contract-proposal.md#open-decisions).
- [Native scene contract](../spec/formats/native-scene.md): [floors and tiles](../spec/formats/native-scene.md#tiles), [the tile palette](../spec/formats/native-scene.md#the-tile-palette), [order and indices](../spec/formats/native-scene.md#order-and-indices), [build](../spec/formats/native-scene.md#build-from-a-scene-to-a-board), [validation](../spec/formats/native-scene.md#validation), [plugin data](../spec/formats/native-scene.md#plugin-data-and-placements).
- [Native tileset contract](../spec/formats/native-tileset.md), the current `.tkrtile` draft, and [shared native contracts](../spec/formats/native-contracts.md) (identity, [preservation](../spec/formats/native-contracts.md#preservation), [rename](../spec/formats/native-contracts.md#rename)).
