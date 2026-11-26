#!/usr/bin/env python3
"""Build the autotiling example from docs/spec/editor/autotiling.md.

Draws an original 52-slot autotile set (water with a sand shore) and a board
whose water layer is laid out by the spec's rules: the naming rule (1.1), the
tile table (1.2), the corner rule and square-board neighbours (4.1). All art is
drawn here, procedurally, so the example carries no third-party assets.

    python3 build_autotile_example.py          # writes ../editor/examples/autotiling/
    python3 build_autotile_example.py --check  # fails if the committed files differ
The files need only the standard library; Pillow is used only for the renders.
"""
import os, re, sys
import rpgtk_formats as F
from rpgtk_formats import Writer

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = os.path.join(HERE, '..', 'editor', 'autotiling.md')
OUT = os.path.join(HERE, '..', 'editor', 'examples', 'autotiling')
SET = 'AUTOTILES_Water.tst'
GRASS = 'Grass.tst'
TRANSP = (0, 1, 2)          # the tileset transparent colour (formats/tiles.md)

# ------------------------------------------------------------------ the rules
BITS = {'N': 1, 'NE': 2, 'E': 4, 'SE': 8, 'S': 16, 'SW': 32, 'W': 64, 'NW': 128}
# Square boards and rotated isometric boards (spec 4.1): direction -> (dx, dy).
SQUARE = {'N': (0, -1), 'NE': (1, -1), 'E': (1, 0), 'SE': (1, 1),
          'S': (0, 1), 'SW': (-1, 1), 'W': (-1, 0), 'NW': (-1, -1)}
CORNERS = (('NE', 'N', 'E'), ('SE', 'S', 'E'), ('SW', 'S', 'W'), ('NW', 'N', 'W'))


def gate(mask):
    """A corner counts only when both cardinal directions next to it connect (spec 1.2)."""
    for corner, a, b in CORNERS:
        if mask & BITS[corner] and not (mask & BITS[a] and mask & BITS[b]):
            mask &= ~BITS[corner]
    return mask


def spec_table():
    """Tile number -> connection mask, read from the table in spec 1.2."""
    table = {}
    for line in open(SPEC, encoding='utf-8'):
        m = re.match(r'\| (\d+) \| ([^|]+)\| ([^|]+)\|', line)
        if m:
            words = re.findall(r'\b(NE|NW|SE|SW|N|S|E|W)\b', m[2] + ' ' + m[3])
            table[int(m[1])] = sum(BITS[w] for w in words)
    return table


TABLE = spec_table()
TILE_FOR = {mask: tile for tile, mask in TABLE.items()}
UNUSED = sorted(set(range(1, 53)) - set(TABLE))


def tile_for_cell(sets, x, y):
    """The tile the autotiler gives cell (x, y). `sets` maps (x, y) -> set name.
    Cells outside the board are simply absent, so they never connect (spec 3.7)."""
    own = sets[(x, y)]
    mask = 0
    for d, (dx, dy) in SQUARE.items():
        if sets.get((x + dx, y + dy)) == own:
            mask |= BITS[d]
    return TILE_FOR[gate(mask)]


def click(board, sets, x, y, w, h, new_set):
    """One Draw click with the autotiler on and no Shift (spec 3.1, 3.3).
    new_set=None erases. `board` maps (x, y) -> tile number for autotile cells."""
    if new_set is None:
        sets.pop((x, y), None); board.pop((x, y), None)
    else:
        sets[(x, y)] = new_set; board[(x, y)] = 51           # seed: the isolated tile
    for yy in range(max(0, y - 1), min(h, y + 2)):            # 3 x 3 reshape, clipped, row order
        for xx in range(max(0, x - 1), min(w, x + 2)):
            if (xx, yy) in sets:
                board[(xx, yy)] = tile_for_cell(sets, xx, yy)


# ------------------------------------------------------------------ art
WATER, DEEP, SAND, FOAM = (52, 110, 196), (40, 92, 176), (214, 196, 140), (196, 226, 250)


