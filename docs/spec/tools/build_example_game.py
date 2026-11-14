#!/usr/bin/env python3
"""Build a small, complete example game in every RPG Toolkit 3 format.

All art is drawn here, procedurally, so the examples carry no third-party
assets. Each file is written in the newest layout documented in ../formats/,
then read back with rpgtk_formats.py; the build fails if any file does not
parse to exactly its end.

    python3 build_example_game.py           # writes ../examples/
Requires Pillow for the art and renders.
"""
import os, sys, math, random, zipfile, shutil
from PIL import Image, ImageDraw
import rpgtk_formats as F
from rpgtk_formats import Writer
import render as R

HERE = os.path.dirname(os.path.abspath(__file__))
EX = os.path.join(HERE, '..', 'examples')
GAME = os.path.join(EX, 'game')                 # Toolkit folder layout
PROJ = os.path.join(GAME, 'Game', 'Example')    # the project folder
FOLDERS = ['Tiles', 'Boards', 'Chrs', 'SpcMove', 'Bkrounds', 'Media', 'Prg', 'Font',
           'Item', 'Enemy', 'Bitmap', 'StatusE', 'Misc', 'Plugin']
TRANSP = (0, 1, 2)
random.seed(3)

def colorref(r, g, b): return r | (g << 8) | (b << 16)
def out(*p): return os.path.join(*p)

def setup():
    for sub in ['game', 'listings', 'renders', 'files']:          # leave examples/versions/ alone
        if os.path.exists(out(EX, sub)): shutil.rmtree(out(EX, sub))
    for f in FOLDERS:
        os.makedirs(out(PROJ, f))
    os.makedirs(out(GAME, 'Main'))
    for d in ['listings', 'renders', 'files']:
        os.makedirs(out(EX, d))

# ------------------------------------------------------------------ art
def tile(fn):
    img = Image.new('RGB', (32, 32), TRANSP)
    fn(img, ImageDraw.Draw(img))
    return img

def noise(img, base, spread):
    px = img.load()
    for x in range(32):
        for y in range(32):
            if px[x, y] == TRANSP: continue
            d = random.randint(-spread, spread)
            px[x, y] = tuple(max(0, min(255, c + d)) for c in base)

def grass(img, d):
    d.rectangle((0, 0, 31, 31), fill=(70, 150, 60)); noise(img, (70, 150, 60), 14)
def water(phase):
    def f(img, d):
        d.rectangle((0, 0, 31, 31), fill=(40, 90, 190))
        for y in range(4, 32, 8):
            for x in range(32):
                yy = y + int(2 * math.sin((x + phase * 8) / 5))
                if 0 <= yy < 32: img.putpixel((x, yy), (150, 190, 250))
    return f
def path(img, d):
    d.rectangle((0, 0, 31, 31), fill=(170, 140, 100)); noise(img, (170, 140, 100), 18)
def tree_top(img, d):
    d.ellipse((2, 4, 29, 31), fill=(30, 110, 40), outline=(20, 70, 25))
    d.ellipse((8, 9, 16, 16), fill=(60, 150, 60))
def tree_trunk(img, d):
    d.ellipse((2, -12, 29, 14), fill=(30, 110, 40), outline=(20, 70, 25))
    d.rectangle((13, 14, 18, 27), fill=(110, 70, 35))
    d.ellipse((8, 25, 23, 31), fill=(40, 60, 30))
