# Changelog

## Unreleased

- Surface drawing reuses decoded pixels outside saved state, updates plain JSON snapshots after direct edits, and batches internal script drawing only when no host hook can observe an intermediate state. Opaque, unscaled copies use clipped scanlines; translucent pixels retain their existing blend behavior.
- State hashes remain the same FNV-1a hashes. Cached bitmap text avoids reserializing unchanged surface payloads, while prepared per-block transitions can reuse exact hash work even when earlier state changes. Direct edits to bitmap text and metadata still invalidate the relevant cache.
- Transition preparation is incremental and limited to 2,048 blocks per game state. Old blocks no longer in the current state are evicted first; if all retained blocks are still active, additional blocks use the ordinary hash path. Cold or highly varied surfaces still require sequential hashing until blocks are prepared. The 50 ms budget for 60 direct 640×480 drawing operations plus a complete state hash is **not reliably met**.

References: [drawing and canvases](docs/spec/engine/rpgcode-functions.md#e-56), [screen saves](docs/spec/engine/rpgcode-functions.md#e-58), [pixel and determinism decisions](docs/adr/0002-core-pixels-and-deterministic-maths.md), and [guardrails](docs/guardrails.md).
