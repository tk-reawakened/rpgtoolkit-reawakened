#!/usr/bin/env python3
"""Readers and writers for RPG Toolkit 3 game files.

Implements the layouts in ../formats/*.md. Every read is recorded as
(offset, size, field, value) so a parse can be printed as an annotated listing.

Usage:
    python3 rpgtk_formats.py verify DIR          parse every game file under DIR
    python3 rpgtk_formats.py dump FILE [TYPE]    annotated listing of one file

Exit code of `verify` is 1 if any file does not parse to exactly its end.
"""
import struct, sys, os, json, re

class FormatError(Exception):
    pass

# ---------------------------------------------------------------- primitives
class Reader:
    """Binary primitives: little-endian numbers, NUL-terminated ANSI strings."""
    def __init__(self, data, name=''):
        self.d, self.p, self.name, self.trace = data, 0, name, []
    def _rec(self, start, field, value):
        self.trace.append((start, self.p - start, field, value))
        return value
    def _num(self, fmt, size, field):
        if self.p + size > len(self.d):
            raise FormatError(f'{field}: needs {size} bytes at 0x{self.p:x}, file is {len(self.d)}')
        start = self.p
        v = struct.unpack_from('<' + fmt, self.d, self.p)[0]
        self.p += size
        return self._rec(start, field, v)
    def i8(self, f):  return self._num('b', 1, f)    # VB Byte / C char (signed in C)
    def u8(self, f):  return self._num('B', 1, f)
    def s16(self, f): return self._num('h', 2, f)    # VB Integer / C short
    def u16(self, f): return self._num('H', 2, f)
    def s32(self, f): return self._num('i', 4, f)    # VB Long / C int
    def u32(self, f): return self._num('I', 4, f)
    def f64(self, f): return self._num('d', 8, f)    # VB Double / C double
    def string(self, f):
        start = self.p
        end = self.d.find(b'\0', self.p)
        if end < 0:
            raise FormatError(f'{f}: unterminated string at 0x{start:x}')
        s = self.d[self.p:end].decode('cp1252', 'replace')
        self.p = end + 1
        return self._rec(start, f, s)
    def raw(self, n, f, show=None):
        start = self.p
        if self.p + n > len(self.d):
            raise FormatError(f'{f}: needs {n} bytes at 0x{start:x}')
        self.p += n
        return self._rec(start, f, show if show is not None else f'<{n} bytes>')
    def header(self, expected, f='header'):
        s = self.string(f)
        if s != expected:
            raise FormatError(f'header {s!r} != {expected!r}')
        return s
    def at_eof(self): return self.p == len(self.d)
    def more(self, what): return self.p < len(self.d)   # 'repeat until end of file'

class Writer:
    """Inverse of Reader; used to build example files for formats with no sample."""
    def __init__(self): self.b = bytearray()
    def i8(self, v):  self.b += struct.pack('<b', v); return self
    def u8(self, v):  self.b += struct.pack('<B', v); return self
    def s16(self, v): self.b += struct.pack('<h', v); return self
    def u16(self, v): self.b += struct.pack('<H', v); return self
    def s32(self, v): self.b += struct.pack('<i', v); return self
    def f64(self, v): self.b += struct.pack('<d', v); return self
    def string(self, s): self.b += s.encode('cp1252') + b'\0'; return self
    def raw(self, b): self.b += b; return self

def is_binary(data, header):
    """The byte where the binary header's NUL would be decides binary vs legacy text."""
    return len(data) > len(header) and data[len(header)] == 0

# ---------------------------------------------------------------- main file (.gam)
def parse_gam(r):
    r.header('RPGTLKIT MAIN')
    r.s16('majorVer'); mv = r.s16('minorVer')
    # Written as short + "NOCODE"; the original engine read int + string (same total length).
    r.s16('registered'); r.string('registration code')
    r.string('projectPath'); r.string('gameTitle')
    r.s16('mainScreenType'); r.s16('extendToFullScreen'); r.s16('mainResolution')
    if mv < 3: r.s16('(unused short, minor<3)')
    r.s16('mainDisableProtectReg'); r.string('language file')
    r.string('startupPrg'); r.string('initBoard'); r.string('initChar')
    r.string('runTime'); r.s16('runKey (ASCII)'); r.s16('menuKey (ASCII)'); r.s16('key (ASCII)')
    n = r.s16('runTimeKeys upper bound')
    for i in range(n + 1):
        r.s16(f'runTimeKey[{i}]'); r.string(f'runTimePrg[{i}]')
    if mv >= 3:
        r.string('menuPlugin'); r.string('fightPlugin')
    else:
        r.s16('(unused short, minor<3)')
    if mv <= 2:
        r.s32('(unused int, minor<=2)'); r.s16('(unused short, minor<=2)')
    r.s16('fightGameYn')
    n = r.s16('enemy list upper bound')
    for i in range(n + 1):
        r.string(f'enemy[{i}]'); r.s16(f'enemySkill[{i}]')
    r.s16('fightType'); r.s32('chances'); r.s16('fprgYn'); r.string('fightPrg')
    if mv < 3: r.s16('(unused short, minor<3)')
    r.string('gameOverPrg'); r.string('skinButton'); r.string('skinWindow')
    n = r.s16('plugin list upper bound')
    for i in range(n + 1):
        if mv <= 2: r.s16(f'plugin[{i}] enabled')
        else: r.string(f'plugin[{i}]')
    r.s16('mainUseDayNight'); r.s16('mainDayNightType'); r.s32('mainDayLength')
    if mv >= 3:
        r.string('cursorMoveSound'); r.string('cursorSelectSound'); r.string('cursorCancelSound')
        r.i8('useJoystick'); r.i8('colorDepth')
    if mv >= 4:
        r.u8('gameSpeed'); r.i8('pixelMovement')
    if mv == 5: r.i8('cursor enabled (minor 5)')
    if mv >= 6:
        r.string('mouseCursor'); r.i8('hotSpotX'); r.i8('hotSpotY'); r.s32('transpColor')
    if mv >= 7: r.s32('resX'); r.s32('resY')
    if mv >= 8: r.i8('bFpsInTitleBar')
    if mv >= 9:
        r.s16('pfHeuristic'); r.s32('drawVectors'); r.s32('pathColor'); r.s32('movementControls')
        for d in ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE']:
            r.s16(f'movementKey[{d}]')
    # TKR extension order: package list, audio settings, input settings. The
    # input block is shown field-by-field; unrelated trailing bytes stay opaque.
    if r.d[r.p:r.p + 7] == b'TKRPLUG\0':
        r.raw(7, 'TKR package-list marker', 'TKRPLUG\\0')
        n = r.u16('TKR package count')
        for i in range(n): r.string(f'TKR package[{i}]')
    if r.d[r.p:r.p + 7] == b'TRKAUD\0':
        r.raw(7, 'TKR audio-settings marker', 'TRKAUD\\0')
        n = r.u16('TKR audio track count')
        for i in range(n): r.string(f'TKR audio track[{i}]'); r.u16(f'TKR audio voice count[{i}]')
        r.u16('TKR audio voice cap')
        if r.u8('TKR audio font-present'): r.string('TKR audio default SoundFont')
    if r.d[r.p:r.p + 7] == b'TRKINP\0':
        r.raw(7, 'TKR input-settings marker', 'TRKINP\\0')
        r.u8('TKR input schema')
        r.u8('TKR controller enabled')
        n = r.u16('TKR input action count')
        for i in range(n):
            r.string(f'TKR action[{i}] name')
            r.u8(f'TKR action[{i}] flags')
            c = r.u16(f'TKR action[{i}] control count')
            for j in range(c): r.string(f'TKR action[{i}] control[{j}]')

