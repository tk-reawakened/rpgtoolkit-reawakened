# Painting a world: scene, tile, tileset and tool formats

**Status: owner-approved design direction; proposed wire contracts.** A creator paints a scene with reusable tools and tiles. The scene retains what was painted, including manual details; a build produces the board and graphics the game plays. The owner reviewed this design and agreed to continue from it. The current pre-release specifications and readers still apply until the coordinated cutover. This design does not select an artwork codec or promise compatibility with other editors' formats.

## Four connected documents

| Document | Proposed extension | Owns | Does not own |
|---|---|---|---|
| Scene | `.tkrscn` | Floors, painted terrain regions, direct placements and manual overrides | Reusable terrain definitions or source artwork |
| Tile | `.tkrtle` | One reusable tile's identity, visual source and game-relevant properties | The source artwork's pixels or a particular scene's shape |
| Tileset | `.tkrtst` | A reusable palette of tiles and terrain recipes, including the roles and connections used to choose pieces | The scene's painted region or the editing tool's code |
| Tool | `.tkrtol` | A reusable tool definition and its declared configuration | Executable plugin code or the scene's authored content |

The extensions for tiles and tools are owner direction, not registered formats yet. The existing `.tkrtile` registry and implementation mean a tileset. Replace that pre-release name with `.tkrtst` in a coordinated cutover of the specification, registry, readers, writers, checks, references, packaging and repository fixtures. Do not retain an alias or build a migration tool for the old definition. This is not evidence that all private projects have been inventoried. Do not alter private files without an explicit operation.

The [scene proposal](terrain-scene-contract-proposal.md) describes saved coverage, overrides and cell precedence. The [tile, tileset and tool proposal](tile-tool-contract-proposal.md) describes tile references, terrain rules and declarative tools. Both are draft wire contracts; the approved decisions below take precedence where they differ.

A tile need not imply an image file per tile: several `.tkrtle` definitions may refer to regions in one source sheet. Conversely, one tile may have its own artwork source. An editable artwork source owns layers, frames and pixels; a generated image is not another editable authority. The detailed source contract and interchange rules remain with [story 13.21](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2320).

## Approved cutover decisions

- **Stable output slots.** Give each generated tile or animation cel an explicit 1-based slot within its output tileset. Reordering authoring entries never changes slots. A deleted allocation remains reserved and is emitted as transparent; builds never compact or reuse it automatically.
- **Raised isometric blocks do not block flat terrain.** Keep authored faces and polygons intact. A build that uses a raised block refuses with a located diagnostic until projected artwork, draw order, solid collision and walk-behind are specified and proven on both isometric layouts. Do not flatten or silently drop the block.
- **Artwork references.** A managed sample is `{source, frame, region}`; the project-relative source owns stable frame and region IDs and the crop. A plain raster sample is `{file, rect}`. Reordering source frames does not change references. This approves neither an artwork codec nor the rest of the interchange contract.
- **Programmable placeholders.** A reusable tile or prop may offer a named activation area. The scene binds a program explicitly per placement. An unbound placeholder generates no trigger or activation polygon; clearing its binding leaves artwork, collision and walk-behind unchanged. Imported legacy trigger slots are not subject to this rule.

## The pond

An artist draws a connected water sheet across an animation timeline. A tileset associates named tile pieces with source regions and gives a water terrain the edge, inner-corner, outer-corner and fill roles it needs. In a scene the artist paints a pond, then places a special bank tile by hand. The editor previews the tiles together in motion; building resolves the region into the runtime board and its art dependencies. The source sheet, region, rules and hand-painted tile are still available for later editing.

This example is a design target, not a valid YAML fixture or a claim that the existing builder supports it. The contract must define how source frames map to tile frames, durations, phase, collision and walk-behind, as well as what happens when the target cannot represent the result. It must not equate an animated source sheet with a legacy `.tan` without proving the mapping; that format has a single speed and may contain empty intermediate frames.

### A concrete editing sequence

1. On a 2D scene floor, the artist paints a water region covering grid cells. The scene saves the region's stable identity, floor, terrain reference and coverage.
2. The resolver examines each covered cell and its neighbors using the referenced recipe. A missing corner is a located diagnostic, not an invitation to select unrelated art.
3. The artist places a hand-painted bank at one covered cell. The scene saves the explicit tile separately from the region. At that cell the explicit tile wins over the generated tile.
4. The artist erases water under that bank. The bank remains an explicit placement at the same scene position; the region no longer owns that cell. It is still visible and can be removed or moved deliberately.
5. The artist changes the source sheet. The same tile identities refer to the changed regions; a rebuild is needed before the runtime board is called current.
6. If the rule implementation needed to rebuild is missing, the source remains editable to the extent understood. The affected build fails with a diagnostic; the previous output is not reported as a new successful build.

The sequence specifies the desired ownership and override outcome. It does not yet settle how two generated terrain regions on one floor interact, which legacy slot is assigned to a tile, or how variable frame durations lower to the target.

