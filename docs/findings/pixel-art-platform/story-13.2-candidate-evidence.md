# Story 13.2 — fresh art-library evidence

**Issue:** [#1726](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1726)  
**Evidence date:** 2026-11-14  
**Disposition:** reproducible candidate comparison and recommendation; **not** an admission or story closure. The isolated package-evaluation phase changed no production dependency, package manifest, lockfile, native format or canonical contract. A separate owned legacy-TST host experiment is described below; that code does not establish an external candidate adapter. No GPL source was read.

## Decision in brief

**Recommendation:** retain the approved owned editor and carry JollyPixel 7.0.0 forward as the leading *reversible adapter candidate*, not an admitted production dependency. Its published `PixelArtCanvas` accepts an injected `PixelDocument`, can disable local history, emits public edit events and accepts external snapshots; the new real-browser probe demonstrates those seams. This could reuse a substantial framework-neutral canvas/tool surface while the host remains authoritative, if an adapter synchronously maps gestures to host commands and reconciles/reverts the staging buffer. JollyPixel is **not** a drop-in shared document and its callback occurs after its buffer mutation. Implement missing T-36 operations as targeted framework-free modules; retain this adapter as an evidence-backed alternative to implementing every canvas tool ourselves. Dotting remains the baseline but its React component/runtime and local-history path are not suitable for direct use under ADR 0025; that does not prohibit permissive algorithm adaptation. No candidate is admitted yet, no format changes, and T-36 stays complete in the ownership matrix for 13.3 implementation.

ADR 0031 already approves the owned-editor direction and routine reversible in-house modules; no new product-direction vote is needed. This recommendation does **not** prove the actual art-document/shared-host adapter or production library admission. The story still needs art-specific host/history, keyboard, strict-CSP/offline and save/conflict evidence and a person to review those findings. Any exact external artifact, adapted source or bundled assets still requires its G6/notice/provenance review and the specific person approval before production admission. Keep #1726 open.

## Reproducible package evidence (isolated installs only)

Toolchain observed: Node `v26.13.0`, npm `11.20.0`. Candidate packages were installed in separate throwaway directories under `/tmp/tkr1726-candidates.QpP7ib`; `npm install` used `--ignore-scripts --no-audit --no-fund --save-exact`. No candidate was installed in the repository.

Recreate the tested closures in two empty directories (the explicit React pins make the Dotting peer closure deterministic):

```sh
mkdir dotting jollypixel
(cd dotting && npm install --ignore-scripts --no-audit --no-fund --save-exact dotting@2.1.18 react@19.3.1 react-dom@19.3.1 && npm ls --all)
(cd jollypixel && npm install --ignore-scripts --no-audit --no-fund --save-exact @jolly-pixel/pixel-draw.renderer@7.0.0 && npm ls --all)
```

Observed closures:

| Artifact | Exact resolved packages | Declared licence | Integrity / provenance |
| --- | --- | --- | --- |
| `dotting@2.1.18` | `react@19.3.1`, `react-dom@19.3.1`, `scheduler@0.28.0` (React/DOM are peers; scheduler is ReactDOM's dependency) | All MIT | npm tarball SRI `sha512-NFQj2MO465cKAuknpfKZtGXj12V2v3Khlm4mgMDuO4W8VPS/phXYNgcRLQAkEagF+vTjkLqAjMYfunQAI+gTog==`; registry `gitHead` `f0dc86848e3f0063cc7b04dac04447ce7de4a751`; registry signature present. Reproduced signature audit: all 4 packages have verified signatures; React, ReactDOM and scheduler have verified SLSA attestations, but Dotting did not. [Registry](https://registry.npmjs.org/dotting/2.1.18) |
| `@jolly-pixel/pixel-draw.renderer@7.0.0` | `@jolly-pixel/color@1.1.1`, `@jolly-pixel/image@2.0.0`, `@openally/emitt@1.1.0`, `js-base64@3.9.4` | Renderer/color/image/emitt MIT; `js-base64` BSD-3-Clause | Renderer SRI `sha512-5XR+XmWfDg50Ng/plfh5DHO4LtdJOM4E6cRBoWcAEh9zNawT3nw4jZ2jNIaGve98LLZRXNndJgq23fhIwXwO5Q==`; registry exposes npm SLSA provenance for source repository `JollyPixel/editor`, `refs/heads/main`, resolved source commit `26ffccc1a0ac97d2443d090c7cf097a9677c8e0a`. Reproduced signature audit: all 5 packages have verified signatures and the renderer plus color/image/emitt have verified SLSA attestations; `js-base64` did not. `@openally/emitt@1.1.0` declares Node `>=24.x`, compatible with the observed Node 26 runtime. [Registry](https://registry.npmjs.org/@jolly-pixel%2fpixel-draw.renderer/7.0.0) |

The exact JollyPixel transitive integrity values in the throwaway npm lock are: color `sha512-Abf/RtB4n0tuULRX617059IQKIynpKditB1BYccpqgiaTNqENc8AZnNldshVMKWYvyZGeaaJ9FHV6LNmZnspDA==`; image `sha512-dAzaAND3I2PbeICBJbhF7HTrAg8Z2QpOJNZKP+LNT0HaWnbhBJzE9mfzLbBZyF3/Rcfi6IFi2BhSRWvdFLwjMw==`; emitt `sha512-tEQtUbOViCiGfI/v9K0rR+NThBK5vLWapUzWMbrgfn8PtUCAiRMvAUNud2RG9STN5+uL1QdFC/o/gyuU9G4WKQ==`; js-base64 `sha512-PtOMXpEGuP0RRiRXsjzHzl44dMHxSu2CPvAhinupR1tBa88me+1DPqsobl7eupn5UukjLkln1ZnAOAOXOrYG0Q==`. These are metadata/declared-license results, not a complete shipped-asset, notice, or copyright review.

The following is the observed command output (the working directory is named in the preceding package-install instructions):

```text
$ npm ls --all
dotting@ /private/tmp/tkr1726-candidates.QpP7ib/dotting
└─┬ dotting@2.1.18
  ├─┬ react-dom@19.3.1
  │ ├── react@19.3.1 deduped
  │ └── scheduler@0.28.0
  └── react@19.3.1

$ npm audit signatures
audited 4 packages in 0s

4 packages have verified registry signatures

3 packages have verified attestations
(use --json --include-attestations to view attestation details)

$ npm ls --all
jollypixel@ /private/tmp/tkr1726-candidates.QpP7ib/jollypixel
└─┬ @jolly-pixel/pixel-draw.renderer@7.0.0
  ├── @jolly-pixel/color@1.1.1
  ├── @jolly-pixel/image@2.0.0
  ├── @openally/emitt@1.1.0
  └── js-base64@3.9.4

$ npm audit signatures
audited 5 packages in 1s

5 packages have verified registry signatures

4 packages have verified attestations
(use --json --include-attestations to view attestation details)
```

The JSON form of both signature audits reported empty `invalid` and `missing` arrays. The npm SLSA-attestation counts above are not a complete security or asset-licence audit.

### Candidate fit, not just package size

**Dotting baseline.** Its published `2.1.18` component is MIT but requires React and ReactDOM `>=17.2.0` peers; the isolated closure installs a separate React runtime. Therefore it is not directly usable in the current Preact-only UI without the separately gated `preact/compat` route, which ADR 0025 does not provide. The live component offers useful pointer/shape controls, but its component owns undo/redo and its data replacement clears that history. This is a direct-integration mismatch, not a prohibition on adapting permissively licensed algorithms. The earlier 2.1.20 source manifest (commit `605cd38df35d9360cc90895ca5c7c172e73f3e9b`) is not the tested published 2.1.18 artifact; do not claim source/release parity. A Preact extraction/fork would add ongoing patch and compatibility ownership.

**JollyPixel modular challenger.** Published `7.0.0` is framework-neutral at the package boundary (no React/Preact peer) and exports a DOM canvas view, tools, document and pixel-buffer APIs. Its declarations expose `document?: PixelDocument`, `history.enabled`, `onBufferUpdated`, `loadSnapshot` and `applyRemoteCommand`. An injected `PixelDocument` with history disabled is therefore a plausible **mutable staging buffer**, not a read-only view or drop-in `EditorDocument`. The Chromium probe confirms a real pointer stroke emits one `stroke` event after changing that buffer; local undo remains disabled, and `loadSnapshot` restores an external image without another update event. That is evidence for a reversible host adapter, not actual host-history acceptance: host code would need to synchronously translate the post-mutation vendor event to one shared command, refresh the staged buffer from canonical snapshots on external edits/undo/redo, and restore canonical pixels after a rejected edit/save/conflict. The published `PixelArtCanvas` wires its `CanvasShortcuts.undo/redo` to its own history, which returns false when disabled; inspected `dist/` contains no `keydown`/`keyup` listener. The host can own those keybindings, but must route them to `EditorDocument` and refresh the stage; candidate keyboard behavior is unproved. 7.0.0 does not inject a `CommandHistory` or emit Toolkit `editId`s. Do not project the newer docs/source `@jolly-pixel/history`/8.0.0 API onto this published artifact. The four declared production dependencies are permissive as recorded above; bundled assets/notices still need a source-and-tarball review before admission. Reduced tool-implementation cost versus in-house is a hypothesis, not a measured result.

## Actual browser-surface evidence

- Opened the official Dotting Storybook page at <https://hunkim98.github.io/dotting/?path=/story/introduction-about--page> in a managed Chromium browser. The live embedded example exposed a grid and `DOT`/eraser/bucket/select/line/rectangle/ellipse controls plus undo/redo. With `DOT` selected, a real pointer click on an empty grid cell visibly changed it to red. Clicking the page's undo control changed that cell's appearance; redo restored solid red. This proves a live browser interaction exists, **not** exact undo-to-blank pixels, keyboard routing, a single host transaction, save/reopen, offline operation, or Toolkit host integration. No app script injected UI or state.
- The official JollyPixel docs at <https://jollypixel.github.io/editor/> and its renderer API pages had no reachable interactive demo (`editors/pixel-art.html` and `/examples/` returned HTTP 404). Separately, the opt-in browser probe below loaded the actual isolated published `7.0.0` package modules and generated a real canvas pointer event; it is library API evidence, **not** a Toolkit provider or host integration.
- Neither candidate was mounted in the Toolkit web host, VS Code webview, or packaged Electron host. No preview/mock provider is accepted as host proof.

## JollyPixel 7.0.0 staging-buffer probe

The opt-in `tools/editor-vscode-test/conformance/jollypixel-staging-probe.mjs` serves the isolated tarball modules to Chromium and clicks the real 16×8 canvas. It imports no React or Preact and never mounts a Toolkit provider. Reproduce it after the throwaway install above:

```sh
TKR_JOLLYPIXEL_NODE_MODULES=/tmp/tkr1726-candidates.QpP7ib/jollypixel/node_modules \
  pnpm --dir tools/editor-vscode-test exec node conformance/jollypixel-staging-probe.mjs
```

Observed output: version `7.0.0`; pointer position maps to texture pixel `(8,4)`; one red pointer click yields exactly one `onBufferUpdated` event `{action:"stroke", metadata:{color:{r:255,g:0,b:0,a:255},positions:[{x:8,y:4}]}}`; `pixelAtHook` is already `[255,0,0,255]`; `history.enabled`, `canUndo()` and `undo()` are all `false`. After `PixelDocument.loadSnapshot(16×8 transparent pixels)`, the sampled pixel is `[0,0,0,0]`, update count remains `1`, and local undo remains unavailable; no page/console errors occurred.

This establishes a usable staging/reconciliation seam, not a view-only component: JollyPixel mutates its own canvas buffer **before** calling the host hook. The public snapshot/remote-command APIs can apply externally accepted state without re-emitting a local update, but the host still must map the vendor event to one accepted command and restore its canonical snapshot after rejection, undo/redo, or external edits. A candidate undo shortcut with local history disabled has no effect; the host must route its own undo/redo keybindings. This harness does not exercise actual `EditorDocument` integration, a rejected/failed host write, conflict, keyboard dispatch, persistence, offline assets, or both Toolkit host surfaces.

**Adapter cost/decision:** JollyPixel is not rejected because it has a `PixelDocument`; its published API explicitly permits a staging instance with local history disabled and host state rehydration. Its cost is a translation/reconciliation adapter over all `PixelBufferHookEvent` actions, plus verification that every user gesture becomes exactly one host `editId` and that rejected writes roll back visibly. That is a smaller experiment than implementing its existing canvas/brush/fill/selection UX ourselves, but the missing art document and unproven host contract still prevent production admission here.


## Shared contracts and host evidence

The shared editor model supplies `getSnapshot`, `subscribe`, `apply`, `serialize`, `undo(editId?)` and `redo(editId?)`; accepted edits carry an `editId` through host `DocumentService.edited()` reporting. ADR 0022 makes that document/history authoritative, and ADR 0025 admits Preact 11.2.0 without `preact/compat`. At the prerequisite baseline the registry had only main and board documents. The owned experiment below adds an explicitly experimental legacy-TST kind; the earlier board canvas was not pixel-editing evidence.

The captured earlier browser-host baseline was real but limited to the `.gam` settings editor: the focused Playwright run passed 10 cases across session-copy editing, folder/lifecycle behavior, save/undo/revert/conflict, framing and CSP. The actual `@vscode/test-web` proof ran the built extension in VS Code Web and passed both `cancel` and `keep` recovery paths, including save/reopen and webview CSP assertions. These exercise actual host UI/workbench surfaces, not either art candidate; the browser folder picker is supplied by a test API shim.

The isolated package probes and prerequisite runs did not test an art-document/view/history adapter. Their success alone establishes no accepted art stroke, art-view sharing, pixel save/reopen, art-specific keyboard or lifecycle behavior. The separate owned-host experiment below is not evidence for a JollyPixel or Dotting adapter.

The browser editor route is not in the PWA precache manifest (`tools/browser/build.mjs` precaches the player shell/assets only). Already-loaded offline editing is distinct from cold offline editor bootstrap; the latter is not claimed. The earlier VS Code prerequisite run did not disable networking, and its CSP result covered only the prerequisite surfaces.

**Provider refresh (2026-11-14):** [PR #2317](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/2317) has merged, so story 12.2's shared browser provider is available; it is no longer an external implementation blocker. [PR #2332](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/2332) integrated it with the repaired native-reload harness at `d5bd0a3b28b180de8b2fb09d23984023aa0c43d2`: seven filesystem support tests and both actual VS Code settings-and-board scenarios (`cancel`, `keep`) passed. These are prerequisite proofs, not pixel-editing evidence. Build the real art-document experiment on this provider, not a competing browser or a simulated art provider.

## T-36 coverage and ownership matrix

This is the complete [T-36 operation inventory](../../editor-features.md) and ownership assessment for 13.2. It records candidate evidence and the recommended implementation owner; it does **not** claim that 13.2 implements the tools. T-36 implementation is the 13.3 deliverable. No operation is dropped, and an API declaration is not browser interaction or host acceptance.

| T-36 obligation | Dotting 2.1.18 | JollyPixel renderer 7.0.0 | Recommended owner / evidence gap |
| --- | --- | --- | --- |
| Enlarged 32×32 legacy tile editing grid | No actual 32×32 Toolkit-host editing proof was run. | The published-package probe exercises 16×8 only, not a legacy 32×32 tile. | Owned 32×32 legacy fixture and actual-host open/edit/save/reopen proof; native artwork extents remain subject to 13.21. |
| Pencil, eyedropper, flood fill, eraser, line | Published `BrushTool`/live Storybook expose `DOT`, `PAINT_BUCKET`, `ERASER`, `LINE`; the public enum has no eyedropper or replace-color tool. Only a pencil click was exercised live. | Published `BrushEngine` exposes brush/erase and `pick`; `FillEngine.run` and `LineEngine` are public. The isolated Chromium probe additionally exercised a real one-pixel pencil click and one `stroke` callback, not the remaining tools. | Host-owned command adapter plus targeted in-house picker/shape operations; every accepted gesture must become one host edit. |
| Outline/filled rectangle and ellipse; replace color | Enum and live Storybook expose both rectangle and ellipse modes, including filled variants. Replace-color operation was not evidenced. | No rectangle/ellipse drawing tool is exported by the published toolset; selection is not a shape-drawing substitute. No replace-color operation was evidenced. | In-house shape/replace operations; retain individual outline/filled variants. |
| Palette bank, RGB picker, DOS 16-color palette, transparent swatch | Color strings and brush-color changes are exposed; those four required palette controls/storage behaviors were not evidenced. | Primary/secondary/erase RGBA brush colors are exposed; no palette bank, DOS16 palette, or transparent-swatch UI was evidenced. | In-house palette and color-selection module; distinguish brush color from indexed/persistent palette data. |
| Grid/checkerboard, 1:1 and isometric previews | Grid and pan/zoom controls are exposed; exact 1:1 and game-faithful isometric preview were not established. | Transparency background and zoom/viewport APIs exist; no exact 1:1 or game-faithful isometric preview was established. | In-house view/preview integration using the existing renderer/engine composition; preview must not become a second document. |
| Clear, undo, redo | Public ref exposes `clear`, `undo`, `redo`; observed undo/redo was component-owned. | `history.enabled:false` disables the candidate history; probe confirms local `undo()` and `canUndo()` both return false, while `loadSnapshot` rehydrates external state without emitting a local update. The host must route its own undo/redo and resync the stage. | Host owns authoritative command/history; candidate buffer is disposable staging/render state, never a second accepted history. |
| Rotate 90/180/270, flip, mirror | No published transform API was evidenced; grid insertion/deletion and selection do not establish these operations. | `SelectTool` exposes rotation and horizontal/vertical flips. These mutate candidate staging state; route their events through host commands and keep the host history authoritative. | Reuse the proven candidate tools only behind the command adapter; verify all angles, selection boundaries and host undo. |
| Cut corner; 45-degree skew (wrapping and broken); wrap-scroll N/S/E/W; permanent isometric conversion | No published API or browser proof for these operations. | No published API or browser proof for these operations. | In-house algorithms with explicit wrap/broken/corner semantics and round-trip/preview evidence. |
| Image import, including ICO/BMP/WMF and other images, with named limitations | `setData`/`downloadImage` are exposed; no import path or format/limitation matrix was evidenced. | Published APIs include clipboard raster decode, canvas/image texture replacement and PNG encode/decode; this is not an app-owned file picker or native document import contract. | In-house import boundary with per-format limitations, error/cancel preservation and no new source format. |
| Overlay another tile with opacity; uniform RGB shade; grayscale | No integrated overlay/opacity or shade/grayscale operation was evidenced. An indicator is not a persistent tile overlay. | No integrated tile overlay/opacity or shade/grayscale operation was evidenced. | In-house view overlay and deterministic color operations; overlays must remain separate from source pixels unless explicitly committed. |
| Blur, motion blur, blocker/angle/length light shadow, texturise, pixel-pattern translucentise | No operation evidence. | No operation evidence. | In-house effect algorithms with parameters/results and one host command; no second effect-stack/runtime contract proposed here. |
| Save/append to new or existing tileset; overwrite an explicit reviewed slot | No shared-model or destination workflow; PNG download is not a tileset save. | Candidate serialization is its own pixel-document format; no shared-model or staged destination workflow. | Shared platform-services/document ownership and staged destination workflow; explicit slot review, cancel and overwrite safety. |
| Persistent layers/frames/recipes and source/output separation (owner direction beyond the T-36 list) | Layer manipulation APIs exist, but no persistence or shared-source integration was demonstrated. | UV regions/slots are not persistent authoring layers, frames or recipes. | Owned editor model/authoring modules; 13.2 must not invent a new native storage/timing contract. |

ADR 0031 already approves the owned-editor direction and ordinary reversible framework-free modules. Evidence now recommends JollyPixel 7.0.0 only as the leading reversible staging-canvas adapter candidate, supplemented by in-house missing operations; this is a recommendation, not production dependency admission. Existing `.gam` host runs do not prove art-document acceptance. The 13.2 exit still needs person review of the reproducible findings and real art-document/shared-host behavior; routine in-house modules require no new product-direction vote. Any exact candidate, copied/adapted code or shipped assets still needs its specific G6, source/provenance/notice review and person approval before production admission. Full T-36 implementation belongs to 13.3.

## Initial package/prerequisite verification (2026-11-14)

The actual existing `.gam` hosts were exercised separately from the candidate probe:

```text
$ pnpm build
Scope: all 25 workspace projects
Lockfile supply chain verified
tsc -b
✓ exit 0


$ PLAYWRIGHT_PORT=45671 pnpm exec playwright test tools/browser/tests/editor-web-host.spec.ts tools/browser/tests/editor-lifecycle.spec.ts tools/browser/tests/editor-ui-csp.spec.ts
10 passed (5.4s)

$ pnpm --dir extensions/editor build
✓ exit 0

$ pnpm --dir tools/editor-vscode-test proof -- --extension extensions/editor --workspace docs/spec/examples/game/Main --game example.gam
filesystem support tests: 7/7 passed
vscode.dev settings proof passed (cancel)
vscode.dev settings proof passed (keep)
✓ exit 0
```

The Playwright command first failed to start because the default `127.0.0.1:4173` was already in use; the shown retry used free port `45671` and passed. The first VS Code fixture-root attempt placed `example.gam` below the runner's expected root; the successful command uses `Main` as workspace root. The successful VS Code Web run used `@vscode/test-web@0.0.81` and downloaded VS Code Insiders; the workbench emitted ancillary `package.nls.json` 404 and Copilot CORS noise but returned exit 0. Neither host run disabled network access, and both exercise `.gam` settings, not pixels or an art-document provider.


## Reproduction and next proof gate

1. Reproduced package trees, integrity/licence metadata, signature/provenance results, candidate browser evidence, and host proof are recorded above. These exact candidate versions were installed only in throwaway `/tmp` directories. Re-run candidate reproduction only if a version changes or a result is challenged; do not add either candidate to the product from this evidence alone.
2. The smallest reversible adapter candidate is JollyPixel 7.0.0 as a mutable canvas/tool staging surface: inject a `PixelDocument` with `history.enabled:false`, map each post-mutation `onBufferUpdated` event to one host edit, and resynchronize from host snapshots on undo/redo, external edits and rejected writes. Use targeted framework-free modules for missing T-36 operations. This is a research recommendation, not production admission; Dotting is rejected for direct use under ADR 0025's current runtime, not as a source of permissively adaptable algorithms. If the Jolly adapter cannot preserve host semantics at acceptable cost, the approved in-house route remains the fallback.
3. The art-specific proof checklist is an actual art-document integration on the shared model and both actual host surfaces: accepted gesture as one host `editId`; two-view plus external edit/undo/redo; hide/recreate/reload; release outside, cancel, blur, active-board switch; save/reopen and render the saved tile in browser and VS Code webview; strict CSP, keyboard drawing, dirty state across failed save/conflict and local offline assets. Existing `.gam` proofs do not satisfy this checklist. The owned experiment below records its actual exercised paths, rather than claiming that a preview/provider or altered document contract fills a gap.
4. The full T-36 coverage/ownership matrix is supplied above; implementation of those operations belongs to 13.3. A person must review this story's evidence and actual art-host findings and approve the specific admitted component or in-house implementation before 13.2 can close. The approved direction allows ordinary reversible in-house work to continue without another product-direction vote; it does not waive that evidence/admission gate. Any proposed production external component, copied/adapted source or bundled assets also requires the exact-version G6/notice/asset/provenance review before admission.

## Owned legacy-TST host experiment

The reversible in-house route now has real code, not a preview substituted for an art document: [the tileset codec](../../../packages/editor-model/src/tileset-art-document.ts) uses the existing `BinaryDocument`, [the view](../../../packages/editor-ui/src/tileset-art-view.tsx) owns only interaction and staging, and both existing hosts mount that kind. No candidate dependency, React compatibility layer or borrowed third-party source was added. This is not component admission or completion of 13.1/13.3.

The scope is version-20 `.tst`, details 1–6, with exact same-encoding writes and preserved unrelated tiles/residue. Stored 16-pixel tiles stay 16-pixel data. Partial alpha, opaque RGB(0,1,2), and unavailable indexed colors are refused, not silently quantized. Isometric editing, native layered sources, interchange formats and the rest of T-36 remain outside this experiment; their existing story gates and full matrix above are unchanged.

The owned gesture contract follows the physical pointer: a scroll or layout change under a stationary held pointer must not add pixels. A coordinate-only browser event with unchanged client coordinates is not a new stroke segment; release commits only the staged preview (#2662).

Observed checks on the integrated owned experiment:

- Five focused model cases passed, including all six regular detail codes, asymmetric row/column orientation, palette duplicate no-op preservation, transparency and malformed boundary commands. Each reported under 4 ms.
- The generic registered-kind lifecycle table now includes an authored TST case. All 21 checks passed, retaining every main/board/character/item case and proving no-edit byte identity, rejection stability, apply/undo and save/reopen for tilesets.
- One real-model component fault-injection case passed in under 30 ms: a rejected save remains visible after its actual conflict clears, while local dirty pixels and external bytes survive. This is not actual-host admission evidence.
- Twelve actual-browser cases passed: ten existing settings/sprite/lifecycle cases and both artwork scenarios. Artwork coverage includes private preview, Escape and real Tab/blur cancellation, one-gesture history, modified/bare keys, independently mounted views, save during a visibly held preview without unpreviewed release pixels, file isolation and reopen; then a genuine OPFS exclusive-lock refusal, loaded-offline OPFS save, reviewed keep/reload choices and a 32-to-16-pixel external replacement. The artwork scenarios reported 2.8 s and 2.2 s; these are actual host integrations, not ordinary unit tests.
- Removing the row/column conversion made the asymmetric model assertion fail; restoring it passed. Hiding a save error once conflict cleared made the component assertion fail; restoring it passed.
- The packaged VS Code experiment passed both existing cancel/keep proof paths with actual native art history/splits, view destruction/recreation, saved-byte isolation, held-preview save, loaded-offline editing, physical backing-file permission refusal, reviewed external conflict and orderly native reload. Legacy hot-exit backups intentionally require a reviewed choice because they contain no original disk baseline; the proof confirms dirty recovery and unchanged backing bytes before Keep, then no implicit write until explicit Save. The existing settings, sprite and board proofs and final CSP guards remain in the same run.

The browser evidence uses real OPFS handles and file operations; only the folder picker returns the authored test folder. The native harness changes actual permissions on its disposable backing file and restores them, rather than forging a provider failure. Browser-offline mode left the already-open VS Code workspace transport available in the observed run; this is not proof of a disconnected transport or cold offline startup.

The owner approved and merged the package-evidence documentation in [PR #2347](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/2347), at `750b5eadf61dc85aabd4208965c5d4325f13a39c`. The owned direction is settled: ordinary reversible internal modules follow normal review/CI without another product-direction vote. This experiment does not close #1726 or admit an external component; the published person review of the fresh art-host findings, coverage gaps and ownership is still the story-closure gate, not a demand to reapprove the already-merged docs.
