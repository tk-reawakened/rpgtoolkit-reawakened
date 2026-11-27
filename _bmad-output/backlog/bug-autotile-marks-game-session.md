---
id: 45
type: bug
title: "Autotile marks lose identity across brushes and game sessions"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3612"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3612"
refined: true
hitl: false
risk: medium
severity: P2
---

# Autotile marks lose identity across brushes and game sessions

Found on #3521 at `323d48352c6c44c6693d9fc6e2a95900445013bf`. Switching or clearing a brush could drop a mark, `Tiles/` aliases could fail to match, and workspace-level state could leak between games. See #1733 for the owning story.

## Acceptance

- Marks survive brush switches and document reopen in the same owning game, without crossing into another game. They do not get written to board or tileset files.
- Aliases with an optional `Tiles/` prefix identify the same source, but case-distinct source names do not connect. Erase can reshape marked neighbours with no selected brush, and a new mark immediately displays shape previews.

Verify `board-autotile.test.ts`, `board-autotile-view.test.ts`, and `browser-sessions.test.ts` in #3521.