# ---------------------------------------------------------------- board (.brd)
def parse_brd(r):
    if r.d[14] != 0: raise FormatError('byte 14 non-zero: Toolkit 2 text board')
    r.header('RPGTLKIT BOARD')
    r.s16('majorVer'); mv = r.s16('minorVer')
    if mv in (0, 1): raise FormatError('minor 0/1: not supported')
    if mv in (2, 3): return parse_brd_prevector(r, mv)
    sx = r.s16('sizeX'); sy = r.s16('sizeY'); sl = r.s16('sizeL'); ct = r.s16('coordType')
    w, h = (sx + sy, sx + sy) if (ct & 3) == 2 else (sx, sy)   # ISO_ROTATED
    lut = r.s16('LUT upper bound')
    for i in range(lut + 1): r.string(f'LUT[{i}]')
    cells, total = 0, w * h * sl
    while cells < total:
        v = r.s16(f'tile cell {cells}')
        if v < 0:
            r.s16(f'  run of {-v} -> LUT index'); cells += -v
        else:
            cells += 1
    nsh = r.s16('shade layer upper bound')
    for s in range(nsh + 1):
        r.s32(f'shade[{s}].layer')
        c = 0
        while c < w * h:
            n = r.s16(f'shade[{s}] count'); r.s16('r'); r.s16('g'); r.s16('b')
            c += n if n > 1 else 1
    n = r.s16('light upper bound')
    for i in range(n + 1):
        r.s32(f'light[{i}].layer'); r.s32(f'light[{i}].type')
        p = r.s16(f'light[{i}].nodes UB')
        for j in range(p + 1): r.s32(f'  node[{j}].x'); r.s32(f'  node[{j}].y')
        c = r.s16(f'light[{i}].colors UB')
        for j in range(c + 1): r.s16('  r'); r.s16('  g'); r.s16('  b')
    n = r.s16('vector upper bound')
    for i in range(n + 1):
        p = r.s16(f'vector[{i}].points UB')
        for j in range(p + 1): r.s32(f'  pt[{j}].x'); r.s32(f'  pt[{j}].y')
        r.s16(f'vector[{i}].attributes'); r.s16(f'vector[{i}].closed')
        r.s16(f'vector[{i}].layer'); r.s16(f'vector[{i}].type'); r.string(f'vector[{i}].handle')
    n = r.s16('program upper bound')
    for i in range(n + 1):
        for f in ['fileName', 'graphic', 'initialVar', 'initialValue', 'finalVar', 'finalValue']:
            r.string(f'program[{i}].{f}')
        r.s16(f'program[{i}].activate'); r.s16(f'program[{i}].activationType')
        r.s16(f'program[{i}].distanceRepeat'); r.s16(f'program[{i}].layer')
        p = r.s16(f'program[{i}].points UB')
        for j in range(p + 1): r.s32(f'  pt[{j}].x'); r.s32(f'  pt[{j}].y')
        r.s16(f'program[{i}].closed'); r.string(f'program[{i}].(reserved handle)')
    n = r.s16('sprite upper bound')
    for i in range(n + 1):
        for f in ['fileName', 'prgActivate', 'prgMultitask', 'initialVar', 'initialValue',
                  'finalVar', 'finalValue', 'loadingVar', 'loadingValue']:
            r.string(f'sprite[{i}].{f}')
        r.s16(f'sprite[{i}].activate'); r.s16(f'sprite[{i}].activationType')
        r.s16(f'sprite[{i}].x'); r.s16(f'sprite[{i}].y'); r.s16(f'sprite[{i}].z')
        r.s16(f'sprite[{i}].(reserved waypoint)')
    n = r.s16('image upper bound')
    for i in range(n + 1):
        r.string(f'image[{i}].file'); r.s32(f'image[{i}].x'); r.s32(f'image[{i}].y')
        r.s16(f'image[{i}].layer'); r.s16(f'image[{i}].type'); r.s32(f'image[{i}].transpColor')
        r.s16(f'image[{i}].(reserved)')
    n = r.s16('thread upper bound')
    for i in range(n + 1): r.string(f'thread[{i}]')
    n = r.s16('constant upper bound')
    for i in range(n + 1): r.string(f'constant[{i}]')
    for i in range(sl + 1): r.string(f'layerTitle[{i}]')
    for d in 'NSEW': r.string(f'link {d}')
    r.string('bkgImage file'); r.s32('bkgImage type'); r.s32('bkgColor')
    r.string('bkgMusic'); r.string('enterPrg'); r.string('battleBackground')
    r.s16('battleSkill'); r.s16('bAllowBattles'); r.s16('bDisableSaving')
    r.s16('ambient r'); r.s16('ambient g'); r.s16('ambient b')
    r.s16('startX'); r.s16('startY'); r.s16('startL')

