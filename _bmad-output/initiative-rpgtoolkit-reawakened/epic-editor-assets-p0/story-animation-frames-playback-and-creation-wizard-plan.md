---
title: Animation frames playback and creation wizard
type: feature
ticket: 7
created: 2026-11-15
status: built
baseline_revision: 96beab02b5bf791a031ae98f9f0957471021c61d
route: full
route_source: auto
risk: high
review: quick
review_source: pinned
lenses_ran: [quick]
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/CONTRIBUTING.md'
  - '{project-root}/docs/guardrails.md'
  - '{project-root}/docs/spec/editor-animation-authoring.md'
  - '{project-root}/docs/spec/formats/animation.md'
  - '{project-root}/docs/adr/0022-shared-editor-authoring-contracts.md'
---

<frozen-after-approval reason="Owner authorized full completion, best recommendations, push and merge when green on 2026-11-15">

## Intent

Complete #1718 and PR #2699: authors create and edit animations in browser and VS Code, build ordered image or multi-frame tile sequences, save/reopen them and recover wizard output after failure or restart. Preserve the partial shared model/view already on the branch. Implement the shared checkpoint subset of #1828 required for this feature; do not claim all of #1828 complete.

## Boundaries & Constraints

Always use shared editor-model/editor-ui with host I/O via platform-services. Follow the committed animation-authoring specification, same-version binary writer, 51-frame limit, empty slots and opaque residue preservation. Frame image/key/sound remain one record. Text minor 0 stays explicitly read-only. Real host actions must settle edits before save/close; keep current main's lifecycle fixes. No legacy source, dependency-policy weakening, fake recovery, rollback claim or unapproved retention values. Groups persist under the already reserved `.tkr-history/` until explicit deletion; restore is itself recoverable. Browser/editor scheduling need not be deterministic engine scheduling.

## I/O & Edge-Case Matrix

| Scenario | Expected behavior |
|---|---|
| New/image/tile wizard cancel or declined collision | No source or destination changes |
| Successful multi-frame confirmation | Named TBMs in displayed order, ANM last; reopen preserves frame sound/key and dimensions |
| Invalid names, aliases, read-only format, unavailable project | Explain refusal before target writes |
| History write fails | No target written |
| Target write fails after earlier successes | Accurate per-file results, persistent remaining work, retry remaining / leave as is |
| Restart and restore | Original contents restored, created files removed, failures individually retryable |
| Restore the restore | Reinstates outputs via separate before-restore group |
| Dirty/open document or external change | Preserve work; coordinate accepted edits/save or explicitly refuse unsafe replacement/removal |
| Corrupt/missing recovery bytes | Refuse destructive recovery |

</frozen-after-approval>

## Code Map

- `packages/editor-model/src/animation-document.ts`: partial codec, commands, newAnimationBytes; `binary-document.ts`, `workspace.ts`, `pending-edits.ts`, `identity.ts` and path resolver provide lifecycle seams. `kinds.ts` registers animation; merged recoveryMarker is present.
- `packages/editor-ui/src/animation-view.tsx`: partial image wizard and single TBM; currently imports core illegally. `mount.ts` wires view and pending-edits integration. Use shared browser/preview helpers already exported from model; move all TBM encode/validate/types behind model API.
- Add `packages/editor-model/src/checkpoint-groups.ts` and animation wizard orchestration with persistent before/after bytes, validated manifests, case-folded paths and restart-safe recovery. `platform-services/src/fs.ts`, `run.ts` and `services.ts` offer project-bound I/O and Web Crypto/hash precedents. FileSystemService.delete is not project-identified: ensure deletion binds to the initiating project through completion. Extend shared interfaces and every host/test implementation if needed.
- `host-web/src/index.ts`, `workbench.ts`; `host-vscode/src/custom-editor.ts`, `document-bridge.ts`, `extension.ts`, `webview.tsx`, `new-board.ts`, `new-program.ts`; `extensions/editor/package.json`: new animation command and shared wizard/recovery integration. Do not retain duplicated host encoding/validation. Preserve settle/settled, pending-edits, program and character flows.
- `editor-model/src/package-export.ts` already excludes history; verify actual new artifacts stay excluded. Offer ignore change explicitly.
- Browser real proof: add `tools/browser/tests/editor-animation.spec.ts`, follow `editor-tile-bitmap.spec.ts` OPFS fixture/native Files helpers against shipped editor-web page.
- VS Code real proof: extend `tools/editor-vscode-test/web-proof.ts`, follow sprite proof, native quick-open, readBacking and bounded refusal/restart helpers. Add focused selector in `run.mjs`, and include scenario in regular CI editor proof. `pnpm vscode-web:test` is unrelated debugger proof.

