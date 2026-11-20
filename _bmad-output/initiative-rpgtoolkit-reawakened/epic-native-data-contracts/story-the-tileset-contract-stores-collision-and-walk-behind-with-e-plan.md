---
title: 'Native tileset contract'
type: 'feature'
ticket: 11
created: '2026-11-18'
status: 'in-review'
baseline_revision: 'ea5933275515e884003424e1623d74e17d45795b'
route: 'full'
risk: 'high'
context: []
---

<frozen-after-approval reason="story scope and explicit owner-review gate">

## Intent

Specify a pre-release native tileset contract with collision and walk-behind authored with the tile, the common native stamp and path identity. Account for every key of the existing authoring draft. Jensen's approval of the specification page is an explicit acceptance criterion and has not been obtained.

## Boundaries & Constraints
Follow the native contract and ADRs 0005 and 0019. Register `.tkrtile` in the specification and package in the same change as the contract. Do not treat delegated implementation choices as evidence that Jensen reviewed or approved this page.

</frozen-after-approval>

## Implementation Notes

The draft `docs/spec/formats/native-tileset.md` records proposed shapes, its key-disposition table and consequential recommendations for owner review. The registry and authoring-draft references accompany it; approval and verification remain outstanding.

### Proposed decisions for the revised contract

The [merged terrain design](../../../docs/design/terrain-scene-formats.md) gives the newer direction: `.tkrtst` replaces `.tkrtile` in one pre-release cutover without an alias or migrator, and palette entries refer to `.tkrtle` files rather than defining a second tile identity. Update the registered extension, declared references, checker, rename, package exclusions and repository fixtures together after approval. Opaque legacy text and plugin payloads are not rewritten.

**Slots.** Record unique positive 1-based output slots explicitly. Reordering is display-only. Retirement leaves a transparent reserved slot, not a shift or implicit reuse. Do not offer reuse based solely on a search: dynamic RPGCode can construct numbered references. For the animated target, propose one allocated output slot per distinct cel in a tile and reuse that slot for repeated timeline entries; record cel allocations explicitly so growth in one tile cannot shift another's frames. Assign each generated `.tan` a collision-checked output path. Check the selected target's count limit and refuse builds that cannot preserve all reservations. Animated lowering still needs the verified held-board playback and timing in [#3244](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3244).

**Isometric output.** Do not treat a 2D `.tst` projected on an isometric board as equivalent to a native `.iso` diamond. Prove `.iso` detail 150 sample order and transparent coverage separately from projection of a 2D tile. For three-face recipes, spell out anchor, face order and clipping, then use an independently expected solid footprint and walk-behind vector to verify the built board. Until that mapping is approved and verified, refuse isometric recipes with a located error rather than guessing at geometry. This does not remove isometric coverage from the story.

**Proposed review choice: store walk-behind geometry, not just a flag.** Reuse the [asset pack vector vocabulary](../../../docs/spec/formats/native-asset-pack.md#fields): closed `under` polygons in integer pixels relative to the placement anchor, carrying the existing mask flags. A tool may propose a polygon from the art, but the saved polygon owns the result. Solid collision stays independent: a tile may have walk-behind and no solid barrier. Verify with a solid post under a wider roof, a walkable canopy with no solid geometry, and two placements at different anchors. The alternative is a `wallCapUnder` boolean that always turns the tile footprint into the under polygon; it cannot describe a cap that extends beyond or covers only part of the footprint.

## Review Triage Log

## Verification

Run the registry test, documentation link checks and provenance scan after the registry update. Approval remains a separate unmet gate.
- Registry test: 7/7 passed; provenance: 1,712 files, zero violations; draft page relative links and anchors passed. Owner review remains pending.
