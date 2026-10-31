---
id: 17
type: bug
title: "Fail the golden job when a baseline file is missing"
tracker_id: "#899"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/899"
parent: epic-platform-baseline
created: '2026-10-31'
status: 'built'
baseline_revision: 'deaba38927e9d2b34946cc71f82e6a357053ecaa'
route: 'oneshot'
route_source: 'auto'
risk: 'medium'
review: 'quick'
context: []
---

## Intent

A missing baseline file made the compare-mode golden job drop that stage and still exit 0. The CLI now passes an empty sentinel for a missing scripts and ledger baseline, the ledger sentinel fails the scene stage, and the audio stage builds its runs before checking the baseline so a deleted `golden/audio/cues.json` fails when the corpus is present.

## Verification

- Failing before: with each of the three files renamed, `node packages/runner-headless/dist/cli.js golden` exited 0.
- Passing after: the same probes exit 1, naming `golden/scripts/golden.json is absent`, `golden/ledger.json is absent` and `golden/audio/cues.json is absent`; with the files restored the run exits 0.
- Without fetched fixtures the audio stage stays out, so the documented local flow is unchanged.
