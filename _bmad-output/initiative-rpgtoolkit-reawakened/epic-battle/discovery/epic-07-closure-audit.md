---
type: discovery
title: "Closure audit: epic 7 (battle), criterion by criterion"
date: 2026-10-31
baseline_revision: 26740257db3b692b5b210b05b489f60057d35e72
---

# Epic 7 closure audit

Audited at **`26740257`**. 34 of 35 children are CLOSED; the open one is **7.34 / #805**, the owner-gated spike on the
literal battle-load full-state hash. Criterion 6 is the one that spike touches, so it is the only in-flight line.

| # | Done when | Verdict | Evidence |
|---|---|---|---|
| 1 | Seeded battles reproduce the E-72…E-78 formulas (stock package loaded) | **Proven** | `battle-damage.test.ts`, `battle-actions.test.ts`, `battle-status-flags.test.ts`; the stock package is loaded through the catalogue in `battle-cues-engine.test.ts` |
| 2 | Random and scripted starts; win/run/lose outcomes, rewards and level-up per E-77/E-78 and 20.1's equation | **Proven** | `battle-start.test.ts`, `battle-outcomes-stock.test.ts`, `battle-loop.test.ts` |
| 3 | The four AI levels and a custom AI program pick targets and moves per E-76 | **Proven** | `battle-ai.test.ts` (four levels plus the custom program path) |
| 4 | A custom RPGCode fight program drives every ruled E-79 operation with the stock package absent | **Proven** | `battle-custom-fight.test.ts` (including “without the stock_battle package a custom program still runs and its FightEnemy call is a catchable `battle.package-missing`”) |
| 5 | The default battle UI renders an owner-approved deterministic golden | **Proven** | `battle-ui-screen.test.ts` / `battle-ui-refresh.test.ts` with the pinned UI goldens under `golden/`; `pnpm golden` green |
| 6 | A mid-battle save restores the same fighters, charge, background, `canRun` and outcome with an identical state hash; `battle` holds references and charge only | **In flight (owner-gated)** | `battle-save-golden.test.ts` and the full-engine save case in `battle-cues-engine.test.ts` prove restore and continuation; the *literal-load full-state hash equality* is exactly what **7.34 / #805** is open to rule on, so the criterion's hash limb is not settled. Nothing is broken in evidence; the ruling decides the wording/limit |
| 7 | `stock_battle` loads by name and is mapped in `.gam`; a game without a battle package ends the battle immediately with a diagnostic | **Proven** | `battle-cues-engine.test.ts` (`packageCatalogue` + `stock_battle`), `engine.test.ts:403` (`battle.package-missing`), `battle-start.test.ts:442,472` |
| 8 | Battle music and cues through the media object; `boardReturned` restores the board's music; a failed `beforePlay` rejects only the music request; `BattleState` holds no audio; the null-audio runner produces the same cue stream | **Proven** | `battle-cues-engine.test.ts` (board/battle/board music sequence, canceled board start with the script voice still playing, `!JSON.stringify(played.state.battle).match(/audio\|music\|media\|\.mid\|\.wav/i)`), plus the null-runner vs `audio.ended` runner equality case |
| 9 | 7.21–7.32 resolved with merged evidence or owner rules; 7.33 closeout sweep complete; every follow-up child closed before #503 | **Proven except 7.34** | All follow-up children are CLOSED; 7.33's sweep merged; #805 remains the single open child |

## Findings

- **F-01 (owner-gated contract question, already ticketed).** Criterion 6's hash limb depends on **7.34 / #805**
  (literal battle-load full-state hash equality). No new ticket: it is filed and `hitl`.
  - Recommendation: rule that a *literal* battle load rehydrates the boss/background and compares a **battle-section**
    hash (not the whole state), because the audio section legitimately differs by when a cue was applied; keep
    whole-state hash equality for in-engine continuation saves, which `battle-cues-engine.test.ts` already proves.
  - Rejected alternative: require whole-state hash equality on a literal load too. It forces audio cue ids and
    lifecycle queue contents into the comparison, which depend on when the load happened rather than on battle state,
    and would need golden re-records for no behavioural gain.
- Store: 34/34 non-spike entries `done`; no correction.

> **Correction (2026-10-31, second cross-check).** Row 7 previously cited `battle-start.test.ts:442,460,472`. Line 460
> is the title of "random encounter handoff reports a missing stock package before requesting assets"; the two
> `battle.package-missing` assertions are at 442 and 472. The verdict is unchanged.
