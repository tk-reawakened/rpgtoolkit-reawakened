---
type: story
title: "The scene editor saves a board directly or a scene, and converts only when asked"
ticket: 16
status: draft
---

# The scene editor saves a board directly or a scene, and converts only when asked

## Scope

Writes the board editor's views against the scene model with two storage adapters: a `.brd` opened and saved directly, and a `.tkrscn` that builds its board (12.15). A feature only a scene can store is shown and unavailable on a `.brd`, with its reason and one action, convert to a scene. Conversion is reviewed before it writes, creates the scene beside the board with a new document identity, and never happens on open or on save.

Follow [ADR 0019](../../../docs/adr/0019-tkr-authoring-formats.md) amendment of 2026-11-11, point 4, and [ADR 0022](../../../docs/adr/0022-shared-editor-authoring-contracts.md) D1.3, D2 and D3 for the document lifecycle, the text authority and the sharing of one contract between kinds. The proposal in `docs/editor-ecosystem/architecture.md` (one contract, more than one kind) is the frame; [ADR 0026](../../../docs/adr/0026-editors-are-registered-by-document-kind.md) is Proposed and this story does not depend on its approval. Both adapters write documents that obey [`docs/spec/formats/native-contracts.md`](../../../docs/spec/formats/native-contracts.md) and the draft [`docs/spec/formats/tkr-authoring.md`](../../../docs/spec/formats/tkr-authoring.md).

## Acceptance and verification

In both hosts: a `.brd` is edited and saved with no scene created and reopens identically; the same edit on a `.tkrscn` saves as a small text diff and rebuilds the board; a scene-only control on a `.brd` is disabled, says why, and its convert action shows what will be written before writing; cancelling writes nothing; the kind-conformance checks pass for both adapters.

Use the shared document lifecycle and preserve same-version unknown data; exercise the failure, cancel and save/reopen paths of both adapters rather than relying on preview alone. Follow `discovery/inception-proposal.md`, `docs/editor-features.md` and G2/G7; do not claim checks passed without executing them.

## Dependencies and decision gate

Prerequisites: 12.10, 12.11, 12.15, 27.6. Prerequisite proof: 27.6 shows a view editing a native text document through the host's text authority, which is what both adapters need before either is written. Re-check `docs/editor-ecosystem/architecture.md` and the ADRs above if the scene model changes before this starts.
