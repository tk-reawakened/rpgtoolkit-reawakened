# ADR 0026 — Editors are bound to document kinds through one registry and one document contract

* **Status:** Proposed (2026-11-11). Not yet accepted as an ADR. The owner told the 12.1 story to build to it on 2026-11-13, so the extraction below exists in code; acceptance of the ADR itself is still the owner's to record.
* **Date:** 2026-11-11
* **Context documents:** [editor-ecosystem](../editor-ecosystem/README.md) (the proposal this ADR belongs to), [0005](0005-independent-product-v1-and-native-format.md), [0009](0009-compatibility-layer-not-the-model.md), [0019](0019-tkr-authoring-formats.md), [0022](0022-shared-editor-authoring-contracts.md), [0023](0023-native-data-contracts-versioning-identity-and-sidecars.md), [0024](0024-plugin-data-contributions.md), [0025](0025-editor-ui-framework-preact-tsx.md), [guardrails.md](../guardrails.md), architecture spine AD-18 to AD-20
* **Does not reopen:** ADR 0022's ownership and lifecycle rules, the ADR 0005 amendment of 2026-11-09, ADR 0008's trust line, or any host or framework choice

## In plain terms

The editor will grow from one kind of document to dozens: every Toolkit 3 file type, then our own, then kinds a plugin adds. This ADR says how a kind is attached to the editor, once, so that each new kind does not need new code in every host and so that a Toolkit 3 file type is not a special case.

## Context

