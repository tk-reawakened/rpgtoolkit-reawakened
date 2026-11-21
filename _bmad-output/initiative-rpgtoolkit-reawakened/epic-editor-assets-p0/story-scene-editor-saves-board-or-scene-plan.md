---
type: feature
title: "Import legacy boards as editable native scenes"
ticket: 16
status: ready-for-dev
baseline_revision: 'f79bfb86092d50dd893d6dae7accc4b5e2a6cc03'
route: full
route_source: auto
risk: high
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

- [ ] `packages/editor-model/src`: prepare a review and commit one new native document; cover refusal and bytes changed during review.
- [ ] `packages/editor-ui/src`, `packages/host-web/src`, `packages/host-vscode/src`: connect the same board action to both hosts, including pending-edit refusal and opening the imported scene.
- [ ] `tools/browser/tests`, `tools/editor-vscode-test`: exercise cancel, confirm, the untouched original, and native edit/build authorization in real editors.

Given an authored legacy board in a supported game root, when the author imports it and edits the new scene, then only the explicit replacement build changes the board, and the preceding board remains in history.

## Implementation Notes

## Plan Change Log

- 2026-11-21: owner replaced the two writable adapters with one native authoring path and explicit import.

## Review Triage Log

## Verification

Run focused import and ownership tests, typecheck and scoped lint. Run the real browser editor and packaged VS Code Web journeys before publishing; merge only with the required CI gate.
