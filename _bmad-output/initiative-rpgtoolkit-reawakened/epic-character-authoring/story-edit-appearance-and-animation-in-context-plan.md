---
type: feature
title: "Edit appearance and animation in context"
ticket: 3
status: draft
tracker_id: "#2964"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2964"
---

# Edit appearance and animation in context

## User outcome

An author selects how a character stands or moves, sees that animation beside its settings, and edits its collision or interaction shape in the same context.

## Scope and dependencies

CAP-15/CAP-18, T-52 and F-06. Depends on 29.1 and delivered shared sprite provider 12.4 (#1715). Improve the shared character/item component; item behavior must continue to work even though a broader item-editor redesign is outside this epic.

## Acceptance criteria

1. A readable stance list and selected-stance detail replace the need to scan every path field. All eight walk directions, eight idle directions, character battle stances and custom stances remain assignable. Show meaningful missing/assigned states without creating a dummy asset.
2. The selected stance has an animated preview beside assignment and playback controls. Source type, missing file and decode failure are understandable. Selection/playback is view state and does not dirty the file. Use existing faithful preview/composition behavior.
3. The existing filename assignment wizard previews affected assignments before applying them; cancel preserves all original assignments. Custom stance creation, rename and deletion retain documented constraints and undo semantics. No unrequested normalization or remapping occurs.
4. Movement timing clearly names seconds per step and idle-delay seconds. Editing them preserves the supported values and validation rules. Playback controls remain keyboard accessible and do not introduce an autoplay-only workflow.
5. Collision and activation are clearly distinguished beside the sprite with a bottom-center origin. Draw/move-point tools and an editable numeric point table operate on the same selected polygon. Default shapes and import remain available; the single pair belongs to the sprite, not separately to each stance.
6. Changing stance preserves the appropriate sprite-wide shape and timing context. Shape editing, numeric editing, undo/redo, source replacement and save/reopen agree. Keyboard users can complete assignment and numeric geometry without using a pointer.
7. Character and item fixtures prove the shared component does not expose character-only battle controls on items or change one document while editing another. Light/dark and narrow-pane captures show the selected preview and controls together.

## Implementation boundaries

Keep shape and stance commands in the existing model, and host I/O behind platform-services. Do not introduce another animation engine, new art editor or independent collision policy. A source-edit action uses the shared navigation provider; broader linked-provider delivery remains tracked by its existing owners.

## Verification

Prove selection/view-state separation, wizard cancellation, point-table/drawing agreement, undo and persistence with minimal authored fixtures. Run a real visual workflow and shared item regression. Reuse existing faithful pixel tests where applicable; no unrelated golden changes.

## Sources

- `docs/editor-features.md`, T-52.
- `docs/spec/formats/character.md#layout` and existing sprite contract from story 12.4.
- `docs/adr/0022-shared-editor-authoring-contracts.md`; ADR 0031.
- 29.1 experience contract; research F-06/SC-14.

## Completion record

Not implemented. Record the shared-component regression, visual evidence and executed checks when delivered.
