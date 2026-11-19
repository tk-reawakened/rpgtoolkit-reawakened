# Native authoring formats: one connected project

**Status: first-pass design, 2026-11-18.** The owner has chosen the direction: Reawakened owns its authoring formats, imports legacy games explicitly, and can build the runtime assets we already support. This page recommends the shape of that system; it does not register new extensions, approve every field, or claim the import/build path is implemented. Baseline: `56ffdf084a4d61fd1d3b2429ca36c2643f350293`.

The [connected editor mockup](connected-editor/README.md) is the starting experience: open a project, follow a scene's connection to an interaction, its program and its artwork, and edit the thing that owns the data. The mock program editor is not a language/editor specification.

## The format family

| What the creator edits | Native authoring document | What it owns | Initial runtime bridge |
|---|---|---|---|
| The game/project | **`.tkrproj` recommended**, contract `project`; not registered yet | Game settings, entry points, package order, build configuration, Game drawer organization, external-resource presentation | `.gam`, including Reawakened extensions, plus the existing package builder |
| A place | `.tkrscn`, existing pre-release scene contract | Scene settings, ordered placements and interactions, local identities, tile layers, references to definitions and reusable assets | `.brd` and its generated dependencies |
| A reusable tileset | `.tkrtile`, existing draft contract; detailed approval pending | Image-source grids, stable tile IDs, tile meaning, collision/walk-behind intent and generation recipes | `.tst`, `.iso` and associated board data where representable |
| A reusable prop/stamp/backdrop | `.tkrpack`, existing pre-release asset-pack contract | Reusable visual composition, anchors and solid/under vectors | Scene expansion into board records and supported visual assets |
| Editable layered artwork | Source/interchange contract owned by [13.21 / #2320](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2320); no new extension chosen here | Layers, frames, adjustments, recipes and stable regions, persisted by [13.22 / #2321](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2321) | Flattened images/sheets or other supported graphics outputs; source structure stays editable |
| An animation | `.tkranm`, existing pre-release animation-clip contract | Frame references, timing, colour-key behavior and sounds | A separately specified lowering to the existing animation inputs; no builder claimed here |
| Characters, items/NPCs and enemies | Native definition family; exact contracts/extensions selected by [27.7 / #1808](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1808) | Reusable gameplay definitions and appearance references, not scene coordinates | `.tem`, `.itm`, `.ene` through explicit field mappings |
| Moves, effects and battle presentation | Separate semantic definitions; extensions not selected here | Skill/effect behavior and battle-background presentation, linked to other assets | `.spc`, `.ste`, `.bkg` through explicit field mappings |
| Programs | `.prg` source remains source | RPGCode, not a YAML wrapper around code | Existing script pipeline |
| Images, sound and fonts | Standard media files | Actual pixel/audio/font data | Copy or explicitly specified conversion; no blanket media transcode |
| A player save or a distributed game | Not an authoring document family | Runtime progress or a generated distribution | Existing save/package contracts remain separate |

The **[graphics design](native-graphics-authoring.md)** explains why a tileset is more than an image without making its YAML hold every pixel. The **[definition design](native-definition-formats.md)** accounts for the gameplay families without assuming each legacy extension deserves an identical native counterpart.

## One authoritative home

1. **A document owns its friendly name and short description.** A scene owns those of its contained placements, regions and interactions as well. A placement's name can be “Talk to old man” even when its program is shared with other placements.
2. **The project owns organization.** Group membership references assets; it does not duplicate their properties, gameplay references or names. Group changes do not move files.
3. **Programs and standalone media are exceptions.** Their project entries can carry a friendly name and description, because those source formats do not provide our native presentation fields. Do not insert YAML headers into RPGCode or rewrite image/audio/font metadata for the Game drawer.
4. **Plugin data stays with the owning document.** Use the existing top-level, namespaced `pluginData` envelope. Per-placement or per-tile plugin data belongs inside that plugin's block, keyed by the owning document's local identities; this design adds no nested plugin doors.
5. **Generated files are not a second editable source.** Source save and build have distinct results. A successful source save followed by a failed build leaves the saved source intact and reports the build failure; it does not claim the output is current.

### Friendly names are not gameplay names

The recommended common authoring field is `presentation`, containing `friendlyName` and `description`. It is a closed, declared field of each applicable contract, not a plugin namespace and not the reserved, inert `metadata` stamp field. An unset friendly name uses the documented fallback; it never changes identity.

**This is a proposed pre-release contract amendment, not a field accepted by current readers.** Existing display-only `name` fields must be accounted for and migrated into the chosen presentation shape in one contract cutover, without retaining two competing name fields. Existing character names, item descriptions, variable handles and any other game-visible strings keep their gameplay meaning. A friendly-name edit must not rewrite them.

Recommended display fallback: explicit friendly name; otherwise that kind's declared existing display/game name if non-empty; otherwise the filename. Contained elements fall back to their local kind and ID, not a mutable array index. The full filename/path remains available to disambiguate equal friendly names. The contract must define whitespace/empty handling and clearing before the UI writes these fields.

Descriptions appear on hover or keyboard focus on the displayed name, with equivalent screen-reader and touch access. Keep **Friendly name…** separate from **Rename file…**. These rules come from [the metadata direction](editor-project-metadata.md), not from renaming the physical asset whenever its label changes.

## The project document

Recommend one `.tkrproj` at the source-project root. Its directory anchors project-relative asset paths; this replaces the old `.gam` relationship to a Toolkit installation's `Main` folder. Project paths follow [native identity](../spec/formats/native-contracts.md#identity): path plus extension, ASCII case folding for identity, and explicit collision diagnostics. There is no new global UUID system.

A project document is the file the creator opens, **not an embedded database containing all the assets**. A project may refer to legacy assets during conversion; native filenames are not required merely because the root is native.

### Shape to specify

The following is an illustrative design sketch, **not a valid fixture or complete schema**. Field spellings below are recommendations for the project-contract story; existing native readers must not be taught to accept this example by bypassing validation.

```yaml
contract: project
version: 1.0.0-pre.1
presentation:
  friendlyName: Brookvale Adventure
  description: A small game about a village and its visitors.
game:
  title: The Visitor
  startup:
    program: Prg/start.prg
    scene: Scenes/brookvale.tkrscn
    character: Chrs/visitor.tem
packages:
  - stock_menu
  - stock_battle
organization:
  groups:
    - id: village-programs
      category: programs
      name: Village conversations
  membership:
    - asset: Prg/old-man.prg
      group: village-programs
resourcePresentation:
  - asset: Prg/old-man.prg
    friendlyName: Talk to old man
    description: The conversation shared by the village greeting interactions.
build:
  target: legacy-runtime
  outputDirectory: Build
pluginData:
  com.example.weather:
    version: 1.0.0
    data:
      startingSeason: autumn
```

The example weather block is illustrative, not a built-in plugin or proof that a build understands it. `game` groups project configuration; it is not the withdrawn universal `core:` wrapper. The root also needs the existing `.gam` settings not shown in this short example.

### Account for the whole `.gam`, not just startup

The normative input is [main-file.md](../spec/formats/main-file.md), including its version-dependent fields and tagged extensions. The project-contract story supplies a row-by-row disposition ledger:

| Input group | Native treatment to specify |
|---|---|
| Title, startup, runtime-key programs, menu and game-over behavior | Explicit game settings and typed references; preserve execution order and absent/present distinctions |
| Display, movement, pathfinding, physical keys and game speed | Named settings with documented units and compatibility mapping; do not reinterpret a present zero as a default |
| Encounters, enemy skills, custom battle program | Preserve behavior and authored order; replace fixed spare slots only where script/reference analysis proves that safe |
| Menu sounds, cursor and transparency | Media references and exact behavior, not friendly-name strings |
| Native package, audio and input extensions | Preserve all existing Reawakened semantics, package order and independent blocks; do not regress to only the historical `.gam` rows |
| Legacy DLL names | Known capability mappings plus explicit unsupported-plugin diagnostics; retaining a name does not port a DLL |
| Installation paths, ignored settings, reserved fields and trailing bytes | Classify as mapped, preserved compatibility data, or deliberately omitted with a reason; preserve original input for recovery and report unsupported behavior |

The generated runtime `.gam` may contain existing Reawakened extensions. Producing it is **not** a promise that original Toolkit executables can play every native project.

### Organization and resource lifecycle

Recommend flat groups within each existing asset category first: one optional home per asset. Deleting a group returns its members to ungrouped, never deletes assets. This is a design recommendation, not a claim that the earlier discussion settled nesting. Cross-category labels remain a permitted later view, not scheduled scope.

The asset inventory is derived from files and declared references; group membership is not an exhaustive asset manifest. An externally added file remains visible without an entry. Missing/ambiguous membership or presentation targets are reported and retained as unresolved data rather than attached to another file. A supported rename updates known project references through the same reviewed rename operation; an external rename is not inferred from a matching friendly name.

Legacy projects still open without a `.tkrproj`. Creating a native project is explicit. Native project parse errors must not silently create a new project or write defaults over damaged input. Readable legacy resources remain available through their existing path; recovery of an invalid native root is reported separately from gameplay validity.

## Plugin fields: data is not a loader manifest

The ordered package list selects game packages. A document's `pluginData` block stores that plugin's data for that contract; the presence of a block is not an instruction to load arbitrary code. A package's version, a document's contract version and a plugin block's data version are separate things.

Reuse [ADR 0024](../adr/0024-plugin-data-contributions.md): schemas and explicit migrations belong to the plugin contribution, not a copy of a schema registry in each project. Missing plugins leave their blocks intact. Structural checks do not prove that plugin behavior can be built or executed. Required unavailable capabilities block the affected build/run with an explanation; opening and preserving the data is still possible.

**Reference discovery, editor controls and build contributions are not supplied merely by having a JSON Schema.** Those interfaces need an explicit design before generic tools can safely rename an asset hidden in plugin data or lower that data into runtime assets. Until then, preserve opaque blocks, report uncertainty and do not guess that arbitrary strings are references. No rename promise here overrides the current plugin-block preservation contract.

## Import, edit, build: a staged transition

1. **Inventory and report.** Resolve the legacy root and its dependency paths, including documented case rules; distinguish recognized fields, supported plugin capabilities, opaque residue and unsupported behavior. A report is not an assertion that everything is understood.
2. **Import into a separate source destination.** Preserve the originals unchanged. Record source-to-native mappings and compatibility data under a specified import contract. No conversion on open, and no overwriting an existing native project without review.
3. **Edit authoritative source documents.** The root can initially reference untouched legacy assets, programs and media. Convert further families explicitly, updating known references without pretending dynamic RPGCode filenames can all be discovered statically.
4. **Build a selected target.** For unchanged source bytes and build configuration, outputs and reference assignments must be deterministic. Validate the dependency graph, output-path collisions, reference resolution and representability before publishing output. Legacy slot addresses remain observable: stable authoring IDs alone do not permit arbitrary slot reordering.
5. **Run and package the built result.** A build reports the exact source snapshot it represents. Packaging includes required runtime assets/plugin data and excludes editor-only organization, friendly names, history and native source documents under explicit rules. Runtime plugin data must not disappear merely because the source YAML is editor-only.

[ADR 0019](../adr/0019-tkr-authoring-formats.md) currently builds a scene's board beside it on save. A project-owned output directory is the recommendation for the new project pipeline, not permission to silently change that existing path. Its adoption needs the corresponding scene-save, path-resolution and packaging amendment in the implementing contract.

No atomic filesystem transaction is assumed across documents, binary image sources and generated files. Follow [ADR 0022](../adr/0022-shared-editor-authoring-contracts.md): checkpoint/recovery and per-file outcomes, preserving edits when an operation fails. Build publication must distinguish a complete runnable output from a failed partial attempt; browser and VS Code hosts must both support the selected procedure or explain the unavailable operation.

## First connected proof

Use a small authored game, not a wholesale corpus migration: project → Brookvale scene → named interaction → shared `.prg`, with a tile from a named tileset and an ordinary image source. The project root is the first new contract; use the existing scene/tileset contracts rather than inventing replacements.

Acceptance for that vertical slice:

- Import the `.gam`, reopen the native project, edit game title/startup settings and compare the generated game configuration with the legacy decoder's semantic model.
- Change only a friendly name/description: reopen it in both hosts, keep runtime-visible names/references unchanged, and prove runnable output behavior unchanged.
- Move a program into a Game drawer group without moving its file; two interactions sharing it retain their separate scene-owned names.
- Change a tile's source pixels and show the intended consumers changing; fork the source for a local variant and show the unrelated consumer unchanged.
- Preserve colour-key/alpha, tile ordering and script-visible board indices; prove selected boundary cases with importer/build fixtures and the existing headless playback path.
- Keep an absent plugin's block intact; reject an affected build that cannot preserve its required behavior. Unknown legacy bytes remain recoverable.
- Interrupt a multi-file save/build and prove recovery without treating partial output as the latest successful game.

These are future implementation acceptance checks, not tests claimed to have run for this design.

## Delivery and scope

The format set is architecture, not an immediate rewrite of every editor. The next contract work is the project root and common presentation field, with exact field ledgers, schemas, examples and migration rules. Actor-family work remains in [#1808](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1808); tileset choices remain in [#1846](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1846). [#3183](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3183) consumes native ownership rather than designing a permanent duplicate sidecar for every asset.

The first-release and direct-legacy-editing commitments of [ADR 0005](../adr/0005-independent-product-v1-and-native-format.md) remain until explicitly amended for a proved cutover. This direction authorizes design work across the format family; it does not quietly move every native contract into the release or remove existing readers/writers.

## Key source files

- [Main game format](../spec/formats/main-file.md) and [native contracts](../spec/formats/native-contracts.md).
- [Native authoring and lowering](../spec/formats/tkr-authoring.md) and [plugin contributions](../adr/0024-plugin-data-contributions.md).
- [Shared authoring lifecycle](../adr/0022-shared-editor-authoring-contracts.md) and [owned art editor](../adr/0031-owned-art-editor-with-permissive-reuse.md).
