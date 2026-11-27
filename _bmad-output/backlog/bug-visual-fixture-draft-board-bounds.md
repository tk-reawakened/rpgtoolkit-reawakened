---
id: 52
type: bug
title: "Visual fixture card can validate a new board with the previous board bounds"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3623"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3623"
refined: true
hitl: false
risk: medium
severity: P2
---

# Visual fixture card can validate a new board with the previous board bounds

Found in #3534 at `1cc30516a8`. Changing the Board field leaves the form validating the saved board's ranges instead of the draft board.

## Acceptance

- Labels and validation are tied to the current entered board; a superseded reply cannot update them.
- In the native fixture proof, switch from a five-tile-wide board to a two-tile-wide board and prove that column four cannot be saved on the smaller board.