## Tasks & Acceptance

- [x] Model, provider, platform and tests: durable group capture before writes; sorted operations; retry/restore and conflict handling; useful persistent recovery UI in both hosts.
- [x] Shared view/model: staged sortable image list, multi-frame 4×4 composition with template reuse, proposed destinations and collision confirmation, frame metadata and first-frame initialization. Existing animation edit/playback/navigation/undo/save remains operable.
- [x] Both hosts: explicit new ANM entry points; shared recovery service and lifecycle integration; no forbidden imports (#2805).
- [x] Tests: all matrix rows executed, model byte preservation and boundaries, keyboard use, both actual host save/close/reopen and recovery. New ordinary tests individually under 1s. Record behavior-breaking perturbation red/restored green for new evidence tests. File every discovered defect, link fixing PR.
- [x] Update changelog, final plan evidence and PR checklist; close #1718/#2805 and verified fixed #2695/#2697 from PR. Keep #1828 open for general history/retention/timeline work.

Acceptance: Given authored image and tile fixtures, when each real host creates, edits, confirms, saves and reopens, then ordered metadata and rendered output match. Given interruption and later reopening, when recovery is selected, then all affected paths report truthful results and recovery itself is reversible. Given text minor 0, no authoring write occurs.

## Implementation Notes

- Owner authorized autonomous completion and merge; no further plan approval required. Worktree is `/Users/jensen/.codex/worktrees/1718-animation-completion/rpgtoolkit-reawakened`, branch `feat/1718-animation-authoring`. Main merged and build passed; docs-first recovery contract committed. Do not operate on original checkout or unrelated worktrees. Verify pwd/branch before git commands. No pushes until parent review.
- Use reasonable implementation choices within docs. If evidence uncovers a genuinely unresolved requirement, report it with concrete alternatives; never silently reduce acceptance.

## Plan Change Log

## Review Triage Log

### Independent review, 2026-11-15

- high / patch / #2826: verified list aborts when any capture manifest fails load, and delete also requires parsing. Reviewer reproduced a torn capture beside a valid group. Isolate damaged groups and permit explicit deletion; preserve immutable capture, hash checking and append-only progress.
- medium / patch / #2827: verified picture/TBM preview omits scaleToCanvas; normative animation layout explicitly fills the canvas for picture sources. Direct tile-reference semantics remain native size.
- high / patch / #2828: verified custom-editor guard sees binary model workspace only, while native text documents are separately owned by VS Code. Refuse recovery/ignore writes underneath those open documents through host state.
- false / review artifact: initial two-way review diff included changes from main that advanced during the session. Replaced with the PR merge-base diff; no engine or golden changes belong to this PR, and reviewer dropped that concern.

These are corrections within the accepted recovery/preview contracts, not intent changes. Preserve all passing model/UI/host proofs, cancel invalidation and staged-frame inclusion. No released public API is changed.

## Verification

`pnpm build`, focused node tests, `pnpm typecheck`, `pnpm lint`, `pnpm graph`, relevant tool tests; then full required CI. Browser: `pnpm exec playwright test tools/browser/tests/editor-animation.spec.ts --workers=1`. VS Code: build host and extension, then focused selector with `pnpm --dir tools/editor-vscode-test proof -- --extension extensions/editor --workspace docs/spec/examples/game --game Main/example.gam`. Pace host protocols and run heavy proofs sequentially. Record exact commands/results and limitations. Parent obtains independent review, pushes, monitors CI, merges and archives managed worktree only after destination is verified.


### Implementation handoff, 2026-11-15

Shared animation orchestration, model-owned TBM encoding/validation, staged image ordering, multi-frame tile composition/template reuse, new-animation commands, persistent recovery views and project-bound deletion are implemented. Capture manifests are immutable; progress is appended so a partial progress write cannot destroy recovery metadata. Active animation replacement uses accepted commands and the normal host save; exact pending revisions can retry after rejected saves, while unrelated dirty work is refused. Root recovery remains available with affected editors closed. History is retained without a thinning policy; adding the ignore entry is explicit and recoverable. The exporter test creates actual capture/content/progress artifacts and checks their exclusion.

Defects tracked and fixed in this candidate: #2813 (capture corruption), #2814 (pending-revision retry), #2815 (already absent restore), #2816 (in-focus/queued metadata save). Parent review/PR should close these along with the plan's existing fixed defects.

Validated locally: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm graph`, `pnpm exec tsc -b packages/host-vscode`, `pnpm --dir packages/host-vscode build`; focused model, provider, UI, platform and bridge tests. Individual new cases were under 1 second (slowest observed UI image wizard approximately 49 ms). Real-host browser/VS Code proofs, CI integration, full CI and independent review remain pending at handoff; this is not a feature-complete or merge-ready claim.

### Behavior-breaking negative proofs

Each row ran its targeted `node --test --test-name-pattern=...` command, failed with an assertion when perturbed, restored the source, and passed the same command. UI perturbations rebuilt `pnpm build`; the bridge perturbation rebuilt `pnpm exec tsc -b packages/host-vscode`. No compile failure or stale bundle counted as evidence.

- **restore originals**: `bytes: await contents(file.before) -> bytes: await contents(file.after)`. `node --test --test-name-pattern=durable groups survive restart packages/editor-model/test/checkpoint-groups.test.ts` — assertion red (exit 1), restored green (exit 0).
- **stop on target failure**: `if (group.reason !== "before-restore") break; -> if (false) break;`. `node --test --test-name-pattern=history failures stop packages/editor-model/test/checkpoint-groups.test.ts` — assertion red (exit 1), restored green (exit 0).
- **immutable capture**: ``${directory}/${next}.json` -> manifestPath(group.id)`. `node --test --test-name-pattern=torn progress after packages/editor-model/test/checkpoint-groups.test.ts` — assertion red (exit 1), restored green (exit 0).
- **verify recovery hashes**: `if (await hash(bytes) !== key) -> if (false)`. `node --test --test-name-pattern=corrupt or missing recovery packages/editor-model/test/checkpoint-groups.test.ts` — assertion red (exit 1), restored green (exit 0).
- **reject aliased duplicate destinations**: `if (seen.has(foldPath(path))) -> if (false)`. `node --test --test-name-pattern=declined collisions packages/editor-model/test/checkpoint-groups.test.ts` — assertion red (exit 1), restored green (exit 0).
- **fresh conflict consent**: `&& !await env.consent([file.path])) -> && false)`. `node --test --test-name-pattern=external changes during packages/editor-model/test/checkpoint-groups.test.ts` — assertion red (exit 1), restored green (exit 0).
- **explicit ignore entry**: `}/.tkr-history/\n`) -> }/WRONG/\n`)`. `node --test --test-name-pattern=ignore changes are explicit packages/editor-model/test/checkpoint-groups.test.ts` — assertion red (exit 1), restored green (exit 0).
- **frame metadata preservation**: `frames: model.frames }; -> frames: model.frames.map((frame) => ({ ...frame, sound: "" })) };`. `node --test --test-name-pattern=multi-frame wizard packages/editor-model/test/animation-authoring.test.ts` — assertion red (exit 1), restored green (exit 0).
- **retry exact pending revision**: `&& state.dirty && !state.saving -> && false && state.dirty && !state.saving`. `node --test --test-name-pattern=retry saves the exact packages/editor-model/test/animation-authoring.test.ts` — assertion red (exit 1), restored green (exit 0).
- **text minor zero refusal**: `if (!opened.ok || opened.document.getSnapshot().readOnly !== null) -> if (!opened.ok)`. `node --test --test-name-pattern=new destination and TBM packages/editor-model/test/animation-authoring.test.ts` — assertion red (exit 1), restored green (exit 0).
- **displayed image order**: `const selectedCandidates = imageOrder; -> const selectedCandidates = [...imageOrder].reverse();`. `node --test --test-name-pattern=the sorted-image wizard packages/editor-ui/test/animation-view.test.ts` — assertion red (exit 1), restored green (exit 0).
- **pending edit save barrier**: `await pendingEdits.settle(); -> // Perturbation: omit save barrier.`. `node --test --test-name-pattern=immediate save settles packages/editor-ui/test/animation-view.test.ts` — assertion red (exit 1), restored green (exit 0).
- **export history exclusion**: `segments[0] === RESERVED_HISTORY_FOLDER ||  -> `. `node --test --test-name-pattern=preflight creates a readable packages/editor-model/test/package-export.test.ts` — assertion red (exit 1), restored green (exit 0).
- **bridge byte validation**: `entry.bytes instanceof Uint8Array -> true`. `node --test --test-name-pattern=VS Code bridge validates animation tools/editor-vscode-test/test/editor-host-adapters.test.ts` — assertion red (exit 1), restored green (exit 0).
- **51-frame boundary**: `ANIMATION_FRAME_LIMIT = 51 -> ANIMATION_FRAME_LIMIT = 52`. `node --test --test-name-pattern=51-slot boundary packages/editor-model/test/animation-document.test.ts` — assertion red (exit 1), restored green (exit 0).
- **retired project deletion**: `deleteProject: (requested, path) => requested === projectId && isActive() -> deleteProject: (requested, path) => requested === projectId`. `node --test --test-name-pattern=project-bound deletion stays packages/platform-services/test/memory.test.ts` — assertion red (exit 1), restored green (exit 0).

