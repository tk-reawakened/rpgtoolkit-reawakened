# Native asset-pack contract (`.tkrpack`)

**Status: reviewed pre-release contract.** Jensen reviewed and merged this page in [#3194](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3194). It defines a native pack of reusable scene assets, preserving each asset's art, placement anchor, collision (`solid`) and walk-behind (`under`) data together. The contract is written from section 4 of [`tkr-authoring.md`](tkr-authoring.md#4-scene-asset--stamp-pack-document-tkrpack), under the common rules in [`native-contracts.md`](native-contracts.md).

## In plain words

A `.tkrpack` is one YAML file containing reusable props, stamps and backdrops. Its path names the pack document; a scene selects an asset by giving that path and the asset's ID inside the pack. Each asset keeps its artwork, anchor, collision outlines and walk-behind regions together, so a scene can place and lower it without copying those definitions. The contract version is pre-release and its fields are strict; the one open top-level extension point is `pluginData`.

## Contract and identity

- **Extension:** `.tkrpack`.
- **Contract stamp:** `contract: asset-pack` and a textual `version` in the shared semantic-version form. This draft uses `1.0.0-pre.1`; pre-release rules permit changes before a released `1.0.0` promise.
- **Document identity:** its project-relative path including `.tkrpack`, such as `packs/medieval-iso-kit.tkrpack`. There is no authored top-level document `id`; a rename changes this identity and references use the path.
- **Shape:** YAML 1.2 in UTF-8. `contract` and `version` are the first two keys. The top level is closed to the stamp, the fields listed below and optional `tags`, `metadata` and `pluginData`. Unknown core keys are errors. The draft's two-space indentation, no-tabs, no-anchors/aliases/custom-tags and deterministic field order are retained as this authoring format's proposed profile, subject to the YAML-profile question in the shared contract.

The following is an illustrative document, not a released compatibility promise:

```yaml
contract: asset-pack
version: 1.0.0-pre.1
name: Medieval Isometric Props & Architecture
projection: iso-rotated
grid:
  tileWidth: 64
  tileHeight: 32
sources:
  - id: props-atlas
    file: Bitmap/medieval_props.png
    transparent: {mode: alpha}
assets:
  - id: stone-archway
    name: Stone Archway
    category: Architecture
    kind: stamp
    anchor: {x: 64, y: 96, snap: iso-diamond-center}
    visuals:
      - source: props-atlas
        rect: [0, 0, 128, 112]
        layerOffset: 0
    solid:
      - label: Left Pillar
        closed: true
        points: [[-48, -8], [-32, 0], [-16, -8], [-32, -16]]
    under:
      - label: Walk-Under Lintel
        attributes: 7
        closed: true
        points: [[-48, -80], [48, -32], [48, -16], [-48, -64]]
  - id: wooden-chest
    name: Wooden Chest
    category: Furniture
    kind: prop
    anchor: {x: 16, y: 28, snap: bottom-center}
    visuals:
      - source: props-atlas
        rect: [128, 0, 32, 32]
    solid:
      - label: Chest Footprint
        closed: true
        points: [[-14, -10], [14, -10], [14, 0], [-14, 0]]
pluginData:
  com.example.glow:
    version: 1.0.0
    data: {bloom: 0.4}
```

## Fields

Core fields appear at the top level beside the stamp. `pluginData` is the only open region; no field may be added there by a plugin.

| Field | Required | Meaning and proposed constraint |
|---|---:|---|
| `name` | yes | Human-readable pack name. It does not identify the file. |
| `projection` | yes | Pack-wide layout: `2d`, `iso-stacked` or `iso-rotated`. Every asset inherits it. |
| `grid` | yes | Pack placement grid; `tileWidth` and `tileHeight` are positive integer logical pixels. |
| `sources` | yes | Non-empty list of source-art records. Source `id`s are unique in the pack and are the local names used by visuals. |
| `assets` | yes | Non-empty list of independently addressable asset records. Asset `id`s are unique within the pack and use the shared kebab-case identifier form. List order is author order, not identity. |
| `pluginData` | no | The shared native plugin-block dictionary. Its envelope, preservation and ordering follow [`native-contracts.md`](native-contracts.md#plugin-blocks). |

A source has the required `id` and `file`, plus optional `transparent`. `file` names an existing project asset using the project's asset-path convention; it is not a native document ID. `transparent` is either `{mode: alpha}` or `{mode: colorKey, color: [r, g, b]}`, with integer channels from 0 through 255. Unknown source keys are errors.

An asset has required `id`, `name`, `kind`, `anchor` and `visuals`; `category`, `solid` and `under` are optional. `kind` is exactly `stamp`, `prop` or `backdrop`. All three kinds use the same placement and vector shape; `kind` describes their authoring role and does not silently change collision rules.

- `anchor` has integer `x` and `y` and a `snap` mode. Coordinates are logical pixels in the asset's shared visual space; the anchor is the point placed at the scene's `(x, y)`. The recommended snap modes are `bottom-center` and `iso-diamond-center`.
- `visuals` is a non-empty list. Each entry names a local `source` ID, a positive-size integer crop `rect: [x, y, width, height]` within that source, and optional integer `layerOffset` (default `0`, in board layer steps). Visual entries share the asset origin; their crop top-lefts align there, and `layerOffset` changes draw ordering only.
- `solid` is a list of labeled collision outlines; `under` is a list of labeled walk-behind regions. Each vector has a required `label`, boolean `closed` and ordered integer `points`. Points are offsets in logical pixels from the asset anchor, and may be negative. A closed outline has at least three points; an open outline has at least two. Open `solid` paths represent line barriers; `under` regions are closed polygons. An omitted/empty list means that the asset contributes no vectors of that kind.
- An `under` vector also has required integer `attributes`, the existing mask bits: 1 covers background, 2 covers lower layers and 4 intersects the frame. Only bits 1, 2 and 4 are defined; values outside 0–7 are errors. `solid` has no `attributes` field. Since the parent field already identifies vector purpose, vectors have no generic `type` field.

### Scene references

A scene refers to one asset using the native document path plus the pack-local asset ID. The path follows native document identity rules (including its extension); the `asset` value is resolved only within that pack:

```yaml
placedPacks:
  - instanceId: archway-1
    pack: packs/medieval-iso-kit.tkrpack
    asset: stone-archway
    floor: ground
    x: 480
    y: 288
```

`pack` is a path, not a synthetic pack ID. `asset` is not a second document ID and is not globally unique. The draft's `assetId: <pack id>:<asset id>` form is retired because its pack component is not the path-based identity. A path rename therefore requires updating scene `pack` references; changing an asset's local ID requires updating only references to that ID in its pack's consumers.

The scene draft's `things[].fromAsset` provenance link uses the same two-part reference as an object, rather than a colon-delimited scalar:

```yaml
things:
  - id: chest-village-gold
    fromAsset:
      pack: packs/medieval-iso-kit.tkrpack
      asset: wooden-chest
```
The proposed [scene contract](native-scene.md#disposition-of-the-draft-section-2-keys) does not carry the draft's `things` records in its first cut. Its pack placements use `pack` and `asset` directly; the example above records the earlier draft's provenance spelling, not a requirement to add `things` to that scene proposal.


## Plugin blocks

`pluginData` follows the common native contract: it is optional, top-level and keyed by plugin ID; each block has exactly `version` and mapping-valued `data`. The core validates only the envelope, preserves unknown plugin data byte for byte, and does not allow plugins to add source, asset or other core fields. A block belongs to the pack document, not to an individual asset; asset-local plugin doors are not proposed. Writers preserve comments and unrelated text as required by the common preservation rules.

## Disposition of every section 4 draft key

This table accounts for every key in the section 4 example, its nested mappings and vector fields, and the scene-reference notation that selects an asset. “Keep” means the key remains; “rename/split” explains its new location or name; “drop” means the native contract intentionally does not carry it.

| Draft key | Disposition in this contract |
|---|---|
| `contract` | Keep as the shared stamp key, value `asset-pack`; first key. |
| `version` | Keep as the shared stamp key; text `1.0.0-pre.N`; second key. |
| top-level `id` | Drop: path including `.tkrpack` is document identity. Local asset IDs remain. |
| top-level `name` | Keep as required descriptive pack name; never identity. |
| `projection` | Keep as required pack-wide projection; no per-asset override in this draft. |
| `grid` | Keep as required pack-wide placement grid. |
| `grid.tileWidth`, `grid.tileHeight` | Keep as positive integer logical-pixel dimensions. |
| `sources` | Keep as a non-empty sequence rather than a mapping, for an explicit record schema. |
| mapping key `props-atlas` | Rename to `sources[].id`; source IDs remain local to the pack. |
| `sources[].file` | Keep as a project asset path, not a native-document reference. |
| `sources[].transparent` | Keep as an optional tagged transparency rule (`alpha` or `colorKey`). |
| `transparent.mode` | Keep; `alpha` and `colorKey` are the supported modes. |
| color-key RGB value | Keep as `transparent.color: [r, g, b]` when mode is `colorKey`; draft alpha example has no color. |
| `assets` | Keep as a non-empty sequence of asset records. |
| `assets[].id` | Keep as the pack-local asset identity referenced by scenes. |
| `assets[].name` | Keep as required display name. |
| `assets[].category` | Keep as optional descriptive grouping. |
| `assets[].kind` | Keep as required `stamp`, `prop` or `backdrop`. |
| `assets[].anchor` | Keep as required placement anchor. |
| `anchor.x`, `anchor.y` | Keep as integer logical-pixel anchor coordinates in shared asset space. |
| `anchor.snap` | Keep as snap mode; recommend `bottom-center` or `iso-diamond-center`. |
| `assets[].visuals` | Keep as a non-empty list of visual crops. |
| `visuals[].source` | Keep as a reference to `sources[].id`. |
| `visuals[].rect` | Keep as `[x, y, width, height]`, positive size and in-bounds crop. |
| `visuals[].layerOffset` | Keep as optional integer board-layer offset, default `0`. |
| `assets[].vectors` | Split into optional `assets[].solid` and `assets[].under` lists to make the two core meanings explicit. |
| `vectors[].label` | Keep on each `solid`/`under` vector as a descriptive label, not identity. |
| `vectors[].type` | Drop: the containing list (`solid` or `under`) already states purpose. |
| `vectors[].closed` | Keep as required boolean geometry property; `under` shapes must be closed. |
| `vectors[].points` | Keep as ordered integer points relative to the asset anchor. |
| `under` vector `attributes` | Keep only on `under` vectors as the three-bit mask; reject it on `solid`. |
| scene `placedPacks[].instanceId` | Keep in the scene contract as the placement instance identity; not a pack field. |
| scene `placedPacks[].assetId` | Replace with `pack` path and pack-local `asset` ID; no colon-joined identity. |
| scene `things[].fromAsset` | Replace the colon-delimited scalar with a mapping containing `pack` path and pack-local `asset` ID. |
| scene `floor`, `x`, `y` | Keep as scene placement fields; not fields of the pack document. |

## Review and pre-release status

Jensen reviewed and merged [#3194](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3194). The following records the choices and alternatives presented for that review; the contract remains pre-release.

1. **Anchor and vector coordinate frame.** The contract uses integer pixels with the placed anchor at the scene position and vector points offset from it. The alternative was a visual/source origin.
2. **Multiple visuals.** Crops share one visual origin and `layerOffset` affects board-layer ordering only. Per-visual offsets were considered as a more expressive alternative.
3. **Open outlines and under masks.** Solid line geometry may be open or closed; under polygons are closed, with the documented 1/2/4 mask.
4. **Reference spelling.** Separate `pack` path and `asset` local-ID fields avoid fragment escaping and parsing rules absent from the native identity contract.
5. **Shared wrapper and YAML profile.** The flat shape was selected under delegated implementation direction ([native contracts](native-contracts.md)); this does not claim direct approval of the whole ADR. The shared YAML profile remains open. This page follows the authoring draft's YAML restrictions.

## Registry

The shared native registry is in [`native-contracts.md`](native-contracts.md#the-registry) and `packages/native-data`. This contract adds the row in both places in the same change:

| Extension | Contract | Contract page |
|---|---|---|
| `.tkrpack` | `asset-pack` | [native-asset-pack.md](native-asset-pack.md) |

The native registry test reads that table and compares it with the package registry. The contract remains pre-release.

## References

- [`native-contracts.md`](native-contracts.md): stamp, versions, registry, identity, plugin blocks and preservation.
- [ADR 0019](../../adr/0019-tkr-authoring-formats.md), 2026-11-11 amendment, points 3 and 5.
- [ADR 0005](../../adr/0005-independent-product-v1-and-native-format.md), second amendment, 2026-11-11.
- [`tkr-authoring.md` §4](tkr-authoring.md#4-scene-asset--stamp-pack-document-tkrpack), the draft input and field-disposition source.
