# Lights and shading on a board

Shading and lights change the colour of the tiles on a board. Use them to make a room warm, a cave dark, or a sunset glow, without drawing new art. Open a board and use the **Lights and shading** section.

## Shading

Shading tints each board cell. Every cell holds three whole numbers, red, green and blue, each from −255 to 255. A positive number brightens that colour and a negative number darkens it. 0 changes nothing. A board keeps one shading layer, and it tints the layer it is cast onto and every layer below it.

Choose **Paint shading on the board**, then a tool:

- **Draw** paints one cell per click or drag. A right-click erases.
- **Erase** sets cells to 0, 0, 0.
- **Rectangle** draws an outline between two corner cells. Hold Shift to fill it. It counts cells, so on an isometric board it is not a rectangle on screen.
- **Flood fill** replaces the connected area. Red, green and blue each flood on their own, so where the channels differ the areas can differ.
- **Dropper** copies a cell's shade into the brush and changes nothing in the board.

Set the brush with the Shade red, green and blue fields. **Shade grey** sets all three together, and **Zero RGB** sets them to 0. The brush starts at 64, 64, 64, and there is no brush size. Values you type are kept between −255 and 255.

From the keyboard, move over the cell grid with the arrow keys and press Space to use the tool on that cell. Rectangle takes two Spaces, one on each corner, and Escape cancels it. **Shade cell** with the column and row fields shades one cell by number.

One drag, fill or Space is one edit, and one Undo takes it back.

## Lights

A light adds colour to the cells it reaches when the board loads. **Add spotlight** and **Add gradient** place a new light in the middle of the board. A light stays editable until you convert it.

- **Spotlight:** a soft oval. Its middle node is the centre and the other two, Radius point 1 and Radius point 2, are points on its edge. The longer radius sets the angle of the oval and the shorter one its width. The edge and everything beyond it get no light. A radius of 0 lights nothing.
- **Gradient:** colour fades from the start node to the end node, and the end colours continue beyond them.
- **Clipped gradient:** the same fade, but only between two lines at right angles to the axis, one through each node. Nothing is lit outside them.

Each light has two shades. For a spotlight they are the shade at the edge and at the centre, and for a gradient the shade at the start and at the end. The fade is a straight line between them. A new light's second shade is the current brush and its first is 0, so it fades to nothing.

Drag a light's numbered dots on the board after choosing **Move lights on the board**, or type node X and Y positions in board pixels. Positions are whole pixels with the top-left of the board at 0, 0.

Exactly how it is worked out: each board cell is tested at its top-left corner, `((column − 1) × 32, (row − 1) × 32)` on a normal board and at the centre of its diamond on an isometric one. The light's value there is added to the cell's painted shade, and the sum is rounded toward zero once per light. Overlapping lights add. Nothing is capped at 255 while it is stored; the picture clamps the final colour.

**Convert to shading** adds one light into the board's shading and removes the light. It is one edit, so one Undo brings the editable light back. Convert needs a board with at most one shading layer.

## Seeing the result

The picture shows shading and lights together. **Draw tile shading** and **Draw lighting** hide either one in the picture only. Neither changes the board file.
