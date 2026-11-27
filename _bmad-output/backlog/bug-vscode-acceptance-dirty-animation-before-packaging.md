---
id: 64
type: bug
title: "VS Code acceptance leaves an animation dirty before package preflight"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3635"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3635"
refined: true
hitl: false
risk: low
severity: P1
---

# VS Code acceptance leaves an animation dirty before package preflight

The [VS Code editor job](https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/46073370890/job/140755406542) on PR #3535 correctly refused package preflight while `host-proof.anm` was dirty. The preceding authoring proof checked the live preview but did not finish the native authoring session.

## Acceptance

- Save natively, verify that the workbench tab is clean, and read the last animation changes back from disk before closing the tab.
- The following packaging proof keeps its review and persisted-export checks; preflight never saves authored work.
