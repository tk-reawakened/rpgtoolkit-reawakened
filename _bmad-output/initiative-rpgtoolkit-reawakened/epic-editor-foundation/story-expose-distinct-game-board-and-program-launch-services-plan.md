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
- The owner's fresh-state board-test clarification is carried in the docs-first commit from [#2298](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/2298) and the normative [board-test startup contract](../../../docs/spec/engine/main-loop-and-startup.md#reawakened-board-test-startup). Browser and VS Code web proofs now launch that board with an ordered party and explicit position/seed, observe a nonempty state hash, and prove the saved startup program does not run. The run snapshot records the board, party, position and seed; no save-state bytes are injected. The open headless fixture tickets #720/#721 are not prerequisites for this path.
- `TKR_VSCODE_LAUNCH_PROOF=1 node tools/editor-vscode-test/run.mjs --extension extensions/editor --workspace docs/spec/examples/game --game Main/example.gam` drives the real VS Code web workbench: it dirties a `.gam`, invokes Run Game, checks exact saved bytes and observes a live player on `village.brd`. `TKR_VSCODE_GUARD_PROOF=1` uses the same workbench with a failing filesystem provider and a paused program read: failed save leaves the original bytes intact and refuses launch; a separately saved edit during preparation also refuses launch, with no player frame.
- The launcher captures clean document snapshot identities after saving. The memory, browser and VS Code hosts recheck those identities after the file walk; the browser and VS Code hosts check again at the player handoff before sending bytes. The Chromium proof edits during the handoff, while the VS Code guard proof edits during a paused program read; neither starts the stale run. The check covers editor-owned documents, not atomicity against unrelated external file writes during the project walk.
- Verification after the board-test addition: `pnpm build`; targeted platform-services, editor-ui and editor-model tests (23 passed, under 0.6 s); browser board launch proof; VS Code web board launch proof; VS Code web failed-save and concurrent-edit refusal proof. The browser proof uses `tools/browser/tests/editor-web-host.spec.ts`; the VS Code proof is `TKR_VSCODE_BOARD_PROOF=1 node tools/editor-vscode-test/run.mjs --extension extensions/editor --workspace docs/spec/examples/game --game Main/example.gam`.
