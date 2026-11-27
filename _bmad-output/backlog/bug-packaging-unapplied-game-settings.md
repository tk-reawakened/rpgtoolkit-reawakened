---
id: 59
type: bug
title: "Package and setup preflight overlook unapplied game settings"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3629"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3629"
refined: true
hitl: false
risk: medium
severity: P1
---

# Package and setup preflight overlook unapplied game settings

PR #3535 checks saved documents before making a package or setup, but the Game Settings form can hold a changed title that the model and VS Code dirty flag do not yet see.

## Acceptance

- Refuse preflight on a held Game Settings edit and leave the staged field and saved input intact.
- Let authors continue after discarding the draft or applying and saving it. A refusal does not write a package or setup.
- Keep ordinary Save and Save As operating on applied settings only. Cancelling Revert keeps the staged text; confirmed Revert clears it.
