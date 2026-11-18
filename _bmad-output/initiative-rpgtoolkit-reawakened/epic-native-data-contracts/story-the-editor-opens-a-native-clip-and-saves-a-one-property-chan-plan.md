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
- `packages/host-vscode/src/extension.ts`, `webview.tsx`, and `extensions/editor/package.json` register and bridge the visual editor. ADR 0022 D2 requires a `CustomTextEditorProvider` backed by VS Code's `TextDocument`, with edits through `WorkspaceEdit` and native undo; the shared browser document must not become a second VS Code authority.
- `tools/deps/edges.json` and the architecture's generated dependency diagram must record the new pure `native-data` → `editor-model` dependency. Update the workspace lock consistently, without a cycle.
- Existing native clip examples and `packages/native-data/test/clip.test.ts`, `packages/editor-model/test/kind-conformance.test.ts`, and host-conformance proofs provide authored fixture and lifecycle patterns.

## Tasks & Acceptance
### Shared implementation contract

The model exports `NativeClipCommand` as `{ type: "set-native-clip-property"; path: readonly (string | number)[]; value: string | number | { readonly r: number; readonly g: number; readonly b: number } } | { type: "remove-native-clip-property"; path: readonly (string | number)[] }`, `NativeClipSnapshot` as `DocumentSnapshot<NativeClipCommand>` plus `readonly clip: Clip`, and `NativeClipDocument` as `EditorDocument<NativeClipSnapshot, NativeClipCommand>`. Its kind ID is `native-clip`. The view depends on these shared editor-model exports, not on `native-data` directly. The native clip's optional fields keep the shipped contract's actual absence semantics; no format change is made. Parent integrates dependency manifests, lock/graph and actual host proofs.

**Execution:**
- [x] `docs/editor-features.md` — document the creator-visible native clip save and limitations before implementation; commit the contract first under G7.

- [x] `packages/editor-model/src/` and `packages/native-data` dependency metadata — implement and register native clip source-text document commands using the existing splice API, strict UTF-8 and shared lifecycle; cover model/registry lifecycle and one-line/comment-preserving undo/save/reopen.
- [x] `packages/editor-ui/src/` — mount a native clip view showing real clip fields and supported edits; use labelled native controls, pending-edit barriers, clear errors and existing host Save semantics.
- [x] `packages/host-web/src/`, `packages/host-vscode/src/`, `extensions/editor/package.json` — wire the shared view on both hosts; in VS Code keep the `TextDocument` as the sole authority, bridge visual changes through `WorkspaceEdit`, tolerate temporarily invalid source and use native Save and undo.
- [x] `tools/deps/edges.json`, architecture diagram, package manifests and lockfile — record only the permitted new pure dependency; verify graph and licences.
- [x] Host proof and tests — perform an actual authored clip edit, explicit Save, exact one-line diff, unchanged comments and reopen in browser and packaged VS Code; prove the VS Code source and visual editors share the same text and native undo/redo, including temporarily invalid source.
- [ ] Run affected local tests, type checks, lint and actual host journeys; independently review, record triage, open a PR and merge only after required checks pass.

**Acceptance Criteria:**
- Given a valid commented clip, when the creator opens it through either real host, changes its existing delay and saves, then only that property's line differs, all comments remain, and reopening shows the new value.
- Given accepted edits or an invalid attempt, when the creator uses Undo/Redo or Save, then history and saved bytes reflect only accepted edits and refused work remains visible.

## Implementation Notes

- The browser registers a `native-text` shared document. VS Code instead wraps its `TextDocument` and submits the minimal in-place span as a `WorkspaceEdit`; its own undo stack and Save remain authoritative.
- Unapplied property drafts are labelled and can be discarded. Host-level close/revert integration for such drafts remains tracked in #3172; malformed unresolved YAML alias handling remains in #3175.

## Plan Change Log

- Corrected the VS Code implementation approach after review against ADR 0022 D2: native YAML is owned by VS Code's text document, not the binary custom-document model. This preserves the approved intent and existing authority rule; it is not a format or owner-ruling change. Tracked as #3177.

## Review Triage Log

- Independent host/data review: fixed UTF-8 corruption risk (#3179) by checking backing bytes before enabling visual edits, and fixed delayed Apply erasing newer scalar/colour drafts (#3180). The packaged proof now saves the visual edit itself, verifies exact bytes and refuses a file with an invalid byte in a comment; the delayed-acknowledgment test covers both draft types.
- Kept host-level draft close/revert and shortcut handling in #3172 and the unverified uncommon flow-comment hypothesis in #3181. Neither is represented as fixed.
- Fixed the CI-discovered Node ESM test bundle failure (#3190) and default native-clip proof's missing invalid-UTF-8 fixture (#3191). The focused connected-authoring proof passed, but its later run in the full sequential VS Code suite timed out at the sprite inspector; recorded separately as #3192 rather than treating that run as green.

## Verification

- Local affected suite: 904 passed; `pnpm exec tsc -b`, model test types, lint, generated-help/bundle check, dependency graph and provenance scan passed.
- Real Chromium: authored clip edit, exact bytes, reopen, unapplied-draft warning and disk-conflict reload passed. Packaged `@vscode/test-web`: native text ↔ visual changes, native Undo/Redo, invalid-source recovery, exact bytes and reopen passed. Screenshots were inspected.
- Both host-proof TypeScript projects passed. Headless golden passed; closing matched 8/8 baselines (2 clean boots, 6 expected failures).
- After the fixture fix, the default VS Code run passed the native clip, animation, sprite, board and settings/art lanes; its later connected-authoring lane timed out (#3192). The focused connected-authoring proof had passed separately on the same integration candidate.

- Focused model/UI/host tests and configured TypeScript checks; inspect individual new test durations (<1 s each).
- Real browser and packaged VS Code creator journeys; assert actual persisted bytes and reopened values.
- `pnpm lint`, `pnpm graph`, generated-help checks, provenance and applicable local golden tests before pushing; no goldens changed without explanation.
