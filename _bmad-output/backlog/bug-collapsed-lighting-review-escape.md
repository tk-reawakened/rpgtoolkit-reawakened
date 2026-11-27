---
id: 65
type: bug
title: "Collapsed board lighting review can intercept Escape meant for a visible pane"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3637"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3637"
refined: true
hitl: false
risk: low
severity: P2
---

# Collapsed board lighting review can intercept Escape meant for a visible pane

PR #3583 counted the lighting `<details>` as visible when connected and free of explicit hiding attributes. If two reviews were open and the newer one was collapsed, it could answer Escape instead of the visible review.

## Acceptance

- With two reviews, collapse the newer one and press Escape outside the panels. Only the visible review closes.
- If the only review is collapsed, the board lighting control does not consume Escape. Reopening the panel still shows its review.
- Neither board acquires an edit and focus stays in the pane where the author was working.