def parse_brd_prevector(r, mv):
    r.s16('registered'); r.string('reg. code')
    sx = r.s16('sizeX'); sy = r.s16('sizeY'); sl = r.s16('sizeL')
    r.s16('startX'); r.s16('startY'); r.s16('startL'); r.s16('bDisableSaving')
    lut = r.s16('LUT upper bound')
    for i in range(lut + 1): r.string(f'LUT[{i}]')
    cells, total = 0, sx * sy * sl
    while cells < total:
        v = r.s16(f'cell {cells}')
        if v < 0:
            r.s16(' index'); r.s16(' r'); r.s16(' g'); r.s16(' b'); r.i8(' tiletype'); cells += -v
        else:
            r.s16(' r'); r.s16(' g'); r.s16(' b'); r.i8(' tiletype'); cells += 1
    for f in ['bkg image', 'foreground image', 'border image']: r.string(f)
    r.s32('bkgColor'); r.s32('border colour'); r.s16('ambient effect')
    for d in 'NSEW': r.string(f'link {d}')
    r.s16('battleSkill'); r.string('battleBackground'); r.s16('bAllowBattles')
    r.s16('boardDayNight'); r.s16('nightBattleOverride'); r.s16('skillNight'); r.string('backgroundNight')
    for i in range(11): r.s16(f'constant[{i}]')
    r.string('bkgMusic')
    for i in range(9): r.string(f'layerTitle[{i}]')
    n = r.s16('program upper bound')
    for i in range(n + 1):
        r.string('fileName'); r.s16('x'); r.s16('y'); r.s16('layer'); r.string('graphic'); r.s16('activate')
        r.string('initialVar'); r.string('finalVar'); r.string('initialValue'); r.string('finalValue')
        r.s16('activationType')
    r.string('enterPrg'); r.string('(unused)')
    n = r.s16('sprite upper bound')
    for i in range(n + 1):
        r.string('fileName'); r.s16('x'); r.s16('y'); r.s16('layer'); r.s16('activate')
        r.string('initialVar'); r.string('finalVar'); r.string('initialValue'); r.string('finalValue')
        r.s16('activationType'); r.string('prgActivate'); r.string('prgMultitask')
    if mv >= 3:
        n = r.s32('thread upper bound')
        for i in range(n + 1): r.string(f'thread[{i}]')
        r.i8('coordType (iso byte)')

# ---------------------------------------------------------------- character (.tem)
DIRS8 = ['S', 'N', 'E', 'W', 'NW', 'NE', 'SW', 'SE']
def parse_tem(r):
    if r.d[13] != 0: raise FormatError('byte 13 non-zero: legacy text character')
    r.header('RPGTLKIT CHAR'); r.s16('majorVer'); mv = r.s16('minorVer')
    for f in ['name', 'experienceVar', 'defenseVar', 'fightVar', 'healthVar', 'maxHealthVar',
              'nameVar', 'smVar', 'smMaxVar', 'levelVar']:
        r.string(f)
    for f in ['experience', 'health', 'maxHealth', 'defense', 'fight', 'sm', 'smMax', 'level']:
        r.s32(f)
    r.string('profilePic')
    for i in range(201):
        r.string(f'specialMove[{i}].file'); r.s32(f'specialMove[{i}].minExp'); r.s32(f'specialMove[{i}].minLevel')
        r.string(f'specialMove[{i}].conditionVar'); r.string(f'specialMove[{i}].requiredValue')
    r.string('specialMoveName'); r.i8('smYN')
    for i in range(11): r.string(f'accessoryName[{i}]')
    for i in range(7): r.i8(f'armorType[{i}]')
    r.i8('levelType (byte, minor 3)') if mv == 3 else r.s32('levelType')
    r.s16('experienceIncrease'); r.s32('maxLevel')
    for f in ['levelHp', 'levelDp', 'levelFp', 'levelSm']: r.s16(f)
    if mv < 5:
        for f in ['swipe', 'defend', 'special', 'death']: r.string(f'{f} sound (minor < 5)')
    r.string('levelUpProgram'); r.i8('levelUpType'); r.i8('sizeType')
    if mv < 5:                                    # Toolkit 2 binary: tile names, nothing else follows
        for x in range(16):
            for y in range(2): r.string(f'walkTile[{x}][{y}]')
        for x in range(4):
            for y in range(2):
                for z in range(2):
                    for g in ['fight', 'defend', 'special', 'death']: r.string(f'{g}Tile[{x}][{y}][{z}]')
        for x in range(2):
            for y in range(2): r.string(f'restTile[{x}][{y}]')
        for x in range(10):
            for y in range(2): r.string(f'customTile[{x}][{y}]')
        return
    for d in DIRS8: r.string(f'walk[{d}]')
    for f in ['FIGHT', 'DEFEND', 'SPECIAL MOVE', 'DIE', 'REST']: r.string(f'anim {f}')
    r.string('(unused string)')
    if mv >= 6:
        for d in DIRS8: r.string(f'idle[{d}]')
    if mv >= 7: r.f64('idleTime (s)'); r.f64('speed (s/frame)')
    n = r.s32('custom anim upper bound')
    for i in range(n + 1): r.string(f'custom[{i}].animation'); r.string(f'custom[{i}].name')
    if mv >= 8: parse_sprite_vectors(r)

def parse_sprite_vectors(r):
    r.s16('vector count')
    for v in ['base', 'activate']:
        p = r.s16(f'{v} points UB')
        for j in range(p + 1): r.s32(f'  {v}[{j}].x'); r.s32(f'  {v}[{j}].y')

