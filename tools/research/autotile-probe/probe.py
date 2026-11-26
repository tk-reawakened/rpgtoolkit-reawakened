#!/usr/bin/env python3
"""Black-box probe of the Toolkit 3.1 editor's auto-tiler (issue #1732).

Nothing here reads or derives from legacy engine or editor source (G7). The
probe tileset is drawn here, procedurally; the board is read with the
spec-derived reader in docs/spec/tools/rpgtk_formats.py. The editor is only
observed: you paint a known shape with it, save, and this script reports
which tile index it chose for each neighbour pattern.

    python3 probe.py kit OUT_DIR
        Writes AutoProbe.tst (numbered tiles), AutoProbe-tiles.png,
        pattern.txt and pattern.png (the shape to paint).

    python3 probe.py read BOARD.brd [--pattern pattern.txt] [--json out.json]
        Reports the observed mask -> tile index table and checks it.

Requires Pillow for `kit`. See README.md for the full procedure.
"""
import argparse, json, os, re, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', '..', 'docs', 'spec', 'tools'))
import rpgtk_formats as fmt  # noqa: E402

TILESET = 'AUTOTILES_Probe.tst'  # the AUTOTILES_ prefix makes it an autotile set
SPEC = os.path.join(HERE, '..', '..', '..', 'docs', 'spec', 'editor', 'autotiling.md')

# Neighbour weights, clockwise from north (docs/findings/autotile-sample-evidence-1732.md).
NEIGHBOURS = [(0, -1, 1), (1, -1, 2), (1, 0, 4), (1, 1, 8),
              (0, 1, 16), (-1, 1, 32), (-1, 0, 64), (-1, -1, 128)]
CORNERS = ((2, 1, 4), (8, 4, 16), (32, 16, 64), (128, 64, 1))


def gate(mask):
    """Drop a diagonal unless both adjoining edges are set."""
    for corner, a, b in CORNERS:
        if mask & corner and not (mask & a and mask & b):
            mask &= ~corner
    return mask


CANONICAL = sorted({gate(m) for m in range(256)})
assert len(CANONICAL) == 47

# 16 x 12, empty one-cell margin. Covers all 47 canonical masks and 96 raw masks
# (so it also tests whether lone diagonals are ignored). Found by search.
PATTERN = """\
................
.##.#.#..#.##.#.
.##..####.####..
.#.##.######.##.
.####.###..#..#.
..####.#..#####.
.##.#.#####..##.
..######.#.####.
.##.#.######.#..
.###.#.####..##.
.#####..##.####.
................"""


def spec_table():
    """Tile number -> mask, from the table in docs/spec/editor/autotiling.md."""
    bits = {'N': 1, 'NE': 2, 'E': 4, 'SE': 8, 'S': 16, 'SW': 32, 'W': 64, 'NW': 128}
    table = {}
    for line in open(SPEC, encoding='utf-8'):
        m = re.match(r'\| (\d+) \| ([^|]+)\| ([^|]+)\|', line)
        if m:
            words = re.findall(r'\b(NE|NW|SE|SW|N|S|E|W)\b', m[2] + ' ' + m[3])
            table[int(m[1])] = sum(bits[w] for w in words)
    assert len(table) == 47 and sorted(table.values()) == CANONICAL, 'spec table is not 47 distinct shapes'
    return table


def parse_pattern(text):
    rows = [r.strip() for r in text.strip().splitlines() if r.strip()]
    return {(x, y) for y, r in enumerate(rows) for x, c in enumerate(r) if c == '#'}


def masks_of(cells):
    out = {}
    for (x, y) in cells:
        m = 0
        for dx, dy, bit in NEIGHBOURS:
            if (x + dx, y + dy) in cells:
                m |= bit
        out[(x, y)] = m
    return out


def ascii_3x3(mask):
    g = [['.'] * 3 for _ in range(3)]
    g[1][1] = '@'
    for dx, dy, bit in NEIGHBOURS:
        if mask & bit:
            g[1 + dy][1 + dx] = '#'
    return ' / '.join(''.join(r) for r in g)


# ------------------------------------------------------------------ kit
DIGITS = {  # 3x5 pixel digits
    '0': '111101101101111', '1': '010110010010111', '2': '111001111100111',
    '3': '111001111001111', '4': '101101111001001', '5': '111100111001111',
    '6': '111100111101111', '7': '111001010010010', '8': '111101111101111',
    '9': '111101111001111'}


