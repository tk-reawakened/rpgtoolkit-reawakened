# Native scene contract (`.tkrscn`)

**Status: approved pre-release contract.** Jensen confirmed review and approval of this page after merging [#3205](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3205). This is a **Reawakened rule** for the native scene document, not a Toolkit 3.1 behaviour. It is the scene contract of story 27.8 ([#1809](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1809)), written from section 2 of [tkr-authoring.md](tkr-authoring.md#2-scene-document-tkrscn) under the common rules of [native-contracts.md](native-contracts.md) and the amendment to [ADR 0019](../../adr/0019-tkr-authoring-formats.md). The contract remains **pre-release** (`1.0.0-pre.N`), not a 1.0 promise.

## In plain words

A scene is the source document for one game board. It says how big the board is, what floors it has, which tile sits in each cell, where the walls, stairs and trigger areas are, which items stand on it, and the board's music, light and settings. It is written in YAML under the shared stamp, its path is its name, and its own fields are strict: a typo is an error.

A scene is **not** the old `.brd` file and is never made from one by accident. A `.brd` with no scene is still opened and saved directly. Making a scene from a board is an explicit, reviewed step (an **import**). Every one of the board's 75 documented fields lands in a named place in the scene, including the values the engine ignores and the cells a run carries past the end of the grid; or, for the unusual stored values this first cut has no key for, the import refuses with a reason and writes nothing. A refusal is a **limit of this contract**, not a claim that the board could not be preserved ([import](#import-from-a-board-to-a-scene), rule 4). Saving a scene builds the `.brd` that the engine plays ([ADR 0019](../../adr/0019-tkr-authoring-formats.md), decision 4).

A scene can hold things a `.brd` cannot: a stable name for each floor, a stable name for each object, references to standalone tile documents and to native pack assets, and the recipe a wall was traced from. The scene editor shows those as unavailable on a plain `.brd`, with the reason and one action, *convert to a scene* ([what a `.brd` cannot hold](#what-a-brd-cannot-hold)).

A scene keeps **what the board is** (its definition) apart from **what is placed on it** (its placements). A placement names the thing it places and says where and under what condition; it never copies the thing ([definition and placements](#definition-and-placements)).

## Scope

This page decides the scene document and its relation to the `.brd`. It does not decide:

- **The battle scene.** A fight is run by the engine's battle session ([BAT-2](../engine/battle.md)), which stays as it is and separate. The scene carries only the three per-board battle settings the board already holds (fields 68 to 70: the fight background, the skill level, whether random battles are allowed). It describes no fight, no fighter and no battle layout.
- **An actor contract.** In this first cut a placed sprite refers to a legacy item file, as a board does. "Placements reference an actor without duplicating it" is added as a pre-release revision of this contract when the actor contract (story 27.7) is approved; the contract stays `1.0.0-pre.N`, so that revision breaks no promise ([#1809 notes](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1809)). No actor format is invented here.
- **A universal container.** The scene is one board's document. Nothing in it is an open bag of values: the only open region is `pluginData` ([plugin data and placements](#plugin-data-and-placements)), and the one block for data the board holds but the model has no use for, `legacy`, has a closed shape ([legacy-only data](#legacy-only-data)).
- **The YAML profile, the layout contract and the schema technology** ([#1799](../../findings/native-data-notations/README.md)): open, as in [native-contracts.md](native-contracts.md#not-decided-here). Examples show one authored layout.
- **The lowering algorithms** (the wall tracer, tile and pack expansion): [tkr-authoring.md section 5](tkr-authoring.md#5-lowering--build-contract), [native-tileset.md](native-tileset.md#lowering-and-preservation) and [native-asset-pack.md](native-asset-pack.md). This page fixes only what the scene stores and the order in which a build lays records down.

## Stamp, identity and file name

- **Extension:** `.tkrscn`. **Contract stamp:** `contract: scene`; writers emit `version: 1.0.0-pre.2`. `contract` and `version` are the first two keys; the extension and the stamp's `contract` agree ([file names](native-contracts.md#file-names)).
- **Identity:** the document's project-relative path, extension included, such as `Boards/cottage.tkrscn`, under the shared [identity rules](native-contracts.md#identity). There is **no document-level `id`** (the draft's `id` is dropped). A rename changes the identity and every reference to it.
- **Build target and where scenes live.** Saving a scene builds one `.brd` in the **same folder with the same stem and the extension `.brd`** (`Boards/cottage.tkrscn` builds `Boards/cottage.brd`) ([ADR 0019](../../adr/0019-tkr-authoring-formats.md), decision 4). The target is derived, not a field, so it cannot disagree with the path. The engine reaches a board only in the project's `Boards\` folder (sub-folders allowed), by its name relative to that folder ([board.md](board.md), [README.md](README.md#paths-inside-files)); a link or a script names the built `.brd` that way, as it always did. A scene is therefore kept **under `Boards/`**, and the editor creates scenes there. A scene anywhere else builds a `.brd` that no link or script can reach: nothing in this contract makes such an output playable, and the project check warns about it ([V21](#validation)). Renaming a scene renames its build target; see [open items](#not-decided-here).
- **Not shipped.** A distribution package excludes `.tkrscn` ([packaging-and-paths.md](packaging-and-paths.md)); only the built `.brd` ships.
- **Registry row** (added in [native-contracts.md](native-contracts.md#the-registry) and `packages/native-data` in the same change as this page):

  | Extension | Contract | Contract page |
  |---|---|---|
  | `.tkrscn` | `scene` | [native-scene.md](native-scene.md) |

## Top level

The top level holds the stamp, the core fields below, and `pluginData`, and **nothing else**; the contract is closed. `tags`, `metadata` and `pluginData` are the shared reserved keys and follow [native-contracts.md](native-contracts.md#the-top-level-of-a-document). Every nested mapping below is closed in the same way: a key that is not listed is an error, except inside a plugin block's `data`.

| Field | Required | Shape | Meaning |
|---|---|---|---|
| `name` | no | text | A display name for people. Not identity; the path is the identity. |
| `projection` | yes | `2d`, `iso-stacked` or `iso-rotated` | The board's coordinate system ([board.md coordinates](board.md#coordinates)). |
| `pixelCoordinates` | no | boolean | The "use pixel coordinates" flag (coordType flag 4). Absent means false. |
| `size` | yes | `{width, height}` | The board's logical size in tiles. |
| `floors` | yes | non-empty list of [floors](#floors) | The board's layers, in layer order. |
| `tilePalette` | no | list of [palette entries](#the-tile-palette) | The board's tile look-up table. Absent means the board has **no table**. |
| `shading` | no | list of [shading layers](#shading) | Per-tile colour tint layers. |
| `lights` | no | list of [lights](#lights) | Light sources. |
| `vectors` | no | list of [vectors](#vectors) | Collision, walk-behind, stairs and waypoint geometry. |
| `triggers` | no | list of [triggers](#triggers) | Program trigger regions (the board's "programs"). |
| `items` | no | list of [item placements](#item-placements) | Legacy items placed on the board (the board's "sprites"). |
| `images` | no | list of [images](#images) | Free images placed on a floor. |
| `placedPacks` | no | list of [pack placements](#pack-placements) | Assets of a native pack placed on the board. A scene-only feature. |
| `atmosphere` | no | `{ambient, music, background}` | The board-wide tint, music and background ([atmosphere](#atmosphere)). |
| `start` | no | `{x, y, floor or layer}` | Where the player appears ([start](#start)). |
| `links` | no | `{north, south, east, west}` | What lies past each edge ([links](#links)). |
| `enterProgram` | no | text | The program run each time the board is entered. |
| `battle` | no | `{background, skill, allowed}` | The board's battle settings ([battle](#battle)). |
| `savingDisabled` | no | boolean | Saving is disabled on this board. Absent means false. |
| `threads` | no | list of text | Background programs started when the board becomes active. |
| `constants` | no | list of text | Board constants, readable from scripts as `constant[i]`. |
| `legacy` | no | `{layerTitleZero, trailingBytes, excessTiles}` | Data the board holds that the model has no other place for ([legacy-only data](#legacy-only-data)). |
| `pluginData` | no | shared block dictionary | One block per plugin id. |

**Key order.** A writer that creates a document writes the stamp, then `tags`, `metadata`, then the core fields in the order of this table, then `pluginData` last, and inside a record the keys in the order its table gives. A reader accepts any order, and an edit of an existing document never reorders it ([preservation](native-contracts.md#preservation)).

## Conventions

1. **Integers.** Every number is an integer; a fraction is an error. An integer has the range of the legacy field it lands in, unless a narrower range is stated: **i16** is −32768 to 32767 (a legacy `short`) and **i32** is −2147483648 to 2147483647 (a legacy `int`). Each field row names its width. A value outside it is an error, because the build could not store it.
2. **Text and the empty string.** A text value is a UTF-8 string. A keyed text field is **never empty**: the legacy empty string is written by leaving the key out, and an empty text at a keyed position is an error. Inside a **list of text** (`threads`, `constants`) an empty string is allowed and keeps its slot. A text the board cannot store in its Windows-1252 code page ([README.md](README.md#primitive-encoding)) is reported by the build and never changed.
3. **Booleans.** `true` or `false`. The legacy flag is a `short`: any non-zero value reads as true, and the build writes true as `−1` and false as `0`, as the editor does (`CInt(True)` is −1). An absent boolean is false.
4. **Points and colours.** A point is `[x, y]`, two integers. A colour is `[r, g, b]`, each 0 to 255. A **signed offset** (ambient, shade and light values) is `[r, g, b]`, each a signed integer stored as an **i16 and carried exactly as stored**. The documented additive range is −255 to 255 and the shading arithmetic clamps the sum ([board.md](board.md#tile-shading)), but the board's own data is not confined to it: the research census of 683 boards holds shade channels up to 286 ([fields.jsonl](../../findings/native-data-boundaries/data/fields.jsonl)). A value outside −255 to 255 is therefore a note, never a refusal and never clamped. A legacy colour's high byte is zero in every legacy value and is not carried ([README.md](README.md#primitive-encoding)).
5. **Absent means the default.** An optional key that is left out has the default its row states. An import writes an optional key only when its stored value differs from the default, so the same board always gives the same text. A required key is always written.
6. **Local IDs.** A floor `id`, a record `id` and a pack placement `instanceId` match `^[a-z0-9]+(-[a-z0-9]+)*$` and are unique within their own list. They are local names, not document identities, and are never case-folded because they are lowercase by grammar.
7. **Lists and slots.** A legacy table is a zero-based sequence of **slots**. In a scene the **position in the list is the slot index**: position 0 is slot 0. The one exception is `floors`, where position 0 is **layer 1** ([order and indices](#order-and-indices)). A list's stored upper bound is its length minus one. A key that is absent, or a list that is empty, is upper bound −1 ("none"), with one exception: `threads` and `constants` are different because the editor never writes −1 for them. An **absent** `threads` or `constants` builds as the editor writes it, upper bound 0 with one empty entry; an **empty list `[]`** builds as −1, which only an import produces (when the board stored −1). A **counted table** (one the board stores with an upper bound) may hold at most 32,768 entries, the most an upper bound stored as an i16 can address; a build refuses a longer one. The tile and shading streams (`tiles` and `cells`) are **not counted tables**: they carry no upper bound and are covered by their cell count instead, and their run counts are split as the stored width requires ([tiles](#tiles), [shading](#shading)).
8. **Layer reference.** A record that sits on a layer says which by exactly one of two sibling keys: `floor`, the `id` of a floor of this document, or `layer`, an integer. `floor` is the normal form and survives a floor being added, removed or reordered. `layer` is the **escape for a stored layer number that no floor has** (below 1 or above the number of floors), kept as stored so the board still rebuilds with the value it had; the build writes it unchanged, and a `layer` inside 1 to the number of floors is a warning to write `floor` ([validation](#validation)). A `floor` becomes its 1-based position in `floors` when the board is built. The same pair is spelled `toFloor` and `toLayer` for a stairs target, and `floor` and `layer` in `start`.
9. **Reference forms.** Table below.

### Reference forms

A scene refers to other things in these ways and no other. A **native document** is named by its path; a **legacy file** is named the way the board names it.

| Form | Where it is used | Spelling | Resolved by |
|---|---|---|---|
| Native tile | a [palette entry](#the-tile-palette), a floor's `boundarySources.walkableTiles` entry | `{tile: <path of a .tkrtle>}` | The path resolves to exactly one registered standalone `tile` document ([native-tile.md](native-tile.md#stamp-identity-and-fields)). |
| Legacy tile | the same two places | `{legacy: <tile reference text>}`, for example `{legacy: village.tst12}` | Carried **exactly as stored**, in the legacy [tile reference](README.md#tile-references) spelling (`name.tstN`, `name.isoN`, `name.gph`, `name.tan`, sub-folders with `\`). A legacy tile reference is not a native document and has no path identity. Whether the file exists is a warning, not an error ([validation](#validation)). |
| Pack asset | a [pack placement](#pack-placements) | `pack: <path of a .tkrpack>` and `asset: <pack-local asset id>` as two keys | As in [native-asset-pack.md](native-asset-pack.md#scene-references): the path is a native document ID, the asset id is local to that pack. |
| Floor | `floor`, `toFloor` | a floor `id` of this document | The `floors` list. |
| Legacy item file | an [item placement](#item-placements)'s `item` | text, **exactly as stored**, relative to `Item\` | The legacy loader, by the ASCII fold of [README.md](README.md#paths-inside-files). |
| Legacy art, music, battle background | `source`, `atmosphere.background.image`, `atmosphere.music`, `battle.background` | text, **exactly as stored**, relative to the type folder of its kind (`Bitmap\`, `Media\`, `Bkrounds\`) | The legacy loader. |
| Legacy program or inline code, documented slots | a trigger's `program` and every `threads` entry (board fields 26 and 58) | text, **exactly as stored**: a file in `Prg\`, or inline RPGCode when no such file exists | The legacy loader decides which at run time; a scene does not, because only a loader with the file system can. |
| Legacy program name, other hooks | `activationProgram`, `multitaskProgram` and `enterProgram` (board fields 42, 43 and 67) | text, **exactly as stored**, a program name | The legacy loader. [board.md](board.md) documents these as the program to run and establishes **no** inline-code fallback for them, so the scene carries the text as stored and claims no such fallback. |
| Legacy board or program, for a link | `links.*` | text, **exactly as stored** | The legacy loader. |

**Why legacy references are carried as stored and not as project paths.** A name like `village\Houses.TST12` is resolved by the legacy fold, a file name that is a program or inline code cannot be told apart by looking at it, and writing a second spelling of one file would make an import change text that the board never changed. A legacy reference is therefore opaque text with a key named after its kind. Native documents are the only things named by path. *Alternative:* project paths with the type folder, as the draft's `Bitmap/…` examples were ([owner review](#owner-review-consequential-choices), item 5).

### Where references are

Native-document references, and the local ids that go with them, are at exactly these places. This list is part of the contract, so a tool finds them from the contract and needs no per-project configuration:

| Location | Names | Rewritten by a rename of |
|---|---|---|
| `tilePalette[].tile`, `floors[].boundarySources.walkableTiles[].tile`, `tileOverrides[].tile.tile` | a `.tkrtle` document | that tile's path |
| `terrainRegions[].terrain.tileset` | a `.tkrtst` document | that tileset's path |
| `terrainRegions[].terrain.terrain` | a terrain local to the referenced tileset | that terrain's local id |
| `placedPacks[].pack` | a `.tkrpack` document | that pack's path |
| `placedPacks[].asset` | an asset id local to the `pack` beside it | that asset's local id |

**The rename tool must discover and rewrite every one of these** as part of its all-or-nothing rename ([rename](native-contracts.md#rename)), and a reference it cannot read at one of them makes it refuse rather than skip. The location list is nested (`[]` marks a list), where the tool of the shared page takes top-level field names; teaching it nested paths is an implementation need of the rename tool (#1806, cutover #1822), not something this page can configure. A `{legacy: …}` tile reference is not a native document and is never rewritten.

## Definition and placements

The **definition** is what the board is: `projection`, `size`, `floors` and their `tiles`, `tilePalette`, `shading`, `lights`, `vectors`, `triggers`, `images`, `atmosphere`, `links`, `battle` and the rest of the board-wide settings. The **placements** are the records that put something defined elsewhere onto the board: `items` (a legacy item file) and `placedPacks` (an asset of a native pack).

1. **A placement names, it does not copy.** An item placement holds a reference to an item file, a position, a floor, the placement's own conditions and the two program overrides the board already carries. It holds no walk graphics, no stats, no collision polygons and none of the item's own programs. A pack placement holds a pack path, an asset id, a position and a floor, and none of the asset's art, anchor or vectors. Changing the item file or the pack asset changes every placement of it.
2. **What a placement may carry of its own** is exactly the fields in its table: they are the facts about this placement on this board, not facts about the thing placed.
3. **Triggers belong to the definition.** A trigger is a region of this board that runs a named program; it is not a placement of anything, so it is listed with the definition.
4. **The first cut refers to legacy item files.** When the actor contract exists, an item placement gains a sibling reference to an actor document and the contract is revised before 1.0.0 ([scope](#scope)).

## Floors

`floors` is a non-empty ordered list; **the first entry is layer 1**, the second layer 2, and so on, up to the board's `sizeL`. A floor is a mapping:

| Field | Required | Shape | Meaning |
|---|---|---|---|
| `id` | yes | local ID | The floor's stable name. Layer references use it. An import names the floors `layer-1`, `layer-2` and so on; an author may rename a floor, and the editor rewrites every `floor` and `toFloor` that named it. |
| `title` | no | text | The layer title scripts read as `boardtitle[n]` (n is the 1-based layer; the board spec says scripts read titles 1 to 8). Absent means the empty title. |
| `tiles` | no | list of `[count, index]` | The floor's tile cells ([tiles](#tiles)). Absent means every cell is empty (palette index 0). |
| `boundarySources` | no | `{walkableTiles, autoWallCaps}` | Wall-tracing inputs. A scene-only feature ([boundary sources](#boundary-sources)). |

There is no `layer` key on a floor: the layer number is the position, and a second copy could disagree with it.

### Tiles

A floor's cells are written as **runs** `[count, index]`: `count` consecutive cells that all show `tilePalette` entry `index`.

1. **Cell grid.** The cells are the board's **effective grid**: `size.width` by `size.height` cells, except for `iso-rotated`, where the grid is `(size.width + size.height)` by `(size.width + size.height)` and a cell is addressed on the rotated axes as the board stores it ([coordinates](board.md#coordinates)). Cells run **row by row, x fastest**, and a run may carry on across a row end.
2. **Exact cover.** The counts of a floor sum to exactly the number of cells of the effective grid. A run never crosses from one floor into the next: each floor starts its own sequence.
3. **Values.** `count` is an integer of at least 1. A run list is not a counted table, so it has no upper bound of its own; the build splits a run as the width of the board's run marker requires (a marker covers up to 32,768 cells), and the **last marker of the stream keeps the overshoot** (item 6). `index` is an integer from 0 to 32,767 and must name an existing palette position (0 always means no tile). With **no `tilePalette`**, every index must be 0.
4. **An import writes maximal runs:** adjacent cells with one index are one run, and a run never spans floors. The board's own run boundaries, and whether a one-cell run used the run marker, are encoding and not model; they are not carried ([semantic equality](#semantic-equality)).
5. **Size limit.** The effective grid times the number of floors may not exceed **4,194,304 cells** ([board.md size limits](board.md#size-limits)); an import and a build both refuse more, with a located error.
6. **Cells past the end.** A final run that carries past the last cell of the last floor keeps its extra cells in the top-level `legacy.excessTiles`, written `[count, index]`: the number of extra cells (an integer of at least 1 and at most 32,767, because the final marker also holds at least one cell of the grid) and the palette index they show. They are not cells of any floor, so they are not in any `tiles`, and they are not checked against the palette. Because a stream ends at the run that reaches its end, the extra cells always continue that run: `index` equals the index of the last cell of the last floor. **Rebuild rule:** the build writes the stream as the grid's cells followed by these cells. A run longer than one marker can hold is split into several markers, and the **last marker holds the grid's last cell or cells together with the whole excess**, so the overshoot stays inside the final record and the stream ends where a reader ends it. If an edit changes the last cell of the last floor, the editor has to clear or update `legacy.excessTiles`; a document where they disagree is an error ([validation](#validation)).

### Resolving painted terrain

This section is part of the current scene contract ([ADR 0019](../../adr/0019-tkr-authoring-formats.md#amendment-retained-terrain-and-standalone-tiles)). It changes neither legacy import nor the meaning of a base tile run.

The closed top-level mapping gains two optional lists immediately after `tilePalette`. An absent list is empty:

| List | Closed record in writer key order |
|---|---|
| `terrainRegions` | Required `id`, optional `label`, required `floor`, `terrain` and `coverage`. `id` is a unique local ID, `label` is non-empty editor text and `floor` names an existing floor. `terrain` has exactly `tileset` (path of a `.tkrtst`) and `terrain` (its local terrain ID). `coverage` has exactly `shape: tile-grid` and `spans`, a possibly empty list of `[x, y, length]` cell spans. |
| `tileOverrides` | Optional unique local `id`, required `floor`, `cell` and `tile`. `floor` names an existing floor; `cell` is `[x, y]`. `tile` is `{tile: <.tkrtle path>}`, `{legacy: <legacy tile reference>}` or `{}`. The empty mapping means deliberately no tile, not a missing override. |

Addresses are zero-based integers on the same effective grid as `tiles`. A span's positive length must stay within its row. Spans are ordered by `y` then `x` without overlap; a reader accepts adjacent spans, and an editor rewriting coverage writes maximal spans. Region order is paint order and is never normalized. An override must be unique by floor and cell. Override order affects nothing; a writer inserting one places it in floor, row and column order.

The palette and `boundarySources.walkableTiles` use `{tile: <.tkrtle path>}`. `tileOverrides[].tile` has that same form, `{legacy: <legacy tile reference>}`, or `{}`. `terrainRegions[].terrain` is `{tileset: <.tkrtst path>, terrain: <terrain-local id>}`. Inventory and rename include every listed tile path and the terrain document path/local ID; tile document paths are rewritten on tile rename, and terrain-local IDs on terrain rename. A project check locates missing or ambiguous document and terrain targets at their reference; it does not substitute a tile.

#### Cell precedence

1. On each floor, mark the runs of every region in paint order on the effective cell grid described above. A later region replaces the owner of each shared cell without clipping the earlier region's authored spans. Floors are independent.
2. At an owned cell, `same` means the neighbouring cell's final owner names the same normalized tileset document and exact terrain ID, regardless of region ID. Outside the effective grid, use the recipe's `outside` value (default `other`). Base tiles and manual overrides never enter this comparison.
3. An override wins at its cell, including an explicit empty tile, even if no region owns that cell. Do not call the recipe at an overridden cell. Otherwise, an owned cell uses the tile selected by the [built-in terrain matcher](native-tileset.md#built-in-terrain-matcher); a missing match is an error at the owning region and cell. Leave every other cell at its base value. Do not write generated cells back into the authored document.
4. A build refuses a pack tile cell at any owned or overridden position; an explicit empty override is still an override. The same resolved grid, after legal pack tile cells have been placed, feeds board tile runs, collision and boundary tracing.

### Boundary sources

`boundarySources` records what a floor's walls were traced from, so they can be traced again. It has two optional keys: `walkableTiles`, a non-empty list of **tile references** (native or legacy form, never `{}`), and `autoWallCaps`, a boolean (absent means false). It is a scene-only feature: a `.brd` has nowhere to store it.

When `autoWallCaps` is false or absent, the build traces the union of the footprints of the floor's cells whose palette references match `walkableTiles`. An absent list matches no cells. Native references match by case-insensitive document identity; legacy references match by case-insensitive text. Every native reference must resolve even when no cell uses it. Duplicate matching palette slots and references do not change the result. Empty slots, empty cells and excess cells never match.

Each selected cell contributes the same rectangle or diamond as a generated solid footprint below. Shared, oppositely directed edges cancel. The remaining edges form directed contours with selected cells on their right. At a vertex where contours touch, take the sharpest right turn, keeping corner-touching regions separate. Remove intermediate collinear points. Order contours by their topmost, then leftmost vertex; at a tie order by the direction of their first edge clockwise from east. Start each contour at that vertex and use its directed edge order. Outer contours are open solid polylines with the first point repeated at the end; hole contours are closed solid polygons without a repeated endpoint. All have empty handles and zero attributes. They are on the source floor and follow the scene-owned vector slots; exceeding the board vector-table limit is a build error.

`autoWallCaps: true` is not specified sufficiently to infer under-region geometry. A build must report it as unsupported rather than invent or silently omit caps. No under polygons are generated for the false case.

## The tile palette

`tilePalette` is the board's **tile look-up table (LUT)**, kept slot for slot so cells keep their meaning.

1. **Position is the LUT index.** Entry `i` of the list is LUT index `i`. The stored upper bound is the list length minus one.
2. **Position 0 is always `{}`**: the board's index 0 is always "no tile". A palette whose first entry is not `{}` is an error.
3. **Absent versus empty slot.** An **absent** `tilePalette` is the board having **no table at all** (stored upper bound −1, and there is then no index 0). A **present** palette always has position 0. Inside a present palette, an **empty slot** is `{}` and is **not** the same as an absent palette: it keeps later indices where they were. The editor trims only trailing unused slots; a reader and an importer keep every slot as stored, trailing empty ones included.
4. **An entry is one of three shapes:** `{}` (empty slot), a **legacy tile** `{legacy: <text>}`, or a **native tile** `{tile: <.tkrtle path>}` ([reference forms](#reference-forms)). A tile may appear in more than one slot.
5. **What the build writes.** A legacy entry writes its text unchanged. A native entry writes the legacy reference produced by its allocated tileset output; unresolved or ambiguous allocations are errors. The tile's explicit solid and under geometry contributes generated vectors as described in [native-tile.md](native-tile.md#geometry-and-program-activation).
6. **An import produces only legacy entries**, because a `.brd` holds only legacy tile references. Swapping an entry for a native tile is an author action in the scene editor.

**Boundary footprints.** For tracing walkable tiles, each selected cell contributes a 32-by-32 pixel rectangle in 2D or the 64-by-32 isometric cell diamond. These footprints do not imply tile collision.

## Shading

`shading` is an ordered list of **shading layers**, the board's per-tile RGB tints. List position is the shading layer's index; **position 0 is the layer the engine bakes lights into**. A shading layer:

| Field | Required | Shape | Meaning |
|---|---|---|---|
| `id` | no | local ID | An optional stable name. |
| `floor` or `layer` | one of them | [layer reference](#conventions) (the key `layer` is i32 here) | The top floor the shading is cast onto (board field 9a). |
| `cells` | yes | list of `[count, r, g, b]` | The tint, as runs. |
| `legacy` | no | `{excessCells}` | Legacy-only data: `excessCells` is `[count, r, g, b]`, the cells the layer's records carried past the last cell of the grid ([cells past the end](#shading)). |

`cells` covers the effective grid **once**, row by row with x fastest, **no layers** (a shading layer is not per floor). `count` is at least 1, and the counts sum to exactly the number of cells of the effective grid. `cells` is a stream of runs, not a counted table: it has no upper bound of its own, and a run longer than a record's stored count can hold (a short, 32,767) is split into several records. `r`, `g` and `b` are signed integers (i16), **carried exactly as stored**: the additive range is −255 to 255 and the arithmetic clamps, but the research census holds shade channels up to 286, and such a value is neither refused nor clamped ([conventions](#conventions), item 4). Every cell of a run has that tint. An import writes maximal runs. A board's `count` of 0, 1 or less than 0 all mean one cell and are written as `1` ([semantic equality](#semantic-equality)). The shading arithmetic is the board's ([board.md](board.md#tile-shading)).

**Cells past the end.** A layer whose final record carries past the last cell of the grid keeps the extra cells in that layer's `legacy.excessCells`, as `[count, r, g, b]` (count at least 1 and at most 32,766 so the final record also holds a grid cell; a stored count of 1 or less is `1`; channels i16 as stored). They are not cells of the board, so they are not in `cells`. They continue the final record, so `r`, `g` and `b` equal the tint of the last cell of the grid. **Rebuild rule:** the build writes the layer's records for the grid, splitting a long run into several records, and the **last record holds the grid's last cell or cells together with the whole excess**, so the overshoot stays inside the final record. Each shading layer has its own residue; a layer that does not overshoot has none.

## Lights

`lights` is an ordered list; position is the light's index. A light keeps its editable form, which the engine bakes into shading layer 0 at load and does not keep ([board.md lights](board.md#lights)).

| Field | Required | Shape | Meaning |
|---|---|---|---|
| `id` | no | local ID | Optional stable name. |
| `floor` or `layer` | one of them | layer reference (the key `layer` is i32 here) | The layer the light belongs to. **Ignored at run time**, which paints shading layer 0; it is carried because the board stores it. |
| `type` | yes | `ellipse`, `gradient` or `clipped-gradient` | Board type 0, 1 and 2. |
| `nodes` | yes | list of `[x, y]`, board pixels | An ellipse has 3 nodes (the centre and two radius points), a gradient 2; a clipped gradient's nodes also give its clip shape. A count that does not fit the type is a warning. |
| `colors` | yes | list of `[r, g, b]`, signed offsets (i16, carried as stored) | Colour 0 is the edge or gradient start, colour 1 the centre or gradient end; the editor writes two. Fewer than two is a warning for `ellipse` and `gradient`. |

## Vectors

`vectors` is an ordered list; position is the vector's **slot index**, which scripts see (waypoints by handle, the rest by index). It is one list for the whole board, **not** one per floor, because the slot order crosses floors.

| Field | Required | Shape | Meaning |
|---|---|---|---|
| `id` | no | local ID | Optional stable name. |
| `label` | no | text | A human label for the editor. **Not stored in a `.brd`.** Not the script-visible `handle`. |
| `floor` or `layer` | one of them | layer reference (the key `layer` is i16) | The layer the vector applies to (field 22). |
| `type` | yes | `none`, `solid`, `under`, `unidirectional`, `stairs` or `waypoint` | Board types 0, 1, 2, 4, 8 and 16. `unidirectional` is deprecated and not offered by the editor; it is kept so an old board imports. |
| `closed` | yes | boolean | A closed polygon, or an open polyline. |
| `points` | yes | list of `[x, y]`, board pixels (i32), at least 2 | The vertices. |
| `handle` | no | text | The script-visible name; waypoint vectors are addressed by it. |
| `attributes` | no | integer 0 to 7, `under` only | The under mask: 1 also covers the background, 2 covers all layers below, 4 draws over sprites that intersect the frame. Absent means 0. Not allowed on any other type. |
| `toFloor` or `toLayer` | exactly one, `stairs` only | floor id, or integer (i16) | The layer a stairs vector moves the sprite to (the board's `attributes` for a stairs vector). Not allowed on any other type. |

The `attributes` mask uses the same bit meanings as an `under` vector of an asset pack ([native-asset-pack.md](native-asset-pack.md#fields)), so a pack's vectors translate into the scene without a second vocabulary.

## Triggers

`triggers` is an ordered list of **program trigger regions** (the board's "programs"); position is the slot index scripts see.

| Field | Required | Shape | Meaning |
|---|---|---|---|
| `id` | no | local ID | Optional stable name. |
| `floor` or `layer` | one of them | layer reference (i16) | The layer the region sits on. |
| `program` | no | text | A file in `Prg\`, or inline RPGCode ([reference forms](#reference-forms)). **Absent is an empty slot**: the slot and its index are kept. |
| `condition` | no | `{mode, variable, value}` | The activation condition. `mode` is `always` (default) or `conditional`; `variable` and `value` are text, and absent means the empty string. A conditional trigger runs only when the global `variable` equals `value`. |
| `afterRun` | no | `{variable, value}` | The global variable set, and the value it is set to, after the program runs. Text; absent means the empty string. |
| `activation` | no | `{keyPress, repeat, stopsMovement, repeatDistance}` | How it fires. `keyPress`, `repeat` and `stopsMovement` are booleans, each false when absent; with none set it fires on stepping in. `repeatDistance` is an integer (i16, default 0), the pixels the player must move inside the area between repeats. |
| `points` | no | list of `[x, y]`, board pixels (i32) | The activation polygon. Absent means no points. |
| `closed` | no | boolean | Absent means false. |
| `legacy` | no | `{graphic, reserved}` | Two legacy-only texts: the associated graphic (field 27; no 3.1.0 editor sets it) and the reserved string (field 39; ignored by the engine). Absent means the empty string. |

A **run-once** program is not a separate flag. The editor stores it as one unique name in `condition.variable` and `afterRun.variable`, no `condition.value`, and `afterRun.value` of `_guid`, so the variable is set after the first run and the condition then fails ([board.md](board.md#conditional-activation)). A scene stores exactly that.

## Item placements

`items` is an ordered list of legacy items placed on the board (the board's "sprites"); position is the stored slot index. **Every stored slot is kept, empty ones included**, so the raw board round-trips and keeps its indices ([R-06](board.md#items-placed-on-the-board-sprites)). The run-time compaction of empty slots into script-visible item numbers stays in hydration and is not done to a scene.

| Field | Required | Shape | Meaning |
|---|---|---|---|
| `id` | no | local ID | Optional stable name; the key by which a plugin block can address a placement ([plugin data](#plugin-data-and-placements)). |
| `floor` or `layer` | one of them | layer reference (i16) | The layer the item draws on. |
| `item` | no | text | The item file, relative to `Item\`, as stored. **Absent is an empty slot.** |
| `x`, `y` | yes | integers (i16) | The **pixel** position of the item's reference point (bottom-centre of a 2-D sprite), as stored. The editor's display offset on isometric boards is a display matter and is not stored here. |
| `activationProgram` | no | text | Program run when the player activates the item; overrides the item's own. |
| `multitaskProgram` | no | text | Program run as a thread while the item is on the board; overrides the item's own. |
| `condition` | no | `{mode, variable, value}` | As for a trigger. |
| `afterRun` | no | `{variable, value}` | As for a trigger. |
| `loadCondition` | no | `{variable, value}` | The item is placed only if global `variable` equals `value` (the board's loading variable and value). Text; absent means the empty string. |
| `activation` | no | `{keyPress, repeat}` | How it fires: booleans, each false when absent; with neither it fires on stepping in. |
| `legacy` | no | `{reserved}` | The reserved short (field 49; the editor writes −1, ignored by the engine). Absent means −1. An integer (i16). |

## Images

`images` is an ordered list of free images; position is the slot index, and a list order is also the board's draw order for equal layers.

| Field | Required | Shape | Meaning |
|---|---|---|---|
| `id` | no | local ID | Optional stable name. |
| `floor` or `layer` | one of them | layer reference (i16) | The layer the image draws on. |
| `source` | no | text | The image file, relative to `Bitmap\`, as stored. Width and height come from the image. |
| `x`, `y` | yes | integers (i32) | Board pixels of the top-left corner. |
| `type` | no | `normal`, `parallax` or `stretch` | Board types 0, 1 and 2. Absent means `normal`. |
| `transparent` | yes | colour `[r, g, b]` | The transparent colour. |
| `legacy` | no | `{reserved}` | The reserved short (field 56; the editor writes 100, ignored by the engine). Absent means 100. An integer (i16). |

## Pack placements

`placedPacks` is an ordered list of assets of a native pack placed on the board. It is a scene-only feature. It is **not** a board table: the build expands each placement into the board's images, tile cells and vectors ([tkr-authoring.md section 5](tkr-authoring.md#5-lowering--build-contract)), and those generated records follow the scene's own. Each of the asset's `visuals` becomes an image or tile cells; each vector in its `solid` list becomes a solid vector and each in its `under` list an under vector with its `attributes`; the vectors' points are offsets from the asset's anchor, and the anchor is placed at the placement's `(x, y)` ([native-asset-pack.md](native-asset-pack.md#fields)). The asset's `kind` (`stamp`, `prop` or `backdrop`) does not change the expansion.

| Field | Required | Shape | Meaning |
|---|---|---|---|
| `instanceId` | yes | local ID | The placement's stable identity, unique in this list. (The pack page keeps this name for the scene.) |
| `pack` | yes | path of a `.tkrpack` | The pack document ([reference forms](#reference-forms)). |
| `asset` | yes | pack-local asset id | The asset in that pack. |
| `floor` | yes | floor id | The floor it is placed on. A pack placement has no stored board layer, so no `layer` escape. |
| `x`, `y` | yes | integers (i32) | Board pixels where the asset's anchor is placed. |

The pack's `projection` must equal the scene's `projection` ([validation](#validation)). `layerOffset` belongs to each **visual**, not to the asset: a visual's `layerOffset` (board layer steps, default 0) is added to the floor's layer for that visual's generated image or tile cells and changes drawing order only; the asset's vectors sit on the placement's floor.

**Generated pack images.** A build writes one PNG for each visual crop and appends its normal board image after scene-owned images, in placement then visual order. The image starts at the placement position minus the asset anchor; the crop selects source pixels and does not move that origin. Its layer is the placement floor plus `layerOffset`; an offset outside the board's layers is reported rather than silently producing an invisible image. The generated path is `Bitmap/.tkr-generated/<scene-key>/<instanceId>-<visual-index>.png`, where `scene-key` is the lowercase SHA-256 of the UTF-8 project-relative scene path and `visual-index` is zero-based. The board stores that path relative to `Bitmap/`. Generated paths are checked for collisions and are build outputs subject to the ownership rule below.

The crop preserves decoded straight RGBA; an omitted source transparency setting uses that alpha, and a color-key setting makes matching source RGB transparent. A board image also needs a transparent RGB key: use the first RGB value, in ascending numeric order, not used by a visible pixel; give transparent pixels that key. If there is no such key, report that the crop cannot be represented. PNG encoding follows the [image storage policy](images.md#storage-policy). A whole JPEG can be referenced as-is when no crop or transparency conversion is needed; otherwise a JPEG crop is reported as unavailable rather than violating the rule that JPEG is not re-encoded losslessly.

## Atmosphere

`atmosphere` has three optional keys:

| Key | Shape | Meaning |
|---|---|---|
| `ambient` | signed offset `[r, g, b]` (i16, carried as stored) | The whole-board tint (fields 72a to 72c). Absent means `[0, 0, 0]`. |
| `music` | text | The music file, relative to `Media\`, played on entry (field 66). |
| `background` | `{image, type, color}` | The board background. `image` is a file relative to `Bitmap\` drawn behind layer 1; `type` is `normal`, `parallax` or `stretch` (default `normal`); `color` is the background colour `[r, g, b]`, 0 to 255 (default `[0, 0, 0]`). `type` is kept even when `image` is absent, as the board stores it; the image is created only when its name is not empty. |

## Start

`start` is the player's start. `x` and `y` are board pixels and, when present, are at least 1 (i16); an absent `x` or `y` is the board default, 64. A layer reference is `floor` or `layer` (i16); both absent is layer 1. The board stores a value of 0 or less to mean the default, and that is carried as the key being absent ([semantic equality](#semantic-equality)).

## Links

`links` has four optional keys, `north`, `south`, `east` and `west`, in the board's N, S, E, W order: the neighbouring board (a `.brd` name) or a program (a `.prg` name) reached by walking off that edge, as stored. An absent edge blocks. A link names a `.brd`, not a scene: see [open items](#not-decided-here).

## Battle

`battle` has three optional keys: `background`, the `.bkg` used for battles on this board (relative to `Bkrounds\`); `skill`, an integer (i16, default 0), the skill level for random battles; and `allowed`, a boolean (default false), whether random battles are allowed. This is all the scene holds of a fight; see [scope](#scope).

## Threads and constants

`threads` is a list of text: each entry is a program file in `Prg\` or inline code, started as a background script when the board becomes active; an empty entry is ignored by the engine and keeps its slot. `constants` is a list of text: board constants readable from scripts as `constant[0..10]`, position being the script index. Both follow the [list rule](#conventions) for absent versus empty.

## Legacy-only data

Some stored board data has no meaning to the scene model but is still the board's: values the engine ignores, a few facts of form, and the cells a run or record carries past the end of a grid ([board.md](board.md#size-limits) keeps them so an over-long run still round-trips). Carrying them keeps an import lossless and keeps the build faithful, and each has one named place:

| Place | Holds | Default when absent |
|---|---|---|
| `legacy.layerTitleZero` | The layer title at index 0, which the board stores but never uses (field 61). Text. | the empty string |
| `legacy.trailingBytes` | Bytes after the last documented field, as standard padded base64 (RFC 4648), written only when non-empty ([residue](README.md#bytes-after-the-last-documented-field)). | no bytes |
| `legacy.excessTiles` | The extra cells of an over-long final tile run, `[count, index]` ([tiles](#tiles), item 6; field 7). | none |
| `shading[].legacy.excessCells` | The extra cells of an over-long final shading record of that layer, `[count, r, g, b]` ([shading](#shading); field 9b). | none |
| `triggers[].legacy.graphic`, `.reserved` | The trigger's graphic (field 27) and reserved string (field 39). | the empty string |
| `items[].legacy.reserved` | The item's reserved short (field 49). | −1 |
| `images[].legacy.reserved` | The image's reserved short (field 56). | 100 |

**Why a core block and not `metadata` or `pluginData`.** `metadata` is open, is never read by the core, and cannot change what a build writes; a build must write these values back, and an open mapping cannot be checked for a typo. `pluginData` belongs to plugins and is not a place the core relies on. So `legacy` is a **core field with a closed shape**, listed on this page, checked by the contract's reader, and written only by an import. It is not a bag: it has the keys above and no others. Nothing in it changes how a game plays, because the engine ignores the values; they exist so the built board carries what the source board carried. `tags` and `metadata` keep their shared meaning: an import writes `tags: [imported]` and `metadata: {source: <the board's file name as the caller gives it, case kept>}`, and nothing else ([native-animation-clip.md](native-animation-clip.md#reference-reader-writer-and-importer) does the same). The `.brd`'s own header magic and `major` and `minor` are **not** carried: a build writes the magic `RPGTLKIT BOARD`, major 2 and minor 4 ([rows X1 to X3](#disposition-of-every-board-field)).

## Order and indices

1. **List order is slot order.** For `tilePalette`, `shading`, `lights`, `vectors`, `triggers`, `items`, `images`, `threads` and `constants`, position `i` of the list is slot `i` of the board's table. An import writes them in stored order. A build **never reorders** an existing entry ([ADR 0019](../../adr/0019-tkr-authoring-formats.md), consequences).
2. **Floors are layers.** `floors[0]` is layer 1. A `floor` reference becomes its 1-based position at build time; a `layer` reference and a stairs `toLayer` are numbers and do not move when floors do.
3. **Scene-owned records come first.** In a built board, the scene's own `vectors` fill slots `0` to `n−1` in list order, and records **generated** from the scene (the collision of native tiles, pack placements, traced boundaries) follow in an order the build defines. The same holds for `images` and for tile cells: generated images follow the scene's `images`, and a generated tile entry is appended after the palette, so no scene-owned slot index ever shifts because something was generated. The order **among** generated records is the build's, is deterministic for the same documents, and is not a promise to scripts; a script addresses a waypoint by its `handle`.
4. **Raw slots are kept.** An empty program name, an empty item file, an empty palette slot and an empty thread entry keep their slots in the scene. The pre-vector converter's compaction of programs and items is part of that converter's documented upgrade ([R-06](board.md#items-placed-on-the-board-sprites)) and is not applied by this import, which reads the board the vector reader returns.
5. **Author edits.** Deleting an entry from a list shifts the later slots; the contract promises only that a build does not. The editor should leave an empty slot (`{}`, an absent `program`, an absent `item`) rather than shift indices a script may use, as the legacy editor trims only the end of a table.

## Import: from a board to a scene

An **import** makes a scene from a `.brd`. It is explicit, reviewed and never automatic ([ADR 0019](../../adr/0019-tkr-authoring-formats.md), amendment, point 4).

1. **Never implicit.** Opening or saving a `.brd` never imports. Importing is a command the author runs, and the editor shows the **findings** (below) and what it will write before it writes.
2. **Creates one file.** It creates `<stem>.tkrscn` beside the board, and writes nothing else: the `.brd` is not changed. It **never overwrites** an existing file, a scene included; if the target exists the command stops with a located error.
3. **Deterministic.** The same board bytes give the same scene text: canonical key order, maximal runs, optional keys at their default left out, floor ids `layer-1`, `layer-2` and so on, no record ids. The import reads the board the vector reader returns; a board of minor 2 or 3, or a Toolkit 2 text board, is brought to that layout by the legacy converter first ([older-binary-versions.md](legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector)) and its documented upgrade is not repeated here.
4. **Lossless, or refused; the refusal is a limit.** Every stored value is either carried in the place [its row](#disposition-of-every-board-field) names, or the import is refused. Nothing is clamped, substituted or dropped. **The refusal list is a limitation of this first cut and not a statement that such boards cannot be preserved.** A refused board holds a stored value for which this contract has no key (an unknown vector type, an out-of-range channel, a layer count below 1 and the rest of the refusal row below). A raw-value escape could carry them and is deliberately not specified ([owner review](#owner-review-consequential-choices), item 6). Until it is, a refused board **cannot be converted to a scene**; it stays a plain `.brd`, which is still opened, edited and saved directly and unchanged, and the import names each value that caused the refusal.
5. **Findings.** The import reports each of these before it writes:

   | Severity | Meaning | Conditions |
   |---|---|---|
   | **refusal** | Nothing is written. A limit of this first cut ([rule 4](#import-from-a-board-to-a-scene)); the board stays editable as a `.brd`. | A width, height or layer count below 1, or more than 4,194,304 cells (fields 1 to 3). A `coordType` other than 0, 1, 2, 4, 5 or 6 (4). A palette upper bound below −1, a non-empty slot 0, or a cell index outside the palette (5, 6, 7). A stored upper bound below −1 on any list. A vector with fewer than 2 points (18), a vector `type` other than 0, 1, 2, 4, 8 or 16 (23), a non-zero `attributes` on a type that defines none, or an `under` `attributes` above 7 (20). A light `type` other than 0, 1 or 2 (12). An image or background `type` other than 0, 1 or 2 (54, 64). A trigger or item `activate` other than 0 or 1 (32, 46), or a trigger `activationType` or item `activationType` with a bit this page does not name (33, 47). A tile or shading stream that ends before its cells are covered (7, 9b). A shading, light or ambient channel is **never** a refusal: it is carried as stored. |
   | **warning** | Written, and reported for review. | A run or shading record that carries past the last cell: its extra cells are **carried** in `legacy.excessTiles` or `shading[].legacy.excessCells` (7, 9b). Non-empty trailing bytes, also carried, in `legacy.trailingBytes` (X5). A stored layer number outside 1 to `sizeL`, written as `layer` (22, 35, 48, 53, 9a, 11, 75). |
   | **note** | Written, and listed so the author knows what was normalised. | Each normalisation of [semantic equality](#semantic-equality) that changed a stored value. Each shading, light or ambient channel outside −255 to 255, carried exactly as stored (9b, 16, 72). |

6. **Not an inverse of a build.** An import cannot recover what a `.brd` cannot hold ([the list](#what-a-brd-cannot-hold)): a built `.brd` has lost the floor names, the native references and the traced recipe. The scene is the source of truth; an import is for a board that has none ([ADR 0019](../../adr/0019-tkr-authoring-formats.md), decision 4).
7. **Recovery import.** The same import is the **reviewed recovery** for an outside edit to a built `.brd` ([build](#build-from-a-scene-to-a-board), rule 5): it reads the edited `.brd` as above and writes the proposed scene to a **new file**, never over the existing scene, so the author reviews it and chooses what to keep. Its findings add a note naming each scene-only feature a `.brd` could not carry ([the list](#what-a-brd-cannot-hold)), so the author sees what the edited board cannot restore.

### Semantic equality

A scene made by an import and then built equals the source board when the two decode, by the vector reader, to the same value in **every field of the [75 rows](#disposition-of-every-board-field)**, with exactly these normalisations and no others; the tile and shading streams are compared as the **whole decoded stream, cells past the end included**. This page does **not** promise byte-identical output; a board that is edited directly, with no scene, keeps the byte-identical round trip of [AD-18](../../editor-ecosystem/architecture.md), and that is unchanged.

| # | Normalisation | Why nothing is lost |
|---|---|---|
| N1 | Run boundaries in the tile stream, and whether a single cell used the run marker, are not carried; the build re-encodes. | Encoding, not model: the decoded cell for every cell is equal. |
| N2 | A shading record's count of 0, 1 or less is written `1`. | The board reads all of them as one cell. |
| N3 | A non-zero `closed` (vectors and triggers), `bAllowBattles` or `bDisableSaving` reads as true and is written `−1`. A flag stored as another non-zero value (for example `1`) is therefore written `−1`. (`activate` is not a boolean: it is `condition.mode`, and any value other than 0 or 1 is refused.) | The board reads any non-zero value of these flags the same way. |
| N4 | A start x or y of 0 or less, and a start layer of 0 or less, are carried as the key being absent and built as 64, 64 and 1. | The board applies those defaults to those values. |
| N5 | A colour's high byte is written `00`. | It is zero in every legacy value and ignored by readers ([README.md](README.md#primitive-encoding)). |
| N6 | The header is written as `RPGTLKIT BOARD`, major 2, minor 4. | The vector layout is the only layout a build writes; `major` is ignored by the engine and a `minor` of 4 or later reads as 4 ([board.md](board.md#version-dispatch)). |

Text, file names, indices, list lengths, upper bounds and every number not named above are equal. A test of this proves nothing unless it fails against an import that drops or alters a field: run it against an import that clamps a colour, one that compacts empty slots, one that drops the reserved values and one that drops the cells past the end, and confirm each fails.

## Build: from a scene to a board

Saving a scene builds the `.brd` ([ADR 0019](../../adr/0019-tkr-authoring-formats.md), decision 4), through the board writer `core` already has. The build is the inverse of the [field rows](#disposition-of-every-board-field), plus these rules:

1. **Layout.** It writes the vector layout, minor 4, fields 1 to 75 in order.
2. **Order.** Slots as in [order and indices](#order-and-indices).
3. **Generated records.** The collision of native tiles, expanded pack placements, and traced boundaries are written after the scene's own records. A pack placement's visuals become images or tile cells, and its `solid` and `under` vectors are translated by the placement's position.
   Cells past the end are written back as stated for [tiles](#tiles) (item 6) and [shading](#shading): the final run or record of the stream is extended by the residue's `count`.
4. **Nothing is silently dropped.** What a `.brd` cannot hold ([the list](#what-a-brd-cannot-hold)) does not reach the board. The build reports a note for each such feature the scene uses, naming it, and reports an error for anything it cannot encode (a list over 32,768 entries, a number out of range, a text outside the code page, an unresolved native reference).
5. **The `.brd` is a build output**, watched by hash ([ADR 0019](../../adr/0019-tkr-authoring-formats.md), decision 4). **An outside edit is detected and blocks the overwrite.** When the hash of the `.brd` on disk is not the hash of the editor's last build, saving the scene does **not** write the `.brd`: it stops, tells the author the board was edited outside, and offers the **recovery import** ([import](#import-from-a-board-to-a-scene), rule 7), which proposes a scene from the edited board for review. The `.brd` is never silently overwritten, and the author's choice, not the build, resolves the difference. The hash is not stored in the scene, because a value that changes on every save is not allowed in `tags` or `metadata` ([stamp rule 3](native-contracts.md#stamp)).
6. **Build ownership.** The editor records each successfully written build output's SHA-256 hash, producing document path and project-relative output path in versioned project-local `.tkr-history/scene-build/` records. A scene owns its board and generated pack images. A tileset owns its assigned output slots and animation output, even when several scenes use it. Two producers cannot claim the same case-insensitive destination. Resolve existing path spelling before a write; report an ambiguous path rather than creating another spelling. A host may instead supply durable history storage; if only session storage is available, the editor says the record will not survive the session. A missing or unreadable ownership record does not authorize replacing an existing file, even if its bytes match. A missing previously owned output is a change and requires an author decision before recreation.
7. **Check before writing.** Review every destination before any generated output is written. Within a project, serialize generated output writes and repeat the destination review under that serialization. Before writing, also check that the saved scene and the inputs used by the build still match the bytes read, including the set of tileset files whose declarations were checked for destination ownership. If anything changed, leave the generated files alone and ask the author to build again. Keep replaced bytes in history; record ownership only after its output write succeeds. If recording fails after a write, report which outputs were written and which failed. A pending record is not trusted. These operations do not make a multi-file write atomic or prevent another program from writing between the host's check and write.
8. **Use current outputs.** For Play, check that the board and generated artifacts in the frozen run snapshot match the current scene build. For packaging, compare the board and generated artifacts in the archive inventory with the current build of each scene in that inventory's game. Refuse a missing or mismatched output even when the authoring document has no unsaved changes. Neither check repairs the archive or replaces generated files.

## What a `.brd` cannot hold

These are the scene features a `.brd` has no field for. On a `.brd` with no scene, the scene editor shows each as **unavailable**, with the reason, and offers one action, *convert to a scene* ([ADR 0019](../../adr/0019-tkr-authoring-formats.md), amendment, point 4). The control is shown, disabled and explained; it is not hidden. Everything else in this contract is a board field and works on a `.brd`.

| # | Scene feature | Why a `.brd` cannot hold it | What a build does with it |
|---|---|---|---|
| U1 | A floor's `id`; a `floor` or `toFloor` reference | The board numbers layers and has no names for them. | Becomes the layer number. |
| U2 | A record's `id` (shading, lights, vectors, triggers, items, images) | The board identifies a record by slot index only. | Dropped from the board; reported as a note. |
| U3 | A vector's `label` | The board has the script-visible `handle` only. | Dropped from the board; reported as a note. |
| U4 | A floor's `boundarySources` | The board stores the traced vectors, not the recipe they came from. | The tracer's vectors are written; the recipe is not. |
| U5 | A native tile reference `{tile}` and its explicit geometry | The board stores a legacy tile reference and has no link to the source tile. | The generated legacy reference and applicable solid and under vectors are written. |
| U6 | `placedPacks`, and the knowledge of which generated records came from which placement | The board stores the expanded images, cells and vectors, not where they came from. | The expansion is written; the provenance is not. |
| U7 | `name` | The board has no name; its file name is its name. | Dropped; reported as a note. |
| U8 | `tags` and `metadata` | A `.brd` has no stamp. | Dropped; reported as a note. |
| U9 | `pluginData` | A plugin block exists only on a native contract document ([limits](native-contracts.md#limits-of-this-version)). | Not carried; reported as a note naming each plugin id. |

## Plugin data and placements

This is the scene contract's answer to the question left to this story by [native-contracts.md](native-contracts.md#limits-of-this-version) and [ADR 0024](../../adr/0024-plugin-data-contributions.md).

1. **No placement carries a nested `pluginData` door in the first cut.** A scene has exactly one door, the top-level `pluginData`; a `pluginData` key inside a floor, a record or a placement is an unknown key and an error. Shared blocks are self-contained and stay in one place. A future pre-release revision may widen this without breaking an existing document.
2. **A plugin that needs data for one placement or record** keeps it in its own top-level block, keyed by the record's local `id` (or `instanceId`), so it does not depend on a slot index that an edit can shift. That is why every record has an optional `id`. The sample shows `com.example.weather` doing it. Which `id`s a plugin may use, and what happens to its data when the record is renamed, are the plugin's and the rename tool's concern ([open items](#not-decided-here)).
3. **Which plugin ids own which blocks.** The scene contract **reserves no plugin id** and no block is owned by the core. A block belongs to the plugin whose id is its key, judged by the schema for that (plugin id, `scene`) pair ([which contract a block is for](native-contracts.md#which-contract-a-block-is-for)), preserved byte for byte when the plugin is absent. A first-party plugin follows the same rule as a third-party one. A plugin id is never one of the scene's core field names or reserved keys: a plugin id of `size` or `floors` would be read as a field, not a block, and is refused by the shared id rule.
4. **An import writes no block**, because a `.brd` has none. A build does not carry blocks into the board ([U9](#what-a-brd-cannot-hold)).

## Validation

Checks run in three places: the contract's **reader** (the text and model alone), the **project** check (needs the files of the project, run by the editor or a build), and the **build**. The core checker of [native-contracts.md](native-contracts.md#checker) reads only the stamp and the `pluginData` envelope; the rest is the scene reader's, reported with a path and a line, in the closed-contract words the clip reader uses.

| # | Check | Severity | Where |
|---|---|---|---|
| V1 | The stamp is `contract: scene` with a valid `version`, first two keys; the extension is `.tkrscn`. | error | reader; core checker |
| V2 | The top level holds only the stamp, `tags`, `metadata`, the core fields and `pluginData`; every nested mapping has only the keys its table lists. | error | reader |
| V3 | `pluginData` follows the shared envelope rules. | error | core checker |
| V4 | `size.width` and `size.height` are at least 1 and at most i16; `floors` is non-empty and at most 32,767; the effective grid times the floors is at most 4,194,304. | error | reader |
| V5 | Floor ids, record ids and `instanceId`s match the local ID grammar and are unique in their own list. | error | reader |
| V6 | Every `floor` and `toFloor` names a floor of this document; a record has exactly one of `floor` and `layer`; `start` has at most one. | error | reader |
| V7 | A `layer` that lies inside 1 to the number of floors. | warning (write `floor`) | reader |
| V8 | `tilePalette` position 0 is `{}`; each entry is `{}`, a legacy tile or a native tile, and nothing else. | error | reader |
| V9 | A floor's runs sum to exactly the effective grid; every run `count` is at least 1; every `index` is in the palette, or 0 when there is no palette. | error | reader |
| V10 | A shading layer's cells sum to exactly the effective grid. Channels are integers (i16); one outside −255 to 255 is a note, not an error. | error | reader |
| V11 | A vector has at least 2 points; `attributes` only on `under` and 0 to 7; `toFloor` or `toLayer` only on, and exactly one on, `stairs`. | error | reader |
| V12 | A light's node or colour count does not fit its type. A light or ambient channel outside −255 to 255 is not a problem; it is a note. | warning for count | reader |
| V13 | A keyed text is not empty; an integer is within its field's width; a point has two integers; a colour has three channels in range. | error | reader |
| V14 | `condition.mode` is `always` or `conditional`; a type, `mode` or `type` value is in its vocabulary. | error | reader |
| V15 | Every native tile path resolves unambiguously to a `.tkrtle`; every terrain reference resolves to one `.tkrtst` and its local terrain ID. | error | project; build |
| V16 | Every `pack` path resolves to a `.tkrpack`, the `asset` names one asset in it, and the pack's `projection` equals the scene's. | error | project; build |
| V17 | A legacy reference (tile, item, image, music, program, link, battle background) names a file that exists. | warning, never blocks | project |
| V18 | A text the board's code page cannot store; a list over 32,768 entries; an unencodable native tile. | error | build |
| V19 | `legacy` has only its listed keys (`layerTitleZero`, `trailingBytes`, `excessTiles`; `shading[].legacy` only `excessCells`, a trigger's only `graphic` and `reserved`, an item's and an image's only `reserved`); `trailingBytes` is valid base64; `excessTiles` is `[count, index]` with `count` 1 to 32,767 and `index` 0 to 32,767 equal to the index of the last cell of the last floor; `excessCells` is `[count, r, g, b]` with `count` 1 to 32,766, channels as i16, and `r`, `g`, `b` equal to the tint of the last cell of the grid. | error | reader |
| V20 | Two documents of one ID, and two paths that fold to one ID. | error | core checker |
| V21 | The scene is not under `Boards/`, so its built `.brd` is not reachable by a link or script. | warning | project |

An unresolved native reference is an error and is never replaced by a guess ([tileset](native-tileset.md#fields)); an unresolved legacy reference is a warning because a `.brd` has always been allowed to name a file that is missing.

## Sample

A scene that was imported from `cottage.brd` and then extended in the scene editor, so it shows both the board's own data (a palette with an empty slot and an animated tile, runs that wrap a row, a shading layer, an ellipse light, four kinds of vector, a run-once-style trigger and an empty trigger slot, an item and an empty item slot, an image, a link, threads with an empty entry, the reserved values) and the scene-only data (floor ids, a native tile, boundary sources, a pack placement, a plugin block). The board is 4 by 3 tiles on a 2-D grid, so each floor has 12 cells, 128 by 96 pixels.

```yaml
contract: scene
version: 1.0.0-pre.2
tags: [imported]
metadata:
  source: cottage.brd
name: Cottage
projection: 2d
pixelCoordinates: true
size: {width: 4, height: 3}
floors:
  - id: ground
    title: Ground
    tiles: [[4, 1], [2, 2], [2, 4], [4, 1]]
    boundarySources:
      walkableTiles:
        - {tile: tiles/grass-main.tkrtle}
        - {legacy: village.tst1}
      autoWallCaps: true
  - id: roof
    tiles: [[12, 0]]
tilePalette:
  - {}
  - {legacy: village.tst1}
  - {tile: tiles/stone-wall-base.tkrtle}
  - {}
  - {legacy: water.tan}
shading:
  - floor: roof
    cells: [[8, 0, 0, 0], [4, 286, -20, -10]]
    legacy: {excessCells: [2, 286, -20, -10]}
lights:
  - floor: ground
    type: ellipse
    nodes: [[64, 48], [96, 48], [64, 80]]
    colors: [[0, 0, 0], [60, 50, 20]]
vectors:
  - id: north-wall
    label: North wall
    floor: ground
    type: solid
    closed: false
    points: [[0, 8], [128, 8]]
  - floor: ground
    type: under
    attributes: 3
    closed: true
    points: [[32, 8], [64, 8], [64, 32], [32, 32]]
  - floor: ground
    type: stairs
    toFloor: roof
    closed: true
    points: [[96, 56], [124, 56], [124, 88], [96, 88]]
  - floor: ground
    type: waypoint
    handle: patrol
    closed: false
    points: [[16, 80], [112, 80]]
triggers:
  - id: open-door
    floor: ground
    program: open_door.prg
    condition: {mode: conditional, variable: "7f3a9c1e"}
    afterRun: {variable: "7f3a9c1e", value: _guid}
    activation: {keyPress: true, repeat: true, repeatDistance: 16}
    points: [[32, 64], [64, 64], [64, 96], [32, 96]]
    closed: true
    legacy: {graphic: door.gph, reserved: keep}
  - floor: ground
items:
  - id: chest-gold
    floor: ground
    item: chest.itm
    x: 48
    y: 80
    activationProgram: open_chest.prg
    multitaskProgram: sparkle.prg
    condition: {mode: conditional, variable: chest_opened, value: "0"}
    afterRun: {variable: chest_opened, value: "1"}
    loadCondition: {variable: chapter, value: "2"}
    activation: {keyPress: true}
    legacy: {reserved: 7}
  - {floor: ground, x: 0, y: 0}
images:
  - id: fountain
    floor: ground
    source: fountain.png
    x: 32
    y: 16
    type: parallax
    transparent: [255, 0, 255]
    legacy: {reserved: 90}
placedPacks:
  - instanceId: lantern-1
    pack: packs/cottage-props.tkrpack
    asset: lantern
    floor: ground
    x: 24
    y: 40
atmosphere:
  ambient: [-10, -10, 0]
  music: cottage_theme.ogg
  background:
    image: sky.png
    type: stretch
    color: [120, 160, 240]
start: {x: 64, y: 80, floor: ground}
links: {north: village.brd, east: exit.prg}
enterProgram: enter_cottage.prg
battle: {background: forest.bkg, skill: 2, allowed: true}
savingDisabled: true
threads: [ambient.prg, ""]
constants: [gold, "", "7"]
legacy: {layerTitleZero: unused, trailingBytes: AAEC, excessTiles: [3, 0]}
pluginData:
  com.example.weather:
    version: 0.1.0
    data:
      wind: 3
      perItem:
        chest-gold: {shimmer: 2}
```

What the build writes for it, so the sample can be checked against the [rows](#disposition-of-every-board-field):

| Board field | Value built |
|---|---|
| `sizeX`, `sizeY`, `sizeL`, `coordType` | 4, 3, 2, 4 (`2d` with the pixel-coordinates flag) |
| LUT upper bound and entries | 4; `""`, `village.tst1`, the generated reference for `stone-wall-base`, `""`, `water.tan` |
| tile stream | layer 1: indices 1 1 1 1, 2 2, 4 4, 1 1 1 1; layer 2: twelve 0s, then three more 0s from `excessTiles` extending the final run (the board writer chooses the runs) |
| shading | one layer cast on layer 2; eight cells of (0, 0, 0), then four of (286, −20, −10) carried as stored, the final record extended by two cells from `excessCells` |
| vectors | slots 0 to 3 as listed; the trace for `ground`, the generated collision of `stone-wall-base` and the lantern's vectors follow at slots 4 and up |
| programs | slot 0 `open_door.prg`; slot 1 empty, the slot kept |
| sprites | slot 0 `chest.itm`; slot 1 empty, the slot kept |
| images | slot 0 `fountain.png`; the lantern's generated image follows at slot 1 |
| threads, constants | upper bounds 1 and 2; `ambient.prg`, `""`; `gold`, `""`, `7` |
| layer titles | `unused`, `Ground`, `""` (index 0, then layers 1 and 2) |
| start, ambient, settings | start (64, 80) on layer 1; ambient (−10, −10, 0); `savingDisabled` −1; `allowBattles` −1; skill 2 |
| reserved values | trigger 0 reserved `keep`; item 0 reserved 7; image 0 reserved 90; item 1 and trigger 1 take the defaults |
| trailing bytes | `00 01 02` |
| not carried | `name`, `tags`, `metadata`, every `id` and `label`, `boundarySources`, `pluginData` |

## Disposition of every board field

Every one of the 75 fields of [board.md](board.md#vector-layout-minor-4-and-later), numbered as there, has a row. **Lands** means the value is carried in the native location named. **Derived** means the field is a count or a bound the list length already says, so no key holds it. **Refused** names the stored values the import will not accept. A row never says "dropped" without its reason. Sub-rows (`9a`, `44b`) are the parts of a field that holds more than one value, and each has its own row. "Slot *i*" is zero-based.

### Dimensions and tiles

| # | Board field | Native location | Rule |
|---|---|---|---|
| 1 | `sizeX` (short) | `size.width` | Lands. i16, at least 1; refused below 1. |
| 2 | `sizeY` (short) | `size.height` | Lands. i16, at least 1; refused below 1. |
| 3 | `sizeL` (short) | the length of `floors` | Derived: floor *n* is layer *n*. An import writes `layer-1` to `layer-<sizeL>`. Refused below 1; refused when the effective grid times `sizeL` exceeds 4,194,304 ([size limits](board.md#size-limits)). |
| 4 | `coordType` (short) | `projection` and `pixelCoordinates` | Lands. 0 and 4 are `2d`, 1 and 5 `iso-stacked`, 2 and 6 `iso-rotated`; flag 4 is `pixelCoordinates: true`. The build writes the same value back. Refused for any other value (3 and 7 and the rest are not produced by any editor). |
| 5 | LUT UB (short) | `tilePalette` length minus one | Derived. An absent `tilePalette` is upper bound −1: the board has **no table** and no index 0. Refused below −1. |
| 6 | LUT × (UB+1) (string) | `tilePalette[i]` for slot *i* | Lands, slot for slot. Slot 0 is `{}`; an unused slot is `{}`, **kept** so later indices stay put and trailing empty slots are kept; a non-empty entry is `{legacy: <text as stored>}`. An absent table has no entries. Refused when slot 0 is non-empty. |
| 7 | tile stream (shorts) | `floors[n].tiles`, one run list per floor; `legacy.excessTiles` for cells past the end | Lands as `[count, index]` runs, layer outermost, then y, then x fastest. Runs are split at floor boundaries and written maximal ([tiles](#tiles)); marker form and run boundaries are not carried (N1). **Cells the final run carries past the last cell of the last floor are carried** in `legacy.excessTiles` as `[count, index]` and reported as a warning; the build extends the final run by them. Refused when a cell's index is outside the palette (or not 0 when there is no palette) or when the stream ends early. |

### Tile shading

| # | Board field | Native location | Rule |
|---|---|---|---|
| 8 | shade UB (short) | `shading` length minus one | Derived. An absent or empty `shading` is −1. Refused below −1. |
| 9 | × (UB+1) shading layer | `shading[i]` for shading layer *i* | Lands, in stored order; shading layer 0 is `shading[0]`, the one lights bake into. |
| 9a | layer (int) | `shading[i].floor` or `.layer` | Lands as a layer reference (i32); a value outside 1 to `sizeL` is carried as `layer` with a warning. |
| 9b | cells (groups of 4 shorts: count, r, g, b) | `shading[i].cells`, as `[count, r, g, b]`; `shading[i].legacy.excessCells` for cells past the end | Lands. Covers the effective grid, y outermost and x fastest, no layers; a stream of runs, not a counted table. A stored `count` of 1 or less is written `1` (N2). **Channels are i16 and carried as stored**: the research census holds values up to 286, so a value outside −255 to 255 is a note, never a refusal or a clamp. **Cells the final record carries past the last cell of the grid are carried** in that layer's `legacy.excessCells` as `[count, r, g, b]` and reported as a warning; the build extends the final record by them, keeping them inside it when a long run is split. Refused only when the records end before the grid is covered. |

### Lights

| # | Board field | Native location | Rule |
|---|---|---|---|
| 10 | light UB (short) | `lights` length minus one | Derived. An absent or empty `lights` is −1 ("none"). Refused below −1. |
| 11 | layer (int) | `lights[i].floor` or `.layer` | Lands as a layer reference (i32). Ignored at run time and carried because the board stores it; a value outside 1 to `sizeL` is carried as `layer` with a warning. |
| 12 | type (int) | `lights[i].type` | Lands: 0 `ellipse`, 1 `gradient`, 2 `clipped-gradient`. Refused for any other value. |
| 13 | nodes UB (short) | `lights[i].nodes` length minus one | Derived. Refused below −1. |
| 14 | node (int x, int y) | `lights[i].nodes[j]` as `[x, y]` | Lands, in stored order, board pixels (i32). |
| 15 | colours UB (short) | `lights[i].colors` length minus one | Derived. Refused below −1. |
| 16 | colour (short r, g, b) | `lights[i].colors[j]` as `[r, g, b]` | Lands, in stored order, signed offsets (i16) carried as stored; a channel outside −255 to 255 is a note, not a refusal. Colour 0 is the edge or start, colour 1 the centre or end. |

### Vectors

| # | Board field | Native location | Rule |
|---|---|---|---|
| 17 | vector UB (short) | `vectors` length minus one | Derived. An absent or empty `vectors` is −1. Refused below −1. |
| 18 | × (UB+1): points UB (short) | `vectors[i].points` length minus one | Derived. A stored vector has at least 2 points; refused with fewer. |
| 19 | point (int x, int y) | `vectors[i].points[j]` as `[x, y]` | Lands, in stored order, board pixels (i32). |
| 20 | attributes (short) | for `under`, `vectors[i].attributes`; for `stairs`, `vectors[i].toFloor` or `.toLayer`; for every other type, no key | Lands by type. `under`: the 1/2/4 mask, 0 to 7, written only when not 0. `stairs`: the target layer, as `toFloor` when it is a layer of the board and as `toLayer` otherwise. Refused when `under` has a value above 7, or any other type has a non-zero value (the board defines none). |
| 21 | closed (short) | `vectors[i].closed` | Lands as a boolean; non-zero is true, written `−1` (N3). |
| 22 | layer (short) | `vectors[i].floor` or `.layer` | Lands as a layer reference (i16); a value outside 1 to `sizeL` is carried as `layer` with a warning. |
| 23 | type (short) | `vectors[i].type` | Lands: 0 `none`, 1 `solid`, 2 `under`, 4 `unidirectional`, 8 `stairs`, 16 `waypoint`. Refused for any other value. |
| 24 | handle (string) | `vectors[i].handle` | Lands. Empty is absent. |

### Programs (triggers)

| # | Board field | Native location | Rule |
|---|---|---|---|
| 25 | program UB (short) | `triggers` length minus one | Derived. An absent or empty `triggers` is −1. Refused below −1. |
| 26 | × (UB+1): file (string) | `triggers[i].program` | Lands, slot for slot. A file name or inline RPGCode as stored. **An empty name is an absent `program` and keeps its slot** (index preserved). |
| 27 | graphic (string) | `triggers[i].legacy.graphic` | Lands as legacy-only data; no 3.1.0 editor sets it. Empty is absent. |
| 28 | initialVar (string) | `triggers[i].condition.variable` | Lands. Empty is absent. A 2.x type sigil is kept as stored. |
| 29 | initialValue (string) | `triggers[i].condition.value` | Lands. Empty is absent (a run-once program stores an empty value). |
| 30 | finalVar (string) | `triggers[i].afterRun.variable` | Lands. Empty is absent. |
| 31 | finalValue (string) | `triggers[i].afterRun.value` | Lands. Empty is absent. |
| 32 | activate (short) | `triggers[i].condition.mode` | Lands: 0 `always` (the default, so the key is left out), 1 `conditional`. Refused for any other value. |
| 33 | activationType (short flags) | `triggers[i].activation.keyPress`, `.repeat`, `.stopsMovement` | Lands: bit 1 key press, bit 2 repeat while inside, bit 4 stop the player's movement; no bit set is step-on. Refused when any other bit is set. |
| 34 | distanceRepeat (short) | `triggers[i].activation.repeatDistance` | Lands (i16); 0 is the default. |
| 35 | layer (short) | `triggers[i].floor` or `.layer` | Lands as a layer reference (i16); a value outside 1 to `sizeL` is carried as `layer` with a warning. |
| 36 | points UB (short) | `triggers[i].points` length minus one | Derived. Absent or empty is −1. Refused below −1. |
| 37 | point (int x, int y) | `triggers[i].points[j]` as `[x, y]` | Lands, in stored order, board pixels (i32). |
| 38 | closed (short) | `triggers[i].closed` | Lands as a boolean; non-zero is true, written `−1` (N3). |
| 39 | (reserved) (string) | `triggers[i].legacy.reserved` | Lands as legacy-only data, ignored by the engine. Empty is absent. |

### Items placed on the board (sprites)

| # | Board field | Native location | Rule |
|---|---|---|---|
| 40 | item UB (short) | `items` length minus one | Derived. An absent or empty `items` is −1. Refused below −1. |
| 41 | × (UB+1): file (string) | `items[i].item` | Lands, slot for slot, as stored, relative to `Item\`. **An empty name is an absent `item` and keeps its slot**, with the rest of its fields (R-06: the raw board keeps every slot; run-time hydration compacts). |
| 42 | prgActivate (string) | `items[i].activationProgram` | Lands. Empty is absent. |
| 43 | prgMultitask (string) | `items[i].multitaskProgram` | Lands. Empty is absent. |
| 44 | initialVar, initialValue, finalVar, finalValue | `items[i].condition` and `items[i].afterRun` | See 44a to 44d. |
| 44a | initialVar (string) | `items[i].condition.variable` | Lands. Empty is absent. |
| 44b | initialValue (string) | `items[i].condition.value` | Lands. Empty is absent. |
| 44c | finalVar (string) | `items[i].afterRun.variable` | Lands. Empty is absent. |
| 44d | finalValue (string) | `items[i].afterRun.value` | Lands. Empty is absent. |
| 45 | loadingVar, loadingValue | `items[i].loadCondition` | See 45a and 45b. |
| 45a | loadingVar (string) | `items[i].loadCondition.variable` | Lands. Empty is absent. |
| 45b | loadingValue (string) | `items[i].loadCondition.value` | Lands. Empty is absent. |
| 46 | activate (short) | `items[i].condition.mode` | Lands: 0 `always` (default), 1 `conditional`. Refused for any other value. |
| 47 | activationType (short flags) | `items[i].activation.keyPress`, `.repeat` | Lands: bit 1 key press, bit 2 repeat; no bit is step-on. Refused when any other bit (bit 4 included, which an item does not have) is set. |
| 48 | x, y, layer (short × 3) | `items[i].x`, `.y`, `.floor` or `.layer` | See 48a to 48c. |
| 48a | x (short) | `items[i].x` | Lands as stored (i16, pixels), no display offset. |
| 48b | y (short) | `items[i].y` | Lands as stored (i16, pixels), no display offset. |
| 48c | layer (short) | `items[i].floor` or `.layer` | Lands as a layer reference (i16); a value outside 1 to `sizeL` is carried as `layer` with a warning. |
| 49 | (reserved) (short) | `items[i].legacy.reserved` | Lands as legacy-only data, ignored by the engine; the editor writes −1, which is the default and is left out. |

### Layer images

| # | Board field | Native location | Rule |
|---|---|---|---|
| 50 | image UB (short) | `images` length minus one | Derived. An absent or empty `images` is −1. Refused below −1. |
| 51 | × (UB+1): file (string) | `images[i].source` | Lands, slot for slot, as stored, relative to `Bitmap\`. Empty is absent. |
| 52 | x, y (int, int) | `images[i].x`, `images[i].y` | Lands (i32), board pixels of the top-left corner. |
| 53 | layer (short) | `images[i].floor` or `.layer` | Lands as a layer reference (i16); a value outside 1 to `sizeL` is carried as `layer` with a warning. |
| 54 | type (short) | `images[i].type` | Lands: 0 `normal` (default), 1 `parallax`, 2 `stretch`. Refused for any other value. |
| 55 | transpColor (colour) | `images[i].transparent` as `[r, g, b]` | Lands; the high byte is not carried (N5). |
| 56 | (reserved) (short) | `images[i].legacy.reserved` | Lands as legacy-only data, ignored by the engine; the editor writes 100, which is the default and is left out. |

### Threads, constants and settings

| # | Board field | Native location | Rule |
|---|---|---|---|
| 57 | thread UB (short) | `threads` length minus one | Derived. A stored −1 is `threads: []`; a stored 0 with one empty string is `threads: [""]`. An absent `threads` builds as the editor writes it, upper bound 0 with one empty string ([conventions](#conventions), item 7). Refused below −1. |
| 58 | × (UB+1) thread (string) | `threads[i]` | Lands, slot for slot: a program file or inline code. An empty entry is `""` and keeps its slot. |
| 59 | constant UB (short) | `constants` length minus one | Derived, like 57. Refused below −1. |
| 60 | × (UB+1) constant (string) | `constants[i]` | Lands, slot for slot; position is the script index of `constant[i]`. An empty entry is `""`. |
| 61 | layer titles × (sizeL + 1) (string) | `floors[n].title` for index *n* from 1 to `sizeL`; `legacy.layerTitleZero` for index 0 | Lands. An empty title is an absent `title`. Index 0 is unused by scripts and is carried as legacy-only data when non-empty. The count is `floors` length plus one: derived. |
| 62 | links × 4 (string) | `links.north`, `.south`, `.east`, `.west` | Lands in the board's N, S, E, W order, as stored (a `.brd` or a `.prg`). An empty link is an absent key, and the edge blocks. |
| 63 | background image (string) | `atmosphere.background.image` | Lands, as stored, relative to `Bitmap\`. Empty is absent. |
| 64 | background image type (int) | `atmosphere.background.type` | Lands: 0 `normal` (default), 1 `parallax`, 2 `stretch`; kept even when no image is named. Refused for any other value. |
| 65 | bkgColor (colour) | `atmosphere.background.color` as `[r, g, b]` | Lands; the high byte is not carried (N5). The default is black. |
| 66 | bkgMusic (string) | `atmosphere.music` | Lands, as stored, relative to `Media\`. Empty is absent. |
| 67 | enterPrg (string) | `enterProgram` | Lands. Empty is absent. |
| 68 | battleBackground (string) | `battle.background` | Lands, as stored, a `.bkg` name. Empty is absent. |
| 69 | battleSkill (short) | `battle.skill` | Lands (i16); 0 is the default. |
| 70 | bAllowBattles (short) | `battle.allowed` | Lands as a boolean; non-zero is true, written `−1` (N3). |
| 71 | bDisableSaving (short) | `savingDisabled` | Lands as a boolean; non-zero is true, written `−1` (N3). |
| 72 | ambient r, g, b (short × 3) | `atmosphere.ambient` as `[r, g, b]` | See 72a to 72c. |
| 72a | ambient r (short) | `atmosphere.ambient[0]` | Lands, signed, i16 as stored; outside −255 to 255 is a note, not a refusal. |
| 72b | ambient g (short) | `atmosphere.ambient[1]` | Lands, signed, i16 as stored; outside −255 to 255 is a note, not a refusal. |
| 72c | ambient b (short) | `atmosphere.ambient[2]` | Lands, signed, i16 as stored; outside −255 to 255 is a note, not a refusal. |
| 73 | startX (short) | `start.x` | Lands (i16, pixels). A stored value of 0 or less means 64 and is carried as the key being absent (N4). |
| 74 | startY (short) | `start.y` | Lands (i16, pixels). A stored value of 0 or less means 64 and is carried as the key being absent (N4). |
| 75 | startL (short) | `start.floor` or `start.layer` | Lands as a layer reference (i16). A stored value of 0 or less means layer 1 and is carried as both keys being absent (N4); a value above `sizeL` is carried as `layer` with a warning. |

The file ends after field 75 ([board.md](board.md#threads-constants-and-settings)).

### What is not among the 75 fields

These are parts of a board that [board.md](board.md#version-dispatch) describes but does not number. Each has a disposition so that nothing is left unaccounted for.

| # | Board item | Native location | Rule |
|---|---|---|---|
| X1 | header text `RPGTLKIT BOARD` | none | Not carried. Fixed by the layout; the build writes it. |
| X2 | `major` (short) | none | Not carried. The engine ignores it; the build writes 2. |
| X3 | `minor` (short) | none | Not carried. It selects a layout; a build writes the vector layout, minor 4, which readers read for 4 and later. A board of minor 2 or 3 is upgraded by the legacy converter before import. |
| X4 | the run marker and the one-cell run form | none | Not carried: encoding, not model (N1). |
| X5 | bytes after field 75 | `legacy.trailingBytes` | Lands, as base64, when non-empty. The import warns; the spec defines no trailing data and a build re-emits it unchanged. |
| X6 | the effective grid of an `iso-rotated` board | none | Derived from `projection` and `size`: the tile and shading cells are on the stored grid, never at a pixel position ([coordinates](board.md#coordinates)). |

## Disposition of the draft section 2 keys

The draft example of [tkr-authoring.md section 2](tkr-authoring.md#2-scene-document-tkrscn) is superseded by this page. Every key it shows has a disposition here.

| Draft key | Disposition |
|---|---|
| `contract`, `version` | Retained as the shared stamp, `scene` and `1.0.0-pre.N`. |
| `id` | Dropped: the path, extension included, is the identity. |
| `name` | Retained as an optional display name. |
| `projection` | Retained, required, the same three values. |
| `grid.width`, `grid.height` | Renamed to `size.width` and `size.height`, because `grid` would be read as the stored cell grid, which is larger for `iso-rotated`. |
| `grid.tileWidth`, `grid.tileHeight` | Dropped: a `.brd` cannot store a tile size other than the projection's, so a scene field for it could not be built. |
| `atmosphere.ambient`, `.music` | Retained under `atmosphere`. `music` is the legacy file name as stored, not a project path. |
| `atmosphere.background.image`, `.type`, `.color` | Retained under `atmosphere.background`; `image` is the legacy file name as stored. |
| `start.floor`, `start.x`, `start.y` | Retained. |
| `start.layer` | Replaced by the layer reference: `layer` is allowed only for a layer no floor has, and not beside `floor`. |
| `floors[].id`, `.title` | Retained. |
| `floors[].layer` | Dropped: the layer number is the list position. |
| `floors[].tiles` (`format`, `runs`) | Replaced by `floors[].tiles` as `[count, index]` runs over the `tilePalette`; `format` is dropped (one encoding) and a run names a palette index, not a tile text, so slot indices are kept. |
| `floors[].images[]` (`id`, `source`, `x`, `y`, `transparent`) | Moved to the board-wide `images` list with a `floor` key, because image order and slot indices cross floors; `type` and `legacy.reserved` are added to hold the board's fields. |
| `floors[].boundarySources` (`walkableTiles`, `autoWallCaps`) | Retained on the floor; `walkableTiles` entries are tile references, not bare strings. |
| `floors[].vectors[]` (`id`, `label`, `type`, `closed`, `points`, `attributes`) | Moved to the board-wide `vectors` list with a `floor` key, because slot order crosses floors; `handle`, `toFloor` and `toLayer` are added. `attributes` is kept for `under` only; a stairs target is `toFloor`. |
| `things[]` (`id`, `kind`, `placement`, `fromAsset`, `contents`, `condition`, `onOpen`) | **Not carried in the first cut.** `kind: chest`, `contents` and `onOpen` have no board counterpart and no defined lowering, and a placed object is an actor, which is the actor contract's to define (27.7). The placed legacy items of the board are `items`. `fromAsset` provenance is the `pack` and `asset` of `placedPacks`. Flagged in [owner review](#owner-review-consequential-choices), item 7. |
| `placedPacks[].instanceId` | Retained. |
| `placedPacks[].assetId` | Replaced by `pack` (a path) and `asset` (a pack-local id): the colon-joined `<pack id>:<asset id>` is retired ([native-asset-pack.md](native-asset-pack.md#scene-references)). |
| `placedPacks[].floor`, `.x`, `.y` | Retained. |
| `tags`, `metadata`, `pluginData` | Added from the shared contract. |
| any other top-level key | Rejected by the closed contract. |

## Owner review: consequential choices

Jensen reviewed and approved this pre-release contract. These notes record the choices and alternatives presented for that review; the remaining items under [Not decided here](#not-decided-here) are not settled by that approval.

1. **Placements refer to legacy item files in the first cut** ([#1809 note](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1809)). The actor reference is added as a pre-release revision when 27.7 is approved.
2. **One board-wide list per record kind, with a `floor` key, not lists nested under each floor.** Recommended because slot order, which scripts see, crosses floors. Alternative: nest under floors as the draft did and add a global order key, which duplicates what list order already says.
3. **The tile palette keeps the board's LUT slot for slot, and cells name a palette index.** Recommended because it keeps legacy indices stable and the cells compact. Alternative: cells carry the tile reference inline (the draft's `runs: [[count, "ref"]]`), which is easier to read and loses the stable indices unless a second table keeps them.
4. **`legacy` is a closed core field**, not `metadata` or a plugin block ([legacy-only data](#legacy-only-data)). Alternative: put the reserved values in `metadata`, which no code reads, and accept that a build cannot restore them.
5. **Legacy references are carried as stored, with the key named after the kind** ([reference forms](#reference-forms)). Alternative: project paths with a type folder, as the draft had, which look like the sibling documents' paths but need an inverse for every legacy name and cannot cover program fields.
6. **Refuse an out-of-vocabulary stored value in the first cut, rather than carry it raw.** Recommended to keep the first contract small. The cost is stated plainly: a board that holds such a value cannot be converted to a scene until a raw escape exists, and it stays a plain `.brd`. It is **not** claimed that such a board cannot be preserved, or that no such board exists. Alternative: a raw escape key on every field, which carries every board and makes the contract larger.
7. **The draft's `things` is not carried** ([draft disposition](#disposition-of-the-draft-section-2-keys)). It had no lowering and presumed an actor. Alternative: keep it as an editor-only list, which needs a build rule for chests that does not exist.
8. **No nested `pluginData` door on placements; per-placement plugin data is keyed by `id` in the top-level block** ([plugin data](#plugin-data-and-placements)).
9. **A pack placement's pack `projection` must equal the scene's.** The draft's own example placed an `iso-rotated` pack in a `2d` scene; this rule would make that an error.
10. **The build target is the same folder and stem with `.brd`**, derived and not a field.

## Reader result shape

A scene reader takes text and returns, like the clip, tileset and asset-pack readers, either `{ok: true, scene, source}` (the parsed model and the original text, which in-place edits splice) or `{ok: false, problems}`. Each problem has `kind`, `path` (the location inside the document, for example `floors[0].tiles`), `message` and `line` (1-based). A reader reports every problem it finds, not the first, and never repairs. The [validation](#validation) rows with *reader* in the last column are the problems it reports; *project* and *build* rows need the project's files and are reported by the host, not by the reader.

## Not decided here

- **Scene rename and links.** A link and a script name a board by its `.brd` name. Renaming `a.tkrscn` renames the build target and so breaks every link by name; the rename tool ([#1806](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1806)) does not know these names. Whether a link may name a scene by path is open.
- **Rename and the scene's references.** The locations are fixed on this page ([where references are](#where-references-are)); what is open is how the rename tool is taught nested paths, an implementation matter for #1806 and #1822.
- **Automatic wall caps.** `autoWallCaps: true` remains unsupported because the scene contract does not define under-region geometry; with the value false or absent, the boundary tracing rules above apply.
- **Walk-behind from a tileset.** Tileset palette members are standalone tile documents. A tile's explicit `under` geometry is available through its path; `wallCapUnder` remains only on `isoBlocks`, which a tile reference cannot name.
- **What a board outside `Boards/` should do.** The contract only warns ([V21](#validation)); whether the editor refuses to create one is the editor's.
- **The standard `metadata` keys and the `tags` vocabulary** ([native-contracts.md](native-contracts.md#not-decided-here)).
- **The YAML profile and layout contract.**
