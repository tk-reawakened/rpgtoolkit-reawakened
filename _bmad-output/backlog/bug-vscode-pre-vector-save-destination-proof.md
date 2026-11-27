---
id: 54
type: bug
title: "VS Code board-upgrade proof times out after confirming the pre-vector save destination"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3625"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3625"
refined: true
hitl: false
risk: medium
severity: P2
---

# VS Code board-upgrade proof times out after confirming the pre-vector save destination

In #3534 integration, wrkflw/Podman `20261127-174040069-9ef707` reached the accepted preview but did not observe a vector copy after the native save confirmation (`tools/editor-vscode-test/web-proof.ts:341` before later edits). `null` can mean a missing file or a decode error. This is earlier than the separate #3519 settlement failure.

## Acceptance

- Diagnose the native destination and persisted output using the CI-shaped nested workspace and the pinned source fixture.
- Preserve cancellation, persisted board content, reopen, undo and runner checks. A timeout increase is not a fix.
