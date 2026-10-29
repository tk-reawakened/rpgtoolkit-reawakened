---
title: 'A .tbm picture is drawn as a battle background'
type: 'chore'
ticket: 23
created: '2026-10-29'
status: done
baseline_revision: 'bb7519ba'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A screen-enabled stock battle whose `.bkg` names a valid `.tbm` picture shows the flat dark-blue fallback instead: `stock/stock_battle/startup.prg` blanks any `.tbm` name before drawing, and the engine's image path only decodes PNG/JPEG/BMP/GIF, so the existing tile-bitmap reader is never reached.

**Approach:** Delete the script's `.tbm` suppression, and decode a `.tbm` in the engine's image path by compositing its cells through the landed tile-bitmap reader and the tile decoders (the same readers boards use), cached as one texture. An authored `.tbm` battle background in the battle UI rig proves the decoded pixels appear behind the UI.

## Boundaries & Constraints

**Always:** `docs/spec/formats/tiles.md#tile-bitmap-tbm` and `docs/spec/formats/battle-data.md#fight-background-bkg` are the contract — a tile bitmap "can be used wherever an image file is accepted". Core stays pure (G2): no DOM/Node/IO, decode from bytes already in the asset cache. Deterministic raster and integer maths only (G3, ADR 0002). Existing PNG/JPEG/BMP/GIF backgrounds and their golden frames keep their behaviour byte for byte (G5).

**Never:** Consult the legacy GPL source (G7). Add a second tile-bitmap reader or a second tileset expander. Change `isBitmapKey`, the board cell path, the battle UI layout, or the `.bkg` reader. Re-record existing golden frames. Mark the ticket done in `tickets.toml`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid indexed `.tbm` background | `.bkg` image `meadow.tbm`, tileset cells present in the asset index | the `.tbm` is requested, cells composite to one texture, decoded pixels fill the screen behind the UI | no diagnostic |
| `.tbm` whose tileset has not arrived | `.tbm` bytes cached, tileset bytes not yet | the tileset is requested; the pending `bitmap` effect stays queued and lands once the tiles arrive | no diagnostic |
| `.tbm` with a broken cell reference | cell names `missing.tst3` that the index cannot resolve | `asset.invalid`/`asset.missing` diagnostic naming the file, engine stops | loud diagnostic, never a silent flat colour |
| Supported picture background | `.bkg` image `meadow.png` | unchanged: one request, same pixels, goldens unchanged | as today |
| No background named | `.bkg` image empty | unchanged flat fallback | as today |

</frozen-after-approval>

## Code Map

