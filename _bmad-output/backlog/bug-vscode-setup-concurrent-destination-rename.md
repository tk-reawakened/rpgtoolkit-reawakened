---
id: 62
type: bug
title: "VS Code disk-provider rename cannot guarantee no-clobber against a concurrent external writer"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3632"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3632"
refined: true
hitl: false
risk: high
severity: P2
---

# VS Code disk-provider rename cannot guarantee no-clobber against a concurrent external writer

The pinned VS Code disk provider checks destination existence and then performs native rename separately, even with overwrite disabled. A file that appears between those steps can be replaced. This is distinct from #3628, which protects the previous archive from ordinary replacement failure.

## Acceptance

- Use a proven no-clobber operation on supported providers, or refuse unsafe publication with the reason.
- Prove that a competing destination appearing at the rename boundary is not changed; preserve the old archive and existing Save As cancellation behavior.
