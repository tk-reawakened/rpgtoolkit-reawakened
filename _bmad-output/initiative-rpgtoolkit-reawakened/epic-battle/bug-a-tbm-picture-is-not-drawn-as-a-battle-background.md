---
id: 23
type: bug
title: "A .tbm picture is not drawn as a battle background"
parent: epic-battle
tracker_id: "#743"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/743"
covers: [CAP-6, CAP-9]
after: [2, 11]
refined: false
hitl: false
risk: medium
severity: P2
---

# A .tbm picture is not drawn as a battle background

## Description

A valid tile-bitmap picture named by a battle background is silently replaced by the flat fallback colour in the stock battle screen. A valid `.tbm` background should be visible behind the battle UI.

## Reproduction

1. Use a screen-enabled stock battle fixture whose `.bkg` picture names a valid `.tbm` asset with a visibly non-flat pattern.
2. Open the battle screen.
3. Actual: the screen shows the flat dark-blue fallback instead of the tile bitmap. Expected: the `.tbm` picture is drawn behind the UI.

## Cause Hypothesis

The stock battle script blanks a `.tbm` picture before drawing, and the engine's image-key path excludes `.tbm`; the existing tile-bitmap decoder is not reached for this battle-background use.

## Acceptance Criteria

1. **A valid tile bitmap is visible as the battle background**
   **Given** a screen-enabled stock battle whose `.bkg` picture names a valid `.tbm` asset
   **When** the battle screen opens
   **Then** the decoded tile-bitmap picture is visible behind the UI
2. **Tests cover the condition found and fixed**
   **Given** the battle UI test suite
   **When** the valid `.tbm` fixture and existing supported background fixtures run
   **Then** a regression test fails on the suppressed `.tbm` and the existing supported formats retain their behavior
3. **Or: no change is needed, with proof**
   **Given** the reproduction
   **When** it is run on the current code
   **Then** the valid `.tbm` already appears behind the UI, or the report was mistaken, with the evidence recorded in Notes — this supersedes 1 and 2

## References

- parent — _bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md
- spec — docs/spec/formats/battle-data.md, Fight background (.bkg)
- spec — docs/spec/formats/tiles.md

## Notes

- Audit evidence: `stock/stock_battle/startup.prg:1155-1171` deliberately blanks a `.tbm` picture; `packages/core/src/engine/engine.ts:1148-1154` excludes `.tbm` from the image path.
- Risk rationale: medium — The defect is limited to `.tbm` backgrounds, but a wrong change could continue suppressing authored assets or regress supported background formats.
