---
type: feature
title: "Edit and preview interface skins"
ticket: 4
status: ready-for-dev
risk: medium
---

# Edit and preview interface skins

## Scope

The authoring document is **Native Skin** (`.tkrskin`, `contract: skin`), defined by [native-skin.md](../../../docs/spec/formats/native-skin.md). The extension is available in the native registry; the common native-document rules govern its YAML stamp, version, path identity and preservation. The document owns required `windowImage` and `buttonImage` project-image references plus an optional `label`.

Implement a shared editor with independent window-graphic and button-graphic asset pickers and a preview that shows the actual selected images. Label it **“Preview only: the engine does not use skins yet”**; do not imply a composed game layout or gameplay effect. Keep legacy `.gam` rows 35 (`skinButton`) and 36 (`skinWindow`) unchanged. Preserve the native skin's version, comments and unowned YAML residue; choosing and previewing are not edits, and failed saves keep the draft.

## Acceptance and verification

- The browser and VS Code hosts open the same registered `.tkrskin` document through the shared workspace/editor.
- Each role has its own accessible picker, current reference, and exact-image preview with useful alternate text; unavailable or undecodable images are described honestly.
- Editing each reference is undoable; picker cancellation and preview leave the document unchanged. Save and reopen retain both references, optional label, version, and comments/unowned content.
- A failed save leaves the in-memory edits visible and dirty. Opening and saving the skin leaves the `.gam` bytes, including both legacy skin fields, unchanged.
- In both real hosts demonstrate open, edit, undo, save, reopen, visible selected images, and a failed save that retains the draft. Do not add a runtime consumer or a separate screen-layout workflow.

## Implementation tasks

1. Docs-first commit: specify `.tkrskin`/`skin`, the YAML shape, image-reference rules, preview boundary, and preservation requirements in `docs/spec/formats/native-skin.md`; add the native registry row and format index entry; link T-64 to the contract in `main-file.md`.
2. Add native-data read/edit operations and register `.tkrskin`; prove validation, one-property edits, version/residue preservation, and refusal of malformed documents.
3. Add the shared `skin` document kind and editor view using existing document lifecycle, command/undo, project asset picker and image preview patterns.
4. Integrate the shared view in browser and VS Code and add focused model/UI/host tests plus paced real-host proofs.
5. Verify failed-save retention and the native/main-file preservation invariants through the real host flows.

## Code Map

- `docs/spec/formats/main-file.md#editor-skin-authoring` and ADR 0045 Q3 3A are the authority. `.gam` skin fields remain legacy data and have no consumer.
- `docs/spec/formats/native-contracts.md#the-registry` defines the native extension/stamp identity; `.tkrskin` and `skin` are not currently registered. `packages/native-data/src/registry.ts` is the code registry, tested against the docs table.
- `packages/native-data/src/clip.ts` and `packages/editor-model/src/native-clip-document.ts` provide the existing text-editing/native-document boundary. Use their preservation and document lifecycle patterns, not a new persistence route.
- `packages/editor-model/src/kinds.ts` owns the shared document-kind registry. `packages/editor-ui/src/mount.ts` dispatches shared views; `asset-picker-view.tsx` and `character-authoring-view.tsx` show the accessible picker contract. Browser asset selection is supplied by `packages/host-web/src/workbench.ts`; VS Code by `packages/host-vscode/src/custom-editor.ts`.
- Relevant focused tests live in `packages/native-data/test`, `packages/editor-model/test`, and `packages/editor-ui/test`. Real browser and VS Code acceptance infrastructure is under `tools/browser/tests` and `tools/editor-vscode-test`.
- Do not change the engine, `main.gam` writer, screen-layout proposal, Electron shell, or unrelated editor kinds.

## Dependencies and decisions

14.1 is complete: ADR 0045 Q3 option 3A and T-64 are accepted. The skin editor uses the already-approved shared document workspace and asset pickers (11.3, 11.4); it needs no runtime provider. The implementation plan selects `.tkrskin` after confirming no registry collision.
