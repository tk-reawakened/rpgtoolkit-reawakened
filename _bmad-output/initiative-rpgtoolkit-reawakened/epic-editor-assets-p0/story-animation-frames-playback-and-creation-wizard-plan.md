---
title: Animation frames playback and creation wizard
type: feature
ticket: 7
created: 2026-11-15
status: in-progress
baseline_revision: 96beab02b5bf791a031ae98f9f0957471021c61d
route: full
route_source: auto
risk: high
review: thorough
review_source: auto
lenses_ran: []
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

- [ ] Model, provider, platform and tests: durable group capture before writes; sorted operations; retry/restore and conflict handling; useful persistent recovery UI in both hosts.
- [ ] Shared view/model: staged sortable image list, multi-frame 4×4 composition with template reuse, proposed destinations and collision confirmation, frame metadata and first-frame initialization. Existing animation edit/playback/navigation/undo/save remains operable.
- [ ] Both hosts: explicit new ANM entry points; shared recovery service and lifecycle integration; no forbidden imports (#2805).
- [ ] Tests: all matrix rows executed, model byte preservation and boundaries, keyboard use, both actual host save/close/reopen and recovery. New ordinary tests individually under 1s. Record behavior-breaking perturbation red/restored green for new evidence tests. File every discovered defect, link fixing PR.
- [ ] Update changelog, final plan evidence and PR checklist; close #1718/#2805 and verified fixed #2695/#2697 from PR. Keep #1828 open for general history/retention/timeline work.

Acceptance: Given authored image and tile fixtures, when each real host creates, edits, confirms, saves and reopens, then ordered metadata and rendered output match. Given interruption and later reopening, when recovery is selected, then all affected paths report truthful results and recovery itself is reversible. Given text minor 0, no authoring write occurs.

## Implementation Notes

- Owner authorized autonomous completion and merge; no further plan approval required. Worktree is `/Users/jensen/.codex/worktrees/1718-animation-completion/rpgtoolkit-reawakened`, branch `feat/1718-animation-authoring`. Main merged and build passed; docs-first recovery contract committed. Do not operate on original checkout or unrelated worktrees. Verify pwd/branch before git commands. No pushes until parent review.
- Use reasonable implementation choices within docs. If evidence uncovers a genuinely unresolved requirement, report it with concrete alternatives; never silently reduce acceptance.

## Plan Change Log

## Review Triage Log

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
