---
id: 57
type: bug
title: "VS Code fresh creator proof stalls in the package file picker"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3588"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3588"
refined: true
hitl: false
risk: low
severity: P2
---

# VS Code fresh creator proof stalls in the package file picker

In [PR #3534's VS Code browser run](https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/46045711865/job/140664460190), the second invocation stayed in the workbench file picker after accepting a typed path instead of opening the release-version prompt in `creator-acceptance-proof.ts`.

## Acceptance

- Open the authored game through the real, populated workbench file picker on both package invocations.
- Keep the cancelled export, confirmed release, and exact-byte portable playback checks.
