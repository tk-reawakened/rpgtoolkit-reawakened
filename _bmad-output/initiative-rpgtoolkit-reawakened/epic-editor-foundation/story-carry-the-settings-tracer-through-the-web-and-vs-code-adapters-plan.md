---
title: 'Carry the settings tracer through the web and VS Code adapters'
type: 'feature'
ticket: 18
created: '2026-11-11'
status: 'built'
baseline_revision: '9239bcc1ff32dacf315fd95b7d30f5b8691b9d22'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 1
context: ['docs/guardrails.md', 'docs/adr/0022-shared-editor-authoring-contracts.md', 'docs/adr/0025-editor-ui-framework-preact-tsx.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The game-settings view currently works only against an in-memory host, so an author cannot use it in the browser or VS Code.

**Approach:** Implement real web and VS Code adapters over the existing services and mount the same settings view. Prove that saved game bytes are interchangeable and usable by the runner, including in a real web VS Code build.

## Boundaries & Constraints

**Always:** Implement from this repository's docs only (G7); keep `editor-ui` host-independent and neither host importing the other (G2). Preserve the binary document and its command stack in `editor-model`; the VS Code extension host owns it behind `CustomEditorProvider` (ADR 0022 D2). Report only capabilities actually available. Keep failed saves dirty and visible, naming the document. CSP follows ADR 0025 decision 6 without `unsafe-eval` or inline markup styles. Maintain exact game data except the edited title.

**Never:** Consult legacy source; silently upgrade a document; report a write successful before the host confirms it; replace a VS Code web proof with a mock. Autosave and full lifecycle conformance belong to 11.3, not this tracer; Monaco is not mounted here.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Shared trace | Same supported `.gam` in each host; edit title, save, reopen | Same edited title and identical persisted bytes | Any unexpected failure fails the test |
| Failed write | Dirty document; either host rejects the write | Document remains dirty, edit stays visible and the error names it | Surface the real write error |
| Corpus | Fetched real game `.gam`; change title, save | All non-title bytes preserved and headless runner loads saved bytes | Skip locally only if fixtures have not been fetched; strict CI fails on skip |
| Web capability | Browser lacks a stable project handle | Clearly identify the project as a session copy | Do not claim persistent folder access |
| Strict CSP | Mounted browser view and VS Code webview | Count violations during load and edit; zero in each | Fail on any violation |

</frozen-after-approval>

## Code Map

- `packages/platform-services/src/{fs,services,result}.ts` — existing service and result contracts. `fs` paths are project-relative and have explicit invalid-path, durability and watch semantics; implement the declared interface, not a parallel interface.
- `packages/editor-model/src/{identity,main-document}.ts` — existing document identity, editing and saving; retain the authoritative model and its write-failure behavior.
- `packages/editor-ui/src/{mount.ts,settings-view.tsx}` — shared Preact mount and title field; no host imports. Existing behavior examples are in `packages/editor-ui/test/settings-view.test.ts`.
- `packages/host-web/` and `packages/host-vscode/` do not exist at the pinned baseline. Add their package/build configuration, real host services and chrome; browser storage uses File System Access, VS Code uses `workspace.fs` and a custom editor. Build the same view for each host; bridge webview messages to the extension-host model, rather than making the webview authoritative.
- `extensions/rpgcode/`, `tools/browser/`, `playwright.config.ts` and `.github/workflows/ci.yml` show current extension, build and browser-lane conventions. Preserve the existing RPGCode extension functionality.
- `packages/runner-headless/src/closing.ts` and `packages/runner-headless/test/closing.test.ts` show loading fetched game files and the local fixture-missing skip. `tools/no-skips/run.mjs` backs `pnpm test:strict`.
- `tools/deps/edges.json`, `tools/deps/graph.mjs`, TypeScript references and workspace configuration govern package boundaries. `tools/licences/check.mjs` governs dependency licences.
- Proof commit `eac55343d3540dd7943b8a689d5ba1f4fc212300` adds `tools/editor-vscode-test/` and `tools/browser/tests/editor-vscode-web.spec.ts`. The independent reviewer found it opens, edits, saves, reopens and compares bytes in a real web workbench, but it does not prove adapter parity, corpus loading, CSP, CI wiring or the licence gate. Its ignored build output is not in the commit.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/host-web/` — implement the existing platform-services contracts over a project directory handle, including path validation, result/error mapping, durable writes, supported operations and truthful capabilities. Provide the documented session-copy behavior when a persistent handle is unavailable; mount the shared view and expose save/errors.
- [ ] Browser stable projects (#2094) — persist structured-cloneable directory handles and generated unique project identities in IndexedDB; reuse identities by `isSameEntry`, restore handles across reloads, expose truthful recent/open behavior and request permissions only under a user gesture. Advertise `stableProjectHandle` only after durable registration; when persistence is unavailable offer only the existing genuinely in-memory session copy, never describe actual folder writes as a copy. Test identity collisions, re-selection, reload, denied permissions, storage failure, fallback, and capability reporting; exercise the real browser path.
- [ ] Browser filesystem errors (#2093) — distinguish a directory used as the final file target (`is-a-directory`) from a file in a parent path (`not-a-directory`), including read and write behavioral tests.
- [ ] `packages/host-vscode/` and extension packaging — implement the same contracts over VS Code's web-capable workspace APIs; register a `.gam` `CustomEditorProvider`, keep one model per document in the extension host, bridge edits and saved state to the view, and dispose resources correctly. Support both desktop and web extension hosts without Node-only imports in the web bundle.
- [ ] Host tests — run one shared edit/save/reopen behavior against both adapters and compare their persisted bytes; test both write failures and all applicable matrix cases, including invalid paths and capability reporting. Keep the common suite independent of host-to-host imports.
- [ ] Corpus test — use a fetched `.gam` and the real model/adapter save path; assert every byte outside the title field remains unchanged, then supply the saved bytes to the real headless runner. Only the named missing-fixture precondition may skip locally; make `pnpm test:strict` fail that skip in CI.
- [ ] `tools/editor-vscode-test/`, `tools/browser/tests/editor-vscode-web.spec.ts`, package/lock and CI — integrate the examined proof commit without treating it as the other acceptance tests. Build the actual extension and run the proof against a workspace containing one `.gam`; ensure the Playwright lane executes it rather than merely exporting a function. Count `securitypolicyviolation` events on the mounted browser view and VS Code webview during real interactions.
- [ ] `tools/licences/`, `THIRD_PARTY_NOTICES`, manifests and CI — name `@vscode/test-web` as MIT and dev-only, pin and install its dependencies, and make the licence check cover the proof's dependency tree and detect production leakage. Update the graph and tests to prove the host boundaries, including TSX.
- [ ] `CHANGELOG.md` and relevant existing user documentation — describe how to open and save this tracer in both hosts and its session-copy limitation. Remove temporary proof scaffolding not used by the committed test.

**Acceptance Criteria:**
- Given a supported game in each host, when an author edits, saves and reopens the title, then the title persists and both hosts produce identical bytes.
- Given the fetched corpus, when the title is saved, then all other bytes survive and the headless runner loads that saved game.
- Given the built web extension, when the real web VS Code workbench opens, edits, saves and reopens the file, then the title and saved bytes persist.
- Given both mounted views under their strict policies, when they are loaded and edited, then each reports zero CSP violations.
- Given either adapter rejects a write, when save is attempted, then the dirty edit and a document-specific error remain visible.
- Given no downloaded corpus, when the local suite runs, then only the missing-fixture test can skip; strict CI after fixture fetch runs it and rejects skips. Dependency and licence gates pass and reject the prohibited cases.

## Implementation Notes

## Plan Change Log
- Review loopback 1 (#2094): prior plan did not specify how a writable folder meets the stable-handle contract. Persist the real handle and identity before claiming stability; never mislabel persistent folder writes as a session copy. KEEP the shared Preact view, byte-preserving editor model, host boundaries, real VS Code proof and hot-exit coverage, verified CSP positive control, and tracked save/write-failure fixes. Also correct contextual filesystem errors (#2093).

## Review Triage Log
- #2094 — medium / bad_plan: folder picker returned a durable-writing project without a stable handle, contradicting the approved no-stable-handle matrix row; persistence and fallback must be specified and re-derived.
- #2093 — medium / patch: a final directory produces `TypeMismatchError` but the common mapper reports `not-a-directory` instead of `is-a-directory`; preserve parent traversal behavior.
- #2096 — medium / patch: newer drafts and subsequent commit/save requests were lost or misreported while an asynchronous edit was pending. Queue the latest requested edit and show uncommitted drafts as unsaved; independent re-review found no remaining issue.
- #2097 — medium / patch: proof startup errors could bypass cleanup and teardown errors could mask the original proof failure; cleanup now captures process errors immediately and preserves all failures. Independent re-review found no blocker; the child shutdown wait has no escalation timeout.

## Verification
- Verification: merged-main strict run passed 3,901 tests with no skips; focused host/UI, six browser scenarios, real VS Code save and hot-exit proof, typecheck, lint, dependency graph and licence gates passed. Mutation probes failed as intended for byte parity, corpus preservation and runner input, CSP style, refused writes, stable handle, session fallback, and actual VS Code save; restored proof passed. Duration reports include pre-existing slow-test findings (#2062).

- Run focused host and shared behavior tests, including each write failure and corpus case; inspect individual ordinary-test durations against the one-second rule.
- `pnpm fixtures:fetch && pnpm test:strict` — corpus case executes and the no-skips gate passes.
- Build both hosts; run the proof with `pnpm --dir tools/editor-vscode-test proof -- --extension <built-extension-dir> --workspace <fixture-workspace-dir> --game <relative.gam>` and run the browser and webview CSP probes through the required Playwright lane.
- `pnpm typecheck`, `pnpm lint`, `pnpm graph`, `pnpm licence` and relevant gate tests — success, with proof dependencies actually included in licence coverage.
- Check acceptance tests by perturbing the guarded behavior so each fails; restore the implementation afterward. Report any acceptance or verification that cannot be exercised.
