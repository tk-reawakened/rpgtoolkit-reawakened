---
id: 47
type: bug
title: "Native scene inventory startup errors disappear and cannot be retried"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3614"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3614"
refined: true
hitl: false
risk: medium
severity: P2
---

# Native scene inventory startup errors disappear and cannot be retried

Found on #3521 at `323d48352c6c44c6693d9fc6e2a95900445013bf`. A failure could be delivered before initialization and disappear from the ready view, leaving neither current terrain nor a retry action. See #1733 for the owning story.

## Acceptance

- The native scene shows the latest result and its problems across startup and overlapping refreshes, including a failure. Older reads cannot replace it, and disposed views receive no late update.
- Retry remains available when there are no current roles. Success clears the problem and restores a usable manual tile selection.

Verify the native VS Code scene proof with gated backing reads, and the scene retry and role-view tests in #3521.
