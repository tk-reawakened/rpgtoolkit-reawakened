---
title: 'Movement input from the main file'
type: 'feature'
ticket: '33'
created: '2026-11-11'
status: 'draft'
baseline_revision: 'd163695d1cef6ddb195dead72d51ab375dda64e0'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: ['docs/guardrails.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The interactive player ignores the project's movement keys, source gates and controller setting.

**Approach:** Apply these settings through the shared input and engine phases for web, desktop and mobile, preserving deterministic script, UI and replay behavior.

## Boundaries & Constraints

**Always:** Follow G1–G7 and derive behavior from `docs/spec/`. Preserve script key queues, raw pointer observation, UI hit routing, blocking/focus rules, gamepad source ownership and save/replay semantics. Distinguish a missing controller API from no connected pad.

**Never:** Read legacy source, implement 9.35's run-time/activation programs, or silently change goldens. Normative changes precede code in a separate docs-first commit.

**Owner decisions (2026-11-11):** Defaults apply only to fields absent in an older file; present zero control bits are off and individual zero scan codes are unbound. Collision diagnostics do not suppress ACT-4's ordered multi-action dispatch; movement is arbitrated separately. With diagonals disabled, the most recently pressed held direction wins, not alternating steps; ordered input records and ACT-4 action order settle simultaneous input. See `docs/spec/formats/main-file.md#layout` and `docs/spec/engine/display-input-audio.md#act-4`.

## I/O & Edge-Case Matrix

| Input / state | Observable behavior |
|---|---|
| Minor 9, east unbound, another scan code assigned | Old arrow does not walk east; remap does; script still sees keys |
| Absent versus explicit zero | Absent older-file rows use their documented defaults; present zero bits are off and each zero code is unbound |
| Colliding controls | Report the collision; dispatch all bound actions in ACT-4 order and arbitrate movement separately |
| Orthogonal keys, diagonals disabled | One axial step per boundary in the most recently pressed held direction; ordered input/action transitions settle same-tick input |
| Keyboard or pointer disabled | Only enabled source walks; raw key/pointer and UI behavior remain |
| Joystick off/on, standard pad available | Gating follows ACT-5; enabled pad moves; unavailable API is reported, disconnected pad is not misreported |
| Held input, block, blur or route | Existing step-boundary, script ownership and focus rules remain |
| Save/load, reset or `MainFile()` | Active game's settings and host reconciliation remain correct |

</frozen-after-approval>

## Code Map

- `docs/spec/formats/main-file.md#layout` rows 45, 60–61: minor 9 stores mask and eight DirectInput codes E, SE, S, SW, W, NW, N, NE. Each present zero is unbound; absent mask is 5, absent keys are arrows. The TKR input extension keeps legacy rows distinct from ACT bindings.
- `docs/spec/engine/display-input-audio.md`: E-110, held-direction and click-freeze rules, ACT-4 multi-action dispatch and ACT-5 controller policy; `movement-and-collision.md#e-133` fixes the step boundary.
- `packages/core/src/formats/main-file/{model,reader}.ts`: minor distinguishes absent rows from explicit zero; older models carry zero/empty sentinels.
- `packages/runner-web/src/{input-bindings,live-session,host-state}.ts`: fixed keys, main-file/menu setup and normalized pad observation. `features.gamepad` is connected-device state, not proof that the API exists. One live session serves all three hosts.
- `packages/core/src/input/{input,registration}.ts` and `engine/engine.ts`: source claims, key queue, pad staging, held-facing arbitration, pointer routing and boot/reset/main-file/load seams.
- Existing tests: core `held-key-movement`, `click-movement-freeze`, `input`, `movement-input`; runner-web `interactive-input`, `host-state`; browser `live-player.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] `docs/spec/formats/main-file.md`, `docs/spec/engine/display-input-audio.md` — normative owner clarifications are in the preceding docs-only commit; keep 9.33/9.35 tracker text aligned with them.
- [ ] `packages/runner-web/src/{input-bindings,live-session}.ts` — derive version-aware movement settings; translate supported DirectInput codes to physical key codes with explicit handling for unsupported codes and collisions. Preserve menu and legacy key delivery.
- [ ] `packages/core/src/input/{input,registration}.ts`, `engine/engine.ts` — gate gameplay movement by source and controller policy without filtering raw records; cover reset, `MainFile()` and restore. If persisted or wire shapes change, update their schemas, migrations, vectors and consumers together.
- [ ] Core, runner-web and browser tests named above — cover the matrix, rulings, same-tick ordering and real packaged input; perturb each gate and queue/collision assertion. Keep unit tests under one second.
- [ ] `CHANGELOG.md` and player docs — explain settings, diagnostics and host limitations plainly.

**Acceptance Criteria:**
- Given a remapped packaged demo, when old and new east keys are pressed, then only the configured key walks east and script keys remain observable.
- Given keyboard/mouse gates, when both sources are exercised, then only enabled movement occurs without suppressing pointer/UI or script events.
- Given diagonals enabled, when two orthogonal directions remain held, then exactly one diagonal step is queued per eligible boundary.
- Given orthogonal keys and diagonals disabled, when both remain held, then the most recently pressed held direction produces one axial step per boundary; ordered input/action transitions settle same-tick input.
- Given a duplicate physical control, when pressed, then all bound actions dispatch in ACT-4 order, movement is arbitrated separately and the collision is reported.
- Given joystick off/on, when a standard pad is exercised, then gating and connection reconciliation follow ACT-5; an unsupported API differs from no pad.
- Given absent and explicit-zero fields, when the game boots, resets and restores, then absent older-file fields use documented defaults, present zero controls are off and zero scan codes are unbound; source bytes remain unchanged.


## Implementation Notes

## Plan Change Log

## Review Triage Log

## Verification

- Fetch fixtures; run `pnpm build`, new focused core/runner tests individually, the targeted Playwright movement fixture, `pnpm typecheck`, `pnpm lint`, `pnpm test:strict`, `pnpm golden` and affected schema/vector checks. Record durations, outcomes and golden changes.
- Prove guards with failing perturbations, restore and rerun. Distinguish synthetic pad events from actual hardware testing.
