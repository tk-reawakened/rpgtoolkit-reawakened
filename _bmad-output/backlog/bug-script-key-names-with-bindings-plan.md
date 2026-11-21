---
title: 'Keyboard action bindings replace script-facing key names'
type: bugfix
ticket: '21'
created: '2026-11-20'
status: 'in-progress'
baseline_revision: 'b5a5d508948e583828ec8fb55d8eb1816724afde'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'none'
review_source: 'auto'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/docs/guardrails.md'
---

<frozen-after-approval reason="human-owned intent — owner delegated implementation on 2026-11-20">

## Intent

**Problem:** Bound keyboard input currently lets an action label replace the key name RPGCode needs, while menu consumers can lose actions from a single press. The active key contract also omits the virtual-key value required to derive a name, and Enter has conflicting default actions.

**Approach:** Add an active v3 physical-key contract and derive its name in core; preserve historical v1/v2 name-based replay. Deliver every resolved action to the screen that owned the event, use a separate non-physical wake for action-only keys, and make Enter/NumpadEnter confirm while KeyM opens the menu.

## Boundaries & Constraints

**Always:** Keep v1/v2 schemas, types, vectors and replay semantics unchanged. Validate active v3 key fields at the input boundary; derive names only from `code`, `char` and `vk`. Preserve full action order and menu ownership, add save migration for any new queued state, and update the clean-room specifications before source code.

**Never:** Do not special-case Enter by dropping an action, truncate a binding list, dispatch one event's remaining actions to a newly opened screen, or put an unnameable physical key in the legacy key queue. Do not inspect or copy legacy source, change frozen v1/v2 artifacts, open a browser, or broaden this issue to unrelated input bugs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bound and unbound key | Nameable v3 key after code aliases, `char` and `vk` fallback; one binding and one none | Derived physical names survive `wait()`/`waitinput()`/`get()`; one queue entry per down including repeat; none on up | No error |
| Multiple actions | `KeyQ` maps to `left`, `confirm`, then registered `game.zeta`, `game.alpha` | Native gets readonly ordered array and first action in `key`; RPGCode gets identical zero-based `actions` dictionary | No sorting, truncation or type loss |
| Action-only key | Key remains unnamed after code aliases and both `char`/`vk` fallback; binding resolves actions | `waitinput()` gets `key:null`, first action and `actions:{length,0…}`; native `key` remains first action with full array | No physical queue entry; plain `wait()`/`get()` do not wake |
| Action-only with pointer change | Pointer changes in the same tick as an action-only key | Returned key record retains the wait's pointer baseline; next call observes the pointer change | No missed pointer edge |
| Nested menu transition | Main owns `confirm`, then `menu` selects Items | Main handles the complete list, closes stack; child receives no action and nothing replays | No stale action remains |
| Existing submenu | Items owns a `menu` press | Its owning stack closes | No child receives the event |
| Historical replay | v1/v2 record contains legacy `name` | Its recorded name and menu behavior are unchanged | No v1/v2 schema/vector change |
| Held repeat | Nameable repeat record for a held key | One physical key queue entry per down; no duplicate action edge | No error |

</frozen-after-approval>

## Code Map

- `packages/core/src/ports/input.ts` -- active and historical input-record types; split v1/v2 key shape from v3.
- `packages/core/src/validate/input-event.ts` -- exact runtime seam for active input; preserve field-path failures and add historical validation only where replay needs it.
- `packages/core/src/input/input.ts` and `packages/core/src/save/sections/input.ts` -- key-name derivation, ordered action resolution, physical/action queues and save schema.
- `packages/core/src/save/snapshot.ts` -- input-section migration; old snapshots default new queued state safely.
- `packages/core/src/engine/engine.ts` and `packages/core/src/script/waits.ts` -- input claims, screen ownership and wait polling.
- `packages/core/src/ports/wait.ts`, `packages/core/src/script/plugin.ts`, and `packages/core/src/script/vm.ts` -- `waitinput()` and native menu event; keep `event.key` action-valued while adding the full ordered list.
- `packages/core/src/script/packs/movement.ts` and `stock/stock_menu/startup.prg` -- RPGCode wait/get and stock dispatch; action-only records are not physical keys and do not leak to child screens.
- `packages/runner-harness/src/golden.ts`, `driver.ts`, and `packages/runner-harness/src/script-host.ts` -- run schema versioning, replay and harness consumers; preserve v1/v2 names and consumed records.
- `packages/runner-web/app/main.ts`, `packages/runner-desktop/app/player-live.ts`, and `packages/runner-mobile/app/player.ts` -- hosts provide `vk` and no host-derived `name`.
- `tools/fixtures/runner-protocol/generate-v3.mjs`, `tools/fixtures/test/runner-protocol-v3.test.mjs`, and v3 schema/vector artifacts -- derive and verify v3 only; v1/v2 hashes remain frozen.
- `docs/spec/engine/display-input-audio.md`, `rpgcode-functions.md`, `runners.md`, `plugins-and-battle.md`, and `docs/spec/formats/main-file.md` -- active key, replay, wait, provider, absent-block and stock-menu contracts; place rationale/rejected alternative before code.

