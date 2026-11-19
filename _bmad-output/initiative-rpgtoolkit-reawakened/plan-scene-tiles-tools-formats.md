---
title: 'Scene, tile, tileset and tool format design'
type: 'feature'
ticket: ''
created: '2026-11-19'
status: 'in-progress'
baseline_revision: 'cc59e7534f8e5a2c9ace5c6060a489a4873d3b6f'
route: 'full'
route_source: 'auto'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Current scene and tileset contracts do not capture the owner's editable terrain painting model, and the existing tileset extension conflicts with the new format family.

**Approach:** Design `.tkrscn` scenes, `.tkrtle` individual tiles, `.tkrtst` tilesets and `.tkrtol` tools together. Specify source ownership, persistence, versioned rules and a clean cutover before implementation.

## Boundaries & Constraints

**Always:** Preserve authored scene shapes and hand edits; support artwork authored as single tiles or animated sheets; keep tools separate from scene meaning; preserve absent plugin data and refuse builds when essential behavior is unavailable; respect native document identity and clean-room guardrails.

**Never:** Claim Aseprite or any external editor format is adopted; make interchange a requirement; treat `.brd` as the editable source when a scene exists; silently overwrite original files or convert legacy games on open.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pond | Animated sheet, painted water shape and manual bank tile | Scene retains shape and manual edit; build generates tiles with defined timing | Report missing art or rules without deleting authored data |
| Missing tool | Scene made using a now-missing plugin | Preserve and open understood data; show limitations | Refuse affected regeneration when behavior is unavailable |
| Existing tileset | Pre-release `.tkrtile` registry, references and fixtures | Replace them with `.tkrtst` in the coordinated implementation cutover; no retained compatibility definition or migration tool | Do not silently alter unrelated project files |

</frozen-after-approval>

## Code Map

- `docs/design/native-graphics-authoring.md` — existing first-pass ownership and animation decisions.
- `docs/spec/formats/native-scene.md` — approved pre-release `.tkrscn` contract; current floors contain explicit tile runs.
- `docs/spec/formats/native-tileset.md` — draft `.tkrtile` tileset contract; includes an existing blob recipe.
- `docs/spec/formats/native-contracts.md` — registry, plugin data and reference preservation.
- `packages/native-data/src/registry.ts`, `scene.ts`, `tileset.ts` — existing registered `.tkrtile` and readers; require a coordinated later cutover.
- `docs/adr/0024-plugin-data-contributions.md` — namespaced data and missing-plugin preservation.

## Tasks & Acceptance

**Execution:**
- [x] `docs/design/terrain-scene-formats.md` — record the owner-approved design direction and the clean pre-release cutover.
- [x] `docs/design/terrain-scene-contract-proposal.md` and `docs/design/tile-tool-contract-proposal.md` — propose the wire shapes, ownership, preservation and build refusal rules with worked examples.
- [x] Existing issues #1846, #2320, #1733 and #2326 — link the design to its owners; track the animated playback defect in #3244.
- [ ] `docs/adr/` and `docs/spec/formats/` — adopt the proposal through the format owners after resolving the recorded proof gates; update live specifications, schemas and registry together in the cutover.

**Acceptance Criteria:**
- Given an animated sheet and a painted pond with a manual bank, when the proposed build is applied, then the source, shape, animation and override remain independently editable and the runtime output is reproducible.
- Given an unavailable plugin, when its scene is reopened, then unknown authored data survives and unsupported builds report the missing dependency.
- Given pre-release `.tkrtile` references and fixtures in the repository, when the implementation cutover lands, then they use `.tkrtst` without a retained compatibility alias or migration tool.
- Given native formats and plugin rules, when the proposal is reviewed, then its conflicts, unresolved choices and required implementation cutover are visible.

## Implementation Notes

The owner reviewed the draft contracts and agreed to continue from them. This approves the design baseline, not a runtime or reader conformance claim. A Bun probe using the repository's 5 fps `water.tan` showed that composing the same hydrated board at ticks 0, 11, 12, 24 and 36 always drew tile 2; rehydrating at each tick selected 2, 2, 3, 4 and 2. Issue #3244 owns the runtime proof and fix. Managed artwork binding, output-slot stability and isometric lowering remain with the linked format owners.

## Plan Change Log

## Review Triage Log

## Design Notes

Research Tiled terrain sets and LDtk rule grids for inspiration, without adopting their formats. Specify an initial tile-grid terrain region that can be reshaped, with explicit per-cell manual overrides taking precedence over generated tiles. Keep the representation extensible for other shapes without promising curves. Use stable source and tile identifiers, explicit animation timing and a shared phase for connected terrain; a rule revision must not silently change a saved build. A tool document declares a versioned tool definition and references a host-provided implementation; it is data, not executable code. Tools that generate ordinary scene data are not required to reopen it. When a required generator or plugin is missing, preserve its data and refuse only the affected regeneration. The exact wire keys and output-slot mapping are designed against the existing contracts, with worked examples and a migration ledger.

## Verification

**Commands:**
- `node tools/provenance/scan.mjs` — no provenance violations.
- Check changed documentation links and anchors, ticket store integrity, and schemas for every normative contract that is changed.
