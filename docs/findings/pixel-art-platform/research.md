# A connected art workspace for Reawakened

**Research and product/UX proposal — 2026-11-13. Not an approved specification, library selection or change to Epic 13.** Related: [13.2 / #1726](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1726).

**Owner decision, 2026-11-13:** build our own integrated art editor with selective reuse of suitable permissively licensed code, libraries and forks. “Our own” means owning the experience and integration, not writing every primitive from scratch. [ADR 0031](../../adr/0031-owned-art-editor-with-permissive-reuse.md) records the accepted direction; candidate selection, detailed UX and expanded feature scope remain open. The investigation below remains the rationale and evidence record.

**Editor-wide platform direction:** let browser capabilities drive the experience. Our own editor need not own or reproduce every layout, control, focus, accessibility, input, canvas or scheduling behavior. Reuse browser facilities and suitable libraries, while keeping the existing document/save and host-service contracts; identical platform behavior across hosts is not the goal. This clarification is recorded in ADR 0031 and is not a runtime-engine change.

## Recommendation in plain terms

Build a shared place to **make artwork, turn it into reusable game assets, and see it where it will be used**. Do not build a miniature Aseprite clone, force everyone into an embedded application, or limit the experience to a separate 32×32 editor for every tile.

The distinctive promise should be: **“Change the art while you can see the game you are making.”** A creator can draw a roof across tile boundaries, repair a seam beside its actual neighbors, make water move, or change a character frame without losing the originating board or asset. People who prefer an external art application should retain a clear handoff path.

The best synthesis is:

- **Aseprite:** coherent pixel drawing, selection and animation workflows.
- **Pixelorama:** a broad toolset, nondestructive effects and tile-aware authoring.
- **Piskel:** a focused browser workspace and short frame-creation path.
- **Pixquare and Resprite:** input designed deliberately for pen and touch, not merely desktop buttons made larger.
- **Novaboard:** discoverable commands, multiple views over one document and explicit interchange warnings.
- **Tilesetter and practical RPG art tutorials:** useful results from small edits and reusable source pieces, rather than requiring everyone to draw an entire tileset from scratch.

These are documented workflow references, not a popularity ranking or proof our design will work. Sources and confidence boundaries appear below.

**The technical recommendation has changed after deeper inspection:** keep Dotting as a baseline, but compare a framework-neutral adaptation against **JollyPixel's pixel-drawing primitives**. Dotting is more self-contained than its component packaging suggests: it owns data, keyboard handling and undo. Our existing framework decision does not admit `preact/compat`. The first gate is therefore document/history integration, not how attractive a blank canvas looks. No candidate has passed that gate. [R4], [L1], [L2], [L3]

## What was investigated, and what was not

Project evidence is pinned to **`3ee9406db5fcc27f0254177885538d9cb49dc83d` on origin/main**. The primary checkout was stale, so this research did not use its planning files as current authority.

The investigation combined three independent research slices—official workflows, original user feedback, modular foundations—with two historical-session consults and a parent review of the current epic, accepted decisions and previous UX studies. Sources were accessed on **2026-11-13**; external documentation without a displayed date is marked undated. Source inspection is not runtime verification.

A public Piskel session was opened in a fresh browser context. Its canvas, frame strip, layers, palette, transform tools and preview were inspected; a mouse gesture changed the drawing canvas. An immediate canvas-image comparison after a keyboard undo was inconclusive and is **not** evidence of correct undo or a Piskel defect. No save/reopen, packaged-host, performance, screen-reader or offline integration experiment was completed. No other art application was run in this investigation.

This is a purposive investigation, not an exhaustive market census. It covers the named products and adjacent tile-making workflows; it does not establish market share, prices, universal artist preferences, or the completeness of every competitor's current build. Public issue reports are evidence of reported needs, not reproduced current bugs.

## 1. What our own earlier conversations already established

The proposed direction is not a new idea detached from the project. The earlier research already asked for a game maker with connected specialist tools, complete capability for beginners and hobbyists, and shorter tile-making workflows. [R1], [R2]

### Keep these distinctions

| Authority | What it means for this proposal |
| --- | --- |
| **Owner-selected problem and direction** | Make common tasks approachable without removing advanced capability; reduce tedious tile/animated-tile creation; preserve independently authorable reusable tilesets. The accepted connected-authoring direction gives us one contextual tileset browser, not a browser per tool. [R1], [R2] |
| **Accepted storage/lifecycle rules** | One authoritative document; view disposal does not discard unsaved work. Native text uses the host's text authority; binary files use the shared document model. Multi-file saves are not atomic. A running game does not change when artwork is edited. [R3] |
| **Accepted native-authoring direction** | The scene, tileset and pack use `.tkr*` YAML; images remain image assets. Legacy boards stay directly editable; conversion is explicit. Selected scene/tileset/pack formats come forward, not every possible native format. [R5] |
| **Existing UX proposals, not completed capabilities** | Sheet-first drawing; shared/local scope; repeat preview; source/generated/used-by navigation; one region-animation source; kitbash recipes; three-face isometric authoring and terrain generation. Some have accepted direction but not approved detailed contracts. [R1], [R6] |
| **Still not approved** | A standalone public art product, rich layered-art document format, arbitrary animation timing, lossless Aseprite interchange, cloud collaboration, or a particular art engine. |

The November 8 notation-party consult recovered the owner's desire for human-readable files without requiring creators to edit text, and the instruction to keep logical documents separate rather than packing everything into one file. The October 20 product/UX consult reinforced complete capability and preserving specialist freedom; it did not select this workspace layout. Historical sessions are context, not a substitute for current decisions. [R1], [R2]

**A necessary correction to the earlier discussion:** current accepted contracts already rule autosave, history and checkpoint-group recovery. Older UX notes that call these entirely open are superseded. What remains unresolved includes retention measurements and specific host limitations. Neither the old proposals nor this report may promise an all-or-nothing project transaction. [R3]

## 2. What we should learn from other tools

The unit of comparison is an artist's task, not the number of icons on a toolbar.

| Reference | Documented strengths to study | Product lesson and caution |
| --- | --- | --- |
| **Aseprite** | Frames/layers/cels, linked cels, tags, onion skin, indexed colors, tileset-backed tilemaps and distinct draw-pixels/draw-tiles modes. [W1], [W2], [W3] | Borrow the coherent mental model. Do not copy its automatic tile deletion/reordering into legacy indexed sets: those indices are references in our games. Main application code is EULA-governed, not generally reusable. [R7], [L6] |
| **Pixelorama** | Frame/layer cel grid, tags, duration multipliers, linked cels, tilemaps, palettes, image effects and nondestructive layer effects. [W4], [W5], [W6], [W7] | A tool can grow deep without every feature being visible at once. Its richer animation/effect model is not evidence our formats can preserve those features. MIT at the application root does not clear every dependency or asset. |
| **Piskel** | Frame thumbnails, layers, browser-native creation and an editable `.piskel` source distinct from flattened exports. Frame hiding affects preview but not save/export. [W8], [W9] | Keep the short drawing-to-animation path, but separate presentation settings from authored output and make save/export differences visible. Not a ready-made shared-document SDK. |
| **Pixilart** | Documented drawing tools, pixel-perfect freehand mode, stamps, animation and community features. [W10] | Fast entry matters. Its community is a different product responsibility; accounts, moderation and a gallery are not prerequisites for our art workspace. |
| **Pixquare** | Floating references, rearrangeable UI, independent preview, pen/touch gestures, tilemap operations and indexed export. [W11], [W12] | Touch changes navigation, picking and undo ergonomics. It does not prove desktop shortcut or assistive-technology support. |
| **Resprite** | View rotation separate from pixel transforms, guides, touch-oriented transform controls and documented file-conversion limits. [W13], [W14], [W15] | Rotation of a view must not secretly rotate saved pixels. Format support needs a preservation report, not just an extension in a chooser. |
| **Novaboard** | Command search with menu entry points, split views sharing one document/undo, adjustable layout and import/export documentation. [W16], [W17] | Make depth discoverable and preserve context. Its import table explicitly says Aseprite tilemap layers open empty; broad compatibility language is not a lossless-round-trip guarantee. These are publisher claims, not our hands-on results. |
| **Tilesetter** | Base and edge sources generate borders; corner overrides and source changes propagate to generated tiles; live source breakdown. [W18] | A useful generator keeps the small editable recipe, explains its output and permits overrides. A generic blob arrangement does not settle our community index mapping. |
| **Practical tile kitbashing** | An RPG Maker tutorial builds useful variants by moving, copying, recoloring and combining existing pieces on a sheet. [W19] | “I need this shelf to fit” is a valuable first job. Reuse and adaptation can lower the barrier without promising automatic art or redistributing the tutorial's art. |
| **LibreSprite** | A separate sprite editor descended from the GPL-era Aseprite. [L7] | A workflow reference, not a code donor under our licence rules. No GPL source was inspected. |

### Distinctions a good interface must preserve

1. **A palette of swatches is not indexed pixel storage.** Changing a swatch does not necessarily recolor existing artwork. Quantizing RGBA to a palette is a third operation. Aseprite documents actual indexed semantics; legacy Toolkit palette details are fixed by our spec. [W2], [R7]
2. **A repeated preview is not a tilemap.** Repetition shows seams; a tilemap places reusable references; terrain painting chooses neighbors. They can share a canvas, not an ambiguous switch.
3. **A frame is not a layer or a cel.** A cel is the artwork at one frame/layer intersection. Reusing one cel and duplicating its pixels have different consequences.
4. **A visual layer is not a board floor.** Art-layer names and controls should not make creators think they changed game collision or placement height.
5. **Previewing a transform is not applying it.** Camera rotation, isometric preview and playback are view state; committing pixel conversion is an edit.
6. **Save source, build game output and export an exchange copy are different actions.** A flattened PNG cannot preserve a timeline or editable layers. [W9], [W15], [W17]

## 3. What artist feedback adds

We reviewed original reports and requests across the Aseprite, Pixelorama and Piskel issue trackers, GDevelop's forum and a Godot Steam discussion. This is a small, self-selected sample spanning 2016–2026. Older reports establish design risks and workarounds, **not current defects**; no prevalence claim is made. Current product documentation was used where available to distinguish missing functionality from hard-to-discover functionality.

| Reported experience | Evidence and age | Implication to investigate—not a validated solution |
| --- | --- | --- |
| Repeated selection/brush switching interrupts animation work; people disagree about preferred wheel/keyboard bindings. | Aseprite #1792 (2018, follow-up 2024) and #1789 (2018–19). One participant appears in both; not two independent respondents. [U1], [U2] | Preserve tool context; offer discoverable commands and adaptable inputs rather than one supposedly universal shortcut scheme. |
| Users instinctively try multi-frame selection; a contributor worries it complicates a simple UI. | Piskel #766 (2017–2026). [U3] | Support structural operations coherently; test progressive disclosure against a dense professional timeline. More features can make the first task worse. |
| “Rotation is missing” can actually mean selection rotation, arbitrary angles, or not finding the existing 90-degree operation. | Piskel #394 (2016, follow-up 2025). [U4] | Name the target and operation: rotate view, selection, layer or whole artwork; always show the result and pixel consequences. |
| Repeating one tile requires a script or copying into another document. | Aseprite #3954 (2023; open when retrieved). Maintainer supplied workarounds. [U5] | A selected-region repeat preview directly serves our seam-repair job. Do not claim the whole app lacks tiling. |
| A project palette and a global palette appear to behave inconsistently. | Pixelorama #1421, version 1.1.8, January 2026; contributor explains intended copy semantics. [U6] | Expose “project copy” versus “shared library” scope before editing. A correct implementation can still have confusing language. |
| Transparency entries in generated palettes are confusing. | Aseprite #5501, October 2025; indexed and RGBA cases differ. [U7] | Keep color, alpha, color key and transparent index distinct, with a truthful preview. |
| Browser-local saved artwork reportedly disappears or reloads with blank frames. | Piskel #1092 (2023) and #976 (2020). Causes not established. [U8], [U9] | Show save location, durability and recovery coverage; verify reopen and backups. These reports do not prove browser eviction or that autosave alone solves loss. |
| A beginner thinks undo is missing after accidentally using a nearby destructive tool; the maintainer supplies the existing shortcut. | Piskel #710, 2017. [U10] | Visible Undo/Redo and clear tool scope are safety features, not toolbar clutter. |
| Pen contact/hover causes unintended navigation; tablet users request gestures. | Pixelorama #1133 (2024–25, particular devices/drivers) and Android discussion #1022 (2024, mixed success reports). [U11], [U12] | Test real pen/touch devices. “Touch supported” does not establish palm rejection, pointer cancellation or accessibility. |
| Some creators want one-click launch of their preferred external editor; another wants the built-in editor improved. | GDevelop external-editor discussion, 2024–26. [U13] | Embedded quick edits and external-editor freedom complement each other. Integration must not become captivity. |
| Historical large-brush lag improved for a later tested build. | Pixelorama #501, 2021–22. [U14] | Use representative sheet/animation stress cases; do not label a current competitor slow from an old open issue. |

The strongest recurring design questions in this sample are **what am I editing, what else will change, can I recover, and can I keep working without repeated setup?** That synthesis agrees with our owner-led problem framing, but it is not a measured ranking of all artists' needs. No firsthand screen-reader or color-vision usability evaluation was retrieved.

## 4. The proposed product: Artwork, not another file-type maze

“Artwork” is a working navigation label, not a product name or a new file extension. It is a shared specialist workspace inside the game-making environment, usable before a board exists and reachable from a board, asset, stance or animation frame.

### Three ways in

- **Make:** New artwork or new reusable tileset; choose an appropriate starting size and projection without imposing 32×32 on every image.
- **Bring:** Import a sheet or supported image; review slicing and transparency before creating outputs.
- **Fix:** Edit the source of an existing tile/frame/prop, with the originating context retained.

The home view should offer these jobs rather than asking a beginner to choose `.tst`, `.tan`, `.tbm` or a storage recipe first. The actual file identity and representation remain visible to people who need them. The selected audience is beginners/hobbyists with access to complete tools, not a simplified product that experts must abandon. [R1], [R2]

### One interaction language, task-specific views

Use the same selection, zoom, pan, palette, preview, undo and source-navigation behaviors across pixel artwork, sheets, frame editing and bitmap glyphs. **Do not force all of them into one universal document or identical toolbar.** A glyph has a fixed monochrome grid; a sheet can span cells; a clip holds picture references; a board has placement and gameplay properties.

A proposed work area has:

- **Context strip:** originating board/asset, source identity, target format, saved/dirty status, and shared-edit scope. An example is “Village sheet · tile 12 · shared · 8 known boards; dynamic uses unknown.” Counts are shown only if the reference index can establish them.
- **Canvas and tool options:** the selected tool's options, not every possible editor mode. Tile-grid overlays do not split a stroke into separate tile-edit dialogs.
- **Assets and color:** reuse the existing contextual browser; distinguish game assets from color swatches in labels. Selecting a brush never paints a board.
- **Inspector:** selection dimensions and numeric edits, source/outputs/uses, supported transforms and capability explanations.
- **Preview:** actual-size artwork, repeated selection, isometric projection where applicable, or board context. Previews say whether they show unsaved artwork or saved game inputs.
- **Optional timeline:** appears for animation tasks; a static tile does not open with a professional cel grid occupying half the screen.

This is arrangement guidance, not a docking decision. Standalone hosts can arrange panels; VS Code uses native groups/views and focused visual editors, not a second embedded workbench. Views share behavior and document authority, not necessarily identical chrome. [R3], [R4]

### The hardest interaction: changing shared artwork

Use a persistent, understandable scope state—not a confirmation dialog for every pixel.

1. From a board placement, **Edit source** opens shared artwork and shows the known impact before the first accepted edit. Read-only neighbors provide context, not additional paint targets.
2. **Make a variant for this use** is a separate, reviewed duplication/relink action. It must explain which reference changes: an entire reusable asset, one board cell, a frame or the current placement. “Make unique” without naming the owner is too vague.
3. A **preview of affected uses** can show authored views; it never mutates a running game. Unknown script-generated references remain explicitly unknown.
4. The shared browser retains its last active editor target when focused, displays that default, and offers explicit **Edit artwork** and **Use as brush** actions through menus and keyboard. No active board means choose a target or explain why the action is unavailable.
5. Canceling duplication/import/conversion before writes changes nothing. If a multi-file operation fails after some files are written, show per-file results and recover through checkpoint groups; do not promise project-wide atomic undo. [R2], [R3]

## 5. Six creator journeys that define the experience

These are proposed walkthroughs, not observed usability results or executable API definitions.

### A. “This shelf is a few pixels too high”

Select the shelf on the board → Edit artwork in context → see the source highlighted and neighbors locked → choose shared edit or a variant for the selected use → move/copy the relevant pixels, with a 1:1 preview → save → return to exactly the prior board selection and camera. A separate Test board action saves required inputs before launching a new run.

**Why it matters:** this helps a non-artist improve a map immediately. It combines the kitbash tutorial's small edits with source scope and reference safety that a generic paint canvas does not provide. [W19], [R2], [R3]

### B. “I want to draw a whole roof”

Create/open a reusable sheet → select a multi-cell region → draw, mirror and fill across its grid boundaries → preview at game size → make a multi-tile brush → place on multiple boards. Fill has an explicit selection/cell/connected-region scope; growing a sheet does not silently renumber legacy slots.

**Why it matters:** a storage cell should not dictate how the artist moves a hand. The sheet remains independent source artwork; the board is not flattened into a bespoke image. Rich sheet/source relationships need a persistence contract before they can be promised. [R1], [R6], [R7]

### C. “Make this water move”
Select an ordered frame strip, or duplicate a drawn frame → adjust only the changing pixels → onion-skin and scrub → inspect first/last seam → show speed and exact target timing → name once → use the animated thumbnail as a brush.

Share the timeline's interaction language across animated tiles and sprite clips, **not their storage semantics**. Legacy `.tan` uses a uniform speed and preserves empty middle frames; legacy `.anm` has its own global delay, frame pictures, keys and sounds. Per-frame durations, tags, linked cels and multi-cell synchronized-region editing need explicit representation/compatibility decisions. The proposed native clip does not already provide a layered-art timeline or per-frame delay. [R7], [R8]

### D. “Bring in this oddly spaced art sheet”

Drop/pick a source → review cell size, margin, gap, origin and optional stagger → preview alpha/color-key interpretation → select cells and review partial-edge padding/skip rules → choose append or explicit overwrite → review destination collisions and known reference impact → write with truthful per-file results. Keep the input source untouched.

Use the same slicing vocabulary for tiles and frame extraction where their semantics match; do not silently reorder files/frames by a guessed convention. A guessed grid is a starting suggestion, not permission to commit. [R6], [R7], [W17]

### E. “Make terrain and isometric pieces without drawing every combination”

Start from authored base/edge textures or top/left/right faces → preview generated borders/block → try them on a scratch layout → adjust source or an explicit override → inspect the exact outputs and mappings before writing.

This carries forward existing owner direction, not a new promise of automatic artwork. Separate **generating terrain art**, **assigning neighbor roles**, and **painting terrain**. Approved community index evidence still gates compatible autotiling. Isometric preview is reversible; permanent conversion is a named, undoable edit. Tall props can remain images with anchors/collision when the accepted format supports them, instead of being forced into diamonds. [R1], [R5], [R6], [W18]

### F. “I draw elsewhere, but want it to work in my game”

Locate the source from its game use → open externally where host capability allows, or export/download a working copy → reimport with a preservation report → inspect before/after → resolve dirty in-editor work without overwriting either version → save and test an identified revision.

Report unsupported layers, tilemaps, tags, alpha or timing before replacing anything. An extension name in an import list is not a promise of lossless interchange: Resprite and Novaboard explicitly document Aseprite tilemap losses. A browser upload/download session is not equivalent to a desktop watched file. [W15], [W17], [U13], [R3]

## 6. What Epic 13 already requires

This traceability keeps a broad product vision from silently replacing delivery scope. It follows the pinned ticket store and plans; it is not a claim that these features are implemented. **All existing acceptance remains in scope.** [R9]

| Epic entries | Existing obligation | Place in the proposed experience |
| --- | --- | --- |
| **13.2, 13.1** | Human-reviewed art reuse evidence; real tile edit/save/reopen/paint proof in both hosts and the P1 integration seam. | Foundation gate and the first connected slice—not permission to skip lifecycle, keyboard or actual runner proof. |
| **13.3 / T-36** | Complete pixel tools, palettes, transforms, import, layering, effects, append and explicit-slot overwrite. | The shared art workspace's pixel toolset. Full detail below. |
| **13.4 / T-37** | Reviewed standard/iso/16-pixel extraction, transparency, origin/offset, blank/partial rules, cancel, padding and batch save. | One truthful import/slicing flow. |
| **13.5 / T-38** | Two-set curation, GPH conversion/import/export, duplicate removal, insert/delete/blank/move/reorder/display width and reference impact. | Curate reusable kits with staged confirmation, not just arrange thumbnails. |
| **13.6 / T-39** | TAN editing, exact frame order/count including empty middle frames, speed, reopen and actual playback. | Animation task with target-specific constraints. |
| **13.7, 13.8 / T-25** | Rights-cleared community samples and approved index mapping; eight-neighbor corner-aware painting with neighbor updates and undo. | Terrain configuration and brush, distinct from a generator. |
| **13.9–13.11** | Enemy, special-move/status and battle-background editors; links, preservation and actual battle-provider loading. | Consumers of shared art/preview/pickers, not replacement screens inside a paint app. |
| **13.12** | Board light/shade editing and explicit conversion/bake. | Board enhancement that may reuse visual tools, not art-layer lighting or a second compositor. |
| **13.13** | Expanded board clipboard with supported selection types, undo/reload and explicit exclusions. | Board selection semantics remain distinct from pixel clipboard. |
| **13.14** | Clean current/whole-board PNG export through shared compositor; indexed at the defined color boundary, no editor overlays. | Export task, not an arbitrary promise to export every editor format. |
| **13.15** | Previewed, explicit board-coordinate and pre-vector upgrades, originals retained, scripts not silently rewritten. | Migration workspace, not artwork transforms. |
| **13.16** | Reviewed formatting/canonical-case/legacy-script migration backed by language tools. | Code workspace; unaffected by the art direction. |
| **13.20 / T-65** | 256 fixed 8×8 monochrome glyphs, pointer/keyboard editing, shared lifecycle, styled preview without changing glyph data, `.fnt` round trip and actual runner use. | A specialized glyph view sharing pixel input/selection primitives where suitable, not the entire art document model. |
| **13.18, 13.19** | Cleanup and full P1 cross-host/runner acceptance, including font use and safety/error paths. | Integration obligations remain; a polished pixel canvas cannot close the epic. |

### T-36: no attractive feature list may hide the awkward requirements

The complete existing pixel-editor obligation includes:

- Pencil, eyedropper, flood fill, eraser, line, outline/filled ellipse and rectangle, replace color; palette bank, RGB picker, DOS 16-color palette, transparent swatch; grid/checkerboard, 1:1 and isometric previews.
- Clear, undo, 90/180/270-degree rotate, flip/mirror, diagonal cut corner, 45-degree skew with wrapping/broken variants, wrap-scroll N/S/E/W and explicit permanent isometric conversion.
- Supported image import with named limitations; overlay another tile with opacity; uniform RGB shade and grayscale.
- Blur, motion blur, blocker/angle/length light-source shadow, texturise and pixel-pattern translucentise.
- Save to a new/existing tileset by append, or overwrite a specific reviewed slot.

An overlay operation is not proof of persistent editable layers. A palette bank is not proof of arbitrary indexed-color editing. A generic library with pencil/fill does not satisfy the specialized effects. These all need specified behavior, preview/cancel and deterministic, reversible command handling; do not silently approximate missing tools or use a new library as a reason to remove them. [R9], [R10]

## 7. Coherent product direction without quietly expanding the epic

| Band | Meaning | Examples and decision needed |
| --- | --- | --- |
| **Deliver the allocated feature set coherently** | Existing acceptance, expressed through shared interactions. | Full T-36; real extraction/curation/TAN; one browser; glyph view; shared lifecycle; board return context; both hosts. No new product ruling needed merely to make the interactions consistent. |
| **Carry existing accepted direction into approved detail** | Direction exists, but implementation and representation are not automatically specified. | Native scene/tileset/pack integration, art-linked collision and walk-behind; determine the exact contract and provider-story ownership before coding. Native-data and P0 stories are dependencies, not absorbed by Epic 13. [R5], [R6] |
| **Propose additional art capabilities explicitly** | Useful opportunities requiring owner-approved scope and, where needed, storage/runtime decisions. | Persistent layered source; multi-cell animated source regions; cel linking/tags/per-frame timing; richer palettes; external art format interchange; reusable nondestructive effect stacks; source recipes and override-rebase policies. |
| **Do not infer a second product** | Broader than the game-authoring problem authorized here. | Social gallery, accounts/moderation, cloud sync/collaboration, marketplace, vector/3D painting suite, a standalone commercial Aseprite competitor. Permitted to discuss later, not presumed commitments. |

Some earlier UX studies describe especially ambitious generator and isometric workflows. Preserve those as design inputs, but map them to their own contracts/tickets instead of claiming 13.3 already funds all of them. Conversely, “keep it small” cannot mean dropping difficult existing T-36 requirements or the rest of Epic 13.

## 8. Storage and integration: the product-critical decisions

### Preserve sources rather than making richer tools destructive

The product needs a truthful separation between **editable source**, **game asset**, and **placement**. A source sheet can yield reusable tiles; a clip references pictures; a scene places tiles/props. Those relationships must remain inspectable without collapsing them into a single mega-file.

Do not choose a new `.tkrart` extension, base64 pixels in YAML, an Aseprite-native source document or a universal layer/animation container as a side effect of this research. The accepted `.tkrtile` is a tileset/recipe contract direction, **not automatic authorization for an arbitrary layered raster-art format**. Decide the needed source content, ownership and round trips against actual use cases first. Keep pixel imagery in appropriate image assets and structured relationships in approved documents. [R5], [R7], [R8]

A source-save/build panel should show what is pending and which output uses which saved source revision. If a build fails, the author must not confuse an updated source with a newly generated game asset. Outside edits to generated boards are handled by the existing hash/import rule, not silently erased. [R3], [R5]

### Identity must survive convenience features

A UI rearrangement is not a legacy tileset reorder. Do not adopt an editor's auto-prune/deduplicate mode as the default for indexed legacy output. “Used in N places” needs a real reference index and must retain unknown dynamic references. A local variant requires explicit copy/relink ownership. Generated assets need traceable source bindings, not ownership guessed from names. [R2], [R5], [R7]

### The saved game stays authoritative for a run

A lightweight artwork preview can show unsaved pixels, clearly labeled. A real board/game test saves required inputs and launches an identified snapshot; later brush strokes do not alter it. Game previews use the established board composition rules, not a paint library's interpretation of game layers and tint. [R3], [R6]

### Safety is per document and per actual host capability

One stroke/fill/transform becomes one accepted, reversible edit; selection, navigation, playback and preview are not edits. View recreation rebuilds from the authoritative document, not a library's surviving canvas. Dirty/external conflicts preserve both versions and only offer safe host-supported actions. Native YAML views cannot keep a competing mutable document next to VS Code's text authority. [R3]

Multi-file operations validate destinations, preview before writing, write in a documented order, and report partial results. Checkpoint-group restore is recovery with per-file outcomes, not atomic commit/rollback. “Nothing can ever be lost” would be an inaccurate promise.

## 9. Reuse investigation: modularity is more than a component export

A reusable foundation must let us control **pixels, edit boundaries, keyboard focus and history**. Source-inspected findings below are candidates for testing, not observed host behavior or production licence clearance.

| Candidate and inspected version | What is genuinely promising | Why it remains gated |
| --- | --- | --- |
| **Dotting** — pinned source `605cd38…`, manifest 2.1.20; npm latest retrieved as 2.1.18 | Pixel/layer access, data replacement, data-change and stroke-end listeners; substantial pixel tools; MIT metadata. [L1], [L2] | React peers; internal undo/redo and key interception; replacing data clears internal history. An internal editor class is still canvas/input-coupled. Framework-free extraction and complete external transaction coverage are unproved. Source/release parity must be resolved. |
| **JollyPixel pixel-draw.renderer** — pinned source `5af0632…` manifest 8.0.0; npm latest retrieved as 7.0.0 | Current docs expose pixel buffer/document, host-bound keys, optional injected history and canvas interaction separately from the optional UI. MIT metadata. [L3], [L4] | Live docs/source are ahead of published latest. Selection/structural edits and injected history still must fit our document authority. Exact dependencies, import side effects, codecs and host packaging need audit. Do not adopt its separate UI/editor runtime wholesale. |
| **react-pixel-art-canvas** — npm 0.0.3, source `afa8d97…` | Small and presentationally headless; MIT metadata; canvas access. [L5] | React-bound; canvas is effectively the document; inspected history uses image snapshots and undo, not a complete external command/redo contract. Alpha README acknowledges history limitations. Less suitable as-is than its small size suggests. |
| **Piskel operations** — source `8624c94…` | Drawing/fill operations are inspectable; interpolation and gesture-end save-state behavior are useful references. Apache-2.0 root. [L8] | Tools depend on application globals/services. Extract selected code only after file/dependency/asset provenance review and explicit fork maintenance accounting. Whole-app embedding is not the default. |
| **Pixelorama operations** — source `6e76284…` | Rich pixel-art behaviors; MIT root; valuable UX and algorithm references. [L9] | Godot/GDScript image/scene/global dependencies mean actual port/extraction work. Its web build does not make a TypeScript component. |
| **Paintn't** — npm 0.2.0, gitHead `a9d468a…` | DOM-free mutable bitmap tools and explicit browser adapter; published metadata declares MIT. [L10] | Required notice/copyright and shipped-asset provenance were not established; pinned root LICENSE lookup failed. Do not describe it as having no licence evidence, or as cleared. History and specialized pixel behavior remain unproved. |

The earlier November 8 shortlist proposed **miniPaint** and **PixelCraft**. Keep the source-checked prior study as a lead, not a selected engine: it explicitly did not verify host/document integration, and it identified pixel-at-a-time undo and sheet-size concerns in PixelCraft's documentation. Neither candidate received a fresh runtime evaluation here. [R11]

**Chosen direction:** build our own integrated editor, selectively reusing suitable components and code under [ADR 0031](../../adr/0031-owned-art-editor-with-permissive-reuse.md). A Dotting adaptation, matching-version JollyPixel primitives and a small host-owned drawing control remain useful comparisons for the foundation, not competing whole-product directions. Prefer the component that needs the least special machinery to obey our existing contract. No component has won: a React compatibility ADR, extraction fork or new dependency tree each has a real cost, and the required integration evidence remains outstanding. [R4]

Permissive root licensing is the beginning: exact copied files, notices, codecs, fonts, icons, palettes and transitive dependencies still need review. Aseprite's main EULA code and LibreSprite's GPL code are not code donors. This research copied no application implementation and installed no art dependency. [L6], [L7]

## 10. Product/UX validation before committing to the larger shape

The next step should not be another blanket “looks good?” approval. It should separate three questions.

### Product rehearsal

Use the shelf, roof, water and odd-sheet journeys with a small set of beginner/hobbyist creators, an experienced pixel artist and someone who already uses an external editor. These are recruitment suggestions, not statistically representative segments.

Observe task completion and assistance, lost context, shared/local misunderstandings, accidental edits, export/save confusion, and whether each person can explain what changed and where it was saved. Compare a focused workspace with a denser timeline/layer layout. Measure actual behavior before setting speed targets; this report invents no numerical usability score or participant success rate.

Ask an external-editor user to complete the same handoff without giving up their chosen tool. A successful embedded editor should reduce friction, not require an artist to change habits for every operation.

### Foundation evidence for 13.2

Within an explicitly authorized isolated evaluation—not a silent production dependency addition—use a pinned artifact/source and prove:

1. Load a fixed rectangular transparent image; draw a fast diagonal stroke, erase, fill and transform; preserve exact dimensions/alpha and one host undo step per accepted gesture.
2. Interleave an external model edit, undo/redo, two views, hide/recreate and reload. No hidden second history, double application or drift.
3. Release outside the canvas, cancel a gesture, lose focus, change active board, and use keyboard/numeric editing. Input may never target an unrelated document.
4. Save/reopen exact pixels and use a saved real tile on a board in both browser and actual VS Code webview. Strict CSP and offline-local assets need real host evidence, not a standalone demo.
5. Record resolved dependency/bundled-asset licences, notices, source patches, package/API parity and fork obligations. Describe unsupported T-36 operations explicitly.
6. Exercise failed save and external conflict with dirty artwork. No clean-state claim without the shared lifecycle's successful write; no unsafe active-editor revert.

A 16×8 control exercises rectangular handling; a 32×32 tile proves the real legacy route; a representative multi-cell sheet examines the proposed product rather than just a toy canvas. They are different evidence needs, not interchangeable benchmarks. Desktop-specific claims additionally require the packaged Electron surface before being advertised.

This report supplies desk-research input only. It does **not** close 13.2: human approval, locked dependency evidence and working host-integration findings are still owed. [R9]

### Storage and scope decision

Before rich layers, source regions, animation phases or interchange are scheduled, decide what must survive reopening, which document owns it, what legacy output can represent, and what export loses. Route accepted scope changes through the existing specs/ADRs and issue-backed tickets. Do not widen Epic 13 merely because an upstream editor supports a feature.

## 11. Strongest objections and open questions

**Why not just use Aseprite externally?** For an experienced artist, that may be the best workflow. Our case is the short path from a game problem to a contextual edit, reusable asset and test—not superiority at every art task. External-editor choice remains part of the proposal. [U13]

**Why not take all of Pixelorama?** It already has much of the desired experience, but a second application runtime, save store, undo stack and UI inside the game editor defeats our shared-authority model unless substantial integration is proved. Selected permissive reuse and inspiration remain possible; the whole app is not rejected on licence alone. [L9], [R3]

**Why not write everything ourselves?** We would own exact semantics, but also all pointer/selection/zoom/raster edge cases and specialized operations. Compare an honest minimal host-owned control, not an artificially enormous “from scratch” alternative. Neither reuse nor in-house wins before proof.

**What could invalidate the workspace proposal?** Creators may prefer a small contextual quick-edit view plus external art tools; a richer timeline may obscure the beginner's first edit; source/variant behavior may be harder than separate files. These are real competing designs to test, not details to gloss over.

Open questions, in decision order:

1. Can the intended source/variant scope be understood before editing without nagging on every stroke?
2. Does a matching-version JollyPixel primitive or Dotting extraction obey our authority/history/input contract at acceptable maintenance cost?
3. Which richer features justify an additional editable-source contract instead of remaining external-tool workflows? What must survive save/reopen?
4. Which cross-file operations can use existing checkpoint recovery, and which proposed conveniences would need a new contract?
5. Can region animation lower faithfully to supported timing, including empty frames and shared placement phases? No arbitrary phase behavior is approved here.
6. Which art interchange formats preserve the exact layers/tags/timing/tiles our creators need, in each direction? Avoid a generic “supports Aseprite” claim.
7. How far can browser/VS Code/desktop external-tool handoff go without pretending the hosts have identical file/launch capabilities?
8. Can keyboard, screen-reader, motor-access and pen workflows use the actual canvas meaningfully? DOM labels and a shortcut list alone do not establish accessibility.

## 12. Source register and re-check guidance

**Evidence strength:** project contracts below are directly read at the pinned revision; external workflow claims are single-publisher documentation, generally medium confidence and not independently runtime-verified; user reports are high confidence that the reports exist, low confidence for prevalence or present-version defects. Foundation conclusions combine pinned source inspection with primary package metadata but are not host proofs. Recommendations are explicitly this report's synthesis.

**Freshness:** recheck exact package/API/version/licence evidence at the next evaluation, before any dependency decision. Recheck living competitor docs and issue outcomes before turning them into acceptance criteria. Historical owner testimony stays dated; current accepted ADR amendments take precedence. No pricing, market-share or benchmark figures are relied on.

### Project sources

| Key | Source and authority |
| --- | --- |
| R1 | [Earlier UX decisions][R1], working record distinguishing owner decisions, proposals and open questions; especially tile-making and reusable kits. |
| R2 | [Connected authoring and tests][R2], owner-approved direction, 2026-11-08; details remain proposals. |
| R3 | [ADR 0022][R3], accepted shared identity/content/lifecycle/save/history contracts, including later amendments. |
| R4 | [ADR 0025][R4], accepted Preact/framework-neutral boundary and explicit non-admission of `preact/compat`. |
| R5 | [ADR 0019][R5], accepted native authoring formats with 2026-11-11 amendment overriding automatic board conversion and old stamp wording. |
| R6 | [Tile-making without the grind][R6] and the linked tile/asset/board architecture study: proposals/dependencies, not code or a fully approved schema. |
| R7 | [Tile format specification][R7], normative compatibility representations, indices, palette and animation. |
| R8 | [Native animation clip][R8], proposed pre-release contract; not authorization for rich raster/layer storage or first-release product scope. |
| R9 | [Epic 13 ticket store][R9] and [inception][R12]; related P0/foundation ownership is not absorbed by the art proposal. |
| R10 | [Editor feature inventory][R10], T-36–39, T-52, T-60–65 and other required tools. |
| R11 | [Prior art reuse study][R11], 2026-11-08 initial shortlist and explicit proof limits. |

Historical-session consults: `01a1b950-36c7-7721-93c8-69dc3c5d0eb2` (notation/editor party) and `01a159d2-9d0f-7498-919b-819ee24dff12` (product/UX party). These are local provenance identifiers, not public transcript links. No private transcript is published here.

### External workflow sources

All accessed 2026-11-13. Publication date **undated** unless noted; these are living official docs, not independent reviews.

| Key | Publisher and source |
| --- | --- |
| W1 | Igara Studio, [Aseprite animation][W1]. |
| W2 | Igara Studio, [Aseprite color modes][W2]. |
| W3 | Igara Studio, [Aseprite tilemap modes][W3]. |
| W4 | Orama Interactive, [Pixelorama timeline][W4]. |
| W5 | Orama Interactive, [Pixelorama tilemaps][W5]. |
| W6 | Orama Interactive, [Pixelorama image effects][W6]. |
| W7 | Orama Interactive, [Pixelorama palettes][W7]. |
| W8 | Piskel project, [frames specification][W8]. |
| W9 | Piskel project, [save/storage][W9] and [export specification][W20]. |
| W10 | Pixilart, [editor features][W10]. |
| W11 | Pixquare, [complete official guide][W11]. |
| W12 | Pixquare, [tilemap operations][W12]. |
| W13 | Fengeon, [Resprite canvas/view controls][W13]. |
| W14 | Fengeon, [Resprite transform][W14]. |
| W15 | Fengeon, [Aseprite interchange limitations][W15]. |
| W16 | Novaboard, [interface/workspace][W16]. |
| W17 | Novaboard, [import/export][W17]; preservation limits matter more than the general compatibility headline. |
| W18 | Tilesetter/Led, [generating tilesets][W18]; page copyright 2020, no publication date established. |
| W19 | RPG Maker official blog, [simple tile edits][W19]; page displays 2021-02-23 and 2026-06-10, original/update distinction unclear. Tutorial, not representative research or permission to reuse its assets. |

### Original user feedback sources

All accessed 2026-11-13; dates/versions and limitations are in section 3. Public discussion links preserve the evidence without reproducing participant handles or private details.

| Key | Publisher/community and original report |
| --- | --- |
| U1 | GitHub/Aseprite, [selection and animation workflow request #1792][U1]. |
| U2 | GitHub/Aseprite, [frame navigation request #1789][U2]. |
| U3 | GitHub/Piskel, [bulk frame operations #766][U3]. |
| U4 | GitHub/Piskel, [rotation workflow #394][U4]. |
| U5 | GitHub/Aseprite, [single-tile repeat #3954][U5]. |
| U6 | GitHub/Pixelorama, [palette scope #1421][U6]. |
| U7 | GitHub/Aseprite, [transparency/palette #5501][U7]. |
| U8 | GitHub/Piskel, [local-save loss report #1092][U8]. |
| U9 | GitHub/Piskel, [blank-frame save report #976][U9]. |
| U10 | GitHub/Piskel, [undo discoverability #710][U10]. |
| U11 | GitHub/Pixelorama, [pen input report #1133][U11]. |
| U12 | GitHub/Pixelorama, [Android input discussion #1022][U12]. |
| U13 | GDevelop forum, [external image editor][U13]; mixed preferences, 2024–26. |
| U14 | GitHub/Pixelorama, [historical brush performance #501][U14]. |

### Foundation and licence sources

All accessed 2026-11-13. Commit/release identifiers below distinguish documentation and inspected source from packages; metadata is not an audit of a shipped dependency tree.

| Key | Evidence |
| --- | --- |
| L1 | Dotting, [pinned component API][L1], source commit `605cd38df35d9360cc90895ca5c7c172e73f3e9b`, 2026-07-30. |
| L2 | Dotting, [pinned editor/history/input][L2], and [npm latest metadata][L11] (2.1.18 at access). |
| L3 | JollyPixel, [pixel draw renderer docs][L3], undated living docs; no claim they match npm latest. |
| L4 | JollyPixel, [pinned source manifest][L4], `5af0632f9ae65a6005861f839adb4e97d22c209f`, 2026-11-13, and [npm latest][L12] (7.0.0). |
| L5 | React Pixel Art Canvas, [pinned drawing source][L5], `afa8d97e5a84a834b51b2e98f742c9a5c36b3afc`, 2025-01-11; [README][L13] alpha/history caveats. |
| L6 | Aseprite, [repository licensing statement][L6], EULA main program and separately licensed modules. |
| L7 | LibreSprite, [repository licence/history][L7], GPLv2; metadata/README only, no GPL implementation read. |
| L8 | Piskel, [pinned drawing tool][L8], `8624c94c0c23555fb3c75f4cf18eaf39c58e794b`, 2026-11-08; root Apache-2.0 not a bundled-asset clearance. |
| L9 | Pixelorama, [pinned drawing base][L9], `6e76284b50d3e2948a423dcb37a96e3897fef3f5`, 2026-11-13; [repository][L14] framework and MIT-root context. |
| L10 | Paintn't, [published metadata][L10], 0.2.0/gitHead `a9d468a7f2a9108fe73dcbaf1d36ec9f7e10584f`; licence-text/notice provenance still unresolved. |

## Key source files

- [Epic 13 inception][R12], [ticket store][R9], [editor feature inventory][R10].
- [Connected authoring][R2], [tile-making proposal][R6], [tile/asset/board architecture][R13].
- [Shared authoring contracts][R3], [framework decision][R4], [native authoring formats][R5], [guardrails][R14].
- [Tiles][R7], [native clip proposal][R8], [prior reuse research][R11].

[R1]: ../../../_bmad-output/initiative-rpgtoolkit-reawakened/research-editor-ux-for-beginners/decisions.md
[R2]: ../../../_bmad-output/initiative-rpgtoolkit-reawakened/ux-connected-editors/connected-authoring-and-tests.md
[R3]: ../../adr/0022-shared-editor-authoring-contracts.md
[R4]: ../../adr/0025-editor-ui-framework-preact-tsx.md
[R5]: ../../adr/0019-tkr-authoring-formats.md
[R6]: ../../../_bmad-output/initiative-rpgtoolkit-reawakened/research-editor-ux-for-beginners/flows/10-tile-making-without-the-grind.md
[R7]: ../../spec/formats/tiles.md
[R8]: ../../spec/formats/native-animation-clip.md
[R9]: ../../../_bmad-output/initiative-rpgtoolkit-reawakened/epic-editor-p1/tickets.toml
[R10]: ../../editor-features.md
[R11]: ../../../_bmad-output/initiative-rpgtoolkit-reawakened/ux-connected-editors/art-editor-reuse.md
[R12]: ../../../_bmad-output/initiative-rpgtoolkit-reawakened/epic-editor-p1/discovery/inception-proposal.md
[R13]: ../../../_bmad-output/initiative-rpgtoolkit-reawakened/research-editor-ux-for-beginners/flows/11-tile-asset-and-board-architecture.md
[R14]: ../../guardrails.md
[W1]: https://www.aseprite.org/docs/animation/
[W2]: https://www.aseprite.org/docs/color-mode/
[W3]: https://www.aseprite.org/docs/tilemap/
[W4]: https://pixelorama.org/user_manual/user_interface/timeline/
[W5]: https://pixelorama.org/user_manual/tilemaps/
[W6]: https://pixelorama.org/user_manual/image_effects/
[W7]: https://pixelorama.org/user_manual/palettes/
[W8]: https://github.com/piskelapp/piskel/blob/master/docs/specs/frames.md
[W9]: https://github.com/piskelapp/piskel/blob/master/docs/specs/save-and-storage.md
[W10]: https://www.pixilart.com/features
[W11]: https://docs.pixquare.art/llms-full.txt
[W12]: https://docs.pixquare.art/timeline-and-layers/layer-operations/tilemap-layers-operations
[W13]: https://resprite.fengeon.com/docs/drawing/canvas
[W14]: https://resprite.fengeon.com/docs/drawing/transform
[W15]: https://resprite.fengeon.com/faq/drawing/ase-file-attributes
[W16]: https://novaboard.app/docs/interface/
[W17]: https://novaboard.app/docs/import-export/
[W18]: https://www.tilesetter.org/docs/generating_tilesets
[W19]: https://www.rpgmakerweb.com/blog/tile-sets-so-simple-anyone-can-do-them
[W20]: https://github.com/piskelapp/piskel/blob/master/docs/specs/export.md
[U1]: https://github.com/aseprite/aseprite/issues/1792
[U2]: https://github.com/aseprite/aseprite/issues/1789
[U3]: https://github.com/piskelapp/piskel/issues/766
[U4]: https://github.com/piskelapp/piskel/issues/394
[U5]: https://github.com/aseprite/aseprite/issues/3954
[U6]: https://github.com/Orama-Interactive/Pixelorama/issues/1421
[U7]: https://github.com/aseprite/aseprite/issues/5501
[U8]: https://github.com/piskelapp/piskel/issues/1092
[U9]: https://github.com/piskelapp/piskel/issues/976
[U10]: https://github.com/piskelapp/piskel/issues/710
[U11]: https://github.com/Orama-Interactive/Pixelorama/issues/1133
[U12]: https://github.com/Orama-Interactive/Pixelorama/discussions/1022
[U13]: https://forum.gdevelop.io/t/external-image-editor/54743
[U14]: https://github.com/Orama-Interactive/Pixelorama/issues/501
[L1]: https://raw.githubusercontent.com/hunkim98/dotting/605cd38df35d9360cc90895ca5c7c172e73f3e9b/src/components/Dotting.tsx
[L2]: https://raw.githubusercontent.com/hunkim98/dotting/605cd38df35d9360cc90895ca5c7c172e73f3e9b/src/components/Canvas/Editor.tsx
[L3]: https://jollypixel.github.io/editor/pixel-draw-renderer/README.html
[L4]: https://raw.githubusercontent.com/JollyPixel/editor/5af0632f9ae65a6005861f839adb4e97d22c209f/packages/pixel-draw-renderer/package.json
[L5]: https://raw.githubusercontent.com/geoffmiller/react-pixel-art-canvas/afa8d97e5a84a834b51b2e98f742c9a5c36b3afc/src/components/DrawingCanvas.tsx
[L6]: https://github.com/aseprite/aseprite
[L7]: https://github.com/LibreSprite/LibreSprite
[L8]: https://raw.githubusercontent.com/piskelapp/piskel/8624c94c0c23555fb3c75f4cf18eaf39c58e794b/src/js/tools/drawing/SimplePen.js
[L9]: https://raw.githubusercontent.com/Orama-Interactive/Pixelorama/6e76284b50d3e2948a423dcb37a96e3897fef3f5/src/Tools/BaseDraw.gd
[L10]: https://registry.npmjs.org/paintnt/latest
[L11]: https://registry.npmjs.org/dotting/latest
[L12]: https://registry.npmjs.org/@jolly-pixel%2fpixel-draw.renderer/latest
[L13]: https://github.com/geoffmiller/react-pixel-art-canvas
[L14]: https://github.com/Orama-Interactive/Pixelorama
