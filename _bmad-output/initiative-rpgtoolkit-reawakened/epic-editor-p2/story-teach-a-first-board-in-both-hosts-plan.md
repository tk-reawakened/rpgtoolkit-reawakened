---
title: "Teach a first board in both hosts"
type: feature
ticket: 8
created: "2026-11-25"
status: built
baseline_revision: "2e7a7c9579c569657095a0a9d2888fc98bb1402b"
route: full
route_source: auto
risk: medium
review: quick
review_source: pinned
lenses_ran: [quick]
review_loop_iteration: 0
context: ["AGENTS.md", "docs/adr/0022-shared-editor-authoring-contracts.md", "docs/adr/0038-every-editor-action-is-a-registered-command.md"]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** New authors have the editor tools but no guided first-board journey or tip of the day.

**Approach:** Give browser and VS Code authors the same accessible nine-step guide through their existing Help commands. Teach the real actions without running them for the author, and let authors leave, resume or restart the guide.

## Boundaries & Constraints

**Always:** Keep progress and the daily-tip preference in user settings, never in the project or exported game. Use registered actions and shared UI; host code supplies only entry points, storage and chrome. Use rights-cleared starter art and the existing starter character; identify host-specific labels and unavailable actions honestly.

**Never:** Add a second project, save or run path; require visual programming; count a preview as gameplay; mark the human acceptance passed on automated evidence.

## I/O & Edge-Case Matrix

| Scenario | Input / state | Expected output / behavior | Error handling |
| --- | --- | --- | --- |
| Resume | Close guide or cancel a project action mid-step | Reopen at the same step; only the author advances | Focus returns to the entry point where it still exists |
| Restart and tips | Restart guide or toggle daily tips | Restart returns to step 1; tip visibility is independent and persists | A failed preference write is visible; no saved-progress claim |
| Unavailable action | Read-only workspace or missing run capability | Explain the writable-folder or supported-host requirement | Do not offer a pretend completed step or claim project writes |

</frozen-after-approval>

## Code Map

- `packages/editor-ui/src/command-palette.tsx` — `WorkbenchCommandBar` registers browser Help commands. `tools/browser/editor-web/main.tsx` and `index.html` supply the welcome entry before a project is open; `packages/host-web/src/workbench.ts` composes the open-project workbench.
- `packages/platform-services/src/services.ts` — `SettingsService` already covers user-layer persistence; adapt storage at the host boundary. `packages/host-vscode/src/program-commands.ts` models native Help command registration; `creator-tests.ts`, `build.mjs` and the host tsconfigs show CSP-safe webview composition.
- `packages/editor-model/src/new-project.ts` — `STARTER_DEFINITIONS` already has an unavailable Default tiles entry. Enable it with a tiny original generated tileset, not any recovered art, so the first-board journey works on a fresh project; retain the existing `Empty first character` starter. `packages/editor-ui/src/run-view.tsx` and `packages/host-vscode/package.json` provide actual action labels.

## Tasks & Acceptance

**Execution:**
- [x] Implement the shared nine-step guide and tip, keyboard navigation, focus handoffs and visible persistence failures (`packages/editor-ui`).
- [x] Specify, generate and exercise the opt-in original tileset through the existing project wizard.
- [x] Wire the browser welcome and workbench Help surfaces to shared actions and user settings.
- [x] Contribute the two native VS Code Help entries and five contextual tutorial commands, routed to the shared command registry in the packaged strict-CSP webview.
- [x] Add shared view tests, focused browser Help and authoring proofs, and the packaged VS Code Help proof. The existing fresh creator lane supplies native authoring/reopen and exact-export playback evidence.
- [x] Update the editor feature docs and changelog; regenerate embedded Help.

