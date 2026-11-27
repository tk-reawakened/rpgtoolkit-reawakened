---
id: 42
type: bug
title: "VS Code board-upgrade proof creates an unreachable settlement view"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3519"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3519"
refined: true
hitl: false
risk: low
severity: P2
---

# VS Code board-upgrade proof creates an unreachable settlement view

## Reproduction

Run the pinned `TKR_VSCODE_BOARD_UPGRADE_PROOF=1` proof on PR #3582 head `475b9bba0f806fa5a3c2c8976ae06ced8b5fb8e5` with CI's nested workspace, pinned fixture, and autosave disabled. GitHub and wrkflw run `20261127-050818807-c52735` both reached the conversion action but showed the pending-edits refusal instead of the dialog.

## Evidence

In wrkflw trace `20261127-051331396-722436`, two board webviews attached for `Game/Example/Boards/village.brd`. The active view acknowledged `settle-2`; VS Code returned `false` from `postMessage` for `settle-1` to the other view. The settlement guard was right not to proceed with an unconfirmed view. The proof reloads the workbench without waiting for tab restoration and reopens an already open board to switch from the script, allowing an extra panel outside the scenario it intends to prove.

## Acceptance Criteria

1. The proof clears its old editor tabs through native VS Code before opening the coordinate-upgrade board, then switches back to the existing board tab instead of opening a second one.
2. The conversion preview opens while the unrelated program edit remains pending. Cancellation, write refusal, conversion, Save, Undo/Redo, reopened bytes and actual runtime observations are still checked.
3. Leave host settlement fail-closed. A genuine missing acknowledgement must still cause refusal; no timeout increase, retry or permission bypass is introduced.

## Verification

Run the focused VS Code board-upgrade proof under the CI Playwright image, with the pinned legacy board fixture. Record whether it passes through the original refusal and all later checks.

wrkflw run `20261127-051951624-efc78a` passed coordinate conversion, the workbench save and native undo, close/reopen, and real runner output. Both the failing and passing runs used Playwright 1.64.0 and VS Code Web Insiders `c9e45a55a0bfce9628d281fb38e43de7fd138818`.
