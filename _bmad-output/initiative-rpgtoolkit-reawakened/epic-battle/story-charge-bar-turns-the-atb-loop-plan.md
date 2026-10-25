---
title: "Charge-bar turns: the ATB loop"
type: 'feature'
ticket: 4
created: '2026-10-19'
status: draft
baseline_revision: '4255ec6f520af495d3aa2db8ed2553cb685ea3ab'
risk: "high"
context:
  - "spec - docs/spec/engine/battle.md as ruled by 7.1 (BAT-4)"
  - "spec - docs/spec/engine/plugins-and-battle.md#e-71 to E-73"
  - "facts - docs/provenance/facts-round-11.md Q1 to Q4, Q6, Q9"
  - "code - packages/core/src/ports/wait.ts, packages/core/src/script/waits.ts"
  - "code - packages/core/src/spine/rng.ts (the seeded shared RNG)"
---

## Intent

Implement the stock package's ATB loop in RPGCode on **one battle thread**: seed each fighter's initial charge, add the effective rate each pass, stop a fighter at its threshold, run its whole turn (menu, choices, animations, messages) to completion, and only then continue. A pass takes at least one engine tick (`threadSleep(getThreadId(), 1/60)`, whose ruled conversion is `max(1, floor(seconds * 60 + 0.5))`), so the loop is deterministic, saveable and replayable. The 60-passes-a-second rate is a Reawakened choice; 3.1 had no clock (BAT-4).

Turn order is deterministic: within a pass the loop visits enemies in party order, then players in party order. A fighter already at or above its threshold when reached takes its turn on the spot; a fighter that crosses its threshold during the pass acts in the next pass. Several fighters can act in one pass, one after another.

## Boundaries

No damage, status effects or AI decisions (7.5 to 7.7). No UI (7.11) and no reward resolution (7.8). This entry owns the clock and the charge only. It does not add a core tick callback or use wall-clock time. It does not use one thread per fighter (the 19.2 spike's per-fighter condition solves simultaneous turns, which 3.1 never has).

## Key Decisions

1. **One thread, one pass per tick.** The single battle thread runs the pass: end-of-battle checks (loss, then win, then a successful escape), redraw hook, revived-fighter check, the advance, input. Because a turn's waits park this one thread, nobody charges while any turn is in progress, exactly as in 3.1. The idle pass costs about 40 steps per fighter [INFERENCE from the spike], so nine fighters stay well under `STEP_BUDGET`; a preempted pass resumes next tick and is late, not wrong.

2. **Rate.** `3 + 2 * speedStatuses - 2 * slowStatuses`, with **no floor and no ceiling** (R11-Q6). A rate of 0 or less means the fighter never becomes charged. The stored charge is not clamped; `chargePercent` clamps to 0 to 100.

3. **Disabled fighters.** A disabled fighter's charge does not grow, and a charge already at or above the threshold is set to one below it, so it never becomes charged and its statuses never tick (BAT-6).

4. **Threshold and action.** Party 1 acts at 75, party 0 at 123. `releaseCharge` sets the stored charge to 0 after the turn; charge above the threshold is not carried over. A fallen fighter does not charge and keeps its charge; if revived it continues from there (R11-Q9).

5. **Initial charge and determinism.** Initial charge is one seeded draw per fighter from 0 to threshold minus 1, in party order, enemies first, at battle start; fallen players get one too (R11-Q1). The shared seeded RNG is the only randomness; the loop stores no RNG state itself.

6. **Still sleep when nobody is ready.** A pass always costs at least one tick; it never spins on a busy check, because a spin would consume no game time and make the loop host-speed dependent.

## Acceptance

1. Seeded runs reproduce the initial charges and the full charge timeline for a fixed party.
2. Speed, slow, disable and multiple effects change the rate exactly as ruled (including a rate at or below zero); a disabled fighter's charge does not move and resumes only when the last disable is removed.
3. Players act at 75 and enemies at 123; a released fighter starts from 0; turn order within a pass is enemies by index, then players by index.
4. No fighter's charge changes while another fighter's turn is in progress.
5. A save/restore and a replay produce the same turn order and the same state hash.
6. The loop consumes whole engine ticks only: `threadSleep(..., 1/60)` (or its tick conversion), not a wall-clock sleep, and no `Date`, `performance.now` or `Math.random` appears in `core` or in the package.
7. A fake host that runs a multi-tick catch-up burst still produces one pass per simulated tick, so the timeline is identical to a host that runs the same ticks one at a time.
8. With no fighter ready, the loop still consumes engine ticks; it never spins.

## Verification

A seeded timeline unit test (charges per pass), a status-rate test, a turn-order test, a "nobody charges during a turn" test, a save/restore and replay test, and a fake-host catch-up test that asserts one pass per simulated tick. Full suite, typecheck and lint.

## Plan Change Log

- 2026-10-25: reconciled with `battle.md` BAT-4 and facts round 11: one battle thread instead of a single loop sleeping per fighter; nobody charges during a turn; no floor on the rate; initial-charge order and disable rule added.
