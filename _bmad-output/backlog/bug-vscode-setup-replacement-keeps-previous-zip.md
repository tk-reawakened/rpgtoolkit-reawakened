---
id: 58
type: bug
title: "VS Code setup replacement can lose the previous ZIP on rename failure"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3628"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3628"
refined: true
hitl: false
risk: high
severity: P1
---

# VS Code setup replacement can lose the previous ZIP on rename failure

PR #3535 used `workspace.fs.rename` with overwrite enabled. VS Code's file service can delete the old target before the provider refuses the move. This differs from #3577, which covered cleanup of the new partial archive.

## Acceptance

- Preserve the old archive when publishing the staged replacement fails. Restore it to its former path when possible; otherwise keep it and report the recovery path.
- Preserve cancellation. Use no-overwrite moves, leaving any collision the provider detects untouched; atomic protection against an external writer is tracked separately in #3632.
