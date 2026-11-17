---
type: feature
title: "Board properties links and player start"
ticket: 3
status: built
created: 2026-11-16
baseline_revision: 684f4e01b5e9aa13cbba61a969820d717c2377f1
route: full
route_source: auto
risk: high
review: thorough
review_source: auto
context:
  - docs/guardrails.md
  - CONTRIBUTING.md
  - docs/spec/formats/board.md
  - docs/adr/0022-shared-editor-authoring-contracts.md
---

# Board properties links and player start

<frozen-after-approval reason="Owner delegated recommendations, implementation, local verification and reviewed PR merges on 2026-11-16">

## Intent

Complete T-27/T-29 in the shared board editor: edit board settings, follow linked boards/programs and return, set the board's player-start marker, and explicitly make this the game's initial board. Keep the complete acceptance of #1714. Its historical missing-program-provider blocker is resolved by merged #1705; do not build another program editor.

## Boundaries & Constraints

Use the existing binary BoardDocument, shared editor UI, workspace visits and main-document authority. Host packages supply services/chrome, not feature forms. Preserve same-version bytes, untouched values, objects, slot indices and residue. Dimensions/coordinate system remain read-only. Use existing board geometry for tile snapping, including both isometric systems and the pixel-coordinate flag. The board owns stored start pixels/layer; the main file owns `initBoard`. An explicit main edit is not a cross-document atomic save.

No new renderer, navigation stack, program editor or hot reload. No legacy GPL source. Browser/editor behavior need not obey engine-only scheduling/determinism restrictions. Do not promote speculative malicious-folder races into blockers. Track genuine defects as issues; log non-blocking edge cases separately without expanding this story.

## I/O & Edge-Case Matrix

| Scenario | Expected behavior |
|---|---|
| Edit supported board settings, save and reopen | All edits persist; untouched fields, objects, version and opaque data survive |
| Invalid or unrepresentable value, read-only board, failed save | Explain rejection; retain data/draft; no silent coercion/upgrade |
| Open board/program link, enter program or thread; return | Correct file/provider; origin board and selection restored |
| Inline program or missing linked file | Preserve stored text and explain why file navigation cannot proceed |
| Set start using canvas or keyboard/numeric route | Coordinate-aware snapping, correct pixel storage and layer; cross with layer label after reopen |
| Set as initial board | Explicit confirmation edits only the owning main document's `initBoard`; cancellation/unavailable owner changes nothing |
| Start display preference | Respect initial-board-only versus every-board without changing either document |
| Immediate host save after accepted edit | Pending acknowledgement settles before saving, including the VS Code bridge |

</frozen-after-approval>

## Code Map

- `packages/editor-model/src/board-document.ts`: currently tile-only commands/snapshot. Extend plain fields and validated property/start commands over the existing Board codec; reuse writer/read-back exactness checks. Core Board includes links, threads, constants, titles, properties and start already.
- `packages/editor-model/src/main-document.ts`, `game-settings.ts`: `apply-settings` and `settings.initBoard` already own startup-board changes. Reuse, never duplicate.
- `packages/editor-ui/src/board-view.tsx`, `board-canvas.tsx`, `mount.ts`: shared board canvas/view and pending-edits mount. A focused `board-properties-view.tsx` may hold the form. Keep the current compact board toolbar and focused Save/commands.
- `editor-model/src/board-editor.ts` and board geometry helpers: existing cell/pixel mapping and selection; reuse for marker/snapping.
- `editor-model/src/preferences.ts`: `board.startLocationDisplay` already defines initial-only/every-board.
- `editor-ui/src/character-authoring-view.tsx`: native-control and picker patterns; `mount.ts` carries `navigation.pickAsset`. Board-specific link/initial-owner services should use existing workspace visits in host-web/host-vscode, not a new stack.
- `packages/editor-model/src/kinds.ts`, `editor-ui/src/program-view.tsx`, host-web/host-vscode: program kind/provider is now implemented. VS Code uses native text ownership; browser uses existing Monaco.
- Tests: existing board model/view/canvas and host adapter tests; `tools/browser/tests/` OPFS editor fixtures and `tools/editor-vscode-test/` real host proof. Read current scripts before choosing selectors.

## Tasks & Acceptance

- [x] Extend model commands/snapshot for four N/S/E/W links; background image/mode/color/music; threads; constants; layer titles; battle background/skill/enabled; disable saving; enter program; ambient RGB; stored start pixels/layer. Do not expose dimensions for mutation.
- [x] Add labeled native property/list controls, linked-file Open actions and preserved-origin return. Set-start pointer and keyboard/numeric routes, visible cross/layer, preference, explicit initial-board action and owner disclosure.
- [x] Wire both hosts through existing project ownership, navigation, pending edits and main save/undo, with no feature UI duplicated in hosts.
- [x] Prove persistence/untouched-data, invalid/save-failure and coordinate boundaries in focused tests. New ordinary tests individually under one second; behavior-removing perturbations must fail assertions, then restore green.
- [x] Real browser and VS Code: run the parent-owned proofs for edit/save/reopen settings/start, linked board/program/thread return and initial-board edit/cancel.
- [x] Update changelog and append implementation evidence here. Independent review; fix practical blockers, issue-track non-blocking findings. Parent runs local project gates before push/PR/merge.

