---
id: 48
type: bug
title: "Dropping a tile loses short autotile-set warning metadata"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3615"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3615"
refined: true
hitl: false
risk: low
severity: P2
---

# Dropping a tile loses short autotile-set warning metadata

Found on #3521 at `323d48352c6c44c6693d9fc6e2a95900445013bf`. The dropper could remove warnings by replacing the selected tile without its tileset size. See #1733 for the owning story.

## Acceptance

- Dropping a tile from the same short set keeps the warning and names the missing shapes, including when the tile reference carries a `Tiles/` prefix.
- Dropping a tile from a different short set reads that set's actual size rather than reusing the previous warning.

Verify the two dropper cases in `packages/editor-ui/test/board-autotile-view.test.ts` in #3521.