def wall(img, d):
    d.rectangle((0, 0, 31, 31), fill=(200, 190, 170))
    for y in range(0, 32, 8):
        d.line((0, y, 31, y), fill=(150, 140, 120))
        off = 0 if (y // 8) % 2 else 8
        for x in range(off, 32, 16): d.line((x, y, x, y + 7), fill=(150, 140, 120))
def roof(img, d):
    d.rectangle((0, 0, 31, 31), fill=(170, 60, 50))
    for y in range(3, 32, 6): d.line((0, y, 31, y), fill=(120, 40, 35))
def door(img, d):
    wall(img, d); d.rectangle((8, 6, 23, 31), fill=(110, 70, 35), outline=(70, 40, 20))
    d.point((20, 19), fill=(230, 200, 60))
def flower(img, d):
    for cx, cy, c in [(8, 10, (240, 80, 120)), (22, 18, (250, 220, 70)), (12, 25, (150, 120, 250))]:
        d.ellipse((cx - 3, cy - 3, cx + 3, cy + 3), fill=c); d.point((cx, cy), fill=(255, 255, 255))
        d.line((cx, cy + 3, cx, cy + 6), fill=(40, 120, 40))
def stairs(img, d):
    d.rectangle((0, 0, 31, 31), fill=(140, 140, 150))
    for y in range(0, 32, 6): d.rectangle((0, y, 31, y + 2), fill=(100, 100, 110))
def chest(img, d):
    d.rectangle((5, 12, 26, 29), fill=(140, 90, 40), outline=(80, 50, 20))
    d.rectangle((5, 12, 26, 17), fill=(160, 105, 50), outline=(80, 50, 20))
    d.rectangle((14, 15, 17, 20), fill=(230, 200, 60))

def hero(direction, step):
    def f(img, d):
        body, skin, hair = (60, 90, 200), (240, 200, 160), (90, 60, 30)
        leg = 2 if step else -2
        d.ellipse((9, 28, 22, 31), fill=(30, 50, 30))                 # shadow
        d.rectangle((12, 22, 14, 28 + (leg if direction in 'EW' else 0)), fill=(50, 50, 80))
        d.rectangle((17, 22, 19, 28 - (leg if direction in 'EW' else 0)), fill=(50, 50, 80))
        d.rectangle((10, 13, 21, 23), fill=body)
        d.ellipse((10, 2, 21, 13), fill=skin)
        if direction == 'N':
            d.ellipse((10, 2, 21, 12), fill=hair)
        else:
            d.chord((10, 1, 21, 10), 180, 360, fill=hair)
            eyes = {'S': [(13, 8), (18, 8)], 'E': [(18, 8)], 'W': [(13, 8)]}[direction]
            for e in eyes: d.point(e, fill=(0, 0, 0))
    return f
def slime(img, d):
    d.ellipse((4, 12, 27, 31), fill=(90, 200, 90), outline=(40, 120, 40))
    d.point((12, 20), fill=(0, 0, 0)); d.point((19, 20), fill=(0, 0, 0))

TILES = [('grass', grass), ('water1', water(0)), ('water2', water(1)), ('water3', water(2)),
         ('path', path), ('treetop', tree_top), ('trunk', tree_trunk), ('wall', wall), ('roof', roof),
         ('door', door), ('flower', flower), ('stairs', stairs), ('chest', chest)]
for dname in 'SNEW':
    for s in (0, 1):
        TILES.append((f'hero_{dname}{s}', hero(dname, s)))
TILES.append(('slime', slime))
T = {name: i + 1 for i, (name, _) in enumerate(TILES)}     # tile numbers are 1-based

def tile_bytes(img):
    """Column-major R,G,B; (0,1,2) is transparent."""
    px = img.load(); b = bytearray()
    for x in range(32):
        for y in range(32): b += bytes(px[x, y])
    return bytes(b)

# ------------------------------------------------------------------ writers
def write_tileset(path, images, version=20, detail=1):
    w = Writer().u16(version).u16(len(images)).u16(detail)
    for img in images: w.raw(tile_bytes(img))
    open(path, 'wb').write(w.b)

def write_gph(path, img):
    px = img.load(); vals = []
    for x in range(32):
        for y in range(32):
            p = px[x, y]; vals.append(-1 if p == TRANSP else colorref(*p))
    num = lambda v: (' ' if v >= 0 else '') + str(v) + ' '      # VB6 Print # padding
    lines = ['RPGTLKIT TILE', num(2), num(0), num(1), num(1)]
    run, cur = 1, vals[0]
    for v in vals[1:]:
        if v == cur: run += 1
        else: lines += [num(run), num(cur)]; cur, run = v, 1
    lines += [num(run), num(cur)]
    open(path, 'w', newline='').write('\r\n'.join(lines) + '\r\n')
    return vals

def write_tan(path, speed, frames):
    w = Writer().string('RPGTLKIT TILEANIM').s16(2).s16(0).s32(speed).s32(len(frames))
    for f in frames: w.string(f)
    open(path, 'wb').write(w.b)

def write_tbm(path, grid):
    """grid[x][y] = tile ref; writes the extra row and column."""
    wdt, hgt = len(grid), len(grid[0])
    w = Writer().string('TK3 TILEBITMAP').s16(3).s16(0).s16(wdt).s16(hgt)
    for x in range(wdt + 1):
        for y in range(hgt + 1):
            ref = grid[x][y] if x < wdt and y < hgt else ''
            w.string(ref).s16(0).s16(0).s16(0)
    open(path, 'wb').write(w.b)

def write_anm(path, w_, h_, frames, delay, slots=51):
    w = Writer().string('RPGTLKIT ANIM').s16(2).s16(3).s32(w_).s32(h_).s32(slots - 1)
    for i in range(slots):
        f = frames[i] if i < len(frames) else ''
        w.string(f).s32(colorref(255, 255, 255)).string('')
    w.f64(delay)
    open(path, 'wb').write(w.b)

def rle_cells(cells):
    w = Writer(); i = 0
    while i < len(cells):
        j = i
        while j < len(cells) and cells[j] == cells[i] and j - i < 32767: j += 1
        if j - i >= 2: w.s16(-(j - i)).s16(cells[i])
        else: w.s16(cells[i])
        i = j
    return w.b

def polygon(w, pts, closed=True):
    w.s16(len(pts) - 1)
    for x, y in pts: w.s32(x).s32(y)

def rect(x0, y0, x1, y1): return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]

