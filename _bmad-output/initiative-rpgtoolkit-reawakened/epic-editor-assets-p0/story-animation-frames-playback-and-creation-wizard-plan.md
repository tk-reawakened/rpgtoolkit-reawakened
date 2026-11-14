---
type: feature
title: "Animation frames playback and creation wizard"
ticket: 7
status: draft
---

# Animation frames playback and creation wizard

## Goal and boundaries

Implement story 12.7 / #1718 as a shared `.anm` authoring document and editor, in `editor-model` and `editor-ui`, usable in the browser and VS Code hosts. Support ordered frame append/insert/delete/reorder and selection/navigation (respecting the format's 51-slot ceiling); frame image, transparency key and sound; clip-wide delay (`globaldelay`) and canvas width/height; preview playback; sorted-image and 4×4-tile composition wizards. Each composed animation frame becomes a named `.tbm`. The first resulting frame initializes canvas size and key. Frame-associated sound/key must move with its image. Scope is not the proposed `.tkranm` native clip or a second tile browser.
**Baseline:** `origin/main` at `25c0b2b`; implementation branch `feat/1718-animation-authoring`.

## Verified code map

- Format contract: `docs/spec/formats/animation.md#layout` (image, COLORREF transparency and sound per stored frame; width/height and delay after frame slots; 51 slots in legacy editor, empty slots retained on disk but skipped during playback). `docs/spec/formats/tiles.md#tile-bitmap-tbm` defines 1–40 tile grids and the stored padding row/column.
- Existing provider: `packages/core/src/formats/animation/{model,reader,writer}.ts` exposes `Animation`/`AnimationFrame`, preserves image spelling and trailing `residue`, and has same-version binary byte round-trip. `readAnimation` also reads Toolkit 2 text minor 0; `writeAnimation` writes binary only. Per ADR 0022 D2, minor 0 is intentionally read-only with the explicit no-same-version-writer reason; do not convert or imply an edit path. New and editable documents use binary minor 3. `.tbm` serialization is in `packages/core/src/formats/tile-bitmap/{model,reader,writer}.ts`.
- Model precedent: `packages/editor-model/src/{binary-document.ts,tile-bitmap-document.ts,sprite-document.ts,kinds.ts,index.ts}`. Add an animation codec/document with plain serializable commands and snapshot, validating commands and values; reuse `BinaryDocument` history, undo/redo, save/conflict and exact-writeback checks. Keep frame fields in one record through reordering; do not mutate source bytes or write during wizard preview.
- UI precedent: `packages/editor-ui/src/{mount.ts,tile-bitmap-view.tsx,tileset-browser.tsx,sprite-view.tsx,use-document.ts}`. `TileBitmapView` demonstrates snapshot subscriptions, refusal feedback, keyboard grid and composed preview. `TilesetBrowser` shares retained browser session and selection; browsing only selects, never paints. `SpriteView` already uses project asset reads and animation image/tile/TBM preview helpers in `sprite-document.ts`.
- Integration map: add `.anm` to `editor-model/src/kinds.ts` and public exports, mount animation view in `editor-ui/src/mount.ts`, and wire browser context through it. Route through `packages/host-web/src/index.ts` and the VS Code custom-document/webview path (`packages/host-vscode/src/{custom-editor.ts,extension.ts,webview.tsx,document-bridge.ts}`; add the view type in `extension.ts`), preserving one model per project URI. Do not fork lifecycle or filesystem behavior by host.
- Tests to add/update: `packages/editor-model/test/{animation-document.test.ts,kind-conformance.test.ts}`; `packages/editor-ui/test/animation-view.test.ts`; host-web/host-vscode custom-editor open-save-reopen conformance. Reuse authored small fixtures; do not copy legacy source or game assets into fixtures.

## Implementation sequence

