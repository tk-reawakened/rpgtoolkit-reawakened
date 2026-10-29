# Game images (`.bmp`, `.gif`)

Games ship pictures in `Bitmap/` (and a few elsewhere) in one of four kinds: PNG, JPEG, Windows bitmap or GIF. PNG and JPEG are third-party formats read as-is; a Windows bitmap and a GIF are the same. A **tile bitmap** (`.tbm`) also lives in `Bitmap/` but is not one of these kinds: its cells are composed from tiles as [tiles.md](tiles.md#tile-bitmap-tbm) describes, and the composed picture follows the shared decode contract below. The engine reads every one of them in one place and turns it into pixels; this page records the Windows bitmap and GIF layouts so the readers have a specification to work from, since [README.md](README.md) previously called these third-party formats with no page of their own.

The layouts below are public formats — the Microsoft bitmap layout and the CompuServe GIF layout — written here in the byte order of this spec ([README.md](README.md#primitive-encoding): `short` is signed 16-bit little-endian, `int` is signed 32-bit little-endian). No RPG Toolkit file format is involved.

## The shared decode contract

Every image the engine loads, whatever its kind, becomes the same pixels, so that the rasteriser, every runner and the editor cannot disagree about what an image contains:

- The result is **straight** (non-premultiplied) 8-bit RGBA of exactly `width × height × 4` bytes in row-major order, **top row first**: the file's own colours and its own alpha, nothing added. Because colour-key transparency is stored with whatever references the image and never in the file, the reader never applies a key; the key is tested against these pixels by whatever blits the image.
- The kind is chosen by **signature**. A Windows bitmap starts with the two bytes `BM` (`42 4D`); a GIF starts with `GIF87a` (`47 49 46 38 37 61`) or `GIF89a` (`47 49 46 38 39 61`). PNG (`89 50 4E 47 0D 0A 1A 0A`) and JPEG (`FF D8 FF`) complete the set. Any other signature is refused at offset 0.
- Every defect is a **located error** carrying the file's path, the offending byte offset and the section `docs/spec/formats/images.md#the-shared-decode-contract` — never a throw and never a plausible wrong picture.
- A **zero dimension** is refused, and so is an image of more than **100,000,000 pixels**: `width × height` is untrusted input, so past that limit the allocation is not attempted and the file is refused instead. The limit is far above any game asset. A GIF is a stack of **pages** held at once, so for it the limit applies both to its logical screen and to `pages × screen` together ([GIF](#gif)).

## Windows bitmap (`.bmp`)

The layout below is the public Microsoft bitmap layout, written here in the byte order of this spec ([README.md](README.md#primitive-encoding): `short` is signed 16-bit little-endian, `int` is signed 32-bit little-endian). No RPG Toolkit file format is involved.

**Reawakened rule (reader boundary).** The BMP reader decodes **uncompressed `BI_RGB` bitmaps of 1, 4, 8, 24 and 32 bits per pixel, plus 8-bit `RLE8`**, each with a 40-byte DIB header and one plane. Every other BMP variant is refused with a located error naming the field and its value, rather than approximated into a wrong picture. This is the set a Toolkit-era game actually ships (see [Evidence](#evidence)) plus the two nearest variants a board-image export can produce.

### The Windows bitmap layout

A bitmap is a 14-byte file header, a 40-byte DIB header, an optional palette, then the pixel array.

#### File header (14 bytes)

| Offset | Field | Type | Meaning |
|---|---|---|---|
| 0 | `bfType` | 2 bytes | `BM` (`42 4D`) |
| 2 | `bfSize` | `int` | Size of the whole file in bytes |
| 6 | `bfReserved1` | `short` | 0 |
| 8 | `bfReserved2` | `short` | 0 |
| 10 | `bfOffBits` | `int` | Byte offset from the start of the file to the pixel array |

`bfSize` is not trusted for allocation: the reader checks the pixel array's extent against the bytes that remain in the file (below), exactly as an untrusted count is checked in [README.md](README.md#counts-are-usually-upper-bounds).

#### DIB header (40 bytes, `BITMAPINFOHEADER`)

| Offset | Field | Type | Meaning |
|---|---|---|---|
| 14 | `biSize` | `int` | 40. Any other value is refused (a `BITMAPCOREHEADER` of 12, or a `V4`/`V5` header of 108/124, names its own size here) |
| 18 | `biWidth` | `int` | Width in pixels; must be positive |
| 22 | `biHeight` | `int` | Height in pixels. **Positive: rows are stored bottom-up.** Negative: the magnitude is the height and rows are stored top-down |
| 26 | `biPlanes` | `short` | 1. Any other value is refused |
| 28 | `biBitCount` | `short` | Bits per pixel: 1, 4, 8, 24 or 32 |
| 30 | `biCompression` | `int` | 0 = `BI_RGB` (uncompressed); 1 = `BI_RLE8` (8-bit run-length); 2 = `BI_RLE4`; 3 = `BI_BITFIELDS`; 4 = `BI_JPEG`; 5 = `BI_PNG`. Only 0, and 1 at 8 bits, are decoded |
| 34 | `biSizeImage` | `int` | Size of the pixel array in bytes; 0 is allowed for `BI_RGB` and is not used by the reader |
| 38 | `biXPelsPerMeter` | `int` | Resolution hint; ignored |
| 42 | `biYPelsPerMeter` | `int` | Resolution hint; ignored |
| 46 | `biClrUsed` | `int` | Palette entries in use, or 0 meaning the full `2^biBitCount` the depth addresses |
| 50 | `biClrImportant` | `int` | Ignored |

**Reawakened rule (refusals).** Each of these is a located error at the field's own offset, never a decoded guess:

- `biSize` other than 40 (the message names the size read).
- `biWidth` or `biHeight` of 0.
- `abs(biWidth) × abs(biHeight)` above 100,000,000 (the message names both dimensions; the RGBA allocation is not attempted).
- `biPlanes` other than 1.
- `biBitCount` outside 1, 4, 8, 24, 32.
- `biCompression` other than 0, or 1 at a depth other than 8 — including `BI_BITFIELDS` (3), `BI_JPEG` (4) and `BI_PNG` (5), whose embedded or bit-field forms this reader does not decode.

#### Palette (1, 4 and 8 bits)

The palette is `biClrUsed` entries of 4 bytes each — B, G, R, then a reserved byte — immediately after the DIB header. `biClrUsed` of 0 means the full `2^biBitCount` entries (2, 16 or 256); a file that declares fewer is read from its declared count, and an index at or above the count present is refused. Bytes between the header and `bfOffBits` that are not whole entries are simply not a palette; the check is that enough entries are present for the indices the pixels use. 24-bit and 32-bit bitmaps have no palette.

#### Pixel array

The pixel array starts at `bfOffBits`, which must lie within the file. Each row is `stride` bytes, where

```
stride = floor((biBitCount × width + 31) / 32) × 4
```

so every row is padded up to a multiple of 4 bytes. The padding bytes are not pixels and are never read as such; they are skipped between rows. The whole array occupies `stride × abs(biHeight)` bytes, and that span must lie within the file or the file is refused, naming the bytes that remain, **before** the RGBA buffer is allocated.

Pixels within a row are packed left to right, most significant bits first:

| `biBitCount` | Bytes per pixel | Packing |
|---|---|---|
| 1 | 1/8 | 8 pixels per byte, the **high** bit the leftmost pixel; value 0 or 1 selects palette entry 0 or 1 |
| 4 | 1/2 | 2 pixels per byte, the **high** nibble the leftmost pixel; value 0–15 selects a palette entry |
| 8 | 1 | 1 byte per pixel, a palette index 0–255 |
| 24 | 3 | **B, G, R** in that order |
| 32 | 4 | **B, G, R**, then a fourth byte that `BI_RGB` does not define as alpha |

**Reawakened rule (row order).** A positive `biHeight` means the first stored row is the **bottom** row of the picture and the last stored row is the **top** row; the reader reverses the rows when it writes the top-row-first RGBA. A negative `biHeight` means the rows are already stored top-first and are copied in file order. The magnitude of `biHeight` is the height in both cases.

**Reawakened rule (32-bit alpha).** For 32-bit `BI_RGB` every pixel's alpha is **255**. The header defines no alpha channel, and the fourth byte's meaning differs between Windows producers, so the reader neither reads it as alpha nor drops the variant; it returns the file's own colours with opaque alpha, and any transparency stays the per-image colour key of the [shared decode contract](#the-shared-decode-contract).

#### RLE8 (8-bit, `biCompression` 1)

`BI_RLE8` stores the 8-bit pixel array as a stream of byte pairs, still **bottom-up** for a positive `biHeight`:

| Pair | Meaning |
|---|---|
| `count`, `value` with `count` > 0 | Repeat `value` `count` times |
| `0`, `0` | **End of line**: move to the start of the next row |
| `0`, `1` | **End of bitmap**: the stream ends here |
| `0`, `2`, `dx`, `dy` | **Delta**: move right `dx` and down `dy` pixels |
| `0`, `n` with `n` ≥ 3 | **Absolute**: the next `n` bytes are literal palette indices; if `n` is odd, one padding byte follows so the run ends on a 16-bit boundary |

Pixels the stream never reaches keep the palette's index 0 value; that is how a blank area is stored. **Reawakened rule (RLE refusals).** A run or an absolute block that would cross the row's right edge, a delta that would leave the image, an odd-length absolute run whose padding byte is missing, or a stream that ends without an `0 1` end-of-bitmap is a located error (at the byte the escape began). The reader decodes an RLE8 stream into the same top-row-first RGBA as an uncompressed bitmap, so a stream and its uncompressed equivalent give identical pixels.

#### Trailing bytes

Bytes after the last pixel row are ignored: an image is a whole picture with no residue model, so there is nowhere to report them.

## GIF

A GIF file is a palette image, a stack of pages, or both, and it is the only game picture that can be an animation. The layout below is the public CompuServe GIF layout (87a published 1987, 89a in 1989), written here in the byte order of this spec. A GIF87a file has no control extension and is therefore always a still picture; a GIF89a file may carry one per page, which is where a transparency index, a frame delay and a disposal method come from.

### GIF header

| Offset | Field | Type | Meaning |
|---|---|---|---|
| 0 | signature | 6 bytes | `GIF87a` (`47 49 46 38 37 61`) or `GIF89a` (`47 49 46 38 39 61`) |

The registry claims a file whose first four bytes are `GIF8`, so a third version (say `GIF88a`) reaches this reader and is refused at offset 0 with a located error rather than decoded as one of the two.

### Logical screen descriptor (7 bytes at offset 6)

| Offset | Field | Type | Meaning |
|---|---|---|---|
| 6 | `width` | `short` | The **logical screen** width in pixels; must be positive |
| 8 | `height` | `short` | The logical screen height in pixels; must be positive |
| 10 | `packed` | `byte` | bit 7 global colour table flag, bits 6–4 colour resolution, bit 3 sort flag, bits 2–0 size of the global colour table |
| 11 | `background` | `byte` | The background colour index |
| 12 | `aspect` | `byte` | Pixel aspect ratio; 0 means none |

The packed byte's **table size** is the number `N` in bits 2–0, and the table holds `2^(N+1)` entries, so 0 means two entries and 7 means 256. The colour resolution (bits 6–4) and the sort flag (bit 3) are read past but mean nothing to a reader, and the pixel aspect ratio is ignored.

### Colour tables

A colour table is `2^(N+1)` entries of three bytes each, **R, G, B**. The **global** colour table, when bit 7 of the packed byte is set, follows the descriptor at offset 13. A page may carry its own **local** colour table, which replaces the global one for that page. A table entry is the file's own colour; there is no key in it.

### The block walk

After the global colour table (or after the descriptor, when bit 7 is clear) the file is a sequence of blocks, read until the trailer:

| First byte | Block |
|---|---|
| `2C` | Image descriptor: one page (below) |
| `21` | Extension introducer: one byte of label, then a sub-block chain (below) |
| `3B` | Trailer: the file ends here |

An image descriptor and an extension are the only carriers; any other first byte is a located error. Bytes after the trailer are ignored: an image is a whole picture with no residue model, so there is nowhere to report them.

### Image descriptor (10 bytes, starting at the `2C`)

| Offset (from `2C`) | Field | Type | Meaning |
|---|---|---|---|
| 1 | `left` | `short` | The page's left edge on the logical screen |
| 3 | `top` | `short` | The page's top edge on the logical screen |
| 5 | `width` | `short` | The page width in pixels; must be positive |
| 7 | `height` | `short` | The page height in pixels; must be positive |
| 9 | `packed` | `byte` | bit 7 local colour table flag, bit 6 interlace flag, bit 5 sort flag, bits 4–3 reserved, bits 2–0 local table size |

**Reawakened rule (page geometry).** Every page must lie **within the logical screen** — `left + width` at most the screen width and `top + height` at most the screen height, the format's own requirement — and neither dimension may be 0. A page that leaves the screen or is zero-sized is a located error at its descriptor. A page whose rectangle is smaller than the screen is drawn at its offset onto the screen space, and the area it does not cover is part of the frame (see [Composition](#composition)).

When the local-table flag is set, the page's colour table follows the descriptor; otherwise the page uses the global table. A page with **neither** table is a located error at its descriptor.

### The sub-block chain

The image data and every extension carry their bytes as a chain of **sub-blocks**: one length byte `n`, then `n` bytes, repeated, and the chain ends with a length byte of 0. A sub-block whose declared length runs past the end of the file, or a chain that never reaches its terminator inside the block, is a located error at the length byte — the same "check the count against the bytes that remain" rule the other readers keep ([README.md](README.md#counts-are-usually-upper-bounds)).

### The LZW image data stream

A page's pixel data is one byte of **LZW minimum code size** `m`, then the sub-block chain holding the compressed stream.

| Code | Meaning |
|---|---|
| `2^m` | The **clear code** |
| `2^m + 1` | The **end-of-information** code |
| `2^m + 2` | The first free code |

Codes are read **least significant bit first**, packed with no padding to a byte boundary. The code width starts at `m + 1` bits, wide enough for the clear and end codes, and grows by one bit each time the next code would no longer fit, up to **12** bits. The table begins with `2^m + 2` entries — the palette indices, then the clear and end codes — and each decoded string adds one. What the stream yields is palette indices, `width × height` of them for the page.

**Reawakened rule (LZW boundary).** The minimum code size must be **2 to 8**, the range every real file uses; 0, 1 and 9 are refused at that byte. A code at or past the next free code is a located error naming the code and the table size, except the format's own **"one behind"** case: a code equal to the next free code means the previous string plus its own first byte. When the table reaches **4096** entries no further entry is added, and the stream may carry many more 12-bit codes before its clear code — the format's **deferred clear**, which the reader honours rather than refusing. A stream that ends before its end-of-information code, that yields a number of pixels other than `width × height`, or that names a palette index outside the page's colour table, is a located error at the image data naming what disagreed.

### Interlace

Bit 6 of a page's packed byte means its rows are stored **interlaced**, in four passes:

| Pass | The rows it holds |
|---|---|
| 1 | 0, 8, 16, … (every 8th row from 0) |
| 2 | 4, 12, 20, … |
| 3 | 2, 6, 10, … |
| 4 | 1, 3, 5, … |

Each pass continues while its next row is inside the page, and each stored row lands at that true `y` in the decoded picture, so an interlaced page and the same art stored plain decode to identical pixels.

### The graphic control extension

`21 F9` introduces the one extension that changes a page:

| Field | Type | Meaning |
|---|---|---|
| block size | `byte` | Always 4; any other value is a located error |
| `packed` | `byte` | bits 4–2 disposal method, bit 1 user input flag, bit 0 transparent colour flag |
| `delay` | `short` | The frame delay in **hundredths of a second** |
| `transparent` | `byte` | The palette index that is transparent |
| terminator | `byte` | 0 |

A control extension applies to the **next** image descriptor. When a page has none, its delay is 0, it has no transparent index, and its disposal method is 0 — the same thing to this reader as 1.

**Reawakened rule (delays are the file's own).** A page's delay is its control extension's hundredths divided by 100, in seconds, and 0 when it has no control extension. The reader does not substitute the 10-hundredths delay some viewers use for a stored 0, because the animation model owns that decision: R-10 takes one delay from the first page ([animation.md](animation.md#animated-gif)).

### Other extensions and ignored fields

`21 FE` (comment), `21 01` (plain text) and `21 FF` (application, such as `NETSCAPE2.0`) are skipped with their sub-block chains, and so is any extension label this reader does not know. The `NETSCAPE2.0` loop count and user-input flag, the plain-text grid and its colours, and the sort, colour-resolution and aspect-ratio fields are all read past and ignored: a game animation's frames are the pages, so a loop count and a rendering hint have no consumer here.

### Composition

Every decoded page becomes a frame the size of the **logical screen**, in its state after that page has been drawn:

- The page's pixels are drawn at its `left`/`top` offset in the file's palette colours. A pixel whose palette index is the page's transparent index keeps its palette colour with **alpha 0**; every other pixel is opaque (alpha 255).
- The **disposal method** decides what the canvas holds for the next page. `0` and `1` leave the page in place; `2` restores the page's rectangle to the background — here, **transparent** — and `3` restores the canvas as it was before the page was drawn.
- Screen area no page has covered, and a rectangle a disposal-2 page cleared, are **transparent with RGB 0**, not the screen descriptor's background colour: an animation's frames are drawn over the game rather than onto a background, and the straight-RGBA contract has no place for one.

### An animated GIF adopted as an animation

**Reawakened rule (R-10).** When an animation name ends in `.gif` the frames are the GIF's pages, the size comes from the first page, and the reader yields **every** page with its own delay so the animation path can take the one it needs ([animation.md](animation.md#animated-gif)). The colour the game keys out is decided in this order:

1. the **first page's transparent index**'s palette colour, when that page's control extension declares one;
2. otherwise the screen descriptor's **background index**'s colour, when that index is inside the global colour table;
3. otherwise **magenta** `(255, 0, 255)`.

(R-10's own words put the background colour as the fallback and magenta after it; the first page's transparent index comes first because that is the index the art's own transparency actually uses.)

### Refusals

**Reawakened rule (GIF reader boundary).** The GIF reader decodes the whole graphic repertoire of both versions — global and local colour tables, the four-pass interlace, the graphic control extension (transparency, delay, disposal 0 to 3), the deferred clear code, and every extension carrier skipped — rather than approximating anything. Each of these is a located error, never a decoded guess:

- a version other than `GIF87a` or `GIF89a` (at offset 0);
- a zero-size logical screen, or a screen above 100,000,000 pixels (at the screen descriptor, before any allocation);
- a `pages × screen` product above 100,000,000 pixels (at the page that passes it — the frames are all held at once, so the product is the allocation);
- a zero-size page, or a page whose rectangle leaves the logical screen (at the page's descriptor);
- a page with neither a local nor a global colour table (at the descriptor);
- a sub-block whose length runs past the end of the file, or a chain with no terminator (at the length byte);
- an LZW minimum code size other than 2 to 8 (at that byte);
- a code at or past the next free code, other than the "one behind" case (at the byte the code's first bit came from);
- image data that ends before the end-of-information code, a pixel count other than `width × height`, or a palette index outside the page's table (at the image data);
- a file holding no page at all — header, descriptor, trailer (at the trailer).

A file whose block walk ends after its last page's data with **no `3B` trailer** is **not** refused: every page already proved its own completeness (its end-of-information code and its exact pixel count), so the picture is returned with a warning instead.

## Evidence

The archive's 343 `.bmp` files were counted read-only on 2026-10-15: 340 are 24-bit `BI_RGB` and 3 are 8-bit `BI_RGB`, every one with a 40-byte DIB header, one plane, compression 0 and a positive height; none is 4-bit, 32-bit, top-down or RLE, and none uses another header size. Inside the six Toolkit 2-era games the reachable bitmaps include Caoquest's `Bitmap/mwin.bmp` (600×100, the menu window), `Bitmap/slash.bmp` (159×127, whose stride is 480 = 477 + 3 padding bytes) and `Bitmap/Mbubble.bmp` (647×124), School2Demo's `Bitmap/New Bitmap Image.bmp` (114×30), and ChimeranEmpire's `Bitmap/Help Button.bmp` (720×354, **1-bit**, a 62-byte palette offset). The supported set above is that evidence plus the two nearest variants (4-bit and 32-bit `BI_RGB`, and RLE8) the others do not settle.

The archive's `.gif` files were counted read-only on the same day: 1878 carry the name and **1632 are real GIF bytes** (the other 246 are saved Wayback error pages). Those 1632 are **292 GIF87a and 1340 GIF89a**, holding **4186 pages** — 1447 single-page files and 185 multi-page, 284 interlaced pages, 708 pages with a local colour table, and 296 files with **no** global table (every one of which carries a local table on every page). LZW minimum code sizes are 2 to 8 with nothing outside; the code width reaches 12 bits in 1078 pages, 11 in 666 and 10 in 898. Every page's stream ends with its end-of-information code and yields **exactly** `w × h` pixels. Disposal use: 1027 pages none, 1116 leave, 1222 restore to background, 44 restore to previous. 609 pages carry a transparent index, 721 a zero delay, and 789 have no control extension at all. 78 files keep a background colour index **past** the end of the global table (e.g. 255 in a 32-entry table), 190 carry a `NETSCAPE2.0` application extension, none a plain-text extension, one a non-zero pixel aspect ratio, and 1631 of 1632 end with the `3B` trailer. Every page's rectangle lies inside its logical screen and no page is zero-sized. Inside the six Toolkit 2-era games the reachable GIFs are LittleMan's **29**, all in `Bitmap\`, all single-page (GIF87a and GIF89a, 3×1 to 608×358, mostly 20×20 sprites); **no animated GIF exists anywhere in a game tree** — all 185 multi-page files are site banners, forum avatars and logos (the largest 77 pages of 80×60). The supported set above is that census in full.
