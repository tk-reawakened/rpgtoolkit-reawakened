---
title: "Close the foundation with cross-host authoring acceptance"
type: feature
ticket: 13
created: 2026-11-16
status: built
baseline_revision: 2eaf991b966cbf528ab47514f20742e70ed40171
review_base_revision: 34714e326dff69ce15392f70ddcf96a7791f4689
route: oneshot
route_source: auto
risk: high
review: quick
review_source: pinned
lenses_ran: [quick]
review_loop_iteration: 4
context:
  - "{project-root}/docs/guardrails.md"
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Foundation authoring proofs exist in separate commands, so there is no single local acceptance run covering project open, exact saves, lifecycle, language services and actual fixture execution across the browser and VS Code hosts.

**Approach:** Compose the existing real-adapter and actual-browser/workbench proofs into one repeatable, serial local suite. Name each capability and proof layer, preserve source project bytes, make every failed check fail the command, and retain the existing guarded-failure controls. Do not claim optional tutorial, tileset-provider or standalone Git delivery.

</frozen-after-approval>

## Implementation Notes

Oneshot: approximately 150 lines of orchestration, fixture isolation and existing-case assertions, plus mechanical command/docs/tracking updates. The local setup and consumer-proof fixes do not change the frozen acceptance scope. Keep the ticket's high risk: an incomplete acceptance report could incorrectly close the foundation even though no shipping runtime or editor behavior changes.

- Add `pnpm editor:acceptance` in the root manifest and `tools/editor-foundation/suite.mjs`, following the existing local-suite subprocess convention. Build/fetch the declared prerequisites before checking; run heavy host proofs serially, without new skips or sleeps.
- Reuse actual dependency-graph rules and their invalid-fixture controls; the complete shared conformance and game-settings suites exercise browser, VS Code desktop and VS Code web adapters, exact `.gam` bytes/unknown residue, saved revisions, recovery/editId/undo/redo/failure paths and real engine boot. Include both `navigation-browser.test.ts` and `navigation-vscode.test.ts` for linked visits, reserved-folder asset picking, cancelled copy/no write, confirmed copy/exact bytes and existing-reference/no-write behavior across the same three adapter modes.
- Reuse the browser workspace/History/program/creator specs for real folder handles, pickers, fresh New Project, durable restore bytes, Monaco/language-worker behavior, failure controls and real fixture execution. Do not replace these with mocked wiring or source-text tests.
- Reuse `tools/vscode-web/run.mjs` for the real native language/debug client, then the native editor proof's complete unflagged cancel/keep scenarios, focused program fixture and creator-test scenarios. Clear inherited `TKR_VSCODE_*_PROOF` selectors before setting each intended lane, so an ambient focus/skip flag cannot silently narrow acceptance.
- Make the language/debug launcher's fixture a fresh temporary copy on every invocation; delete only that owned copy on success or failure and retain its original error if cleanup also fails. Keep replaceable VS Code caches outside fixture copies. The editor launcher already copies its input workspace; supply an authored example in an owned temporary folder.
- Name proof layers honestly: all three adapters receive conformance/round-trip checks; actual browser/workbench checks cover PWA and VS Code for the Web. Do not claim a physical VS Code desktop-app UI run. Standalone Git #1829 and optional T-02/T-03/T-09 provider capabilities remain outside this foundation closing path.
- Prerequisite #1710 is merged and green at the baseline. Current main already fixes #2954 with bounded persisted-entry polling; do not overwrite it with the superseded private implementation. Revalidate its actual native path in this suite.
- The existing shared case `workbench undo and redo retain user edits after the watcher has matched disk` covers #2216's recovery watcher regression; retain its exact title/disk assertions and explicitly assert the model and host stay dirty while recovery is unresolved, including after undo and redo. Audit closure only after its applicable host case passes.
- Child preparation failure aborts before host launches. Independent check failures remain visible and make the final command nonzero; a later passing host cannot hide them. Temporary-workspace cleanup failures also fail the command.

## Plan Change Log