**Acceptance Criteria:**
- Given a new author in either host, when they follow the guide, then they can (1) create a project with the starter assets, (2) find Game and Files, (3) create a board, (4) choose a tileset brush, (5) paint and navigate, (6) inspect layer visibility, (7) set the initial board and player start, (8) save and reopen, and (9) contrast preview, an explicit board test and normal startup.
- Given keyboard-only use or cancellation, when the author reads help, leaves, returns or restarts, then navigation and focus are usable, progress is preserved unless restarted, and local UI state, shared edits and failed saves are explained.
- Given distinct normal start and explicit board-test coordinates, when the automated proofs use the existing launch actions, then the actual player shows each mode and the saved project is unchanged by the test. Human acceptance stays pending until a genuine new author completes the nine steps in both hosts.

## Implementation Notes

The browser and VS Code offer the same guide and tip using the existing Help and preference entry points. `editor.showTips` is the only tip preference. The browser discloses when it can retain preferences only for the current page.

## Plan Change Log

## Review Triage Log

| Finding | Verdict | Route and evidence |
| --- | --- | --- |
| Browser adapter treated a persistent write refusal as a successful memory write. | medium | Patch: propagate the refusal; the actual browser proof injects a quota failure and requires the unchanged step and visible error. |
| Browser with no storage did not disclose that its page-only fallback was temporary. | medium | Patch: Help names the page lifetime, and the actual browser proof verifies resume within the page and reset on reload. |
| Tutorial steps and tip toggle were not registered in the two workbench palettes (#3499). | medium | Patch: the shared mounted scope owns all five actions; browser and VS Code mirror availability and delegate execution to that scope. |
| Browser test typecheck could not resolve the new editor UI import (#3500). | medium | Patch: map the built editor UI declaration and include the tutorial spec in the browser test tsconfig. |
| The native wizard test still asserted that starter tiles were unavailable (#3501). | medium | Patch: choose the actual tiles option and assert it writes `Tiles/starter.tst`, while unselected starters remain absent. |
| The default native proof found two visible editor webviews after startup (#3502). | medium | Patch: VS Code offers the automatic tip as a notification, without opening a second editor or shifting the current editor's focus. The manual tip still opens its panel. The unrelated native proof's selector is unchanged. |
| ArrowRight updated the selected cell without moving focus (#3503). | medium | Patch: a controlled test holds a preceding passive effect and reproduces the old selected-but-inactive result. Preact can run that effect before the new DOM commit; focus now follows the committed cell in a layout effect. The actual Chromium `toBeFocused()` assertion is unchanged. |

## Verification

- Run the focused shared-view tests and docs checks, then run the editor-web journey with a free port and one worker and the matching real VS Code Web extension proof separately with pacing per `AGENTS.md`.
- Open a PR with `Refs #1751`; keep the human walkthrough explicitly pending and do not close the issue.
- Local evidence: 39 focused UI/model cases, 17 shell/wizard cases, four paced Chromium cases and the packaged VS Code Web Help proof passed. The browser journey reopens its saved board and proves a board test at `(112, 95)` versus normal startup at `(48, 63)`, with unchanged project bytes. VS Code's fresh creator proof passed authoring, reopening and exact-export playback. Its separate optional live board snapshot check hit the known [#2922](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2922) later-live-hash race; that proof is not claimed green.
- Draft continuation: merged main `275f69f0324af5407d996eca00d5ecf0fb02802f`, preserving the Visual Events, battle data and board upgrade code/proofs. Scoped Chromium verified all tutorial actions from the actual palette, preference persistence/refusal, and the unchanged fresh project/board focus and gameplay assertions. The controlled focus regression failed before the layout-effect repair and passed after it. Browser typechecks and the native starter-option unit also passed.
- The packaged VS Code Web proof passed on the branch with current main `5ec33c3728f490f5ef0399e708f7be93918e9d51`. It checks the selected game editor remains the only visible webview for the automatic tip, then drives all five actions from the native palette, checks unavailable actions are absent, and verifies resume and the persisted `editor.showTips` setting. The build, scoped test typecheck, targeted lint, BMAD store validation and ADR numbering check passed. This rerun did not run the unrelated live board-snapshot proof (#2922).
- **Human acceptance pending:** a genuine new author still needs to perform all nine steps in each host. The automated proofs do not close that gate.
