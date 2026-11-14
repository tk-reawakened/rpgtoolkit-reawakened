# Auto-tile sample evidence for #1732

This evidence separates a rights-cleared generic blob mapping from the still-unproved legacy Toolkit community order. It gives a reproducible candidate map and test cases, but does **not** approve that candidate for legacy compatibility or unblock #1733.

**Status:** human ruling required. No legacy engine source code was inspected or used. No sample artwork is copied into this repository.

## Decision summary

- Three files from two OpenGameArt listings were acquired for inspection; both source pages identify their associated works as CC0-1.0.
- Guy's 2014 sample documents an eight-bit neighbour mask and shows a packed 7×8 sheet with mask labels. Independent image review confirms 47 distinct canonical masks and nine duplicate packing slots. An earlier transcription misread row 6, column 2 as 85; the source reads 95.
- Ultrahuntr's 2023 CC0 template is a useful counterexample to treating every 47-like sheet as the same order; the image has no per-cell mask labels and a commenter explicitly asks what a group of corners means. It does not establish a variant order.
- The generic CC0 samples do not establish Toolkit compatibility. The pinned fixture manifest includes six games from `tk-reawakened/ludotheque` and the `demo`/`Basic` games from `chrisbmatthews/rpgtoolkit`. The Ludotheque README describes interoperability/testing research while retaining author copyright; the Basic tileset's `base EULA.txt` is an uncompleted template. A follow-up inspected selected pinned game tilesets and board data using the documented fixture route, without reading engine source or committing artwork. It establishes only partial placed-edge evidence; no complete Toolkit-specific mapping is established.

## Acquired sample inventory and rights

