---
title: "Close the foundation with cross-host authoring acceptance"
type: feature
ticket: 13
created: 2026-11-16
status: in-progress
baseline_revision: 2eaf991b966cbf528ab47514f20742e70ed40171
review_base_revision: 684f4e01b5e9aa13cbba61a969820d717c2377f1
route: oneshot
route_source: auto
risk: high
review: quick
review_source: pinned
lenses_ran: []
review_loop_iteration: 0
context:
  - "{project-root}/docs/guardrails.md"
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Foundation authoring proofs exist in separate commands, so there is no single local acceptance run covering project open, exact saves, lifecycle, language services and actual fixture execution across the browser and VS Code hosts.

**Approach:** Compose the existing real-adapter and actual-browser/workbench proofs into one repeatable, serial local suite. Name each capability and proof layer, preserve source project bytes, make every failed check fail the command, and retain the existing guarded-failure controls. Do not claim optional tutorial, tileset-provider or standalone Git delivery.

</frozen-after-approval>

## Implementation Notes

Oneshot: approximately 120 lines of orchestration, fixture isolation and existing-case assertions, plus mechanical command/docs/tracking updates. The local setup fixes do not change the frozen acceptance scope. Keep the ticket's high risk: an incomplete acceptance report could incorrectly close the foundation even though no shipping runtime or editor behavior changes.

- Add `pnpm editor:acceptance` in the root manifest and `tools/editor-foundation/suite.mjs`, following the existing local-suite subprocess convention. Build/fetch the declared prerequisites before checking; run heavy host proofs serially, without new skips or sleeps.
- Reuse actual dependency-graph rules and their invalid-fixture controls; the complete shared conformance and game-settings suites exercise browser, VS Code desktop and VS Code web adapters, exact `.gam` bytes/unknown residue, saved revisions, recovery/editId/undo/redo/failure paths and real engine boot.
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

## Review Triage Log

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
