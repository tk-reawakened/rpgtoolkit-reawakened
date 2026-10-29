---
title: 'Complete battle save, resume, and reset lifecycle evidence'
type: 'feature'
ticket: 31
created: '2026-10-29'
status: done
baseline_revision: '22cd80a4c54dbe2f9c62cdf5e45ae587233101ee'
route: 'oneshot'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: ['docs/guardrails.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `packages/core/test/battle-fresh-load.test.ts` compares frames between an uninterrupted and a resumed run, but compares state hashes only between two restored engines, so nothing proves a `Load`-restored mid-battle game reaches the same game state as the run that never saved. Nothing proves an in-flight battle and its parked continuation are gone after `reset()`.

**Approach:** Make the existing tick-by-tick comparison also assert the engine's per-tick state hash (uninterrupted run versus the real `Load` path), with the save asserting no active audio, because active music deliberately restarts at position zero on load. Add one reset-during-battle case on the stock battle rig that proves `battle` is null and no script continues the fight.

</frozen-after-approval>

## Implementation Notes

Oneshot route: one test file, one spec sentence, no production code. The save fixture is authored in code by the rig (G7), and no golden changes (G5).

Decisions:
- The hash comparison lives inside the existing frame-walk loop of "a mid-battle save loaded into a brand-new engine asks for the animation pictures and draws them"; that keeps the existing resumed-frame comparison and adds the missing hash comparison at the very same fixed points instead of re-booting a third rig (each 640×480 rig boot is ~2 s).
- Noise from a `Save`-tick state difference is why comparison starts at `saved.tick + 1`, matching the frame comparison: the save is captured while the saving thread is parked, the uninterrupted run still holds the live wait.
- The no-active-audio precondition is asserted from the saved JSON (`audio.tracks[].state === "stopped"`, empty `voices`) and explained in the test comment against [audio-media.md#audio-save-load].
- Reset evidence uses the game's own start-up program (`threadSleep(GetThreadId(), 0.4)`, then `reset()`) so the reset comes from a real script while the stock battle loop, its UI dictionary, pinned stance animations and the blocking fight thread are live.
- Cost: the reset test boots one rig and runs ~40 ticks (~0.5 s); the hash assertions add no boot. Measured on the file: 19.3 s before, 21.9 s after (reset test +0.5 s, the 24 full-state hashes in the walk ~+1.3 s). The irreducible part is the stock battle rig's 640×480 boot and per-tick rendering, which no assertion here can avoid.

## Review Triage Log

- BAT-13 claimed the *engine's* per-tick state hash matches across a load. Verdict: medium — the engine hash also
  carries the host request-id counter, outstanding requests, the cue counter and the script canvases, which a load
  necessarily moves. Patched: the rule now names the state the game owns, lists those three host-side exceptions with
  their reasons, and says the composed frame is compared instead of the canvases. Follow-up (owner direction): the
  owner's original sentence is restored verbatim and the scope now sits in its own paragraph attributed to entry 7.31
  as an implementation clarification pending owner confirmation — never inside the owner-attributed text.
- `saveMidBattle` recorded the uninterrupted run's engine hashes that the walk never compared. Verdict: medium —
  dead data that suggested a comparison it did not make. Patched: the recording is gone; the walk compares the
  game-state hash at each tick and the composed frame, and the surviving `HashPoint` list is the loaded host's.
- The pinning docstring justified the request-id exclusion with save-game's refused-load counter rule, which is about a
  refused load. Verdict: low — wrong because a successful load adopts the saved counter; patched to the real reason (a
  restored engine re-requests the pictures its state names and spends ids the uninterrupted run never spent).

## Verification

- `node --test packages/core/test/battle-fresh-load.test.ts` — all tests pass, including the two new assertions.
- Gates from the worktree root: `pnpm fixtures:fetch`, `typecheck`, `lint`, `test:strict`, `golden`, `golden:bun`, `graph`, `licence`, `provenance`, `catalogue:check`, `command-docs:check`.
- Expected: the new assertions fail if the restored engine diverges from the uninterrupted run at any compared tick, or if any fight-program thread or battle state survives the reset.

## Plan Change Log

- 2026-10-29 (ledger chore): `ticket: '31'` → `ticket: 31` (bare entry id); the `feature` type is unchanged because it is the folder's dominant plan type and parses as a plan. Frontmatter only, content unchanged.
- 2026-10-29 (completed): marked done after PR #771 (`82d30c5e`, "test(battle): complete the battle save, resume and reset lifecycle evidence") merged; issue #751 closed 2026-10-29T17:07:05Z. Test commit `f53d26a0` adds the per-tick game-state hash comparison against the real `Load` path and the reset-during-battle case in `packages/core/test/battle-fresh-load.test.ts`; the docs-first commit `8194cd35` corrects the BAT-13 attribution and adds the separate scope paragraph attributed to entry 7.31 as an implementation clarification pending owner confirmation. No production code and no golden change. PR #771 CI green with `unit (core-battle)` 6m38s.
