# ADR 0039 — New documents are made from a kind's templates

* **Status:** Proposed (2026-11-16). The owner chose this direction on 2026-11-16 and ruled that a new document is made in the native form by default (decision 4); acceptance of this record is still the owner's to note.
* **Date:** 2026-11-16
* **Context documents:** [0005](0005-independent-product-v1-and-native-format.md), [0009](0009-compatibility-layer-not-the-model.md), [0022](0022-shared-editor-authoring-contracts.md), [0023](0023-native-data-contracts-versioning-identity-and-sidecars.md), [0026](0026-editors-are-registered-by-document-kind.md), 0038 (every editor action is a registered command, proposed on its own branch), [editor-ecosystem/extensions](../editor-ecosystem/extensions.md), [editor-features T-20](../editor-features.md)
* **Does not reopen:** path identity (ADR 0022 D1, ADR 0023), the kind registry (ADR 0026), the trust line (ADR 0008), or what the New board dialog asks (T-20)

## In plain terms

Making a new file is one action for every kind, not one dialog per kind. You choose **what** to make (a board, a tile bitmap, an animation, a kind a plugin adds), then **which starting point** (blank, or a template), answer a few questions, and the editor writes the file and opens it. The questions come from the kind as plain data and are shown as one form, drawn by `editor-ui` in every host (a dialog in the browser and desktop, an editor tab in VS Code), so every host makes the same file from the same answers. Where a kind exists both as a Toolkit 3 file and as our own native document, **New makes the native one**.

## Context

Only boards can be created today, and every part of that is board-only: `board-creation.ts` in `editor-model`, `new-board-view.tsx` in `editor-ui`, the sequential questions of `host-vscode/src/new-board.ts`, the `file.newBoard` palette command, a separate hand-written `tkr.newBoard` in `extensions/editor/package.json`, a "New board…" button in the Files panel and the `board.new.*` preferences. Each further kind would repeat all of it in every host, which ADR 0026 was written to stop.

`DocumentKind` has no notion of creation; its `create` opens a document over bytes already in hand. Three existing records already expect a general answer: ADR 0026 D7 generates "the new-document menu" from the registry; [extensions.md](../editor-ecosystem/extensions.md) lists a `templates` contribution, "a starting document of a kind"; and ADR 0022 lets a link to a missing target offer an explicit create. Wizards (T-61) create several files in one operation, which ADR 0022 records as one checkpoint group.

The VS Code new-board flow already holds the right split: the model decides what is valid and writes the file; the host only asks and shows. Its way of asking, one input box or pick list after another, is tedious once a template has more than a question or two, and cannot show templates side by side or the resulting path as you type.

## Decision

