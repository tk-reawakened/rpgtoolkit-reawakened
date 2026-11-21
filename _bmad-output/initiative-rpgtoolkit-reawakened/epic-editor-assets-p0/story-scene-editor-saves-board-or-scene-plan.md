---
type: feature
title: "Import legacy boards as editable native scenes"
ticket: 16
status: built
baseline_revision: 'f79bfb86092d50dd893d6dae7accc4b5e2a6cc03'
route: full
route_source: auto
risk: high
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
context: ["docs/spec/formats/native-scene.md", "docs/guardrails.md"]
---

# Import legacy boards as editable native scenes

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Two writable scene formats would require duplicate authoring paths. An author needs to move a board into native scene editing without risking the game that already uses it.

**Approach:** Offer **Import as Scene** from the existing board view in both editors. Review the saved board's conversion findings and same-stem destination. Confirming creates and opens only the new scene.

## Boundaries & Constraints

**Always:** Use the existing documented board reader/normalisations and native importer, and the host's shared dialog and open-document mechanisms. Refuse pending board edits, unsafe paths, unreadable/unsupported files and an existing destination, including case variants. Recheck reviewed source bytes and destination before writing. The first scene build over the original board needs separately reviewed replacement with history.

**Never:** Import on open/save/preview/play; implicitly save a dirty board to import it; overwrite the scene or board at import time; claim ownership or rewrite game links; build a second writable board adapter or remove existing transitional board tools.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Review then cancel | Saved board, free destination | Show source, destination and findings. Leave both paths alone. | Cancellation is not an error. |
| Confirm | Saved board unchanged, target still free | Create one same-stem `.tkrscn`, open that tab, preserve the board bytes. | Report if creation fails or if the created scene cannot open. |
| Refuse | Pending edits, bad data, existing target, or source/target changes during review | Write nothing. | Name the reason and affected path; never authorize a replacement. |
| Author | Imported scene and an untouched original board | Native edit and Save, with separate review before overwriting the board. | Declining keeps the board unchanged; confirming uses build history and ownership. |

</frozen-after-approval>

## Code Map

- [`native-scene.md`](../../../docs/spec/formats/native-scene.md#import-from-a-board-to-a-scene) and [ADR 0019](../../../docs/adr/0019-tkr-authoring-formats.md#native-scene-authoring): policy.
- `packages/native-data-import/src/scene.ts`: pure `importBoardToScene` and same-stem naming; reuse rather than adding a converter. `packages/editor-model/src/terrain-scene-conflicts.ts` already handles separate build review.
- `packages/editor-ui/src/board-view.tsx` and `mount.ts`: shared board action. `packages/host-web/src/index.ts` mounts it; `packages/host-vscode/src/custom-editor.ts` and `document-bridge.ts` provide the equivalent webview port. Reuse the host dialog services and existing editor-open commands.

## Tasks & Acceptance

- [x] `packages/editor-model/src`: prepare a review and commit one new native document; cover refusal and bytes changed during review.
- [x] `packages/editor-ui/src`, `packages/host-web/src`, `packages/host-vscode/src`: connect the same board action to both hosts, including pending-edit refusal and opening the imported scene.
- [x] `tools/browser/tests`, `tools/editor-vscode-test`: exercise cancel, confirm, the untouched original, and native edit/build authorization in real editors.

Given an authored legacy board in a supported game root, when the author imports it and edits the new scene, then only the explicit replacement build changes the board, and the preceding board remains in history.

## Implementation Notes

The importer uses the existing board version dispatcher and native YAML writer. The tests exercised canonical case, cancellation, byte-identical source retention, nested pre-vector import, dirty and corrupt source refusal, unsafe paths, and changed source or destination after review. All five passed on Node 24.21.0; the editor-model build and scoped lint passed, and the 17 existing conflict and ownership tests passed.

Both Chromium journeys passed in the production browser editor. Opening a supported board creates nothing; both the board toolbar and the Files action open the imported scene. The pre-vector journey also exercised cancel, edit, first-build refusal, separate authorization, and history with the exact original bytes.

The packaged VS Code Web evidence passed through the required native-scene lane. The Command Palette imports a pre-vector board without opening the legacy editor, and the live board toolbar imports and opens a native scene. The first build's decline leaves the board unchanged; confirmation writes the edit and retains the exact original in history. Four focused VS Code host tests, scoped lint and the extension build passed.

## Plan Change Log

- 2026-11-21: owner replaced the two writable adapters with one native authoring path and explicit import.

## Review Triage Log

| Finding | Verdict | Route and evidence |
|---|---|---|
| Board-toolbar import opened the scene without refreshing Files | low | Patch; both routes now use one refresh and open action. The Chromium toolbar journey verifies the new Files row (#3301). |
| Unsafe-path refusal had no targeted regression test | low | Patch; memory-host test exercises a real out-of-root board and invalid path forms, with no review or writes. |
| The importer does not handle a board at the workspace root | false | The approved path gate requires `Boards/` or `Game/<game>/Boards/`; there is no root-level caller. No dead fallback added. |
| A source first selected closed could open for editing before the write | medium | Patch; the palette callback rechecks whether the board now has a live custom document at every refusal checkpoint (#3302). |
| A dirty native text buffer could be ignored (for example a Toolkit 2 text board) | medium | Patch; the same host text-buffer lookup guards both entry points, with a focused provider refusal test (#3302). |
| Bridge result comment advertised a scene path but the message carries `PlatformResult<void>` | low | Patch; comment describes completion, cancellation and failure without changing the wire shape. |
| The workbench proof could act on the preceding scene’s split webview | low | Patch; close editors through the workbench before the new journey and verify the imported scene changes (#3300). |

## Verification

Run focused import and ownership tests, typecheck and scoped lint. Run the real browser editor and packaged VS Code Web journeys before publishing; merge only with the required CI gate.
