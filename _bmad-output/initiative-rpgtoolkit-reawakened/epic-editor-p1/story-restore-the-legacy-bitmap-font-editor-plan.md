---
type: story
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
