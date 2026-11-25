# ADR 0042 — Project bitmap fonts use the same rendering in the editor and player

* **Status:** Accepted by the owner (Jensen), 2026-11-24
* **Date:** 2026-11-24
* **Context documents:** [Toolkit 2 font format](../spec/formats/legacy/text-formats.md#font-toolkit-2-text), [T-65 Bitmap font editor](../editor-features.md#t-65-bitmap-font-editor), [ADR 0022](0022-shared-editor-authoring-contracts.md), [ADR 0026](0026-editors-are-registered-by-document-kind.md)
* **Tickets:** [#1939](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1939), [#3415](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3415)

## Summary

1. A game can use a bitmap font saved in its `Font` folder. The editor preview draws the same glyphs as the player.
2. Ordinary VS Code Undo and Redo are required. If VS Code refuses a second native Undo or Redo while the first is still running, the user can wait and retry. The owner accepted this limitation for #1939; it remains open as #3415.

## Context

T-65 requires using a saved glyph in a running game. A preview that works only in the editor does not meet that requirement. Toolkit 3.1's lack of a Toolkit 2 `.fnt` reader does not constrain Reawakened's support. The `.fnt` file format and `font()` command are unchanged.

VS Code owns the custom editor's working-copy history and dirty state. In the [verified VS Code build](https://github.com/microsoft/vscode/blob/661626d0e72f97806550790a98fb87116c9db825/src/vs/platform/undoRedo/common/undoRedoService.ts#L1012-L1028), the native command warns and returns without invoking the extension when that resource's history is locked. A fast local callback cannot remove the lock across the [extension-host round trip](https://github.com/microsoft/vscode/blob/661626d0e72f97806550790a98fb87116c9db825/src/vs/workbench/api/browser/mainThreadCustomEditors.ts#L771-L786).

## Decision

1. **Install project fonts.** Approve [project bitmap fonts](../spec/engine/display-input-audio.md#reawakened-project-bitmap-fonts). The engine installs supported Toolkit 2.0 bitmap fonts from the active game's `Font` tree and makes them available to `font()`. Missing or invalid bytes are diagnosed and skipped, not fatal to startup. The preview and player use the same [bitmap font ink](../spec/engine/display-input-audio.md#reawakened-bitmap-font-ink) rule.
2. **Keep native working-copy history.** Ordinary grid and panel Undo/Redo, and native workbench Undo/Redo, use one stack. The owner accepts the [documented retry behavior](../help/bitmap-font.md#saving-and-using-the-font) when overlapping native commands cause VS Code to refuse the second command. This narrows that one acceptance condition only; it is not a fix for or closure of #3415.

## Day-one rules

- Prove the player renders an editor-saved `.fnt` and that the preview and player use the same bitmap rendering. Do not add a separate preview rasterizer or a new on-disk font format.
- Runners use the engine's installed font inventory, including the inventory associated with a captured frame rather than a later game state.
- Prove ordinary keyboard and native history on the same working copy, including close after undoing to saved content. Do not override the global VS Code command or use a second history stack to avoid its lock.

## Consequences

- A project's bitmap lettering remains editable and usable without conversion. Unsupported versions can still be inspected where readable, but do not install at runtime or open for editing.
- A refused overlapping native history action may require a retry. The editor help tells users to wait for the prior action to finish, then invoke the command again. Browser history is unchanged by this VS Code limitation.

## Alternatives rejected

- Preview project bitmap fonts without installing them: the author could make a file that the game cannot use.
- Render the preview separately: the editor could promise ink that the player does not draw.
- Replace the global native command or maintain a second stack: either would break the working copy's ownership of history or affect unrelated editors.

## Deferred

- [#3415](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3415) tracks the remaining native overlap limitation. The story's acceptance of retry does not close it.