Given a supported authored board with nondefault properties and objects, when supported fields and start are edited/saved/reopened in both hosts, then changes persist with every unrelated field intact. Given a link or thread, opening and returning uses the existing provider and restores the board selection. Given confirmed initial-board action, only the owning main startup setting changes and both documents reopen correctly.

## Implementation Notes

Worktree `/private/tmp/tkr-epic12-night`, branch `feat/epic12-night-1714`. Use absolute file paths for edits. Historical expanded plan exists at `7a9310b0`; its missing-provider finding described the old baseline and is superseded, not a current blocker.

The implementation worker owns this story's code/tests/plan/changelog, not unrelated planning PRs. Skip build/lint/tests/formatters mid-flight: parent runs verification after the complete implementation, with worker-proposed commands. Do not commit, push or merge; parent integration owns those operations. Any later selective commit must explicitly bind `commit.draft(repo="/private/tmp/tkr-epic12-night")`.

## Plan Change Log

- 2026-11-16: resumed blocked plan after #1705 closed and program provider was verified in current main. Owner authorizes recommended decisions and continuing automatically. Risk raised to high for cross-host/main-document coordination.
- 2026-11-16 implementation: added undoable model support for board settings/links/threads/constants/layer titles/start with round-trip refusal; shared board-properties controls for settings, navigation and starting-point editing; geometry-based pointer/numeric placement, layered start marker and initial/every preference; web and VS Code navigation/main-file ownership wiring, including VS Code's Return to board command. Fixed one-based layer-title rendering without consuming slot 0 (#2994). Added editor-model board persistence/rejection coverage and a focused layer-title view assertion. Changelog updated. Parent owns verification and host proofs; no builds, tests, or formatters were run.
- Parent verification below supersedes the initial worker handoff. Implementation is committed and built; #1714 remains open until the reviewed delivery PR merges.

## Review Triage Log

- Fixed practical findings in this delivery: #2994 (one-based titles), #2998 (numeric bounds), #2999 (resolved initial-board identity), #3000 (preview refresh), #3001 (undo/draft ownership), #3002 (browser selection on Return), #3003 (picker validator regression), #3004 (raw bitmap source visits), #3005 (native reopening of a closed origin), #3008 (2D stored base point), #3011 (toolbar overlap), #3012 (paced, identity-specific host proof), #3015 (refuse source visits without a registered editor).
- #3006, links in multi-game workspaces whose owning main is not open, is a nonblocking backlog edge under the owner's explicit triage direction. #3007, immediate cosmetic marker refresh after another main editor changes startup settings, is also backlog; document edits/save ownership remain correct.
- `ReviewBoardSurface` and `ReviewBoardHosts` independently inspected the fixes and reported no remaining practical blocker within the scoped closure review. They ran no checks; runtime evidence below was produced by the parent.

## Verification

Focused model/UI/host tests and paced real-host proofs first. Then `pnpm typecheck`, `pnpm lint`, full strict suite with fixtures, graph/licence/provenance/catalogue/command docs/toolchain and golden/closing/Bun checks appropriate to changed paths; browser suite and VS Code story proof. Record exact commands/results and any limits before pushing. Do not claim a green check from a worker summary.

### Model evidence, 2026-11-16

- Node 24.21.0: `node --test packages/editor-model/test/board-document.test.ts packages/editor-model/test/board-properties.test.ts` passed 12/12 after restoration (248 ms total; new cases each under 4 ms).
- `board-owned settings` negative proof: temporarily discarded the command's links in `applyCommand`; the focused test failed its accepted-edit assertion. Restored the assignment; green.
- `board settings reject an unrepresentable` negative proof: temporarily bypassed property validation; the focused test failed `true !== false` at the refusal assertion. Restored validation; green.
- `board settings reject lossy` negative proof: temporarily disabled requested-versus-read-back equality; the focused test failed its exact-value refusal assertion. Restored equality; green.
- `a refused properties save` negative proof: temporarily returned success from `BinaryDocument.#failWrite`; the focused test failed `ok(!failed.ok)`. Restored failure propagation; green. The test follows the existing conservative dirty-after-failed-write contract, including after undo.
- Negative commands used `node --test --test-name-pattern='<name above>' <corresponding test file>`; failures were behavioral assertions, not compile errors. All perturbations were removed.
- First full build exposed interrupted UI imports/scope and host protocol integration defects. These were repaired before push; subsequent typecheck, focused UI/host checks, both real surfaces and independent review passed as recorded below.

### Shared UI and actual hosts, 2026-11-17

