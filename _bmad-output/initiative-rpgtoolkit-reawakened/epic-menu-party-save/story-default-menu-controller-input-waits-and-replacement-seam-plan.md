---
title: "Default menu controller, input waits and replacement seam"
type: 'feature'
ticket: 7
created: '2026-10-22'
risk: "high"
status: done
context:
  - "spec - docs/spec/engine/plugins-and-battle.md#e-80"
  - "spec - docs/spec/engine/plugins-and-battle.md#e-95"
  - "handoff - Epic 4 ticket 4.21 / issue #406"
---

## Intent

Build the deterministic controller that routes the menu key and compatibility `InternalMenu(n)` through the `menu.screen` wait and invokes a replaceable provider from the shared package/plugin contract.

## Boundaries

Own routing, the `MenuSection.screens` navigation stack, input selection and wait/resume behavior. Epic 4 owns message/modal UI and board/input delivery; the menu renderer replays draw lists only. Do not duplicate party, inventory, equipment, gold, shop, or inn owners: provider context reuses their canonical E-81–E-85 query/action capabilities.

## Owner-ratified facade and provider contract

The modern RPGCode commands are direct, parameterless, blocking, void calls: `MainMenu()`, `ItemMenu()`, `EquipmentMenu()`, `AbilitiesMenu()`. They invoke the provider on the calling thread; RPGCode providers receive one read-only context argument and native TypeScript providers use the transition contract below. Registration extends `registerPlugin` with optional `menuProviders`, keyed by `main`, `items`, `equipment`, or `abilities`. Each non-empty key replaces that entire screen and receives no `next`. A single ordered per-screen registry covers both languages: native providers enter in resolved manifest order before package RPGCode startup programs, then RPGCode registrations append when executed; any later registration wins. Removal excludes a registration from future winner selection and exposes the preceding provider of either kind; it does not cancel an RPGCode provider frame already entered in the current runtime. Direct calls and nested `open` resolve through the same winner. An omitted key or empty map adds no entry. If `stock_menu` is loaded, it supplies the default for unoverridden screens; without a provider, the facade raises catchable `menu.provider-missing` without changing the stack. The existing `commands` dictionary remains required but may be empty (`commands: {}`), allowing a menu-only RPGCode package; native TypeScript packs use an empty commands array for menu-only registration.
`InternalMenu(0/1/2/4)` maps to `MainMenu/ItemMenu/EquipmentMenu/AbilitiesMenu`; all other values are rejected rather than aliased. These values are distinct from the legacy native plugin `menu(request)` constants `1/2/4/8`. The ordered `MenuSection.screens` stack records nested screen calls; closing a child pops only its frame and resumes the same caller thread. A TypeScript parent receives one `child.closed` event after either provider kind closes; an RPGCode provider is a VM call frame and continues after its nested blocking facade returns. Closing the outermost screen returns to its caller. Waiting and active provider identity/state must survive snapshot/restore only when every active identity is rebuilt at startup; runtime-only removal is not saved, so restore refuses a continuation whose provider identity is absent from the rebuilt registry.


## Acceptance

Headless fixtures prove (1) each direct command selects its canonical custom provider or, when `stock_menu` is loaded, the stock default, and returns void after it closes; (2) `InternalMenu(0/1/2/4)` reaches the matching provider and invalid values such as `3` raise a catchable error without changing the stack; (3) later TypeScript and RPGCode registrations replace earlier registrations across kinds, removal excludes the removed entry from future winner selection and reveals the preceding cross-kind winner, while an already-entered RPGCode frame may finish in the current runtime; (4) empty `commands` and `menuProviders` add no entries, while a menu-only registration works with `commands: {}`; (5) invalid registrations install nothing and startup/restore rebuilds the same winners; (6) nested TypeScript→RPGCode and RPGCode→TypeScript entry stays on the same thread, unwinds child frames/stack on errors, and dispatches `child.closed` to a TypeScript parent; and (7) active child/provider/parent state restores only after every identity resolves, with a fatal restore refusal when a current or parent continuation identity is absent from the startup-rebuilt registry. Runtime removal is not serialized.
When `stock_menu` from #585 is loaded, it supplies the default for screens without a custom provider; without either a custom provider or the package, a direct facade call raises catchable `menu.provider-missing` and leaves the menu stack unchanged. Full stock screens are delivered by dependent entry 8 (#585), not by an inert fallback in this story.


