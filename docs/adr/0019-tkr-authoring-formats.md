# ADR 0019 — Native authoring formats are `.tkr*` YAML documents; the editor builds legacy files from them

* **Status:** Accepted (owner decisions, 2026-11-09). **Amendment proposed 2026-11-11** ([below](#amendment-proposed-2026-11-11-one-editor-two-files-the-common-stamp)), awaiting the owner's approval; it closes [#1839](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1839).
* **Date:** 2026-11-09
* **Settles:** the follow-up ADR 0005 calls for ("before the editor writes any project to disk"), for authoring documents only
* **Context documents:** [ADR 0005](0005-independent-product-v1-and-native-format.md), [ADR 0009](0009-compatibility-layer-not-the-model.md), [spec/formats/tkr-authoring.md](../spec/formats/tkr-authoring.md), research [flow 11](../../_bmad-output/initiative-rpgtoolkit-reawakened/research-editor-ux-for-beginners/flows/11-tile-asset-and-board-architecture.md)

## Summary

In plain terms:

1. **New file types we invent are named `.tkr<something>` and written in YAML.** People can read them, diff them in Git and put comments in them.
2. **The first three are `.tkrscn` (a scene), `.tkrtile` (a tile set and its recipes) and `.tkrpack` (a pack of ready-to-paste scene assets).**
3. **They are editor files.** The author edits a `.tkrscn`; when it is saved, the editor builds the ordinary `.brd` (and any `.tst`, `.iso`, `.tbm` it needs) that the engine already plays. The engine does not read the new files yet.
4. **Later, the engine may read `.tkrscn` directly.** The schema is written so that is possible without changing it.

## Context

ADR 0005 permits a native format "when legacy formats limit a feature" and leaves open its name, extension, container, schema policy and whether legacy formats stay editable. It requires a follow-up decision before the editor writes a native project to disk.

The editor research (flows 01, 03, 10 and 11) found authoring data the legacy board cannot hold: stable identities for floors and objects, friendly floor names, which pasted asset produced which records, how a wall was traced (so it can be traced again), editable tile recipes, and named scene assets with built-in collision and walk-behind. Putting that data into `.brd` residue would hide it from authors and tools; dropping it would make the editor's helpers one-shot.

## Decision

1. **Naming.** Every new TK Reawakened file format uses the extension `.tkr` followed by a short kind (`.tkrscn`, `.tkrtile`, `.tkrpack`). The schema identifier inside the file is `tkr-<kind>/<major>.<minor>` (for example `tkr-scn/1.0`), matching the existing `tkr-index/<major>.<minor>` convention.
2. **Encoding.** These files are YAML 1.2 text in UTF-8 under the restrictions of [tkr-authoring.md](../spec/formats/tkr-authoring.md#1-shared-conventions): no anchors, aliases or custom tags; integers for pixels and ticks; a fixed key order on write, so the same document always produces the same bytes.
3. **Editor-only for now.** The files are read and written by `editor-model`. `core` does not gain a reader. The YAML library is an `editor-model` dependency, never a `core` one, and must pass G6 (the `yaml` npm package, ISC, is the expected choice; it is pinned when `editor-model` lands).
4. **A scene builds a board.** A `.tkrscn` is the source of truth for one board. Saving it builds the `.brd` next to it, deterministically, through the board writer `core` already has. The `.brd` is a build output; an outside edit to it is detected by hash and offered as an import, never silently overwritten.
5. **Legacy stays first-class for play.** Opening a legacy `.brd` creates a `.tkrscn` by import; legacy indices and unmodelled fields are kept (AD-18). The runner keeps playing `.brd`, `.tst`, `.iso`, `.tan` and `.tbm`.
6. **Not shipped.** Editor-only files are left out of the distribution package (T-70); only the built files go to players.
7. **Forward path.** A later ADR may let `core` read `.tkrscn` through an `AssetDecoder` (AD-31). The schema therefore contains nothing editor-specific that a runtime reader could not ignore.

## Consequences

* The board editor's document is a `.tkrscn`; AD-19's "one document per file" applies to it, and the generated `.brd` is not a second editable document.
* Script-visible slot order (vectors by handle, programs and items by index) is preserved across builds: list order in the scene is slot order, and builds never reorder existing entries.
* Packaging excludes `*.tkrscn`, `*.tkrtile` and `*.tkrpack`.
* `docs/spec/formats/tkr-authoring.md` is the normative page; code follows it (G7, docs first).
* Golden tests are unaffected: the runner's inputs do not change.

## Alternatives considered

* **Sidecar next to `.brd`** (the `.brd` stays the source). Rejected: two sources of truth, and every helper has to reconcile its data with an edited `.brd`.
* **Native runtime format now.** Rejected for now: it needs engine work, new goldens and a hydration path, and nothing the editor needs today requires it.
* **JSON.** Rejected by the owner: no comments, noisier diffs. YAML under the restrictions above keeps JSON's determinism.
* **`.tkscn`.** Rejected: new formats use the `tkr` prefix (decision 1).

## Amendment (proposed 2026-11-11): one editor, two files; the common stamp

Proposed from the owner's answers of 2026-11-11 on [#1839](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1839). Merging the change that adds this section is his approval. Until then the text above stands.

In plain terms: the scene editor is one editor. It can open and save an old board as it is, or work on a scene, which can hold more. Nothing is converted unless the author asks.

1. **The stamp is the common one** (replaces the second sentence of decision 1). A `.tkr*` document starts with `contract` and `version` as [native-contracts.md](../spec/formats/native-contracts.md#stamp) defines them. The `schema: tkr-<kind>/<major>.<minor>` identifier is withdrawn. The three formats are pre-release (`1.0.0-pre.N`): version 1.0.0 is a promise ([ADR 0023](0023-native-data-contracts-versioning-identity-and-sidecars.md) decision 2) and they have not made it.
2. **The extensions stand** (`.tkrscn`, `.tkrtile`, `.tkrpack`). ADR 0023 decision 11 is amended in the same change so that a kind code is three or more letters.
3. **One contract page each.** [tkr-authoring.md](../spec/formats/tkr-authoring.md) is the draft that the scene contract of story 27.8 and the tileset and asset-pack contracts are written from. There is one scene contract, not two. Each extension enters the native registry with its contract page.
4. **The scene editor is written against the scene model and saves to either file** (replaces consequence 1 and decision 5's "opening a legacy `.brd` creates a `.tkrscn` by import").
   * A **`.brd` with no scene** is opened, edited and saved directly through the board writer. It stays first-class editable ([ADR 0005](0005-independent-product-v1-and-native-format.md) amendment; [ADR 0022](0022-shared-editor-authoring-contracts.md) D2). Opening it creates nothing.
   * A **`.tkrscn`** is the source of truth for its board, and decision 4 applies as written: saving builds the `.brd`, which is then a build output watched by hash.
   * A feature only a scene can store is **shown and unavailable** on a `.brd`, with its reason and one action, *convert to a scene*. Conversion is explicit, is reviewed before it writes, creates the `.tkrscn` beside the board and keeps legacy indices and unmodelled fields (AD-18). It is never done on open or on save.
5. **What a scene, a tileset and a pack add** is the reason for this ADR and is unchanged: stable identities for floors and objects; which placed asset produced which records; how a wall was traced; and **collision and walk-behind stored with the art** (a tile's `collision` and `wallCapUnder`, a pack asset's `solid` and `under` vectors), from which the editor builds the board's vectors.
6. **Timing.** These three formats come forward into the first release for the scene editor ([ADR 0005](0005-independent-product-v1-and-native-format.md), second amendment). Every other native contract stays deferred.

**Still to prove before the scene save path is built:** ADR 0022 D2 makes the host's text document the authority for a native text file. A canvas that edits YAML through structured commands is first proved on the animation clip (story 27.6).
