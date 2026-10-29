---
title: 'Rule E-74 equal-probability wording against random()'
type: 'chore'
ticket: 26
created: '2026-10-29'
status: in-progress
baseline_revision: '82d30c5e'
risk: 'medium'
review: 'quick'
context:
  - 'docs/spec/engine/plugins-and-battle.md'
  - 'docs/spec/engine/rpgcode-functions.md'
  - 'docs/spec/engine/battle.md'
---

## Intent

**Problem:** E-74 says each luck percentage and each critical-draw value is "each equally likely" (`docs/spec/engine/plugins-and-battle.md:207,208`), while the script built-in `random(max)` maps a 32-bit draw with `1 + draw % max`. Whether E-74 requires exact equal likelihood or should describe that mapping is an owner decision, and it changes no behavior by itself (ticket 26, issue #746).

**Approach:** Derive the exact bucket counts from the full draw domain, compare them with the already-accepted BAT-8 `random(5)` rule, and record one recommended wording plus the rejected alternative here for the owner.

## Proposal and owner decision

**Question:** Does E-74's "each equally likely" require exactly equal probability for every `random(20)` result, or should the spec describe the modulo mapping the engine ships?

**Recommended wording** (replacing "each equally likely" at E-74 steps 2 and 3): "each value being one `random` result over the seeded 32-bit draw, `1 + draw % n` ([rpgcode-functions.md](rpgcode-functions.md) `random(max)`); the buckets differ by at most one draw in 2^32 (for `random(20)`, values 1–16 have 214,748,365 draws and 17–20 have 214,748,364). The outcomes are treated as equally likely for design purposes; exact uniformity is not required." The existing "a limit of *n* gives a 1-in-(*n* + 1) chance from that side" sentence stays.

**Decision (Jensen, 2026-10-29):** Keep the existing random-number behavior and correct the wording; the small bias is normal.

## Evidence

- `packages/core/src/script/builtins/pure.ts:105` returns `1 + view.rng.nextUint32() % range`; the draw domain is 0…2^32−1 (`packages/core/src/ports/rng.ts:5-11`, `packages/core/src/rng/xoshiro.ts:62`); the mapping is already a documented departure (`docs/spec/engine/rpgcode-functions.md:17`).
- The stock damage draws use it: `stock/stock_battle/startup.prg:514` `random(20) - 11` for the −10…+9 luck percentage, `:516`/`:520` `random(n+1) == 1` for the critical draw.
- Exact counts from 2^32 = 4,294,967,296 = 20 × 214,748,364 + 16: results 1–16 occur **214,748,365** times (p = 0.05000000004656613) and results 17–20 occur **214,748,364** times (p = 0.04999999981373549). Through `random(20) - 11`, the heavy buckets are p = −10…+5; the largest deviation is one draw (relative 4.66e-9).
- BAT-8 already accepts the same bias: 2^32 = 5 × 858,993,459 + 1, so `random(5) <= 2` succeeds on **1,717,986,919** draws (0.4000000001396984), recorded against BAT-8 in `_bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md:77`.
- Nothing depends on exactness: no test asserts bucket counts; helpers re-derive the same modulo formula to pin draw *sequences* (`packages/core/test/battle-outcomes-stock.test.ts:478-482`) and tests assert draw *counts* (`packages/core/test/battle-actions.test.ts:441-470`). The enemy-count and pool draws already use exactly-uniform rejection sampling (`packages/core/src/script/packs/battle.ts:590-597,727-728`), so E-74's two sentences — not `random` — are the outlier.

## Rejected alternative

**Require exactly equal likelihood and change the runtime to rejection sampling.** It would change affected draw sequences and the documented `random(max)` contract (`docs/spec/engine/rpgcode-functions.md:17`), for an extremely small difference between buckets, and would be inconsistent with BAT-8's accepted `random(5)` bias. Any such change needs its own owner decision and ticket.

## Consequences

- Docs only: E-74 describes the existing mapping and bucket counts; the nominal 1-in-(*n* + 1) statement is qualified for modulo bias and the draw order is unchanged.
- No test changes: distribution-sensitive expectations are sequence-based and stay identical; goldens and state hashes do not move.
- A later owner decision for exact uniformity would need a separate ticket that names the goldens and replay hashes it re-records.

## Verified defect facts

- **No behavioral defect.** `random(20)` is biased by exactly one draw in 2^32 between its heaviest and lightest bucket; nothing in code, tests or goldens depends on uniformity, only on the sequence (`battle-outcomes-stock.test.ts:478-482`, `battle-actions.test.ts:441-470`).
- **The defect is textual:** E-74 (`docs/spec/engine/plugins-and-battle.md:207,208`) claims a uniformity the shipped, documented mapping (`pure.ts:105`, `rpgcode-functions.md:17`) does not give, while BAT-8's neighbouring rule already accepts the bias at its own exact count (`epic-battle.md:77`).
- Counts above were derived arithmetically from the 32-bit domain and cross-checked against the BAT-8 count; no sampling was used.