TypeScript providers use the transition contract and stable identity in [plugins-and-battle.md](../../../docs/spec/engine/plugins-and-battle.md#e-80): `PluginDefinition.menuProviders` maps screen tokens to `(input) => result`; input contains `{ providerId, context, state, event }`, event is `enter`, `input`, or `child.closed`, and result is `wait`, `open`, or `complete`. Save only provider identity, plain-data continuation/input and wait state. Native callbacks are author-installed trusted code and cannot be preempted or instruction-metered by R-33; core dispatches exactly one callback per event on a ready thread and never loops internally. The bounded-transition expectation is advisory, so a synchronous callback that does not return can hang; exceptions only mitigate callbacks that actually throw. RPGCode remains instruction-budgeted. Input may wait indefinitely; no wall-clock timeout. A thrown transition exception follows the VM operation's ordinary catchable failure route and rolls back frames created by that operation before the caller handler.

## Verification

Exercise direct calls, all compatibility values and invalid values, custom replacement/removal, empty registration facets, invalid-registration rollback, menu-only registration, nested screens and child.closed resumption, context owner-port behavior including empty-stack update refusal, wait/resume, callback and transition-application error cleanup/catching (including malformed waits, missing nested providers and refused owner actions), reset, and snapshot/restore. Test that removing an RPGCode registration changes future winner selection but an already-entered frame finishes during the current runtime. Verify restore fatal-refuses missing current or parent provider identities in the rebuilt startup registry; runtime removal itself is not saved. Compare menu stacks, hashes, resumed script position and input consumption; test deterministic RPGCode step-budget preemption and exactly one native callback dispatch per enter/input/child.closed event. When the `stock_menu` package is loaded its provider supplies default screens; without a registered custom or stock provider the direct facade reports catchable `menu.provider-missing` without changing the stack. Full stock screen behavior is implemented and tested by dependent entry 8 (#585), not by an inert fallback here.

## Owner-ratified contract decisions

**Owner decisions adopted for #588:** use `MenuProvider(input: MenuProviderInput) => MenuProviderResult` and the documented event/result variants. Native TypeScript identity is exactly `<plugin-id>@<plugin-version>:menu:<screen>`; RPGCode provider identity is its deterministic startup registration id plus screen key. Removal excludes an RPGCode registration from future winner selection and exposes the preceding provider; an already-entered frame may finish only in the current runtime. Runtime removal is not saved. On restore, every current and parent continuation identity must exist in rebuilt startup registration; a missing registration or changed plugin version raises fatal located `restore.menu-provider`, with no restart or fallback. Native callbacks are synchronous trusted code; core dispatches exactly one callback per enter/input/child.closed event and never loops internally. The bounded-work expectation is advisory: callbacks cannot be preempted or instruction-metered, and an infinite synchronous callback can hang; thrown exceptions alone follow the normal catchable cleanup path. RPGCode executes in ordinary VM frames under the existing 1,000-instruction per-thread turn budget. There is no wall-clock timeout. `context.menu.updateCurrent({ actorId, selection })` is the owner action; empty-stack calls refuse atomically with `MenuStateResult`.

## Implementation map

Use the party, inventory and menu owner ports from entry 2 and the built-in operations from entries 3–4. Keep `render.msgbox` distinct from `menu.screen` and do not put loop/state ownership in a renderer. Implement the adopted continuation contract and restore identity exactly as specified above; #585 provides the stock default handlers. No fallback placeholder or further contract decision remains open.
