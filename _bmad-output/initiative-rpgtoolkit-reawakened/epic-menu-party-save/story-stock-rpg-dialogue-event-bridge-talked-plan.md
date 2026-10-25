---
title: "Stock RPG dialogue event bridge: talked"
type: 'feature'
ticket: 12
created: '2026-10-25'
status: done
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
baseline_revision: 'c7efe748b6a3dce7bc1e15ae865c4aede0772146'
route: 'full'
route_source: 'auto'
risk: 'high'
review_loop_iteration: 1
context:
  - "docs/spec/engine/plugins-and-battle.md#e-95 (E-95 source/target context only)"
  - "docs/spec/engine/plugins-and-battle.md: Reawakened rule for `dialogue(text)` immediately after E-123 (line 134; unanchored)"
  - "docs/spec/engine/actors.md#standard-actor-and-board-events"
  - "docs/spec/engine/rpgcode-modules-and-objects.md#pkg-1 (PKG-5, PKG-7), #emit-13, #emit-21"
  - "docs/spec/engine/rpgcode-package-loader.md#host-catalogue"
  - "docs/spec/engine/rpgcode-package-loader.md#startup-and-diagnostics"
  - "docs/spec/engine/rpgcode-package-loader.md#reset-and-restore"
  - "docs/spec/engine/rpgcode-package-loader.md#host-boundary"
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 8.11 publishes `dialogue.completed`, but the stock RPG package does not yet turn successful dialogue into the actor-scoped `talked` event promised to consumers.

**Approach:** Make `stock_rpg` a loadable package with its own startup program. The startup registers a game listener that calls a reusable native package command; that command forwards the producer's detail as a queued `talked` event on the speaking actor.

## Boundaries & Constraints

**Always:** Keep package selection host-catalogue-driven. Preserve `actorId`, `targetId`, and `text` exactly; `actorId` identifies the speaking actor and `targetId` is the interaction target or `null`. Keep the existing `actor:*` `fallen` bridge in the stock host definition. Startup only registers the listener and finishes without waiting.

**Never:** Add `stock_rpg` to `ENGINE_PLUGIN_TABLE` or default plugins; add a production host catalogue that this repository does not have; re-emit `talked` on `game`; change the dialogue producer or event specifications; retain the test-only startup marker command.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Completed dialogue with target | One queued `game/dialogue.completed` carrying valid speaker, target, and displayed text | Exactly one queued `talked` on `actor:<actorId>` with the same three detail fields | No synchronous listener call |
| Completed targetless dialogue | Producer detail has `targetId: null` | One `talked`; `null` remains `null` | Do not substitute `actorId` |
| Interrupted or failed interaction | `dialogue` does not complete normally | No `dialogue.completed`; therefore no `talked` | Preserve producer behavior; bridge emits nothing |
| Actor isolation | Two actors and listeners on both actor emitters | Only the speaking actor's listener receives `talked` | No game-level duplicate |
| Reset | Engine reset clears the event section and reruns startup | Exactly one `dialogue.completed` listener is registered again | Do not fall back to default plugins |
| Save with queued `talked` | Event is pending at snapshot boundary | Restore delivers it once, with deterministic state/hash | Rebuild package code from the same host inputs; do not duplicate startup listeners |

</frozen-after-approval>

## Code Map

- `stock/stock_rpg/manifest.json` -- add the `program: "startup.prg"` descriptor field, matching the stock menu/battle packages.
- `stock/stock_rpg/startup.prg` -- new RPGCode startup: `game.on("dialogue.completed", (e) => { bridgetalked(e) })`.
- `packages/core/src/script/stock-rpg.ts` -- new host-owned `STOCK_RPG_PLUGIN`; promote the tested `bridgefallen` command and `actor:*` listener, omit `stockrpgstarted`, and add `bridgetalked`.
- `packages/core/src/script/index.ts` -- export `STOCK_RPG_PLUGIN`.
- `packages/core/src/script/plugin.ts` -- `PluginDefinition` and `PackageCatalogueEntry` are the existing native-definition/startup contracts; do not change them.
- `packages/core/src/engine/boot.ts` -- `resolveManifestPlugins` attaches host-provided `PackageCatalogueEntry.startup`; core does not parse package JSON.
- `packages/core/test/stock-packages.test.ts` -- `stockPackage()` reads a descriptor's `program`; `packageCatalogue()` converts source and definition into a host catalogue.
- `packages/core/test/stock-rpg-bridge.test.ts` -- current test-only `stockRpg()` and fixture startup prove the existing actor-fallen bridge. Use the exported definition and real stock startup instead.
- `packages/runner-harness/src/script-host.ts` and `packages/runner-harness/test/script-host.test.ts` -- `packageStartups` are explicit host inputs; `restoreScriptHost` rebuilds package layers on scratch before restoring callable references.

## Tasks & Acceptance

