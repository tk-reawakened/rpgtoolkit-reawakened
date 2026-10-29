---
title: "Split core-battle tests into a dedicated parallel CI shard"
ticket: 6
status: done
---

# Split core-battle tests into a dedicated parallel CI shard

## Delivery

- Delivered by PR #713 (`9b76bc85`, `Fixes #710`), merged 2026-10-27; the ticket issue #710 closed at merge.
- `tools/no-skips/run.mjs` lists `core-battle` among the eight groups and routes it through the `inBattle` filter (`packages/core/test/battle-*.test.ts` only), and `.github/workflows/ci.yml` carries `core-battle` as a unit-matrix shard, so the shared single-pass coverage merge is preserved.
- Verify (`node tools/no-skips/run.mjs --verify-groups`) is a CI `checks` gate; the 2026-10-27 run for #713 was green, and the shard has run green on every pull request since.
