---
type: story
title: "A scene builds its board, with vectors made from tile and asset collision"
ticket: 15
status: draft
---

# A scene builds its board, with vectors made from tile and asset collision

## Scope

Implements the lowering of a scene to a legacy `.brd` in `editor-model`, through the board writer `core` already has: tiles and their lookup table, placed pack assets expanded into images or tiles, and the board's solid and under vectors built from the collision stored with each tile and each asset. The build is repeatable, never reorders existing slots, and records the hash of what it wrote so an outside edit to the `.brd` is found and offered as an import, not overwritten.

Follow [ADR 0019](../../../docs/adr/0019-tkr-authoring-formats.md) decision 4 and consequences 2 and 3, and section 5 of the draft [`docs/spec/formats/tkr-authoring.md`](../../../docs/spec/formats/tkr-authoring.md) as replaced by the contract pages of 27.8, 27.11 and 27.12. The documents obey the rules in [`docs/spec/formats/native-contracts.md`](../../../docs/spec/formats/native-contracts.md) (common stamp, identity by path, closed top level, `pluginData`), and the shared editor contracts in [ADR 0022](../../../docs/adr/0022-shared-editor-authoring-contracts.md). Nothing converts on open or on save ([ADR 0019](../../../docs/adr/0019-tkr-authoring-formats.md) decision 5): the build is a function the caller invokes.

## Acceptance and verification

On an authored scene: two builds give identical bytes; the built board loads in the headless runner and its draw list matches the scene's own preview; a tile marked solid yields a solid vector over its cells and a pack asset's under vector appears moved to its placement; adding one object leaves every earlier slot index unchanged; a byte changed in the built `.brd` is reported before the next build writes.

Preserve same-version unknown data through the build, and assert the repeatability and slot-order boundaries directly rather than replaying an authoring session. Follow `discovery/inception-proposal.md`, G2 (the YAML reader stays out of `core`), G5 (the runner's inputs are ordinary boards) and G7; do not claim checks passed without executing them.

## Dependencies and decision gate

Prerequisites: 12.1, 27.13, 27.14. Follow the reader and writer behaviour of 27.13 and 27.14 and the contract pages written by 27.8, 27.11 and 27.12; the tileset and asset-pack readers are the only source of the collision the build lowers into vectors.
