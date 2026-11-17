---
id: 4
type: bug
title: "History preview leaves board and bitmap RPCs pending"
parent: none
covers: []
after: []
tracker_id: "#2857"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2857"
assignee: ""
refined: false
hitl: false
risk: medium
severity: P2
---

# History preview leaves board and bitmap RPCs pending

## Description

The native History preview initializes the production shared editor UI but answers only its `ready` request. The shared board renderer waits for correlated `preview-result` responses, and supported editor kinds issue browser/project asset reads. Those requests receive no result: board previews remain at “Drawing the board…” and other read-backed views may remain incomplete. The existing `.gam` history proof does not exercise these non-game request paths.

## Reproduction

1. Open a project with a saved `.brd` revision in the VS Code workbench.
2. Run `RPG Toolkit: Document history` and select the board version.
3. Observe the actual History preview tab.

## Acceptance Criteria

1. The history adapter answers every correlated shared-editor request with its typed result, including board preview and asset reads; unavailable resources settle as visible errors rather than indefinite loading.
2. Preview composition uses the isolated saved-version model plus read-only project/asset services, never a writable live custom document.
3. The preview explicitly refuses edits and saves.
4. Actual native workbench proof polls for the visible writable origin and read-only preview to mount before inspecting them, then verifies a rendered semantic canvas or visible settled error, the read-only state, and unchanged persisted file bytes. A normal asynchronous webview initialization delay must not make the guard fail early.

## References

- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2857
- source — `packages/host-vscode/src/document-bridge.ts`, shared editor RPC message contract
- source — `packages/host-vscode/src/extension.ts`, native read-only history adapter
- proof — `tools/editor-vscode-test/web-proof.ts`, native History UI proof
