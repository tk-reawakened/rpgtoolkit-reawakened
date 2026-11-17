# Shared editor styling: implementation and handoff

11.23/[#2988](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2988) applies the [shared design language](editor-design-language.md) to existing editors. This record is in progress: implementation is not a claim that the final cross-host appearance gates have passed. The earlier [11.22 candidate record](editor-design-validation.md) remains historical, not shipping evidence.

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
- Browsing, theme, shelf layout and text-scaling probes must leave authored bytes and document dirty state unchanged. Ordinary forms can scroll vertically; canvas/code panning is not confused with clipped form controls.

## Complete migration boundary

| Current family | Shared presentation owner | Native mapping / remaining owner |
| --- | --- | --- |
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

## Verification recorded so far

Initial browser/native captures are historical observations, not the accepted source-coherent comparison. The isolated baseline exposed stale referenced workspace output [#3107](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3107); source hashes and copied CSS alone did not establish that the bundled JavaScript matched the checkout. Fresh comparison uses pinned main `4ff4ed3dee07c66119867f5a859a797797a4b798`, actual source-rebuilt hosts, and matched probes. Earlier measurement blind spots [#3056](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3056) and [#3058](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3058) are also not accessibility certifications.

Local browser functional regressions passed 39/39 with one worker (87.07s), including host/lifecycle/program/artwork/board/animation/tile-bitmap behavior and actual save, undo, refusal/recovery, targeting and Monaco CSP checks. The new opening case holds an actual native read, causes a real removed-entry failure, verifies control/choice recovery, restores the file, retries to the actual form and independently compares backing bytes. Both [fresh counterfactuals](captures/editor-style/2026-11-17/opening-regression-negative.json) failed when pending feedback or native disabling was removed; restoring the exact source passed 1/1 (1.3s case). No mock successful I/O or model-only saved label supplies those results.

The browser editor is the real shared host served by the existing engineering entrypoint; no installed editor PWA is wired here. VS Code evidence must use actual VS Code Web and report its version/themes, not a simulation adapter or desktop claim. Before/after receipts identify exact working source/build/fixture bytes; a repository commit label alone is not proof that uncommitted capture inputs were exercised.

For each fresh isolated checkout, use Node 24 and build referenced workspace outputs **before** starting either capture process:

```sh
pnpm exec tsc -b packages/host-web packages/host-vscode --force
node packages/host-vscode/build.mjs
node extensions/editor/build.mjs
```

Then run the browser shipping gallery or opt-in native proof. Keep real hosts serial. Native board canvas and opened board properties are separate cases; the character case includes the existing sibling graphics and authoring views. Closed, unpainted disclosure content is not counted as painted text.

Forced-colors selected text also receives a focused DOM-text screenshot-raster check: [#3094](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3094) showed that UA backplates can hide the actual glyphs while computed foreground/background and the focus outline still pass. This narrow raster check and computed-color samples are regression guards, not a complete accessibility certification or a measurement of native UA internals.

Partial native palettes and forced-colors backplates are separate cases. Selection markers do not reuse a possibly black native button background, and links use link ink. The system-color paint exception covers current selected Files/Game rows, palette choices and enabled primary actions as well as pressed tools; native code controls and authored artwork are excluded.
