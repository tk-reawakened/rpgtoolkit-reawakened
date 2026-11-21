# Standalone native tile (`.tkrtle`)

**Status:** pre-release terrain cutover contract. Applies with the [retained terrain amendment](../../adr/0019-tkr-authoring-formats.md#amendment-retained-terrain-and-standalone-tiles), not to the current reader. This is a Reawakened source format, not a legacy tile or a runtime input.

A tile says what to draw and how to move around it. It can take a picture from a sheet or play a sequence of pictures. The same fence tile can be painted in several places without drawing its collision and walk-behind polygons again.

## Stamp, identity and fields

The shared [stamp and preservation rules](native-contracts.md#stamp) apply. The extension `.tkrtle` agrees with `contract: tile`, at version `1.0.0-pre.1` in this cutover. Its project-relative path is its only document identity. A tileset member, scene palette entry or manual override refers to the document with `{tile: <path>}`; see [scene references](native-scene.md#resolving-painted-terrain). It does not refer to a local ID in a tileset.

The [tile schema](../schemas/tkr-tile.schema.json) checks the structure of the parsed values. Local ID uniqueness, reference targets, cycle length and source bounds are checked by the reader or project build, not by the schema.

Top-level keys are closed. After the stamp and optional shared `tags` and `metadata`, the core keys in order are:

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | Non-empty display name, not identity. |
| `projection` | yes | `2d`, `iso-stacked` or `iso-rotated`. |
| `role` | yes | `floor`, `wall`, `wall-cap` or `decorative`. It does not imply any game geometry. |
| `visual` | yes | A still sample or a set of cels and a timeline. |
| `solid` | no | Anchor-relative movement barriers. |
| `under` | no | Independent anchor-relative walk-behind polygons. |
| `activationAreas` | no | Named optional program activation outlines, without programs or scene state. |
| `kitbash` | no | Ordered `cutCorner` operations using the existing [tile art operation](native-tileset.md#tiles). |

The shared optional `pluginData` comes last. A tile has no sheet grid or `cellSize`; sample dimensions come from the source rectangle or managed region. There is no `wallCapUnder` switch on a tile. A 2D tile with no `solid` outlines does not block movement; do not infer a full-cell barrier from `role`, visible pixels or walk-behind. A source with an authored full-cell barrier can express that rectangle in `solid`.

## Visual samples

The closed `visual` mapping has `transparent` and exactly one of `sample` (a still tile) or `cels` and `timeline` (animated). `transparent` is `{mode: alpha}` or `{mode: colorKey, color: [r, g, b]}`, with integer channels 0–255.

A sample has exactly one shape:

- `{file, rect}`: an ordinary project-relative raster path and `[x, y, width, height]` source pixels. The offsets are non-negative integers, the dimensions positive integers and the rectangle is wholly inside the decoded source.
- `{source, frame, region}`: a managed artwork source path with stable frame and region IDs. The source resolves that frame and rectangle. Neither a crop nor a generated raster path is stored here. An unavailable source, frame or region is a located build error, never a fallback to a loose file.

A build checks exact target dimensions and pixel representability. It never resizes, quantizes or silently changes visible pixels. Legacy details 1–6 follow the [legacy tile data rules](tiles.md#tile-data); a raised isometric recipe is not made flat by this contract.

## Cels and timing

`cels` is a non-empty list of closed `{id, sample}` mappings. IDs are unique local IDs. All resolved cels have the same size. An unused cel is allowed; it still has a source allocation. The non-empty `timeline.frames` list holds closed `{cel, ms}` mappings: an existing ID and a positive integer duration in milliseconds. Repeated frame references reuse a cel. The cycle repeats in listed order. Optional `timeline.phaseMs` is an integer from zero up to, but not including, the sum of frame durations. Default is zero.

The legacy target can use `.tan` for phase zero and uniform durations of 50, 100, 200, 250, 500 or 1000 ms, subject to the built-scene playback proof. Any other duration or nonzero phase refuses the affected build; it is valid authoring data. The first frame provides the static look. A transparent cel is explicit; the legacy target never invents a blank frame. A tileset rule may require lockstep by verifying identical duration sequences and phase; it does not rewrite a tile's timeline.

## Geometry and program activation

`solid` and `under` use the [pack vector shapes](native-asset-pack.md#fields): `label`, `closed`, `points`, and, for `under` only, the `attributes` mask. In 2D the anchor is the resolved cell's top-left board pixel, and points are logical pixel offsets from it. Build the translated outlines on the cell's floor. An open solid needs two or more points; a closed solid or under polygon needs three or more. Omission and an empty list both produce no vectors of that kind. Collision and walk-behind do not imply each other. An isometric lowering must define and prove its anchor and draw ordering before using this geometry.

An `activationAreas` entry has a unique local `id`, non-empty `label`, boolean `closed` and `points` using the same anchor and minimum point counts. A separate scene binding selects the area and supplies the program and activation options. A tile never stores the program. With no binding the build writes neither a trigger record nor an activation polygon. This is independent of art, collision and walk-behind, and does not change legacy scene-owned trigger slots. Binding placement and ordering are part of the scene contract, not implicit in a tile reference.

```yaml
contract: tile
version: 1.0.0-pre.1
name: Village gate
projection: 2d
role: wall
visual:
  transparent: {mode: alpha}
  sample: {file: art/village.png, rect: [64, 0, 32, 32]}
solid:
  - {label: Crossbar, closed: false, points: [[0, 24], [32, 24]]}
under:
  - {label: Upper gate, closed: true, points: [[0, 0], [32, 0], [32, 24], [0, 24]], attributes: 4}
activationAreas:
  - {id: gate, label: Open gate, closed: true, points: [[4, 20], [28, 20], [28, 32], [4, 32]]}
```
