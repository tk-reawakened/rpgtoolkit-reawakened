# Epic 19 Done-when 11 audit — a listed package loads

Clause-by-clause check of Done-when 11 against merged `origin/main` (`f0216f6c` at the time of
writing). The Epic 19 audit's other criteria are recorded in that audit (issue #540 and the audit
comments that cite it); this page covers the package-loader criterion, which was the last open one.

> **11.** A package named in the `.gam` list loads (entry 19.16, added 2026-10-20): the host's package
> catalogue gives it a version, namespace, declared host requests and start-up program, the engine runs
> its start-up at boot and on `reset`, and a restore runs it on a scratch state first; a name with no
> catalogue entry is a located `plugin.unresolved` and the game still boots.

**Verdict: met.** Delivered by 19.17 / #562 (the consuming side and the manifest contract) and
19.20 / #853 (the host catalogue), with the reset defect repaired in #873. Entry 19.16 / #540 is
**superseded**: its draft plan described a pre-19.17 shape (a `program` field on
`PluginManifestEntry`) and the merged contract keeps the start-up program on
`PackageCatalogueEntry.startup`; no such field exists.

| Clause | Evidence |
|---|---|
| The host's catalogue gives a listed package its version, namespace, declared host requests and start-up program | `packages/runner-harness/src/package-catalogue.ts` (`parsePackageManifest`, `catalogueEntry`, `buildPackageCatalogue`) validates a package folder with core's own `PACKAGE_IDENTIFIER` and `HOST_REQUEST_KINDS` and builds the `PackageCatalogueEntry`; `engine/boot.ts` `mainFilePluginPatch`/`pluginManifestFor` upgrade the `.gam` names into manifest entries with version, namespace and requests, and `resolveManifestPlugins` attaches the definition and owner-tagged `ProgramRef`. Asserted end to end by `packages/core/test/engine-boot.test.ts` ("manifest package lookup folds ASCII package identity and keeps the catalogue's namespace"). |
| A game naming `stock_battle` from its real package folder boots with its start-up observable and no `plugin.unresolved` | `packages/runner-harness/test/package-catalogue.test.ts`, first case, over `stock/stock_battle`: no `plugin.unresolved`, engine `running`, `stockBattle` table in state. |
| The engine runs the start-up at boot | `engine.ts` boot path (`makeServices` → `runPackageStartup`, `engine.ts:2001-2012`) and the same test's `stockBattle` observable. |
| … and on `reset` | `engine.ts:1631-1640` — `resetLifecycle` builds a fresh `createPluginLayers()` before `makeServices`, so the package start-up re-registers exactly one layer (PR #873 fixed the shared-table reuse that stacked a layer per reset); asserted by "a project folder's RPGCode package layers an engine command and is rebuilt by reset". |
| A restore runs it on a scratch state first | `engine.ts` `applyLoadedGame` (`engine.ts:928-957`) builds a scratch state and `restoredLayers = createPluginLayers()`, reruns the installed packages' startup, refuses the load with `restore.shape` when an installed start-up fails, then runs the active packages' start-up against the restored services; documented at `docs/spec/engine/rpgcode-package-loader.md:41` and exercised end to end by `packages/core/test/battle-fresh-load.test.ts`. |
| A name with no catalogue entry is a located `plugin.unresolved` and the game still boots | `packages/runner-harness/test/package-catalogue.test.ts` second case (exactly one diagnostic, at `main.gam` and the package's list position, engine still `running`) and `engine-boot.test.ts`'s unresolved-name case. |

## What remains for Epic 19

Nothing in this criterion. The other Done-when items are covered by the Epic 19 audit already recorded;
if that audit lists any criterion still open, it is independent of the package loader.
