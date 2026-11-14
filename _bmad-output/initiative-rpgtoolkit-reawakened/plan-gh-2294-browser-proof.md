---
title: 'Fix PR 2288 navigation and autosave proof flakes'
type: 'bugfix'
ticket: ''
created: '2026-11-13'
status: 'built'
baseline_revision: '067b79b2ec9ce3b2dbfa020fdeb0aec2ed44db65'
route: 'oneshot'
route_source: 'auto'
risk: 'low'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** PR 2288 has two independent test failures: navigation tests leaked user layout storage, and the real VS Code web proof timed out clicking an autosave-cleanup command whose palette row became invisible. Cleanup can mask the original autosave assertion failure.

**Approach:** Retain the existing per-test storage isolation fix, verify its restoration scenario, and make the browser proof operate the command palette through its normal keyboard selection rather than waiting for a moving row to become mouse-stable. Verify the autosave setting reaches disk and keep all existing saved-byte and unrelated-document safety assertions. Preserve primary and cleanup errors together. Do not add retries, sleeps, disabled tests, production test hooks, or weaker save assertions.

</frozen-after-approval>

## Implementation Notes

Small, test-only repair implemented directly. Relevant contracts: ADR 0022 D7.1 (layout), D14.1 (real VS Code autosave measurement). `web-proof.ts` drives lifecycle and palette requests; `lifecycle.ts` already combines primary and cleanup errors, with consumer-visible failure coverage in `test/lifecycle.test.ts`. Navigation tests already give each project its own storage and reuse it within the restoration scenario. The change must be verified in the real workbench for both hot-exit choices, not only in a mocked page.

- Reused `combineProofErrors` rather than adding a second error convention. Autosave enable and disable are both inside protected cleanup handling, and persisted workspace settings acknowledge command completion.
- Verification on Node 24.21.0: build, extension bundle, targeted TypeScript and ESLint pass. Combined editor UI/VS Code harness tests: 175 passed, no skips (6.52 s overall). Real VS Code web proof: both cancel and keep choices passed (57.91 s including harness checks and a cold workbench download). All original persisted-game-byte assertions remain.
- Negative control: removing per-test user storage reproduces the original Game-panel failure with persisted `visible:false` (exit 1, one failure). Restored storage isolation afterwards.
- Browser negative control: a deliberately wrong expected game payload and an incorrect cleanup command fail the real workbench proof with one `AggregateError` containing both the original autosave assertion and `Expected: \"off\", Received: \"afterDelay\"` (exit 1). Both mutations restored afterwards.

## Plan Change Log

## Review Triage Log

- Independent quick review (current Codex model): no findings. Other review lenses skipped for this small test-only change; no runtime or public API behavior changed.

## Verification

- Node 24.21.0; `pnpm build` and `pnpm --dir extensions/editor build` prepare the shipped adapter.
- `node --test packages/editor-ui/test/*.test.ts tools/editor-vscode-test/test/*.test.ts`: navigation and shared proof tests pass together.
- `pnpm --dir tools/editor-vscode-test proof -- --extension extensions/editor --workspace <temporary authored example workspace> --game example.gam`: both cancel and keep choices pass with actual saved bytes and autosave cleanup verified.
- Targeted TypeScript and ESLint checks for changed proof files.
