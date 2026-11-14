---
type: feature
title: "Expose distinct game board and program launch services"
ticket: 8
status: built
baseline_revision: df4b811ae6d44f07e5f15f680e9b628e5a9643e0
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

## Completion pass — 2026-11-14

Complete #1706 on PR #2290 without discarding its existing game, program, board, save-refusal or stale-revision behavior. The current main integration baseline is `597d7c3e4f0939229b19775538c2efa13de59c20`; the feature baseline above already contains board-launch commit `8a60d02c6eb5750b1e7d22366503200adb48b338`.

### Tasks and ownership

- Reconcile the current main merge, preserving shared editor/Monaco/board-editor surfaces and the extracted native-command completion fixes from #2426. Browser integration owns `packages/editor-ui/src/index.ts`, `packages/editor-ui/src/shell.tsx`, `packages/host-web/src/workbench.ts`, `tools/browser/editor-web/{index.html,main.tsx}`, `tools/browser/tests/editor-web-host.spec.ts` and `tools/editor-vscode-test/test/web-shell-race.test.ts`. VS Code integration owns `extensions/editor/{build.mjs,package.json}`, `tools/editor-vscode-test/{run.mjs,web-proof.ts,probe-extension/extension.js,probe-extension/package.json}`. Integration workers must not commit or run checks; the integration owner handles shared staging and verification.
- Apply the owner-approved docs-only refinement from #2312 before implementing its semantics: 1–5 distinct ordered `.tem` assets, stored starting values, first member selected, and coordinate units determined by the board. Preserve #2298's fresh-default-state rule, without save-state injection.
- Audit and complete shared launch preparation, runtime initialization and run-snapshot output. Preserve input fingerprints as input identities; expose the observed runtime result hash in the recorded snapshot without claiming an unobserved result. Migrate every producer, transport, consumer and fixture affected by any contract change.
- Verify game, program and fresh board launches in both actual hosts; prove failed saves and concurrent saved edits refuse stale launches. Cover invalid party/position boundaries, first-member selection, stored starting values, fresh-state isolation and snapshot hash reporting. Use existing authored example assets, not whole-game commits. New unit cases must each finish under one second.
- Run the affected build/type/lint checks, targeted unit tests and actual-browser/VS Code proofs after integration. Obtain independent adversarial review, address and track defects, push the existing PR branch without force, and require green CI before marking the PR ready. Do not merge an incomplete feature or remove its acceptance requirements.

### Completion acceptance

- Given a saved game, both hosts launch its configured startup and identify the frozen revision.
- Given a saved Toolkit 3 program and a valid board-backed fixture, both hosts execute the target program with the declared fixture and record the observed runtime hash.
- Given a board, explicit start position, ordered valid party and seed, both hosts enter that board from fresh defaults, select the first party member using stored starting values, do not run the saved main startup, and record the resulting hash alongside the launch inputs.
- Given invalid or unavailable inputs, a failed save, or a changed saved revision during preparation/handoff, the host explains the refusal and never starts a stale player.

### Review triage — 2026-11-14

Independent same-model adversarial review of the full PR diff against main `597d7c3e`. Every finding was accepted, tracked and fixed in this PR; each fix has a test or proof that fails when the fix is removed.

| # | Finding | Issue | Fix | Proof |
|---|---|---|---|---|
| 1 | Run panel lost the running player's handle when hidden; a relaunch orphaned the earlier run | #2646 | `Launcher.current()`/`dispose()` own the latest run; a new run stops the previous; the workbench disposes the launcher | `launch.test.ts` ownership test; `run-view.test.ts` hide/reopen test |
| 2 | Tile starts accepted x/y 0 on boards without flag 4 | #2647 | Required `PrepareRunOptions.startUnit` reads the frozen board via editor-model `boardStartUnit` | `run.test.ts` coordinate-unit test; `launch.test.ts` reader test on committed board bytes |
| 3 | Quit published `ended` without the terminating state hash | #2656 | Terminal status carries the session's final tick, board, diagnostics and hash; a quit before the live loop is handled | native VS Code board and program proofs assert the `RunHandle` hash and its retention after stop |
| 4 | VS Code launch hung when the player failed before `ready` | #2657 | Early terminal failure settles the launch as a refusal and disposes the panel | code review only: the private webview handler has no fast unit seam (residual risk) |
| 5 | Run listed only `Main/*.gam` | #2648 | Recursive main discovery | `run-view.test.ts` main outside `Main/` |
| 6 | VS Code proof compared two player-side hashes, not the recorded service snapshot | #2658 | Probe publishes the returned `RunHandle`; proofs match its hash against the player's live-hash history and check retention after stop | nulling the extension's hash forwarding fails the board proof (`RunHandle hash never matched a player live hash`) |

Review gaps also closed: a five-member ordered party starts, and a missing party member is refused by name (`run.test.ts`).
