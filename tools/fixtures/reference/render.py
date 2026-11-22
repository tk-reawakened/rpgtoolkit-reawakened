#!/usr/bin/env python3
"""Independent 2-D, isometric and lit-board oracle for tickets 4.4, 4.17 and 4.33.

This module deliberately imports only Pillow and the format readers published in
``docs/spec/tools/rpgtk_formats.py``. It consumes versioned JSON scene data and
renders RGBA PNGs using integer pixel operations. ``--check`` validates the
schema, regenerates every committed PNG, and compares decoded pixels.
"""
from __future__ import annotations

import argparse
import json
import os
import math
import re
import sys
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "docs" / "spec" / "tools"))
import rpgtk_formats as F  # noqa: E402

SCENE_DIR = ROOT / "golden" / "scenes"
PNG_DIR = ROOT / "golden" / "reference"
LEDGER = ROOT / "golden" / "ledger.json"


def fail(message: str) -> None:
    raise ValueError(message)


def _pair(value: Any, name: str) -> tuple[int, int]:
    if not isinstance(value, list) or len(value) != 2 or any(type(x) is not int for x in value):
        fail(f"{name} must be a pair of integers")
    return value[0], value[1]


def validate_scene(scene: Any, filename: str = "scene") -> dict[str, Any]:
    if not isinstance(scene, dict) or scene.get("schema") != 1:
        fail(f"{filename}: schema must be 1")
    if not isinstance(scene.get("name"), str) or not scene["name"]:
        fail(f"{filename}: name is required")
    layout = scene.get("layout", "2d")
    if layout not in {"2d", "iso-stacked", "iso-rotated"}:
        fail(f"{filename}: layout must be 2d, iso-stacked or iso-rotated")
    boards = scene.get("boardFiles")
    if not isinstance(boards, list) or not boards or any(not isinstance(p, str) for p in boards):
        fail(f"{filename}: boardFiles must be a non-empty string list")
    ambient = scene.get("ambient")
    if not isinstance(ambient, list) or len(ambient) != 3 or any(type(x) is not int or not -255 <= x <= 255 for x in ambient):
        fail(f"{filename}: ambient must contain three signed bytes")
    view = scene.get("view")
    if not isinstance(view, dict):
        fail(f"{filename}: view is required")
    width, height = _pair(view.get("viewport"), f"{filename}.view.viewport")
    if width <= 0 or height <= 0:
        fail(f"{filename}: viewport must be positive")
    _pair(view.get("camera"), f"{filename}.view.camera")
    include = view.get("include")
    if not isinstance(include, dict) or any(type(include.get(k)) is not bool for k in ("shading", "images", "sprites")):
        fail(f"{filename}: view.include must name three booleans")
    if type(scene.get("tick")) is not int or scene["tick"] < 0:
        fail(f"{filename}: tick must be a non-negative integer")
    sprites = scene.get("sprites")
    if not isinstance(sprites, list):
        fail(f"{filename}: sprites must be a list")
    required = ("id", "key", "layer", "x", "y", "drawId")
    for index, sprite in enumerate(sprites):
        if not isinstance(sprite, dict) or any(key not in sprite for key in required):
            fail(f"{filename}: sprite {index} is missing a SpriteDraw field")
        if not isinstance(sprite["id"], str) or not isinstance(sprite["key"], str):
            fail(f"{filename}: sprite {index} id/key must be strings")
        if any(type(sprite[key]) is not int for key in ("layer", "x", "y", "drawId")):
            fail(f"{filename}: sprite {index} numeric fields must be integers")
        if "prev" in sprite:
            _pair(sprite["prev"], f"{filename}.sprites[{index}].prev")
        if "under" in sprite and (not isinstance(sprite["under"], list) or any(type(x) is not int for x in sprite["under"])):
            fail(f"{filename}: sprite {index}.under must be integer flags")
    return scene


