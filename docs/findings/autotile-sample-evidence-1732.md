# Auto-tile sample evidence for #1732

This evidence separates a rights-cleared generic blob mapping from the still-unproved legacy Toolkit community order. It gives a reproducible candidate map and test cases, but does **not** approve that candidate for legacy compatibility or unblock #1733.

**Status:** human ruling required. No legacy engine source code was inspected or used. No sample artwork is copied into this repository.

## Decision summary

- Three files from two OpenGameArt listings were acquired for inspection; both source pages identify their associated works as CC0-1.0.
- Guy's 2014 sample documents an eight-bit neighbour mask and shows a packed 7×8 sheet with mask labels. Independent image review confirms 47 distinct canonical masks and nine duplicate packing slots. An earlier transcription misread row 6, column 2 as 85; the source reads 95.
- Ultrahuntr's 2023 CC0 template is a useful counterexample to treating every 47-like sheet as the same order; the image has no per-cell mask labels and a commenter explicitly asks what a group of corners means. It does not establish a variant order.
- The generic CC0 samples do not establish Toolkit compatibility. The existing fixture manifest pins six games from `tk-reawakened/ludotheque` and the `demo`/`Basic` games from `chrisbmatthews/rpgtoolkit`. The Ludotheque README describes interoperability/testing research while retaining author copyright; the Basic tileset's `base EULA.txt` is an uncompleted template. Research observation under the documented fixture route is distinct from redistributing or admitting artwork. No game artwork from either fixture repository was inspected in this evidence round, so no Toolkit-specific mapping is established.

## Acquired sample inventory and rights

| Sample | Provenance and permission | Acquired material and fingerprint | Use and limitations |
|---|---|---|---|
| “Wang ‘Blob’ Tileset,” Guy, OpenGameArt.org, published 2014-06-04 | [Source page](https://opengameart.org/content/wang-%E2%80%98blob%E2%80%99-tileset); page states **CC0** and says attribution is not required (a link to the author's cr31 page is appreciated). | `wang-blob-tilesets_0.png`, 6,296 bytes, SHA-256 `fcdd830aefd53838f531a69b816b8aee79992bc4fdc74dde4f300477015cd1a4`; companion `commune_1.png`, 11,784 bytes, SHA-256 `beb50d61016b5be8a30d1a94b64ef90fa80965ef0ecd29055271369b31d9292e`. Both were fetched directly from the file links on that page. | The first image labels a 7×8 packed diagram with neighbour-mask values, and the page explains the weights. Independent image review confirms all 47 canonical masks, with nine repeated slots. The second is the corresponding authored visual sample. CC0 permits reuse, but these files are not copied into the repository. |
| “Basic 47 Tile Autotile Template,” Ultrahuntr, OpenGameArt.org, published 2023-04-23 | [Source page](https://opengameart.org/content/basic-47-tile-autotile-template); page states **CC0**. | `platformerautotiletemplate_0.png`, 1,098 bytes, SHA-256 `5c144b4e2f24dedda32ac31e581020a917c38c10275463e0f20d8b9ee08ba1e9`, fetched directly from the listed file link. | Image is a 192×64 three-part template, without cell-level indices. A commenter asks what the “second group” of corners means. This is evidence of an unresolved visual convention, not an index map; excluded from ordering inference. |

The external pages and fingerprints make the acquired evidence reproducible without redistributing art. CC0 is a rights finding for these specific works, not a claim that other files in either community or a Toolkit game are licensed.

## Existing legacy fixture sources checked for a lawful route

The repository pins a research starting point in [`tools/fixtures/sources.json`](../../tools/fixtures/sources.json): [Ludotheque](https://github.com/tk-reawakened/ludotheque/tree/0489f5da225438f8fcd62d958711dc7bad7e8207) at commit `0489f5da225438f8fcd62d958711dc7bad7e8207` (six games), and [`chrisbmatthews/rpgtoolkit`](https://github.com/chrisbmatthews/rpgtoolkit/tree/9191b9191c9bda0998c6faae16929b3331ed2ead) at `9191b9191c9bda0998c6faae16929b3331ed2ead` (`demo` and `Basic`). G5 permits those games as fetched test fixtures, and G7 distinguishes observing game data from reading or translating legacy engine source. This supports a fixture-observation route for compatibility research; it does not confer blanket artwork redistribution or shipping rights.

The [Ludotheque README at the pinned revision](https://github.com/tk-reawakened/ludotheque/blob/0489f5da225438f8fcd62d958711dc7bad7e8207/README.md) retains author copyright and expressly describes non-commercial preservation, engine interoperability and automated regression testing. It grants no blanket artwork reuse license. The Basic sample's [`Tiles/base EULA.txt` at the pinned revision](https://github.com/chrisbmatthews/rpgtoolkit/blob/9191b9191c9bda0998c6faae16929b3331ed2ead/build/game/Basic/Tiles/base%20EULA.txt) is an uncompleted template, not a sample-specific grant. Missing redistribution permission does not establish an inspection prohibition. Record exact sample identities, provenance and research observations separately from permissions needed to reproduce or ship any artwork.

Next identify a concrete Toolkit-community sample and inspect its functional ordering through the documented fixture-research route where applicable, without consulting engine source or committing the artwork. Record origin, hashes, attribution and the basis for that use; obtain any further permissions needed before reproducing or admitting assets. The rights-cleared sample and human-approved mapping acceptance gate remains in force; it is not a reason to invent a prohibition on all fixture observation.

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

**Recommendation:** retain the ascending-mask list as a named generic candidate and the corrected 7×8 diagram as a generic indexed reference. Do not bake either into the legacy mapping or mark #1733 unblocked. Investigate specific Toolkit-community samples through the documented fixture route, recording exact set/version, origin, research-use basis, any redistribution permissions, image/metadata hashes, cell geometry, slot assignments and independently checked scenes. Preserve every disagreement with the generic reference. If eligible evidence cannot be acquired, retain the blocker and request an owner ruling rather than inferring a waiver of legacy parity.

### Human approval still required

A reviewer/owner must approve whether a concrete sample's provenance and rights satisfy the acceptance requirement and approve its independently established Toolkit index mapping, or leave implementation blocked. The generic diagram no longer has an unresolved completeness discrepancy. This report records no Toolkit mapping approval; 13.8 remains blocked on 13.7.

## References

- `docs/editor-features.md` §3, T-25 (eight neighbours, gated corners, re-evaluation, sample-derived order).
- `docs/spec/formats/tiles.md` (stable tile indices; deleting/reordering changes references).
- `_bmad-output/initiative-rpgtoolkit-reawakened/epic-editor-p1/epic-editor-p1.md` Notes on auto-tiler evidence and the 13.7 → 13.8 gate (owner-approved publication source).
- `story-auto-tile-sample-evidence-and-ordering-ruling-plan.md` (acceptance and human verification gate).
- Existing UX research, `docs/editor-experience-bank.md` and `docs/editor-research-pilot.md`, provides a warning that legacy feature inventory alone is not creator-intent evidence; it does not contain creator evidence establishing auto-tile index preference or compatibility.
- [Cr31 `Blob Tileset` reference (BorisTheBrave mirror)](http://www.boristhebrave.com/permanent/24/06/cr31/stagecast/wang/blob.html), for the published bit weights and generic 47-mask rule; it is not Toolkit sample-order evidence.