1. **Creating belongs to the kind.** A kind that can be created has a **creation** entry in the registry: a list of **templates**. A kind without one cannot be created from the editor (it is still opened, edited and saved as before).
2. **A template is a starting point with questions.** It has an identifier, a label, a one-sentence description, a list of **parameters** and a `build` function in `editor-model`. `build` is pure: from the answers and read access to the project it returns the **files to create** (path and bytes, one or several) or a located refusal. It writes nothing. Every creatable kind ships a **Blank** template. Other sources of templates are:
   * **an existing document of the kind** (T-20's "from an existing board"), offered by the kind as a template source that lists candidates in the project;
   * **contributed templates** (the `templates` contribution point): a starting document of the kind as plain data, plus the name and folder questions. A contributed template that needs code to build is a level 2 contribution and waits for that to be ruled.
3. **Parameters are plain data from a small fixed vocabulary**: text, file name, whole number with a range and unit, choice, on/off, and a reference to a project file of a given kind. Each has a label, help text in the owner's help-text style, a default and a validation in the model. **One creation form in `editor-ui` renders them in every host**: a dialog in the browser and desktop, and an editor tab (a webview) in VS Code. Hosts place the form; they never validate and never ask the questions one at a time in host-native input boxes. A kind whose questions a form cannot express (a picture to crop, a grid to pick on) may supply a **creation view** with the shape of a level 2 view; it still returns its answers to the same `build`.
4. **New makes the native form by default** (owner ruling, 2026-11-16). Where one contract is carried by a Toolkit 3 kind and a native kind (ADR 0026 decision 6, for example `.anm` and `.tkranm`), New offers the native kind. The Toolkit 3 file is offered as a separate, labelled choice ("Toolkit 3 animation (.anm)") only where its writer exists, for authors who must stay compatible with Toolkit 3. Where a contract has no native kind yet (the board today), New makes the Toolkit 3 file, and switches to native when the native kind is registered.
5. **One creation service.** Every route into creation calls one model function with the kind, the template, the answers, and a target folder and name. The routes are: the New… command, the per-kind commands, a folder's right-click menu (folder filled in), an asset picker's "Create new…" and a missing reference's "create" (kind, folder and name filled in), and wizards. The service:
   * puts the file in the kind's folder of the project layout unless a folder is given, with a unique default name;
   * **never writes over an existing file**, and refuses before writing anything when any target exists;
   * writes all of an operation's files as **one checkpoint group** (ADR 0022), so a multi-file creation is undone as one;
   * returns the created paths, which the host opens. The new document opens **saved and clean**: it has a path from the start, because identity is the path (ADR 0022 D1). There is no untitled document.
6. **Commands, not buttons** (ADR 0038). `file.new` ("New…") asks for the kind, then the template. Each creatable kind also has a generated `file.new.<kind>` ("New Board…", "New Tile Bitmap…") that skips the first question. `file.newBoard` stays as an alias of `file.new.board`. VS Code lists these registry commands and drops its own `tkr.newBoard`. In VS Code each `file.new.<kind>` is also contributed to the `file/newFile` menu, so the kinds appear in VS Code's own File › New File… picker, and to `explorer/context`, so a folder's right-click menu offers them with that folder filled in. The File menu, the Files panel's New menu and VS Code's `contributes.commands` and `menus` entries are generated from the registry (ADR 0026 D7; [#2495](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2495)).
7. **Answers are remembered per kind.** The last answers become the next defaults under `<kind>.new.<parameter>`, and "Ask before creating" is `<kind>.showNewDialog`; with it off, New uses the remembered answers and a unique name without asking. The board's existing `board.new.*` and `board.showNewBoardDialog` keys keep their names and meanings.
8. **The board's New dialog is the first case.** T-20 is moved onto this shape with no change in what it asks, what it writes or what it remembers. In VS Code its one-question-at-a-time flow (`host-vscode/src/new-board.ts`) is replaced by the creation form in an editor tab. Its proofs carry over unchanged; the kind-conformance suite gains one row per creatable kind: Blank builds a file the kind opens, saves unchanged and reopens equal.

## How it looks

* **Browser and desktop:** New… opens one dialog. On the left, the kinds grouped by area (Maps, Art, Characters and items, Scripts); on the right, the selected kind's templates as cards, Blank first. Below, the chosen template's questions as a form, then name and folder, with the resulting file path shown as you type. Create is disabled until the model reports no problem. Choosing a kind from a per-kind command or a folder's menu opens the same dialog with the left column already chosen.
* **VS Code:** the kinds are chosen in VS Code's own File › New File… picker (or the palette, or a folder's right-click menu). The chosen kind opens a **"New <kind>" editor tab** holding the same creation form as the browser: template cards, the questions, name and folder, the resulting path, and Create. Create writes the file and the same tab becomes that document's editor. Closing the tab creates nothing. With "Ask before creating" off, no tab is shown: the file is made from the remembered answers and opened.
* **In context:** right-click a folder → New ▸ (the kinds); an asset picker's last row is "Create new…"; a missing reference offers "Create <name>".

## What this ADR does not decide

* Starter projects (story 11.10). A project template is a different thing from a document template and is decided there.
* A hosted or shared library of templates.
* Untitled, unsaved new documents (create first, name on save). They need an identity rule ADR 0022 does not have; see Alternatives.
* How templates found in a project folder are trusted beyond the existing rule that level 0 and 1 contributions are data, and VS Code ignores them until the workspace is trusted.
* The exact TypeScript shapes. The story that moves T-20 fixes them against that caller.

## Consequences

**Positive**

* A kind becomes creatable in every host by registering templates; no host code per kind.
* Every route (menu, palette, folder, asset picker, missing reference, wizard) makes the same file from the same answers.
* Plugins and projects can add starting points as data, without code.
* Making the native form by default moves new work onto the forward model (ADR 0009) without any conversion on open.

**Negative, with mitigations**

* *A parameter vocabulary can grow into a form framework.* It is kept to the fixed list in decision 3; a kind that needs more uses a creation view instead of a new parameter type.
* *Moving T-20 is a refactor of working code.* Decision 8 keeps its behaviour and keys, and its existing tests are the proof.
* *Native by default means a new animation does not open in Toolkit 3.* The Toolkit 3 choice stays offered and labelled wherever a writer exists.

## Alternatives considered

* **One command and dialog per kind** (the code today). Rejected: the cost is paid per kind per host, and ADR 0026 rejects it for the same reason.
* **Create first, edit afterwards** (an untitled default document that is configured in its own editor and named on first save, as Godot's New Resource or VS Code's untitled files). Not chosen now: it needs an identity for a document with no path, which ADR 0022 D1 and ADR 0023 do not have, and every creation question would first need an edit command (board resize, coordinate change). Worth revisiting for kinds whose questions are all editable later.
* **Templates only, no parameters** (copy a starting file, then edit). Rejected: T-20's size, layers and coordinate system cannot all be changed after creation without loss, so they must be asked first.
* **VS Code input boxes and pick lists, one question at a time** (how New Board works in VS Code today, and this record's first draft). Rejected by the owner on 2026-11-16 as tedious: it hides how many questions remain, cannot show templates or the resulting path together, and is a second rendering of the questions to keep in step with the form. The editor-tab form costs a webview's start-up, which a creation flow can afford.
* **A schema-only form with no creation view.** Rejected for the same reason ADR 0026 rejects a schema-only editor: some kinds start from direct manipulation.

## Owner input

* 2026-11-16: "native form should be made by default" (decision 4), and the direction to go with the recommended shape (decisions 1 to 8).
* 2026-11-16: in VS Code, the questions are a form in an editor tab rather than one input box after another ("asking the questions one by one seems tedious"; decision 3 and How it looks).
