# Shared editor design validation (11.22 / #2987)

## Result and reproducibility

The [recorded run](captures/editor-design/2026-11-17/manifest.json) contains **120 actual-editor surface captures and nine real state captures**, completed locally on 2026-11-17 in 56.88 seconds. This validates candidate common roles and establishes the 11.23 migration contract; it does **not** claim a shipped restyle, whole-view accessibility certification, installed PWA proof or native VS Code visual proof.

Host: Chromium **156.0.8078.4**, Node **24.21.0**, macOS/arm64. Baseline: `5ce9dbbda611d35f8c376ecdc1052837c028b11e`, branch `feat/2987-editor-design-contracts`. The capture source was uncommitted at that baseline: `workingInputs` records SHA-256 fingerprints of the actual gallery, candidate CSS, state driver, host HTML and built JS/CSS. Those fingerprints, not the baseline SHA alone, identify the exercised implementation. `provenance` records the authored/generated fixture paths, project-relative paths, byte sizes and SHA-256 values.

After the normal repository setup/build:

```sh
pnpm exec node --version # 24.21.0
pnpm editor:design-gallery --out=/tmp/tkr-editor-design
# Focus a local investigation without running the full matrix:
pnpm editor:design-gallery --surface=game-settings --theme=light --pane=640 --out=/tmp/tkr-settings
pnpm editor:design-gallery --states-only --out=/tmp/tkr-states
```

Use the pinned Node executable explicitly if a background launcher resolves a different `node`; an initial engineering run used Node 26.13.0 and was replaced by the recorded pinned-runtime run. No extra dependencies, installed-browser profile or external game download are required beyond the existing setup. `EDITOR_DESIGN_PORT` optionally supplies a dedicated listener; otherwise the command chooses a local port. It owns and closes its browser/server only.

Artifact disclosure notes: all project content is the repository's authored fixture or generated synthetic data. Per-run UUIDs identify synthetic capture sessions, not devices/people; the recorded host URL is loopback, not a LAN/WAN endpoint. No user browser profile, home-directory content, live credential or device identifier is captured.

## What was exercised

The command builds the existing browser editor and opens the actual `host-web`/`editor-ui` workbench. It copies the small authored `docs/spec/examples/game/` project into isolated browser OPFS, preserving source files. `Game/Example/` contents become project-relative resource folders. Sparse examples are encoded with the existing format readers/writers, not fake providers: minimal game settings, one empty board cell, character/item graphics references cleared, a uniform tile, an empty program and the authored minimal chest animation. Source fixture hashes are checked again after capture.

Fifteen existing document surfaces run at a 1280×900 normal viewport and a separately **measured 640px-wide document pane**. Normal panes are 1039px for board/tile-bitmap views and 750px for the other views in this layout; narrow outer viewport sizes differ accordingly. Each case records its actual pane rectangle. Every surface/size has an unmodified current-dark capture plus candidate dark, light and real browser `forced-colors: active` captures: 15 × 2 × 4 = 120. Candidate geometry is measured again after applying each theme.

Candidate styles remain isolated in `tools/editor-design/`; no product package imports them. Semantic defaults use the existing `--tkr-*` family and native controls. Artwork remains authored pixels on a neutral stage. The high-contrast palette calculations are a reference; actual forced-colors screenshots/computed styles reflect Chromium's system-color mapping, not a pretend yellow-on-black browser theme.

### Measured control roles

The palette audit checks 33 semantic foreground/background pairs. Separately, the browser computes effective foreground/background/boundary colors for real enabled controls, including ancestor alpha/opacity composition, and measures the actual keyboard `:focus-visible` outline after Tab. The rendered checks require 4.5:1 text, 3:1 control boundaries and a ≥2px, ≥3:1 focus outline.

| Candidate presentation | Actual cases / controls sampled | Minimum rendered text | Minimum rendered boundary | Minimum rendered focus |
| --- | --- | --- | --- | --- |
| Dark | 30 / 1770 | 9.29:1 | 5.21:1 | 10.51:1 |
| Light | 30 / 1770 | 6.27:1 | 5.15:1 | 5.98:1 |
| Forced high contrast | 30 / 1770 | 9.10:1 | 9.10:1 | 9.10:1 |

Values above are rounded; the manifest retains individual raw measurements. Disabled controls, authored color swatches and Monaco internals are excluded. **Program cases measure the shared Workbench bar**, not syntax colors or every program-side panel. Placeholder/helper text, every label, every state overlay and the complete tab/toolbar keyboard model are not certified by this sample. 11.23 must inspect and verify its actual migrated surfaces.

