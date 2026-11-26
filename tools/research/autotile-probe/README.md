# Auto-tile black-box probe (#1732)

Checks the clean-room specification [docs/spec/editor/autotiling.md](../../../docs/spec/editor/autotiling.md) against the **released Toolkit 3.1 editor**, by observing it, not by reading its source (G7). We paint a known shape with our own numbered tiles, save the board, read back the tile numbers the autotiler chose and compare them with the spec's table.

The tiles are drawn by `probe.py`, so the evidence carries no third-party art.

## What you need

- RPG Toolkit 3.1.0 installed from its released installer, on Windows (XP in a VM is fine). Use only the program. Do not open its source.
- Python 3 with Pillow on any machine, to make the kit and read the result.

## 1. Make the kit

```sh
python3 tools/research/autotile-probe/probe.py kit autoprobe-kit
```

This writes:

- `AUTOTILES_Probe.tst`: 52 tiles, each showing its own number (`AutoProbe-tiles.png` is a preview). The `AUTOTILES_` prefix is what makes the editor treat it as an autotile set ([spec 1.1](../../../docs/spec/editor/autotiling.md#11-how-a-tileset-becomes-an-autotile-set)).
- `pattern.txt` and `pattern.png`: the shape to paint, 16 × 12 with an empty border

Copy `AUTOTILES_Probe.tst` **directly** into the test project's `Tiles` folder, not into a sub-folder, because sets in sub-folders aren't recognised.

## 2. Quick check

1. Open a board and select `AUTOTILES_Probe.tst` in the tileset window.
2. Press **H**, or use the Autotiler toggle in the tool palette, and choose the **Draw** tool. Fill and Rectangle are refused in this mode.
3. Click one empty cell. The spec says it shows **51**, whichever tile you picked.
4. Click the cell to its right. The spec says the left cell becomes **48** (joined east only) and the right cell becomes **50** (joined west only).

Write down what you see, with a screenshot. If it doesn't behave like this, stop and report it, because the difference is itself a finding.

## 3. Paint

1. Create a new **2D** board of at least **20 × 15**, with one layer.
2. Turn the autotiler on and choose `AUTOTILES_Probe.tst`. Don't hold Shift.
3. On layer 1, paint every blue cell of `pattern.png` at the **same coordinates** (x 1–16, y 1–12, board top-left = pattern top-left). Leave the grey cells empty. The pattern's outer ring is empty on purpose.
4. Don't paint anything else. If you make a mistake, erase it with the autotiler still on.
5. Save as `AutoProbe1.brd`.
6. **Second run:** on a new board, paint the same shape starting from the bottom-right and working back. Save it as `AutoProbe2.brd`.

Take a screenshot of each finished board.

## 4. Read the result

```sh
python3 tools/research/autotile-probe/probe.py read AutoProbe1.brd --pattern autoprobe-kit/pattern.txt --json AutoProbe1.json
```

It prints a mask → tile index table beside the spec's tile and checks:

- **Shape:** the painted cells match the pattern, so a painting slip is reported by coordinate.
- **Pure neighbour rule:** every raw 8-neighbour pattern got a single index.
- **Corner rule:** patterns that differ only by a corner whose two edges aren't both filled got the same index. The pattern contains 96 raw patterns, so this is tested, not assumed.
- **Coverage:** all 47 canonical masks were seen.
- **Spec:** every observed tile matches the table in the spec. Any disagreement is listed by mask.

Exit code 0 means the editor matches the spec on every case. Attach the boards, the JSON files, the screenshots and the step 2 notes to #1732.

## What this does not prove

It tests the square-board tile table, the corner rule and painting order. It does not test isometric neighbours (spec 4.2), Shift (3.4), undo (3.6) or the board edge (3.7). Those could be added as further boards.
