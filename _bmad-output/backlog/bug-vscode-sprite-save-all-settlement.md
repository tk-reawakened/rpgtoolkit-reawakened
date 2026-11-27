---
id: 39
type: bug
title: "VS Code sprite Save All can miss accepted edits"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3606"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3606"
refined: false
hitl: false
risk: medium
severity: P2
---

# VS Code sprite Save All can miss accepted edits

## Description

The required VS Code web proof can time out after native Save All because the sprite's persisted bytes remain identical to the original bytes. The web proof then cannot establish that its earlier sprite and character edits were saved.

## Reproduction

1. Use wrkflw 0.9 with Podman on ARM64 and a 6 GiB VM, image `mcr.microsoft.com/playwright:v1.64.0-noble`, Node 24.21.0, and pnpm 12.10.1.
2. Run the VS Code sprite web proof with the standard fixture workspace and native `workbench.action.files.saveAll` command.
3. Actual: after 30 seconds, `tools/editor-vscode-test/web-proof.ts:1652` fails because the persisted bytes are still equal to the original bytes. This reproduces before the separate board-upgrade proof for #3519.
4. Expected: native Save All waits for every accepted sprite/character edit, then the bytes change and the re-opened document shows the submitted field values.

## Cause Hypothesis

`SpriteView` and `CharacterAuthoringView` registered their pending edit trackers with the host registry in passive `useEffect` callbacks. A native Save All immediately after an accepted DOM event can enter host settlement before that registration runs, so settlement misses a queue that already owns accepted work. Registering with `useLayoutEffect` makes each tracker available before paint. The behavior regression and focused VS Code proof passed after this change, supporting this explanation.

## Acceptance Criteria

1. **Native Save All includes immediately accepted edits**
   **Given** sprite and character edits have been accepted in the editor
   **When** native VS Code Save All is invoked immediately
   **Then** settlement waits for their acknowledgements, persisted bytes differ from the original bytes, and reopening shows the submitted values.
2. **The regression is behavior-based**
   **Given** the character editor is mounted without flushing passive effects and DOM events submit deferred sprite and character edits
   **When** `pendingEdits.settle()` runs
   **Then** settlement remains pending until both document applications resolve, then completes. The test must not assert registration call counts.
3. **The persistence guard remains strict**
   **Given** the focused sprite proof runs
   **When** it checks post-Save-All persistence
   **Then** the existing byte-difference and re-opened-field assertions remain intact; no retry or timeout increase hides the failure.
4. **The board-upgrade issue remains separately tracked**
   **Given** #3519 has a similar settlement refusal under its own board-upgrade proof
   **When** this sprite fix is reviewed
   **Then** do not claim #3519 is fixed without its own verified diagnosis and proof.

## Verification

- Focused Podman VS Code proof passed: wrkflw run `20261127-045134559-c3256a` (176.8s), using the Playwright 1.64.0 Noble image. The focused persisted-byte assertion was unchanged. wrkflw skipped `actions/setup-node@v7` because the image already contains Node 24.21.0 and reports that `--ipc=host` is unsupported.
- Local focused UI checks passed: `pnpm exec tsc -b packages/editor-ui && pnpm exec tsc -p packages/editor-ui/tsconfig.test.json && node --test packages/editor-ui/test/sprite-view.test.ts packages/editor-ui/test/character-authoring-view.test.ts` (36/36 tests).

## References

- GitHub bug — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3606
- Related but separate board-upgrade bug — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3519
- Affected pull request — https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3582
- Reproduction base — `475b9bba0f806fa5a3c2c8976ae06ced8b5fb8e5`

## Notes

- The focused fix changed pending tracker registration timing only; it does not alter document-application acknowledgement or persistence semantics.
- Main independently reproduced the #3519 settlement refusal on pristine #3582 (wrkflw run `20261127-050818807-c52735`). That board diagnosis is owned separately; this ticket does not assert that the sprite fix resolves it.
