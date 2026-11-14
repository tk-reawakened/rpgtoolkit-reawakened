# Epic 13 — approved artwork additions

Owner approved this breakdown and its publication. Research baseline is `f228bbe74`; publication was rebased onto `e57acbd839`. PR #2300 is merged. This proposal retains the 19 existing stories and adds 10, for 29 total. It does not allocate retired 13.17.

## Product promise

**Complete, not captive.** Supply the full integrated artwork workflow, while letting an artist succeed entirely with external tools or mix both routes. Standardize exchange formats rather than force one application. Persistent source retains layers, animation frames and editable recipes separately from generated game assets.

## Added stories

| ID | Delivery | Main prerequisite |
|---|---|---|
| 13.21 | Specify editable source, standard exchange and exact animation/output contracts; owner approval before code | Epic 27 tile/pack contracts |
| 13.22 | Real source save/reopen, identity, undo, output freshness and recovery | 13.21, existing document/native-data services |
| 13.23 | Sheet-first drawing across cells and reusable region brushes | Full toolset and shared stamp provider |
| 13.24 | Edit shared artwork or make only selected uses unique; return in context | Sheet canvas and native scene/collision services |
| 13.25 | Create tile/region animation with frame editing, onion skin and actual saved-game playback | Existing TAN/animation/clip providers |
| 13.26 | Reusable, non-destructive kitbash recipes and reviewed regeneration | Sheet/source services |
| 13.27 | Terrain generation and sandbox using the real painting provider | Recipes, terrain painting and scene/collision services |
| 13.28 | Flat-to-iso and three-face construction, anchors and tall blocks | Recipes and scene/collision services |
| 13.29 | Standard external image/sheet/animation exchange without mandatory drawing UI | Shared extraction, source and animation services |
| 13.30 | External handoff and reviewed reimport, including local conflicts and changed regions | Exchange and contextual variants |

## Existing stories refined, not replaced

- **13.2:** evidence-based admission of components for our already-chosen owned editor; not a fresh whole-product bake-off.
- **13.1:** stays the thin legacy pixel edit/save/reopen/board-use tracer; it does not wait for the new rich-source contract.
- **13.3:** retains every T-36 operation and legacy save mode, adds browser-led interaction and persistent editable source.
- **13.4:** one reviewed extraction flow, including awkward sheet spacing and explicit transparency/partial-cell choices.
- **13.5:** legacy curation still works; native presentation order and stable reference identity are distinct.
- **13.6:** retains exact TAN behavior; 13.25 builds the richer artwork timeline instead of overwriting that compatibility contract.
- **13.8:** one actual painting provider for sample-backed legacy ordering and labelled native terrain rules; generated native output is not proof of legacy parity.
- **13.18 / 13.19:** sweep waits on every capability, then acceptance includes internal, external and mixed workflows plus the entire original legacy toolset.
- Database, board, script and bitmap-font stories remain in scope and retain their IDs.

## Deliberate gates

The new source representation, precise interchange metadata and multi-cell timing are not secretly chosen by these UI stories. Story 13.21 must specify them, prove how saved outputs really play, and obtain the necessary owner/ADR/contract approval before dependent implementation. No new native extension or core runtime reader is approved by this proposal.

No structural Aseprite/PSD import/export, lossless foreign-document round trip, universal external-app launcher, automatic watcher or cross-document atomic save is promised. Original editable files and supported rendered-output workflows are first-class regardless.

## Acceptance journeys

1. Make and reuse a roof entirely inside the editor; reopen its editable source.
2. Repair a shared shelf seam, then recolour only one selected owner's variant.
3. Create a multi-cell water loop and compare saved-game frame boundaries with independent expected results.
4. Revise a kitbash input, regenerate terrain/iso outputs and preserve overrides, anchors and collision/under data.
5. Produce all artwork externally, import it and run the game without our drawing UI.
6. Reimport an external revision with pending local edits and removed regions; cancel or recover failed output writes without losing either source.

## Review state

The approved TOML is in build order, with existing tracker IDs retained and new tracker IDs recorded at publication. Two independent reviews found missing prerequisites for shared checkpoint recovery (11.14) and native-text authority integration (27.6); both are now explicit on 13.22, in its plan and in the parent epic declaration. No additional scope-drop or compulsory-drawing-UI gap was reported. Final verification passed: 29 matching story plans, 57 local targets, 198 reachable provider entries, no cycles/missing providers and no order/undeclared/unpinned dependency diagnostics. Three pre-existing skipped language-tooling plan warnings remain outside this epic. These artifacts are published through a planning-only branch and PR. The primary checkout was not edited.

Publication verification found that the issue-body synchronizer omitted Epic 13 from its editor-area map and therefore incorrectly put core VM restrictions on artwork UI stories. Issue #2335 records the symptom and proof. The publication change explicitly maps Epic 13 to the editor boundary; the real synchronization command and exact live-body comparisons verify the correction. This is publication metadata, not a change to game runtime rules.