### Actual-host acceptance handoff, 2026-11-15

Added one shared author-action/persisted-byte proof consumed through the existing private editor-vscode-test package's `./animation-proof` export. The root adds only `@tk-reawakened/editor-vscode-test: workspace:*` as a development dependency; the lockfile adds its local `link:tools/editor-vscode-test` importer entry. No production dependencies or package-boundary exceptions changed.

The browser proof drives the shipped editor page over native OPFS. The VS Code proof drives the actual bundled custom editor, native new-animation/recovery commands, real webview bridge and disk-backed test workspace. Both prove: cancel new creation; create binary ANM; image selection cancellation and explicit reorder; exact authored canvas pixels; frame sound/key persistence and keyboard reorder; save/close/reopen; two 4×4 TBMs with template reuse including a currently staged final frame; target-write refusal after both TBMs have written; per-file failure reporting, leave-as-is and retry; host recreation; persistent restore removing generated TBMs; restore-the-restore; final metadata reopen. Browser refusal holds a native exclusive writable lock, while VS Code uses the existing physical chmod refusal harness. The regular CI editor-acceptance run executes this scenario once before its sprite scenario; `TKR_VSCODE_ANIMATION_PROOF=1` selects it alone locally.

Fixed review findings #2817 and #2818: cancel invalidates pending image/tile asset preparation (also on disposal), and confirmation includes the queued sequence plus the currently displayed staged composition. The button explicitly names that combined operation.

