---
type: feature
title: "Restore the legacy bitmap font editor"
ticket: 20
tracker_id: "#1939"
status: done
risk: medium
---

## Intent

Let authors create and edit retro game lettering using the glyph grid, character strip and sample preview of the older Toolkit font editor. [T-65](../../../docs/editor-features.md#t-65-bitmap-font-editor) maps to CAP-16.

## Scope and acceptance

Create and open `.fnt` documents through the existing project editor. Select any of the 256 slots and paint or erase ink in its 8 × 8 grid. Make the character selector and pixel grid usable with a keyboard. Preview sample text at a chosen size, with bold, italics and underline. Keep those settings in the view so changing the preview makes no edit to the font. Use shared document identity, undo, redo and save. Reuse the existing bitmap format and rendering code.

## Verification

In both hosts, edit pixels at opposite corners and in different glyphs, undo and redo, save and reopen, and compare glyph rows to an independent expected bitmap. Check an untouched glyph and confirm preview changes leave the document clean. Check visible, hard-edged glyphs at 8 px and 20 px and compare each style with the runner's preview of the same sample. Exercise the saved asset in the runner through `font()`. Check that a refused save leaves the pending glyph edits available for retry.

Ordinary VS Code Undo and Redo must work from the glyph grid and the native workbench, with a clean close after undoing back to the saved bytes. As ruled by the owner on 2026-11-24, when a second native history command overlaps a locked first one, waiting for the pending operation and retrying the refused command is accepted for this story. [#3415](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3415) remains open.

## Dependencies and decisions

Prerequisite: 13.1 (#1727) supplies the shared feature registration and project document route. The [.fnt format](../../../docs/spec/formats/legacy/text-formats.md#font-toolkit-2-text) supplies the file contract. The archived visual description shows the grid, strip and preview. It does not establish keyboard bindings or the original glyph commit workflow. T-65 supplies the Reawakened interaction scope. Keep the startup font compatibility issue (#1938) separate.

The engineer's notes flag a suspected legacy scaling failure above 8 px and describe synthetic styling with antialiasing off. The scaling failure is unverified. Use Reawakened's bitmap rasterizer for visible enlarged glyphs and crisp styling. Synthetic bold and italic and a separate underline belong to the preview, while the saved rows stay monochrome.

[#1942](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1942) tracks a future extension for larger glyph grids. The 8 × 8 legacy grid and the preview's display size are independent. Larger authored glyphs will need their own asset specification.

## Owner rulings and implementation decisions (entry 13.20)

**Owner rulings (Jensen, 2026-11-24; [ADR 0042](../../../docs/adr/0042-project-bitmap-fonts-use-shared-rendering.md)):**

1. The player installs supported Toolkit 2.0 `.fnt` files under the game's `Font\` folder and exposes them through `font()`: [project bitmap fonts](../../../docs/spec/engine/display-input-audio.md#reawakened-project-bitmap-fonts).
2. The editor preview and player share the same [bitmap font ink](../../../docs/spec/engine/display-input-audio.md#reawakened-bitmap-font-ink).
3. The documented retry for overlapping native VS Code Undo/Redo is accepted for this story. This does not fix or close #3415; ordinary Undo/Redo remains required.

**Implementation decisions (not additional owner rulings):**

- New Font starts with 256 empty glyphs at version 2.0 rather than copying the bundled fallback.
- One changed stroke records one `set-font-pixels` command. It carries the traversed cells, not whole rows, so the document preserves other views' unmarked pixels and records no edit for a no-op. The keyboard uses the same command for one cell; Clear glyph uses `clear-font-glyph`.
- The `"legacy-text"` kind follows ADR 0022 D2 through the existing document registry in ADR 0026.

## Implementation notes (2026-11-24)

**Implemented on the draft branch.** `packages/editor-model/src/font-document.ts` (`font`, `.fnt`, `legacy-text`), `font-preview.ts` (lays out text with `layoutText`, builds draw commands for the retained lines and uses the core rasterizer), `font-support.ts` (New Font), the kind registry and `asFontDocument`, the conformance row, `packages/editor-ui/src/font-view.tsx` and its stylesheet, browser New Font and the VS Code `tkr.font` and `tkr.newFont` contributions, help, and runtime installation and replay (`privateFontKeys`, `installedProjectFonts`).

**Implementation decisions.** The grid previews a stroke against the latest rows it has received, but submits the complete cell intent even if those rows already match; stale snapshots cannot discard the user's mark. The authoritative document computes the result, preserving untouched cells and declining no-ops. Later edits do not wait for earlier acknowledgements, while the pending-edit tracker still protects save and close (#2613). The preview uses the core rasteriser and `text()` line height; size, sample, styles and zoom are view state. A host without a 2D canvas reports that limitation. Version 2.0 follows ADR 0022 D2 row 1 as `legacy-text`; another readable version opens read-only.

**Evidence.** Model: `packages/editor-model/test/font-document.test.ts` (round trips, opposite-corner edits saved as the format's rows, untouched glyphs intact, refusals, refused save keeps edits, read-only open, preview equals the spec's pixels at 8 and 20 px in every style, new-font bytes). Engine: `packages/core/test/render-now.test.ts` and `engine-boot.test.ts` (the glyph drawn by `font()` at 8 and 20 px in every style, underline rows, bitmap metrics, install and `font.rejected`). Runner: `packages/runner-web/test/game-fonts.test.ts`. View: `packages/editor-ui/test/font-view.test.ts`. Hosts: `tools/editor-vscode-test/test/font-hosts.test.ts` (browser host, VS Code desktop and VS Code for the Web: edit at opposite corners by pointer and keyboard, save, close, reopen, file equals hand-written bytes, an untouched glyph intact, preview settings leave the document clean).

**Proof boundaries.** The model tests check preview pixels against the core rasteriser, and core tests cover `font()`. The headless host lanes lack a 2D canvas, so their conformance tests check the message and clean document state instead. The packaged VS Code and Chromium proofs below check the actual canvas and New Font dialogs.

**Initial local gates (2026-11-24, Node 26.13.0):** `tsc -b`, every package's `typecheck:tests`, `pnpm graph`, `pnpm lint` (eslint + core deps), `pnpm licence`, `pnpm provenance`, `pnpm catalogue:check`, `pnpm editor-ui-toolchain:check`, `pnpm adr:numbering:check`, `pnpm golden`, `pnpm golden:bun`, `pnpm closing`; focused suites listed above (299 passing, 9 pre-existing skips). The full strict sweep and real browser proofs were not run until the next pass.

## Real-host proofs (2026-11-24, added after the first draft)

**Browser (real Chromium, shipped editor page).** `tools/browser/tests/editor-font.spec.ts` (2/2 passing): a pointer drag across three pixels of the second row, the preview at 8 px compared pixel-for-pixel with the spec's ink and again at 20 px plain, bold, italics and underline, a keyboard edit with `Space`, **Undo and Redo through the workbench's Edit menu**, Save (file equals hand-written bytes), close and reopen (saved glyph shown, untouched glyph intact), and `New font…` twice — Cancel writes nothing, Save creates an empty version 2.0 font and opens it. **A defect this lane found:** `Space` acted on whichever pixel still held DOM focus while the arrow move was being drawn (two pixels behind the cursor after seven presses); the key now acts on the grid's cursor and prevents the browser's own click. Fixed in `font-view.tsx` with the view test still green.

**VS Code web (real vscode.dev client, packaged extension).** `TKR_VSCODE_FONT_PROOF=1 pnpm --dir tools/editor-vscode-test proof -- --extension extensions/editor --workspace <fixture> --game Main/example.gam` passed: `New font` twice (Cancel writes nothing; Enter creates the file and opens the custom editor), a real pointer drag along the last row of A, a keyboard pixel through the cursor, the preview canvas read back and compared with the spec's ink at 8 and 20 px and with bold at 20 px, Save (file equals hand-written bytes), close and reopen with an untouched glyph empty. The unmodified full VS Code web acceptance suite also passed against the same build (`vscode.dev settings, board, art and bitmap proof passed (keep)`), so the new view type broke nothing.

**Initial VS Code evidence gap (#3375).** This first proof did not exercise Undo/Redo: it searched for `Edit: Undo` rather than `Undo` and used the wrong macOS keyboard modifier. Ordinary native history was later proved; the distinct overlap limitation in #3415 remains open, as described in the seventh pass.

**Toolchain note for the VS Code lane:** `extensions/rpgcode` and `extensions/editor` are outside the pnpm workspace, so a fresh worktree needs `npm install` in each and `node packages/host-vscode/build.mjs` before `extensions/editor/build.mjs`.

## Gates re-run after the real-host proofs (2026-11-24)

- `pnpm test:strict`: **5810 pass, 0 fail, 0 skipped**. The first run failed one test — `packages/host-vscode/test/custom-editor-events.test.ts`, which enumerates the kinds it edits and so did not know the new `tkr.font` provider; adding `font` to that list restored its invariant (fixed in `e3a3f6642`).
- `pnpm golden`, `pnpm golden:bun`, `pnpm closing` (8/8 after the explained baseline pin), `pnpm lint`, `pnpm graph`, `pnpm licence`, `pnpm provenance`, `pnpm catalogue:check`, `pnpm editor-ui-toolchain:check`, `pnpm adr:numbering:check`, `pnpm fixtures:author:check`, `pnpm fixtures:test`.
- Real hosts: `tools/browser/tests/editor-font.spec.ts` 2/2 in Chromium; the focused VS Code web font proof passes; the unmodified full VS Code web acceptance suite passes against the same build.
- `pnpm script:dogfood` is not applicable: this change touches no RPGCode source, script-tool input or indexed symbol. `desktop:input`, the Android proof and `desktop:measure` were not run (no emulator or GPU host here, and the change alters no input geometry or desktop loop).

## Undo and redo investigation (#3375)

The initial experiments mixed a view-driven undo with native undo and did not establish the correct macOS shortcut. A route that moves the model behind VS Code's working copy is not used. The browser routes the glyph controls, keyboard and workbench menu to the workspace stack. VS Code routes the glyph controls and shortcuts to its native working-copy stack; the extension serializes grid history and edits without waiting for webview replies. See the later passes for independent acknowledgements and the native-command overlap boundary.

## Review fixes after head 62714caa (2026-11-24, second pass)

**Model: pixel intent, not stale glyph snapshots.** A stroke is one `set-font-pixels` command carrying every traversed cell, applied to the authoritative glyph; Clear glyph uses `clear-font-glyph`. An unchanged result records no edit, and sparse pixel arrays are rejected. Proofs: `font-document.test.ts` covers stale concurrent strokes, invalid commands and no-ops; `font-view.test.ts` covers simultaneous views.

**View: history is the host's.** Browser Undo/Redo call `workspace.undo(document)` and `workspace.redo(document)` — the same stack as the menu and palette. The Chromium proof follows a panel Undo with a menu Redo. A fast drag interpolates cells between pointer moves (`fontLinePixels`), proved in the view and Chromium.

**VS Code: no bypass of the working copy.** Early experiments that modified the model independently of native Undo were discarded. The real workbench proof showed that undoing the only unsaved edit lets the tab close without a save prompt or changed bytes. The later proof covers focused-grid shortcuts on the same stack.

**New Font path.** `projectLayoutOfMain` reads the selected game's main file and determines whether its type folders live at the project root or under `Game/<project>/`. New Font suggests that layout's reserved `Font` folder. Proof: `packages/host-vscode/test/new-font.test.ts`.

**Preview size.** The bitmap-glyph canvas is drawn at 1:1 and enlarged by layout (`data-zoom` classes). `FONT_PREVIEW_MAX_SIDE` (2048) bounds the picture, and the view reports whether it shows only part of the sample. The model test covers truncation; the view and host conformance tests cover zoom without dirtying the font. Chromium checks the sample pixels at 8 and 20 px, not zoom.

**Engine.** `font()` looks first in the installed project fonts, so an unrelated `Boards/retro.brd` cannot shadow `Font/retro.fnt`. Save restoration keeps the live session's font inventory. Missing font bytes report `font.rejected` and do not stall startup. Bitmap rows and version fields must be whole numbers; e.g. `128oops` is refused. Proofs: `engine-boot.test.ts`, `runner-web/test/game-fonts.test.ts` and `format-font.test.ts`.

**Real shipped player.** `tools/browser/tests/project-font.spec.ts` compares shipped WebGL player pixels against the project glyph and against fallback rendering. The third pass connects the package to the editor's saved bytes.

## Review fixes after head 2c4d0012e (2026-11-24, third pass)

**A stroke under a change is rebased, not dropped.** When a snapshot for its glyph arrives mid-drag (another view, an
undo, a reload), the stroke's cells are applied to the rows that arrived, so the pointer keeps painting and the other
view's pixels survive; only losing the right to edit (read-only, a conflict) drops it. View test: an outside edit lands
mid-stroke, the grid shows both, the stroke continues, and its release is one edit carrying only its own cells.

**New Font validates the selected game's layout.** VS Code uses the active game if known and asks which game to use when more than one is available. New Font validates the destination against the chosen layout's reserved `Font` folder before writing. The browser proof also rejects an unrelated `Misc/Font/` path.

**The preview draws only the lines it holds.** The retained-line slice is what is emitted (the same line and glyph data
`emitText` uses), the picture is exactly those lines plus the padding, and a clipped line can no longer reach into it.
Test: 198 characters at 128 px truncate, and no ink is found in the bottom padding rows.

**A pixel command is compared by the rows it ends on.** `[ink(x,y), erase(x,y)]` leaves the glyph unchanged, so no edit is
recorded (an intermediate comparison would have recorded a no-op). Test: the refusal, no edit, `dirty` false.

**The replay uses a captured font inventory, not a folder guess.** Both presenters decode the installed keys from the selected capture, so `Font/Heading/heading.fnt` can render while `Misc/Font/elsewhere.fnt` cannot. The streamed player converts failed optional `.fnt`/`.ttf` fetches into null replies; the engine reports `font.rejected` and continues. A required asset's failure still stops the load.

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
- **#3375:** The grid consumes its Undo/Redo shortcuts before VS Code's bubbling key forwarder. The extension invokes native history only for the active font URI; the working copy owns reversal and dirty state. This pass sequenced grid requests in the view; the sixth pass moved sequencing to the extension host. The real workbench proof checks that keyboard shortcuts and the palette share one stack and that the editor closes cleanly after Undo.

## Fifth-pass review fixes

- **#3375:** A completed stroke reaches the native stack without waiting for an earlier edit reply. Separating snapshots from acknowledgements means a late reply cannot roll back a native Undo. The held-ack case proved native Undo picked the latest stroke once registered; the sixth pass handles a grid Undo between the two strokes.
- **#3408:** Release submits all traversed cells, even when the view's stale rows match the stroke. The document, not the view, decides whether the command changes anything.
- **#3409:** Exact ASCII-folded basenames win before the separator-insensitive family alias.
- **#3410:** VS Code identifies the active game using the editor's ASCII-folded document identity, which does not conflate `Élan` and `élan`.
- **#3411:** Boot reports and skips bitmap fonts other than version 2.0; the editor can still inspect a structurally readable non-2.0 file.

## Sixth-pass review fixes

- **#3375:** The shared VS Code document orders incoming font edits and native grid history requests before sending replies. The view sends both immediately; the next stroke cannot overtake the native command. With both edit acknowledgements withheld, the regression checks stroke A, grid Undo, stroke B, then native workbench Undo: the grid Undo removes A, the workbench Undo removes B, and the saved working copy is clean.
- **#3413:** An exact font asset key wins even when a longer path with the same suffix comes first in the inventory.
- **#3414:** Readable unsupported versions open for inspection with a version-specific read-only reason. Editing or saving them is refused without touching the file.

## Seventh-pass review

- **#3416 fixed:** History refuses to restore a revision into the open editor if that revision is read-only. No edit or file write occurs. Restoring while the file is closed recovers the exact bytes; opening them later gives the read-only version explanation.
- **#3415 remains open (native palette overlap):** VS Code at the proof build [`661626d`](https://github.com/microsoft/vscode/tree/661626d0e72f97806550790a98fb87116c9db825) [warns and returns before invoking the provider](https://github.com/microsoft/vscode/blob/661626d0e72f97806550790a98fb87116c9db825/src/vs/platform/undoRedo/common/undoRedoService.ts#L1012-L1028) when native Undo finds the resource already locked. The lock lasts for the [native callback Promise](https://github.com/microsoft/vscode/blob/661626d0e72f97806550790a98fb87116c9db825/src/vs/platform/undoRedo/common/undoRedoService.ts#L740-L769). VS Code [awaits extension-host RPC](https://github.com/microsoft/vscode/blob/661626d0e72f97806550790a98fb87116c9db825/src/vs/workbench/api/browser/mainThreadCustomEditors.ts#L771-L786) even when the extension callback itself returns synchronously, as ours does. The [public commands API](https://github.com/microsoft/vscode/blob/661626d0e72f97806550790a98fb87116c9db825/src/vscode-dts/vscode.d.ts#L10976-L11033) offers no interception or notification hook for that refused native action. We do not replace global Undo. If native VS Code warns, repeat the action after the prior Undo or Redo completes. Held webview acknowledgements are a different boundary, so those passing tests do not close this issue.

The owner accepted the documented retry on 2026-11-24 ([ADR 0042](../../../docs/adr/0042-project-bitmap-fonts-use-shared-rendering.md)). #3415 no longer blocks #1939 on that basis and remains open for the platform limitation.

## Integration review

- Browser New Font follows the browser New Program disclosure: it warns before asking for a path that a file another application creates between the existence check and write may be replaced. The browser file API does not provide an atomic create-if-absent operation. A detected collision is refused without changing the existing file.
- The real Chromium and focused vscode.dev font proofs both use Save buttons, not the Save shortcut on a font. The font zoom setting is checked in the view and host conformance tests; the real-browser canvas checks compare the ink at 8 and 20 px, not its zoomed display.

## Closure verification

Implementation [PR #3361](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3361) merged at `2e4b2f542776428d3087d924bf418a5adb8a68a0`, verified on `origin/main`. Its tree matches the reviewed PR head exactly, and [CI passed](https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/45508345798). [#1939](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1939) is closed and its Roadmap card is `done`.

| Acceptance clause | Evidence run at the merge revision |
| --- | --- |
| Create/open version 2.0 `.fnt` files and browse the 256-slot strip | `tools/browser/tests/editor-font.spec.ts:241–280` verifies the warning, cancellation, wrong-folder and case-folded collision refusals, then checks the new file's empty glyph bytes and slot labels. `tools/editor-vscode-test/web-proof.ts:3036–3120` creates and opens a font in packaged vscode.dev. |
| Draw with pointer and keyboard; undo and redo through the host | `tools/browser/tests/editor-font.spec.ts:138–222` exercises the real grid, workbench menu, buttons and keyboard. `tools/editor-vscode-test/web-proof.ts:3123–3135,3159–3172,3188–3200` exercises focused grid Undo/Redo and workbench Undo on the same native stack, then closes a clean tab after Undo. The host conformance suite also checks delayed webview acknowledgements. |
| Crisp preview at 8 and 20 px with bold, italics and underline; preview state does not edit the glyphs | `tools/browser/tests/editor-font.spec.ts:138–193` and `tools/editor-vscode-test/web-proof.ts:3137–3157` compare canvas pixels with the specified bitmap coverage. `packages/editor-ui/test/font-view.test.ts:420–449` and `tools/editor-vscode-test/test/font-hosts.test.ts:197–247` check preview state, including zoom, without editing or dirtying the font. |
| Save/reopen with untouched glyphs intact; preserve edits on a refused save | Both real hosts compare saved bytes with independently authored expected rows and reopen the font (`editor-font.spec.ts:224–238`; `web-proof.ts:3174–3186`). `packages/editor-ui/test/font-view.test.ts:451–469` refuses a write, checks that the dirty glyph and original file are preserved, then retries successfully. |
| Render the editor-saved font in the shipped player | `tools/browser/tests/project-font.spec.ts:194–256` packages bytes saved by the font document and compares the player's WebGL pixels for `font()` with the author's glyph and the bundled fallback. |

`pnpm build` and the seven focused Node suites passed (124 tests, no skips). Chromium passed all four cases across the `editor-web` and `player` lanes, and `TKR_VSCODE_FONT_PROOF=1 pnpm --dir tools/editor-vscode-test proof` passed against the packaged extension and `Main/example.gam`. The real host cases used Save buttons rather than the Save shortcut; zoom is covered by view and host conformance. The owner accepted retrying a refused overlapping native history command ([ADR 0042](../../../docs/adr/0042-project-bitmap-fonts-use-shared-rendering.md)); [#3415](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3415) remains open and was not fixed by this merge.
