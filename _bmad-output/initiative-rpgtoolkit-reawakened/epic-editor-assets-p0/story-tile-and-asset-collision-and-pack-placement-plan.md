---
type: feature
title: "Set collision and walk-behind on tiles and assets, and place packs that stay packs"
ticket: 17
status: draft
---

# Set collision and walk-behind on tiles and assets, and place packs that stay packs

## Scope

Lets an author mark a tile walkable or solid and draw an asset's solid and walk-behind shapes once, in the shared tileset and asset browser, saved to the tileset or pack document. Painting such a tile or placing such an asset in a scene needs no vectors drawn by hand, and a placed asset remains one selectable thing that knows which pack it came from.

Follow [ADR 0019](../../../docs/adr/0019-tkr-authoring-formats.md) amendment of 2026-11-11, point 5, and the owner direction it records: storing solid and under masking with tiles and assets is a feature to include in the first release. Collision and walk-behind are core fields of the tileset and asset-pack contracts (27.11, 27.12), written in documents that obey [`docs/spec/formats/native-contracts.md`](../../../docs/spec/formats/native-contracts.md) and the draft [`docs/spec/formats/tkr-authoring.md`](../../../docs/spec/formats/tkr-authoring.md); the shared browser edits them under [ADR 0022](../../../docs/adr/0022-shared-editor-authoring-contracts.md).

## Acceptance and verification

In both hosts: marking a tile solid changes one line of its owner document; painting it in a native scene and building stops the player there; an asset's under shape hides the player behind it; a placed asset moves, copies and deletes as one object and its board records go with it. These authoring controls belong to native scenes.

Use the shared document lifecycle and preserve same-version unknown data; exercise the cancel, save/reopen and empty-selection paths rather than relying on preview alone. Follow `discovery/inception-proposal.md`, `docs/editor-features.md` and G2/G7; do not claim checks passed without executing them.

## Dependencies and decision gate

Prerequisites: 12.2, 12.16. 12.2 supplies the shared tileset and asset browser; 12.16 supplies explicit import from a legacy board into the native scene. The format sources are ADR 0019 and the contract pages of 27.11 and 27.12.
