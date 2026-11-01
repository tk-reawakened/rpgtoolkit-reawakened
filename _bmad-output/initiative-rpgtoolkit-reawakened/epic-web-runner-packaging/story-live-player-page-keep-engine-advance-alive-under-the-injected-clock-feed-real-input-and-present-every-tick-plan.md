---
title: 'Live player page: keep engine.advance() alive under the injected clock, feed real input, and present every tick'
type: feature
ticket: 16
status: draft
baseline_revision: '6b4357ed'
route: full
risk: high
review: quick
---

> **This entry is open work.** Issue [#1018](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1018) was incorrectly closed as completed by PR [#1019](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/1019); that PR only created this backlog entry and corrected documentation references that had falsely attributed the missing live loop to the already-done board-rendering entry 19 / #393. No live player page has been built. The entry stays `status: draft` / `state: backlog` until the owner schedules it.

## Intent

Wire the landed core engine loop (epic board-rendering entry 19 / #393) into the `runner-web` player page so the player is visible and interactive. Keep one `Engine` alive across animation frames, call `engine.advance()` once per frame under the injected clock, feed real keyboard/pointer events into the `core/input` section, present each tick's `DrawList` to the on-page canvas, route saves through the host blob boundary, and honour the presentation-only alpha ruling.

This entry does **not** add new core phases, new VM semantics, new render commands, or desktop/mobile shell chrome. It consumes the existing engine API and the existing `runner-web` presenter.

## Evidence policy

Implementation-facing choices cite the normative spec and AD decisions. Every proposed ruling states the rejected alternative. This plan does not read or copy legacy GPL source.

## Key rulings

### R-1 One engine per page, kept alive across frames

**Proposed ruling:** the player page creates one `Engine` from the loaded game state and reuses it for every `advance()` call. Engine creation, restore and teardown happen only at load/quit; frame-to-frame state lives in the engine's returned `GameState`. **Rejected:** creating a fresh engine per frame, which would break waits, RNG continuity and save state.

### R-2 Frame pacing and the injected clock

**Proposed ruling:** the host asks the core how many ticks to run per animation frame (1 by default, more under catch-up up to `maxTicks`) and passes the deterministic `InputRecord[]` for those ticks. The host never skips calling `advance()` for a frame unless focus is lost. **Rejected:** letting the browser's `requestAnimationFrame` delta drive simulation directly, which would make state depend on display timing.

### R-3 Real input maps to core/input records

**Proposed ruling:** DOM `keydown`/`keyup`, pointer and gamepad events are translated to the `InputRecord` shapes defined in `core/input` and delivered to `engine.advance()` stamped for the current tick. The `input` phase consumes them and writes the canonical `consumed` log. **Rejected:** resolving keyboard state outside the engine and passing synthetic commands, which would bypass the deterministic input log.

### R-4 Saves use the host blob boundary

**Proposed ruling:** the `saveBlob`/`loadBlob` requests emitted by the engine are routed to the same host boundary already used by `runner-desktop` and the headless runner. The web runner may use Cache Storage, OPFS or an in-memory store depending on the trust tier; the engine sees only the request/response contract. **Rejected:** letting the page write directly to `localStorage` or IndexedDB from inside the engine, which would violate G2.

### R-5 Presentation alpha stays out of state

**Proposed ruling:** alpha from the host (e.g. window fade) is passed to the draw-list presentation path only and is not included in `GameState` or in state/draw hashes. **Rejected:** storing alpha in the engine section, which would change hashes per frame.

## Implementation map

- `packages/runner-web/app/main.ts` — replace the one-shot `runScriptedFrame` path with a live loop: create/restore engine, schedule `advance()` per frame, collect DOM events into `InputRecord[]`, present `DrawList` to the canvas, and handle host requests (asset, blob, save, quit).
- `packages/runner-web/src/index.ts` — export the live-loop helper and the input-event mapping; keep `runScriptedFrame` for the existing closing/tracer lane.
- `packages/runner-web/app/index.html` — ensure the canvas and report elements exist; no new chrome.
- `packages/runner-web/test/runner-web.test.ts` — add a Playwright or node-test assertion that the live loop reaches tick 120 with the golden state hash `bff947dce3a11b4f` and that the visible canvas has non-zero drawn pixels.
- `docs/playing-the-desktop-player.md` — update to say the live loop is owned by web-runner-packaging entry 16 / #1018.

## Acceptance mapping

1. The demo reaches the board on a visible canvas.
2. Keyboard input moves the player.
3. The tick-120 state hash matches the golden `bff947dce3a11b4f`.
4. The draw list is presented every tick without changing state or hashes.
5. `focus.lost` pauses simulation; `focus.gained` resumes.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Frame pacing desynchronises from the engine tick | Always call `advance()` with whole ticks; let `maxTicks` bound catch-up. |
| Real input events reorder across frames | Buffer events into `InputRecord[]` per frame and stamp with the target tick. |
| Visible canvas differs from golden raster | Use the same `render-webgl2` replayer the closing lane uses. |
| Saves fail in a browser context | Route through the existing host blob request boundary, same as runner-desktop. |
