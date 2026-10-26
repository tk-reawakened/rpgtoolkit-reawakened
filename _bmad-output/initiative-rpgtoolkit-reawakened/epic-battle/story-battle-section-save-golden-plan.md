---
title: "Battle-section save golden"
type: 'feature'
ticket: 20
created: '2026-10-26'
status: draft
risk: "medium"
context:
  - "spec - docs/spec/engine/battle.md (BAT-2, BAT-13)"
  - "spec - docs/spec/formats/save-game.md"
---

## Intent

Supply the missing Epic 7.2 save golden that makes the battle section's isolated save-format change visible and reviewable.

## Boundaries

Add only the requested deterministic battle-section golden/test. Keep non-battle sections identical between the paired snapshots, preserve unrelated goldens, and retain the schema-v1 empty-placeholder migration fixture.

## Acceptance

- [ ] A named deterministic test captures equivalent out-of-battle and mid-battle saves.
- [ ] Their golden diff changes only the root `battle` section and shows the versioned parties, fighter references, background, `canRun`, outcome, and charge.
- [ ] The battle section contains no copied actor HP/SMP/stats/status or audio; playback remains in the independent audio section.
- [ ] The schema-v1 migration fixture remains unchanged and valid.
- [ ] No unrelated golden is recorded or updated (G5).

## Verification

Run the focused save golden and migration tests; inspect the golden diff to ensure every change is under `battle` and no unrelated golden file changed. Run repository checks in the main verification pass.

## Plan Change Log

- 2026-10-26: created to close the save-golden acceptance gap for Epic 7.2.
