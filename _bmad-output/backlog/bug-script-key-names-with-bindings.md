---
id: 21
type: bug
title: "Keyboard action bindings replace script-facing key names"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#1091"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1091"
refined: true
hitl: false
risk: medium
severity: P2
---

# Keyboard action bindings replace script-facing key names

## Description

When an active keyboard key is bound to an action, its action label can replace the key name required by `wait()` and `waitinput()`. This makes existing RPGCode respond to a binding instead of the key, while action consumers must still receive every action produced by that keypress. Existing v1/v2 recordings and stock menu behavior must remain stable.
Verify: `pnpm build && node --test packages/core/test/input.test.ts packages/core/test/pointer-wait.test.ts packages/core/test/stock-menu.test.ts packages/core/test/save-migration.test.ts packages/runner-harness/test/driver.test.ts packages/runner-harness/test/script-plugin-host.test.ts packages/runner-harness/test/protocol-v3.test.ts && pnpm runner-protocol:check && node --test tools/fixtures/test/runner-protocol-v3.test.mjs`.

## Reproduction

1. Configure the legacy keyboard map so physical A produces the `left` action, then park a script in `wait()` or `waitinput()`.
2. Press A once.
3. Actual: the key result can be `left` or the host-supplied code name instead of the E-110 key name `a`; the active key event contract also lacks the required virtual-key value.
4. Inspect the default action resolution for an Enter key-down. It includes both `confirm` and `menu`, although the current stock-menu path may visibly consume only one key action.
5. Expected: one script-facing key record keeps its derived name, all resolved actions remain available to the screen that owned the event, and historical recordings retain their recorded behavior.

## Cause Hypothesis

Core currently allows a configured binding label or host-supplied name to become the queued key name instead of deriving the active name from the physical event. The active key shape also lacks the virtual-key value required by E-110. The default action table assigns Enter to both `confirm` and `menu`, and native and RPGCode input consumers do not expose all resolved actions consistently. Historical v1/v2 key records have their older shape and need their existing name-based behavior preserved.

## Acceptance Criteria

1. **Nameable active keys keep their physical names**
   **Given** a nameable v3 key after code aliases, character and virtual-key fallback have been applied, both bound (for example `KeyA` to `left`) and unbound, and a script waiting in `wait()`, `waitinput()` or `get()`
   **When** it is pressed, repeated and released
   **Then** each key-down, including each host repeat, appends exactly one derived-name physical key record; key-up appends none; the binding never replaces the physical name; and `wait()`/`get()` observe that same name while `left` remains dispatched.
2. **Every ordered action remains available to the owning consumer**
   **Given** a native provider and a stock RPGCode screen waiting for a key bound to `left`, `confirm`, `game.zeta`, and `game.alpha`, with `game.zeta` registered before `game.alpha`
   **When** the key is pressed
   **Then** each receives exactly `["left", "confirm", "game.zeta", "game.alpha"]` (engine-action order, then registration order); native `event.key` remains the first action and `event.actions` is the complete readonly array, while RPGCode `waitinput().actions` is a zero-based dictionary with `length`.
   **And** an active key still unnamed after code aliases, `char`, and `vk` fallback uses a separate non-physical record: it does not enter the legacy key queue, wake plain `wait()`/`get()`, or invent a key name; `waitinput()` returns `key:null`, first action, and all actions; native `event.key` remains the first action with the full array.
   **And** an action-only key result repeats the wait's pointer baseline just like a named key, so a same-tick pointer change remains visible to the next `waitinput()`.
3. **A menu action closes the stack through its original owner**
   **Given** Items is already open inside the stock main menu
   **When** that owning Items screen receives `menu`
   **Then** it closes the complete stock menu stack.
   **And given** the stock main screen owns a custom `confirm` + `menu` multi-binding, **when** `confirm` selects Items before the remaining `menu` action is handled, **then** the same ordered list closes the stack through Main; Items receives neither action and no action is replayed after closure.
4. **Default keyboard navigation has one semantic owner per key**
   **Given** a new project using active default bindings
   **When** Enter or NumpadEnter is pressed, including when `char` and `vk` are `null`
   **Then** its recognized physical code still derives `ENTER` and confirms without also producing `menu`, while `KeyM` remains a default menu binding.
   **And** the idle legacy `menuKey` bridge still opens the menu independently without adding `menu` to the active action list.
   **And** explicit custom Enter-to-menu and multi-action bindings remain supported without truncating resolved actions.
5. **Historical recordings and current contracts remain compatible**
   **Given** v1 or v2 replay records using the earlier key shape
   **When** those records are consumed by script waits, menu providers, or the stock menu
   **Then** their recorded names and historical menu behavior are preserved, the v1/v2 schemas, TypeScript frame types, and vector sets remain unchanged, and active v3 keys follow the derived-name contract.
   **And** the input, ACT-5, absent-main-file-default, E-80, and `waitinput()` specifications describe the implemented behavior; the recorded owner decision supersedes their conflicting default descriptions.
6. **Regression tests cover the changed paths**
   **Given** focused input, pointer-wait, native-menu, stock-menu, runner-harness replay/script-host, and runner-protocol v3 conformance suites
   **When** they run, including `pnpm runner-protocol:check` and `node --test tools/fixtures/test/runner-protocol-v3.test.mjs`
   **Then** they cover bound and unbound derived names; code-based aliases with null `char`/`vk`; one queue record per nameable key-down including repeats and none on key-up; `get()` name preservation; character and virtual-key derivation; NumpadEnter; exact mixed engine/registered action order at both consumers; RPGCode action dictionary shape; action-only routing without waking plain `wait()`/`get()`; action-only plus pointer-change baseline; semantic/gamepad/button-slot compatibility names; defaults, custom multi-bindings and the idle bridge; screen ownership and both stock-menu starting states; historical v1/v2 hashes, types and behavior; and v3 schema conformance.
7. **Or: no change is needed, with proof**
   **Given** every condition and compatibility boundary in criteria 1–6
   **When** the relevant focused suites and runner-protocol conformance check run on current code
   **Then** evidence shows all behaviors already hold, with results for each criterion recorded in Notes; this supersedes criteria 1–6.

## References

- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1091
- prior regression — https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/1589 and https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1607
- input contract — docs/spec/engine/display-input-audio.md, E-110 key names and ACT-4/ACT-5
- main-file defaults — docs/spec/formats/main-file.md, `inputSettings` absent-block rule
- runner input — docs/spec/engine/runners.md, Input and focus
- runner protocol — docs/spec/engine/runners.md, `drift-check`
- script input wait — docs/spec/engine/rpgcode-functions.md, `reawakened-waitinput`
- stock menu — docs/spec/engine/plugins-and-battle.md, E-80 stock menu

## Notes

- Decision (2026-11-20): New active defaults use Enter/NumpadEnter for `confirm` and `KeyM` for `menu`. Preserve explicit multi-bindings and every resolved action. An input event belongs to the screen that owned it; it must not leak to a screen opened by that same event. Keep v1/v2 replay semantics unchanged.
- Risk: medium — existing scripts can work around the issue by adapting to the binding label or switching to action waits, but menus and gameplay can still misroute input.
