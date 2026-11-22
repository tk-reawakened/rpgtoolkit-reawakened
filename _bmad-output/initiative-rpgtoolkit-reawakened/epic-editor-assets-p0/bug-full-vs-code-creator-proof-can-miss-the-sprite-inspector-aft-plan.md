---
title: 'Full VS Code creator proof can miss the sprite inspector after earlier lanes'
type: bugfix
ticket: 18
created: '2026-11-22'
status: done
baseline_revision: '95c031c998abb661abc6f56d077105e2c6f64b5a'
route: oneshot
route_source: auto
risk: low
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The full VS Code Web creator sequence once failed after its earlier lanes: the connected-authoring pass timed out clicking **Choose activation program** in the visible sprite inspector (#3192), while the focused pass on the same revision succeeded. A later `main` run failed the same test further on, where a saved program's bytes were still the old text after the save reported success.

**Approach:** Make a failure of this proof say what was on screen, so the next occurrence is diagnosable without re-running: name each board step and report the board mode, selected slot, inspector controls and open tabs when it fails, and report the program editor's own save status, surface text and tabs when a saved program's bytes do not match. Then run the whole sequence on the current revision to show the sprite inspector and the linked-program and run assertions execute.

## Boundaries & Constraints

**Always:** Keep every existing assertion, timeout and poll window as it is. Keep the proof going through the real browser, the real editor and real files.

**Never:** Replace the full sequence with the focused run, add a fixed sleep, raise a timeout, retry a failed step, or skip any creator coverage.

| Scenario | Expected behavior |
|---|---|
| Any board step fails | The thrown error names the step and includes the board mode, stored slot, visible inspector controls and tabs. |
| A saved program's bytes do not match | The thrown error names the file and includes the program editor's save status, its surface text and the tabs. |
| The full sequence runs on the current revision | It passes both lanes, including the sprite inspector's Choose activation program, the linked-program assertions and the saved-run assertions. |

</frozen-after-approval>

## Code Map

- `tools/editor-vscode-test/connected-authoring-proof.ts` shares one journey between the browser proof (`tools/browser/tests/editor-connected-authoring.spec.ts`) and the packaged VS Code Web proof (`tools/editor-vscode-test/web-proof.ts` → `runVscodeArtProof`'s neighbours). It already has `boardState`, `boardStep` and `programState` helpers (this change) used around the sprite inspector and every program write.
- `tools/browser/tests/editor-connected-authoring.spec.ts` supplies the browser host: `writeProgram` opens the program, replaces the text, undoes, redoes and clicks **Save active editor**.
- `packages/editor-model/src/binary-document.ts` fixes a save's bytes synchronously when `save()` is called (`save()` → `const bytes = encoded.value`), so a stale file means the document never held the surface text.
- `packages/editor-ui/src/program-view.tsx` reports "All changes saved" from `snapshot.dirty` and the buffered-typing flag, and resyncs the surface when a typing edit is rejected.

## Tasks & Acceptance

**Execution:**
- [x] `tools/editor-vscode-test/connected-authoring-proof.ts` — wrap the sprite-inspector steps in `boardStep`, replace the three `writeProgram` + byte-poll pairs with the capturing local `writeProgram`, and add `boardState`, `boardStep` and `programState`.
- [x] `packages/editor-ui/test/program-view.test.ts` — keep the two Save-path tests that click Save with typing still buffered, and after a redo, without a settle in between.

**Acceptance criteria:**
- Given a board step that fails, when the proof throws, then the message names the step and carries the board mode, stored slot, inspector controls and tabs.
- Given a saved program whose bytes do not match, when the poll exhausts, then the message names the file and carries the editor's save status, surface text and tabs.
- Given the current revision, when the full sequence runs, then both lanes pass with the sprite inspector's Choose activation program, the linked-program assertions and the saved-run assertions executed.

## Implementation Notes

The reported symptom did not reproduce on the current revision. The full sequence ran three times against the example game: two passed every lane including the sprite inspector's Choose activation program, the linked-program assertions and the saved-run assertions; the third ended with "Target page, context or browser has been closed", a browser-process failure after the board-objects pass started, not an assertion. The example game was left unchanged each time.

The repeated failures in CI are a different step of the same test: `connected-authoring-proof.ts:358` in `browser (editor-web)`, five times between 2026-11-20 and 2026-11-21. Its artifact shows the program editor holding the new text with "All changes saved" while the file held the old bytes. That divergence is filed as #3346 and is not claimed fixed here; six plain local repeats pass, so there is no local reproducer yet.

Both capture paths were proved by perturbation: renaming the Choose activation program button produced `Choosing the activation program failed. Board state: {"mode":"sprites","slot":"0","controls":[...],"tabs":[...]}`, and expecting different program bytes produced `... never held the saved text. Editor state: {"status":"All changes saved",...,"tabs":[...]}`. Both perturbations were reverted.

## Verification

**Results (Node 24.21.0):** `tsc -b` 0; scoped eslint 0; `packages/editor-ui/test/program-view.test.ts` 46/46; `editor-connected-authoring.spec.ts` 2/2; full `run.mjs` on the example game exit 0 with cancel and keep lanes and "connected authoring, saved-source identity and immutable run-snapshot proof passed"; `git status --short docs/spec/examples/game` empty.

**Commands:**
- `node tools/editor-vscode-test/run.mjs --extension extensions/editor --workspace docs/spec/examples/game --game Main/example.gam` -- expected: cancel and keep lanes pass, including "connected authoring ... proof passed", and `git status --short docs/spec/examples/game` stays empty.
- `TKR_BROWSER_SUITE=editor-web pnpm exec playwright test tools/browser/tests/editor-connected-authoring.spec.ts --workers=1` -- expected: both tests pass.
- `node --test packages/editor-ui/test/program-view.test.ts` -- expected: all pass.
