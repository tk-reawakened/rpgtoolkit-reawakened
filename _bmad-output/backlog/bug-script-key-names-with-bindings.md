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

With project key bindings configured, a bound key queues its action name (`left`) instead of the E-110 legacy key name (`LEFT`, `A`). The semantic action must still be dispatched and recorded beside the key entry, and the stock menu (which reads the semantic label) must keep working. The v3 key-record / ordered-action / replay-version protocol work is out of scope (tracked in #3286).
Verify: `pnpm build && node --test packages/core/test/input.test.ts packages/core/test/pointer-wait.test.ts packages/core/test/stock-menu.test.ts && pnpm golden && pnpm script:dogfood`.

## Acceptance Criteria

1. **Bound keys queue the legacy name**
   **Given** `KeyA` and `ArrowLeft` bound to `left` and a script in `wait()`
   **When** each is pressed
   **Then** the queue holds `A` and `LEFT`, and the `left` action is held and recorded on the entry.
2. **Unbound keys reach scripts**
   **Given** bindings configured and `KeyZ` unbound
   **When** `Z` is pressed
   **Then** the queue holds `Z`.
3. **The stock menu is unaffected**
   **Given** the game file's menu, confirm and movement bindings
   **When** the menu is driven by bound keys
   **Then** `waitinput()` exposes the bound `action` beside the key and the menu behaves as before.
