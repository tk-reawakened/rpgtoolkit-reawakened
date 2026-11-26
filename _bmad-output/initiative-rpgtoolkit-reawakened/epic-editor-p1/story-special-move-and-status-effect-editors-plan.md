---
type: feature
title: "Special move and status effect editors"
ticket: 10
status: built
risk: high
---

## Intent

Edit linked SPC and STE definitions including use contexts, signed damage and costs, status duration and changes, programs, animation and descriptions.

## Scope and acceptance

Follow battle-data.md for raw usable-byte mapping and avoid claims about unspecified zero-duration or plugin-specific rules; preserve unsupported provider data.

## Verification

Each format opens, edits, saves, reopens and loads through the chosen real battle provider using an authored enemy fixture (no enemy-editor UI required) with correct inverted usability flags, signed values and preserved untouched fields.

## Dependencies and decisions

Prerequisites: 13.1 (shared registration/lifecycle seam), 2.7 (battle formats) and 11.6 (settings/reference support). The owner's 12/13-before-29/30 sequence replaces the former enemy-editor prerequisite with independently authored enemy fixtures and the existing real battle provider. This story remains in Epic 13; 29.6 later consumes its actual linked editors. Apply the epic Notes, format specs, AD-18/19/20/22/29 and connected-authoring direction; T-57, T-58 map to CAP-16. Preserve version and residue, use the existing shared model and browser, and route host access through platform-services. Where provider or host capability is unavailable, preserve data and report the limitation; do not simulate it.

## What was built

