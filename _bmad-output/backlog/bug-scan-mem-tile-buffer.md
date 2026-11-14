---
id: 3
type: bug
title: "scan and mem do not preserve or restore tiles at runtime"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#2157"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2157"
refined: true
hitl: false
risk: medium
severity: P2
---

# scan and mem do not preserve or restore tiles at runtime

## Description

The normative `docs/spec/engine/rpgcode-functions.md` rows describe `scan(x, y, pos)` saving a tile and `mem(x, y, pos)` restoring it. In `packages/core/src/script/catalogue-responders.ts`, both currently use `makeResponder`, which emits only a generic `world` effect; it does not store or draw a tile. No dedicated command implementation is registered in the core packs. Discovered while fixing #2111 on `fix/2111-scan-catalogue-arity`.

## Reproduction

Run RPGCode that calls `scan` on a tile, then `mem` to restore it. Nothing is stored and nothing is drawn.

## Acceptance Criteria

1. **A scanned tile is saved to its buffer position**
   **Given** RPGCode that calls `scan(x, y, pos)`
   **When** the script runs
   **Then** the tile at that position is stored under buffer `pos`
2. **mem restores the scanned tile**
   **Given** a tile saved by `scan`, and a destination that has since changed
   **When** the script calls `mem` for that buffer
   **Then** the scanned tile is restored, asserted on the actual resulting pixels or state
3. **Buffer positions are independent**
   **Given** two different buffer positions
   **When** each is scanned and restored
   **Then** each restore yields its own saved tile
4. **The change keeps the guard-rails**
   **Given** the new command implementation
   **When** it runs in `core`
   **Then** it keeps state as plain JSON data and obeys G1–G3, and any change to a golden is deliberate and explained

## References

- spec — `docs/spec/engine/rpgcode-functions.md` (`scan` and `mem` rows)
- code — `packages/core/src/script/catalogue-responders.ts` (lines 269–270 and 314–315 at filing)
- issue — [#2157](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2157); found while fixing #2111

## Notes

- Ticket created from the issue text only; criteria 1–3 follow the issue's stated proof of fix, and criterion 4 restates the project guard-rails.
