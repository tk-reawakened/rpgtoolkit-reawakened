---
id: 63
type: bug
title: "Browser session replacement proof ignores the staged settings discard prompt"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3634"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3634"
refined: true
hitl: false
risk: low
severity: P1
---

# Browser session replacement proof ignores the staged settings discard prompt

The [editor-web job](https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/46073370890/job/140755406532) on PR #3535 queried the Game title while the old view and the hidden candidate were both mounted. A staged title now prompts before the project can close.

## Acceptance

- Discard the staged title through the close dialog and verify that only the replacement view remains.
- After a broken project file is rejected, the replacement view and title remain unchanged.
