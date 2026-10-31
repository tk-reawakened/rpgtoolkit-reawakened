---
type: discovery
title: "Closure audit: epic 19 (RPGCode platform), criterion by criterion"
date: 2026-10-31
baseline_revision: 26740257db3b692b5b210b05b489f60057d35e72
---

# Epic 19 closure audit

Audited at **`26740257`**. 19 of 20 children are CLOSED; the open one is **19.20 / #853** (build the package catalogue
in the host), whose session is active. The epic's criteria are otherwise proven by named suites.

| # | Done when | Verdict | Evidence |
|---|---|---|---|
| 1 | Dictionary literals execute; `obj.prop`, `obj->prop`, `obj["prop"]` create/read/write/delete; legacy `class` instances share one object runtime | **Proven** | `script-dictionary-objects.test.ts`, `script-class-objects.test.ts`, `script-objects.test.ts` |
| 2 | Method auto-binding, torn-off receivers, standalone lambda `this = null`, `bindThis` | **Proven** | `script-callable-runtime.test.ts`, `script-class-objects.test.ts` (“an operator compared on a released object's handle falls back to the handle comparison”) |
| 3 | One shared manifest with name/version/namespace/requests; AD-8 later-wins also as `namespace.name`; `registerPlugin` is a layer over the environment table | **Proven** | `script-manifest.test.ts`, `script-register-plugin.test.ts`, `script-environment-table.test.ts`, `script-package-namespaces.test.ts` (harness) |
| 4 | The `.gam` plugins list reads/writes as package names; legacy rows untouched | **Proven** | `format-main-file.test.ts` (round-trip with `packagePlugins`), and every engine test that boots with `packagePlugins: ["stock_battle"]` |
| 5 | `on/off/once/emit` on any object and the game; boards/actors as emitters; queued plain emit; cancelable emit parks the emitter and returns the event; one bus for RPGCode and TypeScript | **Proven** | `events-emitter.test.ts`, `events-cancelable.test.ts`, `events-game.test.ts`; `dispatch.ts` is the single bus |
| 6 | A save at any tick, including mid-dispatch, restores and finishes with the same hash | **Proven** | `events-cancelable.test.ts` mid-dispatch save case and the corpus gate's `snapshot/restore verified` over programs that emit |
| 7 | VM step counts recorded per package as plain data | **Proven** | `script-step-counters.test.ts` |
| 8 | The trust baseline (ADR 0008) and plugin-language guidance are written in docs/spec and the plugin guide | **Proven** | `docs/adr/0008-*`, the plugin guide source under `docs/`, and the spec sections PKG-1…PKG-8 in `rpgcode-modules-and-objects.md` |
| 9 | The measured stock ATB tick and cancelable-emit result against `STEP_BUDGET` is committed, and Epic 20 reflects it | **Proven** | `packages/core/test/step-budget-spike.test.ts` (committed measurement) |
| 10 | Every legacy golden unchanged; typecheck, lint, licence, provenance, catalogue and command-docs gates pass | **Proven** | `pnpm golden` (24 compared, scenes exact), `pnpm closing` 8/8, and all six gates observed green this session |
| 11 | A package named in `.gam` loads: catalogue gives version/namespace/requests/start-up; start-up runs at boot and on `reset`; a restore runs it on a scratch state first; a name with no entry is a located `plugin.unresolved` and the game still boots | **Proven in engine, host half in flight** | Engine side: `battle-cues-engine.test.ts` catalogue boot, `applyLoadedGame`'s scratch-state start-up (`engine.ts:928-968`), `plugin.unresolved` in `script-manifest.test.ts`/`engine.test.ts`; the **host** that builds and passes the catalogue is **19.20 / #853**, still open and owned by another session |

## Findings

- **F-01 (in flight, already ticketed).** Criterion 11's host half is 19.20 / #853. No new ticket.
  - Recommendation: the host builds the catalogue from the `.gam` list plus a host-side package catalogue file, and
    passes it through `EngineInit.packageCatalogue` unchanged (the engine already validates it and reports
    `plugin.unresolved`), so no core change is needed.
  - Rejected alternative: let the engine scan a folder for packages. That puts I/O in `core` and breaks G2.
- Bookkeeping: the earlier audit note that 19.16 / #540 was closed while its entry still read planned was resolved by
  another session in #875 (“record ticket 540 as superseded”).
- Store: 19/19 closed children `done`; no correction.
