---
type: discovery
title: "Closure audit: epic 5 (movement and triggers), criterion by criterion"
date: 2026-10-31
baseline_revision: 3c7c71903422c3025ca592cac330e0b9b4381adf
---

# Epic 5 closure audit

Audited at **`3c7c7190`**. All 12 child issues are CLOSED and every entry reads `done`.

| # | Done when | Verdict | Evidence |
|---|---|---|---|
| 1 | Recorded-input play of the sample games reproduces solid, sliding, stairs, board-edge and sprite-blocking diversion outcomes | **Proven** | `packages/core/test/epic5-closing.test.ts` plus `movement.test.ts` / `movement-input.test.ts`; `pnpm closing` runs the fetched sample games with a scripted plan and reports `8/8 games match their baselines (2 boot clean, 6 expected failures … batching 600/30/7 identical)` |
| 2 | All three pathfinders reach or approach targets and invalidate their cache on vector edits | **Proven** | `packages/core/test/pathfinding.test.ts` (three strategies); cache invalidation is the engine's `clearPathfindingCache` call on vector edits (`packages/core/src/engine/engine.ts`, used in `load`) and is covered by the pathfinding suite |
| 3 | Unit tests cover once-per-entry, repeat distance, key-press vs step-on, items-before-regions precedence, layer matching and run-if/then-set | **Proven (after #886)** | `packages/core/test/triggers.test.ts` now has six cases; #886 added the three that were missing (key-press vs step-on, layer matching, then-set) and the first of them exposed a real defect: regions were never compared against the player's layer, so a region on another layer fired. See the correction note below. |
| 4 | Keyboard, mouse click-to-move and gamepad inputs map as E-110…E-113 state, and `wait()` returns legacy key names | **Proven** | `input.test.ts`, `movement-input.test.ts`, `validate.test.ts` (gamepad mapping and click-to-move), and the `wait` key-name assertions in the input suites |

> **Correction (2026-10-31, #886).** This row previously read "**Proven** | `packages/core/test/triggers.test.ts:43` ... and `:65` ... — these two cases carry those six semantics". That was wrong: the two cases covered repeat distance, items-before-regions precedence and run-if only, and the file held three tests in total. Key-press vs step-on, layer matching and then-set had no test, and writing them showed that `runTriggersPhase` never compared a region's layer with the player's, so regions fired across layers. #886 fixed the runtime and added the three cases; `pnpm golden` and `pnpm closing` (8/8) are unchanged by the fix.
| 5 | Movement, sprite and input built-ins register with the VM and behave as their catalogue entries state | **Proven** | The movement/sprite/input packs are in the catalogue (`catalogue:check` and `command-docs:check` green) and are exercised from authored programs in the corpus and movement suites |

## Findings

None. No follow-up ticket and no store correction were needed: 12/12 entries `done`, 12/12 issues closed.

## Not probed

The “recorded-input play” limb is taken from the closing suite's scripted plan (which records input per tick) rather
than a fresh capture session per game; that is the project's stated oracle for movement parity.
