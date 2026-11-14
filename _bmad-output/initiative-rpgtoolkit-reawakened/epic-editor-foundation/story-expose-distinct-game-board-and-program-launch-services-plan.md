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

- A browser folder project launches saved bytes in the existing live player. `tools/browser/tests/editor-web-host.spec.ts` opens an authored game, edits its title, launches, advances through startup, observes a player on `village.brd` and a nonempty engine state hash, and stops the player. The proof independently hashes the actual pre-write save bytes, compares size and SHA-256 with the saved slot, closes the player, and reopens the same slot in a new player without writing it again. This does not establish VS Code launch.
- `packages/core/src/engine/engine.ts` `SceneInit` can load a board and an optional program without main-file startup, but `stepScene` explicitly does not enter a playable board and `SceneInit` has no game identity. ADR 0022 D8 requires a board test with explicit board, position, party and state. A board-backed program fixture may be expressible with documented setup commands, but that path has not yet been integrated or proved; boardless fixtures cannot be represented by the current `SceneInit`. The open headless fixture tickets [#720](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/720) and [#721](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/721) are not established prerequisites for the board-backed path.
- A VS Code native Run Game command now prepares saved project bytes and opens a packaged player webview with a webview-safe resource bridge. The real `vscode-test-web` proof is being exercised; until it passes, this route is not claimed as verified. Board and program fixture execution are not connected.
- Fixture-backed program launch in both hosts remains an acceptance criterion of this story. Story 11.9 owns the separate creator-test fixture APIs; the provisional 11.8 launch inputs need validation against a real runner caller rather than being treated as a settled fixture API.
- The launcher captures clean document snapshot identities after saving. The memory and browser hosts recheck those identities after the file walk; the browser host checks again at the player handshake before sending bytes. A deterministic test saves a new revision during the file walk and the Chromium proof edits during the handshake; neither starts the stale run. The check covers editor-owned documents, not atomicity against unrelated external file writes during the project walk.
