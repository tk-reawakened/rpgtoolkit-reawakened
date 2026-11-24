---
type: feature
title: "Restore the legacy bitmap font editor"
ticket: 20
tracker_id: "#1939"
status: built
risk: medium
---

## Intent

Let authors create and edit retro game lettering using the glyph grid, character strip and sample preview of the older Toolkit font editor. [T-65](../../../docs/editor-features.md#t-65-bitmap-font-editor) maps to CAP-16.

## Scope and acceptance

Create and open `.fnt` documents through the existing project editor. Select any of the 256 slots and paint or erase ink in its 8 × 8 grid. Make the character selector and pixel grid usable with a keyboard. Preview sample text at a chosen size, with bold, italics and underline. Keep those settings in the view so changing the preview makes no edit to the font. Use shared document identity, undo, redo and save. Reuse the existing bitmap format and rendering code.

## Verification

In both hosts, edit pixels at opposite corners and in different glyphs, undo and redo, save and reopen, and compare glyph rows to an independent expected bitmap. Check an untouched glyph and confirm preview changes leave the document clean. Check visible, hard-edged glyphs at 8 px and 20 px and compare each style with the runner's preview of the same sample. Exercise the saved asset in the runner through `font()`. Check that a refused save leaves the pending glyph edits available for retry.

## Dependencies and decisions

Prerequisite: 13.1 (#1727) supplies the shared feature registration and project document route. The [.fnt format](../../../docs/spec/formats/legacy/text-formats.md#font-toolkit-2-text) supplies the file contract. The archived visual description shows the grid, strip and preview. It does not establish keyboard bindings or the original glyph commit workflow. T-65 supplies the Reawakened interaction scope. Keep the startup font compatibility issue (#1938) separate.

The engineer's notes flag a suspected legacy scaling failure above 8 px and describe synthetic styling with antialiasing off. The scaling failure is unverified. Use Reawakened's bitmap rasterizer for visible enlarged glyphs and crisp styling. Synthetic bold and italic and a separate underline belong to the preview, while the saved rows stay monochrome.

[#1942](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1942) tracks a future extension for larger glyph grids. The 8 × 8 legacy grid and the preview's display size are independent. Larger authored glyphs will need their own asset specification.

## Proposed rulings (pending owner review; entry 13.20)

Each is also written into `docs/` in this ticket's first commit.

1. **A project `.fnt` in `Font\` is installed by the engine.** *Lands in:* `docs/spec/engine/display-input-audio.md#reawakened-project-bitmap-fonts`, `docs/spec/engine/runners.md#draw-list`. *Evidence:* the acceptance asks that the edited glyph be drawn "in the runner using `font()`", the family rule in the same page already says "A `.fnt` is selected when the name resolves to one", but `privateFontKeys` (`packages/core/src/engine/boot.ts`) accepts only `.ttf`, so today `font("mine")` over `Font/mine.fnt` selects the key `font/mine.fnt` and then draws nothing (observed with a throwaway engine test, 2026-11-24: no `text` command in the draw list, zero lit pixels). *Rejected alternative:* leave project `.fnt` files unread, as E-132 says Toolkit 3.1 does, and prove the saved font only through the editor's preview; that would leave the acceptance's runner clause unproven and the editor's output unusable in a game. *If ruled otherwise:* the engine, runner-web and golden changes of this ticket are dropped and the runner clause of the acceptance becomes a documented gap.
2. **Bitmap ink is specified as it is implemented.** *Lands in:* `display-input-audio.md#reawakened-bitmap-font-ink`. *Evidence:* `legacyInk`, `emitText` and `bitmapFontMetrics` already draw it; the spec only said `textInk` "owns" it. *Rejected alternative:* have the editor preview a rule of its own, which could drift from the player. *If ruled otherwise:* the code is the authority and the preview follows it through the same functions.
3. **New font starts empty.** *Lands in:* `docs/editor-features.md#t-65-bitmap-font-editor`. A new font has all 256 glyphs empty at version 2.0. *Evidence:* the format has no default content; the bundled `media/fonts/tkr-8x8.fnt` is an engine asset the editor cannot read. *Rejected alternative:* copy the bundled default font into every new project font; it bakes a second copy of generated glyphs into the editor bundle. *If ruled otherwise:* only the new-font bytes change.
4. **A stroke is one edit; the character is one `set-font-glyph` command.** A pointer drag across cells commits one command carrying the glyph's eight new rows, so one Undo takes back the stroke. *Evidence:* the tileset artwork editor commits a stroke as one command (`paint-tileset-pixels`). *Rejected alternative:* one command per pixel, which makes undo take a stroke back one pixel at a time.
5. **The kind's storage class is `"legacy-text"` and it follows ADR 0022 D2 row 1.** *Lands in:* ADR 0026 implementation notes.

## Implementation notes (2026-11-24)

**Landed.** `packages/editor-model/src/font-document.ts` (the `font` kind, `.fnt`, `legacy-text`), `font-preview.ts` (the sample picture through `emitText` + core `rasterize`), `font-support.ts` (`New font`), the registry row and `asFontDocument`, the conformance row, `packages/editor-ui/src/font-view.tsx` and its stylesheet section, the Files-panel `New font…` button, the browser workbench `newFont`, the VS Code `tkr.font` custom editor and `tkr.newFont`, the help page and CHANGELOG entry, and the engine's installation of a project `.fnt` (`privateFontKeys`, `installedFontAssets`, runner-web decode).

**Decisions taken and why.** A stroke is one `set-font-glyph` command carrying the glyph's eight rows, so one Undo takes a stroke back whole; a keyboard action is one such command. The view keeps each glyph's submitted-but-unanswered rows and builds the next edit on them, so a second stroke never undoes a first while a host answers late (#2613's pending-edit rule also covers save and close). The preview lays out as `text()` does (one size per line) and is drawn by the core rasteriser rather than by a second renderer; the size, sample, styles and zoom are view state only. A host without a 2D canvas says so instead of showing a blank canvas. `.fnt` follows ADR 0022 D2 row 1 even though it is text, because it has a same-version writer; its `StorageClass` is the new `legacy-text`.

**Evidence.** Model: `packages/editor-model/test/font-document.test.ts` (round trips, opposite-corner edits saved as the format's rows, untouched glyphs intact, refusals, refused save keeps edits, read-only open, preview equals the spec's pixels at 8 and 20 px in every style, new-font bytes). Engine: `packages/core/test/render-now.test.ts` and `engine-boot.test.ts` (the glyph drawn by `font()` at 8 and 20 px in every style, underline rows, bitmap metrics, install and `font.rejected`). Runner: `packages/runner-web/test/game-fonts.test.ts`. View: `packages/editor-ui/test/font-view.test.ts`. Hosts: `tools/editor-vscode-test/test/font-hosts.test.ts` (browser host, VS Code desktop and VS Code for the Web: edit at opposite corners by pointer and keyboard, save, close, reopen, file equals hand-written bytes, an untouched glyph intact, preview settings leave the document clean).

**Not proved here (and why).** The preview's pixels are proved against the core rasteriser in the model test and the engine's `font()` in the core tests, not in the headless host lanes: their DOM shim has no 2D canvas, so those lanes check the view reports the missing canvas and leaves the document clean. A real-browser Playwright case for the editor surface (and a VS Code web proof) is the remaining host-lane work before the ready-for-review gate. `tkr.newFont` and the workbench `New font…` are covered by the shared `createFontFile` contract test; their dialogs are host chrome.

**Gates run locally (2026-11-24, Node 26.13.0):** `tsc -b`, every package's `typecheck:tests`, `pnpm graph`, `pnpm lint` (eslint + core deps), `pnpm licence`, `pnpm provenance`, `pnpm catalogue:check`, `pnpm editor-ui-toolchain:check`, `pnpm adr:numbering:check`, `pnpm golden`, `pnpm golden:bun`, `pnpm closing`; focused suites listed above (299 passing, 9 pre-existing skips). Not run: `pnpm test:strict` over the whole repository, `fixtures:author:check`, `fixtures:test`, `browser:test`, `script:dogfood`, the Android/desktop proof.

## Real-host proofs (2026-11-24, added after the first draft)

**Browser (real Chromium, shipped editor page).** `tools/browser/tests/editor-font.spec.ts` (2/2 passing): a pointer drag across three pixels of the second row, the preview at 8 px compared pixel-for-pixel with the spec's ink and again at 20 px plain, bold, italics and underline, a keyboard edit with `Space`, **Undo and Redo through the workbench's Edit menu**, Save (file equals hand-written bytes), close and reopen (saved glyph shown, untouched glyph intact), and `New font…` twice — Cancel writes nothing, Save creates an empty version 2.0 font and opens it. **A defect this lane found:** `Space` acted on whichever pixel still held DOM focus while the arrow move was being drawn (two pixels behind the cursor after seven presses); the key now acts on the grid's cursor and prevents the browser's own click. Fixed in `font-view.tsx` with the view test still green.

**VS Code web (real vscode.dev client, packaged extension).** `TKR_VSCODE_FONT_PROOF=1 pnpm --dir tools/editor-vscode-test proof -- --extension extensions/editor --workspace <fixture> --game Main/example.gam` passed: `New font` twice (Cancel writes nothing; Enter creates the file and opens the custom editor), a real pointer drag along the last row of A, a keyboard pixel through the cursor, the preview canvas read back and compared with the spec's ink at 8 and 20 px and with bold at 20 px, Save (file equals hand-written bytes), close and reopen with an untouched glyph empty. The unmodified full VS Code web acceptance suite also passed against the same build (`vscode.dev settings, board, art and bitmap proof passed (keep)`), so the new view type broke nothing.

**Not proved in VS Code, and filed as [#3375](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3375):** undo/redo from inside the VS Code custom editor. The font view has no undo control (editor actions belong to the host) and this VS Code web build offers no `Edit: Undo` row while focus is in the custom editor's webview, so there is no real workbench gesture to press. Undo/redo are proved in the browser host and at the document and view level; the VS Code gesture is the issue's acceptance evidence.

**Toolchain note for the VS Code lane:** `extensions/rpgcode` and `extensions/editor` are outside the pnpm workspace, so a fresh worktree needs `npm install` in each and `node packages/host-vscode/build.mjs` before `extensions/editor/build.mjs`.

## Gates re-run after the real-host proofs (2026-11-24)

- `pnpm test:strict`: **5810 pass, 0 fail, 0 skipped**. The first run failed one test — `packages/host-vscode/test/custom-editor-events.test.ts`, which enumerates the kinds it edits and so did not know the new `tkr.font` provider; adding `font` to that list restored its invariant (fixed in `e3a3f6642`).
- `pnpm golden`, `pnpm golden:bun`, `pnpm closing` (8/8 after the explained baseline pin), `pnpm lint`, `pnpm graph`, `pnpm licence`, `pnpm provenance`, `pnpm catalogue:check`, `pnpm editor-ui-toolchain:check`, `pnpm adr:numbering:check`, `pnpm fixtures:author:check`, `pnpm fixtures:test`.
- Real hosts: `tools/browser/tests/editor-font.spec.ts` 2/2 in Chromium; the focused VS Code web font proof passes; the unmodified full VS Code web acceptance suite passes against the same build.
- `pnpm script:dogfood` is not applicable: this change touches no RPGCode source, script-tool input or indexed symbol. `desktop:input`, the Android proof and `desktop:measure` were not run (no emulator or GPU host here, and the change alters no input geometry or desktop loop).

## Undo and redo in both hosts (#3375 closed in this PR)

The first VS Code run failed with no `Edit: Undo` row. Two things were behind it: the palette row is `Undo` (not `Edit: Undo`), and, more importantly, **Ctrl+Z inside a custom editor's webview went nowhere** — the workbench does not forward it into the iframe. That left the acceptance's "undo … with keyboard" unproven in the VS Code host.

Fixed in the shared seam rather than per view:

- `packages/host-vscode/src/document-bridge.ts`: the view may ask the workbench for its own history (`{ type: "undo" | "redo", requestId }`), answered by `document.model.undo()/redo()` with a `history-result`. `RemoteDocument` gained `historyUndo()`/`historyRedo()` — **not** `undo`/`redo`, so a view that deliberately leaves history to the host (the board, which shows no button and says to use the workbench's Undo) is unchanged; `board-canvas-hosts.test.ts` still passes. The font view opts in through a forwarding adapter in `webview.tsx` for the `font` kind only.
- `packages/editor-ui/src/font-view.tsx`: `FontViewDocument` accepts the host's `undo`/`redo`; the glyph panel shows **Undo** and **Redo** (with `aria-keyshortcuts`), and Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z act from the grid. The view skips the keys when the workbench around it already handled them (`event.defaultPrevented`), so the browser host's global binding and the view never undo twice.
- `packages/host-web/src/index.ts`: the browser host's font view gets the document's own stack, like a board's.

Proofs: `tools/browser/tests/editor-font.spec.ts` presses Ctrl+Z/Ctrl+Y and clicks both buttons; the VS Code web proof does the same through the real bridge and the workbench's own `Undo`/`Redo` commands, and `pnpm test:strict` is 5811 pass / 0 fail / 0 skipped. Unit level: `packages/editor-ui/test/font-view.test.ts` (buttons, keys, stack length) and `tools/editor-vscode-test/test/editor-host-adapters.test.ts` (the new request shape).

## Review fixes after head 62714caa (2026-11-24, second pass)

**Model: pixels, not stale glyph snapshots.** `set-font-glyph` (eight whole rows) is gone. A stroke is one `set-font-pixels` command carrying every cell it passed, applied to the glyph as the document holds it now, so a second view of the same glyph cannot overwrite the first view's pixels; Clear glyph is its own `clear-font-glyph` command. A command that changes nothing returns the same model, so it is refused and never recorded. Sparse pixel arrays are rejected by an index walk (`every` skips holes and would have cleared glyph data). Proofs: `font-document.test.ts` "two strokes from a stale copy…", "a stroke with no pixel, a pixel outside the cell, a sparse pixel list or a no-op is refused", the kind-conformance row, and the editor-ui test "two views of one font edit different pixels…".

**View: history is the host's, queued behind its own edits.** Undo/Redo in the browser host call `workspace.undo(document)`/`redo(document)` — the same stacks the menu and palette use — so a panel Undo is taken forward by the menu's Redo (proved in `editor-font.spec.ts`). The host call is queued behind this view's own unanswered edits, and the button is enabled by them, so a delayed acknowledgement can never make Undo take back an earlier edit than the one just made (`font-view.test.ts` "Undo waits for this view's own late edits"). A fast drag interpolates every cell between two moves (`fontLinePixels`, proved at unit and real-browser level).

**VS Code: no bypass of the working copy.** The first attempt exposed the bridge route as `historyUndo`/`historyRedo` and mapped it into the font view; the reviewer is right that a view-driven `model.undo()` would move the document behind VS Code's undo cursor and dirty flag. It also did not work: `vscode.commands.executeCommand("undo")` from inside a custom editor's webview took nothing back in this build, and the view's own buttons then did nothing at all. Rather than ship either, the bypass is removed: in VS Code the view offers no Undo of its own (the same rule the board follows), and the workbench's own Undo/Redo commands do the work — proved in the real vscode.dev client, including **close after undo**: one edit, workbench Undo, close, no save prompt, file unchanged (so the dirty marker followed the same stack). **Ctrl+Z inside a webview is still not forwarded by this build**, which is the remaining part of #3375 and is not claimed as proved.

**New font path.** `fontProjectLayout` reads the game's main file (`Main/…` plus `Game/<project>/` layouts) and suggests `<that folder>/Font/…`; the root layout stays for games without a project folder. Proof: `packages/host-vscode/test/new-font.test.ts`.

**Preview size.** A bitmap-guild preview is drawn 1:1 on the canvas and enlarged by layout (`data-zoom` classes), so a phone never needs a canvas thousands of pixels on a side; the picture itself stops at `FONT_PREVIEW_MAX_SIDE` (2048) and says the sample is shown in part. Proof: the model test's truncation case and the real-browser zoom step.

**Engine.** (i) `font()` now resolves against the fonts the project installed first, so `Boards/retro.brd` cannot shadow `Font/retro.fnt`. (ii) A restored game keeps the session's installed font list instead of the save's older one, so core and renderer agree after Load. (iii) `runScriptedFrame` and the closing replay accept a `.fnt` only in a `Font` folder, as the engine installs them. (iv) A project font the host cannot supply is reported once (`font.rejected`) and skipped; startup no longer stalls on it. (v) A row value is the whole line (`^\d{1,3}$`), so `128oops` is refused rather than read as 128, and the version lines are whole numbers. Proofs: `engine-boot.test.ts` (shadowing, missing font, restore) and `runner-web/test/game-fonts.test.ts` (folder rule); reader proofs in `format-font.test.ts`.

**Real shipped player.** `tools/browser/tests/project-font.spec.ts` now boots the shipped player page with a package that ships `Font/retro.fnt` written the way Save writes it, and compares the canvas pixels with that font's ink and against the bundled fallback: the player draws the project font's glyph, not another face.

## Review fixes after head 2c4d0012e (2026-11-24, third pass)

**A stroke under a change is rebased, not dropped.** When a snapshot for its glyph arrives mid-drag (another view, an
undo, a reload), the stroke's cells are applied to the rows that arrived, so the pointer keeps painting and the other
view's pixels survive; only losing the right to edit (read-only, a conflict) drops it. View test: an outside edit lands
mid-stroke, the grid shows both, the stroke continues, and its release is one edit carrying only its own cells.

**New font never guesses between games.** Every `.gam` is a game with the layout its own main files names; the host's
open game wins, a project with two games asks which one (naming them), and the chosen path is checked again before the
write — a font outside the chosen game's folders or outside a `Font` folder is refused with the reason. Proof: two games
with no active one shows the question, an answer outside the first game is refused.

**The preview draws only the lines it holds.** The retained-line slice is what is emitted (the same line and glyph data
`emitText` uses), the picture is exactly those lines plus the padding, and a clipped line can no longer reach into it.
Test: 198 characters at 128 px truncate, and no ink is found in the bottom padding rows.

**A pixel command is compared by the rows it ends on.** `[ink(x,y), erase(x,y)]` leaves the glyph unchanged, so no edit is
recorded (an intermediate comparison would have recorded a no-op). Test: the refusal, no edit, `dirty` false.

**The replay uses the boot inventory, not a folder guess.** `runClosingFrames` now returns the run's installed font keys
(`engine.boot.fonts`), and both the scripted and closing presenters decode exactly those. The old heuristic both rejected
`Font/Heading/heading.fnt` (installed by the engine) and accepted `Misc/Font/elsewhere.fnt` (not installed); test covers
both directions. The open streamed player converts a failed `.fnt`/`.ttf` fetch into a null reply, so the engine reports
`font.rejected` and starts without it, while a required asset's failure still stops the load.

**The shipped-player proof ships the editor's own bytes.** Instead of formatting a font by hand, the spec creates the file
with `createFontFile`, edits glyph A through the real document's `set-font-pixels`, saves, and packages the bytes `save()`
wrote.

**VS Code Undo/Redo (#3375).** With the grid focused, use VS Code's native shortcuts (Cmd+Z and Cmd+Shift+Z on macOS).
The earlier Control-key proof used the wrong modifier on macOS. A custom command bridge duplicated VS Code's own
dispatch and could show an “undo or redo operation running” dialog, so no bridge shipped in that pass. The real vscode.dev proof
checks native key Undo/Redo, the tab's dirty marker going from set to clear when undoing back to saved content, and close
without a save prompt or any change to the saved bytes.

## Fourth-pass review fixes

- **#3401:** Each capture holds the engine's installed font keys at that tick; both presenters use the selected frame's keys. A nested project face stays on the earlier frame even after `MainFile()` clears the engine inventory.
- **#3402:** A null reply settles a font request for the current boot. The startup test demands one request, one refusal, and a running program without the face.
- **#3403:** A drag retains all traversed cells until release. A matching external edit followed by Undo cannot strip the drag's intent.
- **#3404:** Both New Font routes validate against the selected project's reserved `Font` destination before writing. Chromium proves `Misc/Font/` cannot masquerade as the root game's font folder.
- **#3405:** Font path and family lookup use the asset resolver's ASCII folding, preserving the distinction between `Élan` and `élan`.
- **#3375:** The grid now consumes its Undo/Redo shortcuts before VS Code's bubbling forwarder and queues them behind its accepted stroke edits. The extension only dispatches the native command for the active font URI; the workbench's existing history callback owns edit reversal and dirty state. The conformance test holds an acknowledgement after the first edit is registered, queues a second stroke and Undo, then proves only the second stroke is undone. The real workbench checks keyboard and palette share one stack and still closes cleanly after Undo.

## Fifth-pass review fixes

- **#3375:** A completed stroke reaches VS Code's native edit stack without waiting for an earlier reply. The grid still sequences its own Undo/Redo requests; direct workbench Undo (such as from the command palette) can take back the latest stroke even with acknowledgements held. Font snapshots travel separately so late replies cannot roll back the Undo view.
- **#3408:** Release submits all traversed cells, even when the view's stale rows match the stroke. The document, not the view, decides whether the command changes anything.
- **#3409:** Exact ASCII-folded basenames win before the separator-insensitive family alias.
- **#3410:** VS Code identifies the active game using the editor's ASCII-folded document identity, which does not conflate `Élan` and `élan`.
- **#3411:** Boot reports and skips bitmap fonts other than version 2.0; the editor can still inspect a structurally readable non-2.0 file.
