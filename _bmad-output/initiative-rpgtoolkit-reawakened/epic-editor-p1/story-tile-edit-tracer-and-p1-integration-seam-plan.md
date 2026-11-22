---
title: 'Tile edit tracer and P1 integration seam'
type: feature
ticket: 1
created: '2026-11-22'
status: draft
baseline_revision: 025c41609b6940fbc574d4bdb4707032ea30b0d2
route: full
route_source: auto
risk: medium
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
- [ ] `packages/editor-ui/src/tileset-browser.tsx`, `mount.ts`, `tileset-art-view.tsx` — expose source editing by provider capability and carry the exact initial tile through the shared mount/visit interface.
- [ ] `packages/host-web/src/workbench.ts`, `index.ts`, `packages/host-vscode/src/webview.tsx` and its source-visit handler — target the existing editor, preserve one document per URI and restore the board context; fix saved asset invalidation if the proof identifies a gap.
- [ ] `tools/browser/tests/editor-artwork.spec.ts` and the VS Code artwork proof — exercise the same user path in both hosts with a non-first tile and asymmetric pixel; independently prove persisted artwork, rendered board pixel and unchanged unrelated records.

**Acceptance criteria:**
- Given an active board with a supported `.tst` source, when the author opens a non-first source tile through More actions with the keyboard, then that tile is selected in its artwork editor and returning leaves the origin board unchanged.
- Given that tile open in shared views, when the author paints an asymmetric pixel, undoes, redoes, saves and reopens, then both views use the same edit history and the saved file contains that pixel without changing neighboring pixels, other tiles or residue.
- Given the saved artwork, when the author returns and selects its brush, then no board bytes change until they paint; after painting and saving, the intended board cell shows the new pixel, including when its old artwork had already been previewed. Other boards are unchanged.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Verification

- Run the focused Playwright artwork case in the `editor-web` lane and the matching real VS Code Web artwork proof. Verify changed artwork and board with independent saved-byte assertions, and the actual board preview with a pixel check.
- Run affected test typechecks and focused document/tileset browser tests. Use the existing real-host integration lanes; no extra duplicate browser lane.
