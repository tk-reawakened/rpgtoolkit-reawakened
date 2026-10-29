---
title: "Avoid rescanning unchanged surfaces in state hashing"
ticket: 8
status: done
---

# Avoid rescanning unchanged surfaces in state hashing

## Delivery

- Delivered by PR #714 (`1797f7d2`, `Fixes #712`), merged 2026-10-27; the ticket issue #712 closed at merge. The per-ticket notes in `tickets.toml` record the exact FNV-1a per-block transition cache, the two items that do not apply on this base, and the measurements.
- Cost is measured, not asserted by a timing test: the 50 ms budget for 60 direct 640×480 operations plus a hash is still not reliably met, and cold or highly varied surfaces still need sequential work; that limit stays recorded rather than claimed closed.
- Evidence: `packages/core/test/surface-hash.test.ts` ("game-state hash matches the legacy projection after prefix, suffix and non-finite edits", "surface hashes observe direct bitmap edits and equal-revision clones", "surface hashes retain UTF-8 parity for non-ASCII surface keys", "advance preserves hash parity for large surfaces when pre-surface RNG changes", "surface hashes match legacy FNV for all incoming low-byte lanes").
