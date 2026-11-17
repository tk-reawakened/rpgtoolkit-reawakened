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
