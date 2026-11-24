---
type: feature
title: "Restore the legacy bitmap font editor"
ticket: 20
tracker_id: "#1939"
status: built
risk: medium
---

## Intent

Let authors create and edit retro game lettering using the glyph grid, character strip and sample preview of the older Toolkit font editor. [T-65](../../../docs/editor-features.md#t-65-bitmap-font-editor) maps to CAP-16.

## Scope and acceptance

Create and open `.fnt` documents through the existing project editor. Select any of the 256 slots and paint or erase ink in its 8 × 8 grid. Make the character selector and pixel grid usable with a keyboard. Preview sample text at a chosen size, with bold, italics and underline. Keep those settings in the view so changing the preview makes no edit to the font. Use shared document identity, undo, redo and save. Reuse the existing bitmap format and rendering code.

## Verification

In both hosts, edit pixels at opposite corners and in different glyphs, undo and redo, save and reopen, and compare glyph rows to an independent expected bitmap. Check an untouched glyph and confirm preview changes leave the document clean. Check visible, hard-edged glyphs at 8 px and 20 px and compare each style with the runner's preview of the same sample. Exercise the saved asset in the runner through `font()`. Check that a refused save leaves the pending glyph edits available for retry.

## Dependencies and decisions

Prerequisite: 13.1 (#1727) supplies the shared feature registration and project document route. The [.fnt format](../../../docs/spec/formats/legacy/text-formats.md#font-toolkit-2-text) supplies the file contract. The archived visual description shows the grid, strip and preview. It does not establish keyboard bindings or the original glyph commit workflow. T-65 supplies the Reawakened interaction scope. Keep the startup font compatibility issue (#1938) separate.

The engineer's notes flag a suspected legacy scaling failure above 8 px and describe synthetic styling with antialiasing off. The scaling failure is unverified. Use Reawakened's bitmap rasterizer for visible enlarged glyphs and crisp styling. Synthetic bold and italic and a separate underline belong to the preview, while the saved rows stay monochrome.

[#1942](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1942) tracks a future extension for larger glyph grids. The 8 × 8 legacy grid and the preview's display size are independent. Larger authored glyphs will need their own asset specification.

## Proposed rulings (pending owner review; entry 13.20)

Each is also written into `docs/` in this ticket's first commit.

1. **A project `.fnt` in `Font\` is installed by the engine.** *Lands in:* `docs/spec/engine/display-input-audio.md#reawakened-project-bitmap-fonts`, `docs/spec/engine/runners.md#draw-list`. *Evidence:* the acceptance asks that the edited glyph be drawn "in the runner using `font()`", the family rule in the same page already says "A `.fnt` is selected when the name resolves to one", but `privateFontKeys` (`packages/core/src/engine/boot.ts`) accepts only `.ttf`, so today `font("mine")` over `Font/mine.fnt` selects the key `font/mine.fnt` and then draws nothing (observed with a throwaway engine test, 2026-11-24: no `text` command in the draw list, zero lit pixels). *Rejected alternative:* leave project `.fnt` files unread, as E-132 says Toolkit 3.1 does, and prove the saved font only through the editor's preview; that would leave the acceptance's runner clause unproven and the editor's output unusable in a game. *If ruled otherwise:* the engine, runner-web and golden changes of this ticket are dropped and the runner clause of the acceptance becomes a documented gap.
2. **Bitmap ink is specified as it is implemented.** *Lands in:* `display-input-audio.md#reawakened-bitmap-font-ink`. *Evidence:* `legacyInk`, `emitText` and `bitmapFontMetrics` already draw it; the spec only said `textInk` "owns" it. *Rejected alternative:* have the editor preview a rule of its own, which could drift from the player. *If ruled otherwise:* the code is the authority and the preview follows it through the same functions.
3. **New font starts empty.** *Lands in:* `docs/editor-features.md#t-65-bitmap-font-editor`. A new font has all 256 glyphs empty at version 2.0. *Evidence:* the format has no default content; the bundled `media/fonts/tkr-8x8.fnt` is an engine asset the editor cannot read. *Rejected alternative:* copy the bundled default font into every new project font; it bakes a second copy of generated glyphs into the editor bundle. *If ruled otherwise:* only the new-font bytes change.
4. **A stroke is one edit; the character is one `set-font-glyph` command.** A pointer drag across cells commits one command carrying the glyph's eight new rows, so one Undo takes back the stroke. *Evidence:* the tileset artwork editor commits a stroke as one command (`paint-tileset-pixels`). *Rejected alternative:* one command per pixel, which makes undo take a stroke back one pixel at a time.
5. **The kind's storage class is `"legacy-text"` and it follows ADR 0022 D2 row 1.** *Lands in:* ADR 0026 implementation notes.

## Implementation notes (2026-11-24)

**Landed.** `packages/editor-model/src/font-document.ts` (the `font` kind, `.fnt`, `legacy-text`), `font-preview.ts` (the sample picture through `emitText` + core `rasterize`), `font-support.ts` (`New font`), the registry row and `asFontDocument`, the conformance row, `packages/editor-ui/src/font-view.tsx` and its stylesheet section, the Files-panel `New font…` button, the browser workbench `newFont`, the VS Code `tkr.font` custom editor and `tkr.newFont`, the help page and CHANGELOG entry, and the engine's installation of a project `.fnt` (`privateFontKeys`, `installedFontAssets`, runner-web decode).

**Decisions taken and why.** A stroke is one `set-font-glyph` command carrying the glyph's eight rows, so one Undo takes a stroke back whole; a keyboard action is one such command. The view keeps each glyph's submitted-but-unanswered rows and builds the next edit on them, so a second stroke never undoes a first while a host answers late (#2613's pending-edit rule also covers save and close). The preview lays out as `text()` does (one size per line) and is drawn by the core rasteriser rather than by a second renderer; the size, sample, styles and zoom are view state only. A host without a 2D canvas says so instead of showing a blank canvas. `.fnt` follows ADR 0022 D2 row 1 even though it is text, because it has a same-version writer; its `StorageClass` is the new `legacy-text`.

**Evidence.** Model: `packages/editor-model/test/font-document.test.ts` (round trips, opposite-corner edits saved as the format's rows, untouched glyphs intact, refusals, refused save keeps edits, read-only open, preview equals the spec's pixels at 8 and 20 px in every style, new-font bytes). Engine: `packages/core/test/render-now.test.ts` and `engine-boot.test.ts` (the glyph drawn by `font()` at 8 and 20 px in every style, underline rows, bitmap metrics, install and `font.rejected`). Runner: `packages/runner-web/test/game-fonts.test.ts`. View: `packages/editor-ui/test/font-view.test.ts`. Hosts: `tools/editor-vscode-test/test/font-hosts.test.ts` (browser host, VS Code desktop and VS Code for the Web: edit at opposite corners by pointer and keyboard, save, close, reopen, file equals hand-written bytes, an untouched glyph intact, preview settings leave the document clean).

**Not proved here (and why).** The preview's pixels are proved against the core rasteriser in the model test and the engine's `font()` in the core tests, not in the headless host lanes: their DOM shim has no 2D canvas, so those lanes check the view reports the missing canvas and leaves the document clean. A real-browser Playwright case for the editor surface (and a VS Code web proof) is the remaining host-lane work before the ready-for-review gate. `tkr.newFont` and the workbench `New font…` are covered by the shared `createFontFile` contract test; their dialogs are host chrome.

**Gates run locally (2026-11-24, Node 26.13.0):** `tsc -b`, every package's `typecheck:tests`, `pnpm graph`, `pnpm lint` (eslint + core deps), `pnpm licence`, `pnpm provenance`, `pnpm catalogue:check`, `pnpm editor-ui-toolchain:check`, `pnpm adr:numbering:check`, `pnpm golden`, `pnpm golden:bun`, `pnpm closing`; focused suites listed above (299 passing, 9 pre-existing skips). Not run: `pnpm test:strict` over the whole repository, `fixtures:author:check`, `fixtures:test`, `browser:test`, `script:dogfood`, the Android/desktop proof.