# ---------------------------------------------------------------- item (.itm)
def parse_itm(r):
    if r.d[13] != 0: raise FormatError('byte 13 non-zero: legacy item')
    r.header('RPGTLKIT ITEM'); r.s16('majorVer'); mv = r.s16('minorVer')
    r.string('itemName'); r.string('description')
    for f in ['equipYN', 'menuYN', 'boardYN', 'fightYN', 'usedBy']: r.i8(f)
    for i in range(51): r.string(f'allowedCharacter[{i}]')
    num = r.s32 if mv >= 3 else r.s16
    num('buyPrice'); num('sellPrice'); r.i8('keyItem')
    for i in range(8): r.i8(f'equipSlot[{i}]')
    r.string('accessory')
    for f in ['equipHP', 'equipDP', 'equipFP', 'equipSM']: num(f)
    r.string('prgEquip'); r.string('prgRemove')
    num('menuHP'); num('menuSM'); r.string('prgMenuUse')
    num('fightHP'); num('fightSM'); r.string('prgFightUse')
    r.string('animation'); r.string('prgOnBoard'); r.string('prgPickUp'); r.i8('sizeType')
    if mv >= 4:
        for d in DIRS8: r.string(f'walk[{d}]')
        r.string('rest gfx'); r.string('(unused string)')
        if mv >= 5:
            for d in DIRS8: r.string(f'idle[{d}]')
            r.f64('speed (s/frame)'); r.f64('idleTime (s)')
        n = r.s32('custom anim upper bound')
        for i in range(n + 1): r.string(f'custom[{i}].animation'); r.string(f'custom[{i}].name')
        if mv >= 7: parse_sprite_vectors(r)
    else:
        for x in range(16):
            for y in range(2): r.string(f'itmWalkGfx[{x}][{y}]')
        r.string('itmRestGfx[0]'); r.string('itmRestGfx[1]')

# ---------------------------------------------------------------- enemy (.ene)
def parse_ene(r, editor_order=False, editor_layout=True):
    if r.d[14] != 0: raise FormatError('byte 14 non-zero: legacy text enemy')
    r.header('RPGTLKIT ENEMY'); r.s16('majorVer'); r.s16('minorVer')
    r.string('name'); r.s32('hp'); r.s32('smp'); r.s32('fp'); r.s32('dp')
    r.i8('canRun'); r.s16('takeCrit'); r.s16('giveCrit')
    for lst in ['specialMove', 'weakness', 'strength']:
        n = r.s16(f'{lst} upper bound')
        for i in range(n + 1): r.string(f'{lst}[{i}]')
    r.i8('ai'); r.i8('useCode'); r.string('prg'); r.s32('exp'); r.s32('gp')
    r.string('winPrg'); r.string('runPrg')
    n = r.s16('animations UB')
    names = ['REST', 'FIGHT', 'DEFEND', 'SPECIAL', 'DIE']
    for i in range(n + 1): r.string(f'animation[{i}] {names[i] if i < 5 else "spare"}')
    n = r.s32('custom stance UB (int, as written)') if editor_layout else r.s16('custom stance UB (short, as the original engine read it)')
    if editor_layout: editor_order = True
    a, b = ('animation', 'name') if editor_order else ('name', 'animation')
    for i in range(n + 1): r.string(f'custom[{i}].{a}'); r.string(f'custom[{i}].{b}')

# ---------------------------------------------------------------- animation (.anm)
def parse_anm(r):
    r.header('RPGTLKIT ANIM'); r.s16('majorVer'); mv = r.s16('minorVer')
    if mv != 3: raise FormatError('only minor 3 is valid')
    r.s32('width'); r.s32('height'); n = r.s32('frame UB')
    for i in range(n + 1):
        r.string(f'frame[{i}].image'); r.s32(f'frame[{i}].transpColor'); r.string(f'frame[{i}].sound')
    r.f64('delay (s)')

# ---------------------------------------------------------------- tile bitmap (.tbm)
def parse_tbm(r):
    r.header('TK3 TILEBITMAP'); r.s16('majorVer'); r.s16('minorVer')
    w = r.s16('width'); h = r.s16('height')
    for x in range(w + 1):
        for y in range(h + 1):
            r.string(f'cell[{x}][{y}].tile'); r.s16('  r'); r.s16('  g'); r.s16('  b')

# ---------------------------------------------------------------- tile animation (.tan)
def parse_tan(r):
    r.header('RPGTLKIT TILEANIM'); r.s16('majorVer'); r.s16('minorVer')
    r.s32('speed (1..200; delay = 1000/speed ms)'); n = r.s32('frameCount (exact)')
    for i in range(n): r.string(f'frame[{i}]')

# ---------------------------------------------------------------- fight background (.bkg)
def parse_bkg(r):
    if r.d[12] != 0: raise FormatError('byte 12 non-zero: legacy text background')
    r.header('RPGTLKIT BKG'); r.s16('majorVer'); r.s16('minorVer')
    for f in ['image', 'music', 'selectSound', 'chooseSound', 'readySound', 'cantDoSound']: r.string(f)

# ---------------------------------------------------------------- status effect (.ste)
def parse_ste(r):
    if r.d[16] != 0: raise FormatError('byte 16 non-zero: legacy text status effect')
    r.header('RPGTLKIT STATUSE'); r.s16('majorVer'); r.s16('minorVer'); r.string('name')
    for f in ['rounds', 'speed', 'slow', 'disable', 'hp', 'hpAmount', 'smp', 'smpAmount', 'code']: r.s16(f)
    r.string('prg')

# ---------------------------------------------------------------- special move (.spc)
def parse_spc(r):
    if r.d[16] != 0: raise FormatError('byte 16 non-zero: legacy text special move')
    r.header('RPGTLKIT SPLMOVE'); r.s16('majorVer'); r.s16('minorVer'); r.string('name')
    r.s32('fp'); r.s32('smp'); r.string('prg'); r.s32('targetSmp'); r.i8('battle'); r.i8('menu')
    r.string('statusEffect'); r.string('animation'); r.string('description')

# ---------------------------------------------------------------- tileset (.tst / .iso)
TILE_BYTES = {1: 3072, 2: 768, 3: 1024, 4: 256, 5: 1024, 6: 256, 150: 3072}
def parse_tst(r):
    ver = r.u16('version (20 .tst, 30 .iso)'); n = r.u16('tileCount'); det = r.u16('detail')
    if ver not in (20, 30): raise FormatError(f'version {ver} not accepted')
    if det not in TILE_BYTES: raise FormatError(f'detail {det} unknown')
    sz = TILE_BYTES[det]
    for i in range(n):
        r.raw(sz, f'tile {i + 1} ({sz} bytes, column-major)')

