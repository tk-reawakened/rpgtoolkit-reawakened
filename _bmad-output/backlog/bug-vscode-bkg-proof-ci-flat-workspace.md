---
id: 34
type: bug
title: "VS Code BKG proof lacks nested fixtures in the CI workspace"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "3508"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3508"
refined: false
hitl: false
risk: medium
severity: P1
---

# VS Code BKG proof lacks nested fixtures in the CI workspace

## Description

The VS Code battle-background acceptance proof needs the BKG and linked tile bitmap at the nested `Game/Example` paths it opens, even when its source workspace is the flat layout used by CI.

## Reproduction

1. Make a fresh workspace and copy `docs/spec/examples/game/Game/Example/.` into its root, as `.github/workflows/ci.yml` does.
2. Add `Main/example.gam` and `.vscode/settings.json` as in that workflow.
3. Run `TKR_VSCODE_BATTLE_DATA_PROOF=1 pnpm --dir tools/editor-vscode-test proof -- --extension extensions/editor --workspace <workspace> --game Main/example.gam`.
4. Before the fix, the proof opened `Game/Example/Bkrounds/forest.bkg` and `Game/Example/Bitmap/forest.tbm`, but the flat CI workspace had those assets only at its root; the local staged fixture had hidden the missing files.

## Cause Hypothesis

The proof relied on local staged nested assets instead of creating the nested project files it opens. CI copies the example game's contents into a flat workspace root.

## Acceptance Criteria

1. **The proof supplies the nested battle fixtures**
   **Given** the exact flat workspace prepared by CI
   **When** the VS Code battle-data proof opens the BKG and linked tile bitmap
   **Then** both files exist at their nested `Game/Example` paths from committed fixture bytes
2. **The acceptance proof works with the CI workspace shape**
   **Given** a fresh flat workspace containing the copied game contents, `Main/example.gam`, and `.vscode/settings.json`
   **When** the packaged proof runs with `TKR_VSCODE_BATTLE_DATA_PROOF=1`
   **Then** it opens the BKG and linked TBM, saves all six references, and verifies the serialized BKG bytes
3. **Or: no change is needed, with proof**
   **Given** the exact fresh CI-shaped flat workspace
   **When** the focused proof runs
   **Then** it passes without manually creating `Game/Example/Bkrounds` or `Game/Example/Bitmap`

## Verification

- The proof now seeds the nested BKG and TBM from committed `docs/spec/examples/game/Game/Example` fixtures before opening them.
- Exact flat-workspace run passed: prepared a fresh root by copying `Game/Example/.`, added `Main/example.gam` and `.vscode/settings.json`, then ran `TKR_VSCODE_BATTLE_DATA_PROOF=1 pnpm --dir tools/editor-vscode-test proof -- --extension extensions/editor --workspace <flat-workspace> --game Main/example.gam`.
- Result: 14/14 proof-harness tests passed; the VS Code web proof reported all six links survived Save All and reopen, the TBM opened in the custom editor, PNG/WAV opened natively, and audio audition was unavailable in this host.

## References

- GitHub bug — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3508
- Parent story — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1736
- CI workspace setup — `.github/workflows/ci.yml`, VS Code web editor acceptance proof
- Proof — `tools/editor-vscode-test/web-proof.ts`, battle-data proof

## Notes

- The fix is in the #1736 worktree; its implementation PR is not created yet. Link the PR to this issue when it is opened.
