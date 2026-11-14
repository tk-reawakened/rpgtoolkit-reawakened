# Story 13.2 — fresh art-library evidence

**Issue:** [#1726](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1726)  
**Evidence date:** 2026-11-14  
**Disposition:** reproducible candidate comparison and recommendation; **not** an admission, a completed host integration, or story closure. No production dependency, package manifest, lockfile, native format, or canonical contract was changed. No GPL source was read.

## Decision in brief

Keep the owner-approved integrated editor and use targeted, framework-free in-house pixel operations as the first reversible foundation. Do not admit Dotting or JollyPixel's published renderer as the shared document/history implementation. This is narrower than rebuilding every UI primitive: reuse browser canvas, DOM, and host capabilities normally; keep pixel operations and rendering independent of Preact; route accepted edits through the existing document command and host-history authority. Dotting remains the owner-discussed baseline to compare against; JollyPixel remains a useful modular challenger and source of API/design evidence. Neither currently supplies a drop-in fit for our shared document/history contract, and neither demonstrates complete T-36.

This recommendation applies the approved product direction; it does **not** claim that a working art document, host adapter, or specific module implementation has been accepted. The issue acceptance still requires a person to review working host/history evidence and approve admitted components or the specific in-house implementation. Keep #1726 open until that evidence and review exist.

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
| `dotting@2.1.18` | `react@19.3.1`, `react-dom@19.3.1`, `scheduler@0.28.0` (React/DOM are peers; scheduler is ReactDOM's dependency) | All MIT | npm tarball SRI `sha512-NFQj2MO465cKAuknpfKZtGXj12V2v3Khlm4mgMDuO4W8VPS/phXYNgcRLQAkEagF+vTjkLqAjMYfunQAI+gTog==`; registry `gitHead` `f0dc86848e3f0063cc7b04dac04447ce7de4a751`; registry signature present. [Registry](https://registry.npmjs.org/dotting/2.1.18) |
| `@jolly-pixel/pixel-draw.renderer@7.0.0` | `@jolly-pixel/color@1.1.1`, `@jolly-pixel/image@2.0.0`, `@openally/emitt@1.1.0`, `js-base64@3.9.4` | Renderer/color/image/emitt MIT; `js-base64` BSD-3-Clause | Renderer SRI `sha512-5XR+XmWfDg50Ng/plfh5DHO4LtdJOM4E6cRBoWcAEh9zNawT3nw4jZ2jNIaGve98LLZRXNndJgq23fhIwXwO5Q==`; registry exposes npm SLSA provenance for source repository `JollyPixel/editor`, `refs/heads/main`, resolved source commit `26ffccc1a0ac97d2443d090c7cf097a9677c8e0a`. `@openally/emitt@1.1.0` declares Node `>=24.x`, compatible with the observed Node 26 runtime. [Registry](https://registry.npmjs.org/@jolly-pixel%2fpixel-draw.renderer/7.0.0) |

The exact JollyPixel transitive integrity values in the throwaway npm lock are: color `sha512-Abf/RtB4n0tuULRX617059IQKIynpKditB1BYccpqgiaTNqENc8AZnNldshVMKWYvyZGeaaJ9FHV6LNmZnspDA==`; image `sha512-dAzaAND3I2PbeICBJbhF7HTrAg8Z2QpOJNZKP+LNT0HaWnbhBJzE9mfzLbBZyF3/Rcfi6IFi2BhSRWvdFLwjMw==`; emitt `sha512-tEQtUbOViCiGfI/v9K0rR+NThBK5vLWapUzWMbrgfn8PtUCAiRMvAUNud2RG9STN5+uL1QdFC/o/gyuU9G4WKQ==`; js-base64 `sha512-PtOMXpEGuP0RRiRXsjzHzl44dMHxSu2CPvAhinupR1tBa88me+1DPqsobl7eupn5UukjLkln1ZnAOAOXOrYG0Q==`. These are metadata/declared-license results, not a complete shipped-asset, notice, or copyright review.

### Candidate fit, not just package size

**Dotting baseline.** Its 2.1.18 package is an MIT React component with React and ReactDOM `>=17.2.0` peers; the isolated npm closure installs a React runtime. That is incompatible with the current Preact-only editor UI absent the separate `preact/compat` ADR that ADR 0025 expressly does not provide. The live component offers a useful pointer-tool surface, but source/docs describe internal undo/redo and data replacement that clears its own history. A view that owns that state would compete with editor-model history. The source manifest inspected by the earlier research (2.1.20 at `605cd38df35d9360cc90895ca5c7c172e73f3e9b`) is not the published 2.1.18 artifact; the registry artifact has its own `gitHead` above. Treat them as different evidence, not as source/release parity. A Preact extraction/fork would introduce ongoing patch and compatibility ownership, not a drop-in.

**JollyPixel modular challenger.** Published 7.0.0 is framework-neutral at the package boundary (no React/Preact peer) and exports `PixelArtCanvas`, `PixelDocument`, `PixelBuffer`, edit/serialization APIs, and a canvas mount point. This is better aligned for a DOM surface hosted by Preact. But the *published 7.0.0 declarations* expose `document?: PixelDocument` and `history?: { enabled?: boolean; limit?: number }`; `PixelDocument` owns a buffer and `History` with `undo()/redo()`. That is a second document/history authority, not our `EditorDocument` contract. The live docs describe a later history shape injecting `CommandHistory` and separate `@jolly-pixel/history` integration; the docs/source research is ahead of the exact published renderer (registry latest inspected here is 7.0.0, while source/docs cite 8.0.0). Do not project the newer API onto 7.0.0. Adapting its pixel commands into host transactions or pinning/forking a newer package remains unproved. Its four production dependencies are permissive as declared, but licence and provenance clearance of all bundled assets/notice contents still needs a source-and-tarball review before admission.

## Actual browser-surface evidence

- Opened the official Dotting Storybook page at <https://hunkim98.github.io/dotting/?path=/story/introduction-about--page> in a managed Chromium browser. The live embedded example exposed a grid and `DOT`/eraser/bucket/select/line/rectangle/ellipse controls plus undo/redo. With `DOT` selected, a real pointer click on an empty grid cell visibly changed it to red. Clicking the page's undo control changed that cell's appearance; redo restored solid red. This proves a live browser interaction exists, **not** exact undo-to-blank pixels, keyboard routing, a single host transaction, save/reopen, offline operation, or Toolkit host integration. No app script injected UI or state.
- Opened the official JollyPixel docs at <https://jollypixel.github.io/editor/> and its renderer API pages. The linked `editors/pixel-art.html` page and `/examples/` URL returned HTTP 404. The reachable renderer page documents APIs but did not expose a live interactive editor. Therefore there is no browser interaction proof for JollyPixel in this evidence round.
- Neither candidate was mounted in the Toolkit web host, VS Code webview, or packaged Electron host. No preview/mock provider is accepted as host proof.

## Shared contracts and host evidence

The current editor model has a shared `EditorDocument` lifecycle (`getSnapshot`, `subscribe`, `apply`, `serialize`, `undo(editId?)`, `redo(editId?)`). Accepted edits are identified by `editId`, and host `DocumentService.edited()` reporting carries the identity. ADR 0022 makes that document and history authoritative; ADR 0025 keeps editor model, canvas, and platform services framework-free and already admits Preact 11.2.0 without `preact/compat`. The editor-kind registry currently lists only the existing `.gam` main and board documents; editor-ui's board view is an existing browser canvas proof, not an art editor. It cannot stand in for a persistent art document.

No art-specific native document kind or view/history adapter exists to test against. Thus there is no evidence yet for two views, external model edit/undo/redo, reload, failed save/conflict, view disposal, keyboard focus/blur/active-board switching, or shared dirty-state behavior. Strict-CSP single-file browser/PWA, webview CSP/offline local assets, and actual VS Code webview behaviors are also unproved. These are acceptance gaps, not reasons to invent another document or source format.

The browser-provider work for story 12.2 / #1713 is in active draft PR #2317, with browser corrections and scroll/split-view gaps tracked in #2333 and #2334. This branch does not contain that unmerged work. Do not build a competing browser provider; after its integration, use the supported shared host surface for the required art-document proof. That future integration still cannot substitute for the actual VS Code webview and shared-history cases listed above.

## T-36 remains intact

No T-36 item is dropped or declared implemented by this decision. Candidate docs demonstrate selected subsets only; the editor must still provide all of:

1. Pencil, eyedropper, flood fill, eraser, line, outline/filled ellipse and rectangle, replace color.
2. Palette bank, RGB picker, DOS 16-color palette, transparent swatch; grid/checkerboard, 1:1 and isometric previews.
3. Clear, undo, rotate 90/180/270, flip, mirror, cut corner, 45-degree skew (wrapping and broken), wrap-scroll N/S/E/W, permanent isometric conversion.
4. Image import with named limitations; overlay another tile with opacity; uniform RGB shade and grayscale.
5. Blur, motion blur, blocker/angle/length light shadow, texturise, pixel-pattern translucentise.
6. Save append to new/existing tileset or overwrite an explicit reviewed slot.

Overlay is not persistent layers; a palette UI is not indexed-pixel storage. Persistent layers/frames/recipes and source/output separation remain product requirements, not evidence supplied by either candidate. The remaining coverage belongs in targeted in-house modules over the shared model: pure RGBA buffer/algorithms, brush-and-fill and shape operations, transform/effect operations, palette/layer/frame authoring, import/export and staged destination workflows; a canvas view is only an input/rendering surface. Implementations must preserve every listed operation, cancellation/rejection semantics, and one host-owned command per accepted gesture. No new native format/timing decision is proposed.

## Reproduction and next proof gate

1. Repeat the isolated package installs above; run `npm ls --all` in each directory and inspect the exact tarball manifests/declaration files, rather than relying on mutable source docs.
2. Repeat the public Dotting click/undo/redo interaction in its Storybook. This remains candidate UI proof only.
3. Before admitting any dependency or declaring this story done, produce a real shared-document integration: one 16×8 transparent control and one 32×32 legacy tile plus representative multi-cell sheet; accepted stroke is exactly one host `editId`; interleave an external model edit and undo/redo across two views, hide/recreate/reload, release outside, cancel, blur, switch active board, then save/reopen and render the saved tile on a board in browser and actual VS Code webview. Test strict CSP and local offline assets. Dirty state must survive failed save/conflict; no host history may be duplicated.
4. Review the complete G6 closure, package/tarball notices, copied files and bundled assets, provenance/source-release parity, plus the complete T-36 coverage matrix. A person then approves a qualifying component/adaptation or the specific in-house modules. Until then, no production art-library dependency and no story closure.
