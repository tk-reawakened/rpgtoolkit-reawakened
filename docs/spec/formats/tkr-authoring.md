# TK Reawakened Authoring Formats (`.tkrscn`, `.tkrtile`, `.tkrpack`)

This specification defines the normative structure of TK Reawakened's native YAML authoring documents ([ADR 0019](../../adr/0019-tkr-authoring-formats.md)).

These files are created and maintained in the authoring workspace (`editor-model` / `editor-ui`) and **compile/lower** deterministically into legacy runtime targets (`.brd`, `.tst`, `.iso`, `.tbm`, `.tan`) so the `@tk-reawakened/core` runtime engine can play them without requiring immediate changes to its runtime format decoders.

> **Status: draft, pre-release** (amendment of 2026-11-11, [#1839](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1839)). These formats follow [native-contracts.md](native-contracts.md). The separate [scene](native-scene.md), [tileset](native-tileset.md), and [asset-pack](native-asset-pack.md) contract pages supersede the corresponding historical sketches below where they differ. Jensen reviewed and merged the scene and asset-pack pages; the tileset page remains proposed. All three extensions are registered. The examples below retain historical document IDs and other spellings for context and are not contract definitions.

**Broader design direction (2026-11-18):** the [connected native authoring format set](../../design/native-authoring-format-set.md) brings the project root, definitions, graphics and presentation ownership together. It is a design proposal, not an extension of these closed schemas. [ADR 0005's new direction](../../adr/0005-independent-product-v1-and-native-format.md#direction-2026-11-18-design-a-connected-native-authoring-project) retains current release and direct-editing commitments until an explicit contract cutover.

---

## 1. Shared Conventions

1. **Format & Encoding:** Valid YAML 1.2 in UTF-8.
2. **Deterministic Serialization:**
   - Keys are serialized in the canonical schema order defined below.
   - Indentation is strictly 2 spaces; tabs are prohibited.
   - YAML anchors (`&`), aliases (`*`), and custom tags (`!`) are prohibited to guarantee straightforward JSON-equivalence and safe parsing.
3. **Identifiers:**
   - `id` values are URL/slug-friendly kebab-case strings (`^[a-z0-9]+(-[a-z0-9]+)*$`) unique within their document scope.
4. **Coordinate Units:**
   - All spatial points, rectangles, and dimensions use exact integers (logical pixels or tile grid steps). Floating-point coordinates are invalid.
   - Coordinate layouts use `2d`, `iso-stacked`, or `iso-rotated` matching [docs/spec/formats/board.md](board.md#coordinates).

---

## 2. Scene Document (`.tkrscn`)

A `.tkrscn` file is the source of truth for one board/scene. When saved, the editor builds the paired `.brd` file (plus auxiliary stamps/tiles if needed). A `.brd` that has no scene is still opened and saved directly; making a scene from it is an explicit conversion ([ADR 0019](../../adr/0019-tkr-authoring-formats.md), amendment of 2026-11-11).

> **Not normative.** The authoritative scene definition is [native-scene.md](native-scene.md). The example below is the earlier draft, kept for context only: its document-level `id`, its `<pack id>:<asset id>` references and its field names are superseded by the scene contract, where a document is identified by its path and a tile or pack is referenced by path plus local ID. Where the two differ, the scene contract governs.

```yaml
contract: scene
version: 1.0.0-pre.1
id: town-square
name: Town Square
projection: 2d       # 2d | iso-stacked | iso-rotated
grid:
  width: 32          # width in tiles
  height: 24         # height in tiles
  tileWidth: 32      # pixels (e.g. 32 for 2d, 64 for iso)
  tileHeight: 32     # pixels (e.g. 32 for 2d, 32 for iso)

atmosphere:
  ambient: [0, 0, 0] # signed [-255..255] RGB offset
  music: Media/town_theme.ogg
  background:
    image: Bitmap/sky_cloud_backdrop.png
    type: normal     # normal (0) | parallax (1) | stretch (2)
    color: [120, 160, 240]

start:
  floor: ground
  x: 512             # board pixels
  y: 384
  layer: 1

floors:
  - id: ground
    title: Ground Floor
    layer: 1
    tiles:
      format: rle    # run-length encoded LUT references: [[count, "ref"], ...]
      runs:
        - [256, "Tiles/village.tst1"]
        - [16, "Tiles/village.tst4"]
    images:
      - id: fountain-backdrop
        source: Bitmap/fountain.png
        x: 320
        y: 240
        transparent: [255, 0, 255]
    boundarySources: # boundary intelligence metadata
      walkableTiles: ["Tiles/village.tst1"]
      autoWallCaps: true
    vectors:
      - id: north-wall
        label: North Wall Boundary
        type: solid  # solid (1) | under (2) | stairs (8) | waypoint (16)
        closed: false
        points:
          - [0, 64]
          - [1024, 64]
      - id: fountain-canopy
        label: Fountain Arch Overhang
        type: under
        attributes: 7 # bit 1: bg, bit 2: lower layers, bit 4: frame intersect
        closed: true
        points:
          - [320, 200]
          - [384, 200]
          - [384, 240]
          - [320, 240]

things:
  - id: chest-village-gold
    kind: chest
    placement: { floor: ground, x: 256, y: 192 }
    fromAsset: medieval-iso-kit:wooden-chest # provenance reference
    contents:
      item: gold
      quantity: 50
    condition: { variable: "chest_opened", value: "0" }
    onOpen:
      setVariable: { variable: "chest_opened", value: "1" }

placedPacks:
  - instanceId: archway-1
    assetId: medieval-iso-kit:stone-archway
    floor: ground
    x: 480
    y: 288
```

---

## 3. Tile Recipe Document (`.tkrtile`)

A `.tkrtile` manages a cohesive tileset palette, including source sheets, non-destructive transformations, procedural 3-plane isometric blocks, and autotile transition sets.

```yaml
contract: tileset
version: 1.0.0-pre.1
id: village-tileset
name: Village Master Tileset
projection: 2d       # 2d | iso-stacked | iso-rotated
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
    transparent: { mode: alpha } # alpha | colorKey: [r, g, b]

tiles:
  - id: grass-main
    name: Meadow Grass
    source: village-sheet
    cell: [0, 0]
    role: floor      # floor | wall | wall-cap | decorative
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
    kitbash:
      - op: cutCorner
        diagonal: north-west
        clearHalf: true

# 3-Plane Isometric Block & Wall Synthesizer (Pikuma 2:1 dimetric projection)
isoBlocks:
  - id: stone-cube
    name: Stone Isometric Cube
    heightPixels: 32
    faces:
      top:   { source: village-sheet, cell: [3, 0], tint: [0, 0, 0] }
      left:  { source: village-sheet, cell: [4, 0], tint: [-24, -24, -24] }
      right: { source: village-sheet, cell: [4, 0], tint: [-56, -56, -56] }
    collision: solid
    wallCapUnder: true

# Procedural Tilesetter-style 8-neighbour autotiling
autotiles:
  - id: water-edge
    name: Water Coast Autotile
    mode: blob-47
    base:   { source: village-sheet, cell: [5, 0] }
    border: { source: village-sheet, cell: [6, 0] }
    innerCorner: { source: village-sheet, cell: [7, 0] }
    exportOrder: t25-canonical

outputBinding:
  target: Tiles/village_auto.tst
  detail: 1
```

---

## 4. Scene Asset & Stamp Pack Document (`.tkrpack`)

A `.tkrpack` groups reusable art assets (props, architectural stamps, whole-room pre-rendered backdrops) along with their ground anchors, collision footprints, and walk-behind overhangs.

```yaml
contract: asset-pack
version: 1.0.0-pre.1
id: medieval-iso-kit
name: Medieval Isometric Props & Architecture
projection: iso-rotated
grid:
  tileWidth: 64
  tileHeight: 32

sources:
  props-atlas:
    file: Bitmap/medieval_props.png
    transparent: { mode: alpha }

assets:
  - id: stone-archway
    name: Stone Archway
    category: Architecture
    kind: stamp      # stamp | prop | backdrop
    anchor:
      x: 64
      y: 96
      snap: iso-diamond-center
    visuals:
      - source: props-atlas
        rect: [0, 0, 128, 112] # [x, y, w, h]
        layerOffset: 0
    vectors:
      - label: Left Pillar
        type: solid
        closed: true
        points:
          - [-48, -8]
          - [-32, 0]
          - [-16, -8]
          - [-32, -16]
      - label: Right Pillar
        type: solid
        closed: true
        points:
          - [16, 8]
          - [32, 16]
          - [48, 8]
          - [32, 0]
      - label: Walk-Under Lintel
        type: under
        attributes: 7 # covers background + lower layers + frame intersection
        closed: true
        points:
          - [-48, -80]
          - [48, -32]
          - [48, -16]
          - [-48, -64]

  - id: wooden-chest
    name: Wooden Chest
    category: Furniture
    kind: prop
    anchor:
      x: 16
      y: 28
      snap: bottom-center
    visuals:
      - source: props-atlas
        rect: [128, 0, 32, 32]
    vectors:
      - label: Chest Footprint
        type: solid
        closed: true
        points:
          - [-14, -10]
          - [14, -10]
          - [14, 0]
          - [-14, 0]
```

---

## 5. Lowering / Build Contract

When the editor saves a `.tkrscn` or builds for test-running:
1. **Tiles & LUT Generation:** Referenced tiles and generated autotile variants compile into local `.tst` / `.iso` files or into the `.brd` tile LUT ([docs/spec/formats/board.md](board.md#dimensions-and-tiles)).
2. **Placed Pack Expansion (`PlaceSceneAsset`):**
   - Each placed stamp, prop or backdrop in `placedPacks` expands its `visuals` into either board image entries or tile cells. Each visual's `layerOffset` applies to its draw layer.
   - The asset's anchor-relative `solid` and `under` vectors are translated to the placement and inserted into the board's vector array. See the [asset-pack contract](native-asset-pack.md#fields).
3. **Boundary Synthesis:** If `boundarySources` is active, the contour tracer executes and emits simplified `WorldVector` solid polylines (open outer loops, closed obstacle holes) and under polygons.
4. **Target Persistence:** The compiled output is saved as a legacy binary `.brd` (minor 4 vector layout) that runtime runners read without modification.
