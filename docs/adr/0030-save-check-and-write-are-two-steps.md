# ADR 0030 — Proposed: a save's check and its write are two steps

* **Status:** Proposed (2026-11-12). Not approved by the owner. If approved, it amends [ADR 0022](0022-shared-editor-authoring-contracts.md) D3.4, D3.5, D10 and D11.3. Until then ADR 0022 stands as written, and no code follows from this record.
* **Issues:** [#2207](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2207) (save), [#2238](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2238) (Save As destination)
* **Evidence:** [the reproduction and the host survey](../findings/compare-write-window/README.md)
* **Does not reopen:** ADR 0022's identity, ownership or lifecycle rules apart from the four clauses named above, D14's two-answer conflict choice, or any host choice

## In plain terms

Before a save writes a file, the editor reads the file to check that no other program has changed it since the editor last read or wrote it. If another program has, the save stops and the user chooses which version to keep. The check and the write are two separate steps, though, and none of the editor's hosts (a browser folder, VS Code, VS Code for the Web) can do them as one. If another program writes the file in the moment between the check and the write, the save replaces that change and nobody is told. ADR 0022 promises this never happens. No host lets the editor keep that promise, so the owner needs to decide what the editor promises instead.

## Context

* ADR 0022 D11.3: "It never overwrites an unseen external change. Before writing, the editor compares the file on disk with the revision it last read or wrote. If they differ it does not write." D3.5: "Neither side is overwritten silently." D3.4: Save As resolves the destination and any collision "before writing".
* `MainDocument.save()` reads and compares at `packages/editor-model/src/main-document.ts:468`, then writes at `:492`. Save As checks the destination at `packages/editor-model/src/workspace.ts:369`, asks only when the file already exists (line 385), and writes at line 400 (VS Code: `packages/host-vscode/src/custom-editor.ts:232` and `:241`).
* Unlike ordinary save, Save As currently compares no destination bytes. In the browser workspace it checks existence, can wait indefinitely for the Replace answer, and then writes; another program can change the destination during that prompt. VS Code confirms in the workbench before calling the provider, so the provider cannot snapshot what the user confirmed. See [#2238](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2238).
* ADR 0022 D11.1 calls for autosave by default, one second after the last accepted edit; each autosave reopens the window. VS Code autosave currently follows the user's setting (D14.1); the browser's own scheduled autosave is not yet implemented. No real-host window duration has been measured.
* A deterministic reproduction against the real `editor-model` code: another program's write placed between the check and the write is replaced, the save reports success and the document shows clean. A host that watches files does not reveal the loss either, because the check its event triggers runs after the save and sees the editor's own bytes. Save As replaces a destination created after its check without asking. See the [findings](../findings/compare-write-window/README.md).
* Shipped text repeats the promise. The game settings view tells hosts without `fileWatch` that another program's change "is found when you save, and is never saved over" (`packages/editor-ui/src/settings-view.tsx:153-157`). The Unreleased changelog and the editor status page said the same thing; the pull request that adds this record corrects both of them to name #2207.

## What the hosts offer

Closing the gap needs a write that changes the file only if it still holds the bytes the editor checked: a compare-and-write done in one step. The [findings](../findings/compare-write-window/README.md#what-each-host-can-write) cite each source. In summary:

* **Browser folder (File System Access):** the standard's only `createWritable` option is `keepExistingData`. [MDN](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable#mode) also documents Chromium's non-standard `mode` (`siloed`/`exclusive`) for browser writable streams; it is not a conditional write and does not exclude outside programs. The standard's locks cover the browser's own handles, not other programs. This host has no rename and no watch.
* **VS Code, desktop and web:** `workspace.fs.writeFile(uri, content)` takes no options and replaces the file. VS Code's own mtime-and-size check for its text editors is not exposed to extensions, and it is also a check followed by a write. On the desktop's disk provider, `rename` without overwrite also checks first and then acts.
* **Browser session copy:** memory only, so no other program can write it and the gap does not exist.
* **Desktop (Electron), not built:** Node's exclusive create (`wx`) could close the Save As gap for a new destination. Node has no compare-and-replace for an existing file.

## Options

| Option | What it means | Assessment |
|---|---|---|
| **A. Say so (recommended)** | Keep the save check before its write. For Save As, snapshot destination bytes or absence at collision check and recheck immediately before writing; refuse if changed. Disclose the residual gap. Record the limit in ADR 0022, and state it where the editor describes change detection, in every host. Never claim a save cannot overwrite another program's change. | Proposed behavior, not implemented today: destination snapshot and recheck require implementation and tests, plus a visible disclosure. A matching comparison does not protect the following write; no real-host timing has been measured. The Save As recheck catches browser-prompt changes, but VS Code cannot inspect what the workbench confirmed before the provider was called. |
| B. A `conditionalWrite` capability | Add a write to platform-services that takes the expected bytes; declare it only where the host does it in one step. | No host could declare it. Implemented as "check, then write", it would be the false promise this record exists to remove. Worth revisiting only if a host gains a real primitive. |
| C. A time or size check | Stat the file and compare its modification time or size before writing, as VS Code does for its own text editors. | The check would run at the moment the bytes are already compared, so the gap does not shrink. It needs a new project-bound `stat` in `DocumentStorage`, and time or size can miss a same-size change. |
| D. Write aside, then swap | Rename the file away, compare what was moved, create the new file only if the path is free, then delete the moved copy. | Needs a rename that never replaces and a create-only write, bound to the project. The browser host has neither. VS Code's desktop disk provider checks before it renames, even with `overwrite: false`. The file would also be missing from its path in the middle of every save. |
| E. Refuse to save where the gap exists | Fail every save that cannot be guaranteed. | Fails closed in every host, so no host could save at all. |
| G. Keep the existing promise and leave both issues open | Keep the no-overwrite guarantee until a host can genuinely enforce it. | The defect and misleading shipped text remain unresolved; no current host supplies the required primitive. |
| F. Infer the loss from watcher events | Treat a change event during a save as a possible loss. | The editor's own write raises the same event, so this would warn on every save, or never. |

## Recommendation: option A, worded as follows

If the owner approves, these are the ADR 0022 changes. The text in quotes would be added to or replace the clause named.

* **D11.3**, the title becomes "It never overwrites an external change it has found", and this is added at the end: "**The check and the write are two steps.** No host offers a write that happens only if the file still holds the bytes the editor checked ([ADR 0030](0030-save-check-and-write-are-two-steps.md)). A change another program makes after the comparison and before the host write lands is therefore replaced, and the editor cannot tell that it happened. The comparison precedes the write, but the duration of the gap depends on the host and has not been measured. The editor says this where it describes change detection, in every host, and never says a save cannot overwrite another program's change. A host that gains such a write may close the gap; that needs its own amendment."
* **D3.5**, immediately after “Neither side is overwritten silently.”: "The exception is the gap D11.3 names. A change that lands between a save's check and its write is replaced without notice, and the editor discloses that limit instead of promising otherwise."
* **D3.4**, at the end: "Before Save As writes, compare the destination with a snapshot of its bytes or absence taken at the collision check; if it changed, refuse and preserve the source and destination. The final comparison and write are separate, so a change after the final comparison can still be replaced. VS Code confirms replacement in the workbench before the provider is called; the provider cannot detect changes during that earlier question without a workbench pre-confirmation snapshot. Disclose these limits."
* **D10**, added to the list: "no write made in one step with its pre-write comparison (no host offers one; D11.3)".

## What would follow approval

None of this is done by this record.

1. **Shipped claim inventory.** Correct the unconditional wording in `MainDocument.save` and `SaveFailure` TSDoc (`packages/editor-model/src/main-document.ts:40-42,154-155`), the workspace watch comment (`packages/editor-model/src/workspace.ts:171`), `WebProject` TSDoc (`packages/host-web/src/index.ts:12-13`), VS Code capabilities TSDoc (`packages/host-vscode/src/capabilities.ts:6-9`), `SettingsView` TSDoc and host note (`packages/editor-ui/src/settings-view.tsx:21,153-157`), and test descriptions/comments (`packages/editor-model/test/lifecycle.test.ts:20`, `tools/browser/tests/editor-lifecycle.spec.ts:20,82`, `tools/editor-vscode-test/conformance/suite.ts:441`). Each detected conflict remains protected; do not describe all outside changes as detectable. Inventory defect: [#2241](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2241). The game settings view replaces its host note with a sentence every host shows. It explains in plain words first, as the owner's rule for help text requires. Proposed wording: "Before saving, the editor checks that no other program has changed this file, and never saves over a change it finds. A change another program makes while the save is being written cannot be caught, and is replaced." A host without `fileWatch` keeps its first sentence before that one: "This host cannot watch files, so a change another program makes is found when you save."
2. **`editor-model`.** Ordinary save does not change. Save As gains the destination snapshot/recheck described above, with an explicit failure preserving both sides; VS Code snapshots only after provider entry, and the residual two-step race is disclosed. Controlled interleaving tests are added for a save, a save after "Save my version", a save on a host that watches, and a Save As destination. The ordinary save race tests pin the disclosed outcome; Save As tests cover creation or change during the prompt (refused when observable), and a change after the final recheck (residual disclosed race). The watcher test must assert both event delivery and the queued post-save read ([#2240](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2240)). A future host primitive therefore has to change those tests on purpose. An `editor-ui` test proves the sentence is shown in every host.
3. **Docs.** ADR 0022 is amended as above and its status gains an “Amended by ADR 0030” marker after owner approval; its provider-gaps row for this gap (added with this record) is removed, and the changelog says what changed. #2207 and #2238 close from that pull request.

## Questions for the owner

1. Adopt option A, with the ADR 0022 wording above? Or choose another option, or keep the promise and leave #2207 open until a host can keep it?
2. Is the proposed sentence right, and is the game settings view (every host) the right place for it? Or should it go in help or documentation instead?
3. Should the interleaving tests pin "replaced and disclosed", so that closing the gap later is a deliberate change?
