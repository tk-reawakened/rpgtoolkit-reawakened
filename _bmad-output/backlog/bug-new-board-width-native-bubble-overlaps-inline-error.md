---
id: 32
type: bug
title: "New board width validation shows the native number bubble over the inline error"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3146"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3146"
refined: true
hitl: false
risk: low
severity: P2
---

# New board width validation shows the native number bubble over the inline error

## Description

In the New board dialog, entering Width 0 and attempting creation shows the browser's native number bubble ("Value must be greater than or equal to 1") on top of the inline width error ("width must be a whole number from 1 to 1000"). The native bubble hides the inline message, so the creator cannot read the problem where the field is. The inline `role="alert"` message must be the one shown, and invalid creation must still be refused.

## Reproduction

1. Open the New board dialog.
2. Enter Width 0 and a valid name, then attempt creation.
3. The native bubble covers the inline width error. Expected: the inline error is fully visible and no board is created.

## Cause Hypothesis

The New board form does not set `noValidate`, so the browser runs constraint validation on `min` and `max` and draws its own bubble over the field. The shared `submit` handler already refuses invalid input and writes the inline message, so the native bubble is redundant.

## Acceptance

- The native bubble does not appear for Width 0 in a real browser, and the inline width error is visible.
- Creation with an invalid width or an empty name is still refused, with nothing created.
- Valid creation still works.
