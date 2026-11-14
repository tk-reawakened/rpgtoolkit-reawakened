---
id: 4
type: bug
title: "Final Destiny title remains black while New Game is clickable"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#2153"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2153"
refined: true
hitl: false
risk: medium
severity: P2
---

# Final Destiny title remains black while New Game is clickable

## Description

During #1994 verification at PR #2152 head `1e3a581d`, an unchanged Final Destiny package booted in the Electron player and reached the `MouseClick` wait, but its title screen stayed entirely black at ticks 875 and 1612. Clicking the invisible New Game button at its game-authored location still opened House on Grass. The startup script `Prg/Start.prg` calls `drawtitle` before `MouseClick`. Related but not assumed identical: #1958.

## Reproduction

Boot the unchanged fetched Final Destiny package in the Electron player and wait at the `MouseClick`. The reported capture (`/tmp/issue1994-menu.png`, SHA-256 `3eb803de3aa394d09c943663c7f90c3df512749986e1ee2e6673d377024f9c86`) was local to the reporter and is not in the repository.

## Acceptance Criteria

1. **The title is visible while awaiting the click**
   **Given** the unchanged fetched Final Destiny fixture booted to the `MouseClick` wait
   **When** the title is awaiting input
   **Then** the title and the New Game, Load and Quit buttons are visible, proved by a title pixel or command assertion
2. **New Game enters the board**
   **Given** the visible title
   **When** New Game is clicked
   **Then** the board is entered, verified on the same unchanged fixture

## References

- script — `Prg/Start.prg` in the fetched Final Destiny fixture (`drawtitle`, then `MouseClick`)
- issue — [#2153](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2153); related #1958, found during #1994 at PR #2152

## Notes

- Ticket created from the issue text only. The root cause is unknown; the work must establish whether the draw is missing, never presented, or cleared. Needs the fetched fixture (`pnpm fixtures:fetch`) and the Electron player.