The editor code today has one document type, written for the main game file, and one view. The editor epics add an editor for each Toolkit 3 tool. ADR 0022 rules what every host must do with a document, and no record rules what a document *is* to the editor in general, or how a host learns which kinds exist. Without that, each editor story adds a concrete document type, and each host registers it by hand. The [current-state review](../editor-ecosystem/current-state.md#where-the-structure-stops-short) lists the consequences.

ADR 0009 already says Toolkit 3 shapes are adapters onto our model. This ADR carries that into the editor.

## Decision

1. **The editor is organised by document kind.** A kind has an identifier, the contract it carries, a label and description, the area it appears in, its extensions and a storage class. A Toolkit 3 file type is a kind, registered the same way as a native kind.
2. **One registry, two halves.** The description of a kind and its model factory are in `editor-model`. Its views are in `editor-ui`. No other package lists kinds. The native extension table in `packages/native-data` remains the source for native extensions, and the registry reads it.
3. **One document contract.** Every kind's model implements the same interface: identity, read-only reason, snapshot, apply a command, undo, redo and save, with the meanings of ADR 0022 D1 to D3 and AD-19. Hosts drive that interface and no kind-specific one.
4. **Storage class names the authority.** Legacy binary, program text, native text, outside asset or build output. The class selects the row of ADR 0022 D2 that applies. This ADR adds no row and changes none.
5. **A kind-conformance suite.** One table-driven suite runs every registered kind through the checks listed in the [architecture page](../editor-ecosystem/architecture.md#layer-2-the-document-contract): identical bytes on a save with no edit, whole acceptance or rejection of a command, undo restores, save and reopen agree, unmodelled data survives, read-only with a reason where there is no same-version writer. A kind that is not in the table is not registered.
6. **Views are written against a contract where a clean adapter exists.** Where two kinds carry one contract, one view edits both. Whether a legacy kind is a clean adapter onto a contract is stated on that contract's page. Where it is not, the legacy kind keeps a view of its own. Conversion between kinds is explicit and reviewed, makes a new identity, and never happens on open.
7. **Hosts are generated from the registry.** Host manifests that list file types (VS Code custom editors, file associations, the new-document menu) are produced from the registry at build time.
8. **Built-in editors register through the shape a plugin would use.** This ADR opens no plugin API and decides nothing about loading or trust.
9. **Each general part is built by its second caller.** The registry and contract are extracted when the second document type is written, and not before.

## What this ADR does not decide

* Which native kinds ship in the first release. That is ADR 0005 and its amendments.
* Any new kind, extension or contract. Each needs its own page ([admission test](../editor-ecosystem/document-kinds.md#admission-test-for-a-new-kind)).
* The form, the Database view, the project index, import or contributions. They are proposals on the ecosystem pages and are decided when built.
* The naming and stamp of native files ([#1839](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1839), answered by the amendments proposed to ADR 0019 and ADR 0023).
* The exact TypeScript shapes. The first story that implements a decision fixes its shape against a real caller.

## Consequences

**Positive**

* A new kind works in every host when it is registered.
* The lifecycle promises are proved per kind by one suite, not re-argued per editor.
* A Toolkit 3 file and its native counterpart can share one editor.
* A plugin-defined kind has somewhere to go when that is ruled.

**Negative, with mitigations**

* *A refactor of the first document type.* It is small now and grows with every editor added first. Decision 9 times it at the second document.
* *A shared interface can flatten real differences between kinds.* The command and snapshot types stay specific to each kind; only the lifecycle is shared.
* *Generated manifests add a build step.* The settings catalogue already needs one (ADR 0022 D6.4).

## Alternatives considered

* **One concrete document type and one hand-written host registration per editor.** This is where the code goes with no decision. Rejected: the cost is paid once per editor per host, and the lifecycle rules are proved separately each time.
* **A generic editor for everything, driven only by schemas.** Rejected: the board, pixel and animation editors are direct-manipulation tools, and the plugin-editor study warns against a speculative universal UI framework. Forms are a default, not the model.
* **Organise by file extension.** Rejected: it makes the legacy file the model (against ADR 0009) and cannot express two kinds carrying one contract.
* **Wait until several editors exist and then extract.** Rejected as the plan, kept as the timing rule: extract at the second, not the tenth.

## Open questions

* Whether a kind identifier is a plain name (`board`) or always qualified (`core/board`), and how a plugin's is formed (PKG-2).
* Whether the registry is fixed at build time for the first release or can change while the editor runs.
* How a text kind in VS Code, where the host's text document is the authority, presents `apply` and `undo` through the shared contract without a second model (ADR 0022 D2.2 says the surface is the same; the adapter is unproved).

## Implementation notes (story 12.1, [#1712](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1712), 2026-11-13)

The second document kind (the board, `.brd`) is the "second caller" of decision 9, so the extraction was made there. What exists, and what is still open:

* **One binary document class** (`packages/editor-model/src/binary-document.ts`). `BinaryDocument<Model, Command, Fields>` holds the whole ADR 0022 D3 lifecycle (save, conflict, revert, undo by `editId`, Save As); a kind supplies a `DocumentCodec` (read, write, same-version-writer check, command guard, apply, label, refuse, summary, snapshot fields). `mainCodec` and `boardCodec` are the two codecs; the 70 existing `editor-model` tests passed unchanged across the move. (Decisions 3 and 4.)
* **The registry** (`editor-model/src/kinds.ts`): `DOCUMENT_KINDS`, `kindForPath`, `kindById`. Identifiers are plain (`main`, `board`); a qualified form for plugins stays an open question. The registry is fixed at build time. The workspace opens by registered kind and refuses an unclaimed extension with `unsupported`. (Decisions 1 and 2, first half.)
* **Views by kind** (`editor-ui/src/mount.ts`): `mount` picks the settings view or the board view by `document.kind`. (Decision 2, second half.)
* **The kind-conformance suite** (`editor-model/test/kind-conformance.test.ts`): a table of kinds run through the checks of the architecture page, with a test that fails when a registered kind is missing from the table. The board's cases that need real project files are in `board-document.test.ts`, `board-preview.test.ts` and the host proof `tools/editor-vscode-test/test/board-hosts.test.ts`. (Decision 5.) The read-only-with-a-reason row is proved for the main kind only: no committed board has a reader but no writer.
* **Hosts** drive the one contract: the VS Code provider and bridge carry the kind and a `preview` request, recovery runs over any kind, and the browser host exposes `openEditor`/`mountEditor` (`openGameSettings`/`mountGameSettings` remain as aliases). The webview reads no files, so the extension host composes a board's picture and posts it.
* **Not done:** decision 7 (generated manifests). `extensions/editor/package.json` is edited by hand for the second view type (`tkr.board`); generating it from the registry waits for a third kind. The settings view still carries its own conflict and save markup; the board view repeats it with `tkr-board-*` classes, and the shared status component is for whichever story next needs it a third time.

## Implementation notes (story 12.8, [#1717](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1717), 2026-11-14)

The third document kind (the tile bitmap, `.tbm`, identifier `tile-bitmap`) is registered the same way: a codec, a registry entry, a conformance-table row and a view chosen by `document.kind`. It is the "third caller" the notes above wait for, and neither deferral was done in that story:

* **Still not done:** decision 7. `extensions/editor/package.json` and `VIEW_TYPES` in `host-vscode/src/extension.ts` are edited by hand for `tkr.tileBitmap`. The tile bitmap view also repeats the conflict and save markup with `tkr-bitmap-*` classes, so the shared status component of the second note now has three copies. Both are tracked in [#2495](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2495) because the board view is being changed by other stories at the same time.
* Both hosts still carry a picture the same way: a view's `preview()` asks the host, which composes the board or tile bitmap from the project's files with that kind's compositor in `editor-model`.
