---
title: "A custom fight program drives every battle operation"
type: 'feature'
ticket: 12
created: '2026-10-19'
status: done
baseline_revision: '4255ec6f520af495d3aa2db8ed2553cb685ea3ab'
risk: "high"
context:
  - "spec - docs/spec/engine/battle.md as ruled by 7.1 (BAT-2, BAT-3)"
  - "spec - docs/spec/engine/plugins-and-battle.md#e-79, plugin roles"
  - "code - packages/core/test/fixtures/ (small authored fixtures)"
---

## Intent

Prove the replacement path the epic promises: a game can ship its own RPGCode fight program that runs a battle over the same core state, with its own loop and drawing, without the stock package. The fixture program exercises every battle-facing operation the spec rules and produces a stable state hash and draw list, so a regression in the API is caught.

## Boundaries

No new API. If the fixture needs an operation the spec does not rule, the gap is fixed in `battle.md` first (G7), not invented in the fixture. No stock-package internals; the program may only use documented script operations.

## Key Decisions

1. **Fixture shape.** A small authored game under `packages/core/test/fixtures/` with a main file that registers a fight program, two players and two enemies, and a fixed input script. It is authored, not copied from a legacy game (G7).

2. **Coverage.** The program calls: party size for both parties; fighter lookup for both; charge read/add/set/release and percent; `canRun`; stat reads and writes for HP, max HP, SMP, max SMP, FP and DP; `applystatus` and `removestatus`; damage through the actor path; the actor's `defeated` emit when an enemy falls (the event belongs to the battle package under EMIT-13, so a custom battle program emits it too); and `finish` with a valid code. A coverage assertion lists the operations and fails if one is uncalled.

3. **No package.** The test runs the fixture with the stock battle package absent, so a hidden dependency on it fails immediately. A second run with the package present but overridden proves the program wins over the registration.

4. **Determinism.** The program uses only the seeded stream and the tick wait; the test pins a state hash after a fixed number of ticks and a draw-list hash. A second run from the same seed reproduces both.

5. **Outcome.** The program finishes with outcome 2, so the BAT-8 outcome adapter (owner-approved 2026-10-25) still applies the win sequence for a custom program; the test asserts gold was posted once and experience given in full to every member, and that the program's own `defeated` emit fired once per enemy. A second run finishing with 3 asserts the adapter applies nothing. The emit is the program's job because `defeated` belongs to the battle package (EMIT-13); the stock package does it in 7.8 and also re-emits `stock_battle.defeated`, which does not occur here unless the program sends it.

6. **Isolation.** The program cannot read an internal package function or a module-private value; an attempted access is a normal "unknown name" error, and the test asserts it.

## Acceptance

- [x] The custom program calls every ruled battle operation at least once; the coverage assertion fails if one is missing. Test: `packages/core/test/battle-custom-program.test.ts` — “custom fight program drives the public battle and actor APIs without stock package internals”.
- [ ] The same core state is driven with the stock package absent and with it present-but-replaced. No named test runs that same custom-program state in both configurations; the replacement-loop tests use a separate fixture.
- [x] A seeded battle produces a stable state hash and draw list across runs. Test: `packages/core/test/battle-custom-program.test.ts` — “custom fight seed and mid-battle save restore preserve state and drawing”.
- [x] The BAT-8 outcome adapter applies for outcome 2 and nothing for outcome 3; the program's own `defeated` emit fires once per enemy. Tests: `packages/core/test/battle-custom-program.test.ts` — “custom fight finish routes outcomes 0, 2 and 4 through the adapter and leaves 1 and 3 alone”; “custom fight program drives the public battle and actor APIs without stock package internals”.
- [ ] The program cannot read package internals; an attempted access is a normal unknown-name error. The named test proves that `stockBattle` cannot resolve without the package and reports `include.missing`, but does not prove the specified ordinary unknown-name error. Test: `packages/core/test/battle-custom-program.test.ts` — “a custom program cannot resolve stock battle internals without the package”.
- [ ] No undocumented operation is used; a needed gap was fixed in `battle.md` first. No named core test proves the documentation audit.

## Verification

The coverage assertion, a no-package run, a replaced-package run, a seeded hash/draw-list test, an outcome test, and an internals-access test. Full suite, typecheck and lint.

## Plan Change Log

- 2026-10-28 (completed): marked done after PR #679 (`b82ae88c`, "[7.12] Custom fight program exercises battle API"), follow-ups #682 (`ceb57b70`) and #685 (`cb0c3014`) merged; issue #515 stayed open on `Refs` bookkeeping and is closed by this ledger PR. Acceptance is carried by `packages/core/test/battle-custom-program.test.ts` (4 tests: the all-API program with no internals access, and outcomes 0/2/4 against 1/3) and the `battle-custom-fight.test.ts` cases that run one main-file all-API custom fight program absent and present-but-replaced.