| Sample | Provenance and permission | Acquired material and fingerprint | Use and limitations |
|---|---|---|---|
| “Wang ‘Blob’ Tileset,” Guy, OpenGameArt.org, published 2014-06-04 | [Source page](https://opengameart.org/content/wang-%E2%80%98blob%E2%80%99-tileset); page states **CC0** and says attribution is not required (a link to the author's cr31 page is appreciated). | `wang-blob-tilesets_0.png`, 6,296 bytes, SHA-256 `fcdd830aefd53838f531a69b816b8aee79992bc4fdc74dde4f300477015cd1a4`; companion `commune_1.png`, 11,784 bytes, SHA-256 `beb50d61016b5be8a30d1a94b64ef90fa80965ef0ecd29055271369b31d9292e`. Both were fetched directly from the file links on that page. | The first image labels a 7×8 packed diagram with neighbour-mask values, and the page explains the weights. Independent image review confirms all 47 canonical masks, with nine repeated slots. The second is the corresponding authored visual sample. CC0 permits reuse, but these files are not copied into the repository. |
| “Basic 47 Tile Autotile Template,” Ultrahuntr, OpenGameArt.org, published 2023-04-23 | [Source page](https://opengameart.org/content/basic-47-tile-autotile-template); page states **CC0**. | `platformerautotiletemplate_0.png`, 1,098 bytes, SHA-256 `5c144b4e2f24dedda32ac31e581020a917c38c10275463e0f20d8b9ee08ba1e9`, fetched directly from the listed file link. | Image is a 192×64 three-part template, without cell-level indices. A commenter asks what the “second group” of corners means. This is evidence of an unresolved visual convention, not an index map; excluded from ordering inference. |

The external pages and fingerprints make the acquired evidence reproducible without redistributing art. CC0 is a rights finding for these specific works, not a claim that other files in either community or a Toolkit game are licensed.

## Existing legacy fixture sources checked for a lawful route

The repository pins a research starting point in [`tools/fixtures/sources.json`](../../tools/fixtures/sources.json): [Ludotheque](https://github.com/tk-reawakened/ludotheque/tree/0489f5da225438f8fcd62d958711dc7bad7e8207) at commit `0489f5da225438f8fcd62d958711dc7bad7e8207` (six games), and [`chrisbmatthews/rpgtoolkit`](https://github.com/chrisbmatthews/rpgtoolkit/tree/9191b9191c9bda0998c6faae16929b3331ed2ead) at `9191b9191c9bda0998c6faae16929b3331ed2ead` (`demo` and `Basic`). G5 permits those games as fetched test fixtures, and G7 distinguishes observing game data from reading or translating legacy engine source. This supports a fixture-observation route for compatibility research; it does not confer blanket artwork redistribution or shipping rights.

The [Ludotheque README at the pinned revision](https://github.com/tk-reawakened/ludotheque/blob/0489f5da225438f8fcd62d958711dc7bad7e8207/README.md) retains author copyright and expressly describes non-commercial preservation, engine interoperability and automated regression testing. It grants no blanket artwork reuse license. The Basic sample's [`Tiles/base EULA.txt` at the pinned revision](https://github.com/chrisbmatthews/rpgtoolkit/blob/9191b9191c9bda0998c6faae16929b3331ed2ead/build/game/Basic/Tiles/base%20EULA.txt) is an uncompleted template, not a sample-specific grant. Missing redistribution permission does not establish an inspection prohibition. Record exact sample identities, provenance and research observations separately from permissions needed to reproduce or ship any artwork.

The fixture-data follow-up below finds partial placed-case evidence, but no author-declared complete sample order. It does not satisfy the rights-cleared sample or human-approved mapping gate.

## Pinned community-data observations

### Provenance and permission

Functional observations below were made from the fixture directories fetched by the repository's documented `tools/fixtures/fetch.mjs` route, using the exact pins in [`tools/fixtures/sources.json`](../../tools/fixtures/sources.json). The Ludotheque source is commit [`0489f5da225438f8fcd62d958711dc7bad7e8207`](https://github.com/tk-reawakened/ludotheque/tree/0489f5da225438f8fcd62d958711dc7bad7e8207); the Toolkit sample-data source is commit [`9191b9191c9bda0998c6faae16929b3331ed2ead`](https://github.com/chrisbmatthews/rpgtoolkit/tree/9191b9191c9bda0998c6faae16929b3331ed2ead), fetched only below `build/game/`. The pinned Ludotheque README says that game assets remain their original authors' copyrighted property and describes non-commercial historical preservation, interoperability and regression testing. Its per-game notes identify Final Destiny as Christopher B. Matthews' 2002 game recovered from Internet Archive; School's Out 2 as Phred's game recovered from mysticsoftware.net; Caoquest as a community game recovered from mysticsoftware.net; and Chimeran Empire as Hyren's game recovered from mysticsoftware.net. The Toolkit `Basic/Tiles/base EULA.txt` at its pinned revision is a placeholder template, not a license for `default.tst`. These origins and the fixture-fetch route support functional observation; they do **not** grant artwork redistribution or shipping rights. No artwork or whole game is included here.

### Sample and observed placements

| Pinned data | Evidence and full SHA-256 | What it establishes / does not establish |
|---|---|---|
| Final Destiny `Tiles/default.tst` and `Boards/Water and Bridge.brd` | Tileset `c0afe3a346c9b26c888970a9f26dfca4adc7c4901f430e01aa602dcdfdf7a01d`; board `99c222766c1fb497a8d6539ab2774dfd8e73eb5023e50e0fbc3fd83e041b11d9`. | The 143-tile, detail-1 set and 19×11×8 board are parseable under the documented format. On layer 1, `default.tst63` is placed at x=8, y=1–5 and 7–11; `default.tst62` at x=12, y=1–5 and 7–11; `default.tst2` fills x=9–11 at those same ten rows; and `default.tst83` crosses x=8–12 at y=6. Indexed imagery and the board scene independently confirm the west/east straight shoreline edges and one three-tile channel with a crossing. This does not establish a full mask order. |
| School's Out 2 Demo `Tiles/terrain_set.tst` and `Boards/Overworld.brd` | Tileset `5ea10bc6a4b8188a841ff0e2651fabe395a920bee60a9b7bef8ff46787e00dfe`; board `a5ba5a1e4e17d9cc9f0e650c84122ae7190b63a3e9a7b5168dfcd57c0f8d18ea`. | The board has 19 layer-1 references spanning 15 distinct terrain-set indices: `106:1, 108:1, 116:1, 117:1, 118:1, 122:1, 123:1, 125:1, 126:3, 128:2, 131:1, 132:2, 133:1, 198:1, 199:1`. This corrects the earlier count/list discrepancy tracked by [#2408](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2408). The observed subset is not a complete or documented 47-neighbour order. |
| Caoquest `Tiles/Forest_Set.tst` and `Tiles/castle_set_1.tst` | `Forest_Set.tst` `016567c1cb89459267e3b7dd8b43caf86124bab85449706164e70666840d4fff`; `castle_set_1.tst` `4d11e020f25d0b552f0ea1d48c4a125e9d153063c1c304435613ba1cab6741fb`. | Board data contains literal indexed tile placements, but the pinned game includes no documentation declaring an auto-tiling order. |
| Chimeran Empire `Tiles/RPGMaker954.tst` and `Boards/Beach 1.brd` | `RPGMaker954.tst` `e9743f1eda420928e5136f717dd29521c6c128e5a6eefbcadebc5c72ea682aad`; `Beach 1.brd` `433c183764fe070115234560c148dde4caa2fc9aaa53ce8ed98c40c777f44ac9`. | The sheet contains water/shore imagery, but Beach 1 references RPGMaker951 and `Beach East.tan`; the `.tan` format specifies animation frame references, not a neighbour map. No ordering evidence follows from this sheet alone. |
| Toolkit `Basic` and `demo` `Tiles/default.tst` | Both identical at SHA-256 `f5f17032bb6001744989d6d4ca296b9e4b700ac70da860de93d3f47e92e24374`. | These are 140-tile fixture versions; the Basic EULA is a placeholder. Neither set supplies a sample-specific permission or ordering declaration. |

The complete fixture acquisition is reproducible from the repository root:

```sh
samples="$(mktemp -d)"
node tools/fixtures/fetch.mjs "$samples"
```

The following read-only Python command expands the documented minor-2/3 board cell runs, resolves LUT indices to tile filenames, and prints the exact placements/counts above. It reads the fetched game data and the repository's spec-derived reader; it does not open engine source:

```sh
python3 - "$samples/fixtures/legacy" <<'PY'
import re, sys
from collections import Counter
from pathlib import Path
sys.path.insert(0, "docs/spec/tools")
import rpgtk_formats as fmt
root = Path(sys.argv[1])

def board(relative):
    reader = fmt.Reader((root / relative).read_bytes(), relative)
    fmt.parse_brd(reader)
    trace = reader.trace
    value = lambda name: next(v for _, _, f, v in trace if f == name)
    sx, sy, sl = (value(k) for k in ("sizeX", "sizeY", "sizeL"))
    lut = []
    for _, _, field, val in trace:
        m = re.fullmatch(r"LUT\[(\d+)\]", field)
        if m:
            i = int(m[1])
            while len(lut) <= i: lut.append("")
            lut[i] = val
    cells = []
    for i, (_, _, field, val) in enumerate(trace):
        if re.fullmatch(r"cell \d+", field):
            cells.extend([trace[i + 1][3]] * -val if val < 0 else [val])
    assert len(cells) == sx * sy * sl
    return sx, sy, lut, cells

for file, pattern in (
    ("FinalDestiny/Boards/Water and Bridge.brd", r"default\.tst(\d+)"),
    ("School2Demo/Boards/Overworld.brd", r"terrain_set\.tst(\d+)"),
):
    sx, sy, lut, cells = board(file)
    hits = []
    for z, slot in enumerate(cells[:sx * sy]):
        m = re.fullmatch(pattern, lut[slot], re.I) if 0 <= slot < len(lut) else None
        if m: hits.append((int(m[1]), z % sx + 1, z // sx + 1))
    print(file, "layer-1 references:", len(hits),
          "distinct indices:", len({tile for tile, _, _ in hits}))
    print("index counts:", dict(sorted(Counter(tile for tile, _, _ in hits).items())))
    if file.startswith("FinalDestiny/"):
        for tile in (2, 62, 63, 83):
            print(f"default.tst{tile} placements:",
                  [(x, y) for n, x, y in hits if n == tile])
PY
```

The samples provide only the placements stated above. In particular, the Final Destiny board does not place the artwork's island/corner-looking variants, and the other pinned data has no author-declared full lookup table. We do not infer corner gating, island, inner/outer-corner or junction masks from generic blob ordering or from appearance alone.

## Mapping contract and complete generic candidate

Use the mask labels from Guy's page, not tile-slot numbers, for this section. Bits are assigned clockwise from north: N=1, NE=2, E=4, SE=8, S=16, SW=32, W=64, NW=128. A diagonal bit is meaningful only when **both** adjoining cardinal bits are set: NE requires N and E; SE requires E and S; SW requires S and W; NW requires W and N. Canonicalize a disallowed diagonal to zero before lookup.

There are 47 canonical masks: for each of the 16 cardinal-edge subsets, include each possible subset of corners whose two adjoining edges are present. Exhaustive enumeration of that rule gives the following ascending-mask candidate order (47 entries). If a sample uses this candidate order, its one-based slot *n* maps to the *n*th mask below:

```text
0, 1, 4, 5, 7, 16, 17, 20, 21, 23, 28, 29, 31,
64, 65, 68, 69, 71, 80, 81, 84, 85, 87, 92, 93, 95,
112, 113, 116, 117, 119, 124, 125, 127,
193, 197, 199, 209, 213, 215, 221, 223,
241, 245, 247, 253, 255
```

This is a set of mask values, **not** a claim that a Toolkit `.tst` slot has that number or that a legacy set uses ascending-mask slot order. It is derived from the published bit weights and corner-gating rule and can be checked without generating sample cases from the same code as an implementation.

### Independent hand-calculated expected cases

In each 3×3 pattern, `#` means the adjacent cell belongs to the same terrain, `.` means it does not, and `@` is the tile being selected. Values below are direct sums of the published bit weights.

| Case | Neighbour pattern (top to bottom) | Expected mask | Calculation |
|---|---|---:|---|
| Isolated island | `...` / `.@.` / `...` | 0 | no matching neighbours |
| Single exposed edge | `.#.` / `.@.` / `...` | 1 | N |
| Straight narrow passage, east–west | `...` / `#@#` / `...` | 68 | W + E = 64 + 4 |
| Straight narrow passage, north–south | `.#.` / `.@.` / `.#.` | 17 | N + S = 1 + 16 |
| Outside/convex corner, both edges but no diagonal | `.#.` / `.@#` / `...` | 5 | N + E = 1 + 4 |
| Same corner filled in | `.##` / `.@#` / `...` | 7 | N + NE + E = 1 + 2 + 4 |
| T junction | `.#.` / `#@#` / `...` | 69 | N + E + W = 1 + 4 + 64 |
| Four-way junction | `.#.` / `#@#` / `.#.` | 85 | N + E + S + W = 1 + 4 + 16 + 64 |
| One missing inner-corner diagonal | `##.` / `#@#` / `###` | 253 | 1+4+8+16+32+64+128 |
| Illegal corner-only contact | `..#` / `.@.` / `...` | 0 after gating | NE=2 is discarded because N and E are not both set |

The patterns and sums are independent checks of the mask meaning, not independent evidence that any Toolkit sample assigns a given mask to a particular slot. The expected masks include corner-gating, island, edge, inner/outer corners, junctions and narrow passages; they do not replace a complete sample-derived slot map.

## What the indexed image currently says

Guy's page describes a diagram packed as 7 rows × 8 columns, with duplicate masks in the packing. Independent image review confirms this left-to-right, top-to-bottom transcription:

```text
16 20 92 112 28 124 116 64
29 125 119 193 23 223 245 80
31 247 193 0 21 71 213 81
31 241 4 84 85 68 93 113
23 221 124 113 17 28 127 241
5 95 255 253 117 87 215 209
0 7 199 199 197 69 65 1
```

The transcription contains all 47 distinct canonical masks and nine repeated packing slots, consistent with the source page. Mask 241 appears twice, at row 4, column 2 and row 5, column 8; that is a packing duplicate, not a source defect. The earlier report's missing-95 discrepancy was a transcription error: row 6, column 2 visibly reads 95, not 85. This is a complete generic diagram-to-mask transcription, not evidence of a Toolkit tileset's slot convention.

The accompanying `commune_1.png` image illustrates the terrain artwork in the same generic packing. It is not an independent Toolkit-community sample and cannot establish Toolkit compatibility.

## Legacy compatibility gap and recommendation

The current evidence answers: “What is one published, CC0 blob-mask convention, and what would its generic ascending-mask IDs mean?” It does **not** answer: “What order do the relevant Toolkit community auto-tile samples use?” The user-facing T-25 description says sample-set ordering is required for compatibility; the general 47-mask rule is not a substitute.

- **Recommendation:** retain the ascending-mask list as a named generic candidate and the corrected 7×8 diagram as a generic indexed reference. The pinned game-data survey below establishes only partial edge placement, not a full community order. Do not bake either generic candidate into the legacy mapping or mark #1733 unblocked. The missing sample-derived mapping and human approval remain explicit blockers; do not infer a waiver of legacy parity.

### Human approval still required

A reviewer/owner must approve whether the pinned sample provenance and available permissions satisfy the acceptance requirement, and approve a complete independently established Toolkit index-to-neighbour mapping; alternatively, a rights-cleared sample with that evidence must be acquired. The fixture route permits functional observation but is not an artwork license. The generic diagram is complete only as a generic mask transcription; this report records no Toolkit mapping approval. Story 13.7 remains incomplete and 13.8 remains blocked.

## References

- `docs/editor-features.md` §3, T-25 (eight neighbours, gated corners, re-evaluation, sample-derived order).
- `docs/spec/formats/tiles.md` (stable tile indices; deleting/reordering changes references).
- `_bmad-output/initiative-rpgtoolkit-reawakened/epic-editor-p1/epic-editor-p1.md` Notes on auto-tiler evidence and the 13.7 → 13.8 gate (owner-approved publication source).
- `story-auto-tile-sample-evidence-and-ordering-ruling-plan.md` (acceptance and human verification gate).
- Existing UX research, `docs/editor-experience-bank.md` and `docs/editor-research-pilot.md`, provides a warning that legacy feature inventory alone is not creator-intent evidence; it does not contain creator evidence establishing auto-tile index preference or compatibility.
- [Cr31 `Blob Tileset` reference (BorisTheBrave mirror)](http://www.boristhebrave.com/permanent/24/06/cr31/stagecast/wang/blob.html), for the published bit weights and generic 47-mask rule; it is not Toolkit sample-order evidence.