# ---------------------------------------------------------------- editor settings (toolkit.cfg)
def parse_cfg(r):
    r.header('RPGToolkit3 Configuration File')
    r.s16('tipsOnOff'); r.string('tipFile'); r.s32('tipNum'); r.s16('commandsDocked'); r.s16('filesDocked')
    r.string('lastProject'); r.string('mp3Path'); r.string('wallpaper')
    for i in range(5): r.s16(f'quickEnabled[{i}]'); r.string(f'quickTarget[{i}]'); r.string(f'quickIcon[{i}]')
    r.s16('tutCurrentLesson'); r.string('m_LangFile'); r.string('lastTileset')
    r.s16('grabTips'); r.s16('advTilesetTips'); r.s16('(removed board-toolbar flag)')
    if not r.at_eof(): r.s16('3.1.0 sentinel')

# ---------------------------------------------------------------- standalone EXE trailer
def parse_exe_trailer(r):
    if len(r.d) < 12 or r.d[-12:-8] != b'CMP1': raise FormatError('no CMP1 trailer')
    r.p = len(r.d) - 12
    r.raw(4, 'magic', 'CMP1'); ol = r.s32('engine length E (= ZIP offset)'); el = r.s32('ZIP length Z')
    if ol + el + 12 != len(r.d): raise FormatError('lengths do not add up')


# ---------------------------------------------------------------- saved game (.sav)
def parse_sav(r):
    """Minors 0-4. Threads with a program name in minor 4 carry a program-state block (not decoded here)."""
    r.header('RPGTLKIT SAVE'); r.s16('majorVer'); mv = r.s16('minorVer')
    for kind, val in [('numeric', r.f64), ('object', r.f64), ('literal', r.string)]:
        n = r.s32(f'{kind} globals count')
        for i in range(n): r.string(f'{kind}[{i}].name'); val(f'{kind}[{i}].value')
    n = r.s32('redirect count')
    for i in range(n): r.string(f'redirect[{i}].from'); r.string(f'redirect[{i}].to')
    players = r.s32('player count') if mv >= 4 else 5
    for i in range(players): r.string(f'player[{i}].name'); r.string(f'player[{i}].fileName')
    n = r.s16('inventory count (short)')
    for i in range(n): r.string(f'inv[{i}].fileName'); r.string(f'inv[{i}].handle'); r.s32(f'inv[{i}].quantity')
    for slot in range(1, 17):
        for pl in range(players): r.string(f'equip slot {slot} player {pl} file'); r.string('  handle')
    for pl in range(players):
        for f in ['hp', 'sm', 'dp', 'fp']: r.s32(f'player[{pl}] equip {f}')
    r.s32('menu colour (unused)'); r.s32('selected player'); r.s32('gp'); r.s32('message window colour')
    r.string('message window bkg'); r.s32('debugger'); r.s32('font colour'); r.string('font face')
    r.s32('font size'); r.s32('bold'); r.s32('underline'); r.s32('italic')
    r.s32('game time (s)'); r.s32('steps (tiles)'); r.string('main file'); r.string('board')
    unit = 'px' if mv >= 4 else 'tiles'
    for pl in range(players):
        r.f64(f'player[{pl}].x ({unit})'); r.f64(f'player[{pl}].y ({unit})'); r.s32(f'player[{pl}].layer')
        if mv >= 4:
            r.s32(f'player[{pl}].active'); r.s32(f'player[{pl}].path vector index')
            r.s32(f'player[{pl}].cycles'); r.s32(f'player[{pl}].nextNode'); r.s32(f'player[{pl}].attributes')
    for pl in range(players): r.s32(f'player[{pl}].nextLevel'); r.s32(f'player[{pl}].levelProgression')
    for i in range(26): r.string(f'otherPlayer[{i}]'); r.string('  handle')
    r.string('menu graphic'); r.string('fight menu graphic'); r.s32('message window width (unused)')
    r.string('NewPlayer() graphics')
    if mv >= 4:
        n = r.s32('board item count')
        for i in range(n):
            if not r.string(f'item[{i}].fileName'): continue
            for f in ['prgActivate', 'prgMultitask', 'initialVar', 'initialValue', 'finalVar', 'finalValue']:
                r.string(f'item[{i}].{f}')
            r.s16(f'item[{i}].activate'); r.s16(f'item[{i}].activationType')
            r.f64(f'item[{i}].x'); r.f64(f'item[{i}].y'); r.s32(f'item[{i}].layer'); r.s32(f'item[{i}].active')
            for f in ['path index', 'cycles', 'nextNode', 'attributes']: r.s32(f'item[{i}].{f}')
    n = r.s32('thread upper bound')
    for i in range(n + 1):
        fn = r.string(f'thread[{i}].fileName'); pers = r.s32(f'thread[{i}].persistent')
        if mv < 4:
            r.s32(f'thread[{i}].position (ignored)')
        elif pers and r.s32(f'thread[{i}].isItemThread'):
            r.s32(f'thread[{i}].item index')
        r.s32(f'thread[{i}].sleeping')
        r.f64(f'thread[{i}].sleep remaining ({"ms" if mv >= 4 else "s"})')
        if mv >= 4:
            if fn: raise FormatError('program-state block not decoded by this reader')
        else:
            h = r.s32(f'thread[{i}].local heaps UB')
            for k in range(h + 1):
                nn = r.s32(f'  heap[{k}] numeric count')
                for j in range(nn): r.string(f'  heap[{k}].num[{j}].name'); r.f64(f'  heap[{k}].num[{j}].value')
                nl = r.s32(f'  heap[{k}] literal count')
                for j in range(nl): r.string(f'  heap[{k}].lit[{j}].name'); r.string(f'  heap[{k}].lit[{j}].value')
    r.f64('movement size (0 px, 1 tile)')
    if mv >= 1:
        n = r.s32('object count')
        for i in range(n): r.u32(f'object[{i}].handle'); r.string(f'object[{i}].class')
    if mv >= 2: r.s32('loop offset')

