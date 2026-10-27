# Changelog

## Unreleased

- Surface drawing reuses decoded pixels outside saved state, updates plain JSON snapshots after direct edits, and batches internal script drawing only when no host hook can observe an intermediate state. Opaque, unscaled copies use clipped scanlines; translucent pixels retain their existing blend behavior.
- State hashes remain the same FNV-1a hashes. A cached accumulator can skip FNV work through the surfaces when the exact canonical prefix and surface data are unchanged. It still checks canonical text, and a changed prefix requires hashing the surfaces again.
- The 50 ms budget for 60 direct 640×480 drawing operations plus the full state hash is **not reliably met**. Neither the direct-operation budget nor unchanged-surface scaling is resolved by these changes.

References: [drawing and canvases](docs/spec/engine/rpgcode-functions.md#e-56), [screen saves](docs/spec/engine/rpgcode-functions.md#e-58), [pixel and determinism decisions](docs/adr/0002-core-pixels-and-deterministic-maths.md), and [guardrails](docs/guardrails.md).
