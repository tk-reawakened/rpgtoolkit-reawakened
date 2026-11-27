---
title: 'Tile edit tracer and P1 integration seam'
type: feature
ticket: 1
created: '2026-11-22'
status: done
baseline_revision: 025c41609b6940fbc574d4bdb4707032ea30b0d2
route: full
route_source: auto
risk: medium
review: quick
review_source: pinned
lenses_ran: [hosts, ui-and-proofs]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The shared tileset browser can select a tile to paint, but it cannot open the source artwork for that tile. The in-house tileset editor already opens the file independently.

**Approach:** Open the chosen legacy `.tst` tile in the existing artwork editor from the shared browser. Edit and save it, return to the same board and paint that tile. Use the shared document-kind registry and an explicit source-visit contract so later P1 editors can add their own capabilities without new host-specific UI.

## Boundaries & Constraints

**Always:** Reuse the in-house canvas approved for #1726, the existing document for its URI and host save/undo/redo. Keep tile numbers one-based and preserve encoding and unrelated bytes. Browsing, opening artwork and selecting a brush do not mutate the board. Honor the active board and its saved revision boundaries. Use explicit keyboard-accessible actions.

**Never:** Add a vendor canvas, a new history or registry parallel to the existing one, an artwork format, a legacy board editing bypass, or new P1 drawing/terrain tools. Do not offer editing where the current artwork provider cannot do it.

| Scenario | Expected behavior |
|---|---|
| Supported regular `.tst`, tile other than the first | Open that exact file and tile, including when the document is already open. Unrelated draft pixels and document history survive. |
| Unsupported source or failed open | Explain that editing is unavailable or report the open failure; preserve the board, selection and source bytes. Keep existing tile bitmap source editing. |

</frozen-after-approval>

## Code Map

- `packages/editor-ui/src/tileset-browser.tsx`: the More actions menu already calls `openSource` for bitmaps. Use the selected row's source path and tile index, not brush state or display-label parsing.
- `packages/editor-model/src/kinds.ts` and `tileset-art-document.ts`: existing `.tst` registration and exact registered codec. Use the registry rather than introducing a second table. `packages/editor-ui/src/mount.ts` already mounts `TilesetArtView` from the same document.
- `packages/editor-ui/src/tileset-art-view.tsx`: tile selection is view state; accept a host source target without modifying the model.
- `packages/host-web/src/workbench.ts`, `packages/host-web/src/index.ts`, `packages/host-vscode/src/webview.tsx` and the existing source-visit/native-editor bridge: route through existing document opens and return behavior; keep platform capabilities at the host boundary. The browser workbench and VS Code webview already have asset refresh hooks.
- `tools/browser/tests/editor-artwork.spec.ts` and the VS Code proof harness under `tools/editor-vscode-test`: extend the existing real artwork workflow and use authored bytes.

## Tasks & Acceptance

**Execution:**
- [x] `packages/editor-ui/src/tileset-browser.tsx`, `mount.ts`, `tileset-art-view.tsx` — expose source editing by provider capability and carry the exact initial tile through the shared mount/visit interface.
- [x] `packages/host-web/src/workbench.ts`, `index.ts`, `packages/host-vscode/src/webview.tsx` and its source-visit handler — target the existing editor, preserve one document per URI and restore the board context; fix saved asset invalidation if the proof identifies a gap.
- [x] `tools/browser/tests/editor-artwork.spec.ts` and the VS Code artwork proof — exercise the same user path in both hosts with a non-first tile and asymmetric pixel; independently prove persisted artwork, rendered board pixel and unchanged unrelated records.

**Acceptance criteria:**
- Given an active board with a supported `.tst` source, when the author opens a non-first source tile through More actions with the keyboard, then that tile is selected in its artwork editor and returning leaves the origin board unchanged.
- Given that tile open in shared views, when the author paints an asymmetric pixel, undoes, redoes, saves and reopens, then both views use the same edit history and the saved file contains that pixel without changing neighboring pixels, other tiles or residue.
- Given the saved artwork, when the author returns and selects its brush, then no board bytes change until they paint; after painting and saving, the intended board cell shows the new pixel, including when its old artwork had already been previewed. Other boards are unchanged.

## Implementation Notes

`SourceVisit { path, tile }` in `editor-ui` is the shared source-visit contract; the browser chooses Edit tile artwork or Edit tile bitmap from the document-kind registry and otherwise shows an unavailable action. A tile reveal is view state only. The browser workbench reveals through the mounted view; VS Code passes a validated `visit-source` request, gives a new document its tile once and notifies already-open views. No saved-asset invalidation gap was found: returning to the board recomposes the saved artwork through the existing refresh hooks.

## Plan Change Log

## Review Triage Log

| Finding | Verdict | Evidence and disposition |
|---|---|---|
| Hosts: a pending VS Code tile outlived a visit that opened without the artwork editor and reached a later ordinary open | Patch | Delete after every visit and report the unopened editor; `packages/host-vscode/test/source-visit.test.ts` (#3339). |
| Hosts: every new VS Code webview of the document was sent back to the visited tile | Patch | One initializing view receives it; same test (#3339). Residual already-open split edge deferred to #3340. |
| UI/proofs: browser byte oracle transposed column-major pixels; VS Code oracle edited tile 1 for any tile | Patch | Both oracles corrected before the proofs passed. |
| UI/proofs: reopen, already-open visit with draft/history, and clamp were unasserted or weak | Patch | Browser journey reopens and visits a dirty open document; clamp test starts from tile 1. VS Code's same-document two-view history remains proved by the browser lane. |
| Proof run: More actions closed when the browser list reloaded | Patch | Menu keyed by row reference, closed on source change; failing-then-passing unit test (#3338). |

## Verification

- Run the focused Playwright artwork case in the `editor-web` lane and the matching real VS Code Web artwork proof. Verify changed artwork and board with independent saved-byte assertions, and the actual board preview with a pixel check.
- Run affected test typechecks and focused document/tileset browser tests. Use the existing real-host integration lanes; no extra duplicate browser lane.

Local results on Node 24.21.0: Chromium `editor-artwork.spec.ts` 3/3; packaged VS Code Web `run.mjs` with the example game passed cancel and keep lanes including the board-to-tile journey; focused editor-ui, host-vscode, host-web, kind-conformance and harness tests, TypeScript builds and test typechecks, scoped lint, dependency graph, provenance and help-content check.

## Closure evidence

The owner merged [#3341](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3341) at `0c0084efb3f532d254e727fbd80615803b66eb45` on 2026-11-22 and closed [#1727](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1727). Its [required gate](https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/44976940765/job/137070375105) passed.

| Acceptance clause | Observed evidence |
|---|---|
| Open a real tileset, edit one pixel in the shared document, save and reopen | Chromium `editor-artwork.spec.ts` includes the keyboard tile visit, the asymmetric pixel across two views, save with a column-major byte oracle, and reopen. |
| Both hosts show the saved pixel on the intended board | Packaged VS Code Web proof passed the cancel and keep lanes including the board-to-tile journey; the browser board return paints and checks composed pixels. |
| Undo/redo and reopening preserve one document identity | Browser proof covers undo/redo and the board return; the VS Code visit sends the tile to one view and reports a file opened without the artwork editor (#3339). |
| Brush selection alone changes nothing | Tile selection is view state only in the shared `SourceVisit`, and the proof visits without an edit. |

The deferred low-priority edge remains [#3340](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3340).
