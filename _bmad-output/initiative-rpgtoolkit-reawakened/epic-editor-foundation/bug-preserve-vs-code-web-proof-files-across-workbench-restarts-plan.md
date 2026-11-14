---
title: 'Prove VS Code web recovery with persistent test files'
type: 'bugfix'
ticket: 21
created: '2026-11-13'
status: 'built'
baseline_revision: 'a6f2e8792aae5f425d75267b8bb9e0d8e03f223e'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: ['{project-root}/docs/guardrails.md', '{project-root}/docs/adr/0022-shared-editor-authoring-contracts.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The real VS Code web proof's fixture provider forgets writes when its extension host restarts. The proof cannot establish that recovered work and an external change both survive an offline conflict.

**Approach:** Give the real-workbench test a persistent, independently observable test workspace and prove the approved recovery behavior through a stopped interval and restart. This proves the harness and editor interaction, not production filesystem durability.

## Boundaries & Constraints

**Always:** Preserve the existing proof's save, autosave, hidden-view and lifecycle coverage. Keep the test workspace, bridge and credentials isolated per run. Under ADR 0022 D14.2, preserve both versions and dirty recovery; never offer an unsafe in-place VS Code reload. Prove backup completion rather than inferring it from a start log. Retain the browser host's behavior and core/host boundaries.

**Never:** Use the simulated conformance adapter as evidence of real-workbench persistence. Treat a tab reopen, backup-start log, or `workspace.fs` read alone as proof of independent durable storage. Modify a production filesystem provider or report provider durability outside this test. Dispatch untargeted Save or Revert as a recovery choice.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Save and restart | Saved test document, then stopped and restarted workbench | Independent backing read and `workspace.fs` return exact saved bytes | Missing or changed bytes fail the proof |
| Offline conflict | Confirmed recovery backup; external file changed while workbench is stopped | Restart shows the dirty local revision and independently retained external bytes | Unproven backup completion or stopped interval fails the proof |
| Cancel / Keep | Separate recovered-conflict runs | Local revision remains visible and dirty; backing store retains external bytes until explicit save | Wrong bytes or lost dirty state fails |
| Unrelated editor | Second dirty editor during each choice | Content, dirty state and backing bytes remain unchanged; no recovery-triggered untargeted Save/Revert | Unexpected callback or command fails |
| Host bridge | Traversal, invalid path, symlink escape, wrong credential | No access outside the temporary workspace | Request is rejected and test reports it |

</frozen-after-approval>

## Code Map

- `tools/editor-vscode-test/run.mjs` creates a temporary workspace and launches `vscode-test-web`; it currently passes a positional folder, which selects test-web's in-memory provider. Use a custom `--folder-uri` without a positional folder for a persistent test provider. Own process, bridge, browser/profile and cleanup lifetimes here.
- `tools/editor-vscode-test/web-proof.ts` drives the real browser workbench. Its backup tracker `creating backup` log is a start signal only; its reload currently expects original fixture bytes. Preserve its existing behaviors while adding independent storage and restart assertions.
- `tools/editor-vscode-test/probe-extension/extension.js` and `package.json` host the test-only commands. Register a dedicated filesystem scheme and expose only the operations the workbench requires. `@vscode/test-web` is pinned at 0.0.81.
- `tools/editor-vscode-test/lifecycle.ts` owns process cleanup and error reporting. Keep cleanup failures visible.
- `packages/host-vscode/src/custom-editor.ts` awaits the injected backup write before returning. `extension.ts` binds that port to VS Code. Observe completion and document-keyed save/revert effects without changing shipped behavior; ensure the backup's independent evidence is actually available.
- `tools/editor-vscode-test/conformance/` is simulated host coverage, useful as a regression check but not the real proof.

## Tasks & Acceptance

**Execution:**
- [x] Add a test-only, authenticated loopback bridge and dedicated VS Code filesystem provider backed by the same private temporary workspace across restart. Implement required filesystem operations, change events and deterministic error handling; reject traversal, malformed paths and symlink escapes.
- [x] Extend the runner to seed two distinct documents, preserve the same workspace/profile for the restart, establish a genuine stopped interval, mutate the first document independently, and expose exact backing bytes to the proof. Preserve failure diagnostics and cleanup.
- [x] Extend the workbench proof to establish completed backup evidence, verify save/restart, and run fresh offline-conflict cases for Cancel and Keep. Independently verify both versions and explicit intended-document save/reopen.
- [x] Observe document-keyed provider callbacks and extension-originated command dispatch, distinguish them from test/workbench commands, and verify a second dirty editor remains unchanged.
- [x] Cover bridge boundaries and prove the real-workbench checks fail when persistence or the offline mutation is deliberately removed. Keep new ordinary unit tests isolated and under one second each.

**Acceptance Criteria:**
- Given a saved document, when the real web workbench stops and restarts, then independent backing bytes and `workspace.fs` equal the saved bytes.
- Given a confirmed backup and independently changed file during the stopped interval, when the workbench restarts, then Cancel and Keep preserve the exact external bytes and dirty recovered local content without harming another editor or issuing an unrelated Save/Revert.
- Given an explicit later save of the intended editor, when it completes and reopens, then independent and workbench reads equal that saved revision.

## Implementation Notes

- Discovered existing setup-cleanup defect: `tools/editor-vscode-test/run.mjs` calls `rm` in `createProofWorkspace`'s catch without importing it. Fixed the import here; file a bug issue with evidence and close it from this PR after the implementation step's no-remote-operations restriction ends.
- Issue #2246 was closed when metadata PR #2276 merged even though that PR explicitly did not implement the proof. Reopen it after the implementation step's no-remote-operations restriction ends; close it only with this proof PR.
- `tickets.py next` leaves TOML-only tracker IDs blank by stock design; `tkr-issue-preflight` explicitly documents that behavior. Some editor plan statuses still appear stale compared with their closed GitHub issues; reconcile them separately on evidence.
- During development the real proof intermittently failed to find Reload Window after focus remained inside a webview (`/tmp/tkr-2246-final-proof.log`, 2026-11-13). The restart now focuses the workbench before invoking the palette; file a separate bug issue for this flaky check and close it from the proof PR.
- The real-workbench proof uses separate fresh profiles for Cancel and Keep. It confirms exact recovery bytes directly in VS Code's IndexedDB, pauses the replacement workbench before its bootstrap after the old extension-host frame detaches, stops the test-web server, changes the backing file, and then restarts the same workspace and server. A second dirty document and workbench command trace guard against unintended Save/Revert.
- Perturbation evidence: resetting the backing file during the clean restart failed the exact-byte assertion (`/tmp/tkr-2246-perturb-persistence.log`); omitting the offline write failed the independent external-byte assertion (`/tmp/tkr-2246-perturb-offline.log`); injecting `File: Save` during conflict handling failed the command trace assertion (`/tmp/tkr-2246-perturb-command.log`). Each mutation was restored.
- The browser, VS Code desktop and VS Code web host-conformance suites passed 78 tests, and the proof typecheck passed. The bridge boundary test ran separately in 45 ms; final real-workbench evidence is recorded after the current validation completes.
- Final validation: `pnpm --dir tools/editor-vscode-test proof -- --extension extensions/editor --workspace <temporary-fixture> --game example.gam` passed its bridge test in 57 ms and both fresh real-workbench cases (Cancel and Keep); total command time 54.37 seconds. `pnpm --dir tools/editor-vscode-test typecheck:tests` and `node --test tools/editor-vscode-test/test/host-conformance.test.ts` passed.
- The proof instruments the served built VS Code adapter in the test harness only, forwarding command and URI-keyed save/revert callback events to the authenticated local bridge before delegating to the real adapter. It fails closed if the built adapter no longer matches the instrumentation; the production bundle on disk is not changed.
- After adding host callback instrumentation and restoring all perturbations, the real-workbench proof passed both fresh choices again (52.13 seconds); its bridge test took 38.7 ms. Injecting a Save with the workbench-log assertion disabled made the separate host callback assertion fail with `{kind: \"save\", value: \"/example.gam\"}` (`/tmp/tkr-2246-perturb-host.log`).
- Reopened #2246; filed setup-cleanup #2277 and palette-focus #2278. Independent review filed #2280 for profile setup cleanup and #2279 for exposing the bridge token in process arguments. Directory setup now removes the workspace and preserves the original error on either setup failure; the run ID is separate from the secret, which is injected only into the in-memory test extension response and redacted from failure diagnostics.
- After the review patches, the independent persistence and offline-change perturbations each failed on the expected byte equality (`/tmp/tkr-2246-perturb-persistence2.log`, `/tmp/tkr-2246-perturb-offline2.log`). With both restored, the real browser proof passed fresh Cancel and Keep runs in 51.97 seconds; its three focused tests took 53.22 ms, 4.60 ms and 2.84 ms. TypeScript checking and focused ESLint also passed.

## Plan Change Log

## Review Triage Log

- medium / patch — Profile creation occurs after workspace creation but before the cleanup `try`, so a profile-creation error leaks the workspace. Tracked as #2280; move it under the existing cleanup and verify the failure path.
- medium / patch — The bridge bearer token appears in the test-web `--folder-uri` process argument; another local user can read arguments, forge `Origin`, and access the test workspace. Tracked as #2279; separate the workspace identity from the secret and keep the secret out of diagnostics.

## Verification

- Run the focused bridge and host-conformance tests and inspect each new unit test's duration.
- Build the extension and run the real `tools/editor-vscode-test` proof with an authored or fetched `.gam` fixture; capture the stopped interval, backup completion, exact bytes and sentinel observations.
- Perturb persistence and the offline change separately; the corresponding proof must fail, then pass after restoration.
- Run the applicable project checks and have an independent reviewer examine the implementation and proof before any merge.

## Code Review

### 2026-11-13 — Independent fix re-review

0 decision-needed, 3 patch, 0 defer, 8 rejected. Verification-gap found no gaps; intent-alignment found that the proof matches the test-harness intent.

- [x] [Review][Patch] Emit a creation event when the test provider creates a file (#2281).
- [x] [Review][Patch] Decode fragmented UTF-8 correctly and enforce the request limit in bytes (#2282).
- [x] [Review][Patch] Reject case variants of the reserved sentinel filename (#2283).

After these patches, the real browser proof again passed fresh Cancel and Keep runs (53.14 seconds); the four focused tests took 60.86 ms, 4.71 ms, 6.41 ms and 380.44 ms. TypeScript checking, focused ESLint and 78 host-conformance cases passed.

The independent patch re-review found that an overwrite test reused the original bytes, the fragmented request test did not guarantee server chunking, and the provider event itself was not observed. The tests now change bytes, inject deterministic stream chunks, verify the byte-limit error, and observe creation and change events through the provider. It also identified a delete-between-opens race in #2281; the overwrite fallback now omits `O_CREAT` and retries exclusive creation after `ENOENT`, with a deterministic interleaving test. Focused tests passed individually under one second.

The independent sentinel re-review and final narrow bridge-race re-review reported no actionable defects.

A later real-workbench run exposed #2284: the lifecycle proof asserted dirty after enabling autosave and could miss that transient state. It now asserts the edited title is dirty before enabling autosave and still checks exact persisted bytes afterward, without a Save command. Independent re-review found no actionable defect. The final proof passed both fresh choices in 48.26 seconds; all seven focused tests were under 450 ms. The restored persistence and offline perturbations each failed on their expected byte assertions.

Rejected:
- The symlink race requires a concurrent process able to modify the private mode-0700 workspace; the bridge cannot create symlinks and that process already has direct access. No untrusted input path demonstrating that race was identified.
- Raw transport or malformed-response failures fail the proof loudly; the plan does not promise a specific error class.
- The independent backup check searches by exact bytes in a fresh browser profile; the two dirty documents have distinct generated contents, and the restart then independently proves recovery of the intended document. No other writer of those bytes was identified.
- The two earlier triage entries remain append-only history; the implementation notes record their patches and issue numbers.
- The Verification section states the approved verification procedure; completion evidence is recorded separately in the implementation notes.
- The fixture is the authored `docs/spec/examples/game/Main/example.gam`, copied to a temporary workspace; the placeholder identifies the temporary location rather than an unknown fixture.
- The edge-review body-size finding duplicates #2282.
- The edge-review claims concern the pre-implementation commit narrative, not a defect in the implementation; the plan explicitly records the completed work.
