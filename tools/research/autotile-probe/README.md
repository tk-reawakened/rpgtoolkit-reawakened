# Auto-tile black-box probe (#1732)

Finds which tile index the Toolkit 3.1 editor's auto-tiler ([T-25](../../../docs/editor-features.md)) chooses for each neighbour pattern by **observing the released editor**, not by reading its source (G7). We paint a known shape with our own numbered tiles, save the board and read back the indices.

The tiles are drawn by `probe.py`, so the evidence carries no third-party art. Results go into [docs/findings/autotile-sample-evidence-1732.md](../../../docs/findings/autotile-sample-evidence-1732.md).

## What you need

- RPG Toolkit 3.1.0 installed from its released installer, on Windows (XP in a VM is fine). Use only the program. Do not open its source.
- Python 3 with Pillow on any machine, to make the kit and read the result.

## 1. Make the kit

```sh
python3 tools/research/autotile-probe/probe.py kit autoprobe-kit
```

This writes:

- `AutoProbe.tst`: 64 tiles, each showing its own number (`AutoProbe-tiles.png` is a preview)
- `pattern.txt` and `pattern.png`: the shape to paint, 16 × 12 with an empty border

Copy `AutoProbe.tst` into the test project's `Tiles` folder.

## 2. Find the auto-tiler (record everything)

The specification says only that auto-tiling works "with an auto-tile tileset loaded and auto-tiling switched on". In the board editor, find out and **write down, with screenshots**:

1. where auto-tiling is switched on (menu, toolbar, Tiles mode option)
2. how a tileset becomes an auto-tile set: a setting, a file name, a required tile count, or a tile you pick as the base
3. whether it refuses `AutoProbe.tst`, and the exact message if it does

If it needs a different tile count, run `kit` again with `--count N`. If it needs a setting in the tileset editor, record which one. These notes are part of the evidence.

## 3. Paint

1. Create a new **2D** board of at least **20 × 15**, with one layer.
2. Turn auto-tiling on and choose `AutoProbe.tst`.
3. On layer 1, paint every blue cell of `pattern.png` at the **same coordinates** (x 1–16, y 1–12, board top-left = pattern top-left). Leave the grey cells empty. The pattern's outer ring is empty on purpose.
4. Don't paint anything else on the board. If you make a mistake, erase it and carry on, because the auto-tiler should update the neighbours.
5. Save as `AutoProbe1.brd`.
6. **Second run:** on a new board, paint the same shape starting from the bottom-right and working back. Save it as `AutoProbe2.brd`. If both boards give the same table, the result doesn't depend on painting order.

Take a screenshot of each finished board.

## 4. Read the result

```sh
python3 tools/research/autotile-probe/probe.py read AutoProbe1.brd --pattern autoprobe-kit/pattern.txt --json AutoProbe1.json
```

It prints a mask → tile index table and checks:

- **Shape:** the painted cells match the pattern, so a painting slip is reported by coordinate.
- **Pure neighbour rule:** every raw 8-neighbour pattern got a single index.
- **Corner rule:** patterns that differ only by a corner whose two edges aren't both filled got the same index. The pattern contains 96 raw patterns, so this is tested, not assumed.
- **Coverage:** all 47 canonical masks were seen.

Exit code 0 means no problems. Attach the boards, the JSON files, the screenshots and the step 2 notes to #1732.

## What this does not prove

It records what this editor build did with this tileset. If step 2 shows that the editor's choice depends on something else (a base tile, the tile count), repeat the run to vary that and record it. Edge-of-board behaviour isn't tested, because the pattern stays away from the edges.
