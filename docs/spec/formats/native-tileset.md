# Native tileset contract (`.tkrtile`)

**Status: draft, pre-release; Jensen's approval is pending.** This page is the proposed normative contract for native tileset documents, derived from section 3 of [tkr-authoring.md](tkr-authoring.md#3-tile-recipe-document-tkrtile), [native-contracts.md](native-contracts.md), [ADR 0019](../../adr/0019-tkr-authoring-formats.md) and [ADR 0005](../../adr/0005-independent-product-v1-and-native-format.md). It is reviewable, not an assertion that the owner approved its detailed choices. The proposed registry row appears below.

## In plain words

A `.tkrtile` file describes one reusable tileset: where its source images are, which cells become named tiles, how optional isometric blocks and autotile recipes are assembled, and what output target the editor builds. Its path names the document. A scene refers to the document by that path and to a tile by a local tile id. Collision and wall-cap walk-behind intent are stored with the tile recipe, so a generated tile does not lose these authoring properties.

The document uses the shared native stamp and plugin-block rules. Its own top-level fields are closed: a misspelled key is an error. No top-level `id` is used; identity is the normalized project-relative path, extension included.

## Stamp and top-level shape

`contract` is exactly `tileset`; `version` is text in the shared semantic-version form. Both are the first two keys. A writer emits `1.0.0-pre.1` until a released version is approved. Optional `tags`, `metadata` and `pluginData` follow shared rules. The contract's fields are `name`, `projection`, `cellSize`, `sources`, `tiles`, optional `isoBlocks`, optional `autotiles`, and `outputBinding`. No other top-level key is accepted.

```yaml
contract: tileset
version: 1.0.0-pre.1
name: Village Master Tileset
projection: 2d
cellSize: [32, 32]
sources:
  - id: village-sheet
    file: Bitmap/village_tiles_source.png
    grid:
      width: 32
      height: 32
      marginX: 0
      marginY: 0
      gapX: 0
      gapY: 0
    transparent: {mode: alpha}
tiles:
  - id: grass-main
    name: Meadow Grass
    source: village-sheet
    cell: [0, 0]
    role: floor
    collision: walkable
  - id: stone-wall-base
    name: Rough Stone Wall
    source: village-sheet
    cell: [1, 0]
    role: wall
    collision: solid
  - id: wood-counter-diagonal
    name: Angled Counter Corner
    source: village-sheet
    cell: [2, 0]
    role: decorative
    collision: walkable
    kitbash:
      - op: cutCorner
        diagonal: north-west
        clearHalf: true
isoBlocks:
  - id: stone-cube
    name: Stone Isometric Cube
    heightPixels: 32
    faces:
      top: {source: village-sheet, cell: [3, 0], tint: [0, 0, 0]}
      left: {source: village-sheet, cell: [4, 0], tint: [-24, -24, -24]}
      right: {source: village-sheet, cell: [4, 0], tint: [-56, -56, -56]}
    collision: solid
    wallCapUnder: true
autotiles:
  - id: water-edge
    name: Water Coast Autotile
    mode: blob-47
    base: {source: village-sheet, cell: [5, 0]}
    border: {source: village-sheet, cell: [6, 0]}
    innerCorner: {source: village-sheet, cell: [7, 0]}
    exportOrder: t25-canonical
outputBinding:
  target: Tiles/village_auto.tst
  detail: 1
```

## Fields

All pixel and grid values are exact integers. Coordinates and cell indices are zero-based. Lists preserve authored order and have unique `id` values within their own list. IDs use lowercase kebab-case as in the shared authoring conventions; they are local names, not document identities. Paths are project-relative `/` paths and resolve from the project root. A missing or ambiguous source, out-of-bounds cell, or duplicate local id is an error; no source is silently substituted.

### Common fields

| Field | Required | Contract |
|---|---:|---|
| `name` | yes | Non-empty display name. It has no identity or reference semantics. |
| `projection` | yes | One of `2d`, `iso-stacked`, `iso-rotated`; controls the authored output layout. |
| `cellSize` | yes | `[width, height]` in positive logical pixels; the common cell dimensions of the set. |

### Sources

`sources` is a non-empty ordered list. Each source has a unique local `id`, a `file` project-relative asset path, a `grid`, and `transparent` settings. `grid.width` and `.height` are positive pixel dimensions of a cell; `marginX`, `marginY`, `gapX`, and `gapY` are non-negative pixel values. A cell `[column, row]` identifies the source grid cell after margins and gaps. It must lie inside the source image; a partial final cell is not addressable.