- **Normative rules first** (`352a4880`, docs-only): [battle data: editing special moves and status effects](../../../docs/spec/formats/battle-data.md#battle-data-editor-rules) states same-version writing, the inverted usability flags, the on/off status flags, signed amounts, kept references and the read-only text form; [the editor rules](../../../docs/editor-features.md#special-move-status-effect-editors) state what the forms do. A defect found on the way — `SpecialMove.usableInBattle` / `usableFromMenu` in `packages/core/src/formats/battle/model.ts` were documented as "non-zero is true", the opposite of the format's ruling — is corrected in the same change.
- **Documents** (`packages/editor-model/src/special-move-document.ts`, `status-effect-document.ts`): the shared `DocumentCodec`/`BinaryDocument` lifecycle (ADR 0022 D2/D3, AD-19) over the core reader and writer. Snapshots carry the interpreted fields plus the stored bytes (`battleByte`, `menuByte`, `rawFlags`, `residueBytes`) so a form can show what is stored. Registered as the `special-move` (`.spc`) and `status-effect` (`.ste`) kinds with `asSpecialMoveDocument` / `asStatusEffectDocument` (ADR 0026 decisions 1-2), and both are rows of the kind-conformance table.
- **Views** (`packages/editor-ui/src/special-move-view.tsx`, `status-effect-view.tsx`, shared `battle-data-form.tsx`), mounted by `document.kind`, titled "Special move" and "Status effect". Every control is a registered command through the existing `connectEditorCommands` surface; Save, conflicts and pending edits use the shared lifecycle.
- **Links**: a move's status effect, animation and program and a status effect's program are references with Choose (the shared confirmed picker) and Open (the shared source visit); the linked `.ste`'s own numbers are described from its saved bytes (`describeStatusEffect` in `battle-data-links.ts`) and changed in its own document. A missing file is reported beside its kept reference.
- **Hosts**: the browser workbench binds the kinds in `viewDocumentFor` and lets the linked visit open `.spc`, `.ste` and a project-path program; VS Code registers the `tkr.battleData` custom editor for `*.spc` and `*.ste` and passes the same pick/open to the webview.

## Rulings recorded

- **Usability bytes are shown inverted and written 0/1** (approved by the format ruling of Epic 7.1 and stated normatively in this story's docs commit). *Rejected:* reproducing the 3.1.0 editor's raw checkbox, which reopens a usable move unticked.
- **An untouched flag keeps its stored byte** (`-1`, `7`), and "usable" for a non-zero byte writes 0 while "not usable" for a non-zero byte is refused as already true. *Rejected:* normalising every non-zero byte to 1 on save, which rewrites data the author did not touch (AD-18).
- **Rounds below 1, a disable nothing removes, and the stat clamp are not restated by the editor**; the form links to BAT-5/BAT-6 and says only what is stored. *Rejected:* guessing a duration rule the spec leaves open.
- **No "new move"/"new status effect" action and no enemy-editor UI.** The acceptance names open/edit/save/reopen/load through the provider with authored enemy fixtures; file creation is not part of it and 29.8/29.6 own enemy authoring.

## Verification evidence

- `packages/editor-model/test/battle-data-documents.test.ts` (16 cases): the committed annotated examples, expected bytes patched by hand at the listed offsets — inverted flags both ways, authored `-1`/`2` kept, signed i32/i16 values and their range refusals, NUL and unencodable text refused whole, minor 3 and trailing residue kept, undo exact, both text forms read-only with no edit and no write; the shared conformance table adds both kinds.
- `packages/editor-ui/test/battle-data-view.test.ts` (6 cases): the forms show the stored fields, write the inverted bytes, describe healing, refuse out-of-range values without losing the input, describe the linked status from the saved file, open it, keep a missing reference, and disable every field for a read-only text file.
- `tools/editor-vscode-test/test/battle-data-hosts.test.ts` (9 cases, browser host, VS Code desktop and VS Code for the Web): the host's own save writes exactly the edited bytes, the reopened form shows them, and a refused value leaves the file untouched.
- `tools/browser/tests/editor-battle-data.spec.ts` (3 cases, real headless Chromium against the shipped editor page): a move opens, its signed damage and inverted usable box edit and Save writes exactly the hand-patched bytes to the origin-private project folder; the linked status effect opens in its own tab, saves there, the move's file stays untouched and its link reads the new numbers back on return; a value the field cannot hold is refused with its reason and Save stays blocked.
- `tools/editor-vscode-test/test/battle-data-browser.test.ts` (2 cases): in the real workbench a move edits and saves, and its linked status effect opens in its own tab, saves there, and the way back reads the new numbers from the saved file.
- `packages/core/test/battle-data-editor-provider.test.ts` (4 cases): the saved files load through the real `stock_battle` package in the core suite's authored fight — the Special list holds a move exactly when its saved battle byte is 0 (an untouched `-1` stays hidden), a stored `-12` damage heals a fallen ally and the stored 2 SMP is paid, a move's saved link applies a status whose stored 4 HP per round is removed over its 2 rounds, and a stored negative HP amount heals before the turn, clamped at the actor's maximum of 30. That proof reaches only the core writers, so `battle-data-documents.test.ts` also asserts the editor's save equals `writeSpecialMove` / `writeStatusEffect` byte for byte. These are full-engine proofs: each boots a whole fight and takes 0.5-1.3 s, logged as a deliberate fast-test exception beside the test.
- The editors reuse the core reader and writer unchanged, so a file they do not touch writes back byte for byte (the conformance suite's no-edit save case), and every save keeps `minor` and the residue.

## Limits

- A Toolkit 2 text file (`minor` 0) is read-only with the reason; the editor never converts it on open.
- The linked status effect is described, not edited, from the move's form: pressing Open changes it in its own document and history.
- The form does not claim a rule for rounds below 1, for a disable that nothing removes, or for plugin-specific provider behaviour; those stay with BAT-5/BAT-6 and the provider.
- A move's animation and program are references only: the editor does not create those files.

## Release blocker — VS Code Save All and Close

**Owner decision, 2026-11-25:** [PR #3362](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3362) stays a draft until native VS Code **Save All** and **Close** handle a document whose only unsaved work is a field draft. [#3385](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3385) stays open. This is a release gate, not an accepted limitation or a reduction in story scope. The form's own Save is usable but is not a substitute for the native actions.

**Reproduced in packaged VS Code for the Web, Insiders `d8b0b6fc93e3027e3dae61d348d73f8b3f33c59c`.** `TKR_VSCODE_BATTLE_DATA_PROOF=1` first proves the native Save All shortcut works on an accepted edit, then invokes it without blurring a valid Damage draft on a clean tab: the draft stays in the form and disk bytes remain unchanged. It also blurs an invalid Damage draft, closes its still-clean tab through VS Code, and reopens the file: there is no save choice, the draft is gone, and disk bytes are unchanged. A passing reproduction is evidence of the blocker, not acceptance.

**Why the public API does not cover both actions.** VS Code [selects modified editors before invoking a provider](https://github.com/microsoft/vscode/blob/e49745a23cd02f5cc34fc92331b382ad343b72a8/src/vs/workbench/services/editor/browser/editorService.ts#L1104-L1106), [skipping unmodified tabs](https://github.com/microsoft/vscode/blob/e49745a23cd02f5cc34fc92331b382ad343b72a8/src/vs/workbench/services/editor/browser/editorService.ts#L1134-L1141). [Native Close checks for a custom confirmation handler or a dirty editor](https://github.com/microsoft/vscode/blob/e49745a23cd02f5cc34fc92331b382ad343b72a8/src/vs/workbench/browser/parts/editor/editorGroupView.ts#L1996-L2006); the handler is internal, not part of `CustomEditorProvider`. The [public API](https://github.com/microsoft/vscode/blob/e49745a23cd02f5cc34fc92331b382ad343b72a8/src/vscode-dts/vscode.d.ts#L10570-L10608) offers either undoable edit events or non-undoable content events, explicitly not both. It sends `(document, cancellation)` to `saveCustomDocument` for manual Save, Save All and autosave, without the reason. [The workbench has the save options, but does not forward them](https://github.com/microsoft/vscode/blob/e49745a23cd02f5cc34fc92331b382ad343b72a8/src/vs/workbench/api/browser/mainThreadCustomEditors.ts#L860-L888). Disposal is a notification after close, not a chance to hold the tab open.

**Alternatives considered.**

- A genuine undoable draft edit could mark the binary document dirty, including invalid field text. It would still enter native history before the field was accepted and could replace a redo branch, and it would not tell manual Save All or a Save-on-close from autosave. A no-op undo event has the same history cost with no useful operation; a content-only event breaks the provider's declared choice of native undo.
- Overriding a shortcut or offering a Toolkit Save All/Close command does not cover the native menu, tab close, or API calls. A durable draft recovery store could protect text after disposal but would not make native Save All write valid drafts or present a close choice. Neither satisfies the gate.
- The native text-editor API does carry save reasons, but it operates on a `TextDocument`, while `.spc` and `.ste` are binary. A separate virtual text resource would change file identity, save/reopen, conflicts, and history; it does not supply a pre-close hook or a guaranteed veto of native text writes ([ADR 0022 D12.10.4](../../../docs/adr/0022-shared-editor-authoring-contracts.md#d12-10-11-14-decisions)). Do not route binary edits through it to obtain a dirty flag.
- **Recommended unblock:** a supported host API to surface pending custom-editor work before Save All selects editors and before native Close skips a clean tab, plus the native save reason (or a pre-save callback limited to manual operations). This keeps drafts out of accepted undo history and prevents autosave from committing an in-progress gesture ([ADR 0022 D11.2](../../../docs/adr/0022-shared-editor-authoring-contracts.md#d11--automatic-save)). The APIs must work in both desktop VS Code and VS Code for the Web. No such supported combination was found at the pinned revision; do not infer the reason from focus, configuration or timing.

**Resolution approved by the owner, 2026-11-25.** Typing is a document edit ([ADR 0022 D16](../../../docs/adr/0022-shared-editor-authoring-contracts.md#d16--typing-in-a-form-field-is-an-edit-3385)): one undoable gesture per field focus, text the file cannot store held in the document, and hot-exit backups refreshed as a gesture continues. It stays inside the public API: no synthetic edit, no no-op undo entry, no dirty flag and no timing guess. Branch `proto/3385-live-commit-fields` implements it, and the packaged VS Code for the Web proof (`TKR_VSCODE_BATTLE_DATA_PROOF=1`, `runVscodeBattleDataProof`) asserts the checks below and passes; reverting number fields to commit-on-blur fails it at its first step. The [owner amendment](../../../docs/adr/0022-shared-editor-authoring-contracts.md#owner-amendment-2026-11-25-3385) ruled on the two checks whose meaning changed: Undo/Redo follow text-editor rules (typing after an Undo replaces the redo branch), and autosave writes the value typed so far after its delay but never text the file cannot store. #3385 closes when that work merges into this story's pull request.

**Required to clear the gate:** A real packaged host test shows native Save All commits a valid draft never blurred and refuses an invalid draft without writing; native Close on a draft-only tab offers Save/Don't Save/Cancel, a refused Save and Cancel keep the exact draft, and Don't Save drops it without editing disk or history. Test both clean and already-dirty documents, native Undo/Redo taking back and restoring a whole typing gesture, and real autosave modes writing the value typed so far after the delay and never text the file cannot store. Replace the blocker assertions with those positive checks before marking the draft ready.
