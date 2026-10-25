---
title: "The default battle UI"
type: 'feature'
ticket: 11
created: '2026-10-19'
status: draft
baseline_revision: '4255ec6f520af495d3aa2db8ed2553cb685ea3ab'
risk: "medium"
context:
  - "spec - docs/spec/engine/battle.md as ruled by 7.1 (BAT-11)"
  - "spec - docs/spec/engine/plugins-and-battle.md#e-73"
  - "code - packages/core/src/script/packs/graphics.ts"
  - "code - packages/core/src/script/packs/ui.ts"
  - "code - packages/core/src/script/packs/input.ts (the key queue)"
---

## Intent

Build the stock package's default battle screen from the drawing and input primitives 3.1 already has: the `.bkg` background, enemy and player sprites with stances and animations, HP/SMP/charge bars, names, the Fight/Special/Item/Run list with a cursor, target selection, damage numbers and messages. The screen is redrawn each tick into the render-now canvas and reads the existing key queue.

The owner approves the layout and the golden frame before the entry is done.

## Boundaries

No new drawing primitives. No new input device abstraction. The UI never mutates battle state; it draws it and returns a choice. Menus and inventory screens are Epic 8. Visual identity with the legacy stock plugin is a nice-to-have, not a gate.

## Key Decisions

1. **Primitives.** Background via `drawcanvas`/`bitmap`; bars via `fillrect` and `drawrect`; text via `text` and `pixelText`; sprites via `bitmap`; the final frame via `rendernow`. No `drawBox`, no `drawBar`, no new pack row.

2. **Layout.** A layout expressed relative to the main file's resolution (640×480 is the default; 800×600 and 1024×768 are the others): enemies across the upper band, players in a lower-right status column, the command list lower-left, messages in the centre band, anchored so a larger resolution adds space rather than moving a panel off-screen. Coordinates and sizes live in one data table in the package so the owner can review them as values, not as scattered calls.

3. **Bars.** HP and SMP bars show `current / max`; the charge bar shows `chargePercent`. A bar redraws from state each tick; it keeps no animation state of its own. Damage numbers are short-lived, tick-counted, and drawn from a list cleared at the start of the action.

4. **Input.** The existing key queue supplies up/down/confirm/cancel; the UI maps them to list moves and target moves. No new key names. A held key is one move per tick, not a repeat storm.

5. **Target selection and refusals (R11-Q7, Q9, Q11).** Fight and Special move the target cursor across living opponents (a defeated enemy stays in its slot, shows its defeat animation and is skipped); Item moves across party members, **including fallen ones**, so a healing item revives them. A special whose cost exceeds the player's current SMP is refused and the player stays in the menu. When running is blocked, Run is still listed but drawn differently, and choosing it plays the cancel sound and keeps the turn; when allowed it is immediate (7.8 rolls the chance). Cancel returns one level; at the top level it does nothing (it does not open a menu).

6. **Golden and approval.** A seeded battle renders one deterministic frame after a fixed scripted input sequence. The owner approves it at the plan checkpoint and again at done; the draw list and image are re-recorded only deliberately (G5), with the reason in the commit.

## Acceptance

1. A seeded battle renders a deterministic golden frame that the owner approves.
2. Every command and every target is selectable with the keyboard; cancel returns one level and never opens a menu; a blocked Run plays the cancel sound and keeps the turn; an unaffordable special keeps the player in the menu; a healing item can target and revive a fallen ally.
3. Bars and sprites reflect the battle state and the UI never mutates it.
4. Only the ruled primitives are used; no new pack row is added.
5. A held key moves one step per tick.
6. The draw list and golden are re-recorded only deliberately, with the reason recorded.

## Verification

Golden-frame test with a fixed input script, an input-mapping test, a no-mutation test (state hash before/after drawing), a primitives grep, and the draw-list diff check. Full suite, typecheck and lint. Owner approval recorded in the spec's `status` and the PR.
