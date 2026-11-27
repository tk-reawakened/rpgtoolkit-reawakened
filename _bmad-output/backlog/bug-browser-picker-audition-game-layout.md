---
id: 44
type: bug
title: "A mounted fight background can pick music from a different game than it auditions"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3619"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3619"
refined: true
hitl: false
risk: medium
severity: P2
---

# A mounted fight background can pick music from a different game than it auditions

## Reproduction

On #3520 at `fe48c58f6b11ad0edf20fb4992e70a34eb13a9c1`, open a fight background owned by the outer game. Add a main file claiming the background for a nested project while the tab is open. Put a different recording with the same name in each project's `Media` folder. The picker searches the nested game, but the mounted form interprets its result against the outer game.

## Acceptance Criteria

1. The mounted fight-background picker, in-form audition, and Run menu use the same project layout. Verify the bytes sent to the host's audio output before and after refreshing ownership while retaining the mounted tab.
2. Native skins still refresh layout from the current main files for both picker and preview. Other pickers that previously read live declarations still do; a special move in a newly declared nested game can choose and open its own linked status effect.
3. Keep the stored relative reference, audio recognition, and persisted file format unchanged. Fix and validate in #3520.