- Local verification found two orchestration setup defects before CI: the PWA lane collided with another development server (#2989), and the focused native program lane needs a separate full authored `Main/` + `Game/Example/` copy rather than the flattened editor fixture (#2990). Allocate independent service ports by default, respect explicit existing overrides, and clean both owned fixture layouts without stopping or reusing someone else's server.
- The same run exposed an existing unlogged fast-test exception (#2991): the graph repair case takes 1.43 seconds for five real CLI invocations. Keep every assertion and public-process phase; log a permanent exception beside the case with a maximum 5-second budget, as required by `docs/guardrails.md#exceptions`.
- Refreshed and integrated remote main `684f4e01b5e9aa13cbba61a969820d717c2377f1` before final local acceptance and independent review, preserving its merged compact controls, focused commands and saving-Help changes. Preserve the original task `baseline_revision` (`2eaf991b966cbf528ab47514f20742e70ed40171`); `review_base_revision` separately pins current main. Retain the complete task diff, and also give reviewers the scoped current-main delta so unrelated merged changes remain context rather than our claimed work.
- Refreshed the review base to planning-only main `34714e326dff69ce15392f70ddcf96a7791f4689` before the #2996 fix; relevant runtime/test paths are unchanged. Its new backlog stories 11.22/#2987 and 11.23/#2988 explicitly do not enlarge the original 11.13 proof. They remain separate follow-on work; passing this baseline is not a claim that the expanded epic is wholly complete.

## Review Triage Log

- Initial quick review, `FoundationRunnerReview`: no findings.
- Initial quick review, `FoundationCoverageReview`: **medium — patch, LIVE, #2996**. The adapter phase omitted the browser and VS Code navigation suites, so its green report did not prove Done-when 2's outside-asset copy-in. Parent checked the actual cancellation, confirmation/reference and independent stored-byte assertions; VS Code runs both desktop and web modes. Refreshed remote main `34714e326` has no relevant runtime/test changes. Add the existing suites, name the adapter-level proof honestly, run them locally and independently re-review the final implementation before committing the fix.
- #2996 resolution: the 16 existing navigation tests passed locally, fresh `FoundationFixCoverageReview` found no further coverage defect, and the expanded command passed all nine sections in 287.55 seconds. Commit `bb2a6d10fe5da4a15a1a0c040d8f22b38b86113f` includes both suites and names navigation/copy-in in the adapter phase.
- Fresh `FoundationFixRunnerReview` found **medium — patch, #2997**: the browser navigation case did not exercise an existing project asset, despite the plan's three-adapter claim. Parent verified the empty bitmap fixture and missing branch. Extend the actual mounted-workbench case with canonical existing-reference selection, independent bytes, a deterministic file-revision counter and keyboard selection while writes are refused. Production picker code stays unchanged; independently review this test-only fix before committing it.
- First independent pass on the #2997 case: `ExistingAssetGuardReview` found no oracle defect; `ExistingAssetLifecycleReview` found **medium — patch, #3009/#3010**, synthetic Enter without established focus and unbounded completion awaits. Parent checked the real handlers and promise ownership. Focus/assert the loaded real tab stop; bound fulfillment/rejection with the existing settling helper and preserve the original result/rejection.
- Second and final pass on that same case: `ExistingAssetFinalGuard` found no findings; `ExistingAssetFinalSettlement` found **low — patch, #3013**, an open picker is disposed by its `onDone`, not `bench.dispose()`. Parent verified that ownership and added Escape cancellation before workbench disposal, with nested `finally`. The withheld-completion control still failed its intended assertion and a temporary observer confirmed the modal was removed. Stop after these two passes on this case fix; no third review loop.
- #2997/#3009/#3010/#3013 resolution: committed as `756e9d63bc11961c967a3070a68215df63b2860d`. Production picker/view code remains unchanged. Final restored adapter phase passed 97/97, no skips or cancellations; strengthened case 117 ms. Include every tracked defect in the acceptance PR's closure references.

## Verification

- Run the new command on pinned Node 24.21.0 with inherited native focus/skip selectors set; actual output must still include full native cancel/keep and sprite proofs plus the explicit fixture/creator lanes. All adapter and actual-host checks must pass without skipped tests.
- Inject a missing package-manager executable to prove preparation fails nonzero before any host proof or success report. Use the existing real probe's wrong module format to prove language-fixture cleanup on a failing native run; compare source fixture bytes before/after.
- Retain and execute existing held-save/concurrent-edit, CSP-blocking, unavailable-language-worker, native save-failure and autosave negative controls. Do not weaken real byte, revision, fixture output or graph assertions.
- Scoped ESLint, provenance and ticket-store/preflight validation must pass. No new dependency or golden change. Log the existing five-process graph-repair test's permanent fast-test exception (#2991), maximum 5 seconds; do not weaken any check.
- Independent review and exact-head required CI precede merge. Then reconcile story/epic metadata and audit every foundation acceptance clause at the merged revision.

### Local discovery and regression receipts

- The first composed run on Node 24.21.0 passed seven sections and truthfully failed the two setup defects #2989/#2990 before CI; committed language fixture paths and bytes remained unchanged even on failure.
- With `pnpm` absent from the child PATH, preparation failed with `spawnSync pnpm ENOENT` and exit status 1 before launching any host proof.
- The strengthened #2216 case passed its applicable VS Code desktop watcher path in 133 ms. Temporarily allowing the real recovery producer to drop pending recovery and reconcile matching disk bytes made the case fail at `matching disk does not silently resolve pending recovery` (107 ms). Restoring the producer restored the pass (138 ms). Browser/Web rows retain their capability-based early returns; this is not a physical desktop-app UI claim.
- Scoped ESLint passed for the four changed tool/test sources. Before the remote-base refresh, provenance scanned 1,672 files with zero violations and canonical store validation passed for 534 tracker IDs, 432 plans and 33 folders.
- Full post-fix acceptance on the refreshed main base passed all nine sections in 298.15 seconds on Node 24.21.0 (runtime-code revision `e810c4fe3fd00e514d317f86ec9a416232fbb15d`): 16 graph-control tests, 81 adapter/settings tests, 28 PWA tests, actual native language/debugger scenarios, 13 native filesystem/workspace guards, complete native cancel/keep plus sprite/New Project/History, saved program fixture execution, and saved creator-test/headless parity. Reported test skips: zero. Poisoned inherited focus/skip selectors did not narrow the native proof; committed language and authored-game fixture directories, file paths and bytes were unchanged.
- The real native wrong-module control (`PROBE_FORMAT=iife pnpm vscode-web:probe`) failed in the VS Code web host with `Couldn't find a debug adapter descriptor for debug type 'probe'`, returned 1, removed its owned temporary fixture copy and left the committed fixture directories, file paths and bytes unchanged (3.00 seconds). This validates the language launcher's failure-cleanup path rather than a mocked exception.
- Restoring the probe's proper CommonJS format (`PROBE_FORMAT=cjs`) restored real activation, debug-adapter registration and a successful session; the command returned 0, removed its owned copy and preserved committed fixture directories/paths/bytes (2.90 seconds).
- The expanded command, at the orchestration code now committed as `bb2a6d10fe5da4a15a1a0c040d8f22b38b86113f`, passed all nine sections in 287.55 seconds with source fixture directories/paths/bytes unchanged. This full run preceded the additional #2997 test-only assertions; the complete adapter phase was then rerun after those assertions and production restoration: 97/97, zero skips, strengthened browser case 108 ms.
- #2997's focused case passed in 341 ms. A real `createAssetPicker.confirm` mutation returning `Bitmap/hero.png` instead of `hero.png` failed its canonical-reference assertion (330 ms); a separate mutation rewriting the selected asset with identical bytes failed the no-write revision check (`7 !== 6`, 242 ms). Both mutations were removed and the original production file restored before the successful 97-test adapter run.
- Final view controls: withholding chosen-result completion failed the bounded guard in 624 ms; removing the real tab stop failed the focused-option guard in 299 ms. After the cleanup finding, the withheld-completion control failed normally in 663 ms while a temporary observer confirmed picker removal. Both view mutations and the observer were removed before final positive verification.
- Final test-only fix: restored targeted build, complete adapter phase 97/97 (6.79 seconds aggregate, strengthened case 117 ms), scoped ESLint passed. Current-base provenance passed with 1,683 files and zero violations; canonical store validation passed with 551 tracker IDs, 438 plans and 35 folders. Required exact-head CI and merge are still pending; `built` is not a claim of merged closure.
