---
type: feature
title: "Edit appearance and animation in context"
ticket: 3
status: draft
risk: medium
tracker_id: "#2964"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2964"
---

# Edit appearance and animation in context

## User outcome

An author selects a stance, sees its animation beside assignment/playback controls and edits supported timing or collision/interaction shapes in that context.

## Scope and dependencies

CAP-15/CAP-16/CAP-18, T-52 and the T-56 graphics subset. After the Epic 12/13 gates, depends on 29.1 and delivered sprite provider 12.4 (#1715). Own reusable presentation and existing character/item integration. Story 29.8 owns the real enemy adapter and its persistence proof, avoiding a circular dependency.

## Acceptance criteria

1. A readable stance list and selected detail replace scanning every path. Preserve eight walk and eight idle directions, character battle stances and custom stances for the supported character/item formats. Enemy presentation supports only its documented standard/custom battle stances; it never invents walk/idle, timing or polygons.
2. Selected animation previews beside its assignment and playback controls. Explain source type, missing files and decode failures. Selection/playback is view state, does not dirty data and uses the existing faithful preview/composition behavior.
3. Preserve the existing filename assignment wizard for supported directional data, showing affected assignments before apply. Cancel keeps originals. Custom stance create/rename/delete preserves constraints, slot identity and undo; no unrequested normalization.
4. Supported movement timing names seconds per step and idle-delay seconds using the existing documented editor contract. Collision and activation remain distinct with a bottom-center origin; drawing/moving points and the numeric table edit the same sprite-wide pair. Default shapes/import remain available. Do not add these fields to enemy data.
5. Stance changes retain the appropriate shared shape/timing context. Drawing, numeric editing, source replacement, undo/redo and save/reopen agree. Keyboard users can complete assignment and numeric geometry.
6. Real character and item documents prove independent edits and no character-only battle controls on items. An authored enemy-shaped contract fixture proves the reusable standard/custom stance subset without pretending the enemy document provider exists; real enemy integration is required in 29.8 and final acceptance 29.6.
7. Every user-triggered selection, preview, assignment, wizard and geometry action uses a registered command and palette entry, with buttons/menus/shortcuts dispatching the same behavior.
8. Light/dark, high-contrast and narrow-pane evidence shows selected previews and controls together. Mark fixture-only enemy evidence clearly until 29.8 delivers the actual document.

## Implementation boundaries

Keep edit commands in the existing model and I/O behind platform-services. No new animation engine, art editor, independent collision policy or new runtime data. Preserve same-version residue. Real source editing uses shared navigation; owning providers remain separate.

## Verification and sources

Prove view/data separation, cancellation, point-table/drawing agreement, undo and persistence with small authored fixtures. Run the real character/item workflow; reuse faithful pixel checks without unrelated golden changes. Sources: docs/editor-features.md T-52/T-56; docs/spec/formats/{character,item,enemy}.md; ADR 0022/0031; 29.1's docs/ contract and the registered-command owner rule.

## Completion record

Not implemented. Record shared-component evidence, real character/item regressions, fixture limitations and executed checks.