def write_board(path, W, H, layers, lut, settings):
    """layers: list of 2-D [y][x] lists of tile-ref strings ('' = empty)."""
    L = len(layers)
    w = Writer().string('RPGTLKIT BOARD').s16(2).s16(4).s16(W).s16(H).s16(L).s16(0)
    w.s16(len(lut) - 1)
    for t in lut: w.string(t)
    index = {t: i for i, t in enumerate(lut)}
    cells = [index[layers[z][y][x]] for z in range(L) for y in range(H) for x in range(W)]
    w.raw(rle_cells(cells))
    # shading: one layer cast onto layer 2, a dark band down the left edge, rest neutral
    w.s16(0).s32(2)
    for y in range(H):
        w.s16(1).s16(-60).s16(-60).s16(-40)            # x = 1: darker
        w.s16(W - 1).s16(0).s16(0).s16(0)               # rest of the row: run
    # one light: gradient
    w.s16(0).s32(1).s32(1)
    polygon(w, [(320, 64), (420, 160)])
    w.s16(1).s16(80).s16(70).s16(0).s16(0).s16(0).s16(0)
    # vectors: house walls (solid), stairs, a waypoint for the slime
    vecs = settings['vectors']
    w.s16(len(vecs) - 1)
    for v in vecs:
        polygon(w, v['points']); w.s16(v.get('attributes', 0)).s16(-1 if v.get('closed', True) else 0)
        w.s16(v['layer']).s16(v['type']).string(v.get('handle', ''))
    progs = settings['programs']
    w.s16(len(progs) - 1)
    for p in progs:
        for f in ['file', 'graphic', 'initialVar', 'initialValue', 'finalVar', 'finalValue']: w.string(p.get(f, ''))
        w.s16(p.get('activate', 0)).s16(p.get('activationType', 0)).s16(p.get('distanceRepeat', 0)).s16(p['layer'])
        polygon(w, p['points']); w.s16(-1).string('')
    items = settings['items']
    w.s16(len(items) - 1)
    for it in items:
        for f in ['file', 'prgActivate', 'prgMultitask', 'initialVar', 'initialValue', 'finalVar', 'finalValue',
                  'loadingVar', 'loadingValue']: w.string(it.get(f, ''))
        w.s16(it.get('activate', 0)).s16(it.get('activationType', 0)).s16(it['x']).s16(it['y']).s16(it['layer']).s16(-1)
    imgs = settings['images']
    w.s16(len(imgs) - 1)
    for im in imgs:
        w.string(im['file']).s32(im['x']).s32(im['y']).s16(im['layer']).s16(0).s32(colorref(255, 0, 255)).s16(100)
    w.s16(len(settings['threads']) - 1)
    for t in settings['threads']: w.string(t)
    consts = settings['constants']
    w.s16(len(consts) - 1)
    for c in consts: w.string(c)
    for t in settings['titles']: w.string(t)            # sizeL + 1 strings
    for l in settings['links']: w.string(l)              # N, S, E, W
    w.string('').s32(0).s32(colorref(0, 0, 0))
    w.string(settings['music']).string(settings['enterPrg']).string(settings['battleBackground'])
    w.s16(settings['battleSkill']).s16(-1).s16(0)
    w.s16(0).s16(0).s16(0)
    w.s16(settings['start'][0]).s16(settings['start'][1]).s16(settings['start'][2])
    open(path, 'wb').write(w.b)

