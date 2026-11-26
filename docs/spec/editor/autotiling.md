# Board editor: autotiling

> **Provenance.** Clean-room behavioural description of the Toolkit 3.1 editor's autotiler, supplied for [#1732](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1732) on 2026-11-26. It describes behaviour only and contains no legacy code. It is the source for [T-25](../../editor-features.md). The black-box probe in [`tools/research/autotile-probe/`](../../../tools/research/autotile-probe/README.md) checks it against the released editor.

The original editor's board editor has an **autotiler**. When it is switched on, painting or erasing a tile also reshapes the neighbouring tiles. Tiles from the same autotile set then join into areas with edges and corners. Typical uses are grass patches, water, paths and walls.

Autotiling happens only while you edit. The board file stores the chosen tiles as ordinary [tile references](../formats/README.md#tile-references). Nothing in the board marks a tile as an autotile, and the original engine does no autotiling at run time.

## 1. Autotile sets

### 1.1 How a tileset becomes an autotile set

A tileset counts as an autotile set when its **tile reference starts with `AUTOTILES_`**, in any letter case (for example `AUTOTILES_grass.tst` or `autotiles_water.tst`). The editor looks only at the name. It does not inspect the file, check the number of tiles, or read any per-tile metadata.

Each distinct tileset file name is a separate set. A set links only to tiles from the same file. The comparison of two set names is case-sensitive, so `AUTOTILES_grass.tst` and `AUTOTILES_Grass.tst` count as two different sets.

**Compatibility note:** the prefix is tested against the whole tile reference, folder included. A set stored in a sub-folder (`terrain\AUTOTILES_grass.tst`) is therefore **not** recognised and is placed like an ordinary tile. A rebuild that keeps the naming rule should apply it to the file name only, and should still accept the root-folder sets that existing projects use.

Both square (`.tst`) and isometric (`.iso`) tilesets can be autotile sets. The board's coordinate type decides which neighbour rules apply (section 3), not the tileset type.

### 1.2 Tile layout

A set needs a tile for every way a cell can connect to its eight neighbours. A cell **connects** in a direction when the neighbour in that direction holds a tile from the same set.

Corners are restricted. A diagonal connection counts only when both cardinal directions next to it also connect. For example, NE counts only if N and E both connect. This rule leaves exactly **47 possible shapes**. The original editor assigns them to fixed tile numbers between 1 and 52.

| Tile | Cardinal links | Corner links |
|---|---|---|
| 1 | N S W E | NE SW SE |
| 2 | N S W E | NW SW SE |
| 3 | N S W E | SW SE |
| 4 | N S W E | NW NE SW |
| 5 | N S W E | NE SW |
| 6 | N S W E | NW SW |
| 7 | N S W E | SW |
| 8 | N S W E | NW NE SE |
| 10 | N S W E | NE SE |
| 11 | N S W E | NW SE |
| 12 | N S W E | SE |
| 13 | N S W E | NW NE |
| 14 | N S W E | NE |
| 15 | N S W E | NW |
| 16 | N S W E | none |
| 17 | N S E | NE SE |
| 19 | N S E | SE |
| 20 | N S E | NE |
| 21 | N S E | none |
| 22 | S W E | SW SE |
| 23 | S W E | SW |
| 24 | S W E | SE |
| 25 | S W E | none |
| 26 | N S W | NW SW |
| 28 | N S W | NW |
| 29 | N S W | SW |
| 30 | N S W | none |
| 31 | N W E | NW NE |
| 32 | N W E | NE |
| 33 | N W E | NW |
| 34 | N W E | none |
| 35 | N S | none |
| 37 | W E | none |
| 38 | S E | SE |
| 39 | S E | none |
| 40 | S W | SW |
| 41 | S W | none |
| 42 | N W | NW |
| 43 | N W | none |
| 44 | N E | NE |
| 46 | N E | none |
| 47 | S | none |
| 48 | E | none |
| 49 | N | none |
| 50 | W | none |
| 51 | none (isolated) | none |
| 52 | N S W E | NW NE SW SE (fully surrounded) |

How to read the table:

- **"Corner links"** means the corner neighbour belongs to the set. Drawn as art, a missing corner link where both adjacent sides connect is an *inner corner*: the area turns a corner there.
- **Unused numbers:** tiles 9, 18, 27, 36 and 45 are never placed. Their slots can hold anything, or nothing. A complete set therefore needs at least 52 tiles, of which 47 are used.
- **Every shape has a tile.** Because of the corner rule, a cell can never end up with a shape missing from the table, so the editor never needs a fallback tile.
- **Missing tiles in a set:** if a set is shorter than 52 tiles, the editor still writes references to the higher tile numbers, and those cells draw as blank. The editor gives no warning.
- [Inference] The unused numbers fall every ninth slot. That fits tile sets drawn in a grid nine tiles wide where each row ends with a spare tile. The original editor does not require any grid.

The original program did not ship an autotile set or a tool for making one. Its help pointed users to a community download, which no longer exists.

## 2. Turning the autotiler on and off

- The board editor's tool palette has an **Autotiler** toggle with the keyboard shortcut **H**. It starts off.
- The setting belongs to each open board editor window. Switching windows shows that window's own setting. It is not saved in the board or in the project.
- The toggle changes only the **Draw** and **Erase** tools (including right-click erase while in Draw). Selection and the other board settings (vectors, programs, sprites, images, lighting) are unaffected.
- **Fill** and **Rectangle** are refused while the autotiler is on. Clicking with either shows an information message and changes nothing.
- The autotiler always ignores **tile bitmaps** (`.tbm`). Painting one stamps its tiles exactly as stored, and the stamped tiles do not cause any neighbours to reshape.

## 3. What happens on a click

Everything below happens on the **current layer only**. Tiles on other layers never connect and are never changed.

### 3.1 Draw with an autotile set selected

1. **Seed.** The clicked cell receives the set's isolated tile (51), whichever tile of the set was picked in the tileset window. So with the autotiler on, the picked tile number does not matter; only the set does.
2. **Reshape.** The editor then visits every cell in the region around the clicked cell (section 4), including the clicked cell itself. For each visited cell that holds a tile from *any* autotile set:
   - it works out which neighbours belong to that cell's own set;
   - it applies the corner rule;
   - it replaces the cell's tile with the matching tile from section 1.2.
3. Cells in the region that hold ordinary tiles, or no tile, are left alone.
4. Results are always worked out from the board as it is at that moment, cell by cell in row order. Each rewrite changes only tile numbers within a set, never which set a cell belongs to, so the visiting order does not affect the result.

### 3.2 Draw with an ordinary tile selected

The tile is placed exactly as picked. The neighbourhood is then reshaped as in step 2. Any autotiles next to the new tile lose their link to that cell and gain an edge facing it.

### 3.3 Erase

The cell is cleared. The neighbourhood is then reshaped as in step 2, so surrounding autotiles close off around the hole.

### 3.4 Holding Shift

With **Shift** held during the click or drag, the reshape step only touches cells from the **same set as the clicked cell after placement**. This lets you paint one set against another without disturbing the other set's edges. The consequences are:

- painting an autotile with Shift reshapes only that set;
- painting an ordinary tile or erasing with Shift reshapes **nothing**, because the clicked cell is not in any set. Neighbouring autotiles keep their old shape and still look connected to the cell.

### 3.5 Dragging

Holding the button and moving repeats the click for every cell the pointer passes over, including repeated events on the same cell. The result is the same as clicking each of those cells in turn.

### 3.6 Undo

Pressing a mouse button in tile mode takes one undo snapshot. Everything until the button is released counts as **one undo step**: the whole stroke, plus every neighbour the autotiler reshaped along the way. Undo and Redo restore the whole board as it was, so the reshaped neighbours roll back together with the painted cells.

### 3.7 Edges and existing tiles

- Cells outside the board never connect. An area that reaches the board edge shows an edge there.
- Only cells inside the reshape region of an edit change. Autotiles that were placed while the autotiler was off, or that came from another program, keep whatever tile they hold until a nearby cell is edited with the autotiler on. Turning the autotiler on does not fix up the rest of the board.

## 4. Neighbours by board type

Board cells are numbered from 1 in both directions, with x increasing to the right and y increasing downward.

### 4.1 Standard boards and rotated isometric boards

The neighbours are the eight surrounding cells:

| Direction | Cell |
|---|---|
| N | (x, y−1) |
| S | (x, y+1) |
| W | (x−1, y) |
| E | (x+1, y) |
| NW | (x−1, y−1) |
| NE | (x+1, y−1) |
| SW | (x−1, y+1) |
| SE | (x+1, y+1) |

The reshape region is the 3 × 3 block centred on the edited cell, clipped to the board.

### 4.2 Stacked isometric boards

Rows are staggered: odd rows sit half a tile to the right of even rows. The four sides of a diamond tile touch the four diagonally adjacent diamonds, and these count as the **cardinal** directions. The tiles straight above, below, left and right only touch at a point, and these count as the **corner** directions. In terms of the screen:

| Direction | On screen | Cell, even row y | Cell, odd row y |
|---|---|---|---|
| N | up-right | (x, y−1) | (x+1, y−1) |
| E | down-right | (x, y+1) | (x+1, y+1) |
| S | down-left | (x−1, y+1) | (x, y+1) |
| W | up-left | (x−1, y−1) | (x, y−1) |
| NE | right | (x+1, y) | (x+1, y) |
| SE | straight down | (x, y+2) | (x, y+2) |
| SW | left | (x−1, y) | (x−1, y) |
| NW | straight up | (x, y−2) | (x, y−2) |

The reshape region spans x−1 to x+1 and y−2 to y+2 (5 rows × 3 columns), clipped to the board. That covers every cell that can count the edited cell as a neighbour. The corner rule and the tile table are the same as for square boards. The art in an isometric autotile set must be drawn to match these directions.

## 5. Notes for a rebuild

- **Loading existing projects:** only the tile references on the board matter. The rebuild can load existing projects without understanding autotiling.
- **Matching the original editor:** an editor that wants to behave the same way needs four things: the naming rule (1.1), the tile table (1.2), the reshape rules (3) and the two sets of neighbour rules (4). Shift-to-isolate (3.4) and one-undo-step-per-stroke (3.6) are what users will notice most.
- **Known gaps you may choose to close:**
  - Fill and Rectangle are unavailable in autotile mode.
  - Sub-folder sets are not recognised (1.1).
  - Shift combined with erase leaves stale neighbours (3.4).
  - There is no check that a set has enough tiles (1.2).
  - Autotile sets are identified by name only.

  An editor that marks sets explicitly should still recognise the `AUTOTILES_` name and this tile numbering when importing older sets.
