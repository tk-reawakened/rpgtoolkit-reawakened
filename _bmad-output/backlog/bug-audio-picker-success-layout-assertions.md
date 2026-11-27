---
id: 43
type: bug
title: "Audio picker tests expect the old success result when integrating native skins"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3618"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3618"
refined: true
hitl: false
risk: low
severity: P2
---

# Audio picker tests expect the old success result when integrating native skins

## Reproduction

Integrate `main` at `39e8b826966efd2ca67bcebc654a85f9aaf15a58` into #3520 at `0dfb222389f381d264867844e7941fff23029219`. Run `node --test packages/editor-model/test/asset-picker.test.ts tools/editor-vscode-test/test/navigation-vscode.test.ts` after the build. Three tests expect an audio pick to return only `chosen` and `reference`; the native skin picker contract also returns `layout` on success.

## Acceptance Criteria

1. Header-valid `battle.mp3` remains selectable as WAV under its existing name and the test still checks that its bytes are unchanged.
2. The model and both VS Code host tests assert the full successful reply, including the project layout. VS Code Open support and refusal are still checked.
3. The two focused files pass without changing picker behavior. Verify the integration in #3520's required GitHub checks.