# ---------------------------------------------------------------- single tile (.gph, text)
def parse_gph(text):
    """Returns (detail, 32x32 or 16x16 list of COLORREF, -1 = transparent), x outer / y inner."""
    lines = [l.strip() for l in text.replace('\r\n', '\n').split('\n')]
    if lines[0].upper() != 'RPGTLKIT TILE': raise FormatError('version-1 tile (no header)')
    major, minor, detail, comp = (int(x) for x in lines[1:5])
    n = 32 if detail in (1, 3, 5) else 16
    px, vals = [], [int(x) for x in lines[5:] if x != '']
    if comp == 0:
        px = vals[:n * n]
    else:
        it = iter(vals)
        for count, colour in zip(it, it): px += [colour] * count
    if len(px) != n * n: raise FormatError(f'{len(px)} pixels decoded, expected {n * n}')
    return detail, px

# ================================================================ write mode
class _ZeroProbe:
    """Stands in for file data during encoding: legacy-probe bytes read as 0 (binary)."""
    def __getitem__(self, i): return 0
    def __len__(self): return 1 << 30

class Encoder:
    """Runs a parse_* layout function in reverse: every field asks `value(field, kind)`
    for its value and writes it. The layout is therefore exactly the reader's."""
    def __init__(self, value):
        self.value, self.b, self.trace, self.d = value, bytearray(), [], _ZeroProbe()
    def _put(self, fmt, f, kind):
        v = self.value(f, kind); self.b += struct.pack('<' + fmt, v); return v
    def i8(self, f):  return self._put('b', f, 'int')
    def u8(self, f):  return self._put('B', f, 'int')
    def s16(self, f): return self._put('h', f, 'int')
    def u16(self, f): return self._put('H', f, 'int')
    def s32(self, f): return self._put('i', f, 'int')
    def u32(self, f): return self._put('I', f, 'int')
    def f64(self, f): return self._put('d', f, 'float')
    def string(self, f):
        v = self.value(f, 'str'); self.b += v.encode('cp1252') + b'\0'; return v
    def raw(self, n, f, show=None):
        v = self.value(f, 'raw'); assert len(v) == n, (f, len(v), n); self.b += v; return show
    def header(self, expected, f='header'):
        self.b += expected.encode('cp1252') + b'\0'; return expected
    def more(self, what): return bool(self.value(what, 'more'))
    def at_eof(self): return True

def encode(layout, value, **kw):
    e = Encoder(value); layout(e, **kw); return bytes(e.b)

# ================================================================ line-based (legacy text) formats
class LineReader:
    """Reads one value per line (CRLF, CR or LF). Records (line number, field, value)."""
    def __init__(self, text, name=''):
        self.lines = text.replace('\r\n', '\n').replace('\r', '\n').split('\n')
        if self.lines and self.lines[-1] == '': self.lines.pop()
        self.i, self.trace, self.name = 0, [], name
    def line(self, f):
        if self.i >= len(self.lines): raise FormatError(f'{f}: past the last line ({len(self.lines)})')
        v = self.lines[self.i]; self.trace.append((self.i + 1, f, v)); self.i += 1; return v
    def num(self, f): return int(float(self.line(f).strip() or 0))
    def at_end(self): return self.i == len(self.lines)

class LineEncoder:
    def __init__(self, value): self.value, self.out = value, []
    def line(self, f):
        v = self.value(f, 'line'); self.out.append(str(v)); return str(v)
    def num(self, f):
        v = self.value(f, 'num'); self.out.append(str(v)); return int(v)
    def text(self): return '\r\n'.join(self.out) + '\r\n'

def encode_text(layout, value, **kw):
    e = LineEncoder(value); layout(e, **kw); return e.text()

def annotate_lines(r):
    out = [f'{n:5d}  {f} = {v!r}' for n, f, v in r.trace]
    # collapse long runs of identical single-line fields
    res, i = [], 0
    while i < len(out):
        j = i
        key = lambda k: re.sub(r'\d+', '#', r.trace[k][1]) + '|' + r.trace[k][2]
        while j + 1 < len(out) and key(j + 1) == key(i): j += 1
        res.append(out[i])
        if j - i >= 2: res.append(f'       ... same field repeated, {j - i + 1} lines in total (to line {r.trace[j][0]})')
        elif j > i: res += out[i + 1:j + 1]
        i = j + 1
    res.append(f'       <end of parse at line {r.i}; file has {len(r.lines)} lines>')
    return '\n'.join(res)

def text_header(t, expected, f='header'):
    v = t.line(f)
    if v.strip().upper() != expected.upper(): raise FormatError(f'header {v!r} != {expected!r}')

def text_main(t, header='RPGTLKIT MAIN'):
    """Toolkit 2 text main file."""
    text_header(t, header); t.num('major'); t.num('minor')
    for f in ['registered (ignored)', 'startupPrg', 'runTime', 'use built-in menu (ignored)', 'runKey (ASCII)',
              'menuKey (ASCII)', 'key (ASCII)', 'initBoard', 'initChar', 'fightGameYn', 'multitask speed (ignored)',
              'memory protection (ignored)']:
        t.line(f)
    for i in range(501): t.line(f'enemy[{i}]'); t.line(f'skill[{i}]')
    for f in ['fightType', 'chances', 'fprgYn', 'fightPrg', '(ignored)', 'gameTitle', 'mainScreenType',
              'fighting style (ignored)', 'gameOverPrg', 'projectPath', 'skinButton', 'skinWindow',
              'target platform (ignored)']:
        t.line(f)
    for i in range(51): t.line(f'runTimeKey[{i}]'); t.line(f'runTimePrg[{i}]')
    t.line('registration code (ignored)'); t.line('extendToFullScreen'); t.line('mainResolution')
    n = t.num('plugin count')
    for i in range(n): t.line(f'use tkplug{i}.dll')
    for f in ['mainUseDayNight', 'mainDayNightType', 'mainDayLength', 'mainDisableProtectReg',
              'parallax (ignored)', 'language file']:
        t.line(f)

def text_main_v1(t):
    """Toolkit 1 main file (the fight file is separate: see text_fight_v1)."""
    for f in ['(ignored)', 'startupPrg', 'runTime', 'runKey (a character)', 'initBoard', '(ignored)', '(ignored)',
              'fightType', 'chances', 'fight file name']:
        t.line(f)

