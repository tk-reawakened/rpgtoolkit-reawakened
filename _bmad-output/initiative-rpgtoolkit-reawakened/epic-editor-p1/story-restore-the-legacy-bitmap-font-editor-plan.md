---
type: feature
title: "Restore the legacy bitmap font editor"
ticket: 20
tracker_id: "#1939"
status: draft
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
