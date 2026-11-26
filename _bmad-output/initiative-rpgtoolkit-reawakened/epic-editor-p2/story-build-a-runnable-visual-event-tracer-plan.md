---
title: 'Build a runnable visual event tracer'
type: 'feature'
ticket: 2
created: '2026-11-25'
status: 'done'
baseline_revision: '1222d6ca26655bb3f976d67ab609d8911e86ff9f'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: ['{project-root}/AGENTS.md', '{project-root}/docs/guardrails.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A creator cannot make an event visually and then inspect, validate, save and run the same RPGCode program.

**Approach:** Implement only **Show message**: `mwin("…")`, `wait()` and `mwincls()` on three successive lines. Follow [TOOL-12](../../../docs/spec/engine/rpgcode-tooling.md#tool-12-visual-events) and accepted [ADR 0045 1A](../../../docs/adr/0045-visual-source-skin-and-setup-delivery-contracts.md#owner-decisions). Browser and standalone retain Monaco; VS Code retains native RPGCode text editing.

## Boundaries & Constraints

**Always:** One `.prg` identity, saved source and host undo history. Group unsupported source as read-only opaque code. Keep unsupported text and line endings under [TOOL-10](../../../docs/spec/engine/rpgcode-tooling.md#tool-10-text). Use existing diagnostics and saved **Test program** flow. Follow [ADR 0038](../../../docs/adr/0038-every-editor-action-is-a-registered-command.md#decision) for discrete actions; typing is an edit. Prerequisites: 14.1, 11.2, 11.3, 11.7 and 11.8.

**Never:** No second saved format, arbitrary conversion, canvas placement, other cards, unrelated editor actions, second registry or runner.

## I/O & Edge-Case Matrix

| Input / state | Expected behavior |
|---|---|
| Three standalone message lines next to handwritten comments and an assignment | One editable card and one opaque region for the adjacent unsupported lines. Change only the message literal; delete only the card's three lines. |
| A creator selects **Open in editor** on an opaque block | A registered navigation command opens or focuses the same `.prg` in Monaco or native VS Code text, revealing the block or its first line through the existing host navigation where supported. No rewrite, save, new document or undo entry. |
| Empty or existing editable source | Add one canonical sequence that reopens as the same card; leave existing lines untouched. |
| Lookalike in a multiline comment, continued expression, or near-miss sequence | Keep it opaque; never offer a destructive card edit for it. |
| Compiled program, unrepresentable message, stale edit, or failed save | Do not rewrite compiled text, commit an invalid/stale action or clear a failed-save draft. Explain the refusal. |
| Opening or switching views; undo and redo | Opening and switching do not edit or save. Each successful visual mutation is one undo step in the same history as text edits. |

</frozen-after-approval>

## Code Map

- `packages/editor-model/src/program-document.ts`: existing UTF-16 `TextEdit` and `edit-text` command; codec preserves mixed breaks and rejects CP1252 losses. Reuse source lexical/trivia rules from `packages/script-tools/src/program-text.ts` and `packages/core/src/script/lex.ts`, not a second RPGCode parser.
- `packages/editor-ui/src/program-view.tsx`: keep the existing surface, language connection, typing flush and command queue; derive the visual pane from the live snapshot. Register discrete actions through `packages/editor-ui/src/editor-commands.ts`.
- `packages/host-vscode/src/native-text-edit.ts` and `native-clip-text-editor.ts`: live `TextDocument`, strict-CSP bridge and native undo precedent. Bind a visual pane to that document and reject stale requests before one range edit. Use `packages/host-vscode/src/player.ts`'s existing saved-program command.
- Reuse `ProgramView`'s `onRevealReady` seam for Monaco and VS Code's native text selection/reveal for the same document URI. Both host paths use the registered action.
- `tools/browser/tests/editor-program.spec.ts` has real Monaco and saved-byte proof; `editor-web-host.spec.ts` has **New run setup → Test program** and real player output. `tools/editor-vscode-test/run.mjs` and `connected-authoring-proof.ts` have the real native harness. Put both tracer proofs on their corresponding CI routes.

## Tasks & Acceptance

**Execution:**
- [x] `packages/editor-model` — implement pure projection and guarded range edits; test the matrix including mixed breaks, undo/redo and opaque-byte preservation.
- [x] `packages/editor-ui` — share the accessible card pane and registered actions; reuse program snapshot and save/undo/language behavior.
- [x] `packages/host-vscode`, `extensions/editor` — connect the same pane and commands to the native document, exposing and packaging only the necessary surface.
- [x] `tools/browser/tests`, `tools/editor-vscode-test` — exercise the real authoring, save, diagnostics and player paths in both hosts.

**Acceptance Criteria:**
- In browser and VS Code, a creator adds a message, sees it in the same `.prg` as their untouched handwritten code, saves, checks clean diagnostics and observes the message in the actual player.
- Reopen shows the same card and opaque source. Native and Monaco text changes update the visual view, and ordinary undo/redo reflects one step per card mutation.
- In both host proofs, **Open in editor** on an opaque block focuses the existing `.prg` text view and reveals the block where supported, without changing source, dirty state or undo history.

## Implementation Notes

- Owner approved this plan, including **Open in editor**, and directed implementation to continue.
- The card path submits one range edit to the existing document. Unsupported text remains read-only in the pane; native VS Code owns its history and uses its own range edits.
- Model and UI tests cover compiled source, rejected fields and stale offsets, lookalikes, mixed breaks, clean navigation, one-step undo and draft retention on write refusal. Browser and VS Code Web both proved the saved program appears in the real player and its message clears on Enter.

## Plan Change Log

## Review Triage Log

Quick: 0 high, 2 medium, 0 low, 0 false, 0 maybe-false.

| Finding | Verdict | Route | Evidence and action |
|---|---|---|---|
| Blurring a dirty message could enqueue an edit immediately before removal, making removal stale. | medium | patch | Message changes now apply deliberately via **Apply message** or Enter. A browser test fills an unapplied draft, removes the card, and expects one Undo to restore the previously applied text. |
| The native webview used a single generic registry entry for distinct actions. | medium | patch | The shared pane now names add, edit, remove and source navigation individually. Browser entries qualify the selected line for discovery; native actions dispatch by the same command identity and validate the bound document before acting. |

Independent exact-head review of `cffa4c9c61940bb10b266e2ee84ddb1cd1235fff` requested changes despite green CI.

| Finding | Verdict | Route | Evidence and action |
|---|---|---|---|
| Native actions could overlap after checking the same source revision. | high | patch (#3479) | Hold the native edit boundary per document; prove that a second removal against the in-flight revision is refused and the opaque source is preserved. |
| Browser source navigation used the old snapshot offset while Monaco could already contain pending typing. | medium | patch (#3480) | Follow the opaque block's surviving tracked source into the live surface. If it is gone, refuse navigation instead of selecting an unrelated line. |
| Native proof did not reopen the saved `.prg` and reconstruct the visual card. | medium | proof | Close both views, reopen the same source and assert the saved card and opaque source before actual playback. |

The repair review checked those same defects against more interleavings: a queued native action must also pin its original `TextDocument`; browser pointer activation must retain its pressed block through blur, distinguish identical text with different piece identities, and decline a code target when only whitespace survives. These cases extend the regressions for #3479 and #3480.

## Verification

- Run scoped model/UI tests and typechecks; assert the mixed-line-ending browser file bytes and the native document's preserved opaque text, not only rendered cards.
- Run the editor-web Playwright tracer proof on a free `PLAYWRIGHT_PORT` with `--workers=1`. Run the real VS Code Web tracer proof separately on a free `TKR_VSCODE_TEST_PORT`, using bounded settling and the focused proof flag. Require the actual message window and its dismissal in both runners.
- Post-review verification passed: 59 focused model/UI tests, two real Chromium cases, and the focused native VS Code Web proof (native text focus, one undo step per mutation, CRLF save, active diagnostics, and real playback/dismissal). The exact-head PR review and required CI are separate gates.
- Repair proofs: the reviewed code submitted two native edits instead of one and selected browser offset 31 instead of 61. Six focused regressions passed, including the queued action against a reopened native document, pointer activation through blur, equal-byte edits that move the target, and deletion leaving only whitespace. Each of the four additional cases failed at its own assertion when its guard was removed in memory. Two real Chromium tracer cases passed; the shifted target was exact, backing bytes stayed unchanged, and one Undo removed only the prefix. Real VS Code Web closed both tabs, reconstructed the saved card and opaque text, and ran and dismissed the message.
- The next exact-head review accepted the native repairs and required a real pointer proof for #3480. Chromium now presses the original block while Monaco has pending text, confirms that blur commits the edit and reuses that button for a different block, then releases. The caret must land at the original block's new first column, the backing bytes must stay unchanged, and one Undo must remove only the typing.
  Ignoring the pressed block failed the real cursor assertion (72 px from the target, tolerance <2 px); the unchanged production guard passed it.

## Closure evidence

The owner merged [#3478](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3478) at `69ac7565a7b3581ba57dc0d3d956d86bcf850ead` on 2026-11-25 and closed [#1745](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1745); its [required gate](https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/45710682033/job/139554506143) passed. The owner's follow-ups [#3479](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3479) and [#3480](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3480) were fixed in the same PR.

An independent audit at `5ec33c3728` mapped every issue acceptance clause to committed evidence:

| Acceptance clause | Observed evidence |
|---|---|
| Add and edit a supported Show message card in the same `.prg`, with handwritten source intact | Chromium `editor-program.spec.ts` checks the generated three lines and exact saved CRLF bytes including the original comment and assignment; the VS Code proof checks the shared native text and exact backing bytes. |
| Clean diagnostics and run the saved program | Both proofs introduce and fix a real syntax error and observe the real player draw and dismiss the message; VS Code reopens the saved file and delegates to the production `tkr.testProgram`. |
| Reopen shows the same card and opaque source | Browser reloads and reopens the persisted file and reconstructs the card; VS Code closes both tabs and reconstructs it. |
| Ordinary undo/redo reflects one step per card mutation | Both proofs separate Add from Apply with one undo step each. |
| **Open in editor** focuses the same source without editing, saving or history | Browser asserts exact caret placement after pending typing, unchanged bytes and one Undo removing only the typing; native asserts the existing tab, real focus and unchanged undo ordering. |

The audit found two assertion gaps rather than product defects: the native proof did not separately assert a valid native typing changing the live card, and did not check the exact reveal position. Both are required of the successor work in [#3528](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3528), which owns the full pane; they do not reopen this story.
