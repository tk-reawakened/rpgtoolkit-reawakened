# The editor ecosystem: going beyond the Toolkit 3 file types

* **Status:** Proposal, 2026-11-11. Nothing on these pages is decided. They change no ADR, no specification page and no ticket. The one decision they ask for first is [ADR 0026](../adr/0026-editors-are-registered-by-document-kind.md) (Proposed).
* **Scope:** the editor only. The engine, the RPGCode VM and the runners are not changed by anything here.
* **Starting point:** the editors RPG Toolkit 3.1 shipped, as inventoried in [editor-features.md](../editor-features.md). The legacy source was not opened ([ADR 0006](../adr/0006-clean-room-spec-extraction.md)).
* **Evidence limits:** the review of our own editors was done by reading the code and the planning records on 2026-11-11. The comparison with other tools was written **without network access** to their documentation, so every statement about Godot, GDevelop and RPG Maker is marked unverified ([benchmark](benchmark.md#evidence-status)).

## In plain terms

Today the editor plan is a list of the tools the Toolkit 3 editor had: one tool for each Toolkit 3 file type. That is the right plan for being able to open, edit and save an old game. It is not enough to stand beside Godot, GDevelop and RPG Maker, because those tools are not a fixed list of editors. Each one is a **system for having editors**: a new kind of data gets a form, a place in the project, a preview and a way to be extended, without anyone rebuilding the application.

This proposal gives TK Reawakened that system. It has five parts:

1. **Document kinds.** The editor is organised by *kind of document* (a board, a scene, an animation clip, a screen layout), not by file extension. A Toolkit 3 file type is one kind among others. One registry says, for each kind, how to recognise it, how to open and save it, and which views can edit it.
2. **One document contract.** Every kind opens, edits, undoes and saves through the same small interface, so each host (web, VS Code, desktop) implements the lifecycle once and every new kind works in all three.
3. **Shared tools every kind gets.** A form built from the kind's schema, a list-and-detail "Database" view, a project index that knows what refers to what, pickers, problems, preview and test runs.
4. **New kinds of document.** Things Toolkit 3 files cannot hold: scenes with named floors and reusable pieces, a project definition, screen layouts, data tables, string tables and more. Each is added by its own contract page, never in bulk.
5. **Contributions.** A plugin can add fields, kinds, commands, importers and whole panels through the same registry the built-in editors use.

None of this replaces the five editor epics. It changes **how** their editors are plugged together, so that the fortieth editor costs less than the fourth.

## What stays true

| Rule | Where it comes from | Effect here |
|---|---|---|
| TK Reawakened is its own product, and Toolkit 3 is a compatibility layer | [ADR 0005](../adr/0005-independent-product-v1-and-native-format.md), [ADR 0009](../adr/0009-compatibility-layer-not-the-model.md) | The editor is organised around our kinds; a legacy file is an adapter onto them. |
| The Toolkit 3 formats stay first-class editable, and native YAML documents are not required for the first release | ADR 0005, amendment of 2026-11-09 | The registry must be useful with legacy kinds alone. Native kinds arrive later through the same door. |
| One document per file; the host owns undo and save timing | AD-19, [ADR 0022](../adr/0022-shared-editor-authoring-contracts.md) D1 to D4 | The document contract here is ADR 0022's, made general. It adds no new promise. |
| `editor-ui` reaches the host only through `platform-services` | [G2](../guardrails.md), AD-20 | Kinds and views register in `editor-model` and `editor-ui`. A host holds adapters and chrome only. |
| The core does no I/O and gains no reader by accident | G2, [ADR 0019](../adr/0019-tkr-authoring-formats.md) decision 3 | A new kind is an editor document first. The engine reads it only after its own ADR. |
| Renderers replay draw lists | G4 | Every preview runs the real engine and replays its draw list. No editor draws its own idea of the game. |
| Start from what the creator is trying to do | [editor experience bank](../editor-experience-bank.md) | A new kind needs a creator situation before it gets a contract ([admission test](document-kinds.md#admission-test-for-a-new-kind)). |
| Build only what a real caller needs | [plugin-editor study](../../_bmad-output/initiative-rpgtoolkit-reawakened/research-editor-ux-for-beginners/flows/09-plugin-editors.md) ("avoid a speculative universal UI framework") | Each part below is built by the first story that needs it, and no earlier ([roadmap](roadmap.md)). |

## Reading order

| Page | What it answers |
|---|---|
| [toolkit-3-editors.md](toolkit-3-editors.md) | Start here. Each editor RPG Toolkit 3.1 shipped: what it edited, what held it back, and what it becomes. |
| [current-state.md](current-state.md) | What do the editors consist of today, in code and in plans, and where does the structure stop short? |
| [benchmark.md](benchmark.md) | What do Godot, GDevelop and RPG Maker give an author that our plan does not, and what do we already do better? |
| [architecture.md](architecture.md) | The proposed solution: kinds, the document contract, the shared tools and where each lives in the package graph. |
| [document-kinds.md](document-kinds.md) | The catalogue: legacy kinds, native kinds already in flight, candidate new kinds, files from other tools, and the test a new kind must pass. |
| [extensions.md](extensions.md) | How a plugin adds to the editor, in three levels, and what is still open about trust and hosts. |
| [roadmap.md](roadmap.md) | Phases against the existing epics, the new epics this would need, and the decisions the owner is asked for. |
| [ADR 0026](../adr/0026-editors-are-registered-by-document-kind.md) | The one structural decision, written as a Proposed ADR. |

## Words used on these pages

| Word | Meaning |
|---|---|
| **Kind** | A kind of document the editor can open, such as `board`, `scene` or `animation-clip`. A kind has an identifier, one or more file extensions and a storage class. |
| **Contract** | The logical shape of a kind's data, as [native-contracts.md](../spec/formats/native-contracts.md) uses the word. Two kinds can carry the same contract: the legacy `.anm` and the native `.tkranm` both hold an animation clip. |
| **Storage class** | How a kind is kept on disk and who is the authority for its content: legacy binary, native text, program text, outside asset, or build output ([architecture](architecture.md#storage-classes)). |
| **View** | Something that shows or edits a document: a form, a list-and-detail screen or a specialist canvas. A view never owns the document (ADR 0022 D7). |
| **Contribution** | A plain-data description, with optional view code, that adds kinds, fields, commands, importers or panels to the editor. |
| **Lowering** | Building the files the engine plays from an editor document, as a `.tkrscn` builds a `.brd` (ADR 0019 decision 4). |