def water_tile(mask):
    """Water reaches each connected side; a connected corner fills that corner;
    an unconnected corner between two connected sides stays as an inner corner."""
    def wet(px, py):
        cx = 0 if px < 8 else (2 if px >= 24 else 1)
        cy = 0 if py < 8 else (2 if py >= 24 else 1)
        need = {(1, 1): 0, (1, 0): BITS['N'], (2, 1): BITS['E'], (1, 2): BITS['S'], (0, 1): BITS['W'],
                (2, 0): BITS['NE'], (2, 2): BITS['SE'], (0, 2): BITS['SW'], (0, 0): BITS['NW']}[(cx, cy)]
        return need == 0 or bool(mask & need)
    px = {}
    for x in range(32):
        for y in range(32):
            px[x, y] = TRANSP
            if wet(x, y):
                px[x, y] = DEEP if (x + 2 * y) % 11 == 0 else WATER
                continue
            near = [wet(x + dx, y + dy) for dx in (-2, -1, 0, 1, 2) for dy in (-2, -1, 0, 1, 2)
                    if 0 <= x + dx < 32 and 0 <= y + dy < 32]
            if any(near):
                touching = any(wet(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                               if 0 <= x + dx < 32 and 0 <= y + dy < 32)
                px[x, y] = FOAM if touching else SAND
    return px


def grass_tile():
    px = {}
    for x in range(32):
        for y in range(32):
            n = (x * 7919 + y * 104729 + x * y * 31) % 23        # fixed speckle, no RNG
            px[x, y] = (70 + n % 9, 146 + n % 13, 58 + n % 7) if n > 2 else (96, 170, 76)
    return px


def tileset_bytes(images):
    w = Writer().u16(20).u16(len(images)).u16(1)               # version 20, detail 1
    for p in images:                                          # p: (x, y) -> (r, g, b)
        w.raw(bytes(c for x in range(32) for y in range(32) for c in p[x, y]))  # column-major
    return w.b


def autotile_set():
    blank = {(x, y): TRANSP for x in range(32) for y in range(32)}
    return [water_tile(TABLE[t]) if t in TABLE else blank for t in range(1, 53)]


# ------------------------------------------------------------------ board
# '#' = water. Covers all 47 shapes; the strip on the bottom row shows that
# cells outside the board never connect (spec 3.7).
MARSH = """\
....................
....................
...##.#.#..#.##.#...
...##..####.####....
...#.##.######.##...
...####.###..#..#...
....####.#..#####...
...##.#.#####..##...
....######.#.####...
...##.#.######.#....
...###.#.####..##...
...#####..##.####...
....................
....................
....#####...........
"""


def marsh_cells():
    rows = MARSH.splitlines()
    return {(x, y): SET for y, r in enumerate(rows) for x, c in enumerate(r) if c == '#'}, len(rows[0]), len(rows)


def board_bytes(w, h, layers, lut):
    """A minor-4 board (formats/board.md) with no shading effect, lights, vectors,
    programs, sprites, images or links: just the tile layers."""
    L = len(layers)
    b = Writer().string('RPGTLKIT BOARD').s16(2).s16(4).s16(w).s16(h).s16(L).s16(0)
    b.s16(len(lut) - 1)
    for t in lut: b.string(t)
    index = {t: i for i, t in enumerate(lut)}
    cells = [index[layers[z][y][x]] for z in range(L) for y in range(h) for x in range(w)]
    i = 0
    while i < len(cells):
        j = i
        while j < len(cells) and cells[j] == cells[i] and j - i < 32767: j += 1
        if j - i >= 2: b.s16(-(j - i)).s16(cells[i])
        else: b.s16(cells[i])
        i = j
    b.s16(0).s32(1).s16(w * h).s16(0).s16(0).s16(0)        # one neutral shade layer
    b.s16(-1)                                               # lights
    b.s16(-1)                                               # vectors
    b.s16(-1)                                               # programs
    b.s16(-1)                                               # sprites
    b.s16(-1)                                               # images
    b.s16(-1)                                               # threads
    b.s16(-1)                                               # constants
    for t in ['Marsh'] + ['Grass', 'Water'][:L]: b.string(t)   # sizeL + 1 layer titles
    for _ in 'NSEW': b.string('')
    b.string('').s32(0).s32(0)
    b.string('').string('').string('')
    b.s16(0).s16(-1).s16(0)
    b.s16(0).s16(0).s16(0)
    b.s16(1).s16(1).s16(1)
    return b.b


def build():
    sets, w, h = marsh_cells()
    tiles = {p: tile_for_cell(sets, *p) for p in sets}
    grass = [[f'{GRASS}1'] * w for _ in range(h)]
    water = [[f'{SET}{tiles[(x, y)]}' if (x, y) in tiles else '' for x in range(w)] for y in range(h)]
    lut = [''] + sorted({r for row in grass + water for r in row if r}, key=lambda r: (r.split('.tst')[0], int(r.split('.tst')[1])))
    return {
        f'Tiles/{SET}': tileset_bytes(autotile_set()),
        f'Tiles/{GRASS}': tileset_bytes([grass_tile()]),
        'Boards/Marsh.brd': board_bytes(w, h, [grass, water], lut),
    }


def main():
    files = build()
    for name, data in files.items():                        # every file must parse to its end
        r = F.Reader(data, name)
        (F.parse_brd if name.endswith('.brd') else F.parse_tst)(r)
        assert r.at_eof(), name
    if '--check' in sys.argv:
        bad = [n for n, d in files.items()
               if not os.path.exists(os.path.join(OUT, n)) or open(os.path.join(OUT, n), 'rb').read() != d]
        if bad:
            sys.exit(f'out of date: {bad}; run build_autotile_example.py')
        print('autotiling example up to date'); return
    for name, data in files.items():
        path = os.path.join(OUT, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, 'wb').write(data)
    import render as R                                     # Pillow, renders only
    R.tileset_sheet(os.path.join(OUT, 'Tiles', SET), os.path.join(OUT, 'water_tiles.png'), cols=9, scale=2)
    R.render_board(OUT, 'Boards/Marsh.brd', os.path.join(OUT, 'marsh.png'))
    print(f'wrote {sorted(files)} and renders to {os.path.relpath(OUT)}')


if __name__ == '__main__':
    main()
