---
type: feature
title: "Expose distinct game board and program launch services"
ticket: 8
status: in-progress
---

## Scope

Adapt the existing web runner and fixture seam through platform services, with explicit board, position, party and program preferences for font, size, window graphic and board; report stalls and unpredictable references where provider can expose them.

## Acceptance

Run game from startup differs from test board or program; launch snapshots identify revision and do not silently hot reload; missing capabilities and unresolved assets explain refusal.

## Verification

A real game launch and a fixture-backed program launch run in both hosts, a board launch identifies its state, and failed saves prevent launching stale revisions.

## Decisions and prerequisites

Contract 11.1 must rule how the documented legacy sys_test.prg behavior maps to safe test inputs and host execution; do not equate preview with execution.

Prerequisites: 11.3, 11.4, 9.3, 9.16.

## Implementation evidence and remaining acceptance

- A browser folder project launches saved bytes in the existing live player. `tools/browser/tests/editor-web-host.spec.ts` opens an authored game, edits its title, launches, advances through startup, observes a player on `village.brd` and a nonempty engine state hash, and stops the player. The proof ran after merging the 11.5 base. This does not establish VS Code launch or a saved-game persistence round trip.
- `packages/core/src/engine/engine.ts` `SceneInit` is a board scene without the main-file startup. Its `stepScene` explicitly states that scene-only renderers do not enter a playable board; `BootInit` has no board/position/party override. A real explicit-state board launch needs a specified playable-board initialization contract before this story can implement it without presenting a preview as gameplay. ADR 0022 D8 requires explicit board, start position, party and state but does not define their engine initialization.
- The VS Code extension currently packages only its editor webview (`extensions/editor/build.mjs`); the player assumes browser-root asset, worker and worklet URLs. A safe route needs a packaged player webview, webview-safe resource URLs and an extension-host message/blob bridge, tested in the real VS Code web host. An external browser has no existing same-origin snapshot transport or host for those files. Neither route is implemented yet.
- Fixture-backed program execution remains with 11.9; the provisional launch inputs need to be validated against its actual runner caller, rather than treated as a settled fixture API.
- The current launcher checks for dirty edits before snapshot preparation, but has no atomic save-to-snapshot barrier: a subsequent edit during the asynchronous file walk can occur before the player starts. This must be resolved and tested before claiming the failed-save/stale-revision acceptance in all races.
