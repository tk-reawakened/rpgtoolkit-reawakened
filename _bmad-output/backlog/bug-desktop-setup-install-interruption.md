---
id: 61
type: bug
title: "Interrupted desktop setup install can leave an unregistered package that blocks retry"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3631"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3631"
refined: true
hitl: false
risk: high
severity: P2
---

# Interrupted desktop setup install can leave an unregistered package that blocks retry

PR #3535's desktop installer moves artifacts into the library before the registry commit. Abrupt process termination can strand artifacts which a later attempt correctly refuses to overwrite. Ordinary handled failures use owned-file cleanup.

## Acceptance

- An install interrupted before the registry commit can be retried after reopening the player; demonstrate the persisted interruption states instead of relying on timed kills.
- Never overwrite or delete files whose ownership cannot be established, and never affect saves.