def numbered_tile(n, Image):
    hue = (n * 47) % 360
    import colorsys
    r, g, b = (int(c * 255) for c in colorsys.hsv_to_rgb(hue / 360, 0.55, 0.55))
    img = Image.new('RGB', (32, 32), (r, g, b))
    px = img.load()
    for i in range(32):  # 1-pixel black frame so cell edges are visible
        px[i, 0] = px[i, 31] = px[0, i] = px[31, i] = (0, 0, 0)
    text = str(n)
    scale = 3
    width = len(text) * 3 * scale + (len(text) - 1) * scale
    ox, oy = (32 - width) // 2, (32 - 5 * scale) // 2
    for k, ch in enumerate(text):
        bits = DIGITS[ch]
        for j in range(15):
            if bits[j] == '1':
                cx, cy = ox + k * 4 * scale + (j % 3) * scale, oy + (j // 3) * scale
                for dx in range(scale):
                    for dy in range(scale):
                        px[cx + dx, cy + dy] = (255, 255, 255)
    return img


def tile_bytes(img):
    """Column-major R,G,B (docs/spec/formats/tiles.md, detail 1)."""
    px = img.load()
    return bytes(c for x in range(32) for y in range(32) for c in px[x, y])


def cmd_kit(args):
    from PIL import Image, ImageDraw
    os.makedirs(args.out, exist_ok=True)
    tiles = [numbered_tile(n, Image) for n in range(1, args.count + 1)]
    w = fmt.Writer().u16(20).u16(len(tiles)).u16(1)
    for t in tiles:
        w.raw(tile_bytes(t))
    path = os.path.join(args.out, TILESET)
    open(path, 'wb').write(w.b)
    fmt.parse_tst(fmt.Reader(open(path, 'rb').read(), path))  # round-trip check

    cols = 8
    sheet = Image.new('RGB', (cols * 32, ((len(tiles) + cols - 1) // cols) * 32))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * 32, (i // cols) * 32))
    sheet.save(os.path.join(args.out, 'AutoProbe-tiles.png'))

    open(os.path.join(args.out, 'pattern.txt'), 'w').write(PATTERN + '\n')
    rows = PATTERN.splitlines()
    cell, pad = 32, 24
    W, H = len(rows[0]), len(rows)
    img = Image.new('RGB', (pad + W * cell, pad + H * cell), (255, 255, 255))
    d = ImageDraw.Draw(img)
    for y, r in enumerate(rows):
        d.text((4, pad + y * cell + 10), str(y + 1), fill=(0, 0, 0))
        for x, c in enumerate(r):
            if y == 0:
                d.text((pad + x * cell + 10, 6), str(x + 1), fill=(0, 0, 0))
            box = (pad + x * cell, pad + y * cell, pad + (x + 1) * cell - 1, pad + (y + 1) * cell - 1)
            d.rectangle(box, fill=(40, 90, 190) if c == '#' else (235, 235, 235), outline=(150, 150, 150))
    img.save(os.path.join(args.out, 'pattern.png'))
    print(f'wrote {TILESET} ({len(tiles)} tiles), AutoProbe-tiles.png, pattern.txt, pattern.png to {args.out}')


# ------------------------------------------------------------------ read
def read_board(path):
    r = fmt.Reader(open(path, 'rb').read(), path)
    fmt.parse_brd(r)
    trace = r.trace
    value = lambda name: next(v for _, _, f, v in trace if f == name)
    sx, sy, sl = value('sizeX'), value('sizeY'), value('sizeL')
    lut = {}
    cells = []
    for i, (_, _, field, val) in enumerate(trace):
        m = re.fullmatch(r'LUT\[(\d+)\]', field)
        if m:
            lut[int(m[1])] = val
        elif re.fullmatch(r'(tile )?cell \d+', field):
            cells.extend([trace[i + 1][3]] * -val if val < 0 else [val])
    if len(cells) != sx * sy * sl:
        raise SystemExit(f'cell count {len(cells)} != {sx}x{sy}x{sl}; not a plain 2D board?')
    return sx, sy, sl, lut, cells


def cmd_read(args):
    sx, sy, sl, lut, cells = read_board(args.board)
    pat = re.compile(r'(?:.*[\\/])?(?:AUTOTILES_Probe|AutoProbe\d*)\.tst(\d+)$', re.I)
    placed = {}  # (x, y) zero-based -> tile index, per layer
    layers = defaultdict(dict)
    for k, slot in enumerate(cells):
        m = pat.match(lut.get(slot, ''))
        if m:
            z, rest = divmod(k, sx * sy)
            y, x = divmod(rest, sx)
            layers[z][(x, y)] = int(m[1])
    if not layers:
        raise SystemExit(f'no {TILESET} tiles on the board. LUT: {sorted(set(lut.values()))}')
    z = max(layers, key=lambda k: len(layers[k]))
    placed = layers[z]
    problems = []
    if len(layers) > 1:
        problems.append(f'probe tiles on several layers {sorted(l + 1 for l in layers)}; using layer {z + 1}')

    edge = [p for p in placed if p[0] in (0, sx - 1) or p[1] in (0, sy - 1)]
    if edge:
        problems.append(f'{len(edge)} probe tiles touch the board edge; their masks assume off-board is empty')

    if args.pattern:
        want = parse_pattern(open(args.pattern).read())
        # Align the pattern's top-left with the board's (pattern margin included).
        got = set(placed)
        if want != got:
            miss = sorted(want - got)
            extra = sorted(got - want)
            problems.append('painted shape differs from pattern (1-based x,y): '
                            f'missing {[(x + 1, y + 1) for x, y in miss]} extra {[(x + 1, y + 1) for x, y in extra]}')

    masks = masks_of(set(placed))
    by_raw = defaultdict(set)
    for p, m in masks.items():
        by_raw[m].add(placed[p])
    by_gated = defaultdict(set)
    for m, idx in by_raw.items():
        by_gated[gate(m)] |= idx

    for m, idx in sorted(by_raw.items()):
        if len(idx) > 1:
            problems.append(f'raw mask {m} ({ascii_3x3(m)}) got several indices {sorted(idx)}: not a pure neighbour rule')
    gating_ok = True
    for g, idx in sorted(by_gated.items()):
        if len(idx) > 1:
            gating_ok = False
            raws = sorted(m for m in by_raw if gate(m) == g)
            problems.append(f'gated mask {g}: raw masks {raws} chose {sorted(idx)}: '
                            'lone diagonals are NOT simply ignored')
    missing = [m for m in CANONICAL if m not in by_gated]
    if missing:
        problems.append(f'{len(missing)} canonical masks not observed: {missing}')

    table = {g: sorted(idx) for g, idx in sorted(by_gated.items())}
    expected = {mask: tile for tile, mask in spec_table().items()}
    disagree = [(g, expected[g], idx) for g, idx in table.items() if idx != [expected[g]]]
    for g, want, idx in disagree:
        problems.append(f'mask {g} ({ascii_3x3(g)}): spec says tile {want}, editor chose {idx}')
    used = sorted({i for idx in table.values() for i in idx})
    print(f'board {args.board}: {sx}x{sy}x{sl}, layer {z + 1}, {len(placed)} probe tiles, '
          f'{len(by_raw)} raw masks, {len(by_gated)}/47 canonical masks')
    print(f'corner gating hypothesis: {"consistent" if gating_ok else "CONTRADICTED"}')
    print(f'tile indices used: {used}')
    print(f'spec table (docs/spec/editor/autotiling.md): '
          f'{"MATCHES" if not disagree and not missing else f"{len(disagree)} disagreements"} on {len(table)} observed masks')
    print()
    print('| Tile index | Spec tile | Mask | Neighbours (`#` same set) |')
    print('|---:|---:|---:|---|')
    for g, idx in sorted(table.items(), key=lambda kv: (kv[1][0], kv[0])):
        print(f'| {", ".join(map(str, idx))} | {expected[g]} | {g} | `{ascii_3x3(g)}` |')
    print()
    print('Problems:' if problems else 'No problems found.')
    for p in problems:
        print(f'- {p}')
    if args.json:
        json.dump({'board': os.path.basename(args.board), 'size': [sx, sy, sl], 'layer': z + 1,
                   'gatingConsistent': gating_ok, 'specDisagreements': len(disagree), 'maskToIndex': table,
                   'rawMaskToIndex': {m: sorted(i) for m, i in sorted(by_raw.items())},
                   'missingMasks': missing, 'problems': problems},
                  open(args.json, 'w'), indent=1)
    return 1 if problems else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    k = sub.add_parser('kit')
    k.add_argument('out')
    k.add_argument('--count', type=int, default=52)
    rd = sub.add_parser('read')
    rd.add_argument('board')
    rd.add_argument('--pattern')
    rd.add_argument('--json')
    args = ap.parse_args()
    sys.exit(cmd_kit(args) if args.cmd == 'kit' else cmd_read(args))


if __name__ == '__main__':
    main()
