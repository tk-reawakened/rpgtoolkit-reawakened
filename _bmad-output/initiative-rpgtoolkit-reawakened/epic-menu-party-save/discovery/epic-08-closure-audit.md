---
type: discovery
title: "Closure audit: epic 8 (menu, party, save), criterion by criterion"
date: 2026-10-31
baseline_revision: 26740257db3b692b5b210b05b489f60057d35e72
---

# Epic 8 closure audit

Audited at **`26740257`**. 19 of 25 children are CLOSED; six are open and own specific criteria, which are marked in
flight rather than unproven. No criterion is contradicted by merged evidence.

| # | Done when | Verdict | Evidence |
|---|---|---|---|
| 1 | Scripted play exercises item use, equip, remove, drop, buy, sell, party swap, inn restoration and a battle item use | **In flight (8.5 / #589)** | The shared inventory operation and its `stock_rpg` callers exist; the criterion is the ticket's own acceptance and 8.5 is **owner-gated by earlier instruction**, so its completion is not mine to claim. `actors.test.ts`/`battle-actions.test.ts` cover the battle item-use and stat limbs |
| 2 | The main, equipment, abilities and inventory screens open directly, are replaceable by RPGCode and preserve menu/input behaviour | **In flight (8.8 / #585)** | `stock/stock_menu` exists and the menu-provider seam is landed (`script-register-plugin.test.ts`, the `menuProviders` facet); the screen-by-screen acceptance belongs to 8.8 |
| 3 | Save then load mid-script restores every ruled section with identical hashes and later behaviour | **Proven for the engine's own path** | `battle-save-golden.test.ts`, the “full-engine save during battle resumes its parked thread” case, and `save-*.test.ts` suites; `pnpm golden`/`pnpm closing` unchanged. The *blob* (host) round trip is criterion 4 |
| 4 | Saving is refused on boards that forbid it; saves use `saveBlob`/`loadBlob`/`listBlobs` keyed by `GameId`; thread continuation follows the approved rule | **Proven** | `packages/core/test/save-*.test.ts` (board save-forbidden, `GameId` keying) and the blob request path in `engine.ts` (`saveBlob`/`loadBlob`), exercised by the `Save("slot")` cases in `battle-cues-engine.test.ts` and `battle-fresh-load.test.ts` |
| 5 | The interaction wrapper queues `dialogue.completed` only after normal completion; the `stock_rpg` bridge emits one actor-scoped `talked` with approved detail and nothing on interruption or failure | **Proven** | `packages/core/test/engine-edges.test.ts` (“engine beforeEnter rejects a waiting listener with a located diagnostic”) plus the dialogue/talked assertions in the stock-package suites; `stock/stock_rpg` is present |
| 6 | Menu, inventory, party and save built-ins register with the VM; every E-80–E-87 and E-123 behaviour has headless coverage | **In flight (8.8 / #585)** | The built-ins are in the catalogue (`catalogue:check`, `command-docs:check` green) and the inventory/party/save suites cover the engine side; the E-80…E-87 *screen* coverage is 8.8's acceptance |

## Findings

- **F-01 (owner-gated, already ticketed).** Six children remain: 8.5 / #589 (owner decision pending, excluded by
  instruction), 8.8 / #585 (screens), 8.10 / #593 (load validation), 8.13 / #594 (sweep), 8.14 / #595 (end-to-end
  acceptance), 8.17 / #777 (interruption-recovery checkpoints, `hitl`). No new ticket: each already exists and owns a
  criterion. The epic cannot close until they do.
  - Recommendation for the owner-gated 8.17: keep interruption recovery limited to *settled* points (pre-battle and
  post-battle ledger states), which is what the merged recovery work already does, and refuse a mid-battle candidate
  rather than inventing a battle-state serialization.
  - Rejected alternative: capture a mid-battle recovery candidate. It needs the battle section to be fully
  reconstructible from a ledger plus the audio section, which the engine does not promise, and would duplicate the
  ordinary save path's guarantees.
- Store: 19/19 closed children read `done`; the six open ones read their real state. No correction.

## Not probed

The four screen criteria (2 and 6) are the open ticket's acceptance, not an audit gap: the catalogue side is proven and
the screen behaviour is 8.8's deliverable.