def write_tem(path):
    w = Writer().string('RPGTLKIT CHAR').s16(2).s16(8).string('Ada')
    for v in ['Ada[exp]!', 'Ada[dp]!', 'Ada[fp]!', 'Ada[hp]!', 'Ada[maxhp]!', 'Ada[name]$',
              'Ada[smp]!', 'Ada[maxsmp]!', 'Ada[level]!']: w.string(v)
    for v in [0, 30, 30, 4, 6, 10, 10, 1]: w.s32(v)
    w.string('')
    for i in range(201):
        if i == 1: w.string('fireball.spc').s32(0).s32(1).string('').string('')
        else: w.string('').s32(0).s32(0).string('').string('')
    w.string('Magic').i8(0)
    for i in range(11): w.string('Ring' if i == 1 else '')
    for i in range(7): w.i8(1 if 1 <= i <= 6 else 0)
    w.s32(50).s16(20).s32(20)
    for v in [10, 5, 5, 10]: w.s16(v)
    w.string('').i8(0).i8(0)
    for d in ['s', 'n', 'e', 'w']: w.string(f'hero\\hero_walk_{d}.anm')
    for i in range(4): w.string('')
    for i in range(5): w.string('hero\\hero_walk_s.anm' if i == 4 else '')   # FIGHT..REST
    w.string('')
    for i in range(8): w.string('')
    w.f64(3.0).f64(0.05)
    w.s32(0).string('hero\\hero_wave.anm').string('WAVE')
    w.s16(1)
    polygon(w, rect(-15, -15, 15, 0)); polygon(w, rect(-24, -24, 24, 8))
    open(path, 'wb').write(w.b)

def write_itm(path):
    w = Writer().string('RPGTLKIT ITEM').s16(2).s16(7).string('Chest').string('A wooden chest.')
    w.i8(0).i8(0).i8(1).i8(0).i8(0)
    for i in range(51): w.string('')
    w.s32(0).s32(0).i8(0)
    for i in range(8): w.i8(0)
    w.string('').s32(0).s32(0).s32(0).s32(0).string('').string('')
    w.s32(0).s32(0).string('').s32(0).s32(0).string('')
    w.string('').string('').string('open_chest.prg').i8(1)
    for d in range(8): w.string('chest\\chest.anm' if d == 0 else '')
    w.string('').string('')
    for d in range(8): w.string('')
    w.f64(0.1).f64(3.0)
    w.s32(0).string('').string('')
    w.s16(1)
    polygon(w, rect(-15, -15, 15, 0)); polygon(w, rect(-24, -24, 24, 8))
    open(path, 'wb').write(w.b)

def write_ene(path):
    w = Writer().string('RPGTLKIT ENEMY').s16(2).s16(1).string('Slime')
    w.s32(12).s32(4).s32(3).s32(1).i8(1).s16(20).s16(30)
    for lst in (['fireball.spc'], [], []):
        w.s16(len(lst) - 1 if lst else 0)
        for s in (lst or ['']): w.string(s)
    w.i8(0).i8(0).string('').s32(5).s32(3).string('').string('')
    w.s16(5)
    for i in range(6): w.string('slime\\slime.anm' if i < 2 else '')
    # Custom stances exactly as the editor writes them: int upper bound, (animation, name).
    w.s32(0).string('slime\\slime.anm').string('JIGGLE')
    open(path, 'wb').write(w.b)

