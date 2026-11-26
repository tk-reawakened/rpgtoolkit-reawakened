# Tools

Python 3 tools that implement the layouts in [../formats/](../formats/README.md). They are reference implementations for checking files and for testing a new loader, not production code.

| File | Purpose | Needs |
|---|---|---|
| [rpgtk_formats.py](rpgtk_formats.py) | Readers for `.gam .brd .tem .itm .ene .anm .tbm .tan .bkg .ste .spc .tst .iso .sav`, a `.gph` decoder, the standalone-EXE trailer, and a byte writer. Every read records `(offset, size, field, value)` for annotated listings. | standard library |
| [render.py](render.py) | Renders tilesets (every detail level), isometric tiles and boards to PNG | Pillow |
| [build_example_game.py](build_example_game.py) | Draws placeholder art and writes the complete example game in [../examples/](../examples/), then reads every file back and fails if any does not end exactly at its last byte | Pillow |
| [build_autotile_example.py](build_autotile_example.py) | Draws an original 52-slot autotile set and a board laid out by the rules in [../editor/autotiling.md](../editor/autotiling.md), written to [../editor/examples/autotiling/](../editor/examples/autotiling/). `--check` fails if the committed files differ; `test_autotile_example.py` checks the rules against hand-read table values | Pillow for the renders only |
| [build_version_examples.py](build_version_examples.py) | Writes one example file for **every version of every asset format** (binary minors, Toolkit 1/2 text, tileset detail levels, `.gph` variants) to [../examples/versions/](../examples/versions/README.md), as fixtures for an importer that upgrades on the fly. Each file is written by running the reader's own layout in write mode, then read back. | Pillow |

## Usage

```bash
python3 rpgtk_formats.py verify <any folder>       # parse every game file below it; exit 1 on any mismatch
python3 rpgtk_formats.py dump  <file> [type]       # annotated listing
python3 render.py board <project folder> Boards/village.brd board.png
python3 render.py tileset <project folder>/Tiles/village.tst sheet.png
python3 render.py iso <project folder>/Tiles/grass.iso 1 iso.png
python3 build_example_game.py                      # rebuild ../examples/
python3 build_version_examples.py                  # rebuild ../examples/versions/
python3 build_autotile_example.py                  # rebuild ../editor/examples/autotiling/
```

## Listing format

```
offset  bytes (first 12)                         field = value
000052  73 6c 69 6d 65 5c 73 6c 69 6d 65 2e .. animation[0] REST = 'slime\\slime.anm'
```

A block of fields that repeats at least three times with identical values (for example 501 empty encounter slots) is printed once, followed by `... block above repeated xN`.

## Scope

- The binary readers implement every version in the format and legacy pages: main-file minors 1-9, boards minors 2-4, characters minors 3-8, items minors 2-7, saved games minors 0-4, and the compiled RPGCode layout.
- The Toolkit 1/2 text formats are implemented as line layouts (`TEXT_LAYOUTS`, read with `LineReader`).
- `encode(layout, value)` and `encode_text(layout, value)` run any of these layouts in write mode; `value(field, kind)` supplies each field.
- The enemy reader defaults to the layout the original editor writes (4-byte custom-stance count). Pass `editor_layout=False` to `parse_ene` to see how the original engine read it.
- The save-game reader handles minor 4 without running script threads.
