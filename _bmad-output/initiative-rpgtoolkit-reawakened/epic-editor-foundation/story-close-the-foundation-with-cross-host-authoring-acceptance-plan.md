---
title: "Close the foundation with cross-host authoring acceptance"
type: feature
ticket: 13
created: 2026-11-16
status: in-progress
baseline_revision: 2eaf991b966cbf528ab47514f20742e70ed40171
route: oneshot
route_source: auto
risk: high
review: ""
review_source: ""
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

Oneshot: approximately 100 lines or fewer of orchestration and fixture isolation, plus mechanical command/docs/tracking updates. Keep the ticket's high risk: an incomplete acceptance report could incorrectly close the foundation even though no shipping runtime or editor behavior changes.

- Add `pnpm editor:acceptance` in the root manifest and `tools/editor-foundation/suite.mjs`, following the existing local-suite subprocess convention. Build/fetch the declared prerequisites before checking; run heavy host proofs serially, without new skips or sleeps.
- Reuse actual dependency-graph rules and their invalid-fixture controls; the complete shared conformance and game-settings suites exercise browser, VS Code desktop and VS Code web adapters, exact `.gam` bytes/unknown residue, saved revisions, recovery/editId/undo/redo/failure paths and real engine boot.
- Reuse the browser workspace/History/program/creator specs for real folder handles, pickers, fresh New Project, durable restore bytes, Monaco/language-worker behavior, failure controls and real fixture execution. Do not replace these with mocked wiring or source-text tests.
- Reuse `tools/vscode-web/run.mjs` for the real native language/debug client, then the native editor proof's complete unflagged cancel/keep scenarios, focused program fixture and creator-test scenarios. Clear inherited `TKR_VSCODE_*_PROOF` selectors before setting each intended lane, so an ambient focus/skip flag cannot silently narrow acceptance.
- Make the language/debug launcher's fixture a fresh temporary copy on every invocation; delete only that owned copy on success or failure and retain its original error if cleanup also fails. Keep replaceable VS Code caches outside fixture copies. The editor launcher already copies its input workspace; supply an authored example in an owned temporary folder.
- Name proof layers honestly: all three adapters receive conformance/round-trip checks; actual browser/workbench checks cover PWA and VS Code for the Web. Do not claim a physical VS Code desktop-app UI run. Standalone Git #1829 and optional T-02/T-03/T-09 provider capabilities remain outside this foundation closing path.
- Prerequisite #1710 is merged and green at the baseline. Current main already fixes #2954 with bounded persisted-entry polling; do not overwrite it with the superseded private implementation. Revalidate its actual native path in this suite.
- The existing shared case `workbench undo and redo retain user edits after the watcher has matched disk` covers #2216's recovery watcher regression; include it unchanged and audit closure only after its applicable host case passes.
- Child preparation failure aborts before host launches. Independent check failures remain visible and make the final command nonzero; a later passing host cannot hide them. Temporary-workspace cleanup failures also fail the command.

## Plan Change Log

## Review Triage Log

## Verification

- Run the new command on pinned Node 24.21.0 with inherited native focus/skip selectors set; actual output must still include full native cancel/keep and sprite proofs plus the explicit fixture/creator lanes. All adapter and actual-host checks must pass without skipped tests.
- Inject a missing package-manager executable to prove preparation fails nonzero before any host proof or success report. Use the existing real probe's wrong module format to prove language-fixture cleanup on a failing native run; compare source fixture bytes before/after.
- Retain and execute existing held-save/concurrent-edit, CSP-blocking, unavailable-language-worker, native save-failure and autosave negative controls. Do not weaken real byte, revision, fixture output or graph assertions.
- Scoped ESLint, provenance and ticket-store/preflight validation must pass. No new dependency, golden change or rule exception.
- Independent review and exact-head required CI precede merge. Then reconcile story/epic metadata and audit every foundation acceptance clause at the merged revision.