Commands and outcomes:

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm graph`: passed. Graph reports 1,044 modules and 4,973 dependencies without violations.
- `node --test packages/editor-ui/test/animation-view.test.ts`: 4/4 passed; individual cases approximately 3–49 ms. The two new cancellation cases also passed individually at approximately 34–39 ms.
- `pnpm exec playwright test tools/browser/tests/editor-animation.spec.ts --workers=1`: restored final run passed, 5.9 s test / 9.8 s total.
- `pnpm build && node packages/host-vscode/build.mjs && node extensions/editor/build.mjs`, followed by `TKR_VSCODE_ANIMATION_PROOF=1 pnpm --dir tools/editor-vscode-test proof -- --extension extensions/editor --workspace docs/spec/examples/game --game Main/example.gam`: restored final run passed, reporting `vscode.dev animation creation, partial-write retry and persistent recovery proof passed`.
- New browser and VS proof TypeScript checks passed, and `git diff --check` passed.

Negative evidence:

- #2817 image cancellation: before the invalidation fix, `node --test --test-name-pattern='cancel image wizard' packages/editor-ui/test/animation-view.test.ts` failed with `cancelled preparation must never reach the write provider`, actual 1 / expected 0; after rebuilding with the fix, the identical command passed.
- #2817 tile cancellation: perturb `if (preparation !== tilePreparation.current) return` to `if (false && preparation !== tilePreparation.current) return`, rebuild with `pnpm build`, and run `node --test --test-name-pattern='cancel tile wizard' packages/editor-ui/test/animation-view.test.ts`: failed `cancelled preview must not reappear after its read finishes`, false !== true. Restored source/rebuild passed the same command.
- #2818 actual hosts: perturb combined queued/staged selection back to the original queued-only ternary. Browser proof (with its standard bundle build) and VS proof (after `pnpm build` plus host/extension bundle rebuilds) each failed specifically on missing `Bitmap/proof-second.tbm: written`, while showing the first TBM written and the deliberately refused ANM failed. Restoring the source and rebuilding produced the passing actual-host runs above. An earlier VS attempt that had not rebuilt TypeScript was discarded as stale-bundle evidence.

Runtime explanation: these are integration proofs, not ordinary unit tests. Native filesystem refusal, real workbench/browser recreation, and paced protocol/UI operations cannot be established by a sub-second model test. The browser scenario has a 120-second bound; VS operations use the existing bounded frame/palette retry helpers and finite locator/assertion timeouts. Heavy host runs were sequential. Local runtime was Node 26.13.0; CI's pinned Node 24.21.0 remains to be verified by the parent run. The standard browser-server build needed an ignored demo package/descriptor, reused from the primary checkout's existing fixture artifacts; no game fixture was committed.

Diagnostic logs for this session: `/tmp/2699-browser-animation.log`, `/tmp/2699-vscode-animation.log`, `/tmp/2699-browser-staged-red.log`, `/tmp/2699-vscode-staged-red.log`, `/tmp/2699-cancel-tile-red.log`, `/tmp/2699-typecheck.log`, `/tmp/2699-lint.log`, `/tmp/2699-graph.log`. The committed proof code and mutation instructions above are the repeatable evidence; these temporary logs are not required by CI. Full normal CI, independent final review, push and merge remain the parent's responsibility.


## Final verification and independent review

Independent review of the full merge-base PR diff closed #2826, #2827 and #2828 after commit `f20bed1c`, with no new actionable regressions. The reviewer separately ran the three focused regression tests (13–29 ms each). The original partial PR and all continuation changes were included in review.

- Final `pnpm build`, `pnpm typecheck`, `pnpm lint`, and `pnpm graph` passed (1,044 modules / 4,973 dependencies; no violations).
- `node --test 'packages/editor-model/test/*.test.ts' 'packages/editor-ui/test/*.test.ts' 'packages/platform-services/test/*.test.ts' 'packages/host-web/test/*.test.ts' 'tools/editor-vscode-test/test/*.test.ts'`: 900 passed, zero failed/skipped/cancelled.
- Final browser proof after preview correction: `PLAYWRIGHT_PORT=4281 pnpm exec playwright test tools/browser/tests/editor-animation.spec.ts --workers=1` passed (6.2 s).
- Final VS Code proof: `node packages/host-vscode/build.mjs`, `node extensions/editor/build.mjs`, then `TKR_VSCODE_ANIMATION_PROOF=1 pnpm --dir tools/editor-vscode-test proof -- --extension extensions/editor --workspace docs/spec/examples/game --game Main/example.gam` passed. Log: `/tmp/tkr2699-final-vscode-proof.log`. Actual-host integration necessarily exceeds one second because it covers native launch, save/reopen, permission refusal, restart and durable recovery; these cannot be proved by a shorter unit case. Operations are paced and bounded.
- `pnpm licence`: zero violations. `pnpm fixtures:fetch`, `pnpm golden`, `pnpm closing`: passed, all eight closing baselines match. No golden/baseline changes.
- `node tools/no-skips/run.mjs --verify-shards`: all eight shards / 399 files accepted. Tracker-store validation passed.
- Local runtime is Node 26.13.0; required remote CI validates pinned Node 24.21.0. Full CI is the final merge gate, not replaced by these local results.

Owner explicitly authorized pushing and merging when green, overriding the workflow's default no-auto-push guideline. General history, retention and timelines remain tracked in #1828; this PR delivers only the prerequisite checkpoint subset and complete #1718 animation authoring.

### Review-fix negative proofs

- #2826: `node --test --test-name-pattern='torn capture entries' packages/editor-model/test/checkpoint-groups.test.ts` failed before the fix at `ok(listed.ok)`; the corrected checkpoint suite passed all eight cases. Temporarily filtering error entries from `items.map` in the recovery view, rebuilding with `pnpm exec tsc -b packages/editor-ui`, and running `node --test --test-name-pattern='recovery view diagnoses torn captures' packages/editor-ui/test/animation-view.test.ts` failed the expected two-entry assertion. Restored/rebuilt code passed the identical test.
- #2827: `PLAYWRIGHT_PORT=4281 pnpm exec playwright test tools/browser/tests/editor-animation.spec.ts --workers=1` failed before correction: the second pixel on an 8×6 canvas from a 4×3 GIF was transparent rather than repeated opaque (10,20,30,255). Corrected/rebuilt code passed the identical proof, including unequal TBM dimensions and native-size direct tiles. Parent also passed the updated shared proof in actual VS Code.
- #2828: `node --test tools/editor-vscode-test/test/animation-native-guard.test.ts` failed before the guard (`ignored.ok` true, expected false). After `pnpm exec tsc -b packages/host-vscode`, the identical test passed (~14 ms), covering existing and absent `.gitignore`, restore refusal, preserved buffer/disk, and unaffected ordinary ANM saves.