**Execution:**
- [x] `stock/stock_rpg/manifest.json`, `stock/stock_rpg/startup.prg` -- declare and implement the package startup listener so the real package source, not a test-only marker, registers `game.on`.
- [x] `packages/core/src/script/stock-rpg.ts`, `packages/core/src/script/index.ts` -- export a host-native definition with the preserved fallen bridge and `bridgetalked`; read the argument with `readEvent`, then return `emitEffect(actorEmitterKey(actorId), "talked", detail)`.
- [x] `packages/core/test/stock-packages.test.ts`, `packages/core/test/stock-rpg-bridge.test.ts` -- build the catalogue from the stock manifest/source and test completed, interrupted/failed, targetless, isolation, reset re-registration, and queued-delivery cases. Remove `packages/core/test/fixtures/authored/stock-rpg/startup.prg` only after a reference sweep confirms the old test helper is its sole consumer.
- [x] `packages/runner-harness/test/script-host.test.ts` -- exercise package startup listener registration and `restoreScriptHost` continuation using the same plugin definition and startup ref; this is required to prove saved listener handles are rebuilt without duplicate delivery.

**Acceptance Criteria:**
- Given the `.gam` host catalogue selects `stock_rpg`, when its startup runs, then `dialogue.completed` reaches the native command through the registered RPGCode listener.
- Given a normally completed dialogue, when its queued signal is dispatched, then exactly one actor-scoped `talked` has the exact source, target (including `null`), and text detail.
- Given interruption/failure or a different actor's listener, when the fixture runs, then no false event or cross-actor delivery occurs.
- Given reset clears events, when the startup program runs again, then the host-selected package registers exactly one listener and preserves the same plugin set.
- Given a snapshot with `talked` pending, when restored with the same package definition/startup, then delivery occurs once and hashes match uninterrupted replay.

## Implementation Notes

The repository has no production host catalogue consumer. Keep the reusable definition exported for host catalogues and verify it through the existing host-catalogue seam; do not invent a host application.

## Design Notes

The native command centralizes mapping the producer's stable actor ID to the canonical built-in emitter key and queues through `emitEffect`; it does not dispatch directly. It is the single validation seam for the public RPGCode event boundary: it accepts only `game` / `dialogue.completed`, a valid exact `actorId` whose actor emitter remains registered, a shape-valid `targetId` (`null` is valid), and `text`. It does not re-check current actor ownership for `targetId`: listener dispatch is later than event production, and removal may occur in between while the valid queued target ID must be preserved. Malformed details, unrelated event objects, and an unregistered source emitter are ignored without emission; valid producer values are preserved unchanged. `dialogue.completed` is already the normal-completion boundary, so the bridge must not add a second success flag or infer completion from input. The startup program is package source, while the command implementation remains host code in `STOCK_RPG_PLUGIN`. A real production catalogue remains an external host responsibility.

## Verification

**Commands:**
- `pnpm test` -- expected: build succeeds and all core/runner-harness tests pass.
- `pnpm golden` -- expected: headless golden verification passes without updating goldens.
- `pnpm typecheck` -- expected: production and test TypeScript projects pass.
- `pnpm lint` -- expected: dependency boundary and ESLint checks pass.

**Manual checks:**
- Inspect the catalogue fixture to confirm `stock_rpg` is added only when selected and is not a default plugin.
- Confirm the stock startup source is used and the old marker fixture has no remaining consumer before removal.

## Plan Change Log

## Review Triage Log

- LIVE finding: a queued, valid `game` / `dialogue.completed` could be dispatched after `removeActor` removed its target record; the dispatch-time target-owner lookup dropped the `talked` event. Reproduction first: `node --test --test-name-pattern='preserves a queued target ID' packages/core/test/stock-rpg-bridge.test.ts` failed with `actual: []` where `actor:1` and `{actorId:1,targetId:2,text:"Hello, Ada"}` were expected.
- Fixed at the single bridge validation seam: keep event identity and detail-shape checks; require the source actor's emitter key to remain registered, but validate targetId only as a positive safe integer or null. Removed the obsolete assertion that an unowned target ID must be rejected. The same regression now proves removal before dispatch still emits exact targetId 2.
- Frozen intent and acceptance criteria are unchanged. Normative spec remains unchanged because it already defines actorId liveness at production, targetId as actor ID or null, and delayed listener queue delivery. No project changelog exists.

- Independent fresh-fix re-review: clean, no findings, against the uncommitted ticket-only worktree diff at HEAD/base `c7efe748b6a3dce7bc1e15ae865c4aede0772146`. The reviewer verified target removal after queueing, source-emitter handling, invalid/unregistered inputs, null target, exact details, and absence of unrelated changes.

- Build Step 4 ran the pinned Quick lens (`review: 'quick'`, `lenses_ran: ['quick']`). Separately, the BMad code-review workflow ran blind-hunter, edge-case-hunter, verification-gap, and intent-alignment; the target-removal finding was fixed and the independent fresh-fix re-review passed with no findings.
