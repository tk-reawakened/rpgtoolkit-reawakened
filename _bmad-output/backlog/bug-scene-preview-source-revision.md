---
id: 46
type: bug
title: "Scene asset preview misses image and pack-source changes"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3613"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3613"
refined: true
hitl: false
risk: medium
severity: P2
---

# Scene asset preview misses image and pack-source changes

Found on #3521 at `323d48352c6c44c6693d9fc6e2a95900445013bf`. Same-path artwork changes could leave a stale scene preview; unreadable artwork in an unrelated tileset could block the entire scene. See #1733 for the owning story.

## Acceptance

- Refreshing after a referenced tile or pack source image changes invalidates the old scene preview even when its name is unchanged. An identical read does not invalidate the preview.
- A missing sample used by the scene is diagnosed, including boundary-source, palette and tile-override references. A missing sample in a merely listed, unrelated tileset does not block the scene.

Verify the focused terrain roles, pack-placement build and scene view tests, plus the native VS Code scene proof in #3521.
