---
title: 'Re-enumerate a replaced History preview frame instead of aborting the proof poll'
type: 'bugfix'
ticket: '15'
created: '2026-11-22'
status: 'built'
baseline_revision: 'eccc276c1d127c91b8202c07d8f285f11c49b2d4'
route: 'oneshot'
route_source: 'auto'
risk: 'medium'
review: 'none'
review_source: 'auto'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/docs/guardrails.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `verifyBoardHistoryPreview` enumerated `page.frames()` and then queried each frame. When a preview webview was replaced between enumeration and a locator operation, the query threw `locator.count: Frame was detached` and aborted `browser (editor-vscode)` even though the preview request had received its responses. The proof has a normal timeout diagnostic; a transient frame replacement must not pre-empt it.

**Approach:** Poll frames through one small helper that treats a detached frame, page or execution context as a reason to re-enumerate inside the existing deadline, records what detached, and fails at the deadline with that record. Keep the deadline and the existing diagnostic; never swallow a persistent detachment and never mistake a real query fault for churn.

## Boundaries & Constraints

**Always:** Re-enumerate and poll inside the existing 30 s deadline with the existing bounded backoff. Record each detachment so a deadline failure names what was detached. Accept a preview only after it is fully mounted read-only, and assert the values that were accepted rather than querying a possibly replaced frame again. Keep a non-detachment error fatal at once.

**Never:** Widen the deadline or add a sleep to paper over the race. Swallow a detachment permanently: a frame that never mounts must fail at the deadline with the existing diagnostic. Change the preview's product behaviour or its read-only checks.

</frozen-after-approval>

## Verification

**Test strategy:**
- `tools/editor-vscode-test/test/frame-poll.test.ts` drives `pollPageFrames` with a fake frame source and an injected clock, so the 30 s deadline is proven instantly and deterministically.
- A source that detaches once and then yields the expected frame must pass, recording the detachment.
- A page whose frame list cannot be taken must re-enumerate and then pass.
- A source that detaches forever must fail at the 30 s deadline with the detachment and the last state in the message.
- A non-detachment probe error must fail immediately without consuming retry slices.
- Perturbation: removing the detachment guard makes the once-detaching and page-gone cases fail by throwing the detachment; removing the recorded-diagnostic path makes the forever-detaching case fail without naming the detachment.

**Commands:**
- `node --test tools/editor-vscode-test/test/frame-poll.test.ts`.
- `pnpm --dir tools/editor-vscode-test proof -- --extension extensions/editor --workspace <prepared workspace> --game Main/example.gam`.
- `pnpm bmad:tickets:test -- --validate-store`.

## Implementation Notes

- The helper lives in `tools/editor-vscode-test/frame-poll.ts` and is typed against a minimal frame source, so the unit test does not start a browser.
- `verifyBoardHistoryPreview` probes the full read-only preview (tile value, `readonly` attribute, "Saved version" and "Read only" text, disabled brush) in the poll's accept predicate and asserts the accepted values afterwards.
- The same re-enumerate rule covers `verifyHistoryPreview`, the player and run-handle frame polls, `waitForWritableEditorFrame`, `findBytesPanelFrame`, the wizard frame scan and the frame-name diagnostics; polls that already answer "absent" per query keep that shape.

## Perturbation Check

| Guard reverted | Test that failed |
|---|---|
| Detachment is re-enumerated instead of rethrown | `frame-poll.test.ts`: "a frame that detaches once re-enumerates…" and "a page whose frame list cannot be taken…" |
| The deadline diagnostic records what detached | `frame-poll.test.ts`: "a frame that never mounts fails at the deadline naming what detached, not silently" |
