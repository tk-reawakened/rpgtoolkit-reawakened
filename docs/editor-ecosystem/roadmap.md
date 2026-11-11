# Roadmap and decisions

Part of the [editor ecosystem proposal](README.md). **Proposed.** No ticket, epic or sprint is created or changed by this page. If the owner accepts a phase, its stories are planned through BMAD and published to the GitHub project in the usual way.

## In plain terms

The proposal does not add a big new project in front of the editors. It changes the order of a few things inside the epics that already exist, so that the general parts are built at the moment a second editor needs them. The parts that are truly new (native kinds, importers, plugin contributions) come after the first release, as the ADR 0005 amendment already says.

## The rule for ordering

**Build the general part when the second caller arrives, not the first and not the tenth.** One editor does not show what is general. Ten editors built separately cost ten rewrites. So:

| General part | Its first caller | Its second caller, where it is built |
|---|---|---|
| Kind registry and document contract | The main file (11.2) | The board tracer (12.1) |
| Kind-conformance suite | Main file and board | With lifecycle conformance (11.3) |
| Generated host manifests | The first host story (11.18) | The second kind in VS Code |
| The form | Editor preferences (11.5) | The first Database form (12.5 or 12.6) |
| The Database view | Character (12.5) | Item (12.6) |
| The project index | Pickers and navigation (11.4) | Reference review on rename; "used by" in the Database |
| Contract-first views | The animation editor on `.anm` (12.7) | The native clip in the editor (27.6) |
| Import with a recipe | The tile grabber (13.4) | The animation wizard (12.7), then outside formats |

## Phases

### Phase 0: decide (documents only)

