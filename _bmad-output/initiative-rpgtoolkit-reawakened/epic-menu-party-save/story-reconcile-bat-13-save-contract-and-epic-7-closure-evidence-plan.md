---
title: 'Reconcile BAT-13 save contract and Epic 7 closure evidence'
type: 'feature'
ticket: 21
created: '2026-10-30'
status: 'built'
baseline_revision: 'cc173f35a884d5705491999f7679c58823ba474a'
route: 'oneshot'
route_source: 'auto'
risk: 'medium'
review: 'quick'
context: []
---

<frozen-after-approval>

## Intent

Reconcile BAT-13 with implemented interruption recovery and ordinary snapshot continuation without promising a battle restart from a ledger or claiming literal full-state equality. Preserve the historical Epic 7 sweep and open follow-ups.

</frozen-after-approval>

## Implementation Notes

Updated BAT-13 and the changelog. The #809 plan's context list was made inline without changing its entries so the ticket parser can read current main. The #753 sweep remains historical; #805 owns literal full-state equality, #806 combined lethal-status evidence, #758 the audio defect, and #503 parent closure.

## Review Triage Log

- Independent review requested landed recovery evidence citations and an explicit distinction between normalized comparison and the unchanged literal Epic 7 criterion. Patched BAT-13 with test names, PRs #803 and #811, and #805 ownership; preserved #753 historical audit.

## Verification

`git diff --check` passed. `tickets.py next initiative-rpgtoolkit-reawakened` completed. `node --test packages/core/test/battle-fresh-load.test.ts packages/core/test/engine-boot.test.ts packages/core/test/recovery-store.test.ts packages/core/test/save-instruction-version.test.ts`: 99 passed, 3 sample-fixture tests skipped, 0 failed. The battle comparison normalizes surfaces, request state and audio cue ID; it does not prove literal whole-state equality. Recovery tests cover a pre-battle candidate with null battle, paused re-entry and explicit resume.
