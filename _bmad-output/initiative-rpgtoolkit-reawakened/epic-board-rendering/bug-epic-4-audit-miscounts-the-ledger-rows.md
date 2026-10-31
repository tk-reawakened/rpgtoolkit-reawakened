---
id: 37
type: bug
title: "[4.37] The epic 4 audit miscounts the ledger rows"
parent: epic-board-rendering
covers: ["CAP-2"]
after: []
assignee: ""
tracker_id: "#885"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/885"
tracker_status: in-progress
refined: true
hitl: false
risk: low
severity: P3
---

# [4.37] The epic 4 audit miscounts the ledger rows

## Description

The closure audit's criterion 1 says `golden/ledger.json` holds "19 rows: 13 independent-reference
scenes (`S-01…`, `S-ISO-STACKED`, `S-ISO-ROTATED`, the seven `S-LIGHT-*`) and 7 `closing:*` sample-game
baselines". The total is right; the split is not. The ledger holds **12** independent-reference rows and
**7** regression baselines, and `golden/scenes/` has **six** `S-LIGHT-*` scenes, so "13 + 7" does not even
add up to the page's own total of 19.

## Evidence

```
$ python3 -c "import json,collections; d=json.load(open('golden/ledger.json')); print(len(d['goldens'])); print(collections.Counter(r['class'] for r in d['goldens']))"
19
Counter({'independent-reference': 12, 'regression-baseline': 7})
```

The twelve are `S-01`, `S-01b`, `S-01c`, `S-01d`, `S-ISO-STACKED`, `S-ISO-ROTATED`, `S-LIGHT-BOUNDARY`,
`S-LIGHT-CLIPPED`, `S-LIGHT-ELLIPSE`, `S-LIGHT-GRADIENT`, `S-LIGHT-NIGHT`, `S-LIGHT-OVERLAP`.

## Fix

Correct the row in its own PR that quotes the superseded wording and cites #885. No code, ledger or golden
change: criterion 1's verdict stands (`pnpm golden` reports every scene "exact RGBA match
(independent-reference, gating=true)" and `golden: 24 compared`).