Actual sampled control text sizes are 11/12/13px; legacy per-view overrides remain visible. Observed padding includes 4px 8px, 6px, 2px 4px, 6px 4px, 2px 6px, 2px 10px, 2px 8px and zero. Observed radii are 0/4/6px. This is a migration baseline, not approval of the inconsistent legacy density. The [shared hierarchy and 4px spacing rhythm](editor-design-language.md#1122-source-and-migration-contract) define the target; 11.23 removes conflicting common-control overrides while preserving code/path typography and host scaling.

**Negative control:** temporarily making real enabled inputs/buttons white-on-white, without changing the mathematical palette, failed locally with `Rendered contrast failure (game-settings/640px/light)` and the actual Game title input at **1:1**. The [retained actual receipt](captures/editor-design/2026-11-17/negative-control.json) includes the observed controls, exact CSS perturbation/command, Node 26.13.0 runtime and restored palette fingerprint. No mutated-input fingerprint was recorded in that negative run and none is invented. The restored palette matches the pinned-runtime final positive manifest. Thus palette math alone cannot make this command green. Mathematical controls also verified black/white at 21:1, equal colors at 1:1 and rejection of an unreadable candidate.

## Annotated real compositions

These links are unretouched captures, not mockups. The annotations distinguish the existing provider/layout from validated candidate common roles and later specialized work. The manifest links every current/candidate, sparse/populated and theme/size counterpart.

| Real example | What to inspect / data owner / return route |
| --- | --- |
| [Board, light, 640px](captures/editor-design/2026-11-17/board-640px-light.png) | The board document owns the scene; paint is selected while Select has a separate blue keyboard outline. Board properties and selection actions remain in the active document. The source browser and placement inspector are separate roles; 30.1 owns their specialized arrangement. Visible TAN/TBM decode warnings are existing [#2698](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2698), not a faithful-composition claim. |
| [Character, dark, normal](captures/editor-design/2026-11-17/character-normal-dark.png) / [sparse](captures/editor-design/2026-11-17/character-sparse-640px-light.png) | The character document owns identity/starting values and graphics references. A reference is not another document tab until opened. Existing technical groups remain visible; the everyday-first hierarchy and specialized section navigation belong to 29.1, not this prototype. |
| [Current item, light](captures/editor-design/2026-11-17/item-normal-light.png) / [sparse item](captures/editor-design/2026-11-17/item-sparse-640px-dark.png) | This is the existing SpriteView for `.itm`, not a fabricated complete item form. Real animation references and previews are shown. Expanded item authoring stays #1722; the absent enemy provider stays #1734. |
| [Tile artwork, forced colors](captures/editor-design/2026-11-17/tileset-normal-highContrast.png) / [sparse tile](captures/editor-design/2026-11-17/tileset-sparse-640px-light.png) | The tile artwork document owns pixels. Native controls and focus change with system colors; the authored green pixels do not. Canvas keyboard help explains how to paint/cancel. Browsing another asset does not itself paint or dirty this file. |
| [Tile bitmap, dark](captures/editor-design/2026-11-17/tile-bitmap-normal-dark.png) | This is the existing `.tbm` editor, a separate provider from SpriteView and the source browser. Keep its source references and edit/save authority, not a replacement bitmap provider. |
| [Animation, light, 640px](captures/editor-design/2026-11-17/animation-640px-light.png) / [minimal animation](captures/editor-design/2026-11-17/animation-sparse-normal-dark.png) | The animation document owns frame/timing data. Current slot-heavy controls are a baseline, not the recommended shared collection design. Shared controls/feedback migrate in 11.23; specialized timeline/hierarchy work is not silently added. Preview playback is not a runner test. |
| [Program, dark, 640px](captures/editor-design/2026-11-17/program-640px-dark.png) / [empty program](captures/editor-design/2026-11-17/program-sparse-normal-light.png) | Program chrome uses the existing Monaco view; syntax/editor authority is not restyled by the prototype. Optional side panels visibly compete with the narrow code area, and some helper/chrome treatment remains unmigrated. 11.23 must retain named keyboard toggles, readable common chrome and a usable code area; native VS Code uses its TextDocument instead. |
| [Game settings, light, 640px](captures/editor-design/2026-11-17/game-settings-640px-light.png) / [sparse settings](captures/editor-design/2026-11-17/game-settings-sparse-normal-dark.png) | `.gam` owns these fields; they are not editor preferences. The form switches to one column at the measured narrow size. Focus is a separate outline; saved/dirty text is not represented by gold alone. Keep the existing Apply/Cancel and shared Save authority. |

Sparse contrasts: the [one-cell empty board](captures/editor-design/2026-11-17/board-sparse-640px-dark.png) is a valid document with no painted scene, not a missing-file error. Unbound character/item graphics preserve their real identity and show reference-entry affordances without pretending an animation exists. The uniform tile remains real editable pixels; it is not a blank placeholder image. The minimal animation has one populated frame while existing empty legacy slots remain visible. The empty program preserves editor/chrome without inventing source text. Minimal game settings leave startup references unset while retaining the real field ownership and warnings; the gallery does not imply a finished playable setup.

Normal document tabs retain resource identity and revisit the same document authority. The source browser remains visible where supported, and document-level controls stay with their document. The top-right host-status pill visibly overlaps commands at narrow widths: [#3028](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3028) must be fixed, not adopted as the default. Named collapsible views and wrapping controls are the target for 11.23; these current-layout captures are not approval of clipping.

### Actual document and proposal states

The state driver pauses/resumes **actual native File System Access reads/writes** to make pending operations observable and holds a real exclusive file lock to exercise write rejection. It does not substitute a model, provider, bytes or successful result; its rejection wrapper only records and rethrows the actual native exception. Native methods are restored and the owned lock is aborted in `finally`.

| State evidence | Observed behavior / authority |
| --- | --- |
| [Empty](captures/editor-design/2026-11-17/state-empty-project.png) | No project/document exists; the current host offers real Open/New/session-copy actions. |
| [Opening pending](captures/editor-design/2026-11-17/state-loading-project.png) | The chosen GAM's native read is paused before a workbench opens. The host still shows its prior chooser message and offers no visible pending treatment: [#3031](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3031), owned by 11.23. This is actual loading evidence and an explicit design gap, not a fabricated spinner. |
| [Dirty](captures/editor-design/2026-11-17/state-dirty.png) | Real title edit applied to `Main/example.gam`; “Unsaved changes” and tab marker appear, backing bytes are unchanged. |
| [Saving](captures/editor-design/2026-11-17/state-saving.png) | Actual native writer paused; “Saving…” is visible, original bytes remain and no durable success is claimed. |
| [Saved](captures/editor-design/2026-11-17/state-saved.png) | Native write completed, bytes changed and “All changes saved” appears. A separate subsequent draft is reverted and the saved title read back from storage. |
| [Native write failed](captures/editor-design/2026-11-17/state-write-failed.png) | An actual exclusive native writer makes the editor's writer acquisition reject with `NoModificationAllowedError`. The view shows “Could not save”, retains its draft/dirty state and preserves backing bytes. Releasing the owned lock permits a real successful retry, followed by a separate draft/revert readback proving the recovered saved title. |
| [Save refused](captures/editor-design/2026-11-17/state-save-refused.png) | A real external valid GAM write conflicts with the retained draft. Existing changed-on-disk reconciliation is shown; the attempted save overwrites neither version. Choosing disk then completes the existing reconciliation route. |
| [Read-only history](captures/editor-design/2026-11-17/state-read-only-preview.png) | The History checkpoint shows the original “Example Game” in disabled preview fields, distinct from the active “Sparse project”. Scrolling the preview into view writes no game bytes. This is not an editable second authority. |
| [Invalid proposal](captures/editor-design/2026-11-17/state-validation.png) | A zero-width New board proposal exposes its associated inline error and native invalid-input message; Create cannot submit it. Cancel creates nothing and retains the active GAM bytes. |

Opening/empty frames use current shipping dark styles. Document/proposal states use candidate dark; they are not a claim of a complete three-theme state cross-product. Each state has a companion JSON record with actual status text, owner and relevant byte fingerprints.

## 11.23 handoff and explicit limits

- Migrate every family in the [source/component inventory](editor-design-language.md#1122-source-and-migration-contract), extending existing semantic tokens once. Preserve #2703, PR #2950 commands/Save, focused-document targeting and document/model/platform-services authority.
- Fix the official VS Code token capitalization [#3017](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3017): `quickInput.background` maps to `--vscode-quickInput-background`, not `--vscode-QuickInput-background`. [Official theme reference](https://code.visualstudio.com/api/references/theme-color#quick-picker).
- Separate enabled read-only fields from disabled opacity/cursors [#3027](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3027); correct header overlap #3028, actual pending-opening feedback #3031 and narrow program chrome [#3032](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3032). Inspect program-side chrome and dense collections, not just the measured Workbench bar.
- Prove actual before/after web/PWA and native VS Code presentation in 11.23, plus any shipped standalone editor. This run is an engineering browser host, not an installed PWA. Native `.gam/.brd/.tem/.itm/.tst/.tbm/.anm` are custom-editor webview panels; programs are native text editors; Game navigation is a separate contributed view. Native tabs/groups, commands, typography and host theme colors take precedence. No nested workspace clone.
- Preserve readable text, distinguish keyboard focus/selection, inspect 640px panes, scaling/long names and supported themes, and verify that theme/layout changes do not alter content, dirty state, Save/Undo/Run or the captured command target. Use actual controls and outcomes, not CSS-source assertions.
- Keep 29.1 character hierarchy and 30.1 board workflow separate. Missing providers (#1722/#1734) and the known board decode defect (#2698) remain named owned work, not counterfeit UI or new completion claims.

## Key sources

- [Shared language and authority trace](editor-design-language.md), [board-specific contract](board-authoring.md), [ADR 0022 lifecycle](../adr/0022-shared-editor-authoring-contracts.md).
- `tools/editor-design/gallery.mjs`: actual build/host/navigation, serial capture, computed measurements and provenance.
- `tools/editor-design/palette.mjs`: isolated candidate roles, paired colors, forced-colors/focus CSS and mathematical contrast.
- `tools/editor-design/states.mjs`: actual native-I/O pending states, byte/readback assertions, conflict/history/proposal interactions and visible state subjects.
- `packages/editor-ui/src/{mount.ts,new-board-view.tsx,tileset-art.css}` and `packages/host-web/src/{index.ts,workbench.ts}`: current composition, native constraint/error handling, shared tokens and workbench boundary.