def write_gam(path):
    w = Writer().string('RPGTLKIT MAIN').s16(2).s16(9).s16(1).string('NOCODE')
    w.string('Game\\Example\\').string('Example Game').s16(1).s16(0).s16(0).s16(0).string('0english.lng')
    w.string('start.prg').string('village.brd').string('ada.tem')
    w.string('').s16(0).s16(13).s16(32)
    w.s16(50)
    for i in range(51): w.s16(0).string('')
    w.string('tk3menu.dll').string('tk3fight.dll')
    w.s16(0).s16(500)
    for i in range(501):
        if i == 0: w.string('slime.ene').s16(1)
        else: w.string('').s16(0)
    w.s16(0).s32(20).s16(0).string('').string('').string('').string('')
    w.s16(4)
    for i in range(5): w.string('')
    w.s16(0).s16(0).s32(0)
    w.string('').string('').string('')
    w.i8(1).i8(0).u8(128).i8(1)
    w.string('TK DEFAULT').i8(0).i8(0).s32(colorref(255, 0, 0)).s32(0).s32(0).i8(0)
    w.s16(2).s32(0).s32(colorref(255, 255, 255)).s32(1 | 2 | 4)
    for key in [0xCD, 0, 0xD0, 0, 0xCB, 0, 0xC8, 0]: w.s16(key)
    actions = [
        ('up', ['key:ArrowUp', 'pad:12', 'pad:axis1-'], False),
        ('down', ['key:ArrowDown', 'pad:13', 'pad:axis1+'], False),
        ('left', ['key:ArrowLeft', 'pad:14', 'pad:axis0-'], False),
        ('right', ['key:ArrowRight', 'pad:15', 'pad:axis0+'], False),
        ('confirm', ['key:Enter', 'key:Space', 'pad:0'], False),
        ('cancel', ['key:Escape', 'pad:1'], False),
        ('menu', ['key:Enter', 'pad:9'], False),
        ('game.heal', ['key:KeyH'], True),
    ]
    w.raw(b'TRKINP\0').u8(1).u8(1).u16(len(actions))
    for name, controls, locked in actions:
        w.string(name).u8(1 if locked else 0).u16(len(controls))
        for control in controls: w.string(control)
    open(path, 'wb').write(w.b)

def write_battle_files():
    open(out(PROJ, 'SpcMove', 'fireball.spc'), 'wb').write(
        Writer().string('RPGTLKIT SPLMOVE').s16(2).s16(2).string('Fireball').s32(12).s32(5)
        .string('fireball.prg').s32(0).i8(1).i8(0).string('burn.ste').string('').string('Hurls a ball of fire.').b)
    open(out(PROJ, 'StatusE', 'burn.ste'), 'wb').write(
        Writer().string('RPGTLKIT STATUSE').s16(2).s16(2).string('Burn')
        .s16(3).s16(0).s16(0).s16(0).s16(1).s16(2).s16(0).s16(0).s16(0).string('').b)
    open(out(PROJ, 'Bkrounds', 'forest.bkg'), 'wb').write(
        Writer().string('RPGTLKIT BKG').s16(2).s16(3).string('forest.tbm')
        .string('battle.mid').string('').string('').string('').string('').b)

def write_sav(path):
    w = (Writer().string('RPGTLKIT SAVE').s16(3).s16(4)
         .s32(2).string('ada[hp]').f64(27.0).string('questStage').f64(1.0)
         .s32(0)
         .s32(1).string('ada[name]').string('Ada')
         .s32(0)
         .s32(1).string('Ada').string('ada.tem')
         .s16(1).string('Game\\Example\\Item\\chest.itm').string('Chest').s32(1))
    for slot in range(16): w.string('').string('')
    w.s32(0).s32(0).s32(0).s32(0)
    (w.s32(0).s32(0).s32(15).s32(0).string('').s32(0).s32(colorref(255, 255, 255)).string('Arial')
      .s32(20).s32(0).s32(0).s32(0).s32(312).s32(42).string('example.gam').string('village.brd'))
    w.f64(208.0).f64(191.0).s32(1).s32(1).s32(-1).s32(0).s32(0).s32(0)
    w.s32(100).s32(0)
    for i in range(26): w.string('').string('')
    w.string('').string('').s32(0).string('')
    w.s32(0).s32(-1).f64(0.0).s32(0).s32(0)
    open(path, 'wb').write(w.b)

