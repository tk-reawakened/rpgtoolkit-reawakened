---
type: story
title: "The window shows the project's title, screen mode and cursor"
ticket: 34
status: draft
---

# The window shows the project's title, screen mode and cursor

## Scope

Make the player's window and pointer the game's: `gameTitle` becomes the window title; `extendToFullScreen` and `screenType` choose a full-screen or fixed-size window instead of the constant 960x720 desktop window; `resolution`, `resX` and `resY` size that window rather than only the canvas inside it; and the project's own cursor — image, hot spot and transparent colour — is shown without the game calling `MouseCursor()`, with that command still able to override it at run time.

Where the host cannot honour `colorDepth`, report it instead of ignoring it. Accept that full screen needs a user gesture in a browser and does not in the desktop shell, and say so in the help text.

Read the rules from `docs/spec/engine/display-input-audio.md` ("Window and display") and `docs/spec/formats/main-file.md` rows 7, 43 to 46, 48 and 52 to 54. Today the window is built in `packages/runner-desktop/src/main.ts` and the resolution reaches only `packages/runner-web/src/live-session.ts:128-135`; `9.32` decides where the frame count goes, so keep the title text in one place.

## Acceptance and verification

A package with a title shows that title in the window; full screen fills the display and the host's exit leaves it; a 1024x768 project opens a 1024x768 window rather than a 960x720 window holding a scaled canvas; a custom cursor with a non-zero hot spot clicks at the hot spot and shows its transparent colour; a 16- or 24-bit project on a host that cannot honour it reports that and plays.

Exercise the cancel and failure paths of the full-screen request, and assert the window size rather than the canvas size. Follow G2 and G7; do not claim checks passed without executing them.

## Dependencies and decision gate

Prerequisites: 9.11, 9.16. Coordinate the title with 9.32 so the game title and the frame count are composed in one place rather than two writers fighting over the same string.
