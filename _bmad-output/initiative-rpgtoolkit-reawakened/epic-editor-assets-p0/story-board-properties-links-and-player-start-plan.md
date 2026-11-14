---
type: feature
title: "Board properties links and player start"
ticket: 3
status: blocked
---

# Board properties links and player start

## Scope

Edit board properties, directional links, threads, battle settings and player start with explicit linked-file navigation and main-file ownership.

Cover N/S/E/W board-or-program links, background/color/music, threads with open, read-only dimensions and coordinate system, constants, layer titles, battles, saving flag, enter program and ambient RGB; start marker snaps and changing initial board explicitly edits the main document.

## Acceptance and verification

A board properties edit and startup-marker change save and reopen with unrelated properties intact and linked board or program visits return to their origin.

Use the shared document lifecycle and preserve same-version unknown data; exercise relevant failure/cancel, keyboard access and save/reopen paths rather than relying on preview alone. Follow `discovery/inception-proposal.md`, `docs/editor-features.md` and G2/G7; do not claim checks passed without executing them.

## Dependencies and decision gate

Prerequisites: 1, 11.4, 11.6 and the actual shared program editor, 11.7 (#1705). The required program/thread Open-and-return path has no provider yet. Keep the full linked-program acceptance above; do not make it conditional or substitute a text-only preview. The expanded plan is preserved on pushed branch `feat/1714-board-properties` at `7a9310b0`; no implementation is claimed. This is a provider dependency, not a malicious-folder save restriction.