PROGRAMS = {
    'start.prg': '// Start-up program: runs once before the first board.\r\nmwin("Welcome to the example game!")\r\nwait()\r\nmwincls()\r\n',
    'open_chest.prg': '// Runs when the player activates the chest.\r\nif (chestOpened ~= 1)\r\n{\r\n    mwin("You found 10 gold.")\r\n    givegp(10)\r\n    chestOpened = 1\r\n    wait()\r\n    mwincls()\r\n}\r\n',
    'stairs_note.prg': 'mwin("The stairs lead up to layer 2.")\r\nwait()\r\nmwincls()\r\n',
    'fireball.prg': '// Battle program for the Fireball special move.\r\n',
}

EXAMPLES_README = '''# Example game

A small game in every RPG Toolkit 3 format, generated by [../tools/build_example_game.py](../tools/build_example_game.py) with art drawn by that script. Every binary file was read back with [../tools/rpgtk_formats.py](../tools/rpgtk_formats.py) and ends exactly at its last byte. Regenerate with `python3 build_example_game.py` in `tools/`. One example file for **every version** of every format is in [versions/](versions/README.md).

## Layout

`game/` is laid out like a Toolkit folder: `game/Main/example.gam` names the project folder `Game\\Example\\`, and `game/Saved/slot1.sav` is a saved game.

| Listing | File | What it shows |
|---|---|---|
{rows}

| File | Format |
|---|---|
| [files/example_game.tpk](files/example_game.tpk) | the whole game as a PAK (`main.gam` at the root, `\\`-separated names) |
| [files/standalone_layout.exe.bin](files/standalone_layout.exe.bin) | standalone-EXE layout: placeholder bytes instead of an engine, the PAK, then the `CMP1` trailer ([listing](listings/standalone_trailer.txt)) |
| [files/flower.gph](files/flower.gph) | a single text tile with run-length encoding (also `game/Game/Example/Tiles/flower.gph`) |
| `game/Game/Example/Prg/*.prg` | RPGCode programs, CRLF text |

## Renders

| | |
|---|---|
| ![board](renders/board.png) | ![tileset](renders/village_tst.png) |
| `village.brd`: 16x12 tiles, 2 layers, animated water (first frame shown), red circle = start position | `village.tst`: 22 tiles; magenta = transparent |

![isometric tile](renders/grass_iso.png) `grass.iso`: one tile poured into the 64x32 diamond.
'''

WHAT = {
    'main.gam': 'main file, minor 9, every field', 'board.brd': 'board: two layers, runs in the tile stream, shading, a light, solid / stairs / waypoint vectors, a run-once program, an item, a layer image, a link',
    'hero.tem': 'character, minor 8, with a special move and a custom stance', 'chest.itm': 'item, minor 7, usable as a board object',
    'slime.ene': 'enemy, with one custom stance in the layout the editor writes', 'hero_walk_s.anm': 'two-frame animation (51 slots)',
    'village.tst': 'tileset header and tiles', 'grass.iso': 'isometric tileset (version 30, detail 150)', 'water.tan': 'animated tile, 3 frames',
    'house.tbm': 'tile bitmap 2x2 (written as 3x3)', 'fireball.spc': 'special move', 'burn.ste': 'status effect', 'forest.bkg': 'fight background',
    'slot1.sav': 'saved game, minor 4, no running threads'}

def write_examples_readme(listing):
    rows = '\n'.join(f'| [listings/{t}.txt](listings/{t}.txt) | `{os.path.relpath(p, EX)}` | {WHAT[t]} |' for t, p in listing.items())
    open(out(EX, 'README.md'), 'w').write(EXAMPLES_README.replace('{rows}', rows))

