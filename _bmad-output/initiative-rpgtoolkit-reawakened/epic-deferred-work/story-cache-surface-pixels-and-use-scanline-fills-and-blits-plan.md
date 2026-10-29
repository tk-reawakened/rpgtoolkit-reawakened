---
title: "Cache surface pixels and use scanline fills and blits"
ticket: 7
status: done
---

# Cache surface pixels and use scanline fills and blits

## Delivery

- Delivered by PR #714 (`1797f7d2`, `Fixes #711`), merged 2026-10-27; the ticket issue #711 closed at merge. The per-ticket notes in `tickets.toml` record the delivered shape and the two items that do not apply on this base (no `applyCanvasText`, no `renderNowOn` state).
- Code: `packages/core/src/raster/surfaces.ts` keeps decoded buffers outside `GameState` and re-encodes only the edited span (`editedSnapshot`) and copies eligible opaque 1:1 blits by scanline (`copyOpaqueRows`).
- Evidence: `packages/core/test/surfaces.test.ts`, `packages/core/test/surface-batch.test.ts` ("bounded eager edits keep b64 equal to a full re-encode and to a plain-buffer model (seeded)", "randomized bounds always cover every pixel the draw routine writes (seeded)"), `packages/core/test/surface-guard.test.ts`, `packages/core/test/graphics-builtins.test.ts` and `packages/core/test/engine.test.ts`.