def load_scene(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        return validate_scene(json.load(handle), str(path))


def trace(path: Path, parser: Any) -> list[tuple[Any, Any, str, Any]]:
    reader = F.Reader(path.read_bytes())
    parser(reader)
    return reader.trace


def board_model(path: Path) -> dict[str, Any]:
    records = trace(path, F.parse_brd)
    model: dict[str, Any] = {"lut": [], "cells": [], "shades": [], "lights": [], "images": []}
    pending_run: int | None = None
    for _, _, field, value in records:
        if field in {"sizeX", "sizeY", "sizeL", "coordType", "startX", "startY", "startL", "ambient r", "ambient g", "ambient b", "bkgColor"}:
            model[field] = value
        elif field.startswith("LUT["):
            model["lut"].append(value)
        elif field.startswith("tile cell"):
            if value < 0:
                pending_run = -value
            else:
                model["cells"].append(value)
                pending_run = None
        elif field.startswith("  run of"):
            model["cells"].extend([value] * (pending_run or 0))
            pending_run = None
        elif field == "shade[0].layer":
            model["shadeCast"] = value
        elif field.startswith("shade[") and field.endswith("] count"):
            model["shades"].append([value, 0, 0, 0])
        elif field in ("r", "g", "b") and model["shades"] and len(model["shades"][-1]) < 4:
            model["shades"][-1]["rgb" if False else len(model["shades"][-1]) - 1] = value
        elif field.startswith("light[") and field.endswith(".type"):
            model["lights"].append({"type": value, "nodes": [], "colors": []})
        elif field.startswith("  node[") and field.endswith(".x"):
            model["lights"][-1]["nodes"].append([value, 0])
        elif field.startswith("  node[") and field.endswith(".y"):
            model["lights"][-1]["nodes"][-1][1] = value
        elif field in ("  r", "  g", "  b") and model["lights"] and model["lights"][-1]["nodes"]:
            # Colour records follow nodes; parse them as triples in a side list.
            colors = model["lights"][-1]["colors"]
            if not colors or len(colors[-1]) == 3:
                colors.append([])
            colors[-1].append(value)
        elif field.startswith("image[") and field.endswith(".file"):
            model["images"].append({"file": value})
        elif field.startswith("image[") and field.endswith(".x"):
            model["images"][-1]["x"] = value
        elif field.startswith("image[") and field.endswith(".y"):
            model["images"][-1]["y"] = value
        elif field.startswith("image[") and field.endswith(".layer"):
            model["images"][-1]["layer"] = value
        elif field.startswith("image[") and field.endswith(".type"):
            model["images"][-1]["type"] = value
        elif field.startswith("image[") and field.endswith(".transpColor"):
            model["images"][-1]["transpColor"] = value
    # The trace emits shading channels without a unique prefix; parse those from
    # the complete sequence separately to retain the documented run order.
    shade_start = next((i for i, r in enumerate(records) if r[2] == "shade layer upper bound"), None)
    light_start = next((i for i, r in enumerate(records) if r[2] == "light upper bound"), len(records))
    if shade_start is not None:
        shade_records = records[shade_start + 1:light_start]
        values = [r[3] for r in shade_records if r[2] in ("shade[0] count", "r", "g", "b")]
        model["shades"] = []
        for i in range(0, len(values), 4):
            if i + 3 < len(values): model["shades"].append(values[i:i + 4])
    return model


FIXED = 1_000_000
MAX_TINT = 1020


def _clamp(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, value))


def _light_value(colours: list[list[int]], weight: float) -> tuple[float, float, float]:
    """Edge colour plus (centre - edge) x weight, exactly, per channel (docs/spec/formats/board.md#lights)."""
    edge = colours[0] if colours else [0, 0, 0]
    end = colours[1] if len(colours) > 1 else edge
    return tuple(edge[i] + (end[i] - edge[i]) * weight for i in range(3))


