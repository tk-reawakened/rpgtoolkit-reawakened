# ADR 0038 — Every editor action is a registered command

* **Status:** Proposed (2026-11-16). The owner set the direction on 2026-11-16 ("all the actions should also be in the command palette, anything that triggers an action"); acceptance of this record is still the owner's to note.
* **Date:** 2026-11-16
* **Context documents:** [0008](0008-rpgcode-packages-and-trust-baseline.md), [0022](0022-shared-editor-authoring-contracts.md), [0025](0025-editor-ui-framework-preact-tsx.md), [0026](0026-editors-are-registered-by-document-kind.md), [0031](0031-owned-art-editor-with-permissive-reuse.md), [editor-ecosystem/extensions](../editor-ecosystem/extensions.md), the workbench command registry of [#2703](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2703)
* **Does not reopen:** ADR 0008's trust line, ADR 0025's framework choice, ADR 0026's kind registry, or where any one button appears

## In plain terms

Anything you can make the editor do, you can find and run from the command palette. Buttons, menus, right-click menus and keyboard shortcuts are only quick ways to reach those same commands. Because the palette always has them, a panel does not need a row of text buttons to make its actions discoverable: it can show small icons, or leave an action to a menu or a key.

## Context

The workbench has one command registry, `CommandRegistry` in `packages/editor-model/src/commands.ts` (#2703). The application menu and the command palette read it, and it carries an identifier, a category, a label, a shortcut and whether the command is enabled.

Most actions are not in it. The Files panel is an example: of New board, Refresh, Collapse all, Open/Close folder, Rename, Delete and Package game, only New board (`file.newBoard`) is a command. The others exist only as handlers inside `editor-ui/src/files-view.tsx`, so the panel draws each as a full-width text button: removing a button would remove the action. The VS Code host also registers its own `tkr.newBoard` separately from `file.newBoard`, so the same action is written twice.

Without a rule, each new panel adds its own buttons and handlers, the palette falls further behind, and a later tidy-up of any panel has to move code before it can move a button.

## Decision

1. **An action is a command.** Every action a user can trigger in the editor is registered in the `CommandRegistry` with a stable identifier, a category, a label and, where it has one, a shortcut. This includes actions that work on the current selection (such as renaming the selected file) and actions that open a dialog. It does not include direct manipulation on a canvas, such as a single brush stroke, or typing into a field: those are edits, not actions.
2. **Every control calls the command.** A toolbar button, a menu item, a right-click menu item or a key binding calls the registered command by its identifier. No control holds its own copy of the action's code. Enabled or disabled state comes from the command, so the control and the palette always agree.
3. **The palette is the floor, not the only place.** Being in the palette makes an action reachable and searchable. Where its button goes, whether it is an icon or text, and whether it is in a menu are design choices made per panel. A panel may show an action as an icon only once it is a command.
4. **Commands that need a target take it from the workbench.** A command that acts on "the selected file", "the active document" or "the active board" reads that from the workbench state when it runs. A command with nothing to act on is disabled, not hidden, so the palette can explain why.
5. **Hosts reach the same commands.** A host that has its own command system (the VS Code command palette, desktop menus) lists the registry's commands rather than registering a second copy. The identifier is the same in every host.
6. **Plugin commands use the same registry.** When plugin actions are ruled ([extensions](../editor-ecosystem/extensions.md)), they are registered the same way and appear in the same palette. This ADR does not decide how they are loaded or trusted; ADR 0008's trust line still applies.
7. **A check keeps it true.** A test fails when a control in `editor-ui` triggers an action without going through a registered command. The first story that implements this ADR chooses how the check finds controls (for example, a required `command` property on the shared button component).

## What this ADR does not decide

* Where any particular action goes: the Files panel's header icons, a right-click menu on the tree, or a Game/Build menu for Package game and Run. Those are design stories that build on this rule.
* Default key bindings or how a user rebinds them.
* The exact TypeScript shape. The registry may need a plain description, a "when" condition instead of a fixed `disabled` flag, or an argument for the target. The first story that needs each one adds it against a real caller.
* Commands in the game player. This ADR covers the editor only.

## Consequences

**Positive**

* Every action is discoverable and searchable in one place, in every host.
* Panels can be redesigned (icons, menus, right-click menus) without moving any action code.
* One implementation per action: the VS Code host and the browser host cannot drift apart.
* Plugins have one obvious place to add actions.

**Negative, with mitigations**

* *Existing panels need refactoring.* The Files panel and other views move their handlers into commands. This is done panel by panel, starting with the Files panel; the check in decision 7 can start with an allow-list that only shrinks, logged as a rule exception.
* *Selection-based commands depend on shared workbench state.* Decision 4 requires the selected file or active board to be readable by the command, which some views keep privately today. Exposing that state is part of moving each view.
* *The palette can grow long.* Categories and search already exist; a long list is cheaper than a missing action.

## Alternatives considered

* **Keep buttons and add palette entries where someone remembers.** This is the current state. Rejected: the Files panel shows how it ends, with one of seven actions in the palette.
* **Make the palette call the buttons' handlers.** Rejected: the action code stays inside a view, and a host without that view cannot run it.
* **Decide per panel, with no general rule.** Rejected: every panel review would reopen the same question.

## Open questions

* Whether commands that act on a selection should also be offered on the tree row's right-click menu by default, so the menu is generated from the registry rather than written per panel.
* Whether the VS Code host should list every registry command in its own palette, or only those that make sense outside the editor's webview.
