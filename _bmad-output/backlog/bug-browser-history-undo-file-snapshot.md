---
id: 56
type: bug
title: "Browser history undo proof aborts on an invalidated OPFS File snapshot"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3627"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3627"
refined: true
hitl: false
risk: low
severity: P2
---

# Browser history undo proof aborts on an invalidated OPFS File snapshot

In [PR #3534's browser run](https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/46045711865/job/140664460101), the persisted hash observation after Undo this restore threw `NotReadableError` in `editor-history.spec.ts`, after the model had shown the edited title.

## Acceptance

- Use a fresh file snapshot on each persistence observation, allowing a stale snapshot to wait for the next poll.
- Confirm the exact stored hashes after restore and undo, and still prove that preview did not change persisted bytes.
