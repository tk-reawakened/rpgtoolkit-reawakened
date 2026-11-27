---
id: 37
type: bug
title: "Visual fixture board bounds ignore the test overlay"
parent: none
covers: []
after: []
tracker_id: "#3608"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3608"
assignee: ""
refined: false
hitl: false
risk: medium
severity: P2
---

# Visual fixture board bounds ignore the test overlay

## Description

The VS Code Visual fixtures view resolves board bounds from the spec folder and its ancestors before the workspace root. The saved-test runner instead resolves project-relative fixture files and gives the case-insensitive `.tkr-tests/` overlay precedence. With same-named project and overlay boards, the view can show smaller project bounds and reject a fixture start that is valid in the overlay selected by the runner.

## Reproduction

1. Check out PR #3534 at `f5927d62173c97cecad61065159df6f9e865267e`.
2. Use `Prg/example.spec.prg` with both `Boards/wall.brd` and `.tkr-tests/Boards/wall.brd`; make the project board smaller than the overlay board.
3. Open Visual fixtures and enter a start point valid only on the overlay board.
4. Actual: the editor uses project-board bounds and rejects the start; the saved-test runner selects the overlay board.
5. Expected: editor bounds use the same overlay-first fixture-world resolution as the runner.

## Cause

Board path selection and binary decoding live in the VS Code host. That code searches spec-relative directories instead of using the runner's project-relative, overlay-first fixture-world policy.

## Acceptance Criteria

1. With duplicate project and overlay board paths, Visual fixtures uses the overlay board's bounds and accepts valid overlay start positions, matching the saved-test runner.
2. Board selection and coordinate interpretation live in shared editor code; VS Code supplies filesystem access and transports the result only.
3. A focused regression covers case-insensitive overlay selection and project fallback; the fix does not add a host-to-core graph edge or weaken graph policy.

## References

- overlay contract — `docs/spec/engine/rpgcode-tooling.md#tool-5-creator-tests-overlay`
- shared resolver — `packages/script-spec/src/fixture-world.ts` and `packages/editor-ui/src/visual-fixture-board.ts`
- host boundary — `packages/host-vscode/src/visual-fixtures.ts`
- originating PR and CI report — #3534, run 45894345674, job 140167896008

## Notes

- The CI graph report exposed a direct core import, but adding a dependency edge would have hidden the editor/runner policy mismatch. The fix moves board resolution and decoding to editor-ui and removes the host's core import.

