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
- `tools/editor-vscode-test/test/battle-data-browser.test.ts` (2 cases): in the real workbench a move edits and saves, and its linked status effect opens in its own tab, saves there, and the way back reads the new numbers from the saved file.
- `packages/core/test/battle-data-editor-provider.test.ts` (4 cases): the saved files load through the real `stock_battle` package in the core suite's authored fight — the Special list holds a move exactly when its saved battle byte is 0 (an untouched `-1` stays hidden), a stored `-12` damage heals a fallen ally and the stored 2 SMP is paid, a move's saved link applies a status whose stored 4 HP per round is removed over its 2 rounds, and a stored negative HP amount heals before the turn, clamped at the actor's maximum of 30. That proof reaches only the core writers, so `battle-data-documents.test.ts` also asserts the editor's save equals `writeSpecialMove` / `writeStatusEffect` byte for byte. These are full-engine proofs: each boots a whole fight and takes 0.5-1.3 s, logged as a deliberate fast-test exception beside the test.
- The editors reuse the core reader and writer unchanged, so a file they do not touch writes back byte for byte (the conformance suite's no-edit save case), and every save keeps `minor` and the residue.

## Limits

- A Toolkit 2 text file (`minor` 0) is read-only with the reason; the editor never converts it on open.
- The linked status effect is described, not edited, from the move's form: pressing Open changes it in its own document and history.
- The form does not claim a rule for rounds below 1, for a disable that nothing removes, or for plugin-specific provider behaviour; those stay with BAT-5/BAT-6 and the provider.
- A move's animation and program are references only: the editor does not create those files.
