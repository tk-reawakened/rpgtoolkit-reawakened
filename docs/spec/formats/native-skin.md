# Native skin contract (`skin`, version `1.0.0-pre.1`)

**Status: accepted pre-release contract.** This is TK Reawakened's native skin document, approved by the owner in [ADR 0045, option 3A](../../adr/0045-visual-source-skin-and-setup-delivery-contracts.md#owner-decisions) and [T-64](main-file.md#editor-skin-authoring). It is an editor document only: the engine does not read it, and it does not change how a game looks. The version is pre-release and may change before a published 1.0.0 promise ([native contract versioning](native-contracts.md#versions)).

## In plain words

A skin document names the picture used for a window and the picture used for a button. The editor can show each actual picture next to its role, so you can check what you chose. That is an editor preview, not a promise that the game will use either picture. The two old skin names in the `.gam` file remain untouched.

## Document shape

The document is YAML and uses the common [native stamp, version, path identity and preservation rules](native-contracts.md). It is named by its project-relative path, including `.tkrskin`; no document-level `id` is stored.

```yaml
contract: skin
version: 1.0.0-pre.1
label: Stone keep
windowImage: bitmap/stone-window.png
buttonImage: bitmap/stone-button.png
```

The stamp is first. `label` may be omitted. The two graphic references are required. The common optional `tags`, `metadata` and `pluginData` keys are also accepted as specified by `native-contracts.md`.

| Key | Required | Type | Meaning |
|---|---|---|---|
| `contract` | yes | text | Always `skin`. |
| `version` | yes | text | `1.0.0-pre.1` with an optional build suffix. The editor preserves the version it opened. |
| `tags` | no | list of non-empty text | Common native-document labels. |
| `metadata` | no | mapping | Common native-document information. |
| `label` | no | non-empty text | Optional name shown by authoring tools; it has no gameplay meaning. |
| `windowImage` | yes | asset reference | The image to show in the window-graphic role. |
| `buttonImage` | yes | asset reference | The image to show in the button-graphic role. |
| `pluginData` | no | mapping | Common native plugin blocks. |

An asset reference is a non-empty project-relative image path using `/`, such as `bitmap/stone-window.png`, with its image extension. It follows the common native [path identity](native-contracts.md#identity) rules: ASCII case-insensitive identity and lowercase spelling when the editor writes a new reference. It is not a native-document ID. The selected asset must be a still image supported by [the shared image decoder](images.md#the-shared-decode-contract); a missing or unreadable image remains visible as a preview problem, not as a fabricated image.

Unknown top-level keys are invalid. A reader rejects a missing or repeated stamp, a stamp that is not first, an unsupported contract/version, repeated keys, an empty or malformed image reference, or a missing required image reference. The optional label, when present, is non-empty text. Nothing in a skin document describes a screen layout, dimensions, scaling, button states or runtime behavior.

## Authoring, preview and preservation

The editor offers one asset picker for each role. Choosing an image updates only that role's reference and is an edit; cancelling changes nothing. The preview shows the exact selected image for each role, with accessible names that identify the role and reference. It is labelled **“Preview only: the engine does not use skins yet”** and does not simulate a game screen or suggest runtime support.

Saving a skin preserves its opened contract version and all content the editor does not own: comments and formatting, `tags`, `metadata`, plugin blocks and other accepted YAML residue. An edit changes only the selected property in the original text; it does not parse and reprint the whole document. If a safe edit or save cannot be made, the editor refuses it and keeps the unsaved draft. Opening, previewing or selecting an image without confirming a picker choice is not an edit.

This document is independent of the legacy main file. Opening or saving it never writes `.gam` fields 35 (`skinButton`) or 36 (`skinWindow`), and those fields remain unchanged. The engine ignores both legacy fields and does not consume `.tkrskin`.

## File name

Store this contract under `.tkrskin`, registered as `skin` in the [native document registry](native-contracts.md#the-registry). The extension and `contract: skin` must agree. A `.tkrskin` file is a separate native document; it does not replace a legacy file or change game packaging.