- `pnpm typecheck` passed, including all package/test/browser TypeScript projects. Contract fixtures were migrated to the required start-display preference and main-owner bridge operations.
- `pnpm build && node --test packages/editor-ui/test/board-view.test.ts packages/editor-ui/test/board-properties-view.test.ts` passed 26/26 after restoring all perturbations (833 ms total; new cases each under 19 ms except the initial isolated setup, still below 1 second). Mounted tests now settle in-memory work through bounded event-loop turns rather than a wall-clock sleep.
- New UI negative proofs, each with a successful rebuild and focused `--test-name-pattern`: removing `cellOnBoard` failed the unchanged/clean assertion; serializing numeric draft coordinates during unrelated Apply failed the undo-preservation assertion; discarding the dirty-draft guard lost `theme.mid`; dropping ambient preview invalidation failed the repaint completion assertion; raw path comparison failed actual marker drawing; using layer slot 0 failed the named-layer assertion. Every change was restored and the complete file pair passed.
- History-preview negative proof: returning success for `set-initial-board` failed the specific refusal assertion. Restoring the refusal passed all 35 native-host unit tests.
- Actual browser: `PLAYWRIGHT_PORT=<free port> pnpm exec playwright test tools/browser/tests/editor-board-properties.spec.ts --workers=1` passed. It uses OPFS and the shipped editor, checks saved bytes and exact active tabs, follows board/program/thread links, preserves selection on Return, reopens a closed origin, tests keyboard and trusted canvas placement, and confirms/cancels the separately owned main edit.
- Actual packaged VS Code: build host/editor and the companion RPGCode extension (`npm --prefix extensions/rpgcode ci --ignore-scripts --no-audit --no-fund`; `node extensions/rpgcode/build.mjs`), then `TKR_VSCODE_BOARD_PROPERTIES_PROOF=1 pnpm --dir tools/editor-vscode-test proof -- --extension extensions/editor --workspace docs/spec/examples/game --game Main/example.gam`. Passed with the same authored files/actions and persisted-byte assertions, using native program tabs and the contributed Return command.
- Both real-host proofs were then independently shown red after the shared form deliberately discarded edited links: both failed the saved N/S/E/W equality assertion with four empty references. Rebuilt restored bundles and reran: both passed, following successful typecheck and focused UI/web/adapter tests. Neither negative result was a compiler/setup failure.
- `pnpm lint`, `pnpm graph`, `pnpm licence`, `pnpm provenance`, `pnpm catalogue:check` and `pnpm command-docs:check` passed. Generated Help release notes were refreshed from the changelog; `pnpm editor-ui-toolchain:check` passed.
- Full local `pnpm test:strict` passed 5,119/5,119 with no skipped tests. The focused shell/board/navigation integration files passed 41/41. Tile tests now select the tile control explicitly; stale release-note prose and mounted-pane-count assertions were removed rather than re-pinned. Native unknown-kind refusal is guarded by behavior assertions, not diagnostic wording.
- `pnpm golden` and `pnpm golden:bun` compared all 24 scenes; Node and Bun closing each matched all 8 legacy-game baselines (2 clean boots, 6 expected located failures). No golden was changed.
- `pnpm bmad:tickets:test` passed 34 ticket tests and 88 issue-preflight tests, followed by successful store validation. Full host receipts follow below; PR/merge metadata remains pending.

### Full integration receipts, 2026-11-17

- The complete browser run exercised 131 cases: 124 passed initially. The seven failures exposed Run-control flex shrinking under Return (#3011), plus stale disconnected-view and unscoped hidden-pane selectors. The Run group now keeps its natural width; assertions target the selected visible editor without changing their pixel, saved-byte, launch or source-location oracles. After rebuilding, `pnpm exec playwright test --last-failed --workers=1` passed all seven. The existing real New run setup and Stop actions verify the layout repair.
- The normal packaged VS Code sequence exposed a fixture-layout blocker (#3018): root-folder packaging scenarios were given the surrounding Toolkit tree rather than loose-folder asset contents. The harness now resolves and copies the declared asset directory, keeps the original main bytes and real preflight, and creates the late board-properties fixtures' parent directories.
- Its board-frame resolver also requires the browser's document focus, rather than selecting an occluded retained webview merely because its inner controls report visible (#3012).
- After these repairs, the complete `pnpm --dir tools/editor-vscode-test proof -- --extension extensions/editor --workspace docs/spec/examples/game --game Main/example.gam` passed (203.60 seconds): 13 bootstrap tests, animation/recovery and sprite proofs, settings/board/art/bitmap with both cancel and keep choices, New project/native program history, and the new board-properties/linked-return/main-ownership flow. No assertion or scenario was skipped.
- Integrated `origin/main` at `399ad2bcd`, including the merged planning cutover and foundation acceptance work. Incoming main changed no production editor implementation. On the combined tree, full `pnpm typecheck`, all 243 host/graph contract tests, store validation (551 trackers, 438 plans, 35 folders), Help/toolchain checks and the changed native harness lint passed.