# ------------------------------------------------------------------ build
def main():
    setup()
    imgs = [tile(fn) for _, fn in TILES]
    write_tileset(out(PROJ, 'Tiles', 'village.tst'), imgs)
    write_tileset(out(PROJ, 'Tiles', 'grass.iso'), [imgs[T['grass'] - 1]], version=30, detail=150)
    gph_vals = write_gph(out(PROJ, 'Tiles', 'flower.gph'), imgs[T['flower'] - 1])
    write_tan(out(PROJ, 'Tiles', 'water.tan'), 5, [f'village.tst{T[n]}' for n in ('water1', 'water2', 'water3')])
    write_tbm(out(PROJ, 'Bitmap', 'house.tbm'), [[f'village.tst{T["roof"]}', f'village.tst{T["wall"]}'],
                                                 [f'village.tst{T["roof"]}', f'village.tst{T["door"]}']])
    write_tbm(out(PROJ, 'Bitmap', 'forest.tbm'), [[f'village.tst{T["treetop"]}', f'village.tst{T["trunk"]}']])
    os.makedirs(out(PROJ, 'Misc', 'hero')); os.makedirs(out(PROJ, 'Misc', 'chest')); os.makedirs(out(PROJ, 'Misc', 'slime'))
    for d in 'snew':
        write_anm(out(PROJ, 'Misc', 'hero', f'hero_walk_{d}.anm'), 32, 32,
                  [f'village.tst{T[f"hero_{d.upper()}0"]}', f'village.tst{T[f"hero_{d.upper()}1"]}'], 0.15)
    write_anm(out(PROJ, 'Misc', 'hero', 'hero_wave.anm'), 32, 32,
              [f'village.tst{T["hero_S0"]}', f'village.tst{T["hero_E0"]}', f'village.tst{T["hero_S0"]}'], 0.2)
    write_anm(out(PROJ, 'Misc', 'chest', 'chest.anm'), 32, 32, [f'village.tst{T["chest"]}'], 0.0)
    write_anm(out(PROJ, 'Misc', 'slime', 'slime.anm'), 32, 32, [f'village.tst{T["slime"]}'], 0.3)
    # board: 16 x 12, layer 1 ground, layer 2 objects
    W, H = 16, 12
    ref = lambda n: f'village.tst{T[n]}'
    g = [[ref('grass')] * W for _ in range(H)]
    for x in range(W): g[7][x] = ref('path')
    for y in range(7, H): g[y][8] = ref('path')
    for y in range(1, 5):
        for x in range(11, 15): g[y][x] = 'water.tan'
    o = [[''] * W for _ in range(H)]
    for x in range(2, 6): o[2][x] = ref('roof'); o[3][x] = ref('roof')
    for x in range(2, 6): o[4][x] = ref('wall'); o[5][x] = ref('wall')
    o[5][4] = ref('door')
    for x, y in [(1, 9), (13, 9), (14, 10)]: o[y - 1][x] = ref('treetop'); o[y][x] = ref('trunk')
    for x, y in [(6, 10), (10, 2), (3, 9)]: o[y][x] = ref('flower')
    o[10][12] = ref('stairs')
    lut = ['']
    for layer in (g, o):
        for row in layer:
            for t in row:
                if t and t not in lut: lut.append(t)
    settings = {
        'vectors': [
            {'points': rect(64, 64, 192, 192), 'layer': 1, 'type': 1},                    # house: solid
            {'points': rect(384, 352, 416, 384), 'layer': 1, 'type': 8, 'attributes': 2},  # stairs to layer 2
            {'points': [(352, 64), (480, 64), (480, 160), (352, 160)], 'layer': 1, 'type': 1},  # pond: solid
            {'points': [(240, 256), (420, 256), (420, 300)], 'layer': 1, 'type': 16, 'closed': False,
             'handle': 'slime_patrol'},                                                   # waypoint
        ],
        'programs': [{'file': 'stairs_note.prg', 'layer': 1, 'activationType': 0,
                      'points': rect(384, 320, 416, 352),
                      'initialVar': 'a1b2c3', 'initialValue': '', 'finalVar': 'a1b2c3', 'finalValue': '_guid',
                      'activate': 1}],
        'items': [{'file': 'chest.itm', 'prgActivate': 'open_chest.prg', 'x': 304, 'y': 191, 'layer': 1,
                   'activationType': 1}],
        'images': [{'file': 'house.tbm', 'x': 448, 'y': 288, 'layer': 1}],
        'threads': [''], 'constants': [''],
        'titles': ['', 'ground', 'objects'],
        'links': ['', '', 'forest.brd', ''],
        'music': 'village.mid', 'enterPrg': '', 'battleBackground': 'forest.bkg', 'battleSkill': 1,
        'start': (208, 191, 1),
    }
    write_board(out(PROJ, 'Boards', 'village.brd'), W, H, [g, o], lut, settings)
    write_tem(out(PROJ, 'Chrs', 'ada.tem'))
    write_itm(out(PROJ, 'Item', 'chest.itm'))
    write_ene(out(PROJ, 'Enemy', 'slime.ene'))
    write_battle_files()
    for name, text in PROGRAMS.items():
        open(out(PROJ, 'Prg', name), 'w', newline='').write(text)
    write_gam(out(GAME, 'Main', 'example.gam'))
    os.makedirs(out(GAME, 'Saved'))
    write_sav(out(GAME, 'Saved', 'slot1.sav'))
    # PAK and standalone layout
    pak = out(EX, 'files', 'example_game.tpk')
    with zipfile.ZipFile(pak, 'w', zipfile.ZIP_DEFLATED) as z:
        z.write(out(GAME, 'Main', 'example.gam'), 'main.gam')
        for dp, dn, fn in os.walk(PROJ):
            for f in sorted(fn):
                z.write(out(dp, f), os.path.relpath(out(dp, f), PROJ).replace(os.sep, '\\'))
    engine = b'MZ' + b'\0' * 62 + b'(placeholder for the engine executable)'
    zbytes = open(pak, 'rb').read()
    exe = Writer().raw(engine).raw(zbytes).raw(b'CMP1').s32(len(engine)).s32(len(zbytes))
    open(out(EX, 'files', 'standalone_layout.exe.bin'), 'wb').write(exe.b)
    shutil.copy(out(PROJ, 'Tiles', 'flower.gph'), out(EX, 'files', 'flower.gph'))

    # ---- read everything back and write listings
    listing = {
        'main.gam': out(GAME, 'Main', 'example.gam'), 'board.brd': out(PROJ, 'Boards', 'village.brd'),
        'hero.tem': out(PROJ, 'Chrs', 'ada.tem'), 'chest.itm': out(PROJ, 'Item', 'chest.itm'),
        'slime.ene': out(PROJ, 'Enemy', 'slime.ene'), 'hero_walk_s.anm': out(PROJ, 'Misc', 'hero', 'hero_walk_s.anm'),
        'village.tst': out(PROJ, 'Tiles', 'village.tst'), 'grass.iso': out(PROJ, 'Tiles', 'grass.iso'),
        'water.tan': out(PROJ, 'Tiles', 'water.tan'), 'house.tbm': out(PROJ, 'Bitmap', 'house.tbm'),
        'fireball.spc': out(PROJ, 'SpcMove', 'fireball.spc'), 'burn.ste': out(PROJ, 'StatusE', 'burn.ste'),
        'forest.bkg': out(PROJ, 'Bkrounds', 'forest.bkg'), 'slot1.sav': out(GAME, 'Saved', 'slot1.sav'),
    }
    bad = 0
    for title, path in listing.items():
        kind = os.path.splitext(path)[1][1:]
        r = F.Reader(open(path, 'rb').read(), path)
        F.PARSERS[kind](r)
        ok = r.at_eof(); bad += not ok
        with open(out(EX, 'listings', title + '.txt'), 'w') as fh:
            fh.write(f'# {title}: {os.path.relpath(path, EX)} ({len(r.d)} bytes), parse ends at EOF: {ok}\n')
            fh.write('# offset  bytes (first 12)                         field = value\n')
            fh.write(F.annotate(r) + '\n')
    r = F.Reader(exe.b); F.parse_exe_trailer(r)
    open(out(EX, 'listings', 'standalone_trailer.txt'), 'w').write(
        '# standalone EXE trailer (placeholder engine bytes)\n' + F.annotate(r) + '\n')
    detail, back = F.parse_gph(open(out(PROJ, 'Tiles', 'flower.gph')).read())
    assert back == gph_vals, '.gph round trip failed'

    # ---- renders
    R.tileset_sheet(out(PROJ, 'Tiles', 'village.tst'), out(EX, 'renders', 'village_tst.png'), cols=8, scale=2)
    R.render_board(PROJ, 'Boards/village.brd', out(EX, 'renders', 'board.png'))
    R.render_iso(out(PROJ, 'Tiles', 'grass.iso'), 1, out(EX, 'renders', 'grass_iso.png'))
    write_examples_readme(listing)
    print('example files:', len(listing), 'not ending at EOF:', bad)
    return bad

if __name__ == '__main__':
    sys.exit(1 if main() else 0)