def _spotlight_weight(light: dict[str, Any], point: tuple[int, int]) -> float | None:
    """1 at the centre falling linearly to 0 at the edge; None on or outside the edge. Node 1 is the centre."""
    nodes = light["nodes"]
    if len(nodes) < 3:
        return None
    first, centre, last = nodes[0], nodes[1], nodes[2]
    first_sq = (first[0] - centre[0]) ** 2 + (first[1] - centre[1]) ** 2
    last_sq = (last[0] - centre[0]) ** 2 + (last[1] - centre[1]) ** 2
    major, major_sq, minor_sq = (first, first_sq, last_sq) if first_sq > last_sq else (last, last_sq, first_sq)
    if major_sq == 0 or minor_sq == 0:
        return None
    mx, my = major[0] - centre[0], major[1] - centre[1]
    dx, dy = point[0] - centre[0], point[1] - centre[1]
    # Rotate into the ellipse's own axes without trigonometry: u = along the major axis, v = across it.
    along = (dx * mx + dy * my) / math.sqrt(major_sq)
    across = (dy * mx - dx * my) / math.sqrt(major_sq)
    radius = math.sqrt(along * along / major_sq + across * across / minor_sq)
    return None if radius >= 1 else 1 - radius


def _light_contribution(light: dict[str, Any], point: tuple[int, int]) -> tuple[float, float, float] | None:
    if light["type"] == 0:
        weight = _spotlight_weight(light, point)
        return None if weight is None else _light_value(light["colors"], weight)
    nodes = light["nodes"]
    if len(nodes) < 2:
        return None
    start, end = nodes[0], nodes[1]
    dx, dy = end[0] - start[0], end[1] - start[1]
    length_squared = dx * dx + dy * dy
    if length_squared == 0:
        return None
    numerator = (point[0] - start[0]) * dx + (point[1] - start[1]) * dy
    if light["type"] == 2 and not 0 <= numerator <= length_squared:
        return None
    return _light_value(light["colors"], _clamp(numerator / length_squared, 0.0, 1.0))


def _baked_light_records(model: dict[str, Any], painted: list[list[int]], width: int, height: int) -> list[list[int]]:
    """The painted shade plus every light, each light rounded toward zero once onto the running total."""
    cells: list[list[int]] = []
    for count, r, g, b in painted:
        cells.extend([[r, g, b] for _ in range(max(count, 1))])
    cells = (cells + [[0, 0, 0]] * (width * height))[: width * height]
    for y in range(height):
        for x in range(width):
            point = tile_pixel(model, x + 1, y + 1)
            total = cells[y * width + x]
            for light in model["lights"]:
                contribution = _light_contribution(light, point)
                if contribution is not None:
                    total = [int(total[channel] + contribution[channel]) for channel in range(3)]
            cells[y * width + x] = total
    return [[1, *cell] for cell in cells]


_palette: list[tuple[int, int, int]] | None = None


def dos_palette() -> list[tuple[int, int, int]]:
    global _palette
    if _palette is None:
        _palette = [tuple(rgb) for rgb in json.loads((ROOT / "docs/spec/formats/dos-palette.json").read_text())]
    return _palette


def tile_image(path: Path, number: int) -> Image.Image:
    data = path.read_bytes()
    version = int.from_bytes(data[0:2], "little")
    count = int.from_bytes(data[2:4], "little")
    detail = int.from_bytes(data[4:6], "little")
    if number < 1 or number > count:
        fail(f"tile {number} is outside {path}")
    size = 16 if detail in (2, 4, 6) else 32
    bpp = 3 if detail in (1, 2, 150) else 1
    block = size * size * bpp
    start = 6 + (number - 1) * block
    raw = data[start:start + block]
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pixels = image.load()
    offset = 0
    for x in range(size):
        for y in range(size):
            if bpp == 3:
                rgb = tuple(raw[offset:offset + 3]); offset += 3
                if rgb != (0, 1, 2): pixels[x, y] = (*rgb, 255)
            else:
                index = raw[offset]; offset += 1
                if index != 255: pixels[x, y] = (*dos_palette()[index], 255)
    if size == 16: image = image.resize((32, 32), Image.Resampling.NEAREST)
    if detail == 150:
        diamond = Image.new("RGBA", (64, 32), (0, 0, 0, 0)); target = diamond.load()
        it = iter([image.getpixel((x, y)) for x in range(32) for y in range(32)])
        for x in range(64):
            for y in range(32):
                if _iso_mask(x, y):
                    target[x, y] = next(it)
        image = diamond
    return image

