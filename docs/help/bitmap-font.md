# Drawing a bitmap font

A bitmap font is the game's own lettering: 256 characters, each drawn as an 8 × 8 grid of square pixels. Open a `.fnt` file from the project, or choose **New font…** in the Files panel (in VS Code, **RPG Toolkit: New font**) to make one.

New font checks whether the path already exists before writing. Both hosts warn that another application can still create the same path after that check; the write may replace that file.

## Choosing a character

The character strip shows all 256 slots in order: slot 0 is the top left, then across each row and down. A slot with a drawn glyph is bold. Click a slot, or use the arrow keys: Left and Right move one slot, Up and Down move 16, Home and End go to the ends of the row, and Ctrl+Home and Ctrl+End go to the first and last character. Choosing a slot changes nothing in the font.

## Drawing a glyph

The glyph grid shows the selected slot as eight rows of eight pixels. The top left pixel is the first pixel of the first row, which is the order the file stores.

- **Draw** (the default) adds ink; **Erase** removes it. Press on a pixel and drag to draw a line of them. The grid shows the stroke as you go and the whole stroke becomes one change when you let go, so one Undo takes it all back. Escape, or a stroke the pointer cancels, throws the unfinished stroke away.
- From the keyboard, the grid is one stop: the arrow keys move the cursor, Space or Enter uses the current tool once, and Delete or Backspace erases the pixel under the cursor.
- **Clear glyph** empties the selected character in one change.

A stroke that changes nothing is not a change at all, so the font does not become unsaved for it.

## Seeing it in a sample

The sample panel draws a line of text with the font as it is right now, saved or not. Type any sample, choose a size from 1 to 128 pixels, and switch **Bold**, **Italics** and **Underline** on and off. **Zoom** makes the picture bigger without smoothing it, so what you see are the pixels the game will draw.

These settings belong to the panel: they are never saved and never change the font. The text is laid out the way the game's `text()` lays it out — a line is one size tall — and it wraps at words when it grows past the panel.

The picture is drawn with the game's own rule. Each glyph pixel becomes a square, or a block when the size is bigger than 8. Bold adds a pixel to the right of every inked pixel, italics lean the glyph by moving each row to the right a little more than the row below it, and underline is a separate line under the text. Nothing is smoothed, so there are no grey edges.

## Saving and using the font

Use the glyph panel's **Undo** and **Redo** buttons to take back or restore a stroke or a keyboard edit. With the grid focused, use Ctrl+Z and Ctrl+Y, or Cmd+Z and Cmd+Shift+Z on macOS. These controls use the host's history. Save writes the file and keeps every character you did not touch exactly as it was. Only version 2.0 fonts can be edited. If you open another readable version, or a file the editor cannot write back byte for byte, you can inspect it but not change it.

In VS Code, wait for an Undo or Redo to finish before invoking another one from the Command Palette. If VS Code warns that an undo or redo is already running, it did not queue your command. Wait for the change to appear and then invoke the command again.

If History rejects a restore because the selected version can only be inspected, close the font and restore it from History. This recovers the original bytes without converting them. Reopen the font to inspect it.

Save the font in the project's `Font` folder to use it in the game. Then `font("name")` selects it by its file name, and `text()` draws with it, in the game and in a runner, the same way as the picture above.
