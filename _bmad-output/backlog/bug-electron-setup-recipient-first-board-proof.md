---
id: 60
type: bug
title: "Electron setup recipient proof can pass before reaching gameplay"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3630"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3630"
refined: true
hitl: false
risk: low
severity: P2
---

# Electron setup recipient proof can pass before reaching gameplay

PR #3535's clean-recipient test could accept a ticking startup program that never got past its keyboard wait.

## Acceptance

- From the installed game, send the startup input and verify the expected first board is live before removal.
- Keep cancelled install, exact installed package, library removal and save-preservation checks.