## Tasks & Acceptance

**Execution:**
- [ ] Update the clean-room input, wait, runner, menu and absent-main-file-default specifications first; explain why all actions/order are preserved and why removing `menu` from Enter defaults is safer than suppressing an action.
- [ ] Split active v3 key records from v1/v2 types, validators, runner protocol generation and host adapters; keep historical schemas, vectors and type contracts byte-for-byte stable.
- [ ] Implement physical-name derivation, defaults, action-only routing, screen ownership and save restoration; migrate active producers/consumers while keeping historical replay versioned.
- [ ] Add focused tests for bound and unbound names, repeats and key-up, exact mixed action order at both consumers, both stock-menu ownership states, defaults, custom bindings, old logs, independent engine instances and save restore; each new focused test must finish individually under one second.
- [ ] Update the changelog and run focused tests, build/type checks and protocol conformance.

**Acceptance Criteria:**
- Given an active v3 key event, when it crosses the core boundary, then core applies named code aliases before `char` and `vk` fallback; only an unnamed result has no physical name, action labels cannot replace names, and every nameable down (including repeats) appends one physical queue entry while key-up appends none.
- Given a key that remains unnamed after all naming rules but resolves actions, then RPGCode `waitinput()` returns `key:null` and a zero-based ordinary `actions` dictionary with `length`; native `MenuProviderEvent` keeps the first action in `key` and carries the complete readonly action array; plain `wait()`/`get()` see no physical key.
- Given an action-only record coinciding with a pointer change, when `waitinput()` returns the key record, then it preserves the prior pointer baseline and the next call sees the change.
- Given one press resolves mixed engine and registered actions, when consumed, then native and stock consumers receive exact ACT-4 order and the original screen owns the complete batch, including a confirm-open-child then menu-close transition.
- Given an old v1/v2 recording, when replayed, then its recorded name and menu behavior remain stable and the historical schema, types, and pinned vector hashes are unchanged.
- Given default and custom bindings, when Enter, NumpadEnter, KeyM, repeat or an explicit multi-action key is pressed, then named code aliases derive ENTER even with null `char`/`vk`, defaults are confirm/confirm/menu, custom actions stay complete, and repeats add no duplicate action edges.

## Implementation Notes


## Plan Change Log


## Review Triage Log


## Design Notes

A physical key name is not an action. V3 carries physical identity, not a caller-selected name; core applies named code aliases first, then derives other names from `char` or `vk`. Only a key still unnamed after those rules is action-only. That record wakes action-aware consumers without contaminating `wait()` or `get()`.

Native menu `event.actions` is a readonly array; RPGCode `waitinput().actions` is a zero-based ordinary dictionary with `length`, since script values do not expose raw arrays. `waitinput().key` alone is `null` for action-only input; native `event.key` remains the first action. Both key record forms preserve the pointer baseline so a simultaneous pointer change is seen on the next wait.

ACT-4 orders the engine action set first (`up`, `down`, `left`, `right`, `confirm`, `cancel`, `menu`), then registered actions in registration order. Tests use a deliberately mixed, nonalphabetical binding and assert the exact same list at native and stock consumers.

Enter is not special-cased and no action is removed: the default list changes so Enter/NumpadEnter confirm, while KeyM is the default menu action. Explicit multi-action bindings still dispatch in order. The batch belongs to the screen that owned input before the press; a transition never retargets remaining actions to a child. This rejects retaining both defaults and silently discarding one later, which makes custom bindings lossy and inconsistent.

For a stock screen whose ordered batch opens a child and then closes the outer menu, the original owner consumes the batch and the net transition closes the stack; the child never receives the event. A menu press on an already-open Items screen is a separate regression case.

Historical v1/v2 logs retain their recorded names through a versioned replay path. Do not derive a missing `vk` from a recorded name or rewrite frozen historical vectors to resemble v3.

## Verification

**Commands:**
- `pnpm runner-protocol:check` -- expected: generators complete and v3 schema/vectors conform.
- `node --test tools/fixtures/test/runner-protocol-v3.test.mjs` -- expected: pinned v1/v2 schema/vector hashes remain byte-for-byte stable.
- `pnpm build` -- expected: core, runners and test TypeScript compile.
- `node --test packages/core/test/input.test.ts packages/core/test/pointer-wait.test.ts packages/core/test/stock-menu.test.ts packages/core/test/save-migration.test.ts packages/runner-harness/test/driver.test.ts packages/runner-harness/test/script-plugin-host.test.ts packages/runner-harness/test/protocol-v3.test.ts` -- expected: focused key identity, wait, ownership, restore, replay and runner-protocol regressions pass.
- `pnpm test` -- expected: full repository regression suite passes before PR delivery.

**Manual checks:** Confirm each new focused test reports a duration below 1s; independently review the PR and wait for required CI before enabling auto-merge.
