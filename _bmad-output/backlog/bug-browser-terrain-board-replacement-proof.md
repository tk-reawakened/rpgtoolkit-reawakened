---
id: 55
type: bug
title: "Native terrain save proof aborts when the generated board is being replaced"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3626"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3626"
refined: true
hitl: false
risk: low
severity: P2
---

# Native terrain save proof aborts when the generated board is being replaced

In [PR #3534's browser run](https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/46045711865/job/140664460101), the shortcut save's generated-board read threw `NotFoundError` in `editor-connected-authoring.spec.ts` and aborted the poll.

## Acceptance

- Reopen the board on each in-flight save observation; a transient missing file must not abort that poll.
- Still require the exact decoded tile after each save, and keep the prior-byte and missing-before-save checks strict.
