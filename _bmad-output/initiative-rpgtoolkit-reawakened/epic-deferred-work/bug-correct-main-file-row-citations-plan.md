---
id: 11
type: bug
title: "Correct main-file row citations to the renumbered spec"
tracker_id: "#849"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/849"
parent: epic-deferred-work
created: '2026-10-31'
status: 'built'
baseline_revision: 'c8b7772f4d0c9d15fcd14f066dcaf16d1ca89d70'
route: 'oneshot'
route_source: 'auto'
risk: 'low'
review: 'none'
context: []
---

## Intent

The old fight style and the plugin list were both cited as "Row 29"; the spec numbers them 11 and 37. Citation-only change, no behaviour.

## Verification

- `grep -rn "Row 29" packages/core/src/formats/main-file/` returns nothing; every comment now names row 11 (fight style) or row 37 (plugin list).
