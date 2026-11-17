# Shared editor styling: implementation and handoff

11.23/[#2988](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2988) applies the [shared design language](editor-design-language.md) to existing editors. The local actual-host appearance and functional proofs below passed; independent review and exact-head PR gates remain separate requirements. The earlier [11.22 candidate record](editor-design-validation.md) remains historical, not shipping evidence.

## One set of roles

The canonical definitions remain in [`tileset-art.css`](../../packages/editor-ui/src/tileset-art.css). Common controls and workbench layout consume them in [`tileset-browser.css`](../../packages/editor-ui/src/tileset-browser.css); program chrome consumes them in [`program-view.css`](../../packages/editor-ui/src/program-view.css). Product packages do not import the candidate palette or gallery CSS.

| Role | Standalone light | Standalone dark | Native VS Code ownership |
| --- | --- | --- | --- |
| App / panel / document | `#f3f5f8` / white / white | `#0d121d` / `#151e31` / `#101722` | Sidebar, editor widget and editor backgrounds |
| Elevated surface | White | `#202b40` | `quickInput.background`, with correct CSS-variable capitalization |
| Art stage | Neutral `#e8e8e8` | Neutral `#242424` | Neutral surround; actual artwork is not recolored |
| Ordinary / supporting text | `#202938` / `#4c5a6d` | `#f2eee4` / `#b4bed0` | Foreground / description foreground |
| Primary action / foreground | `#805900` / white | `#f4c85b` / `#28200d` | Paired button background / foreground |
| Selection / foreground | `#f5e8c5` / ordinary ink | `#493c20` / ordinary ink | Paired active-selection background / foreground; an omitted native fill falls back to the native editor canvas, never standalone gold with host ink |
| Strong control boundary | `#46566c` | `#8291aa` | Contrast border, then neutral description ink; a decorative input border is not assumed readable |
| Keyboard focus | `#005fcc` | `#f4c85b` | Native focus border, two-pixel outline plus offset |
| Selection marker | Primary-action gold | Primary-action gold | Native active-contrast border, then native focus ink; separate from button fill |

Supporting help, ordinary controls, section identity and document identity use the existing 12/13/14/15px-equivalent relative type steps. Spacing roles retain the 4px rhythm. These are common UI roles, not overrides for authored code fonts/colors, native Settings or canvas pixels. Actual forced-colors uses system color pairs and visible outlines/borders; it does not preserve branding with `forced-color-adjust:none`.

Keep primary-action and selected-action foregrounds paired with their respective backgrounds. They are not interchangeable: the host may use a blue selection with white text while the standalone palette uses a pale or dark gold selection. Hover/selected child labels and glyphs inherit the checked pair rather than reintroducing muted ink.

## Layout and states

- Global identity/status uses ordinary wrapping flow, not an absolute pill over commands or a reserved gap for an overlapping brand. Keep the existing single shared Save and named Run/Test actions.
- Program bookmarks and command reference remain the existing toggleable supporting views. Named container queries place them below full-width code when a column layout would squeeze the document; their own lists can scroll. Monaco and native VS Code text remain their existing owners.
- Enabled read-only fields retain full-opacity selectable text and a distinct border; they do not inherit disabled styling. Native disabled semantics still prevent activation. Invalid proposals, dirty state, saving and refusal retain their real labels/model outcomes, not color-only substitutes.
- Browser project opening uses a native disabled fieldset plus truthful live status. The selected project/game stays intact through refusal, and controls recover when the current request settles. No styling-specific project authority or guessed successful open exists.
- The session-copy file input remains native and labelled. Its visible label receives the real `:focus-visible` indicator. Expanded landing content has a native scroll route rather than losing lower controls behind the fixed-height shell.
- Browser Preferences uses the existing bounded, scrollable picker panel around its real form and Close action. The wrapping application header keeps its intrinsic height at enlarged text sizes instead of shrinking across the next command row.
- Board loading, unavailable-picture and decoder warning text uses an opaque semantic panel over the art stage. Real decoder warnings remain visible; neither the checkerboard nor authored canvas pixels supplies the text's backing color.
- Browsing, theme, shelf layout and text-scaling probes must leave authored bytes and document dirty state unchanged. Ordinary forms can scroll vertically; canvas/code panning is not confused with clipped form controls.

## Complete migration boundary

| Current family | Shared presentation owner | Native mapping / remaining owner |
| --- | --- | --- |
| Browser landing / project opening | Existing browser project/GAM selection, session-copy input and live opening status | Browser host owns its native File System Access lifecycle; VS Code project/workspace chrome remains native |
| Workspace, commands, tabs, Save/status | Shared workbench stylesheet and existing shell | Native tabs/groups, commands and lifecycle remain host-owned |
| Game / Files navigation, lists and shelves | Existing shared views and common control/state roles | Existing native/contributed navigation; no new provider inventory |
| Board, properties and retained P0 object tools | Existing board toolbar, disclosures, object lists/inspector, fields, references and stage | Shared custom-editor content; specialized focus-following workspace stays [30.1/#2974](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2974) |
| Character | Existing identity, graphics/assignment fields and section controls | Shared `.tem` custom editor; specialized hierarchy stays [29.1/#2962](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2962) |
| Item / absent enemy provider | Existing sprite/reference form | Expanded item [#1722](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1722), absent enemy [#1734](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1734); no pretend enemy editor |
| Tileset artwork, tile bitmap, animation | Existing tools, collections, stages, feedback and common fields | Shared `.tst`/`.tbm`/`.anm` custom editors; authored pixels/frames retain their models |
| Program | Common toolbar, bookmarks/reference/help and responsive supporting views | Standalone Monaco preferences preserved; native TextDocument editor remains native |
| Game settings | Existing form, grouping, validation and persistence labels | Shared `.gam` custom editor; no editor preferences stored in game data |
| Editor preferences | Existing browser PreferencesView and semantic fields | Native `rpgToolkit.editor.*` Settings stay native, not another custom webview |
| Empty/loading/dirty/saving/refused/read-only | Actual owning view/model plus semantic roles | Existing lifecycle, real I/O and native status; no synthetic save or placeholder action |

Existing board `.tan`/`.tbm` decoding defect [#2698](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2698) is not a styling fix. Specialized 29/30 composition, absent providers and standalone Git are not silently added to this migration.

## Consumer rule for 29.1 and 30.1

Reuse the canonical roles, native controls, selected/focus distinction, reference action vocabulary and actual document lifecycle. Put task-specific hierarchy in the owning editor contract; do not add another palette, duplicate Save/Run system, focus engine or document store. A new component needs a concrete consumer and the [existing component/action contract](editor-design-language.md#shared-component-and-action-vocabulary), not a second universal widget framework.

## Source-built before and after

The [portable evidence index](captures/editor-style/2026-11-17/index.json) retains **448 unmodified PNGs** and ten complete compressed receipts: 224 frames per phase. BEFORE is capture-only `1d0b666818fadea23a06d9f8648c459f0a40c032`; six browser production inputs and native CSS match pinned main `4ff4ed3dee07c66119867f5a859a797797a4b798`. AFTER is `a6f545712a8f44a6f4e57d22537b5d966ce53b76`. Both phases use identical capture algorithms, actual source-rebuilt hosts and recorded build/fixture fingerprints.

| Actual-host mode | BEFORE frames | BEFORE measured violations | AFTER frames | AFTER measured violations |
| --- | ---: | ---: | ---: | ---: |
| Chromium shared editor, surfaces and return paths | 107 | 3728 | 107 | 0 |
| Chromium landing/read-only and real I/O states, three themes | 36 | 631 | 36 | 0 |
| VS Code Web native/custom editor matrix | 81 | 2936 | 81 | 0 |

The completed non-green BEFORE runs record old styling, not runtime success or accepted styling. Both native phases use VS Code **1.148.0-insider**, pinned to workbench commit `863bc0ba9e89df07ecf700ce40f2fa35b2a3b123`, Chromium **156.0.8078.4**, Node **24.21.0**, four actual native themes, normal/640px panes and representative 200% root text. Browser evidence uses real Chromium light/dark/forced-colors modes, normal/640px panes, actual Preferences/palette return paths, long identities and enlarged text. Native board canvas and opened properties are separate cases; character includes its existing composed graphics and authoring views. Board captures await the actual transient loading label with bounded backoff, preserving settled decoder warnings.

Every retained PNG has a SHA-256 receipt. Full measurements are in `manifest.json.gz`; `gzip -dc` reads them. Portable receipts replace machine-specific home/checkout/evidence paths only, not measurements or result flags, and record distinct raw/portable hashes. The index names which invariants apply to each mode: a false “not run in this mode” flag is preserved, not rewritten as success. Native source/build hashes remain unchanged during capture, all 26 fixture receipts are preserved, and applicable browser backing-byte/dirty-state invariants pass.

The actual light-theme New board validation frame also exposed an existing overlapping native validation bubble and inline error ([#3146](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3146)); the comparison records that limitation rather than claiming the two messages never overlap.

Initial captures are historical observations, not this accepted comparison: [#3107](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3107) exposed stale referenced workspace output despite matching source and copied CSS. Source hashes alone do not prove that a bundle was built from that source.

## Guards that demonstrably fail

[Retained paint counterfactuals](captures/editor-style/2026-11-17/paint-guard-negatives.json) include full receipts and 17 actual PNGs. Removing the session label outline fails browser keyboard focus; removing native board focus fails even though its computed width remains 3px and contrast remains 18.49:1. Removing the preview feedback panel fails at 1.23:1. Removing the system-color paint exception makes selected-label glyphs fail the focused screenshot-raster guard at 1:1 while the outline still passes. White-on-white program help fails the helper-text guard.

The removed-outline experiment first exposed a false green [#3120](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3120): width, color and viewport geometry did not prove an outline was painted. Both host guards now reject `none`/`hidden` outline styles. Exact production CSS was restored before the complete green AFTER comparison.

For selected/pressed controls, both host probes briefly neutralize and restore selection attributes and classes on the same control without activating it or changing inline styles; finite CSS transitions are settled before measurement and after restoration. Focus and hover therefore stay on the same element, and the original state is restored synchronously before screenshots. The [selection-only counterfactual](captures/editor-style/2026-11-17/negative/selection-versus-focus/proof.json) removes selection paint while leaving a visible focus outline; both hosts correctly fail. This is a targeted regression check, not a substitute for real keyboard interaction or an accessibility audit.

The [weak-cue counterfactual](captures/editor-style/2026-11-17/negative/selection-cue-contrast/proof.json) leaves the ordinary border intact and adds only a nearly invisible selected marker. Both the browser and rebuilt VS Code Web proof reject it; the native proof also rejects stale copied styles before capture. Selected contrast is assessed on changed, drawn fill, borders or pseudo-elements, not on an unrelated border or focus ring. Other paint mechanisms are not certified by this check.

The [focused-shelf counterfactual](captures/editor-style/2026-11-17/negative/focused-selected-shelf/proof.json) separately removes the selected marker while the same selected button retains a 10.51:1 focus outline and a 5.21:1 ordinary border. It fails for the missing selected cue, then passes with the marker restored.

Both hosts also reject a [subpixel-only selected marker](captures/editor-style/2026-11-17/negative/subpixel-selection/proof.json). The CSS-based guard conservatively requires at least one CSS pixel for a selected border's thickness and each dimension of a pseudo-element; this is a regression threshold, not a claim of universal perceptibility.

Forced-colors selected text uses actual DOM-text screenshot rectangles because UA backplates can hide glyphs while computed colors pass ([#3094](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3094)). This narrow raster check and computed-role samples are regression guards, **not complete accessibility certification or measurement of native-UA internals**. The system-color paint exception preserves the user's system pair, not branding; native code and authored artwork are excluded. Partial native palettes separately fall back to native canvas/ink and use an independent selection marker.

## Functional proof and reproduction

Local browser behavior passed **40/40** with one worker, including the retained P0 board-object authoring path and actual save/undo/reopen/refusal/recovery/targeting/Monaco CSP scenarios. The real VS Code board-object proof separately passed definition visits, native confirmation and saved-record checks. Existing program/settings/form/Preferences model/DOM coverage passed **85/85**, with every ordinary case under one second.

The opening regression holds a real native read, removes the actual GAM entry to cause refusal, checks control/choice recovery, restores the file, retries to the real form and independently compares backing bytes. Both [opening counterfactuals](captures/editor-style/2026-11-17/opening-regression-negative.json) fail when disabling or pending feedback is removed; exact restored source passes. No mock successful I/O or model-only saved label supplies these results.

The functional runs use Node 24 and these local commands (the VS Code download cache may be shared with the isolated baseline to retain the same host version):

```sh
PLAYWRIGHT_PORT=4197 pnpm exec playwright test \
  tools/browser/tests/editor-web-host.spec.ts tools/browser/tests/editor-lifecycle.spec.ts \
  tools/browser/tests/editor-program.spec.ts tools/browser/tests/editor-artwork.spec.ts \
  tools/browser/tests/editor-board-canvas.spec.ts tools/browser/tests/editor-board-properties.spec.ts \
  tools/browser/tests/editor-board-objects.spec.ts tools/browser/tests/editor-animation.spec.ts \
  tools/browser/tests/editor-tile-bitmap.spec.ts --workers=1 --reporter=list
node --test packages/editor-ui/test/program-view.test.ts packages/editor-ui/test/settings-view.test.ts \
  packages/editor-ui/test/game-settings-form.test.ts packages/editor-ui/test/preferences-view.test.ts
TKR_VSCODE_BOARD_OBJECTS_PROOF=1 node tools/editor-vscode-test/run.mjs \
  --extension extensions/editor --workspace docs/spec/examples/game --game Main/example.gam
```

After normal [repository setup](../../CONTRIBUTING.md), use Node 24 in **each isolated checkout** and build referenced source before starting capture:

```sh
pnpm exec tsc -b packages/host-web packages/host-vscode --force
node packages/host-vscode/build.mjs
node extensions/editor/build.mjs
node tools/editor-design/gallery.mjs --shipping --phase=after --out=/tmp/editor-surfaces
sleep 2 # Let the owned browser host settle before starting the next one.
for theme in dark light highContrast; do
  node tools/editor-design/gallery.mjs --shipping --phase=after --states-only \
    --theme="$theme" --out="/tmp/editor-states-$theme"
  sleep 2
done
TKR_VSCODE_DESIGN_PROOF=1 TKR_EDITOR_DESIGN_PHASE=after \
  TKR_EDITOR_DESIGN_OUT=/tmp/editor-native \
  node tools/editor-vscode-test/run.mjs --extension extensions/editor \
    --workspace docs/spec/examples/game --game Main/example.gam
```

Run hosts serially with settling between processes. Use `before` in the isolated capture-only revision for baseline runs; expected styling failures must still complete their matrices. Reusing the same native test-download cache keeps the compared actual host version aligned. The dedicated native proof typecheck includes `design-proof.ts`; lint alone is not that check ([#3116](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3116)).

The browser engineering host is not an installed editor PWA. Actual VS Code Web is not a desktop simulation or a desktop proof.

## Key source files

- [Browser actual-host capture and paint guards](../../tools/editor-design/gallery.mjs)
- [Native capture, settled-state checks and paint guards](../../tools/editor-vscode-test/design-proof.ts)
- [Actual browser opening lifecycle](../../tools/browser/editor-web/main.tsx) and its [native-I/O regression](../../tools/browser/tests/editor-web-host.spec.ts)
