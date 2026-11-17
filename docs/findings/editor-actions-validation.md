# Focused editor actions validation

Issues: #2935, #2936, #2937 and #2939 (Epic 11).

Implementation derives from [focused editor actions](../editor-features.md#focused-editor-actions) and the existing board canvas contract. No engine state, goldens or dependencies changed.

## Negative proofs

For each row, temporarily replace the named source expression, run `pnpm build`, then run `node --test --test-name-pattern="<pattern>" <test file>`. Restore the source, rebuild and repeat the same test. Every mutation below produced an assertion failure for its claimed behavior; every restored run passed.

| Claim | Temporary mutation | Test / name pattern | Result |
|---|---|---|---|
| tab-switch cleanup | `new MutationObserver(refresh) → new MutationObserver(() => {})` | `packages/editor-ui/test/editor-commands.test.ts` — `editor commands execute` | Failed, then passed |
| split focus | `active = root; refresh(); → refresh();` | `packages/editor-ui/test/editor-commands.test.ts` — `split views follow` | Failed, then passed |
| live disabled refusal | ` || disabled(element)) return; →  ) return;` | `packages/editor-ui/test/editor-commands.test.ts` — `disabled actions and Save` | Failed, then passed |
| reveal collapsed action | `if (parent instanceof HTMLDetailsElement) parent.open = true; → if (parent instanceof HTMLDetailsElement) parent.open = false;` | `packages/editor-ui/test/editor-commands.test.ts` — `collapsed actions reveal` | Failed, then passed |
| real board tool execution | `if (!field) element.click(); → if (!field) return;` | `packages/editor-ui/test/board-tools-view.test.ts` — `real board icon` | Failed, then passed |
| palette scrolling | `document.getElementById(`${paletteId}-option-${clampedIndex}`)?.scrollIntoView({ block: "nearest" }); → void paletteId;` | `packages/editor-ui/test/shell.test.ts` — `palette keyboard selection` | Failed, then passed |
| single shortcut save | `event.stopPropagation();         registry.execute("file.save"); → registry.execute("file.save");` | `packages/editor-ui/test/shell.test.ts` — `shared Save settles` | Failed, then passed |
| tileset Save registration | `data-editor-save="true" disabled={saveDisabled} → disabled={saveDisabled}` | `packages/editor-ui/test/tileset-art-view.test.ts` — `real tileset view exposes` | Failed, then passed |

The disabled-action case uses a live `aria-disabled` change before observer delivery. A native `disabled` button alone still suppresses `.click()` when the adapter guard is removed; it cannot establish that the adapter itself enforces the accessibility state. The strengthened test catches that mutation (#2947).

The shared Save test mounts a real program document and pending text surface, counts document saves and attaches a target-level Save binding like Monaco. Removing capture propagation suppression invokes the target binding; restored code saves once, including distraction-free mode. The board and tileset cases use their actual document views.

## Browser checks

The browser checks use the real workbench and origin-private project storage. Board proofs cover top-down and both isometric layouts, drawing, layer visibility, undo/redo, Save and backing bytes. The focused-editor proof covers tool activation, tab changes, long-list keyboard scrolling and the shared Save action. Program proofs cover Monaco, immediate F1 typing, mirrored caret ownership and command hit-testing above distraction-free mode.

New unit cases ran individually below one second (approximately 2–386 ms during local runs). Browser integration proofs intentionally exercise the real browser and storage rather than serving as ordinary unit tests.

Browser negative proofs rebuild `pnpm browser:build` before each run and after restoring:

- Remove the selected option's `scrollIntoView` call in `command-palette.tsx`; run `editor-board-canvas.spec.ts --grep 'focused editor palette'`. The selected result fails `toBeInViewport`. Restore the call: the test passes, including list bounds and retained search focus.
- Restore the old palette `z-index: 120` in `tileset-browser.css`; run `editor-program.spec.ts --grep 'a program edits'`. The focused-editor command fails the `elementFromPoint` hit-target assertion. Restore `1200`: the test passes and the command exits distraction-free mode.

Both use Playwright with one worker against `tools/browser/serve.mjs` serving the freshly built browser page. Existing Playwright config also runs these files; the local focused run used port 4187 and omitted unrelated desktop/mobile builds.

## Results

- Full `pnpm test:strict`: 5,084 tests passed, zero failures/skips. Existing duration advisories remain; the new board case was reduced to a 2×2, one-layer fixture afterward and rerun individually (117 ms).
- Editor UI suite: 258 tests passed.
- Browser: 35 selected editor checks passed across the main run and the targeted rerun of the F1 focus race; all 12 board/program checks passed together after that fix. The additional focus-mode hit-target check and both browser negative proofs pass after restoration.
- `pnpm typecheck`, `pnpm lint`, `pnpm provenance`, `pnpm graph`, `pnpm licence`, `pnpm catalogue:check`, `pnpm command-docs:check`, `pnpm editor-ui-toolchain:check`, and `pnpm golden` passed.
- Independent agent review found Save registration, duplicate shortcut handling, distraction-free Save/overlay visibility, selection-action availability and data-choice filtering gaps. Each is tracked under the implementation issues and fixed.

These changes target the shared browser/desktop workbench palette. They do not add native VS Code extension command registrations.

## Help and metadata follow-up (#2952, #2953)

Generic file-watching notices moved from editor surfaces to the bundled `docs/help/saving.md` page, exposed through the registered `help.saving` command. Actual conflict and save-error UI remains in place. Board dimensions and layer count now share the layer-visibility row.

The existing shell help test verifies the page content and focus restoration. Temporarily substituting an empty markdown string for `SAVING_HELP_MARKDOWN` makes its content assertion fail; restoring it and rebuilding passes. The classifier test verifies that both `docs/help/saving.md` and a future help topic trigger CI. Removing the `docs/help/` exclusion from the inert-path predicate fails that test; restoring it passes. Both checks were run by their test-name patterns, with `pnpm build` before each shell run.

Relevant editor suites (130 tests), board/shell follow-up suites (66 tests), CI classifier tests (21), and editor-toolchain tests (21) passed. The real focused-editor browser proof passed with the compact metadata row. Typecheck, lint, generated-help freshness and headless goldens were rerun for this follow-up.

## CI repair after integrating main (#2955, #2956, #2957)

Run 44005260159 exposed three integration gaps: the merged changelog needed regenerated Help, host conformance still required the removed generic banner, and the native VS Code board proof clicked a layer checkbox inside the closed disclosure. The generated Help was refreshed, ADR 0022 D3.5 was clarified in a docs-first commit, and the proofs now follow the requested presentation. Conflict, capability, pixel, undo and persisted-byte assertions remain intact.

- On Node 24.21.0, `pnpm test:strict` passed 5,109 tests with no failures or skips. All 78 host conformance cases passed; typecheck, lint, generated-help freshness and headless goldens passed.
- To verify the new absence assertion, temporarily insert `<p>This host cannot watch files.</p>` before the settings status, run `pnpm build`, then run `node --test --test-name-pattern='capabilities are truthful' tools/editor-vscode-test/test/host-conformance.test.ts`. All three host cases fail with `generic file-watching help does not occupy the editor`. Restore, rebuild and rerun: all three pass, individually below 100 ms. A preliminary source-only mutation without rebuilding did not exercise the consumed package output and is not counted as evidence.
- The actual VS Code web proof passed settings, board (all three layouts), artwork and bitmap for the cancel path, including the repaired layer disclosure. Its subsequent New Project destination-picker timeout is tracked separately as #2958; this run is not claimed as a complete native-proof pass.
- Independent review of the repairs found no actionable issues.

### Native workbench readiness (#2958, #2960)

The complete local reruns exposed two host-transition races: the destination folder picker did not initialize within the default five-second assertion, and a restored editor dismissed the package command palette opened before its activation settled. The proof now observes the destination title within the same 30-second budget as its directory entries, waits for the saved title in the restored editor, and dispatches Package Game through the existing bounded pre-dispatch helper. It never repeats an accepted wizard step or a dispatched package command.

After these changes, the complete unflagged `tools/editor-vscode-test/run.mjs --extension extensions/editor --workspace <authored Example copy> --game Main/example.gam` passed on Node 24.21.0, including both cancel and keep paths, all three board layouts, native History, New Project, saved package bytes, artwork, bitmap, physical write refusal and reload. Proof typecheck and scoped ESLint pass. Independent follow-up review found no actionable issues. No assertions, package outcomes or persistence checks were removed.
