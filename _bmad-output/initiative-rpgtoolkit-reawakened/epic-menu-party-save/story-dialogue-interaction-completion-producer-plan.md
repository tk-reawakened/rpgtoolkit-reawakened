---
title: "Dialogue interaction completion producer"
type: 'feature'
ticket: 11
created: '2026-10-22'
risk: "high"
status: done
context:
  - "spec - docs/spec/engine/plugins-and-battle.md#e-95"
  - "spec - docs/spec/engine/rpgcode-modules-and-objects.md#emit-13"
  - "handoff - Epic 4 ticket 4.21 / issue #406"
---

## Intent

Add an Epic 8.11-owned `dialogue(text)` RPGCode wrapper around Epic 4.21's existing message-window and input-wait behavior, producing the completion signal needed by the stock `talked` bridge.

## Boundaries

The `dialogue(text)` wrapper and its queued game-level completion only. Epic 4 continues to own message/modal UI; Epic 20 owns actor records and emitter registry; entry 12 owns the stock package bridge.

## Key decisions

One `dialogue(text)` call is one interaction. It applies the existing message-window variable splicing, displays that string through the message window, then waits for the next unclaimed input key with existing `wait()` semantics and returns the consumed key name. It captures actor IDs from the running VM's source and target; source must resolve to a live actor, while an unresolved target becomes `null`. After normal key completion it queues `{ actorId, targetId, text }` on the game emitter, with `text` matching the displayed string. Cancellation and errors before completion emit nothing.

## Acceptance

A script invokes `dialogue(text)`, sees the exact supplied text after normal message-window splicing, and produces one completion event with correct actor IDs; interrupted, failed or targetless interactions follow the ruled behavior and survive snapshot/restore mid-wait.

## Verification

A deterministic headless fixture checks event queue ordering/detail, normal input completion and interruption/failure branches, source/target context, and snapshot/restore mid-wait without duplicate delivery.

## Implementation map

Reuse the existing 4.21 message-window and input-wait behavior; add only the `dialogue(text)` wrapper and completion producer. Keep the signal distinct from renderer-level `render.msgbox` and `menu.screen`.

## Code Review

### 2026-10-23

1 patch finding; no decision-needed or deferred findings. Blind Hunter and Edge Case Hunter reported no actionable defects; Intent Alignment found the diff implements the wrapper-and-producer intent, while noting tests omit returned key, non-null target, and cancellation/failure cases.

- [x] [Review][Patch] Assert the key returned by `dialogue(text)` [packages/core/test/events-game.test.ts]

Rejected: none.