## Scene: retain intent and hand work

The initial design uses a reshapable tile-grid region on a named floor, referencing a terrain definition by tileset path and stable local identifier. It need not claim that all future shapes are grid masks or that freeform curves exist. A region stores its authored coverage, not just the generated tile selection. Explicit tile placements or overrides are retained separately and take precedence at their positions; regeneration never silently removes them. The editor must make an override visible and offer an explicit way to clear it. When coverage changes, an override stays at its scene position as an explicit placement, even outside the region, until the creator changes or removes it.

Floor order, overlapping regions, erase behavior, direct tile placement and collision consequences require exact precedence rules in the scene contract and examples before implementation. The existing approved pre-release contract stores floor cells as palette-index runs, preserves legacy slots and has no native animated-tile palette entry. It cannot accept these proposed fields as if they already existed. Amend the contract and schema together, with a versioned cutover and test fixtures; do not re-interpret existing tile runs as editable terrain shapes.

## Tiles and terrain recipes

Tile identity must survive moving or editing a region of source artwork. The exact relationship between a standalone tile document and the tileset's currently local tile IDs needs a single explicit reference model: a tile definition must not have two competing authorities. Renames must discover and update every declared reference, while dynamic script references and unknown plugin data cannot be assumed discoverable. A missing or ambiguous source is diagnosed, not substituted.

A terrain recipe maps neighboring terrain conditions to tile choices. Different tools and terrain families may use cardinal neighbors, corner/edge matching or other declared rule models; do not hard-code a universal 47-piece requirement. Rules identify missing patterns, permitted transformations and any weighted variations. Identical declared inputs and a pinned rule implementation must give identical output, including variation choices; changing a rule must not silently make an existing output appear current. The build reports incomplete or unsupported patterns rather than silently inventing a result.

Connected water pieces need a specified shared animation phase and explicit frame timing so seams remain coordinated. Independently animated pieces may use separate phases only when their contract explicitly says how. Time conversion, output-slot allocation, `.tan` generation, isometric geometry and collision/walk-behind lowering must be specified and proven before claiming a complete runtime mapping.

## Tools and plugins

A tool interprets input and applies edits to the scene; it is not the scene's sole source of meaning. A `.tkrtol` is a declarative, versioned tool definition, not executable code. An editor-side implementation, whether built in or supplied by a plugin, performs interactions through the host's editor and document interfaces. The existing runtime plugin catalogue and top-level `pluginData` do not by themselves provide this editor contribution mechanism.

When a tool creates ordinary scene data, that data remains readable without the tool. Plugin-specific data uses the owning document's existing namespaced `pluginData` door, preserved even if the plugin is missing. Missing required build behavior blocks the affected regeneration with a diagnostic; the system must not claim a cached preview is a current build. A preview or last successful output may be displayed only when clearly identified as such and available. A missing optional editing tool does not by itself block an otherwise fully specified build.

Tool identity, capability and version compatibility, the schema for tool definitions, trust, contributions, and host support remain to be specified. A document naming a tool is not permission to install or execute arbitrary code. Preserve source comments and unknown plugin blocks under the shared contract; refuse writes that cannot preserve them.

## Build, imports and verification

A build resolves scene, terrain recipes, tile definitions, artwork and declared rule versions. It reports the exact input state and output freshness, and does not overwrite authored sources. The current accepted contract derives a paired `.brd` from a scene; opening a legacy board without a scene remains supported and conversion remains explicit. A save and a build are separate outcomes, and a multi-file write is not assumed atomic.

The design needs worked tests for: a pond with inner and outer corners; reshaping while preserving an override; connected animated water and independent animation; missing patterns and missing tools; a tile moved in its sheet; deterministic variations; a failed build and unchanged source; and exact legacy output mapping. Include isometric and compatibility cases rather than promising that the pond example proves them.

The [animated board playback check (#3244)](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3244) confirmed the gap at the hydration-to-render boundary: with the authored 5 fps water fixture, composing one hydrated board at ticks 0, 11, 12, 24 and 36 always drew tile 2. Hydrating again at each tick selected tiles 2, 2, 3, 4 and 2. A `.tan` that parses and names the right frames is not evidence that those frames advance on an already-loaded board. The proposal still requires a full playback test before enabling animated lowering.

## References

- [Existing graphics design](native-graphics-authoring.md), [scene contract](../spec/formats/native-scene.md), [tileset contract](../spec/formats/native-tileset.md) and [shared native rules](../spec/formats/native-contracts.md).
- [Animated legacy tiles](../spec/formats/tiles.md#animated-tile-tan), [authoring and lowering](../spec/formats/tkr-authoring.md#5-lowering--build-contract), [plugin data contributions](../adr/0024-plugin-data-contributions.md).
- [Tiled terrain sets](https://doc.mapeditor.org/en/stable/manual/terrain/) and [LDtk auto-layer rules](https://ldtk.io/docs/general/auto-layers/auto-layer-rules/) inform the design; neither is adopted as a file format.