def text_fight_v1(t):
    for i in range(251): t.line(f'enemy[{i}]'); t.line(f'skill[{i}]')

def _text_tile(t, prefix, empty_marker=False):
    first = t.line(f'{prefix} pixel (0,0)')
    if empty_marker and first.strip() == '-2': return
    for k in range(1, 1024): t.line(f'{prefix} pixel ({k // 32},{k % 32})')

def text_char(t):
    text_header(t, 'RPGTLKIT CHAR'); t.num('major'); mv = t.num('minor')
    t.line('name')
    for v in ['experienceVar', 'defenseVar', 'fightVar', 'healthVar', 'maxHealthVar', 'nameVar', 'smVar', 'smMaxVar', 'levelVar']:
        t.line(v)
    for v in ['experience', 'health', 'maxHealth', 'defense', 'fight', 'sm', 'smMax', 'level']: t.line(v)
    t.line('profilePic')
    for i in range(201):
        for f in ['file', 'minExp', 'minLevel', 'conditionVar', 'requiredValue']: t.line(f'specialMove[{i}].{f}')
    t.line('specialMoveName'); t.line('smYN')
    size = t.num('sizeType') if mv > 0 else 0
    if size == 0:
        for i in range(16): _text_tile(t, f'walk tile {i}')
        for f in range(4):
            for k in range(1024):
                for g in ['fight', 'special', 'defend', 'death']: t.line(f'{g} tile {f} pixel ({k // 32},{k % 32})')
        _text_tile(t, 'rest tile')
        for i in range(10): _text_tile(t, f'custom tile {i}')
    else:
        for x in range(16):
            for u in range(2): t.line(f'walkTile[{x}][{u}]')
        if mv == 1:
            for u in range(2):
                for x in range(4):
                    for g in ['fight', 'defend', 'special', 'death']: t.line(f'{g}Tile[{x}][{u}]')
            for u in range(2): t.line(f'restTile[{u}]')
        else:
            for u in range(2):
                for v in range(2):
                    for x in range(4):
                        for g in ['fight', 'defend', 'special', 'death']: t.line(f'{g}Tile[{x}][{u}][{v}]')
            for u in range(2):
                for v in range(2): t.line(f'restTile[{u}][{v}]')
        for x in range(10):
            for u in range(2): t.line(f'customTile[{x}][{u}]')
    for i in range(1, 11): t.line(f'accessory[{i}]')
    for i in range(1, 7): t.line(f'armourSlot[{i}]')
    for f in ['levelType', 'experienceIncrease', 'maxLevel', 'levelHp', 'levelDp', 'levelFp', 'levelSm',
              'swipe sound', 'defend sound', 'special sound', 'death sound', 'levelUpProgram', 'levelUpType']:
        t.line(f)

def text_item(t):
    text_header(t, 'RPGTLKIT ITEM'); t.num('major'); mv = t.num('minor')
    t.line('itemName')
    for f in ['equipYN', 'menuYN', 'boardYN', 'fightYN']: t.line(f)
    for i in range(1, 8): t.line(f'equipSlot[{i}]')
    for f in ['accessory', 'equipHP', 'equipDP', 'equipFP', 'equipSM', 'prgEquip', 'prgRemove',
              'menuHP', 'menuSM', 'prgMenuUse', 'fightHP', 'fightSM', 'prgFightUse', 'prgOnBoard', 'prgPickUp']:
        t.line(f)
    size = t.num('sizeType') if mv == 1 else 0
    if size == 0:
        for i in range(16): _text_tile(t, f'walk tile {i}', empty_marker=True)
        _text_tile(t, 'rest tile', empty_marker=True)
    else:
        for x in range(16):
            for u in range(2): t.line(f'walkTile[{x}][{u}]')
        for u in range(2): t.line(f'restTile[{u}]')
    t.line('usedBy')
    for i in range(1, 51): t.line(f'allowedCharacter[{i}]')
    for f in ['buyPrice', 'sellPrice', 'keyItem', 'description', 'animation']: t.line(f)

def text_enemy(t):
    text_header(t, 'RPGTLKIT ENEMY'); t.num('major'); t.num('minor')
    for f in ['name', 'hp', 'smp', 'fp', 'dp', 'canRun', 'takeCrit', 'giveCrit', 'width', 'height']: t.line(f)
    for x in range(1, 20):
        for y in range(1, 8): t.line(f'tile[{x}][{y}]')
    for i in range(101): t.line(f'specialMove[{i}]'); t.line(f'weakness[{i}]')
    for f in ['ai', 'useCode', 'prg', 'exp', 'gp', 'winPrg', 'runPrg']: t.line(f)
    for i in range(4): t.line('(ignored)')
    for f in ['FIGHT', 'DEFEND', 'SPECIAL', 'DIE']: t.line(f'{f} animation')

def text_bkg(t):
    text_header(t, 'RPGTLKIT BKG'); t.num('major'); t.num('minor')
    for x in range(19):
        for y in range(11): t.line(f'tile[{x}][{y}]')
    for f in ['music', 'selectSound', 'chooseSound', 'readySound', 'cantDoSound', '(ignored)']: t.line(f)
    for x in range(19):
        for y in range(11):
            for c in 'rgb': t.line(f'tint[{x}][{y}].{c}')

def text_ste(t):
    text_header(t, 'RPGTLKIT STATUSE'); t.num('major'); t.num('minor')
    for f in ['name', 'rounds', 'speed', 'slow', 'disable', 'hp', 'hpAmount', 'smp', 'smpAmount', 'code', 'prg']: t.line(f)

def text_spc(t):
    text_header(t, 'RPGTLKIT SPLMOVE'); t.num('major'); t.num('minor')
    for f in ['name', 'fp', 'smp', 'prg', 'targetSmp', 'battle', 'menu', 'statusEffect', 'animation', 'description']:
        t.line(f)

def text_anm(t):
    text_header(t, 'RPGTLKIT ANIM'); t.num('major'); t.num('minor')
    t.num('width'); t.num('height'); n = t.num('frame UB')
    for i in range(n + 1):
        t.line(f'frame[{i}].image'); t.line(f'frame[{i}].transpColor'); t.line(f'frame[{i}].sound')
    t.line('delay (s)')

