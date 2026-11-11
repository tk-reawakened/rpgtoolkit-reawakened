---
type: story
title: "The player applies the project's debug overlays, and runner diagnostics stay off unless asked"
ticket: 32
status: draft
---

# The player applies the project's debug overlays, and runner diagnostics stay off unless asked

## Scope

Pass the main file's `showFpsInTitle`, `drawVectorsFlags` and `pathColor` into the engine's `init.debug` when a game boots, so the legacy Graphics tab means what it says: the frame count in the window title, and board-vector, sprite-vector, active-path and destination-circle outlines over the game. One mapping serves the browser, desktop and mobile players.

Give the desktop player per-overlay opt-in flags for a single run — `--fps`, `--debug board,sprite,path,destination`, `--debug-colour #rrggbb` — with the project's own values as the default and the flag as an override. No flag writes back to the game.

Keep the desktop player's diagnostics strip (`#live-status`, the tick/state/draw line) a runner feature behind its own flag, off by default; it is not a main-file setting.

Read the behaviour from `docs/spec/engine/display-input-audio.md` ("Window and display", "Debug drawing") and `docs/spec/formats/main-file.md` rows 56, 58 and 59. The engine side already exists (`init.debug` in `packages/core/src/engine/engine.ts`); the work is the runner mapping and the flags, plus the diagnostic when a project asks for an overlay the host cannot draw.

## Acceptance and verification

On the demo package with `drawVectors` set and `bFpsInTitleBar` on: the visible player and the headless measurement run emit the same overlay commands, and the window title carries the frame count. Clearing the fields draws nothing and leaves the draw-list golden unchanged. A per-overlay flag turns one overlay on while the main file stays byte-identical after a later save. The diagnostics strip appears only with its own flag.

Keep the overlay-free path byte-identical, and prove the flags are an override rather than a write by reading the main file back after the run. Follow G2 (no host access from `core`) and G7; do not claim checks passed without executing them.

## Dependencies and decision gate

Prerequisites: 9.4, 9.11, 9.16. Decision needed before starting: whether the frame count sits in the window title, as Toolkit 3 does, or as a canvas overlay, which the engine already emits. The title needs the host; the overlay needs nothing new. Nothing else here waits.