`transparent` is exactly one of `{mode: alpha}` or `{mode: colorKey, color: [r, g, b]}`. Each color channel is an integer from 0 through 255. Alpha mode preserves source alpha; color-key mode treats exactly that RGB value as transparent.

### Tiles

`tiles` is a non-empty ordered list. Each tile has a unique local `id`, non-empty `name`, `source` id naming one source in this document, `cell` pair, and `role` (`floor`, `wall`, `wall-cap`, or `decorative`). Optional `kitbash` is an ordered list of supported transformations; each operation has a closed shape defined by its operation name. Unknown operations or parameters are errors. The current draft illustrates `cutCorner` with `diagonal` (`north-west`, `north-east`, `south-east`, `south-west`) and `clearHalf` boolean; this contract does not imply additional operations.

`collision` is required on each tile and is either `walkable` or `solid`. It describes the generated tile's default placement behavior: walkable tiles contribute no solid collision; solid tiles contribute the tile-footprint solid boundary when lowered into a scene/legacy board. It is authoring metadata and does not override scene-local vector edits. `wall-cap` role does not itself imply under/walk-behind behavior; only `wallCapUnder` says that explicitly.

### Isometric blocks

`isoBlocks`, when present, is an ordered list of unique ids. Each entry has a non-empty name, positive integer `heightPixels`, `faces` with exactly `top`, `left`, and `right`, and `collision` (`walkable` or `solid`). Each face names a source id and cell pair and may carry an integer RGB `tint` offset with channels in `[-255, 255]`; omitted tint is `[0, 0, 0]`. The three faces are composed as one isometric block recipe.

`wallCapUnder` is optional and defaults to `false`. When `true`, the generated block acts as a wall cap that can be walked under: lowering emits the corresponding under/walk-behind region for the block footprint as well as any collision selected by `collision`. It is independent of `collision`; setting it does not turn solid collision off. A block with no valid under-region geometry is rejected rather than silently downgraded.

### Autotiles

`autotiles`, when present, is an ordered list of unique ids. Each entry has a non-empty `name`, `mode` (`blob-47`), `base`, `border`, and `innerCorner` source-cell references, and `exportOrder` (`t25-canonical`). Each reference has exactly `source` and `cell`, names a source in this document and a valid cell. `blob-47` denotes the 8-neighbour 47-variant blob mask family; `t25-canonical` selects its fixed canonical output ordering. Unsupported modes or orderings are errors, not best-effort fallbacks.

### Output binding

`outputBinding` is required and has exactly `target` and `detail`. `target` is a project-relative destination path for the generated `.tst` output; it must not be a native-document identity or overwrite a source. `detail` is a positive integer legacy tile detail value. The build is deterministic for the same document and source bytes. The output is generated, not a second authoring document.

## References and identity

A tileset document's identity is its path, extension included, under the shared native identity rules (ASCII-only case folding and path normalization). The path is stable until an explicit rename updates references. No document-level `id` is present.

A reference to a tile is a mapping with a `tileset` document path and a `tile` local ID, for example `{tileset: tiles/village.tkrtile, tile: grass-main}`. The document path must resolve to a registered `.tkrtile` whose stamp says `tileset`; the local ID must name exactly one tile in that document. A document rename updates the path field; renaming a tile updates its local-ID references. Source IDs and isometric/autotile IDs are local to their recipe and are not cross-document references. This two-field recommendation matches the proposed asset-pack reference and avoids introducing fragment parsing and escaping rules.

## Plugin data

