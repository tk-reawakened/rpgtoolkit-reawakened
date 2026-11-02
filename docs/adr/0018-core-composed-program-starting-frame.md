# ADR 0018 — The core composes a program's starting frame; there is no host capture request

* **Status:** Proposed. One owner question is open — adopt Toolkit 3.1's presentation model or record a deliberate difference (section 11). Implementation has not started.
* **Date:** 2026-11-02
* **Amends:** [docs/spec/engine/main-loop-and-startup.md](../spec/engine/main-loop-and-startup.md#reawakened-starting-frame-capture) (replaces the deferred host-capture rule with the core-composed one); reuses the surface-hash projection ruling in [docs/spec/formats/save-game.md](../spec/formats/save-game.md#state-hash-surface-projection) (2026-11-02)
* **Context documents:** [docs/spec/engine/runners.md](../spec/engine/runners.md#surface-read-and-state-hash), [docs/spec/formats/save-game.md](../spec/formats/save-game.md#state-hash-request-projection), AD-1 (engine API), AD-3 (draw commands), AD-5 (host requests), AD-14 (input events), AD-27 (`engine.surfacePixels`)
* **Tickets:** [#1067](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1067) (this design)
* **Supersedes:** the `captureFrame` / `frame.captured` host request-and-reply design recorded on branch `design/1067-program-starting-frame-capture` in PR [#1162](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/1162) as "ADR 0017 — Program starting-frame capture seam". That number belongs to [ADR 0017](0017-input-actions-devices-and-accessibility.md) (input actions), which is already accepted; nothing here reuses it.

## Summary

In plain terms:

1. **A program starts on a copy of the last frame the screen showed.** Toolkit 3.1 copies the display and never redraws first; the program then draws over that copy, and whatever it clears stays clear. The copy is the whole picture at logical resolution: the board, thread animations and the render-now overlay as they were, and — when the copy comes from a previous program in the same frame — that program's message window as well. It has no transparency.
2. **The core makes that copy itself, and never asks a host for pixels.** What the core needs is not the host's GPU pixels. It is the picture the game last presented, which is a pure function of the game's own tick history. The core already owns that picture: scripts have always read *its* screen surface, never a host readback ([runners.md#surface-read-and-state-hash](../spec/engine/runners.md#surface-read-and-state-hash), ruling on #1048).
3. **No new request, no new reply, no new record.** `RunnerRequest` and `InputEvent` are unchanged. No pixel bytes cross the boundary, so a replay log holds nothing new and the same input log produces the same frame on every runner.
4. **The copy is a derived cache, like the presented screen.** It is excluded from `hashGameState` and rebuilt from saved state when a save is loaded; it is not stored anywhere new, because the script-screen layer that holds it already travels in the `surfaces` section.
5. **The copy replaces the script-screen layer at each outermost program start.** That is what stops a finished program's drawing from coming back over a later program (see [#1172](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1172)).
6. **This engine does not have that model yet.** It has no program surface of its own: it composes the live board under a program and the live overlay and animations over it every frame, and no command redraws the board into a program surface. That single gap is #1171, #1172, #1182, #1183 and #1186 (section 3), and the copy rules here seed the surface that gap is missing.

## Context

Toolkit 3.1 starts an outermost program with an image copied from what is on the display. Every answer below about what that copy contains, and when a fresh board is drawn into it, comes from the TK engineer's source reads relayed by the owner and recorded in [#1045](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1045) and #1067. **They are source reads, not runtime observations: the engineer did not run the game to confirm them.** Where the engineer gave a certainty label, that label is kept here.

The rebuild has neither that copy nor the surface it belongs to. On `origin/main` a program starts with an empty script-screen layer, the live board is composed beneath it and the live overlay and thread animations above it on every frame, and the composition is only refreshed at the end of `advance`; no command redraws the board into a program surface. Section 3 states the model and measures the gap. The spec recorded the gap in the paragraph and the rule that this ADR replaces, and the audit #1170 found the visible symptoms that will disappear when the copy is correct (#1171, #1172).

The earlier design on this branch reached for a host seam: a blocking `captureFrame` request and a `frame.captured` reply carrying RGBA bytes. Investigation for #1067 (report: `/tmp/frame-source-report.md`, on `origin/main` `0ddb39b9`) found that the seam is unnecessary, and that it would have been wrong:

* **The host's pixels are not a function of ticks.** `runner-web` — and `runner-desktop` and `runner-mobile`, which reuse its live session — composes the frame after each `advance` with `alpha` = the wall-clock fraction of the next tick (`runner-web/app/main.ts:348`, `runner-desktop/app/player-live.ts:108`). On a 120 Hz display half the animation frames run `advance(0)` and re-present the same state at a different `alpha`; a stepped sprite is drawn at an interpolated position. A readback therefore returns a frame that varies with refresh rate, with when the host last happened to call `advance`, and with tick batching.
* **It would have broken G3.** `getpixel`, `canvasgetscreen` and `savescreen` on the starting frame write pixel-dependent values into variables, script canvases (`cnvX`) and screen slots, all of which stay in the state hash. A headless runner answering `null` and an interactive runner answering the presented frame would then disagree on the state hash for any script that reads its starting frame. The seam's own replay rule contradicted its `null` fallback.
* **It asked the host to do what the core does better.** Both the reference rasteriser in `core/raster` and the WebGL2 replayer are bound to agree on a draw list (exactly on colour keys, tint and blend choice; within one unit per channel on translucent and additive arithmetic, [runners.md#webgl2-agreement](../spec/engine/runners.md#webgl2-agreement)), and the measured agreement on a real demo frame is exact (worst channel 0). The difference between the two was never the rasteriser; it was which draw list was composed.

The owner accepted that finding on 2026-11-02: **core supplies the starting frame from its own deterministic composition; no host request.**

## Evidence: what the engineer's answers say

The toolkits' behaviour, in the engineer's words, labelled as the engineer labelled it.

| # | Answer | Label |
|---|---|---|
| W1 | The program's starting image is whatever was last presented. It is never redrawn first. Full resolution. Opaque RGB, no alpha. | Certain (earlier answers; the engineer labelled only the items below otherwise) |
| W2 | A fresh launch's screen before the start-up program is opaque black; program-test mode starts on opaque black. | Certain (fresh launch, from the source read); program-test mode as recorded in #1045 |
| W3 | Every outermost program start copies; nested (`executeProgram`) and thread (`thread()`) starts do not. | Certain |
| W4 | No frame is drawn between two programs that start in the same frame. The second copies the first's final screen, **including the message window's pixels** — ending a program only clears the window's visible flag. | Certain |
| W5 | Exceptions, where a fresh board is drawn first and therefore becomes the copy: an item trigger; an edge onto a board; closing the menu. | Certain |
| W6 | Same-frame program pairs: several run-time keys held at once; a step-on program then a custom-fight program; an activation-key program, then a step-on program during click-walking. | From source |
| W7 | The overlay and thread animations are **not** drawn continuously while a program runs. A program shows only its own surface with the message window on top of it. | Certain |
| W8 | Commands that redraw the board into the program's surface bake in the board, the thread animations and the overlay as a one-time snapshot, **erasing what the program had drawn**: `send`, `Load`, `forceRedraw`, `setAmbientLevel` (which calls `forceRedraw`), `layerPut`, `putPlayer` / `erasePlayer` / `destroyPlayer`, `putItem` / `eraseItem`, setting the player's or an item's direction, the `menu` command after the menu closes, and every frame of blocking movement (`playerStep`, `itemStep`, `push`, `pushItem`, `wander`, the path commands, the end of a `multiRun` block) and of custom stances (`playerStance`, `itemStance`, `posture`). | Certain |
| W9 | Turning the render-now overlay on or off redraws nothing. Drawing into the overlay canvas is not seen until the next board redraw. | Certain |
| W10 | The OS mouse pointer is usually not in the copy. The engine's own hand pointer is in it only if it was on screen at that moment; for the menu this is the engineer's guess. | Certain (OS pointer); Guess (hand pointer in the menu) |
| W11 | In full-screen mode ambient light is applied as a gamma ramp on presentation, so the copy is untinted. In windowed mode, or when no gamma ramp is used, the tint is built into the tile and sprite pixels, so the copy includes it. | From source |
| W12 | **Load inside a program:** loading redraws the message window's background in memory; the player is placed as for `send` (view scrolled, tile cache rebuilt, programs under the player disarmed); the board — board, sprites, thread animations, overlay — is drawn into the program's surface, replacing what the program drew; the surface is presented with the window on top if its flag is set. Load changes neither the window's visible flag nor its text. Then board music starts. Then the loaded board's enter program runs, **nested** (so it does not copy). The calling program continues on top of the loaded board. The menu's Load does the same through a one-line script. | Certain except where the engineer labelled otherwise |
| W13 | Boot: the start-up program is the first outermost program; the first board loads without drawing, so the board's enter program copies the start-up program's last presented frame and the first ordinary frame corrects it. | Source read (board load without a draw: certain) |
| W14 | An edge link to a `.prg` does not load a board, so the program it runs copies the frame that was on the display. | Source read |

Consequences for the composition, which are the ones this ADR rules:

* W7 and W8 mean the legacy program surface is a **frozen** image. The board underneath a program does not animate, and the overlay does not update. A program that wants the board again must call a redraw command, and that call throws away what the program drew (W8).
* W4 means "the last presented frame" can be a **program's own final screen**, window included, and not only a free-roam board frame.
* W5 and W13 and W14 decide which of the two it is at each kind of start.
* W10, W11 and W9 decide what the copy contains beyond the board and the overlay snapshot: no cursor, tint included, and the overlay as it stood at its last redraw.
* W12 is the one command whose behaviour is fully specified for the copy: it redraws the loaded board into the program's surface and nests the enter program, so nothing is copied and the calling program keeps running over the restored board.

## Decision

### 1. The core composes the copy; nothing crosses the host boundary

The engine keeps, outside `GameState`, a **presented frame**: the draw list the game last presented, composed by the core's pure compositor, plus the surface pixels that list names. It is rasterised by `core/raster` — the same reference rasteriser every script-visible screen read already uses — and never by a host, and never read back from one.

There is no `captureFrame` request, no `frame.captured` event, no RGBA bytes in the request or event unions, no replay-log record, no failure mode, no fallback reply, no runner obligation and no dimension or size validation. AD-5 and AD-14 are unchanged.

### 2. Rules R0–R5

**R0 — Initial state.** At engine creation, after `reset()`, and in program-test mode (`engine <game.gam> <program.prg>`) the presented frame is **opaque black**: every pixel `r=g=b=0, a=255`. A start-up program, and the first board's enter program when there is no start-up program, copy that black frame (W2, W13).

**R1 — Every tick end commits a presented frame.** After a tick's phases and the engine work that follows them (`drive`: a pending `send`, a board transition, the boot stages), if no outermost program is alive, the presented frame becomes `compose(state, alpha = 1, active = false, include = the engine's configured draw-list flags)`. Alpha 1, not 0: the presented picture is the unchanged tick-end picture, and the interpolation alpha is a presentation-only input ([main-loop-and-startup.md#reawakened-presentation-alpha](../spec/engine/main-loop-and-startup.md#reawakened-presentation-alpha)). Committing after the tick's follow-up work is what makes a program started by an edge, by `send`, or by a boot stage in that work see the previous commit and not the boards that just loaded.

**R2 — The copy is opaque.** The copy is rasterised over a black base, so its alpha channel is 255 everywhere. A program that clears a part of its surface reveals black, as the legacy copy does, not the live board.

**R3 — A program's final screen can be the copy.** When an outermost program ends and another program starts **in the same frame** (W4), the second copies the first's final screen: that program's surface plus its message window pixels as they stood when it ended. The engine commits that final screen as the presented frame at the moment the outermost program ends, before the window's visible flag is hidden. Ending a program hides the window and keeps its text (already ruled in [main-loop-and-startup.md#reawakened-script-surface-lifecycle](../spec/engine/main-loop-and-startup.md#reawakened-script-surface-lifecycle)); it does not redraw anything.

**R3a — Where the boot chain is the same frame.** The start-up program's end and the first board's enter program start with no frame between them (W13), so the enter program copies the start-up program's final screen, window included, over the black frame of R0. This is the case [#1171](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1171) records.

**R3b — Where a fresh board is drawn first.** An item trigger, an edge onto a board, and closing the menu draw the new board before the program starts (W5), so those programs copy the **board** frame, not the previous program's screen. Everything else is R3.

**R4 — Load rebuilds, it does not copy.** A loaded game's presented frame is `compose(restored state, alpha = 1, active = true)` — the loaded board drawn into the program surface, exactly what W12 describes. Nothing is carried over from before the load. The window's visible flag and text are unchanged by Load (W12), and the board's enter program runs nested, so it makes no copy.

**R5 — Start replaces the layer.** At every outermost program start the engine rasterises the presented frame and **replaces** the script-screen layer with it (`replaceSurface` on the reserved layer), after the existing reset of the message window and text layer. The script-screen layer is this engine's program surface: the reserved persistent surface a script draws to when it names no canvas. Nested program and thread starts do nothing. Replacing, not compositing over, is what makes a finished program's drawing disappear ([#1172](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1172)) and what makes the program's surface destructive, as the legacy copy is.

### 3. Target presentation model, and the gap between it and this engine

**The model (Toolkit 3.1; engineer answers P1, P2 and P5, all labelled certain).** The program surface is a surface in its own right, not a layer over a board that keeps being drawn:

* **Free roam.** The engine composes the live board every frame: board, sprites, thread animations, the render-now overlay.
* **While a program runs.** The frame is the program surface, then the message window on top of it. The live board is **not** composed beneath it, the thread animations are not drawn, and the render-now overlay is not drawn live: what the overlay holds at that moment is what the last board redraw baked into the surface.
* **Board redraws.** Only the P2 commands redraw the board, the sprites, the thread animations and the overlay **into** the program surface from scratch, erasing what the program had drawn, and then present the message window over them: `send`, `Load`, `forceRedraw`, `setAmbientLevel` (which calls `forceRedraw` after applying the tint), `layerPut`, `putPlayer` / `erasePlayer` / `destroyPlayer`, `putItem` / `eraseItem`, setting a player's or an item's direction, `menu` after the menu closes, every frame of blocking movement (`playerStep`, `itemStep`, `push`, `pushItem`, `wander`, the path commands, the end of a `multiRun` block) and custom stances (`playerStance`, `itemStance`, `posture`).
* **The end of a program.** Ending it clears only the window's visible flag; nothing is drawn, so the window's pixels and the program's last screen stay on the display until the next draw — and stay through an interval in which nothing draws, as during a board load.

**The gap in this engine (measured on `origin/main` `94d5a00e`; audit of #1170).** There is no program surface distinct from the live board:

* `currentDrawList` composes the live board under the program on every frame and appends the render-now overlay (`engine.ts:3065`) and the thread-animation blits (`engine.ts:3068`) on **every** frame, outside the gate that restricts the script layer and the window to a running program (`engine.ts:3062-3063`, `:3070-3072`). A program that never touches the overlay still shows it, and shows animations running, over its own drawing: [#1183](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1183).
* No P2 command redraws into a program surface. `forceRedraw`, `putPlayer`, `erasePlayer`, `putItem` and `eraseItem` are catalogue stubs that validate their arguments and record nothing (`packages/core/src/script/catalogue-stubs.ts`); `layerPut`, `destroyPlayer`, `playerStep`, `itemStep`, `pushItem`, `playerStance`, `itemStance` and `posture` have no behaviour; `menu()` is accepted and ignored; `setAmbientLevel` writes the ambient immediately and lets the next composed frame pick it up (`packages/core/src/script/packs/world.ts`); `send` loads the board but leaves the program's drawing composed. Issue [#1182](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1182).
* The render-now toggle and drawing into the canvas take effect on the next composed frame instead of at a board redraw ([#1184](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1184)); an ambient assignment takes effect at once instead of after a redraw ([#1185](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1185)); a finished program's window pixels vanish on the next composed frame instead of remaining on the display until something redraws ([#1186](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1186)).

**One missing model, five facets.** #1171 (an empty frame between the start-up program's end and the first board), #1172 (a finished program's pixels composed into every later program), #1182, #1183 and #1186 are all the same gap: a program surface that is drawn once and redrawn only by the P2 commands. The copy this ADR rules (R0-R5) **seeds** that surface. It does not by itself produce the Toolkit 3.1 display, because the live board and the live overlay would still be composed around the surface until the model changes.

**What the copy rules assume either way.** R0-R5, the overlay-as-snapshot ruling and the cursor ruling are the same under both options of the open question in section 11: free roam composes the overlay, so a copy of a free-roam frame contains it. What the open question decides is whether the **running** program's frame is the surface plus the window (3.1) or the live board plus the surface plus the live overlay (today).

### 4. What the copy contains

**Included:** the board with tint baked into its pixels (W11), thread animations and the render-now overlay **as a snapshot** at their last redraw (W7, W9); a previous program's surface and message-window pixels when R3 applies (W4).

**Excluded:** the engine's and the system's cursor (W10): the copy is taken without the cursor blit, whatever `mouseCursor` or a cursor map says at that moment. A full-screen gamma ramp is a presentation effect and never part of the copy; the core's ambient shading is in the board pixels (W11).

**The overlay is in the copy, not composed live.** Free roam composes the render-now overlay, so a copy of a free-roam frame contains it; under the model in section 3 a running program's frame draws the overlay only as part of its surface, and only a board redraw updates it. The overlay is therefore **in** the copy and **not** composed above a running program.

**This engine does not do that today.** It composes the enabled canvas (`engine.ts:3065`) and the thread animations (`engine.ts:3068`) on every frame while a program runs, outside the gate at `engine.ts:3062-3063`, so the overlay, the animations and the live board are all still there. That is [#1183](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1183), and it stays open until the model in section 3 is adopted. This ADR states the required behaviour and does not assert that any part of it is implemented.

### 5. Determinism, hash, save and restore

**Determinism.** The presented frame is a pure function of the sequence of tick-end states and of the asset cache, which is itself fed by the input log. It does not depend on tick batching (R1 commits per tick), on presentation cadence, on `alpha`, or on the runner. G3 rule 3 — same game data, seed and input log give identical state and draw lists on every runner and machine — holds with no new record: there is nothing to record. A script that reads its starting frame reads the same pixels under the headless runner, the browser runner and a replay of a recorded log.

**Hash.** The presented frame is a derived presentation cache and is **excluded from `hashGameState`**, by the ruling in [save-game.md#state-hash-surface-projection](../spec/formats/save-game.md#state-hash-surface-projection): the presented screen surface (`surfaces.entries["0"]`) and the script-screen layer (`surfaces.entries["-1"]`) are hash-neutral. The copy lives in that layer (R5), so it inherits the exclusion, and the engine keeps the presented frame outside `GameState`, so no engine field changes either. What a script *reads* from the copy and stores — variables, `cnvX` canvases, screen slots — stays hashed, exactly as any other screen read does; because the copy is core-derived, that store is deterministic.

**Goldens.** A frame in which an outermost program is on screen gains the copy: the start-up program's frame becomes opaque black plus its drawing and window instead of a 99 %-transparent frame, and every program frame gains its layer blit. Free-roam board frames are unchanged (measured on the demo fixture during the #1067 investigation: its tick-120 board frame is already fully opaque, while the start-up program's frame is about 99 % transparent). Re-recording is a deliberate G5 change and must be explained in the PR that implements this ADR.

**Save.** No schema change. The script-screen layer already travels in the `surfaces` section, now holding the copy. The presented frame itself is not saved.

**Restore.** On load the engine rebuilds the presented frame from the restored state before any script runs (the same point where it already recomputes the screen surface), so **[#1177](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1177)'s "continue after Load" path starts from the loaded board**, as R4 requires.

**Two windows a save cannot reproduce, stated rather than hidden.** A snapshot taken while an outermost program has ended and a chained programme file is still loading, and a snapshot taken at a debugger pause in the middle of a tick, can leave the presented frame meaning "a frame that the current state alone does not describe". Restored and uninterrupted runs then differ in *what the next program copies*, by exactly the difference between the saved frame and `compose(state)`. Nothing else differs: the frame is outside the hash, saves and replays are unaffected, and no rule above depends on it. If the owner later wants exact continuation equality in those two windows, the route is one reserved hash-neutral surface entry, materialised lazily inside `snapshot()` — never per tick; encoding a surface into state costs more than a 60 Hz tick. It is not part of this ADR.

### 6. Consequences for the guard-rails

* **G1 is preserved.** No asynchronous boundary is introduced. Nothing waits, nothing is pumped, no state is added to the VM.
* **G2 is preserved.** Core still never reads a display, a window, a platform surface or a framebuffer. The frame is composed and rasterised inside `core` from pure state.
* **G3 is preserved, and this time provably.** See section 5. The rejected seam would have failed G3 for any script that reads its frame.
* **G4 is preserved.** The copy is rasterised by the reference rasteriser in `core/raster`; runners replay draw lists and are not asked for pixels.
* **G5 changes deliberately.** Program frames gain the copy; the golden re-record is part of the implementation PR.
* **G6, G7 unchanged.**

### 7. The owner's questions, answered

The six questions the superseded design left open are ruled as follows.

| # | Question | Ruling |
|---|---|---|
| 1 | Scope of programs that capture | Every outermost program start: start-up program, board enter program, item activation, step-on trigger, edge link to a `.prg`, run-time key program, menu-choice program, battle handoff, recovery resume. Nested programs and threads do not copy (W3). |
| 2 | Overlay and cursor inclusion | The overlay and thread animations are included as the snapshot they were (W7, W9). The cursor is excluded (W10). The board tint is included because it is in the board pixels (W11); a full-screen gamma ramp is not, because it is presentation. |
| 3 | Null fallback colour | Opaque black (`a=255`, `rgb=0`), for the initial frame and in program-test mode (W2). |
| 4 | Premultiplied alpha | Moot: the copy is opaque, so there is no alpha to interpret. |
| 5 | Saved-game capture replay | A Load rebuilds the frame from the loaded state (R4, W12); nothing is captured, so nothing has to be replayed. |
| 6 | Program-test mode | Opaque black, and no board and no prior frame are read (W2). |

### 8. Smallest implementation plan

Design only; no code is part of this ADR. The estimate below comes from the #1067 feasibility report and the #1170 P-point audit; it is not measured against a branch.

**Order.** Three landings, in this order, with the ordering argument stated because it is not the obvious one:

1. **The program surface and the copy that seeds it, together.** Make the program surface a real surface and change composition: while a program runs, compose its surface and then the message window, gated off the live board, the thread animations and the live overlay; in free roam keep composing the live board. Land it with R0-R5 (the presented frame, its tick-end and program-end commits, the opaque base, the cursor exclusion, the `Load` rebuild and the R5 replacement). **Why not the copy first and the gate later:** gating the live board out without seeding the surface turns every program that draws partially — a HUD, a dialogue, a title that paints a panel — from "the board behind it" into "black behind it", which is worse than today; the gate cannot ship without the seed. **Why not the P2 commands first:** the commands redraw *into a program surface*, so there has to be one. Closes the model gap this ADR's section 3 names: #1183, and with it #1171, #1172 and #1186, whose symptoms are the same missing model.
2. **The P2 redraw commands.** `forceRedraw`, `setAmbientLevel`, `layerPut`, `putPlayer` / `erasePlayer` / `destroyPlayer`, `putItem` / `eraseItem`, the direction setters, `menu` after it closes, the blocking-movement frames and the custom stances, each redrawing board, sprites, thread animations and overlay into the program surface from scratch: [#1182](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1182). `menu()` itself and the command's own screen are separate work.
3. **The remaining P-facets.** The render-now toggle and `cnvRenderNow` drawing taking effect at the next board redraw ([#1184](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1184)), and the ambient assignment going through a redraw instead of tinting the next composed frame ([#1185](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1185)). Both are small and independent of the copy.

**Touch list.**

1. **Engine (`packages/core/src/engine/engine.ts`).** A presented-frame holder outside `GameState` (a draw list plus the `id:rev` snapshots of the surfaces it names, a baked frame, or black); `compose` split so a frame can be taken without the cursor; the R1 commit after the tick's follow-up work; the R3 commit at outermost program end; the R4 rebuild in the load path; and one `beginOutermostProgram()` that performs the existing UI reset and R5, replacing the seven places in `engine.ts` that reset UI for a program start today (`engine.ts:576, 603, 1062, 2021, 2046, 2243, 2538`).
2. **Triggers (`packages/core/src/triggers/runtime.ts`).** The trigger phase starts programs without the engine's knowledge today; give it the engine's start hook (or detect the outermost start around the `triggers` phase) so R5 runs before the first instruction.
3. **Raster (`packages/core/src/raster/surfaces.ts`).** One helper to decode a retained surface snapshot for the rasteriser's textures map.
4. **No change** to `ports/requests.ts`, `ports/input.ts`, any runner, `GameState`, the save schema, or `save/hash.ts`.
5. **Docs first, in their own commit (G7 rule 4).** This ADR; the spec rule and the paragraphs it replaces; the lifecycle table rows; the note in [runners.md](../spec/engine/runners.md#surface-read-and-state-hash) that the starting copy is core-composed.

### 9. Test matrix

Each row names the perturbation that must make it fail. Ordinary unit tests stay under one second (AGENTS: tests stay fast); deterministic behaviour is asserted at representative ticks, not replayed tick by tick.

| # | What it proves | Perturbation that must fail it |
|---|---|---|
| T1 | Free-roam copy excludes the finished program's text and message window, and includes the board and the render-now overlay. Program A draws text and opens a window, ends; one free-roam tick; program B reads pixels through `getpixel`. | Compose the copy with a program treated as active. |
| T2 | One-movement-increment lag: a step-on program copies the frame from before the step it responded to. | Capture at program start instead of at tick end, or compose the copy at alpha 0. |
| T3 | Batching independence: the same inputs as N `advance(1)` calls and as one `advance(N)` leave program B's copy and every state hash identical. | Commit the presented frame at the end of `advance` instead of at each tick end. |
| T4 | An edge link to a `.prg`, and an edge onto a board whose enter program runs, copy the old board's frame. | Commit R1 before the tick's follow-up work. |
| T5 | R3a boot chain: a start-up program draws text and a window; the first board's enter program copies that final screen over opaque black, matching #1171's expectation. | Let R1 overwrite the R3 commit with the board-less frame. |
| T6 | R0: with no start-up program the first board's enter program copies opaque black, every pixel `a=255`. | Skip the black base of R2. |
| T7 | R3 versus R3b: two programs in one frame copy the first's final screen; an item trigger after a free-roam tick copies the board, not the previous program's screen. | Treat every start as R3, or every start as R3b. |
| T8 | Nested `executeProgram` and `thread()` leave the script-screen layer's revision unchanged. | Seed the layer in the thread-start path. |
| T9 | R4: a Load renders the loaded board into the program's surface and does not carry the pre-load frame; the loaded board's enter program makes no copy; the window's flag and text are unchanged. | Reuse the pre-load presented frame after a Load. |
| T10 | A snapshot taken at a tick boundary restores to a run whose next program copies the same pixels and reports the same state hash; the two documented unrecoverable windows are asserted as limitations, not silently accepted. | Make the copy depend on batch size or on a closure-only fact. |
| T11 | Hash neutrality: copies that differ in pixels leave `hashGameState` equal while no script reads the frame; `canvasgetscreen` of the copy into a `cnvX` moves the hash identically on every run. | Hash the script-screen layer. |
| T12 | Golden: program frames re-recorded with the reason stated; Node and Bun replays agree. | — |
| T13 | Cost structure: a multi-tick batch with no program start writes neither the presented screen nor the script-screen layer more than once; no wall-clock assertion. | Rasterise per tick. |
| T14 | The compositor excludes the cursor from the copy, and excludes the live overlay from a running program's frame. | Include the cursor blit; compose the live overlay above a program's surface. |
| T15 | **Depends on landing 2 of section 8 (#1182).** A P2 redraw command (`forceRedraw` as the representative) erases what the program drew and bakes in the board, thread animations and overlay as a one-time snapshot; a later tick does not re-compose the live overlay over the program. | Draw the redraw as a composite layer instead of a replacement. |
| T16 | **Depends on landing 1 of section 8 (#1183).** The live overlay is not composed over a program's surface (required behaviour, section 4). | Compose the enabled overlay while a program runs, as `engine.ts:3065-3068` does today. |
| T17 | **Depends on the owner adopting the 3.1 model (section 11) and on landing 1.** A running program's frame is its surface then the window: no live board beneath, no thread animation, no live overlay. A program that only calls `wait()` shows the copy, not the board. | Recompose the live board or the live overlay around the surface. |
| T18 | **Depends on landing 1 (#1186).** A program ends with its window open: the window's pixels stay on the display until something redraws, instead of vanishing on the next composed frame. | Hide the window and recompose on the frame the program ends. |
| T19 | **Depends on landing 3 (#1184).** `rendernow(true)`, `rendernow(false)` and drawing into `cnvRenderNow` take effect at the next board redraw, not on the next composed frame. | Re-read the canvas every composed frame. |
| T20 | **Depends on landing 3 (#1185).** An ambient assignment takes effect through a redraw, not by tinting the next composed frame; the program's drawing survives the redraw only as the P2 rule says. | Apply the new ambient to the next composed frame, as `script/packs/world.ts` does today. |

### 10. What this design does not decide

* Where the presented frame lives inside the engine, or how it is retained (a draw list plus surface snapshots, or a baked image). Both satisfy G3; the cheaper one is the draw list, because composing one costs about 0.03 ms while rasterising and encoding a frame costs tens of milliseconds (measured on the demo fixture during the #1067 investigation; a single machine and run). That choice belongs to the implementation.
* Whether core implements W8's redraw commands, and in which order. This ADR only fixes what they must do to the program surface if and when they exist.
* The exact pixel difference between core's movement increment and the legacy engine's. The copy's one-increment lag is reproduced in principle; its size in pixels is a movement-model question.

### 11. Open owner question: adopt the 3.1 presentation model, or record a deliberate difference

The one thing this ADR does not decide. Section 3 describes Toolkit 3.1. This engine does not do it (#1182, #1183, #1184, #1185, #1186). Two ways forward, both consistent with everything else in this ADR:

**Option A — adopt the model.** A program surface in its own right; while a program runs the frame is that surface plus the message window; the board, the thread animations and the overlay reach the program only through a P2 redraw or `Load`; ending a program leaves its screen and window pixels on the display until something redraws.
* *Fixes:* #1171, #1172, #1182-#1186, and the double composition that makes a program's frame differ from 3.1.
* *Costs:* the P2 commands must exist for a program to get the board back, so landing 2 of section 8 is required work rather than optional; programs that today draw a HUD over a live board would show a frozen board, as 3.1 does; animated tiles, sprites and the overlay freeze during a program, which is also 3.1; golden frames and any game behaviour that depends on the live board beneath a program change.
* *Risk if adopted halfway:* gating the live layers without seeding the surface (see the ordering argument in section 8).

**Option B — record a deliberate difference (the ADR 0009 route).** Keep composing the live board, the thread animations and the live overlay during a program. Then the starting copy exists only as script-visible pixels (`getpixel`, `canvasgetscreen`, `savescreen`), a program never gains the board through a redraw, and #1182 and #1183 are closed as documented differences. #1172 is still fixed by R5, because the copy replaces the layer whatever the model; #1171 and #1186 still need their own rulings, because they are about what the display keeps between draws, not about live composition.
* *Costs:* every program that relies on P1, P2 or P5 displays differently from Toolkit 3.1, permanently; the E-57 wording must then say that the overlay composes every frame, and the copy's "snapshot" semantics become a statement about script-visible pixels only.

The copy rules themselves (R0-R5, overlay-as-snapshot, cursor excluded, tint included, the `Load` sequence) are the same under both options. **The owner decides which.**

## Relation to open issues

#1171, #1172, #1182, #1183 and #1186 are facets of one missing model — a program surface that is drawn once and redrawn only by the P2 commands (section 3). The copy this ADR rules seeds that surface; the open question of section 11 decides the rest.

* **[#1067](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1067)** — this design is its answer. The ticket's "Proof of fix" mentions an interactive runner supplying the prior pixels; under this ADR no runner supplies pixels, so the proof becomes the core tests in section 8 plus the golden re-record.
* **[#1171](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1171)** — the empty frame between the start-up program's end and the first board. R3a commits the start-up program's final screen as the presented frame, so that interval presents the title rather than an empty draw list.
* **[#1172](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1172)** — a finished program's script-screen pixels composed into later programs. R5 replaces the layer at every outermost start, which is the replacement #1172 asks for.
* **[#1177](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1177)** — Load from the start program. R4 gives the frame semantics W12 describes (loaded board drawn into the surface, enter program nested, no copy). #1177's other half — whether the calling program continues after `load`, and whether the VM is replaced — is a save-model ruling recorded in [save-game.md](../spec/formats/save-game.md) and is **not** decided here.
* **[#1182](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1182)** — no P2 command redraws into a program surface and `forceRedraw` is a stub. Landing 2 of section 8.
* **[#1183](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1183)** — the overlay and thread animations compose during a running program. Landing 1 of section 8; the required behaviour is in section 4.
* **[#1184](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1184)** — the render-now toggle and `cnvRenderNow` drawing take effect on the next frame, not at a board redraw. Landing 3.
* **[#1185](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1185)** — an ambient assignment changes the composed frame at once. Landing 3.
* **[#1186](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1186)** — a finished program's window pixels vanish on the next composed frame. Landing 1.
* **[#1045](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1045)** — the engineer's answers this ADR builds on, and the lifecycle rule it extends.
* **[#1048](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1048)** — the hash projection and read-only accessor this ADR reuses.