- `stock/stock_battle/startup.prg:1155-1171` — the warm-up that blanks a `.tbm` name and draws the picture once into a scratch canvas. Remove only the blanking and its comment; keep the scratch-canvas warm-up and the 4-tick sleep (they keep the first real frame's draw order).
- `stock/stock_battle/startup.prg:2149-2153` (`draw`) — already blits `stockBattleUi.picture` to the target surface and falls back to `box(…, 20, 28, 56)`; no change.
- `packages/core/src/engine/engine.ts:793-806` (`imageTexture`), `807-863` (`tileTexture`), `934-959` (`applySurfaceEffect`), `1045-1064` (`consumeAsset`) — the image path. `.tbm` must dispatch from `imageTexture`; `consumeAsset` must retry queued image effects after any asset lands, because a `.tbm` decode needs its tiles.
- `packages/core/src/formats/tile-bitmap/{reader,model}.ts` — landed reader; reuse `readTileBitmap` and `tileBitmapCell` (x outer, y inner). Do not write a second reader.
- `packages/core/src/formats/tileset/tileset.ts` (`readTileset`, `expandTileToRgba`, `tileDimensions`), `packages/core/src/formats/single-tile/index.ts` (`readSingleTile`, `expandSingleTileToRgba`), `packages/core/src/formats/tile-animation/index.ts` (`readTileAnimation`) — the tile decoders to reuse. `expandTileToRgba` returns **column-major** pixels; blits index tiles 1-based (`raster.ts:168-169`), so a `name.tst8` cell is array tile 7.
- `packages/core/src/formats/resolver/resolver.ts:123` (`resolveTileReference`) — resolves a cell's reference to an asset key and 1-based tile number; it does not read bytes.
- `packages/core/src/raster/raster.ts:185-197` (`blend`) — the R-15 tint rule (non-zero tint replaces pure white with 245 and pure black with 10, then clamps once). Reuse it, do not restate it.
- `packages/core/src/render/compose.ts:621-641` (`emitImage`) — how boards draw `.tbm` cells: 32-pixel cell pitch, the tile at its own size at the cell origin, per-cell tint. Match that placement.
- `packages/core/test/battle-ui-rig.ts` — authors the whole game; `backgroundBytes()` names `meadow.png`. Add a background choice and author a `.tst` + `.tbm` with the landed writers (`writeTileset`, `writeTileBitmap`).
- `packages/core/test/battle-ui-screen.test.ts` — golden frames stay as recorded.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/core/src/formats/tile-bitmap/composite.ts` (new) — pure compositor: drawn cells only (`x < width`, `y < height`), 32-pixel pitch, tile at its own size at the cell origin, clipped to the picture, per-cell tint through the shared R-15 helper; a cell whose reference is not supplied is a located error, never a skip. Export it from `tile-bitmap/index.ts`.
- [ ] `packages/core/src/raster/tint.ts` (new) — the R-15 channel rule as one leaf function; `raster.ts` `blend` calls it, so the rule exists once.
- [ ] `packages/core/src/engine/engine.ts` — `imageTexture` dispatches a `.tbm` key to a new `tileBitmapTexture`: parse, resolve each drawn cell, request a tile that is not cached yet (leaving the texture uncached), decode tilesets/single tiles/first frame of an animated tile, composite, cache in `decodedImages`; `consumeAsset` retries queued image effects after any asset arrives instead of only the matching key.
- [ ] `stock/stock_battle/startup.prg` — stop blanking a `.tbm` picture name; keep the warm-up and the comment accurate.
- [ ] `packages/core/test/battle-ui-rig.ts` — `background: "png" | "tbm" | "none"` option (default `"png"`, so every recorded frame is unchanged); author a 20 × 15 tile `.tbm` of solid tiles with distinct per-row tints over an authored `.tst`.
- [ ] `packages/core/test/battle-ui-background.test.ts` (new) — boot the stock battle with the `.tbm` background and assert the decoded pixels.

**Acceptance Criteria:**
- Given a screen-enabled stock battle whose `.bkg` picture is a valid `.tbm`, when the screen opens, then the `.tbm` is requested, no diagnostic is reported, and the battlefield pixels behind the UI are exactly the authored tile colours with their cell tints — and not the flat fallback colour anywhere.
- Given the same game with a `.png` background, when the screen opens, then the recorded golden frames still match byte for byte.
- Given the `.tbm` test run against the pre-fix tree (script blanking present), then it fails on the flat fallback and the absent request.

## Design Notes

The `.tbm` becomes **one texture** because `bitmap(file, cnv)` fills a surface with a single image; the board path draws cells as separate blits only because it has a draw list. Cell placement follows `emitImage`: `cell.x * 32`, the tile at its own size at that origin, later cells over earlier ones, clipped to the picture.

R-15 is baked per cell, matching what the rasteriser does to the same cell on a board: with a non-zero cell tint, white → 245 and black → 10 before the tint is added, clamped once.

An animated-tile (`.tan`) cell takes frame 0: the texture is decoded once and cached, so a ticking animation inside a static picture is out of scope; frame 0 is the deterministic choice and matches the board's frame at tick 0.

## Verification

**Commands:**
- `pnpm --filter @rpgtoolkit/core test` (the new test file plus the battle UI suite) — expected: green, goldens unchanged.
- Worktree gates: `pnpm fixtures:fetch`, `typecheck`, `lint`, `test:strict`, `golden`, `golden:bun`, `graph`, `licence`, `provenance`, `catalogue:check`, `command-docs:check` — expected: all pass.

**Manual checks:**
- Inspect the composed 640 × 480 frame of the `.tbm` battle: the background region shows the authored bands, no flat `(20, 28, 56)` rectangle.

## Implementation Notes

- The engine change is three pieces: `imageTexture` dispatches a `.tbm` key to `tileBitmapTexture`; that function parses
  the file, resolves and decodes each drawn cell's tile, and composes once into `decodedImages`; and `consumeAsset` now
  retries every queued image effect after any asset lands (`retryPendingImageEffects`), which is what lets a picture
  whose tiles arrive later still draw. Ticks already wait for outstanding requests (`canTick`), so a queued effect can
  never outlive the surface it targets — checked by delaying the tileset reply 40 advances in a probe: the tick stays
  put, the picture composes, and no diagnostic appears.
- `tileCellPixels` takes each tile out of the texture `tileTexture` already builds and caches for that file (a strip
  stepped by `sourceOffset`), so there is one tileset expander and one decode per file, shared with board rendering.
- A `.tbm` over the shared decode contract's 100,000,000-pixel ceiling is refused before the allocation, like the four
  picture decoders.
- Recorded evidence, pre-fix (`bb7519ba`): the `.tbm` is never requested, 74,465 of 74,465 battlefield pixels are the
  flat fallback `(20, 28, 56)`, frame hash `264053b639794204`. Post-fix the same rig shows the authored bands, the
  `.tbm` and its `.tst` both requested, and no diagnostic; the new test takes about 0.9 s (a rig boot is about 0.9 s).

## Plan Change Log

- 2026-10-29 (ledger chore): frontmatter repaired after the build — `type: 'bugfix'` → `type: 'chore'` and `ticket: 'bug-a-tbm-picture-is-not-drawn-as-a-battle-background'` → `ticket: 23` (bare entry id); plan content unchanged. `tickets.py status` reported entry 23 as `review`/`built` with no `problems` or `drift` both before and after the repair.
- 2026-10-29 (completed): marked done after PR #767 (`22cd80a4`) merged; issue #743 closed 2026-10-29T16:24:50Z. The picture-composition rule (`e08687fc`, spec-first in `docs/spec/formats/tiles.md` and `images.md`) and the engine `.tbm` composition (`d23e5bfd`) are recorded there; no golden frame changed.

## Review Triage Log

Review pass 1 (quick lens, `reviewer` subagent, diff `bb7519ba..33a364b1` + the review fixes):

| # | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | A `.tbm` that finishes decoding after `killcanvas(scratch)` turns into a fatal `asset.missing` and freezes the battle (`engine.ts` `retryPendingImageEffects` / `applySurfaceImage`, `startup.prg` warm-up). | false | — | A queued image effect only exists while a request is outstanding, and `canTick()` returns false while `pending.size > 0`, so no tick — and therefore no `threadSleep` expiry, no `killcanvas` — can run before the effect is applied. Probed by withholding the tileset reply for 40 advances: the tick stayed at 1, the picture composed, diagnostics empty; a `null` tileset reply gives exactly one `asset.missing` naming the tileset and no "destination surface is not live". |
| 2 | `tileCellPixels` adds a second tileset expander and re-expands per attempt instead of using `tileTexture`'s cached strip. | low | patch | Real and against the plan's Never list: the tileset branch re-implemented read/expand/double/reindex. Fixed by taking the tile out of `tileTexture(kind.asset)`'s strip at `(tile − 1) × 32` (64 for `.iso`), which removes the duplicate expander and shares one decode with board rendering; an out-of-range index is now a located error, covered by a new engine test. |