def resolve_tile(project: Path, ref: str, tick: int, asset_dirs: tuple[Path, ...] = ()) -> Image.Image | None:
    if not ref: return None
    def asset_path(name: str) -> Path:
        default = project / "Tiles" / name
        if default.exists(): return default
        for directory in asset_dirs:
            candidate = directory / name
            if candidate.exists(): return candidate
        return default
    if ref.lower().endswith(".tan"):
        records = trace(asset_path(ref), F.parse_tan)
        frames = [value for _, _, field, value in records if field.startswith("frame[") and value]
        speed = next((value for _, _, field, value in records if field.startswith("speed")), 1)
        if not frames: return None
        frame = frames[(tick * speed // 60) % len(frames)]
        ref = frame
    match = re.match(r"(.+\.(?:tst|iso))(\d+)$", ref, re.I)
    if not match: return None
    return tile_image(asset_path(match.group(1)), int(match.group(2)))


def _iso_mask(x: int, y: int) -> bool:
    k = y if y <= 15 else 31 - y
    return 31 - 2 * k <= x <= 32 + 2 * k


def _round_half_up(numerator: int, denominator: int = 1) -> int:
    """Round an integer ratio to nearest, resolving .5 toward +infinity."""
    return (numerator * 2 + denominator) // (2 * denominator)


def project_2d_tile(image: Image.Image) -> Image.Image:
    """Project a 32×32 tile onto the exact 64×32 diamond mask.

    The inverse affine map is sx=(X-32+2Y)/2 and sy=(32-X+2Y)/2.
    Integer half-up rounding and source-edge clamping are used, as required by
    the Reawakened iso2d rule.
    """
    if image.size != (32, 32):
        fail(f"iso2d source must be 32x32, got {image.size}")
    out = Image.new("RGBA", (64, 32), (0, 0, 0, 0))
    source, target = image.load(), out.load()
    for x in range(64):
        for y in range(32):
            if not _iso_mask(x, y):
                continue
            sx = max(0, min(31, _round_half_up(x - 32 + 2 * y, 2)))
            sy = max(0, min(31, _round_half_up(32 - x + 2 * y, 2)))
            target[x, y] = source[sx, sy]
    return out


def board_pixel_size(model: dict[str, Any]) -> tuple[int, int]:
    """Return the documented canvas size for a board's coordinate style."""
    if model["coordType"] & 3 == 2:
        return 64 * model["sizeX"] - 32, 32 * model["sizeY"]
    if model["coordType"] & 1:
        return 64 * model["sizeX"] - 32, 16 * model["sizeY"] - 16
    return model["sizeX"] * 32, model["sizeY"] * 32


def tile_pixel(model: dict[str, Any], x: int, y: int) -> tuple[int, int]:
    """Return the projected reference point from board.md#coordinates."""
    if model["coordType"] & 3 == 2:
        return (
            (x - y + model["sizeX"]) * 32,
            (x + y - model["sizeX"]) * 16 - 16,
        )
    if model["coordType"] & 1:
        return 64 * x - (32 if y % 2 else 64), 16 * y - 16
    return (x - 1) * 32, (y - 1) * 32


def apply_tint(image: Image.Image, tint: tuple[int, int, int], zero_tint_exact: bool = True) -> Image.Image:
    if zero_tint_exact and tint == (0, 0, 0): return image.copy()
    out = Image.new("RGBA", image.size, (0, 0, 0, 0)); src, dst = image.load(), out.load()
    for x in range(image.width):
        for y in range(image.height):
            r, g, b, a = src[x, y]
            if not a: continue
            if tint != (0, 0, 0):
                r, g, b = ((245 if r == 255 else 10 if r == 0 else r), (245 if g == 255 else 10 if g == 0 else g), (245 if b == 255 else 10 if b == 0 else b))
            dst[x, y] = (max(0, min(255, r + tint[0])), max(0, min(255, g + tint[1])), max(0, min(255, b + tint[2])), a)
    return out


def bitmap_image(project: Path, filename: str, tick: int) -> Image.Image | None:
    path = project / "Bitmap" / filename
    if not path.exists(): return None
    records = trace(path, F.parse_tbm)
    width = next(v for _, _, f, v in records if f == "width")
    height = next(v for _, _, f, v in records if f == "height")
    out = Image.new("RGBA", (width * 32, height * 32), (0, 0, 0, 0))
    # Re-read each cell as a small state machine, preserving x/y from tile names.
    cell: tuple[int, int, str, list[int]] | None = None
    for _, _, field, value in records:
        match = re.match(r"cell\[(\d+)\]\[(\d+)\]\.tile", field)
        if match: cell = (int(match.group(1)), int(match.group(2)), value, [0, 0, 0]); continue
        if cell and field in ("  r", "  g", "  b"):
            cell[3][("  r", "  g", "  b").index(field)] = value
            if field == "  b":
                tile = resolve_tile(project, cell[2], tick)
                if tile: out.alpha_composite(apply_tint(tile, tuple(cell[3])), (cell[0] * 32, cell[1] * 32))
    return out


def render(scene: dict[str, Any]) -> Image.Image:
    board_path = ROOT / scene["boardFiles"][0]
    model = board_model(board_path)
    expected_layout = "iso-rotated" if model["coordType"] & 3 == 2 else "iso-stacked" if model["coordType"] & 1 else "2d"
    if scene.get("layout", "2d") != expected_layout:
        fail(f"{scene['name']}: layout does not match board coordType")
    project = board_path.parent.parent
    asset_dirs = tuple((ROOT / path).parent for path in scene["boardFiles"][1:])
    board_size = board_pixel_size(model)
    board = Image.new("RGBA", board_size, (model.get("bkgColor", 0) & 255, (model.get("bkgColor", 0) >> 8) & 255, (model.get("bkgColor", 0) >> 16) & 255, 255))
    cells = model["cells"]
    include = scene["view"]["include"]
    ambient = tuple(scene["ambient"][i] + model.get(("ambient r", "ambient g", "ambient b")[i], 0) for i in range(3))
    stored_shades = model["shades"]
    dynamic_shades: list[list[int]] = []
    if include["shading"] and model["lights"]:
        # Lights are a distinct cast-layer-zero shading layer. Stored shade
        # layers retain their own cast-layer threshold rather than being
        # flattened ahead of the newly baked light records.
        rotated_grid = model["coordType"] & 3 == 2
        light_width = model["sizeX"] + model["sizeY"] if rotated_grid else model["sizeX"]
        light_height = light_width if rotated_grid else model["sizeY"]
        dynamic_shades = _baked_light_records(model, stored_shades, light_width, light_height)
        model["shades"] = dynamic_shades
    elif not include["shading"]:
        model["shades"] = []
    else:
        dynamic_shades = model["shades"]
    rotated = model["coordType"] & 3 == 2
    iso = model["coordType"] & 3 in (1, 2)
    grid_width = model["sizeX"] + model["sizeY"] if rotated else model["sizeX"]
    grid_height = grid_width if rotated else model["sizeY"]
    cells_per_layer = grid_width * grid_height
    draw_tiles: list[tuple[tuple[int, int, int, int], Image.Image, tuple[int, int, int], tuple[int, int]]] = []
    for index, tile_ref in enumerate(cells):
        if not tile_ref or index >= cells_per_layer * model["sizeL"]:
            continue
        layer, rem = divmod(index, cells_per_layer)
        y, x = divmod(rem, grid_width)
        ref = model["lut"][tile_ref] if tile_ref < len(model["lut"]) else ""
        tile = resolve_tile(project, ref, scene["tick"], asset_dirs)
        if tile is None:
            continue
        if iso and tile.size == (32, 32):
            tile = project_2d_tile(tile)
        tint = ambient
        # A shade layer cast onto layer N tints layers 1..N; a baked layer with no stored shading is cast onto every layer.
        cast = model.get("shadeCast", 0) if stored_shades else 0
        if include["shading"] and model["shades"] and (cast == 0 or layer + 1 <= cast):
            shade_index = y * grid_width + x
            cursor = 0
            shade = (0, 0, 0)
            for count, r, g, b in model["shades"]:
                if cursor <= shade_index < cursor + count:
                    shade = (r, g, b)
                    break
                cursor += count
            tint = tuple(tint[i] + shade[i] for i in range(3))
        if iso:
            px, py = tile_pixel(model, x + 1, y + 1)
            # Paint each isometric layout in projected screen order. The
            # stacked and rotated boards have different centre formulas, but
            # both use the same layer -> y -> x painter's key.
            draw_tiles.append(((layer, py, px, index), tile, tint, (px - 32, py - 16)))
        else:
            draw_tiles.append(((layer, y, x, index), tile, tint, (x * 32, y * 32)))
    # Layer order (board.md#drawing-order-and-effects): a sprite draws on its own layer, so
    # it is already in place when the tiles of the next layer are painted.
    sprites = sorted(scene["sprites"], key=lambda item: (item["layer"], item["y"], item["drawId"])) if include["sprites"] else []
    draw = ImageDraw.Draw(board, "RGBA")
    def draw_sprites(wanted: Any) -> None:
        for sprite in sprites:
            if wanted(sprite["layer"]):
                x, y = sprite["x"] - 8, sprite["y"] - 16
                colour = (64, 96, 224, 255) if sprite["key"] == "player" else (192, 128, 32, 255)
                draw.rectangle((x, y, x + 15, y + 15), fill=colour)
    ordered = sorted(draw_tiles, key=lambda item: item[0])
    for tile_layer in range(model["sizeL"]):
        for key, tile, tint, position in ordered:
            if key[0] == tile_layer:
                board.alpha_composite(apply_tint(tile, tint), position)
        draw_sprites(lambda layer, number=tile_layer + 1: layer <= 1 if number == 1 else layer == number)
    draw_sprites(lambda layer: layer > model["sizeL"])
    if include["images"]:
        for image in model["images"]:
            if image.get("file"):
                bitmap = bitmap_image(project, image["file"], scene["tick"])
                if bitmap: board.alpha_composite(bitmap, (image.get("x", 0), image.get("y", 0)))
        for image in scene["view"].get("layerImages", []):
            bitmap = bitmap_image(project, image["file"], scene["tick"])
            if bitmap:
                if image["type"] == "stretch": bitmap = bitmap.resize(board.size, Image.Resampling.NEAREST)
                board.alpha_composite(bitmap, (image.get("x", 0), image.get("y", 0)))
    for blit in scene["view"].get("blits", []):
        x, y, width, height = blit["rect"]
        alpha = blit.get("alpha", 255)
        overlay = Image.new("RGBA", (width, height), (255, 255, 255, alpha) if blit["mode"] == "additive" else (0, 0, 0, alpha))
        board.alpha_composite(overlay, (x, y))
    viewport = tuple(scene["view"]["viewport"])
    camera = tuple(scene["view"]["camera"])
    if scene["view"].get("smallBoard") == "center-if-small":
        offset = ((viewport[0] - board.width) // 2, (viewport[1] - board.height) // 2)
    else:
        camera = (
            max(0, min(camera[0], max(0, board.width - viewport[0]))),
            max(0, min(camera[1], max(0, board.height - viewport[1]))),
        )
        offset = (-camera[0], -camera[1])
    out = Image.new("RGBA", viewport, (0, 0, 0, 255))
    out.alpha_composite(board, offset)
    return out


def compare_pixels(actual: Image.Image, expected: Image.Image) -> bool:
    # Compare every channel: `ImageChops.difference(...).getbbox()` on RGBA looks only at alpha,
    # so two opaque images with different colours would compare equal.
    return actual.mode == expected.mode and actual.size == expected.size and actual.tobytes() == expected.tobytes()


def check() -> list[str]:
    problems: list[str] = []
    grass = ROOT / "docs/spec/examples/game/Game/Example/Tiles/grass.iso"
    grass_expected = ROOT / "docs/spec/examples/renders/grass_iso.png"
    try:
        tile = tile_image(grass, 1)
        canvas = Image.new("RGBA", tile.size, (255, 0, 255, 255))
        canvas.alpha_composite(tile)
        expected = Image.open(grass_expected).convert("RGBA")
        actual = canvas.resize(expected.size, Image.Resampling.NEAREST)
        if not compare_pixels(actual, expected):
            problems.append("grass.iso: decoded RGBA differs from docs/spec example render")
    except Exception as error:
        problems.append(f"grass.iso: {error}")
    ledger = json.loads(LEDGER.read_text(encoding="utf-8"))
    entries = ledger.get("goldens")
    if not isinstance(entries, list): return ["ledger.goldens must be a list"]
    # Other reference PNGs (for example the bitmap-font pangram) are not board scenes.
    committed = {path.name for path in PNG_DIR.glob("S-*.png")}
    listed = set()
    for entry in entries:
        if not isinstance(entry, dict) or not all(k in entry for k in ("path", "class", "gating", "producer")):
            problems.append("malformed ledger row"); continue
        if entry.get("suite") == "closing":
            # The closing suite's frames are regression baselines of the whole engine, not independent-renderer scenes:
            # `pnpm closing` replays them. They must be honest about that and stay out of golden/reference.
            if entry["class"] != "regression-baseline": problems.append(f"closing row is not a regression-baseline: {entry}")
            if not str(entry["path"]).startswith("golden/regression/closing/"): problems.append(f"closing row path is outside golden/regression/closing/: {entry}")
            if not (ROOT / entry["path"]).is_file(): problems.append(f"{entry['path']}: committed PNG is missing")
            continue
        path = Path(entry["path"]); listed.add(path.name)
        if entry["class"] not in {"independent-reference", "legacy-screenshot", "regression-baseline"}: problems.append(f"invalid class: {entry}")
        if not isinstance(entry["gating"], bool): problems.append(f"gating is not boolean: {entry}")
        png = ROOT / path
        scene_path = SCENE_DIR / f"{path.stem}.json"
        try: scene = load_scene(scene_path); actual = render(scene); expected = Image.open(png).convert("RGBA")
        except Exception as error: problems.append(f"{path}: {error}"); continue
        if not compare_pixels(actual, expected): problems.append(f"{path}: decoded RGBA differs")
    if committed != listed: problems.append(f"ledger PNG set differs: committed={sorted(committed)} listed={sorted(listed)}")
    return problems


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--scene")
    args = parser.parse_args(argv)
    if args.scene:
        scene = load_scene(SCENE_DIR / args.scene)
        PNG_DIR.mkdir(parents=True, exist_ok=True)
        render(scene).save(PNG_DIR / f"{Path(args.scene).stem}.png")
    if args.check:
        problems = check()
        for problem in problems: print(f"reference/render.py: {problem}", file=sys.stderr)
        if problems: return 1
        print("reference goldens match decoded RGBA")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
