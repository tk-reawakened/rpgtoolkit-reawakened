# Extending the editor: contributions

Part of the [editor ecosystem proposal](README.md). **Proposed.** It builds on the three levels of the [plugin-editor study](../../_bmad-output/initiative-rpgtoolkit-reawakened/research-editor-ux-for-beginners/flows/09-plugin-editors.md), which are themselves unapproved, and on [ADR 0024](../adr/0024-plugin-data-contributions.md), which is Proposed. It opens no plugin API. It says what shape that API would have so the built-in editors can be built in that shape now.

## In plain terms

A plugin today can add commands, file decoders and subsystems to the *game*. It can add nothing to the *editor*. An author who installs a battle system gets new rules and no new forms.

A **contribution** is how anything is added to the editor. The built-in editors use it first. That is the test that it is enough, and it means a plugin author later gets the same tools the project itself used.

## Three levels

A plugin author picks the cheapest level that does the job.

| Level | The plugin supplies | The game author gets | Carries code? |
|---|---|---|---|
| **0 Described commands** | For each command: a label, a plain description, typed parameters with units, a picker for each file parameter, an example | The command in code completion, in the quick reference and in the visual event palette | No. Data only |
| **1 Described data** | New fields on existing kinds (ADR 0024's data contribution) and new kinds of its own, each with a schema, labels, defaults, ranges, references and a migration | The fields in the normal form; the new kinds in the Database view; search, "used by", undo and rename with no extra work | No. Data only |
| **2 Specialist view** | A view for work a form cannot do: a battle layout, a formation, a tactical grid | A panel that opens in the normal workspace on a normal document | Yes |

A level 2 view has the same shape as a built-in view, `mount(el, ctx) -> { dispose }` ([ADR 0025](../adr/0025-editor-ui-framework-preact-tsx.md)). It receives a document and the shared tools through `ctx`. It makes edits as commands on the document, so undo, save, history and the three hosts work without the plugin doing anything. It cannot hold the document, write a file or reach a host directly (G2).

## What a contribution can declare

All plain data, except the view of level 2.

| Point | Adds | Used by |
|---|---|---|
| `kinds` | A document kind: identifier, contract, label, description, area, schema, reference rules | The registry ([architecture](architecture.md#layer-1-kinds)) |
| `data` | Fields on an existing native contract, in that plugin's block | ADR 0024, unchanged |
| `fields` | Authoring descriptions for a schema: label, help text, control, unit, group, when a field is shown | The form |
| `commands` | Descriptions of RPGCode commands the plugin registers | Level 0 |
| `views` | A specialist view for a kind | Level 2 |
| `importers` | A reader from an outside format to project documents, with the recipe's settings | [Import](architecture.md#import) |
| `previews` | A fixture and the subsystem to run it through | Preview and run |
| `templates` | A starting document of a kind, or a starter project | New document, new project (11.10) |
| `settings` | Entries in the editor settings catalogue | ADR 0022 D6.5 leaves this open; see below |

Each point is added by the first built-in story that needs it. A point with no built-in user is not built.

## What happens when a plugin is missing

Decided already, and kept:

* Its blocks in native documents are preserved, never reported and never dropped (ADR 0023 decision 12).
* Its fields show as "added by a plugin that is not installed", read-only, with *add the plugin* and *keep the data*.
* A document of a kind only that plugin defines opens as text, or read-only, with the same message.
* Shared fields stay editable only where the unknown data demonstrably survives the save. The [kind-conformance suite](architecture.md#layer-2-the-document-contract) is where that is proved.

## Trust

Nothing here changes the trust line. It applies the one already ruled:

* [ADR 0008](../adr/0008-rpgcode-packages-and-trust-baseline.md) decision 3: a native TypeScript plugin runs with the host's authority and is **author-installed only**. A level 2 view is native code, so the same line covers it: a project file cannot install one.
* Levels 0 and 1 are data with a small fixed vocabulary. A project can carry them and the editor can read them without running anything of the plugin's. A check that needs the plugin's own code is plugin code and falls under the line above.
* In VS Code, contributions read from a project folder are ignored until the workspace is trusted, as ADR 0022 D6.4 already does for risky settings.

Whether this reading is right is for the owner ([roadmap, decision 5](roadmap.md#decisions-asked-of-the-owner)). The plugin-editor study is explicit that a changed trust policy needs its own ADR, and a frame or a worker is not a sandbox.

## The stock editors go first

| Built-in | Level it exercises |
|---|---|
| The stock command library's reference text (11.11) | 0 |
| Character, item, enemy, move and effect forms | 1, for the fields; each keeps its hand-designed layout |
| The stock battle system's extra enemy and move fields | 1, as a data contribution on the actor contracts |
| The board canvas, the pixel editor, the animation strip | 2 |
| The stock menu and battle screen layouts | 2, on the screen layout kind |

The study's advice holds: build what the stock flow and **one deliberately different example** need, and stop. The different example it suggests is a tactical-grid battle system.

## Open questions

1. **Extensions for plugin-defined kinds.** ADR 0023 decision 11 gives each contract one extension from a registry in the spec and in `packages/native-data`. A plugin cannot add a row there. ADR 0024 lists this as open. Options: (a) one shared extension for every plugin-defined document, with the stamp's `contract` naming the kind; (b) a second, project-level registry that a contribution adds rows to; (c) plugin data stays in blocks only and plugins define no documents. Recommendation: (a), because it needs no change to how a host is told about file types, and VS Code cannot register a custom editor for an extension it learns of at run time.
2. **How a host loads a contribution.** Bundled with the editor, installed by the author, or found in the project. Whether `platform-services` needs a surface for it.
3. **Level 2 in VS Code.** A view runs in a webview and the document lives in the extension host (AD-19). The message bridge between them for a plugin's view needs a working proof, and so does the content security policy.
4. **Settings contributions.** ADR 0022 D6.5 does not decide whether plugins add to the settings catalogue.
5. **The schema vocabulary.** ADR 0024 leaves the schema technology open, and the form's field descriptions need the same answer.
6. **Versions.** A contribution is written against a version of the kinds and controls it uses. How that is stated and what an older editor does with a newer contribution is not designed.
