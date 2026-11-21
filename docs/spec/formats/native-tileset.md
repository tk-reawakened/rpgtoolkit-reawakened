# Native tileset contract (`.tkrtst`)

**Status: pre-release contract at the retained-terrain amendment.** This page defines the `.tkrtst` contract from [tkr-authoring.md](tkr-authoring.md#3-tile-recipe-document-tkrtile), [native-contracts.md](native-contracts.md), [ADR 0019](../../adr/0019-tkr-authoring-formats.md) and [ADR 0005](../../adr/0005-independent-product-v1-and-native-format.md). Standalone tiles, terrain recipes and output slots below are the whole current contract.

## In plain words

A `.tkrtst` file lists standalone `.tkrtle` tile documents, optional terrain recipes that choose among them, and the explicit output slots the editor builds. Its path names the document. A scene refers to the tileset by path for a terrain, and to a tile by that tile document's path. Collision and walk-behind geometry are stored with the tile document, not copied into the tileset.

The document uses the shared native stamp and plugin-block rules. Its own top-level fields are closed: a misspelled key is an error. No top-level `id` is used; identity is the normalized project-relative path, extension included.

## Stamp and top-level shape

`contract` is exactly `tileset`; `version` is text in the shared semantic-version form. Both are the first two keys. Writers emit `1.0.0-pre.2` until a released version is approved. Optional `tags`, `metadata` and `pluginData` follow shared rules. The contract's fields are `name`, `expects`, `tiles`, optional `terrains`, optional authored `sources` and `isoBlocks`, and `outputBinding`. No other top-level key is accepted.

```yaml
contract: tileset
version: 1.0.0-pre.2
name: Village Master Tileset
expects: {projection: 2d, cellSize: [32, 32]}
tiles:
  - {tile: Tiles/grass-main.tkrtle}
  - {tile: Tiles/stone-wall-base.tkrtle}
terrains:
  - id: grass
    name: Meadow
    resolver: {provider: builtin, id: neighbour-match, version: 1.0.0}
    neighbours: cardinal-4
    coverage: complete
    sync: independent
    rules:
      - id: all
        when: {}
        use: {tile: Tiles/grass-main.tkrtle}
outputBinding:
  target: Tiles/village_auto.tst
  detail: 1
  slots:
    - {slot: 1, tile: Tiles/grass-main.tkrtle}
    - {slot: 2, tile: Tiles/stone-wall-base.tkrtle}
```

## Fields

All pixel and grid values are exact integers. Coordinates and cell indices are zero-based. Lists preserve authored order and have unique `id` values within their own list. IDs use lowercase kebab-case as in the shared authoring conventions; they are local names, not document identities. Paths are project-relative `/` paths and resolve from the project root. A missing or ambiguous source, out-of-bounds cell, or duplicate local id is an error; no source is silently substituted.

### Common fields

| Field | Required | Contract |
|---|---:|---|
| `name` | yes | Non-empty display name. It has no identity or reference semantics. |
| `expects` | yes | `{projection, cellSize}`: `2d`, `iso-stacked` or `iso-rotated`, and positive `[width, height]` logical pixels every palette member must match. |

### Palette

`tiles` is a non-empty ordered list of closed `{tile: <.tkrtle path>}` mappings. Each path is a project-relative document identity, normalized with ASCII-only case folding; duplicate normalized identities are errors. A tile's name, artwork, timeline, role, collision and walk-behind geometry belong to its standalone document, never to this list.

### Tile art operations

A standalone tile's optional `kitbash` uses the operation below; the tileset does not copy it.

**Reawakened `cutCorner` rule (product choice, not a legacy-ordering claim).** Operations are applied in list order to the cropped cell before legacy pixel encoding. `clearHalf: false` leaves the cell unchanged. With `clearHalf: true`, clear the triangular half at the named corner to transparent; keep pixels whose centers lie exactly on the diagonal. For a cell of width `w` and height `h`, at zero-based pixel `(x, y)`, let `u = 2x + 1` and `v = 2y + 1`. Clear north-west when `u*h + v*w < 2*w*h`, north-east when `(2*w - u)*h + v*w < 2*w*h`, south-east when `(2*w - u)*h + (2*h - v)*w < 2*w*h`, and south-west when `u*h + (2*h - v)*w < 2*w*h`. Other pixels retain their source color and transparency. Multiple cuts therefore accumulate; no operation restores clear pixels.

### Sources

`sources` is an optional non-empty ordered list used only by `isoBlocks` faces. Each source has a unique local `id`, a `file` project-relative asset path, a `grid`, and `transparent` settings. `grid.width` and `.height` are positive pixel dimensions of a cell; `marginX`, `marginY`, `gapX`, and `gapY` are non-negative pixel values. A cell `[column, row]` identifies the source grid cell after margins and gaps. It must lie inside the source image; a partial final cell is not addressable. A palette tile does not use a sheet cell.

`transparent` is exactly one of `{mode: alpha}` or `{mode: colorKey, color: [r, g, b]}`. Each color channel is an integer from 0 through 255. Alpha mode preserves source alpha; color-key mode treats exactly that RGB value as transparent.

### Isometric blocks

`isoBlocks`, when present, is an ordered list of unique ids. Each entry has a non-empty name, positive integer `heightPixels`, `faces` with exactly `top`, `left`, and `right`, and `collision` (`walkable` or `solid`). Each face names a source id and cell pair and may carry an integer RGB `tint` offset with channels in `[-255, 255]`; omitted tint is `[0, 0, 0]`. The three faces are composed as one isometric block recipe.

`wallCapUnder` is optional and defaults to `false`. When `true`, the generated block acts as a wall cap that can be walked under: lowering emits the corresponding under/walk-behind region for the block footprint as well as any collision selected by `collision`. It is independent of `collision`; setting it does not turn solid collision off. A block with no valid under-region geometry is rejected rather than silently downgraded.

A flat `.tst` binding emits only the `outputBinding.slots` allocations. An unreferenced block recipe stays in the authored YAML and is reported as not emitted; its presence does not block a flat build. A target requiring raised blocks is refused until the projected faces, draw order, solid collision and walk-behind are specified and verified in both isometric layouts. Detail 150 describes a flat diamond, not a way to flatten a raised block.

### Built-in terrain matcher

This defines how `builtin/neighbour-match@1.0.0` chooses a tile for the [terrain recipe proposal](../../design/tile-tool-contract-proposal.md#how-a-terrain-recipe-is-read). It does not register the proposed recipe or scene fields or define the legacy `t25-canonical` export order.

1. The scene supplies the eight `same` bits after resolving region ownership and the outside-grid rule. Bits 0 through 7 are `n`, `e`, `s`, `w`, `nw`, `ne`, `se`, `sw`. `cardinal-4` discards all diagonal bits. In `blob-8`, a diagonal is present only when both adjacent cardinal bits are set. Its value then comes from the supplied mask. Reduce the input by clearing every absent bit.
2. A rule matches only when all of its named neighbours are present and have their stated values. Omitting a neighbour makes no test of it. A recipe with overlapping rules or a rule that can match no reduced situation is invalid. `complete` requires exactly one match for every reduced situation. `partial` reports the count of missing situations; encountering one during a build is a located error, not a fallback.
3. A matched `use` selects one tile. A matched `variants` list has positive integer weights with total at most 4,294,967,295. Take the unsigned 32-bit FNV-1a hash (offset 2,166,136,261; multiplier 16,777,619) of the ASCII floor ID followed by a zero byte, the seed (default zero, signed 32-bit), cell `x` and `y` (unsigned 32-bit), and the one-byte reduced mask. The three four-byte values are little-endian. Take the hash modulo total weight and choose the first variant whose cumulative weight is strictly greater. Labels, path spellings, input rule order and unrelated scene cells do not enter the hash.

### Output binding

`outputBinding` is required and has exactly `target`, `detail` and `slots`. `target` is a project-relative destination path for the generated `.tst` output; it must not be a native-document identity or overwrite a source. `detail` is a positive integer legacy tile detail value. `slots` is the persistent 1-based allocation table described under [the terrain cutover](#terrain-cutover); the writer never derives or renumbers it. The build is deterministic for the same document and source bytes. The output is generated, not a second authoring document.

## Terrain cutover

This section replaces the embedding and source-order rules above at the [terrain cutover](../../adr/0019-tkr-authoring-formats.md#amendment-retained-terrain-and-standalone-tiles). The `tileset` stamp keeps its name under `.tkrtst`; the new palette uses [standalone tiles](native-tile.md#stamp-identity-and-fields).

- `expects: {projection, cellSize}` gives the projection and two positive integer pixel dimensions every member must match. `tiles` is an ordered palette of closed `{tile: <.tkrtle path>}` mappings. Duplicate normalized document identities are errors. Member names, geometry, artwork and timelines are not copied here; embedded tile records, source grids and sheet cells are obsolete and rejected.
- `terrains` is optional. Each record has a unique local `id`, non-empty `name`, `resolver: {provider, id, version}`, `neighbours`, `coverage`, `sync` and `rules`. Optional `outside` is `same` or `other` (default), and optional `seed` is signed 32-bit (default zero). `sync` is `lockstep` or `independent`; lockstep requires identical frame-duration sequences and phase for all selected animated tiles and may not mix still and animated tiles.
- A rule is a closed `{id, when, use}` or `{id, when, variants}` mapping. Rule IDs are unique within the terrain. `when` maps matcher directions to `same` or `other`; `{}` has no conditions. `use` is `{tile: <.tkrtle path>}`; `variants` is a non-empty ordered list of `{tile: <.tkrtle path>, weight}`. Every selected tile must resolve to one standalone tile document and be listed in `tiles`, comparing normalized document identities. A resolver pin that cannot be supplied blocks the affected build and cannot install or enable a plugin.
- `outputBinding` has required `target`, `detail` and `slots`. Slot rows are exactly `{slot, tile}`, `{slot, tile, cel}` or `{slot, reserved: true}`. `slot` is a unique integer from 1 through 32767; every number through the largest allocated slot has one row. Still members have one row; animated members have one row per distinct authored cel, including transparent or unused cels. A reserved row has no tile or cel. Allocations must name existing palette members and, where applicable, existing cels.
- Generate output tiles in numeric slot order, including tombstones at the target detail's transparent value. Retiring a tile/cel leaves its slot reserved even at the end; new allocations append. The writer and builder never derive or change slot numbers. Animated output uses the same allocated cel numbers.
- A flat binding names a `.tst` output under `Tiles/`. Native tiles produce references to that output using their allocated numbers. Animated members generate `<target stem>.tile-<hash>.tan` beside the `.tst`; `<hash>` is lowercase SHA-256 of normalized standalone tile identity (including ASCII case fold). Reordering palette, slots, cels or timeline does not change the animation filename.
- Rename inventory includes `tiles[].tile`, `terrains[].rules[].use.tile`, `terrains[].rules[].variants[].tile` and `outputBinding.slots[].tile`. A standalone tile rename changes paths, never slot integers. Terrain ID rename rewrites local terrain references in scenes.

## References and identity

A tileset document's identity is its path, extension included, under the shared native identity rules (ASCII-only case folding and path normalization). The path is stable until an explicit rename updates references. No document-level `id` is present.

A reference to a standalone tile is `{tile: <.tkrtle path>}`. It resolves to exactly one registered `tile` document; there is no tileset-local tile ID. A terrain reference is the pair `{tileset: <.tkrtst path>, terrain: <local terrain id>}`. The path resolves to exactly one registered `tileset` document, and the ID to exactly one terrain in that document. Rename updates document paths or local terrain IDs at the contract-defined sites.

## Plugin data

`pluginData` is an optional top-level mapping exactly as defined by [native-contracts.md#plugin-blocks](native-contracts.md#plugin-blocks). Each plugin id maps to a closed envelope containing only `version` and mapping-valued `data`; plugin payload stays opaque to the core and is preserved byte-for-byte by writers that do not own it. Plugins cannot add core fields or put blocks on palette members, terrains, sources or blocks. A plugin needing per-tile data keeps it in the standalone tile's own block. No plugin block has its own extension or registry row.

## Lowering and preservation

A tileset is source authoring data; the runtime continues to consume generated `.tst`, `.iso` and related legacy outputs, not `.tkrtst`. Building follows the source order and the deterministic recipe ordering above. Tile collision and `wallCapUnder` are carried into the generated scene/board collision and under-vector output where representable. If a legacy target cannot encode a selected field, the build must report it as unavailable rather than silently discarding or changing it. A writer changing one field preserves comments, unknown plugin payload, quoting, order, and all other unowned bytes under the shared in-place editing rules.

## Key disposition

| Key | Disposition |
|---|---|
| `contract`, `version`, `tags`, `metadata`, `pluginData` | Shared stamp and reserved keys. |
| `name` | Required display name; not identity. |
| `expects` | Required `{projection, cellSize}` every standalone member must match. |
| `tiles` | Required ordered palette of `{tile: <.tkrtle path>}` mappings; duplicate normalized identities are errors. |
| `terrains` | Optional named recipes and rules that select palette members by path. |
| `sources`, `isoBlocks` | Optional authored raised-block recipes; only `isoBlocks` faces use source cells. They do not define palette tiles. |
| `outputBinding` | Required `{target, detail, slots}`; the only owner of persistent 1-based output slots. |
| tile `id`, `source`, `cell`, `role`, `collision`, `kitbash`, `autotiles` | Removed from the tileset; they live in standalone `.tkrtle` documents or are rejected. |
| Any other top-level key | Rejected by the closed contract; no alias and no migration from the embedded form. |

## Not decided here

- **Raised-isometric lowering.** `isoBlocks` remains authored, but a target that would emit a raised block refuses until its faces, draw order, collision and walk-behind are proved in both isometric layouts.
- **Collision and wall-cap vector geometry.** A tile's explicit `solid` and `under` outlines are carried when representable; this page does not invent geometry for a legacy target that cannot encode them.
- **Artwork codec.** A standalone tile names an ordinary raster rectangle or a managed frame and region ([native-tile.md](native-tile.md)); no tool or managed-art codec is defined here.
- **Tileset-local tile identity.** There is none. A tile is its document path, and the previous `{tileset, tile: local-id}` spelling is rejected.
