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
- Browser and VS Code web can run a saved Toolkit 3 program in a board-backed isolated `SceneInit` using the declared font, size, window image, party and position. The real-host proofs observe the program's text, font size, window-image blit, player position and runtime state hash. The VS Code palette command uses the project-scoped run service; its explicit-argument route was exercised by the proof, not the interactive pickers.
- `SceneInit` requires a board, has no game identity and its script services have no program loader (`engine.ts:1623–1625`): boardless fixtures, saved-game operations and include/file-program transfer semantics are not established. Toolkit 2 program tests are explicitly refused. The setup is prepended in memory, never written to the creator's project.
- The owner's fresh-state board-test clarification is carried as the prerequisite docs commit from [#2298](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/2298); board-test execution and its resulting snapshot hash remain unimplemented. The open headless fixture tickets #720/#721 are not established prerequisites for the board-backed program path.
- `TKR_VSCODE_LAUNCH_PROOF=1 node tools/editor-vscode-test/run.mjs --extension extensions/editor --workspace docs/spec/examples/game --game Main/example.gam` drives the real VS Code web workbench: it dirties a `.gam`, invokes Run Game, checks exact saved bytes and observes a live player on `village.brd`. VS Code failed-save and concurrent-edit guards still need independent real-host proofs.
- The launcher captures clean document snapshot identities after saving. The memory and browser hosts recheck those identities after the file walk; the browser host checks again at the player handshake before sending bytes. A deterministic test saves a new revision during the file walk and the Chromium proof edits during the handshake; neither starts the stale run. The check covers editor-owned documents, not atomicity against unrelated external file writes during the project walk.
