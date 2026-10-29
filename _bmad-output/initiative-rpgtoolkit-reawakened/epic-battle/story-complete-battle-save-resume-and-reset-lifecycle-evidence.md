---
id: 31
type: story
title: "Complete battle save, resume, and reset lifecycle evidence"
parent: epic-battle
tracker_id: "#751"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/751"
covers: [CAP-9, CAP-11]
after: [2, 20]
hitl: false
risk: medium
---

# Complete battle save, resume, and reset lifecycle evidence

## Description

Existing tests compare frames from uninterrupted and saved/resumed battles, but compare game-state hashes only between two restored snapshots. They do not compare state hashes across an uninterrupted battle and continuation through the real game `Load` path. Also verify that resetting during an active battle clears its lifecycle state; use no active audio for whole-state hash equality because active audio intentionally restarts on load and contributes to the hash.

## Acceptance Criteria

Verify: With no active audio, an uninterrupted deterministic battle and a saved-then-resumed battle using the real game `Load` path reach the same fixed simulation points with matching game-state hashes; keep the existing resumed-frame comparison rather than duplicating it; a separate reset-during-battle case proves battle state and its active continuation are cleared. This does not substitute direct restoration of a decoded snapshot for the game `Load` path.

## References

- parent — _bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md
- spec — docs/spec/engine/battle.md, BAT-2 and BAT-8
- spec — docs/spec/formats/save-game.md
- tests — packages/core/test/battle-fresh-load.test.ts

## Notes

- Audit evidence: `packages/core/test/battle-fresh-load.test.ts:216-227` compares frames from uninterrupted and saved/resumed runs; `:244-251` compares state hashes between two restored engines, not against an uninterrupted continuation. Reset clears `battle` in `packages/core/src/engine/engine.ts:1239-1252`, but the active-battle lifecycle is not covered here.
- Exclusion: do not add generic null/real audio runner parity or active-audio hash equality; #691 covers runner parity/restart behavior, and active audio restarts at load by contract.
- Exclusion: #593 covers generic load validation, restore order, and thread continuation; this story is limited to battle-specific state-hash parity and reset lifecycle evidence.
- Risk rationale: medium — A save/resume or reset defect could leave live battle state unrecoverable; the test uses no-active-audio hashes and does not change audio behavior.
