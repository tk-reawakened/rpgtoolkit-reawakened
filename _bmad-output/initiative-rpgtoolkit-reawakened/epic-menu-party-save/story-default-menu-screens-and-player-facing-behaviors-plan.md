---
title: "Default menu screens and player-facing behaviors"
type: 'feature'
ticket: 8
created: '2026-10-22'
status: in-progress
baseline_revision: '961603b596f938ac2ec73c7333b2607ea1f44411'
risk: "high"
context:
  - "spec - docs/spec/engine/plugins-and-battle.md#e-80"
  - "spec - docs/spec/engine/plugins-and-battle.md#e-80-stock-menu"
  - "spec - docs/spec/engine/plugins-and-battle.md#e-123"
  - "spec - docs/spec/engine/plugins-and-battle.md#epic-85-item-action-proposal"
  - "spec - docs/spec/engine/accessibility.md#a11y-5"
  - "spec - docs/spec/engine/audio-media.md#r-59-routing"
---

## Intent

Deliver the stock player menu screens and all E-80 behaviour through the controller established in entry 7.

## Boundaries

Main, inventory, equipment and abilities screen draw lists and choices; item/party operations stay in entries 3–6, the controller in entry 7, and Save/Load mechanics in entries 9–10, which this screen integration consumes.

## Acceptance

Scripted inputs cover party portraits/stats, gold/play time, item use/info/drop and key-item refusal, member/slot/item selection and removal, abilities use/info, and Save/Load/Quit routed through their implemented behavior, plus direct screen entry, `MenuGraphic` and cursor sounds.

## Verification

Headless golden and state tests assert exact draw-list order, selected values, command results, save gating and deterministic sound cues for each screen.

## Implementation map

Read and invoke the owner ports; presentation replays draw lists and never holds menu/game state inside a renderer.

## Design recorded before code (G7)

The E-80 screen contract was silent on the stock screens' row order, paging, drawing surface, refusal text and the two context views the screens need. `docs/spec/engine/plugins-and-battle.md#e-80-stock-menu` now states it as a TKR engineering contract inside E-80, and `docs/spec/engine/rpgcode-functions.md` records the `menugraphic`, `dirsav`, `menuitemdata` and `savelist` command behaviour. The doc commit lands before the implementation commit.

- Screens are RPGCode `menuProviders` inside the `stock_menu` package, as E-80's replacement rules and the #588 contract already say; each provider is the screen's own blocking loop (draw, `threadsleep(1/60)`, `get()`).
- Presentation draws into the reserved render-now overlay and contributes one blit to the draw list; the game's own overlay pixels are stashed and restored.
- The four read-only views the screens need (`context.party`, `context.menu`, `menuitemdata`, `savelist`) are added to the RPGCode provider surface so both languages have the same capabilities.
- The menu key opens the main screen by starting an ordinary blocking thread running `mainmenu()`, so a menu opened by the key is saved and restored like any other menu.

## Verification plan

- Engine-level fixtures: open each screen directly (facade + `InternalMenu`), drive it with scripted key events, assert overlay revision/draw hash, the selection in `menu.screens`, printed rows and the resulting owner state; assert the 1,000-step budget and replay determinism by running the same input log twice.
- Save gating: a board with `disableSaving` refuses Save and no `saveBlob` request leaves the engine; an allowed board issues one.
- Audible cues: the three main-file cursor sounds become `sfx.play` records with source `ui` on move/confirm/cancel; a missing name is silent.
- Perturbation: each load-bearing assertion is proved by removing its guard (key-item refusal, save gate, save routing, replay equality) and watching the test fail.
