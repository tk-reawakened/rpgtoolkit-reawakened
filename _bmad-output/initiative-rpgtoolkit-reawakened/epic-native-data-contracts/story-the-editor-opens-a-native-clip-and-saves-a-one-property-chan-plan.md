---
title: 'Open and edit a native animation clip'
type: 'feature'
ticket: 6
created: '2026-11-18'
status: 'in-progress'
baseline_revision: '9688dc7ae390194cf225e4930d4d02549e88441d'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="owner delegated routine implementation choices for the overnight Epic 12 work">

## Intent

**Problem:** Creators cannot open the already-supported native animation clip in the shared visual editor or make a comment-preserving property edit. This is a prerequisite of the scene editor.

**Approach:** Register `.tkranm` as its own native document and show its actual fields in a shared editor. Keep the authored YAML text as the document's source of truth and use the existing in-place clip edits, common history and host Save lifecycle.

## Boundaries & Constraints

**Always:** Follow `docs/spec/formats/native-animation-clip.md#reference-reader-writer-and-importer`, ADR 0022 document history and the editor's existing shared model/host boundaries. Persist valid authored UTF-8 and exact untouched bytes, comments and line endings; refuse unreadable or invalid input without silently repairing it. Each accepted property edit is undoable, and saves/conflicts obey the common document lifecycle. Expose the currently supported scalar and optional property edits without fabricating absent values. Use native controls and existing design language.

**Never:** Convert through the legacy `.anm` model or its 51-slot limit; normalize text with `writeClip` on save; imply the provisional reader supports `pluginData`; invent native asset resolution, clip preview or structural frame operations. No native format or runtime loading change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Authored clip | Existing comments, spacing and fields | Open in browser and VS Code; change an existing delay and Save; exactly its value line changes; reopen retains every comment | Report failures without claiming saved |
| History | Accepted property change | Undo restores exact original bytes; redo restores edited bytes | Rejected edits do not mutate history |
| Invalid edit or file | Negative delay, invalid reference, malformed YAML or invalid UTF-8 | Reject with a useful message and retain current work | Never write replacement text or discard drafts |
| Existing optional fields | A clip/frame has or lacks sound or colour | Display presence truthfully; supported edits/removal use the actual native setter/remover | No synthetic `null`, legacy default or empty placeholder saved |

</frozen-after-approval>

## Code Map

- `packages/native-data/src/clip.ts` exports `readClip`, `setClipProperty`, `removeClipProperty`, `Clip`, `ClipPath`, `ClipEditValue`; the setters preserve authored text, while `writeClip` normalizes and must not be used for saving.
- `packages/editor-model/src/binary-document.ts`, `animation-document.ts`, `kinds.ts`, `workspace.ts` supply codec, command/replay, registry, identity, conflict and save history. Add an independent text-backed native clip kind rather than changing the legacy animation document. `kind-conformance.test.ts` checks registered lifecycle.
- `packages/editor-ui/src/mount.ts` and the existing animation view show shared mount/pending-edit patterns; introduce a native-clip view without legacy frame slots. `packages/host-web/src/index.ts` adapts shared documents.
- `packages/host-vscode/src/custom-editor.ts`, `extension.ts`, `webview.tsx`, and `extensions/editor/package.json` register and bridge custom editors. Register the native extension and reuse common save/undo/backup machinery.
- `tools/deps/edges.json` and the architecture's generated dependency diagram must record the new pure `native-data` → `editor-model` dependency. Update the workspace lock consistently, without a cycle.
- Existing native clip examples and `packages/native-data/test/clip.test.ts`, `packages/editor-model/test/kind-conformance.test.ts`, and host-conformance proofs provide authored fixture and lifecycle patterns.

## Tasks & Acceptance

**Execution:**
- [ ] `docs/editor-features.md` — document the creator-visible native clip save and limitations before implementation; commit the contract first under G7.
- [ ] `packages/editor-model/src/` and `packages/native-data` dependency metadata — implement and register native clip source-text document commands using the existing splice API, strict UTF-8 and shared lifecycle; cover model/registry lifecycle and one-line/comment-preserving undo/save/reopen.
- [ ] `packages/editor-ui/src/` — mount a native clip view showing real clip fields and supported edits; use labelled native controls, pending-edit barriers, clear errors and existing host Save semantics.
- [ ] `packages/host-web/src/`, `packages/host-vscode/src/`, `extensions/editor/package.json` — wire the shared kind and provider on both hosts, preserving common save and history behavior.
- [ ] `tools/deps/edges.json`, architecture diagram, package manifests and lockfile — record only the permitted new pure dependency; verify graph and licences.
- [ ] Host proof and tests — perform an actual authored clip edit, explicit Save, exact one-line diff, unchanged comments and reopen in browser and packaged VS Code, plus invalid-input and undo/redo coverage.
- [ ] Run affected local tests, type checks, lint and actual host journeys; independently review, record triage, open a PR and merge only after required checks pass.

**Acceptance Criteria:**
- Given a valid commented clip, when the creator opens it through either real host, changes its existing delay and saves, then only that property's line differs, all comments remain, and reopening shows the new value.
- Given accepted edits or an invalid attempt, when the creator uses Undo/Redo or Save, then history and saved bytes reflect only accepted edits and refused work remains visible.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Verification

- Focused model/UI/host tests and configured TypeScript checks; inspect individual new test durations (<1 s each).
- Real browser and packaged VS Code creator journeys; assert actual persisted bytes and reopened values.
- `pnpm lint`, `pnpm graph`, generated-help checks, provenance and applicable local golden tests before pushing; no goldens changed without explanation.
