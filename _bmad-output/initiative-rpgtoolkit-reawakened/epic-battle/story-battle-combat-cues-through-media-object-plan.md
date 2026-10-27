---
title: "Battle combat cues through the media object"
type: 'feature'
ticket: 19
created: '2026-10-26'
status: draft
risk: "medium"
context:
  - "spec - docs/spec/engine/battle.md (BAT-10)"
  - "spec - docs/spec/formats/battle-data.md#fight-background-bkg"
  - "spec - docs/spec/engine/audio-media.md#audio-save-load"
  - "spec - docs/spec/engine/plugins-and-battle.md#e-71"
---

## Intent

Complete the combat-cue routing and end-to-end verification gaps in Epic 7.10 through the media object. First determine the cue inventory from the approved BAT-10, `.bkg`, and media contracts; do not infer or invent names, triggers, or battle/menu ownership.

## Boundaries

Only contract-supported battle-combat cues are in scope. Menu move/confirm/cancel cues remain with 7.11. If an approved contract does not establish a cue's name, trigger, or ownership, record the unresolved source gap and do not guess it. Do not add battle-specific audio data to `BattleSection`; playback state is owned and persisted by the independent audio section.

## Acceptance

- [x] Before implementation, record each approved battle-combat cue (docs/spec/engine/battle.md#bat-10-cue-inventory, commit 468cd29f), trigger, and battle/menu ownership from the approved contracts; do not infer a map.
- [x] Every contract-supported combat cue uses the media object; missing cues are silent and battle continues.
- [x] Same-tick cues mix as voices over music.
- [x] The `battle` source reaches `beforePlay`; cancellation and replacement work. A listener failure rejects only the separate music-start request, without a fallback cue; it does not reject or undo battle start.
- [x] Null and real runners produce the same cue stream and canonical state hash for identical battle inputs. Tests: `packages/synth/test/battle-lifecycle.test.ts` (paired real PCM-rendering and null audio runners over an active battle with battle music and readySound); `packages/core/test/battle-cues.test.ts` and `battle-cues-engine.test.ts` (core and engine deterministic replay).
- [ ] Real battle save/load restores the battle and independent audio section under `audio-media.md#audio-save-load`; playback is restored from the independent audio section, not reconstructed from `BattleSection`. After outcome, `boardReturned` causes the board/audio producer to request active-board music or `null` for silence; ordinary audio rules apply. (Partially verified at core and engine boundaries: `packages/core/test/battle-cues.test.ts` proves that a mid-battle core snapshot contains no audio in `BattleState`, and `restoreGameState` + `audioSaveProjection` restarts music once from position zero and resumes fighting; `packages/core/test/battle-cues-engine.test.ts` proves that a won fight announces `battleEnded` and the engine restores active-board music on `boardReturned`. Full end-to-end load-to-board-return across save/load cannot be proven together because engine-level runtime saved-game loading is not yet implemented — `SavedGamePort` in `ports/startup.ts` is currently only a boot-time stub. Criterion remains unchecked pending engine-level save/load implementation).
- [x] `BattleSection` contains no audio; no menu cue implementation is added.

## Verification

Use named tests on the real battle/media/save path, plus a paired null/real-runner replay. Before implementing, record the exact cue inventory and source contracts; assert cue counts/order, music playback state, canonical hashes, saved section ownership, and active-board return behavior.

## Plan Change Log

- 2026-10-26: created to isolate the 7.10 combat-cue/test gaps from 7.11 menu cues.
- 2026-10-26 (Main scope clarification): “listener failure rejects start” means the separate music-start request only; battle start is not rejected or undone. Save/load restores audio through the independent audio section, and outcome music uses the active board after `boardReturned`.
- 2026-10-27: made cue classification explicitly doc-first from approved contracts; kept menu cues in 7.11 and added the required 7.16 dependency.
- 2026-10-27 (cue inventory recorded, doc-first): `docs/spec/engine/battle.md#bat-10-cue-inventory` names each cue, trigger, route and owner from the approved `.bkg`, BAT-10 and media contracts. Routed here: `.bkg` `music` and board-return music (engine, already built), `readySound` and `cantDoSound` (`stock_battle`, `ui` track via `mediaPlay`; proposed ruling pending owner review). Not routed here: `selectSound`, `chooseSound` and the main-file cursor sounds (7.11). Source gap: whether a blocked Run plays `cantDoSound` or the menu cancel sound (R11-Q11) is left to 7.11; the existing blocked-Run `cantDoSound` site is kept.
- 2026-10-27 (delivered): tests `packages/core/test/battle-cues.test.ts` and `battle-cues-engine.test.ts`; `stock_battle` plays `readySound` (loop-start read of the fight background, no file request inside a pass); fixed a real defect the verification exposed: an engine-originated cancelable event fired inside a command (battle-start music with a `media` `beforePlay` listener) re-pointed the command thread, so the stock loop's `threadSleep(getThreadId())` failed (`packages/core/src/events/dispatch.ts`).
- 2026-10-27 (review gap closure): addressed ReviewAudio findings: added paired real PCM-rendering runner battle test in `packages/synth/test/battle-lifecycle.test.ts`; documented `.anm` frame sound ownership in `docs/spec/engine/battle.md`; fixed `cache.ready` reset when disabling status clamps full charge (`stock/stock_battle/startup.prg`); replaced stale commit reference with `468cd29f`; kept save/load-to-board-return AC unchecked and documented exact missing runtime engine-level save/load prerequisite.
