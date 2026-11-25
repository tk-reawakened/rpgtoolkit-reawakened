---
type: feature
title: "Edit and preview interface skins"
ticket: 4
status: draft
risk: medium
---

# Edit and preview interface skins

## Scope

The authoring document is **Native Skin**, named here under ADR 0045 option 3A. Author window and button references under the [skin contract](../../../docs/spec/formats/main-file.md#editor-skin-authoring), with editor-only preview and unchanged legacy `.gam` fields. Fix its on-disk spelling in this plan before implementation; the approval named the document authority, not a file extension or encoding.

Preserve unknown format residue and save version; selection or preview is not an edit, and failed saves retain the draft.

## Acceptance and verification

Both hosts open, change, save and reopen a skin retaining other fields and show the changed window and button graphics without claiming full-screen layout editing.

## Dependencies and decisions

Requires 14.1, 11.3 and 11.4. Use the shared document workspace and asset pickers; the approved preview has no runtime provider dependency.
