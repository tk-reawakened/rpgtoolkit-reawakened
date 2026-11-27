---
id: 53
type: bug
title: "Visual fixture bounds resolve the reserved overlay directory as an ordinary project path"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3624"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3624"
refined: true
hitl: false
risk: low
severity: P2
---

# Visual fixture bounds resolve the reserved overlay directory as an ordinary project path

Found in #3534 at `1cc30516a8`. A logical `.tkr-tests/Boards/wall.brd` can read the physical overlay file of that name as fallback, but the saved-test runner exposes that file only as `Boards/wall.brd`.

## Acceptance

- There is no ordinary project fallback into the reserved overlay tree (case-insensitive).
- A file inside the overlay with the exact logical path still resolves. Cover both outcomes in `visual-fixture-board.test.ts`.
