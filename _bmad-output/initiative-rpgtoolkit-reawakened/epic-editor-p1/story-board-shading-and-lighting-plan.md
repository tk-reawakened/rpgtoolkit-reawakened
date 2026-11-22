---
title: 'Board shading and lighting'
type: 'feature'
ticket: '12'
created: '2026-11-22'
status: 'draft'
baseline_revision: 'eccc276c1d127c91b8202c07d8f285f11c49b2d4'
route: 'full'
route_source: 'auto'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: ['{project-root}/docs/spec/formats/board.md', '{project-root}/docs/design/board-authoring.md', '{project-root}/docs/adr/0022-shared-editor-authoring-contracts.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The board editor can paint tiles and objects but cannot author the board's lights or paint per-cell shading directly. The board snapshot does not even expose `lights`, so light nodes, colours and the light-to-shading conversion are unreachable (T-23 Shading and Lighting modes, T-26).

**Approach:** Extend the existing board document with light and shade edit commands, then add Shading and Lighting tools in `editor-ui` that call them. Every control has a numeric/keyboard route. Lights stay editable until an explicit, undoable bake writes shading.

## Boundaries & Constraints

**Always:** Edit the existing board model through commands, so one gesture is one undo step. Keep RGB at −255..255, with spotlight (3 nodes), gradient and clipped gradient (2 nodes) exactly as `docs/spec/formats/board.md#lights`. Preserve version, residue and unknown fields. Register every new action in the `CommandRegistry`. Host access goes through platform-services. Selecting or previewing a light never dirties the document.

**Never:** Silently bake or destroy a light. Do not change engine render arithmetic (`core/src/render/shade.ts`; the R-15 alignment is a separate ticket), the board wire format or runtime lowering. Do not add a second document model, a docking library, or lighting for native scenes (Epic 27) in this story. Do not use `Math.random`, `Date` or float falloff in `core` (G3).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Paint shade | Shading tool, tint (r,g,b), drag over cells | One command sets each cell's tint on the chosen cast layer; one undo reverts the drag | Out-of-range channel or off-board cell: refuse whole edit with a named reason |
| Add / move light | Spotlight, gradient or clipped gradient; node positions and two colours | Light is stored with the right node count; moving a node is one undoable edit | Wrong node count or colour channel out of range refused; stored record unchanged |
| Bake | Explicit "Convert light to shading" | Spec arithmetic writes shading; light is removed only after the author confirms; undo restores the light | Bake that would exceed the shade grid or clamp unexpectedly reports the cells affected and changes nothing |
| Save and run | Board with light and shade | Saves, reopens identical, and the runner renders both | Read-only or failed save: shown, no partial write claimed |

</frozen-after-approval>

## Decisions recorded 2026-11-22 (owner)

1. Shading and Lighting modes go in the existing board tools (`board-view.tsx`); story 30.1 restyles them.
2. R-15 is amended to the engineer's account in the spec (swap after the sum, for every non-transparent tile pixel). The engine and goldens still implement the old rule, so **this story does not change engine arithmetic**. A follow-up ticket brings `core/src/render/shade.ts` and the goldens into line under G5.
3. The single ±255 clamp is kept as a deliberate departure.
4. Clipped gradients are editable (the band rule is now specified). Convert adds the light into the one shading layer, deletes the light, and is one undo step.

## Engineer answers (2026-11-22, behaviour only; to be written into the docs first, in their own commit)

- Clipped gradient: the axis runs from node 0 to node 1; the light covers the band between two perpendicular lines through the nodes (both edges inside), unlimited along its length. Plain gradient clamps the fraction to 0..1. Identical nodes have no effect. Plain and clipped keep their nodes when switched; switching to spotlight resets them.
- Spotlight: node 1 is the centre, nodes 0 and 2 are radius points; the longer distance is the major axis and sets rotation; only the shorter length is used for the minor axis. New spotlight: a circle, radius points 160 px above and left of the centre (stopped at 0 at the board edge). Hard edge: on or past the boundary adds nothing. Linear falloff for all types; spotlight colour 1 at the centre, colour 0 at the edge. New light: colour 1 is the brush shade, colour 0 is zero.
- Lights add to the painted grid and to each other, with no clamp until the final pixel; each light rounds toward zero as it is added, so order can change a cell by 1. Cells are sampled at each tile's position; row and column 0 are never lit. Stored light layer is unused and mirrors the cast layer.
- One shading layer only is meaningful (editor shows shading and enables Convert only with exactly one). Cast layer N tints layers 1..N.
- Shading tools: draw (one cell, drag paints, right-click erases), erase (0,0,0), rectangle outline (Shift fills, in cell numbers), flood (per channel), dropper, zero-RGB and a grey slider setting all three channels. Channels clamp to −255..255. Default brush (64,64,64). No brush size.
- Convert: adds the selected light into the shading grid, records one undo step, deletes the light. Runtime bake leaves stored lights alone.
- Isometric: a shade cell is the tile's diamond; the rectangle tool uses cell numbers; flood skips off-edge cells.
- Live preview draws shading plus all lights, with separate "Draw tile shading" and "Draw lighting" toggles.
- Not confirmed: sprites' own white/black swap; whether shipped sample boards hit the clamp case.

## Code Map

- `packages/core/src/formats/board/model.ts` -- `BoardLight`, `BoardShadeLayer`; read-only here, the stored contract.
- `packages/editor-model/src/board-document.ts` -- `SetBoardFieldsCommand` lacks `lights`; `BoardDocumentFields` does not expose them; `planShades` already encodes and checks tints. Extend, do not replace.
- `packages/editor-model/src/board-tools.ts` -- tile tools returning `ShadeAssignment[]`; the shade-paint tool belongs beside it.
- `packages/editor-model/src/board-preview.ts` -- already composes with `shading: true`; add lights to the preview.
- `packages/editor-ui/src/board-view.tsx`, `board-canvas.tsx` -- tool strip and canvas gestures.
- `packages/core/src/render/shade.ts`, `docs/spec/engine/display-input-audio.md#reawakened-light-and-raster-arithmetic` -- falloff and bake arithmetic to reuse.
- `packages/editor-model/test/board-document.test.ts` -- test pattern; keep each test under 1 second.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/editor-model/src/board-document.ts` -- add `lights` to the snapshot and to `set-board-fields`, with node/colour validation -- unblocks all light editing.
- [ ] `packages/editor-model/src/board-lights.ts` -- add/move/recolour/remove light edits and the explicit bake using the spec arithmetic -- keeps `core` free of editor logic.
- [ ] `packages/editor-model/src/board-tools.ts` -- shade-paint gesture producing one `set-tiles`-style command -- one drag, one undo.
- [ ] `packages/editor-ui/src/board-view.tsx` and a new lighting view -- Shading and Lighting modes with numeric fields, keyboard nudge and commands registered in `CommandRegistry` -- required by the accessibility contract.
- [ ] `packages/editor-model/test/` and `packages/editor-ui/test/` -- unit tests for the matrix, plus one runner-harness case that renders a board with both light and shade.

**Acceptance Criteria:**
- Given a board with a light and shaded cells, when saved and reopened, then both are identical and the runner renders both.
- Given an unbaked light, when the author cancels or undoes a bake, then the editable light is unchanged.
- Given invalid channels or node counts, when applied, then the edit is refused with a reason and the document is not dirty.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm --filter @tk-reawakened/editor-model test` -- expected: pass (package name to be confirmed from `package.json`)
- `pnpm --filter @tk-reawakened/editor-ui test` -- expected: pass
- `pnpm check` -- expected: lint, types and guard-rail checks pass; golden tests unchanged (G5)
