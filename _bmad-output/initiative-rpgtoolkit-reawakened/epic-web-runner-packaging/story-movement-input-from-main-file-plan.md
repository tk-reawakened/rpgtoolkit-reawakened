---
type: feature
title: "Movement keys, mouse and diagonal gating, and joystick come from the main file"
ticket: 33
status: draft
---

# Movement keys, mouse and diagonal gating, and joystick come from the main file

## Scope

Drive the interactive player's movement input from the main file instead of the fixed arrow/WASD table: the eight `movementScanCodes` bind East, South-East, South, South-West, West, North-West, North and North-East; `movementControls` gates the keyboard, the pointer and diagonal composition of two cardinal keys; `useJoystick` gates a connected pad where the host exposes one.

Keep the fixed table as the fallback when the fields are zero or absent, so an older package plays as it does today. Where a configured key collides with another binding, one documented precedence wins and the player reports the collision rather than resolving it silently.

Read the rules from `docs/spec/engine/display-input-audio.md` ("Input") and `docs/spec/formats/main-file.md` rows 60 and 61. The binding table lives in `packages/runner-web/src/input-bindings.ts`; `9.35` shares it and its collision rules, so land the precedence once.

## Acceptance and verification

On the demo package: clearing the east scan code stops the east arrow from stepping the player and a remapped key steps it; clearing the keyboard bit makes the arrows inert while the pointer still walks, and clearing the mouse bit does the reverse; with diagonals enabled two cardinal keys give one diagonal step, and with diagonals disabled they give two axial steps in turn; a pad is inert with `useJoystick` off and steps the player with it on; a main file whose fields are all zero still plays through the fallback table.

Test the boundary cases directly — one step per key press, one diagonal rather than two axial steps — instead of replaying a session. Follow G2 and G7; report a setting unsupported where a host cannot honour it.

## Dependencies and decision gate

Prerequisites: 9.16. If a host cannot expose a pad, the setting is reported unsupported rather than ignored; that is a diagnostic decision, not a licence to drop the field.
