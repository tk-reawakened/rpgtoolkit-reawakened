---
id: 14
type: bug
title: "Demo board rendering misses display rate after repeated surface work"
parent: none
covers: []
after: []
tracker_id: "#2795"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2795"
refined: true
hitl: false
risk: high
severity: P2
---

# Demo board rendering misses display rate after repeated surface work

## Description

After the demo reaches `boards/start.brd`, live rendering misses the display rate and continues to produce long tasks. Reduce repeated surface-encoding and rendering work without changing the pixels or deterministic game state. Record a repeatable real-board profile before and after the change; timing remains advisory and must not become a CI assertion.

## Reproduction

1. On an Apple M1 Pro with 16 GiB RAM, run the live web player in headed Chromium with the default GPU and the demo package.
2. Pass the demo title screen, confirm the active board is `boards/start.brd`, then record an eight-second profile while walking.
3. Historical baseline on main `3e61f3c2a`, before the #2796 integration, was 25.9 fps, p50 41.6 ms, p99 73.9 ms, and 54 long tasks totaling 3217 ms. The #1890/#2766 integration candidate measured 39.0 fps, p50 27.2 ms, p99 57.0 ms, and 4 long tasks totaling 214 ms; these are historical single-run measurements, not current-main results.
4. Expected: the gameplay profile reaches the display rate without long tasks after load, and its board pixels and deterministic state remain unchanged.

## Cause Hypothesis

The issue report identifies `encodeSurfaceBytes` as 31.4% of sampled self CPU on the actual board, with blend, `drawBlit`, and `rasterizeWithBlendTarget` as the next largest costs. Repeated full-surface work in this rendering path is likely, but profiling must establish the call path and the fix must preserve the composition contract.

## Acceptance Criteria

1. **Gameplay reaches the display rate after load**
   **Given** the demo running on the actual `boards/start.brd` in headed Chromium on the reference machine
   **When** the title screen is passed and an eight-second walking profile is recorded
   **Then** the active board is recorded before sampling, the player sustains the display rate after load, and no post-load long task over 50 ms occurs; frame rate, p50/p99, long tasks, ticks per second, and machine are recorded in the performance table
2. **Repeated surface work is bounded without changing observable output**
   **Given** the steady-state board-rendering regression exercised by the fix
   **When** the deterministic regression tests and relevant pixel/state goldens run
   **Then** tests prove the identified redundant full-surface work is reduced with a named deterministic work-count budget that fails on the pre-fix implementation, while pixel and state outputs remain identical; the required headless golden CI suite remains intact, and the whole demo game stays a fetched fixture rather than a committed asset (G5); no wall-clock assertion is added to CI
3. **The hot-path cost is documented**
   **Given** the production rendering path after the change
   **When** its work is reviewed
   **Then** the change states its cost per tick and how that work grows, and includes before-and-after real-board measurements from `tools/perf/profile-player.mjs`
4. **Or: no change is needed, with proof**
   **Given** the actual-board reproduction
   **When** the current main branch is profiled with the corrected probe
   **Then** repeated corrected profiles on the actual board and reference setup show that the reported post-load display-rate miss and long tasks are absent, and deterministic work-count checks show no regression; record the profile and evidence in Notes. An unrelated profiler or title-screen measurement error is not proof that no change is needed. This supersedes criteria 1–3

## References

- parent — none
- specification — `docs/spec/engine/main-loop-and-startup.md`, E-03, Drawing a frame, and E-52 Board compositing
- specification — `docs/spec/engine/runners.md`, Draw-list replay and the presented frame; Surface reads, presentation and game state
- performance policy — `docs/adr/0036-performance-budgets.md`, Work budgets gate CI; Timing is measured, recorded and advisory
- profiling procedure — `tools/perf/README.md`, Integration measurement and Run
- guardrail — `docs/guardrails.md`, G5 Headless golden tests on every change
- existing integration — https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/2796

## Notes

- Evidence from issue #2795: the earlier 119 fps profile did not establish that the demo had entered gameplay; #2796 corrected the probe and explicitly left the surface/render path unresolved.
- The reproduction and acceptance profile must verify `boards/start.brd` before timing; title-screen measurements do not satisfy this ticket.
- Timing is advisory. CI proof uses deterministic work counts and output goldens, not elapsed time.
- Review check outside the ticket criteria: an independent reviewer checks the real-board profile and confirms the recorded machine and board before release.
