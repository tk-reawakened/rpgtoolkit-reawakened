# Native graphics authoring: images, tiles and scenes

**Status: first-pass design, not a new contract or implementation claim.** This page
separates current pre-release contracts from recommendations and decisions still to be
proved. It accompanies the [format-set overview](native-authoring-format-set.md).
Owner direction for this design is native YAML authoring, explicit legacy import and
generated runtime output; it does not itself amend an ADR or require every legacy file
to be imported. In particular, [ADR 0019](../adr/0019-tkr-authoring-formats.md)
still lets a board without a scene be opened and saved directly; conversion is explicit.
[ADR 0031](../adr/0031-owned-art-editor-with-permissive-reuse.md) accepts an integrated
art editor, not a new layered artwork format.

## What owns what

| Thing | Owns | Does not own |
|---|---|---|
| **Image file** | Actual picture bytes: a sheet, frame, backdrop or other image. One file can serve several consumers. | Tile identity, collision, scene placements or a second YAML copy of pixels. |
| **Tileset document** | Source-image references and grids; projection; locally named tiles and recipes, transparency and collision intent; output binding. | The source image's pixels or the scene using a tile. The detailed [tileset contract](../spec/formats/native-tileset.md) is proposed, pending approval. |
| **Asset pack** | Reusable prop, stamp or backdrop definitions: source crops, anchor and collision/walk-behind geometry. | A particular scene placement. The [asset-pack contract](../spec/formats/native-asset-pack.md) is reviewed, pre-release. |
| **Animation clip** | Ordered frame references, canvas, one delay, optional frame sounds and colour keys. | Placement, looping or the picture bytes. The [clip contract](../spec/formats/native-animation-clip.md) is proposed, pending approval. |
| **Editable artwork source** | Layers, frames, adjustments/recipes and stable regions that must survive reopening. [13.21 / #2320](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2320) specifies storage; [13.22 / #2321](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2321) implements persistence. | A flattened output pretending to preserve editable structure. No new artwork extension is chosen here. |
| **Scene** | Local floors, palette entries, geometry, free-image and pack placements, and scene-specific settings. | Copies of reusable pack definitions or the image sources. The [scene contract](../spec/formats/native-scene.md) is approved, pre-release. |

An image can be used directly, sliced into tiles by a tileset, cropped by a pack, or
referenced as a clip frame. A tile is a reusable **meaningful cell**, not another
image-file type. A pack is useful when artwork and an anchor or geometry must travel
together; an ordinary tile or a plain image does not need a pack. A scene places or
references these things; its own elements remain scene-local. Native documents own
their friendly names/descriptions where their contracts allow them. Project
organization owns the optional user group per asset within its category; a pack asset's
existing `category` is not implicitly that project group. Presentation metadata for
standalone media belongs to the project, not inside the image file. The project
representation and any additions for descriptions require separate design approval.

## Example: one sheet, one tile, one scene

This is a **conceptual excerpt, not a schema or complete scene**. The tileset keys and
reference forms shown follow the current drafts; paths are illustrative. It does not
propose a new extension, project format or animation-frame reference syntax.

```yaml
# tiles/village.tkrtile — excerpt from a tileset document
contract: tileset
version: 1.0.0-pre.1
name: Village
projection: 2d
cellSize: [32, 32]
sources:
  - id: village-sheet
    file: bitmap/village.png
    grid: {width: 32, height: 32, marginX: 0, marginY: 0, gapX: 0, gapY: 0}
    transparent: {mode: alpha}
tiles:
  - id: grass-main
    name: Meadow Grass
    source: village-sheet
    cell: [0, 0]
    role: floor
    collision: walkable
outputBinding: {target: tiles/village-built.tst, detail: 1}
```

A scene palette can contain `{tileset: tiles/village.tkrtile, tile: grass-main}`;
its floor runs address that palette position. A pack placement instead uses a pack
path and pack-local asset ID. Those are explicit references, not copied image data.
The clip contract currently uses a **text** image reference, including the legacy
numbered-tile spelling; it cannot simply take the scene's two-field tile mapping.

## Editing and identity

**Recommendation.** Open the source image in the art workspace and its tileset recipe
in the semantic workspace. The sheet is normal image bytes, not YAML-encoded pixels.
The tileset's path identifies the document; each tile's ID is local to that document,
independent of its display name or source-cell position. Change a name or move a
source cell without treating it as a new tile; an intentional ID or path rename must
update the references that name it. Deleting a referenced tile must surface affected
uses rather than silently redirect them. The current contracts distinguish native
`{tileset, tile}` references from opaque legacy references; the rename tool's nested
scene-reference coverage is an explicit implementation need in the
[scene contract](../spec/formats/native-scene.md#where-references-are).

A legacy `set.tstN` addresses a **1-based output slot**, not a stable native ID.
Reordering or deleting legacy tiles can change existing users' art
([tiles](../spec/formats/tiles.md#editing-model)). A scene's tile palette is a separate,
zero-based lookup table: position 0 is empty, empty slots and duplicate references can
be meaningful, and floor runs refer to its indices. Do not conflate that palette with
the image's colour palette or with the output tileset's numbered slots. Preserve each
legacy slot and reference when importing; allocating output slots for native IDs must
be deterministic and must not silently retarget legacy consumers. The precise mapping
and handling of revisions are a decision below, not an invented existing guarantee.

**Shared edit versus unique copy.** Before changing a shared image or tile recipe,
show the known consumers and disclose when the search cannot establish all uses,
including opaque legacy references and scripts. Editing the sheet changes every
consumer of the affected pixels; editing a reusable tile or pack definition changes
its users. For a local variation, explicitly copy the image and/or definition as
needed and relink only the intended reference. Copying a scene placement alone does
not make its pack art unique. Show the proposed scope before applying; cancellation
must leave existing sources and references intact. External editors remain viable,
but host launch and interchange capabilities vary
([ADR 0031](../adr/0031-owned-art-editor-with-permissive-reuse.md)).

When a layered artwork document generates a PNG/sheet, that raster is a build output,
not another authoritative editable image. **Recommendation:** open the source owner
for normal edits; make an explicit independent copy before editing the raster alone.
Otherwise a later source build could erase that edit. Plain imported images without
a managed source owner remain directly editable. The 13.21 contract must make this
source/output relationship discoverable rather than infer it from matching filenames.

## Pixels, projection and time

- **Image bytes and palette.** Existing images are stored as received; opening or
  importing does not transcode them. The current [image storage policy](../spec/formats/images.md#storage-policy)
  produces PNG for authored/exported images, indexed when there are at most 256
  colours, and does not re-encode JPEG losslessly. Decoding yields straight RGBA;
  a consumer's colour key is applied when it draws, not baked into the image decoder.
  An explicit edit or export must disclose any encoding, palette or colour reduction
  consequences; retain the original where reversibility requires it.
- **Tile detail and projection.** Legacy details distinguish RGB, fixed DOS/EGA
  palette indices, 16- versus 32-pixel source size and isometric detail 150. The
  isometric diamond has an exact 64×32 mask and pixel ordering; ordinary tiles on an
  isometric board follow a different projection rule. Import/build proofs must cover
  these cases, not just a visually plausible square preview
  ([tiles](../spec/formats/tiles.md#tile-data)).
- **Transparency.** A tileset source chooses alpha or an exact RGB colour key; pack
  sources have their own rule. A clip has a clip-level key or a frame override, and a
  scene free image has its own stored key. These belong to their respective consumers;
  preserving pixels alone does not preserve their appearance. Check transparency and
  reserved legacy tile colours when converting to targets without equivalent alpha.
- **Animation.** A clip preserves frame order, one delay in seconds, canvas and
  per-frame sound/key. Legacy `.tan` speed and possibly empty middle frames, and GIF
  pages, disposal and delays, have different representations. Do not silently flatten,
  change speed, drop empty frames or claim GIF-to-clip equivalence; preserve the
  original and report any unrepresentable behavior. The clip's zero-delay behavior and
  GIF page referencing remain open in its contract. See
  [animated tiles](../spec/formats/tiles.md#animated-tile-tan) and
  [GIF](../spec/formats/images.md#gif).

## Save, import and generated output

1. **Import is an explicit, reviewable operation.** Inspect legacy bytes and references,
   present the proposed assets and any losses or refusals before writing. Retain the
   original legacy files as recoverable inputs, including data not represented in the
   native model; do not pretend a native semantic conversion is a byte-for-byte legacy
   round trip. If essential meaning cannot be preserved, refuse conversion rather than
   invent a value. The scene contract has explicit legacy fields and defined refusals;
   equivalent handling for graphics needs its own mapping and proof.
2. **Save the owner of each edit.** Image edits save the image; semantic edits save the
   tileset, pack, clip or scene. Follow host document authority and undo/lifecycle
   contracts; caches and previews are disposable. Unowned native document text,
   comments and unknown `pluginData` blocks must survive as required by
   [native preservation rules](../spec/formats/native-contracts.md#preservation).
   Plugin data stays in the owning document's top-level versioned block, not in a
   per-plugin sidecar; refuse an edit if the writer cannot preserve it. Unknown core
   fields are errors, not a general-purpose opaque extension mechanism.
3. **Multi-file operations are not atomic by assertion.** For a copy-and-relink or
   split save, track each file's intended change and actual success; checkpoint
   recoverable content, report partial completion, and allow an explicit retry or
   recovery. Never claim rollback or all-or-nothing behavior without a host guarantee.
   Detect external changes before replacing a dirty source and keep both versions for
   resolution. If an input is missing, unreadable or a referenced ID is unresolved,
   retain authored references and unrelated data, identify the affected path, and do
   not substitute another asset. Missing plugins preserve their opaque data; they do
   not validate or execute it.
4. **Build from authoring inputs, never from generated outputs as source.** Under the
   present [lowering contract](../spec/formats/tkr-authoring.md#5-lowering--build-contract),
   runtime targets include legacy board and art files. Identical declared inputs and
   build rules should yield identical output bytes and reference mappings; output paths
   must not overwrite source images or native documents. A scene's paired board is a
   generated output: detect outside edits and offer explicit import rather than silently
   overwrite them ([ADR 0019](../adr/0019-tkr-authoring-formats.md)). Apply similarly
   cautious conflict handling to other generated files as a recommendation, not a
   claim that their watch protocol already exists.

## Layered artwork codec investigation — 2026-11-19

**Recommendation, not a selected format or admitted dependency:** retain
[`aseprite-io` 0.1.0](https://registry.npmjs.org/aseprite-io/0.1.0) as an
editor-side `.aseprite` codec candidate, but **do not ship it for editing or untrusted
input until the defects below are fixed and verified**. Creators could continue to use
external tools while the shared editor supplies game-specific context. The package
does not decide how recipes, stable regions, tile semantics, runtime output or
recovery are represented. Story [13.21 / #2320](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2320)
still owns that contract and its approval; [13.22 / #2321](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2321)
still owns the implementation. This investigation does not register an extension
or change the existing image policy.

The exact published package declares MIT and records its Rust predecessor and MIT
attribution; its installed runtime dependency `fflate@0.8.3` declares MIT. A fresh
`npm install --save-exact aseprite-io@0.1.0` resolved those two packages, and
`npm audit signatures` verified two registry signatures. An `npm audit --omit=dev`
found no advisories at the time of the check. This is evidence, not a complete
provenance or security clearance; admission still requires the G6 production
inventory and shipped notices.

Further adversarial checks found four blockers in 0.1.0:

- **Indexed palette edits can disappear:** changing a palette entry in the
  `4f-index-4x4.aseprite` fixture and saving/reopening returned its original
  colour. Tracked in [aseprite-io #9](https://github.com/aljopro/aseprite-io/issues/9);
  fix [PR #12](https://github.com/aljopro/aseprite-io/pull/12) merged. A fixed build
  read the edited colour back, and the file survived an independent LibreSprite 1.3
  open and save with the new entry intact. No release containing the fix is
  published yet.
- **Unbounded decompression for zero-sized cels:** a compressed stream of 8,164
  bytes expanded to 8 MiB despite declared zero dimensions. Other declared
  dimensions can also drive large allocations. Tracked in
  [aseprite-io #10](https://github.com/aljopro/aseprite-io/issues/10).
  Input size alone is not a sufficient decoded-memory limit. An open repair is under
  independent review; the published 0.1.0 remains affected.
- **Pixel edits can disappear on checksum collisions:** editing a one-pixel RGBA cel
  from `[10,10,10,10]` to `[11,8,11,10]` was lost after saving because both byte
  sequences share an Adler-32 checksum and the writer reused the original stream.
  Tracked in [aseprite-io #11](https://github.com/aljopro/aseprite-io/issues/11);
  published 0.1.0 remains affected.
- **Narrow tilemap entries are misread:** an authored 2×2 16-bit tilemap containing
  `[1,2,3,4]` decoded as two 32-bit values, and its masks were not honoured. The
  format documents 8-, 16- and 32-bit tiles. Tracked in
  [aseprite-io #16](https://github.com/aljopro/aseprite-io/issues/16); a wider fix
  is open, and 0.1.0 must not be used to edit narrow-width tilemaps.

Registry signatures establish signed package metadata, not a verified build
attestation. A registry attestation lookup was unsuccessful; do not assume build
provenance from the publish configuration. Assess the exact replacement release
and its notices again after fixes.

A local warm-cache comparison (Node 26.13, five runs) of an authored 100-frame,
four-layer 64×64 RGBA sprite rose from 17.6 ms to 48.0 ms per read and 5.7 ms to
63.1 ms per unchanged write with the open exact-replay repair. Correctness wins over
that regression, but the cost needs a measured, safer design before editor use;
tracked in [aseprite-io #15](https://github.com/aljopro/aseprite-io/issues/15).

In isolated tests of the published package, 19 source-repository sample files
round-tripped byte-for-byte without edits. A layered, 12-frame sample was then edited:
one layer was renamed, the first duration set to 237 ms and one pixel changed;
another cel and the existing animation tags survived. A synthetic unknown chunk
also survived adding a layer. These examples do not prove every feature or all
possible edited files are lossless.

The edited sample opened in Aseprite 1.3.18.6 trial; its command-line listing returned
the renamed layer, two other layers and all three animation tags, and its exported
metadata showed 12 frames and the edited duration. The trial cannot save. Separately,
LibreSprite 1.3 opened and saved the sample, and the package read back the renamed
layer, duration and frame count. This is not an Aseprite save-round-trip proof.

A disposable adapter used the real shared `BinaryDocument` with the project's
in-memory platform service and the published package to open a sample, rename a
layer, undo, redo, save and reopen it. It stored encoded bytes as the model and
reparsed for each edit; it is not an implementation or a performance design. No
actual editor view, web host, VS Code host, external-change handling or failed-write
path was exercised by that experiment. A separate headless Edge package-only probe
created and reopened a two-frame document with a linked cel, layer, tag and pixel;
it did not mount the Reawakened editor.

Before production use, define safe refusal/preservation for unsupported content,
bound resource use for untrusted files, verify actual shared-host history, conflict
and recovery behavior, and test representative edits in an external editor. Keep
authored sources intact and do not silently flatten layers or alter animation.

## Decisions and proof needed before cutover

1. **Native tile IDs versus clip frames.** Scenes use a path plus local tile ID, while
   [clips](../spec/formats/native-animation-clip.md#rules) accept text image references
   such as `village.tst14`. Decide a versioned clip reference representation and a
   migration; prove imported numbered references still select the same pixels after
   tileset changes. Do not put a mapping in today's clip schema.
2. **Stable legacy slot allocation.** The tileset draft says source order drives the
   deterministic build, but [legacy tile indices](../spec/formats/tiles.md#editing-model)
   are observable and a scene may retain legacy references to them. Decide where any
   ID-to-slot mapping is retained, including deletions, gaps and cross-file users;
   prove reorder, rebuild and mixed native/legacy references do not retarget art.
3. **Isometric output and geometry.** The tileset draft requires a `.tst` target yet
   discusses `.iso` output, and its `wallCapUnder` is on `isoBlocks`, while a scene's
   native tile reference selects `tiles` only. Decide target/projection and a reference
   route for generated block variants before promising isometric walk-behind. Prove
   diamond pixels, collision and under geometry against the format contracts; the
   tileset page itself flags exact geometry as needing owner review.
4. **Lossless import boundaries.** The clip drops empty animation slots and has one
   delay; `.tan` can have empty intermediate frames and GIF has page-specific data.
   Tilesets can carry indexed detail and transparency that a converted PNG plus recipe
   may not reproduce. Define mappings and diagnostic/refusal behavior using fixtures;
   keep originals and verify both visible result and behavior, not only YAML equality.
5. **Rich editing persistence.** [13.21 / #2320](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2320)
   already owns the source/interchange contract for layers, frames and recipes, and
   [13.22 / #2321](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2321)
   owns persistent editable artwork. Extend tile/pack contracts where appropriate;
   do not silently replace this planned scope with flattened PNG or invent a rival
   art format here. Define which image files are editable inputs and which are built
   composites, then prove save/reopen, undo and partial multi-file recovery.

## Key source files

- [Tileset contract](../spec/formats/native-tileset.md), [asset-pack contract](../spec/formats/native-asset-pack.md), [scene contract](../spec/formats/native-scene.md).
- [Legacy tile layouts](../spec/formats/tiles.md) and [image storage policy](../spec/formats/images.md).
- [Epic 13 source and persistence owners](../../_bmad-output/initiative-rpgtoolkit-reawakened/epic-editor-p1/tickets.toml).
