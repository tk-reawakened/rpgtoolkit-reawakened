---
id: 6
type: bug
title: "Script key names change when project bindings are configured"
parent: none
covers: []
after: []
tracker_id: "#1091"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1091"
refined: false
hitl: false
risk: high
severity: P1
---

# Script key names change when project bindings are configured

## Description

A game's scripts must receive the named key a player pressed, even when that key also has a configured action. A binding can instead cause the action name to reach the script.

## Reproduction

1. Configure a movement binding for the A key and start a script waiting for a key.
2. Press A.
3. The reported failure is that the script receives the movement action name rather than the key name. The expected result is the legacy key name while movement actions retain their behavior.
4. Repeat with an unbound key; it must reach the waiting script.

## Cause Hypothesis

The keyboard input path uses configured action names when it adds some key presses to the shared queue. The original report also identified a path that dropped unbound keys; that path may have changed since the report.

## Acceptance Criteria

1. **Given** a script waiting for input and configured bindings, **when** an unbound key is pressed, **then** the script resumes with its legacy key name.
2. **Given** configured movement keys, **when** a bound key is pressed, **then** scripts receive its legacy key name and movement and diagonal action behavior remain unchanged.
3. **Given** gamepad input and stock menu navigation, **when** their controls are used, **then** action compatibility and configured menu behavior remain unchanged.
4. **Given** the regression suite, **when** the reproduction and related cases run, **then** tests detect the reported defect and protect the affected contracts.
5. **Or**, if the current implementation already meets these behaviors, record evidence proving that no change is needed.

## References

- Issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1091
- Specification — docs/spec/engine/display-input-audio.md#e-110
- Earlier incomplete fix and review — https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/1589

## Notes

- High risk: the shared input queue affects scripts, navigation, replay and saved state. Check stock menu and replay compatibility beyond the focused regression.
- Open question: reconcile the active legacy-name rule with the interactive-player compatibility bridge and frozen historical recordings before changing the shared key contract.
- Related scope: https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1099 also identifies this defect as part of the action-layer work.