1. Follow ADR 0022 D2: open binary minor 3 as editable through the same-version writer; open readable text minor 0 read-only with a clear “no same-version writer” reason. Never offer read-write open, convert, or downgrade text. Create new authoring documents in binary minor 3. This is settled policy, not a docs/provider gate.
2. Add `AnimationDocument` commands for frame list operations, per-frame fields, canvas size and delay. Preserve header/version, every untouched/empty slot, and residue; only trim trailing empty slots when writing if explicitly consistent with the `.anm` editor rule. Refuse invalid/no-op commands without altering the document. Establish first-frame width/height/key only when creating wizard output; later frames retain independently selected keys.
3. Add a keyboard-operable editor with selected-frame list, add/insert/delete/move controls, previous/next navigation, accessible playback start/stop/step, image/key/sound pickers, delay and dimensions. Preview must use shared image/tile/TBM decoders and canvas/key composition, not a separately invented renderer. Saving remains the shared document lifecycle.
4. Stage both wizards entirely in memory. Image wizard reads selected project pictures, sorts deterministically by normalized project path (show resulting order and allow reorder), then builds frames. Tile wizard uses the shared browser for tile selection, composes each 4×4 selection into an actual TBM, and assigns proposed names plus the ANM destination. Validate every destination/collision first and request overwrite consent before writes. On confirm, commit generated TBMs in a fixed order and write the ANM last; follow ADR 0022 D4/D12: before any write, cancel/failure leaves sources and destinations untouched; after partial writes, stop and report each written/skipped/pending file with retry-remaining/leave-as-is, never claim atomic rollback. Record the multi-file operation in one checkpoint group and integrate the D12 recovery provider rather than making recovery conditional on host.
5. Register the shared view/document in both hosts, route save/undo/reopen and wizard confirmation via host services, and keep browser session state project-scoped. Capability absence is explained; no host-specific editor implementation.

## Acceptance: Given / When / Then

- **Given** a supported binary animation with empty/interior slots, non-default frame keys/sounds, version and trailing residue, **when** frames are inserted, deleted, reordered and edited, **then** each frame's image/key/sound remains paired, untouched fields/residue survive, undo/redo restores the prior sequence, and save→close→reopen matches the authored model and unchanged bytes where applicable.
- **Given** a multi-image selection and existing animation, **when** the sorted-image wizard previews, reorders, then cancels, **then** neither input nor destination changes. On confirmation, frames follow displayed order and first-frame dimensions/key initialize the canvas.
- **Given** 4×4 browser selections and occupied proposed filenames, **when** the tile wizard is canceled or overwrite is declined, **then** all sources/destinations remain unchanged. On confirmation, reopened named TBMs compose to the expected 4×4 tile pictures, and the reopened ANM references them in frame order with attached sound/key.
- **Given** a write failure on either host, **when** a multi-file commit stops, **then** the error identifies completed and pending files, retains source edits and remaining staged work, and offers documented recovery choices; it never reports success or erases written output.
- **Given** the same fixture in browser and VS Code, **when** each opens, edits, saves, closes and reopens it, **then** both use shared model/view behavior and preserve the same supported-format fields; keyboard-only navigation and playback controls are operable and labeled.
- **Given** a readable text minor-0 animation without a same-version writer, **when** it is opened, **then** the document is read-only with the D2 reason, no edit/wizard write is offered against it, and its source bytes remain unchanged.

## Dependencies and decision gate

Prerequisites #1713 (12.2 shared browser), #1717 (12.8 tile bitmap document/editor) and #1699 (11.1 wizard recovery) are reported closed; consume their merged contracts, not duplicate providers. Follow `docs/adr/0022-shared-editor-authoring-contracts.md` D2/D4/D12 and `discovery/inception-proposal.md` composition lane. **Owner review of this plan is complete; proceed with binary minor-3 authoring and D2 read-only handling for text minor 0.** Keep multi-file cancellation/failure behavior honest to D4: no cross-document atomicity or rollback claim.
