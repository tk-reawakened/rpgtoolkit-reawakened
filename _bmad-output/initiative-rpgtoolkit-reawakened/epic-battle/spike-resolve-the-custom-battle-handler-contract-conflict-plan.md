---
title: 'Resolve the custom battle-handler contract conflict'
type: 'chore'
ticket: 27
created: '2026-10-29'
status: done
baseline_revision: '82d30c5e'
risk: 'medium'
review: 'quick'
context:
  - 'docs/spec/engine/battle.md'
  - 'docs/spec/engine/plugins-and-battle.md'
---

## Intent

**Problem:** BAT-9 §3 says a program's `Fight`/`FightEnemy` "starts the registered `battle` command" (`docs/spec/engine/battle.md:207`), while BAT-14 says a program's `Fight` or `FightEnemy` call without `stock_battle` is the catchable `battle.package-missing` (`:326`), and BAT-9 §4 sends an own-loop program to "the package's setup-only entry points" (`:208`) without naming them. The conflict is wording only: E-79's independent custom battle loop is already approved (`docs/spec/engine/plugins-and-battle.md:180`) and is not reopened (ticket 27, issue #747).

**Approach:** State the precise conflict, propose one clarification that preserves E-79, and leave the capability and the runtime untouched for the owner to review.

## Proposal and owner decision

**Question:** How should the no-handler `battle.package-missing` error be worded so it does not contradict the approved registered replacement-loop path?

**Recommended wording** (BAT-14): "When **no battle handler is registered** — neither the `stock_battle` package nor a replacement loop registered as the `battle` command — a battle start ends at once with a diagnostic instead of hanging: a drawn encounter reports `battle.package-missing` and starts nothing, a custom encounter still runs its program, and a program's `Fight` or `FightEnemy` call is the catchable `battle.package-missing`. With a replacement loop registered, `Fight` and `FightEnemy` prepare the battle and hand it to that loop ([E-79](plugins-and-battle.md#e-79), [BAT-9](#bat-9) §§3–4); the error applies only when no handler exists." At BAT-9 §4, name the setup-only entry points as the core prepare operations that build the section without dispatching a loop.

**Decision (Jensen, 2026-10-29):** A battle system introduced through the plugin hook or the game file should let `FightEnemy` work. If none exists, report a warning and document how an author can resolve it.

## Evidence

- The gate is a **handler**, not the package: `hasBattleHandler` is the stock package **or** a top-layer `battle` command (`packages/core/src/script/vm.ts:355`, `packages/core/src/script/packs/battle.ts:599-601`), and only the loop-running variants consult it (`battle.ts:704,723,748`).
- The setup-only entry points are ungated: `__battle_prepare_random` and `__battle_prepare_enemies` pass `runLoop = false` (`battle.ts:1918,1930`) and are what the stock package's own wrappers call (`stock/stock_battle/startup.prg:100-101`).
- E-79's approved rule already carries a non-stock battle system (`docs/spec/engine/plugins-and-battle.md:180`), and BAT-9 §3 hands the outcome wait to "the registered `battle` command" (`docs/spec/engine/battle.md:207`).
- Tests on `82d30c5e`, whole file green (19/19): with neither stock nor a replacement, `FightEnemy` reports a catchable `battle.package-missing` and starts no battle (`packages/core/test/battle-custom-fight.test.ts:610-618`); with stock absent and a replacement registered as `battle`, `FightEnemy` prepares the battle and the replacement loop runs once with no diagnostics (`:619-632`).

## Rejected alternative

**Keep BAT-14's package-based wording.** It contradicts E-79 and the shipped, passing tests, and it would tell an own-loop author that `FightEnemy` must fail even when their handler is registered. **Narrowing or reopening E-79** is out of scope: the capability is approved and the tests already prove it.

## Consequences

- Docs only: BAT-14's condition becomes "no battle handler is registered", and BAT-9 §4 explains how a replacement loop uses the public start commands. No runtime, test, or golden change.
- The no-handler case keeps its current, tested behavior, so no author loses an error they rely on.
- The wording and troubleshooting guidance are recorded in BAT-14; no runtime change is made.

## Verified defect facts

- **No behavioral defect.** With a registered replacement and stock absent, `Fight`/`FightEnemy` reach the registered loop; with no handler at all they raise `battle.package-missing`. Both are covered and green on `82d30c5e`.
- **Documentation defect:** the implemented and tested trigger is "no battle handler registered" (`vm.ts:355`, `battle.ts:599-601`), not "no battle package loaded" (`docs/spec/engine/battle.md:326`); with a replacement registered the error does not occur. BAT-9 §4's "setup-only entry points" (`:208`) are named nowhere in `docs/spec/`; the code names them `__battle_prepare_random`/`__battle_prepare_enemies`.
