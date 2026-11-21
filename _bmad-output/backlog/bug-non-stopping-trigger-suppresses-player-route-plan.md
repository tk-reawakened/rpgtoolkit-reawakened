---
title: 'Non-stopping trigger suppresses later regions on an inherited player route'
type: 'bugfix'
ticket: '7'
created: '2026-11-20'
status: 'in-progress'
baseline_revision: 'b5a5d508948e583828ec8fb55d8eb1816724afde'
route: 'full'
route_source: 'pinned'
risk: 'high'
review: 'none'
review_source: 'pinned'
lenses_ran: []
context:
  - '{project-root}/docs/guardrails.md'
  - '{project-root}/docs/spec/engine/movement-and-collision.md'
  - '{project-root}/docs/spec/engine/display-input-audio.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A non-stopping trigger can suppress later step-on regions on an inherited click route. The trigger runtime cannot tell that route apart from movement issued by the trigger program, so the movement-recursion guard suppresses unrelated travel.

**Approach:** Make movement provenance travel with each queued, active, waypoint-derived, diverted, and completed step. Preserve takeover progress per program thread and targeted player. Suppress only movement issued by the active trigger execution; keep E-40 rearming, click-route freeze/resume, and the existing once-on-takeover rule. Migrate older records to explicit unknown provenance without inferring ownership.

## Boundaries & Constraints

**Always:** Keep E-40 step-on firing and rearming; preserve pointer marks and freeze/resume; clear inherited queued moves and a continuing waypoint once on the first accepted travel instruction of an execution; do not interrupt the active step for that takeover clear; preserve current-save state across restore; legacy unknown movement remains eligible for ordinary trigger evaluation.

**Never:** Add queue-drain-wide suppression; infer provenance from thread/effect shape in old saves; alter historical behavior, owner decisions, or unrelated collision/board-transition rules; run headed Chromium.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Inherited click route | Non-stopping region queues no movement; another region lies later on the route | Route resumes after the blocking program and fires each crossed region on entry | No special error |
| Trigger-issued movement | Active trigger thread queues player travel through another region | Its moves do not activate the other trigger; unrelated moves remain eligible | Invalid/no-travel commands do not claim takeover |
| Mixed route | Trigger-origin and unrelated entries share a queue; later unrelated entry is appended | Eligibility follows each move, not queue contents or queue drain | No queue-wide fallback |
| Saved continuation | Active move, queued provenance, and thread takeover set are saved and restored | The restored run has the same provenance and takeover progress | Old missing fields migrate to unknown/empty state |

</frozen-after-approval>

## Code Map

- `packages/core/src/triggers/runtime.ts` — `runTriggersPhase`; remove blanket silence, preserve rearming, gate only trigger-origin movement.
- `packages/core/src/script/packs/movement.ts` — `applySpriteEffect`; thread identity and player travel commands are known here; preserve command-specific clear/append semantics.
- `packages/core/src/script/state.ts` — `Thread` and `startThread`; saveable per-execution takeover progress belongs with the execution.
- `packages/core/src/sprites/model.ts`, `runtime.ts`, `movement.ts` — queued move, waypoint, active move, path diversion, and step completion provenance.
- `packages/core/src/save/state.ts`, `snapshot.ts`, `triggers/model.ts`, `engine/recovery.ts` — migrate normal-save provenance and takeover state, remove obsolete blanket silence state, and preserve recovery's deliberate discard of candidate VM queues and continuations.
- `packages/core/test/click-movement-freeze.test.ts`, `triggers.test.ts`, `save-ledger.test.ts`, and movement fixture `P-8` — existing phase, trigger, save, and oracle coverage to extend.
- `tools/perf/README.md` and `tools/perf/profile-player.mjs` — headless before/after player profile when available; record an explicit unverified result if the script does not complete.

## Tasks & Acceptance

**Execution:**
- [ ] `docs/spec/engine/movement-and-collision.md`, `docs/spec/engine/display-input-audio.md` — specify provenance suppression, once-on-takeover, and old-save policy in a docs-only commit before runtime changes.
- [ ] `packages/core/src/sprites/*`, `packages/core/src/script/*`, `packages/core/src/triggers/runtime.ts` — track per-move origin and per-thread takeover; preserve unrelated movement and E-40 rearming.
- [ ] `packages/core/src/save/*`, `packages/core/src/triggers/model.ts`, `packages/core/src/engine/recovery.ts` — migrate and validate save shapes; remove obsolete blanket silence state.
- [ ] `packages/core/test/*` and the movement P-8 producer/fixture — add deterministic repros for consecutive click-route regions, trigger-origin versus unrelated and mixed/new movement, clear/push, rejected/no-travel commands, nested calls/waits/separate executions, active-step continuation, waypoints/diversions, E-40 rearming, save/restore mid-active, and recovery mid-active to prove its candidate queue and VM continuation are still discarded; align the P-8 model, manifest and generated fixture to per-move provenance.
- [ ] `tools/perf/README.md` — record paired headless `pnpm perf:player` measurements if available; this attempt timed out without data, so explicitly mark performance unverified; update the applicable changelog.

**Acceptance Criteria:**
- Given a click route crossing consecutive non-stopping regions, when an earlier program returns without moving the player, then each region fires on entry and click freeze/resume remains intact.
- Given a trigger-issued move and unrelated movement in the same queue, when both enter regions, then only trigger-origin movement is suppressed; the rule follows each move, not queue drain.
- Given accepted, rejected, and no-travel instructions across nested calls, waits, later ticks, and independent executions, when movement is issued, then takeover clears inherited queue/waypoint once per execution without interrupting the active step and later commands keep normal semantics.
- Given a current or legacy save, when normal save/restore resumes mid-active movement, then new provenance and takeover progress are preserved, while absent legacy provenance remains unknown/eligible and absent takeover progress is empty; interruption recovery continues to discard candidate queues and VM continuations.
- Given the focused tests and required local gates, when run, then regressions fail before and pass after the fix and each new deterministic test completes individually under one second.
- Given the headless player profile, when before/after runs complete, then record the comparable cost-per-tick results; if they do not complete, explicitly report performance as unverified without claiming measurements.

## Implementation Notes

- 2026-11-20: Headless `pnpm perf:player` was attempted without `--headed` but timed out after 120 seconds before producing profile data. Baseline performance remains unverified; do not claim before/after numbers.
- Interruption recovery intentionally discards candidate VM continuations and queues (`docs/spec/engine/interruption-recovery.md`); the save/restore contract and tests here cover normal saves only.

## Plan Change Log


## Review Triage Log


## Design Notes

Per-move origin and per-thread takeover are separate state: provenance answers whether this movement can start triggers; takeover answers whether this execution has already displaced inherited movement for a player. Unknown legacy movement is deliberately eligible, because the old snapshot did not record enough information to prove who queued it.

## Verification

**Commands:**
- `node --test packages/core/test/click-movement-freeze.test.ts` and the new focused regression file — expected: all relevant assertions pass; each new test is under one second.
- `pnpm --filter @tk-reawakened/core typecheck:tests` — expected: no test-source type errors.
- `pnpm typecheck` and `pnpm test` — expected: repository type and test suites pass.
- `pnpm perf:player` before and after runtime changes, without `--headed` — record comparable per-tick results if both complete; otherwise retain the explicit unverified status.
