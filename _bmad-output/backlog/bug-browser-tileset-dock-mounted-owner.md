---
id: 50
type: bug
title: "Browser tileset dock and mounted fight background disagree on game ownership"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3621"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3621"
refined: true
hitl: false
risk: medium
severity: P2
---

# Browser tileset dock and mounted fight background disagree on game ownership

Found in #3521 at the merge of `54cc38bced` and `6d83de149e`. After discovery sees a new game for an already open fight background, the dock can show that game's tiles but update the mounted owner's session.

## Acceptance

- The dock keeps the mounted editor's tileset folders and browser session together.
- A mark on its tileset does not reach the newly discovered game's same-named tileset. Cover that path in the browser editor proof in #3521.
