---
title: 'Preserve voice binding after canceled board music'
type: 'bugfix'
ticket: 9
created: '2026-10-30'
status: done
baseline_revision: '2573a98d7bb27d94c6570d511ae23b777056215d'
risk: 'medium'
context: []
---

## Intent

Keep a pending script voice alive until its queued audio effect completes. A canceled engine board-music start must not let collection and handle reuse redirect a later `media.play` binding.

## Implementation Notes

The audio effect queue carries a numeric voice handle at argument 8, which is not an ordinary VM object root. End-of-tick collection now roots live media.voice records named by pending media.play effects. The full-engine regression cancels a board-music start while a stock battle runs and verifies the battle and script voice playback continue. Existing issue #758 is registered as 21.9; no new issue is created.

## Verification

`pnpm exec tsc -b` and all seven battle-cues-engine tests passed. The focused cancellation test also passed after asserting the canceled board request produced no `other.mid` cue. `git diff --check` passed. Two independent reviews checked lifetime and regression; the regression reviewer requested an explicit cancellation assertion, which was added and re-reviewed without further findings.