* Rule [ADR 0026](../adr/0026-editors-are-registered-by-document-kind.md).
* Reconcile the native naming records (decision 2 below).
* Add source links and read dates to the [benchmark](benchmark.md#evidence-status), or strike the rows that cannot be sourced.

### Phase 1: the spine, inside epics 11 and 12

* Take the main file's types out of the document interface when 12.1 adds the board document. Register both as kinds.
* Add the kind-conformance table to 11.3.
* Generate the VS Code and file-association entries from the registry.

Cost: a refactor of code that is days old, and one test table. Nothing an author sees changes. **This phase is the only one that is cheaper now than later.**

### Phase 2: shared tools, inside epics 12 and 13

* The form, driven by a schema, used by the character and item editors for their plain fields.
* The Database view over characters, items, enemies, moves and effects.
* The project index, feeding pickers, "used by" and the rename review.
* The animation editor's view written against the animation clip contract, with the `.anm` kind as its first adapter.

After this phase the first release has the same editors the epics promise, built on parts that a new kind can reuse.

### Phase 3: native kinds (after the first release; epic 27)

* The native clip opens in the same animation editor (27.6).
* Scenes, tile recipes and packs (ADR 0019), then the actor and scene contracts (27.7, 27.8).
* The first candidates from the [catalogue](document-kinds.md#3-candidate-new-kinds): project definition, then data tables.
* Explicit, reviewed conversion from a legacy document to its native kind.

### Phase 4: import and contributions

* Importers for outside formats, each behind its G6 check.
* Level 0 and level 1 contributions, proved on the stock battle system and one different example.
* Screen layouts, with the stock menu and battle screens as the first level 2 views that are not canvases we already had.

### Phase 5: opportunities

Replay and step-back from the input log, recorded sessions as tests, string tables, sound sets, timelines, shared templates and packs. Each waits for its admission test.

## New epics this would need

None for phases 0 to 2: the work fits stories that exist or small additions to them. For later phases, three candidate epics, named so they can be discussed:

| Candidate epic | Holds | Depends on |
|---|---|---|
| Import from other tools | The import mechanism for outside formats; Tiled, LDtk, Aseprite and sheet importers | Phase 2; scene and clip contracts |
| Editor contributions | Levels 0 to 2, loading, the missing-plugin behaviour, the different example | ADR 0024 accepted; the trust ruling |
| New native kinds, first set | Project definition, data tables, encounter groups, screen layouts | Epic 27's rulings; subsystem contracts for layouts |

## Decisions asked of the owner

| # | Decision | Recommendation |
|---|---|---|
| 1 | **Accept ADR 0026?** Editors are bound to document kinds through one registry and one document contract, and legacy file types are kinds like any other. | Accept. It costs little now and removes a rewrite later. |
| 2 | **Answered, 2026-11-11.** See below the table. Original question: one naming rule for native files. ADR 0019 (Accepted) uses `.tkrscn`, `.tkrtile`, `.tkrpack` and `schema: tkr-scn/1.0`. ADR 0023 (Proposed) requires three letters after `tkr` and a `contract` and `version` stamp. ADR 0019 also makes `.tkrscn` the board editor's document, while the ADR 0005 amendment keeps `.brd` first-class editable and defers native YAML. | Bring ADR 0019 under ADR 0023 when 0023 is accepted: three-letter codes for tile recipes and packs, the common stamp, and a note that for the first release the board editor's document is the `.brd`, with the scene arriving in phase 3. |
| 3 | **Does the first release ship any native kind?** | **Answered, 2026-11-11:** yes, three, for the scene editor: scene, tile recipes and asset pack. Every other native kind stays deferred. |
| 4 | **Extensions for plugin-defined kinds.** | One shared extension, the stamp names the contract ([extensions, question 1](extensions.md#open-questions)). |
| 5 | **Trust for editor contributions.** Data-only levels load from a project; a view with code is author-installed. | Confirm this as an application of ADR 0008, or ask for a new ADR. |
| 6 | **Which candidate kinds first?** | Project definition, then data tables. Screen layouts when a subsystem contract exists. |
| 7 | **Which outside formats first?** | Sprite sheets and Aseprite for clips, then Tiled for scenes. LDtk after. |
| 8 | **The non-goals.** | Confirm the list in the [benchmark](benchmark.md#explicit-non-goals). |

### Decisions 2 and 3, as answered on 2026-11-11

From the owner's answers on [#1839](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1839), written as amendments to ADR 0005, ADR 0019 and ADR 0023 and approved by the owner on 2026-11-11 by merging [#1843](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/1843).

* A kind code is three or more letters. `.tkrtile` and `.tkrpack` stand. The recommendation in row 2 to rename them is withdrawn.
* Every `.tkr*` document uses the `contract` and `version` stamp.
* The three ADR 0019 formats are drafts and enter the registry with their contract pages.
* The scene editor is one editor written against the scene model. It opens and saves a `.brd` directly, or works on a `.tkrscn` that builds the `.brd`. Converting is explicit.
* Those three formats come forward into the first release.

**Effect on the phases above:** the scene contract (27.8), the tile recipe and asset pack contracts and the scene save path move from phase 3 into the first release, after the board tracer (12.1) and after the text-authority proof on the animation clip (27.6). The re-plan is done: the contracts and their readers and writers are stories 27.8 (re-cut) and 27.11 to 27.14 ([#1846](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1846) to [#1849](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1849)), and the editor work is 12.15 to 12.17 ([#1850](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1850) to [#1852](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1852)).

## Risks

| Risk | What reduces it |
|---|---|
| A general framework built ahead of need | The second-caller rule; no contribution point without a built-in user |
| Generated forms that feel generic | A fixed set of well-made controls; hand-designed editors stay hand-designed |
| The contract-first view hides a real difference between a legacy file and its contract | Each contract page states whether a clean adapter exists; where it does not, the legacy kind keeps its own view |
| Scope: "rival Godot" read as "match Godot" | The non-goals; the admission test |
| The comparison rests on unsourced statements | Phase 0 sources them before they support a decision |
| A second naming convention ships | Decision 2 is settled before any native scene is written |
