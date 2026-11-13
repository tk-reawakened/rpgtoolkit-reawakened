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
* A deterministic reproduction against the real `editor-model` code: another program's write placed between the check and the write is replaced, the save reports success and the document shows clean. A host that watches files does not reveal the loss either, because the check its event triggers runs after the save and sees the editor's own bytes. Save As replaces a destination created after its check without asking. See the [findings](../findings/compare-write-window/README.md).
* Shipped text repeats the promise. The game settings view tells hosts without `fileWatch` that another program's change "is found when you save, and is never saved over" (`packages/editor-ui/src/settings-view.tsx:153-157`). The Unreleased changelog and the editor status page said the same thing; the pull request that adds this record corrects both of them to name #2207.

## What the hosts offer

Closing the gap needs a write that changes the file only if it still holds the bytes the editor checked: a compare-and-write done in one step. The [findings](../findings/compare-write-window/README.md#what-each-host-can-write) cite each source. In summary:

* **Browser folder (File System Access):** `createWritable` takes only `keepExistingData`. The standard's locks cover the browser's own handles, not other programs. This host has no rename and no watch.
* **VS Code, desktop and web:** `workspace.fs.writeFile(uri, content)` takes no options and replaces the file. VS Code's own mtime-and-size check for its text editors is not exposed to extensions, and it is also a check followed by a write. On the desktop's disk provider, `rename` without overwrite also checks first and then acts.
* **Browser session copy:** memory only, so no other program can write it and the gap does not exist.
* **Desktop (Electron), not built:** Node's exclusive create (`wx`) could close the Save As gap for a new destination. Node has no compare-and-replace for an existing file.

## Options

| Option | What it means | Assessment |
|---|---|---|
| **A. Say so (recommended)** | Keep the check immediately before the write, which already shrinks the gap to the time the host takes to finish that read and carry out the write. Record the limit in ADR 0022, and state it where the editor describes change detection, in every host. Never claim a save cannot overwrite another program's change. | True in every host today. Costs a sentence in the interface, not a feature. The check still catches every change made before it runs; only a change that lands during the save itself is missed. |
| B. A `conditionalWrite` capability | Add a write to platform-services that takes the expected bytes; declare it only where the host does it in one step. | No host could declare it. Implemented as "check, then write", it would be the false promise this record exists to remove. Worth revisiting only if a host gains a real primitive. |
| C. A time or size check | Stat the file and compare its modification time or size before writing, as VS Code does for its own text editors. | The check would run at the moment the bytes are already compared, so the gap does not shrink. It needs a new project-bound `stat` in `DocumentStorage`, and time or size can miss a same-size change. |
| D. Write aside, then swap | Rename the file away, compare what was moved, create the new file only if the path is free, then delete the moved copy. | Needs a rename that never replaces and a create-only write, bound to the project. The browser host has neither. VS Code's desktop disk provider checks before it renames, even with `overwrite: false`. The file would also be missing from its path in the middle of every save. |
| E. Refuse to save where the gap exists | Fail every save that cannot be guaranteed. | Fails closed in every host, so no host could save at all. |
| F. Infer the loss from watcher events | Treat a change event during a save as a possible loss. | The editor's own write raises the same event, so this would warn on every save, or never. |

## Recommendation: option A, worded as follows

If the owner approves, these are the ADR 0022 changes. The text in quotes would be added to or replace the clause named.

* **D11.3**, the title becomes "It never overwrites an external change it has found", and this is added at the end: "**The check and the write are two steps.** No host offers a write that happens only if the file still holds the bytes the editor checked ([ADR 0030](0030-save-check-and-write-are-two-steps.md)). A change another program makes after the comparison and before the host write lands is therefore replaced, and the editor cannot tell that it happened. The comparison is made immediately before the write, so the gap lasts only as long as the host takes to finish that read and carry out the write. The editor says this where it describes change detection, in every host, and never says a save cannot overwrite another program's change. A host that gains such a write may close the gap; that needs its own amendment."
* **D3.5**, at the end: "The exception is the gap D11.3 names. A change that lands between a save's check and its write is replaced without notice, and the editor discloses that limit instead of promising otherwise."
* **D3.4**, at the end: "The same gap applies to the destination. A file another program creates or changes after the collision check is replaced."
* **D10**, added to the list: "no write made in one step with its pre-write comparison (no host offers one; D11.3)".

## What would follow approval

None of this is done by this record.

1. **`editor-ui`.** The game settings view replaces its host note with a sentence every host shows. It explains in plain words first, as the owner's rule for help text requires. Proposed wording: "Before saving, the editor checks that no other program has changed this file, and never saves over a change it finds. A change another program makes while the save is being written cannot be caught, and is replaced." A host without `fileWatch` keeps its first sentence before that one: "This host cannot watch files, so a change another program makes is found when you save."
2. **`editor-model`.** Saving does not change. Controlled interleaving tests are added for a save, a save after "Save my version", a save on a host that watches, and a Save As destination. Each test pins the disclosed outcome: the save succeeds and the other program's bytes are replaced. A future host primitive therefore has to change those tests on purpose. An `editor-ui` test proves the sentence is shown in every host.
3. **Docs.** ADR 0022 is amended as above, its provider-gaps row for this gap (added with this record) is removed, and the changelog says what changed. #2207 and #2238 close from that pull request.

## Questions for the owner

1. Adopt option A, with the ADR 0022 wording above? Or choose another option, or keep the promise and leave #2207 open until a host can keep it?
2. Is the proposed sentence right, and is the game settings view (every host) the right place for it? Or should it go in help or documentation instead?
3. Should the interleaving tests pin "replaced and disclosed", so that closing the gap later is a deliberate change?