def text_gph(t):
    """Version 2 single tile (header present), compressed or not."""
    text_header(t, 'RPGTLKIT TILE'); t.num('major'); t.num('minor')
    det = t.num('detail'); comp = t.num('compression')
    n = (32 if det in (1, 3, 5) else 16) ** 2
    if comp == 0:
        for k in range(n): t.num(f'pixel {k}')
    else:
        k, run = 0, 0
        while k < n:
            c = t.num(f'run {run} count'); t.num(f'run {run} value'); k += c; run += 1
        if k != n: raise FormatError(f'runs cover {k} pixels, expected {n}')

def text_gph_v1(t):
    for y in range(16):
        v = t.line(f'row {y} (16 characters, code - 33 = palette index)')
        if len(v) != 16: raise FormatError(f'row {y} has {len(v)} characters')

TEXT_LAYOUTS = {'main': text_main, 'main_v1': text_main_v1, 'fight_v1': text_fight_v1, 'char': text_char,
                'item': text_item, 'enemy': text_enemy, 'bkg': text_bkg, 'ste': text_ste, 'spc': text_spc,
                'anm': text_anm, 'gph': text_gph, 'gph_v1': text_gph_v1}

# ================================================================ compiled RPGCode program
def parse_prg_compiled(r):
    r.raw(1, 'marker (00 = compiled)', '00')
    i = 0
    while r.string(f'function[{i}] name (empty ends the table)'): i += 1
    c = 0
    while r.string(f'class[{c}] name (empty ends the section)'):
        k = 0
        while r.string(f'class[{c}] base[{k}] (empty ends)'): k += 1
        k = 0
        while r.string(f'class[{c}] member[{k}] name (empty ends)'): r.s32(f'class[{c}] member[{k}] visibility'); k += 1
        k = 0
        while r.string(f'class[{c}] method[{k}] name (empty ends)'):
            r.s32(f'class[{c}] method[{k}] params'); r.u32(f'class[{c}] method[{k}] instruction'); r.s32(f'class[{c}] method[{k}] visibility'); k += 1
        c += 1
    u = 0
    while r.more('instruction'):
        f = r.s32(f'instruction[{u}] type flags')
        if f & (2 | 32 | 64): r.f64(f'instruction[{u}] number')
        elif f & (4 | 8 | 512): r.string(f'instruction[{u}] text')
        elif f & 1024: r.string(f'instruction[{u}] plugin command')
        elif f & 16: r.s32(f'instruction[{u}] function id'); r.s32(f'instruction[{u}] parameter count')
        u += 1

PARSERS = {'gam': parse_gam, 'brd': parse_brd, 'tem': parse_tem, 'itm': parse_itm, 'ene': parse_ene,
           'anm': parse_anm, 'tbm': parse_tbm, 'tan': parse_tan, 'bkg': parse_bkg, 'ste': parse_ste,
           'spc': parse_spc, 'tst': parse_tst, 'iso': parse_tst, 'cfg': parse_cfg, 'sav': parse_sav, 'prgc': parse_prg_compiled}

def parse(path, kind=None, **kw):
    data = open(path, 'rb').read()
    kind = (kind or os.path.splitext(path)[1][1:]).lower()
    r = Reader(data, path)
    PARSERS[kind](r, **kw)
    return r

# ---------------------------------------------------------------- annotated listing
def annotate(r, collapse=True):
    """Annotated listing. A block of 1-12 fields that repeats at least 3 times with
    identical values (only the indices in the field names differ) is printed once,
    followed by a line giving the repeat count."""
    import re
    norm = lambda row: (re.sub(r'\d+', '#', row[2]), row[1], row[3])
    rows, out, i = r.trace, [], 0
    def line(row):
        off, size, field, value = row
        raw = r.d[off:off + size]
        hx = raw[:12].hex(' ') + (' ..' if size > 12 else '')
        v = repr(value) if isinstance(value, str) else value
        return f'{off:06x}  {hx:<38} {field} = {v}'
    while i < len(rows):
        best = (1, 1)
        if collapse:
            for k in range(1, 13):
                blk = [norm(x) for x in rows[i:i + k]]
                if len(blk) < k: break
                n = 1
                while [norm(x) for x in rows[i + n * k:i + (n + 1) * k]] == blk: n += 1
                if n >= 3 and n * k > best[0] * best[1]: best = (k, n)
        k, n = best
        for row in rows[i:i + k]: out.append(line(row))
        if n > 1:
            last = rows[i + n * k - 1]
            out.append(f'{"":8}{"":38} ... block above repeated x{n} in total '
                       f'(through {last[2]}, ending at 0x{last[0] + last[1]:x})')
        i += k * n
    out.append(f'{r.p:06x}  <end of parse; file length 0x{len(r.d):x}>')
    return '\n'.join(out)

def verify(root):
    import glob
    ok = bad = 0
    files = []
    for ext in ['gam', 'brd', 'tem', 'itm', 'ene', 'anm', 'tbm', 'tan', 'bkg', 'ste', 'spc', 'tst', 'iso']:
        files += glob.glob(f'{root}/**/*.{ext}', recursive=True)
    for f in sorted(files):
        kind = 'cfg' if f.endswith('.cfg') else None
        try:
            r = parse(f, kind)
            if r.at_eof():
                ok += 1; print(f'OK    {os.path.relpath(f, root)}  ({len(r.d)} bytes, {len(r.trace)} fields)')
            else:
                bad += 1; print(f'SHORT {os.path.relpath(f, root)}  parse stopped at 0x{r.p:x} of 0x{len(r.d):x}')
        except FormatError as e:
            bad += 1; print(f'FAIL  {os.path.relpath(f, root)}  {e}')
    print(f'\n{ok} parsed exactly to end of file, {bad} did not')
    return bad

if __name__ == '__main__':
    if len(sys.argv) >= 2 and sys.argv[1] == 'verify':
        sys.exit(1 if verify(sys.argv[2] if len(sys.argv) > 2 else '.') else 0)
    elif len(sys.argv) >= 3 and sys.argv[1] == 'dump':
        print(annotate(parse(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)))
    else:
        print(__doc__)
