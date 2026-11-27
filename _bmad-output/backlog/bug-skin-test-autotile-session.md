---
id: 49
type: bug
title: "Skin tests fail against the autotile browser session contract"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3620"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3620"
refined: true
hitl: false
risk: low
severity: P1
---

# Skin tests fail against the autotile browser session contract

Found in #3521 when integrating `main` at `54cc38bced`. The skin fixtures return browser state without the required autotile marks field.

## Acceptance

- The skin tests use the shared browser session factory and pass the editor UI test typecheck and the existing skin view checks.