`pluginData` is an optional top-level mapping exactly as defined by [native-contracts.md#plugin-blocks](native-contracts.md#plugin-blocks). Each plugin id maps to a closed envelope containing only `version` and mapping-valued `data`; plugin payload stays opaque to the core and is preserved byte-for-byte by writers that do not own it. Plugins cannot add core fields or put blocks on individual tiles, sources, blocks or autotiles. A plugin needing per-tile data keeps it in its own data mapping keyed by local tile id. No plugin block has its own extension or registry row.

## Lowering and preservation

A tileset is source authoring data; the runtime continues to consume generated `.tst`, `.iso` and related legacy outputs, not `.tkrtile`. Building follows the source order and the deterministic recipe ordering above. Tile collision and `wallCapUnder` are carried into the generated scene/board collision and under-vector output where representable. If a legacy target cannot encode a selected field, the build must report it as unavailable rather than silently discarding or changing it. A writer changing one field preserves comments, unknown plugin payload, quoting, order, and all other unowned bytes under the shared in-place editing rules.

## Draft-key disposition

Every key shown in draft section 3 has a disposition here. Keys that remain have normative definitions above; these rows call out changes or important constraints.

| Draft key | Disposition |
|---|---|
| `contract` | Retained; value is `tileset` (shared stamp spelling). |
| `version` | Retained; shared semantic version, pre-release until published. |
| `id` | Dropped; path-with-extension is document identity. |
| `name` | Retained as required display name. |
| `projection` | Retained; constrained to shared three-value vocabulary. |
| `cellSize` | Retained; positive `[width, height]` integer pixels. |
| `sources` | Retained as ordered list; source `id` is local, `file` path project-relative, grid and transparency shapes closed. |
| source `id` | Retained; unique within this document, not cross-document identity. |
| source `file` | Retained; project-relative source asset path. |
| source `grid` | Retained; cell dimensions, margins and gaps defined above. |
| `transparent` | Retained; exactly alpha or RGB color-key mode. |
| `tiles` | Retained as ordered list; local IDs unique and references scoped to this document. |
| tile `id` | Retained as a stable local reference target. |
| tile `name` | Retained as display name. |
| tile `source` | Retained as local source-id reference. |
| tile `cell` | Retained as zero-based `[column, row]`. |
| tile `role` | Retained with closed four-value vocabulary. |
| tile `collision` | Retained, required; `walkable` or `solid`; lowered as default collision intent. |
| tile `kitbash` | Retained as ordered, closed operation list; only the illustrated `cutCorner` shape is presently specified. |
| `isoBlocks` | Retained optional; ordered list of block recipes. |
| block `id`, `name`, `heightPixels`, `faces` | Retained; exact required members and bounds defined above. |
| face `source`, `cell`, `tint` | Retained; source-cell reference and optional bounded channel offsets. |
| block `collision` | Retained, required; `walkable` or `solid`. |
| block `wallCapUnder` | Retained optional; defaults false; adds under/walk-behind output independently of collision. |
| `autotiles` | Retained optional; ordered list. |
| autotile `id`, `name`, `mode`, `base`, `border`, `innerCorner`, `exportOrder` | Retained; closed modes/order and exact source-cell reference shape above. |
| `outputBinding` | Retained required; generated target and detail. |
| output `target` | Retained; project-relative generated `.tst` target; cannot overwrite source. |
| output `detail` | Retained; positive integer. |
| `tags`, `metadata`, `pluginData` | Not shown in draft; added from shared native contract. |
| Any other top-level key | Rejected by closed contract; no undocumented escape hatch. |

## Proposed registry entry

Add this row to [the native contract registry](native-contracts.md#the-registry) and the package registry in the same change:

| Extension | Contract | Contract page |
|---|---|---|
| `.tkrtile` | `tileset` | [native-tileset.md](native-tileset.md) |

## Owner review: consequential choices

This draft makes concrete recommendations so it can be reviewed end to end. These are the decisions that remain genuinely ambiguous in the source materials and need Jensen's explicit review before the contract is treated as approved:

1. **Tile-reference spelling:** use separate `tileset` path and `tile` local-ID fields, consistent with the asset-pack draft. A path fragment would be shorter but needs fragment parsing and escaping rules that shared native identity does not define.
2. **Collision output geometry:** use each tile/block footprint as the default solid boundary on lowering. ADR 0019 requires collision stored with the art, but neither the draft nor the ADR defines the exact legacy vector geometry, especially for isometric faces. Confirm or replace before implementation.
3. **`wallCapUnder` geometry:** emit an under region for the block footprint, independently of solid collision. The draft marks the intent but not the generated region's precise shape or depth; confirm this conservative footprint interpretation.
4. **Legacy output representability:** report unrepresentable recipes/metadata rather than silently drop them; this follows the general authoring contract but exact `.tst`/`.iso` build mapping remains a later reader/writer implementation concern.

Approval of this page is a gate in story #1846. Until Jensen approves it, this remains a proposed specification, not a completed acceptance criterion.
