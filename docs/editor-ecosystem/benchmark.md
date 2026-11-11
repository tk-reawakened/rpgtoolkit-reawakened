# What a rival-class editor ecosystem has

Part of the [editor ecosystem proposal](README.md).

## Evidence status

**Unverified.** This page was written on 2026-11-11 in a session that could not reach `docs.godotengine.org`, `wiki.gdevelop.io` or the RPG Maker help pages. The statements about those tools come from general knowledge of their public documentation, not from pages read and dated for this study. Before any row is used as evidence for a decision, it needs a source link and a read date, as [docs/findings](../findings/native-file-extensions/README.md) does. The row most likely to have drifted is anything about pricing, export targets or licence terms.

Two earlier records in this repository did read sources and are relied on where cited: the [product brief addendum](../../_bmad-output/initiative-rpgtoolkit-reawakened/brief-rpgtoolkit-reawakened/addendum.md) (positioning) and the [native file extension findings](../findings/native-file-extensions/README.md) (how engines name files).

## In plain terms

The three tools are strong in different ways. Godot is strong because **anything can become an editable thing**: define a data type and the inspector edits it, and a plugin can add a dock, an importer or a whole screen. GDevelop is strong because **behaviour is made without code and shared**: events, behaviours and extensions are built inside the editor and published to everyone. RPG Maker is strong because **a role-playing game is already laid out**: a Database with a tab for each thing an RPG has, a map editor, and an event list in plain words.

Our accepted direction already names the blend: RPG Maker's clarity of purpose, VS Code's workspace flexibility and direct visual editing. To *rival* these tools we do not need their feature lists. We need the mechanisms that let those feature lists grow.

## The three tools, by what makes each one work

| | Godot 4 | GDevelop 5 | RPG Maker MZ |
|---|---|---|---|
| Licence and price | MIT, free | MIT core, free; some online services paid | Proprietary, paid |
| Centre of gravity | Scenes made of nodes; resources | Objects, behaviours and event sheets | The Database, the map and event pages |
| How data gets an editor | Any resource type with exported properties is edited in the Inspector | Object and behaviour properties declared by the extension | Fixed Database tabs; plugin parameters declared in annotations become a generated form |
| How it is extended | Editor plugins: docks, main-screen tools, inspector plugins, import plugins, scripts that run in the editor | Extensions made of events inside the editor; a reviewed community list | JavaScript plugins with a Plugin Manager; no way to add a Database tab |
| Files on disk | Text scenes and resources (`.tscn`, `.tres`), one file per thing | One JSON project, optionally split into several files | One JSON file per Database tab, arrays indexed by number |
| Outside assets | An import step per file with saved settings; re-imported when the source changes | Asset store inside the editor; Tiled and LDtk maps through a tilemap object | Fixed sheet layouts by file-name convention |
| Reuse | Scene instancing and inheritance | Custom objects, external layouts, extensions | Copy and paste; common events |
| Running and finding faults | Debugger, profiler, live view of the running scene | Live preview with hot reload, debugger, profiler | Playtest, event test, battle test |
| Sharing with players | Export presets for many platforms | One-click export, including web | Deployment to desktop and web |
| Weak for our audience | General-purpose; nothing is an RPG until you build it | Not built for RPGs | Closed; beginners stall at JavaScript plugins (brief addendum); numbered arrays merge badly (extension findings) |

## The mechanisms, and where we stand

Each row is a mechanism, not a feature. "Planned" names the story or record. "Gap" is what this proposal adds.

| # | Mechanism | Who shows it best | TK Reawakened today | Gap this proposal fills |
|---|---|---|---|---|
| 1 | **Any kind of data can be given an editor** | Godot (resources and the Inspector) | One hand-written document type | Kinds, one document contract, a schema-driven form ([architecture](architecture.md)) |
| 2 | **A home for every game-design thing** | RPG Maker (Database) | Proposed in the UX work (Database area); six separate form stories | One list-and-detail view over any kind |
| 3 | **Composition and reuse** | Godot (instancing), GDevelop (custom objects) | `.tkrpack` scene assets (ADR 0019); actor components (AD-32) | Kinds for packs and actors arrive through the registry; no new mechanism |
| 4 | **The editor can be extended** | Godot (editor plugins) | Data contributions only (ADR 0024, Proposed) | Three levels of editor contribution ([extensions](extensions.md)) |
| 5 | **Outside files come in with settings and can come in again** | Godot (import system) | Legacy import; media conversion (14.11 to 14.14) | An import step with a saved recipe ([architecture](architecture.md#import)) |
| 6 | **Behaviour without code** | GDevelop (events), RPG Maker (event commands) | Planned: visual events (14.1 to 14.3) | Plugin commands appear in the palette (level 0 contributions) |
| 7 | **See it run, and see why it went wrong** | Godot (debugger, live tree) | Planned: launches (11.8), creator tests (11.9), debug adapter (AD-21) | Preview as a service any kind can use; replay from the input log |
| 8 | **Layouts for screens** | Godot (control nodes) | Skins only (14.4); screen layout is a proposal in the plugin-editor study | A screen layout kind ([candidates](document-kinds.md#3-candidate-new-kinds)) |
| 9 | **Files that work with Git and with teams** | Godot (text scenes) | Native contracts designed for it; Git surface planned (11.15) | Nothing new; keep it |
| 10 | **Getting assets and examples** | GDevelop (asset store), Godot (asset library) | Starter kit at project creation (11.10) | Templates and packs as contributions; a hosted library is out of scope here |
| 11 | **One step to a playable build** | GDevelop | Planned: package (12.9), setup (14.6); web and desktop runners exist | Nothing new |
| 12 | **Help where the work is** | RPG Maker (tooltips), GDevelop (in-editor tutorials) | Planned: contextual help (11.11), first-board tutorial (14.8) | Help text is part of every kind and field description |

Rows 1, 2, 4 and 5 are structural: without them, every other row has to be hand-built per editor. They are the core of this proposal. Rows 3 and 8 are new kinds. The rest are already planned and only need to register through the same door.

## What we take and what we leave

| Take | From | Leave | Why |
|---|---|---|---|
| A data type declares its fields and gets a form | Godot | A general scene tree of typed nodes as the model for everything | Our model is the four pillars of AD-32, and an RPG author should meet boards, people and items, not nodes |
| Import with saved settings | Godot | Hidden import caches the author never sees | Imports here are explicit, reviewed operations whose results are ordinary project documents |
| Plugin fields declared as data become a form | RPG Maker's plugin parameters | Annotations in code comments as the declaration | We already have a plain-data plugin definition (ADR 0004, ADR 0024) |
| The Database as one familiar place | RPG Maker | Numbered slots, "change maximum", one file per tab | ADR 0023's identity is a path, and one document per thing merges cleanly |
| Extensions built inside the tool and shared | GDevelop | A second scripting system made of events | RPGCode packages are the extension language (ADR 0008); visual events edit the same text (ADR 0022 D2.3) |
| Live preview | GDevelop | Changing a running game from the editor | ADR 0022 D8.4: a run is a snapshot; restart is explicit |
| Docks, tabs, command palette | VS Code | An extension host that runs arbitrary code by default | Trust line of ADR 0008 |

## Explicit non-goals

To "rival" is not to match. These are outside the proposal, and saying so keeps the scope honest:

* 3D, a physics engine, a shader language or a shader graph. Renderers only replay draw lists (G4).
* A general-purpose engine. The product is for role-playing and adventure games.
* A scripting language other than RPGCode, or a second runtime for visual events.
* A hosted marketplace, accounts or cloud builds.
* Editing another tool's project format in place. Files from other tools are *imported*.
