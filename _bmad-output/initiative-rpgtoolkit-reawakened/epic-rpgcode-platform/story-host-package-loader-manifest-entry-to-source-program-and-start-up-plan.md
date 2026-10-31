---
title: "Host package loader: manifest entry to source program and start-up"
type: 'feature'
ticket: 16
created: '2026-10-20'
status: done
baseline_revision: 'df7c1d03'
risk: "high"
context:
  - "spec - docs/spec/engine/rpgcode-modules-and-objects.md (PKG-2, PKG-3, PKG-4, PKG-5, PKG-7)"
  - "spec - docs/spec/engine/main-loop-and-startup.md (E-02 step 3), docs/spec/formats/main-file.md (TKR package-list extension)"
  - "code - packages/core/src/engine/boot.ts, engine.ts, script/manifest.ts, plugin.ts, package-startup.ts"
  - "code - packages/runner-harness/src/script-host.ts, script-plugin-resolver.ts, corpus.ts"
  - "audit - _bmad-output/initiative-rpgtoolkit-reawakened/epic-actors/discovery/actor-readiness.md (F-11 to F-14)"
---

> **Superseded (Epic 19 audit, issue #540).** Done-when 11 is delivered by 19.17/#562 and 19.20/#853;
> the `program` field this plan proposed does not exist and must not be added — the start-up program
> lives on `PackageCatalogueEntry.startup`. The Delivered section below is the record of the verification
> work and the reset layer-table fix (PR #873) that landed from this entry before that recommendation.

## Intent

Epic 19 built every piece of an RPGCode package except the one that makes a listed package run. Verified against `origin/main` at 5fce842c on 2026-10-20: the `.gam` package list (19.9) appends `{ id }` entries with no `version`, so they are not package entries and get no namespace (`mainFilePluginPatch`, `engine/boot.ts`); `resolveManifestPlugins` resolves only the native pack table, so every listed package is `plugin.unresolved: has no engine definition`; `PluginManifestEntry` (`script/manifest.ts`) and `PluginDefinition` (`script/plugin.ts`) carry no entry-program field; and nothing outside the runner-harness corpus (`corpus.ts` `startups`, `script-host.ts` `packageStartups`) calls `runPackageStartup`, so the engine's `makeServices` neither builds a layer table nor runs a start-up. PKG-4 already says a package's script functions and objects join namespace lookup "when the package loader of PKG-7 supplies them"; this entry is that loader. Epic 20 needs it first: `stock_battle`, `stock_menu` and the behaviours a package registers (20.7) are RPGCode that only exists once a package start-up has run.

Shape. A **package catalogue** is plain data the host builds before boot, the same way it prefetches program sources today: per package name, a descriptor `{ name, version, namespace?, requests?, program }` where `program` is the asset key of the start-up program. Core takes the catalogue as an `init` input (G2: no I/O, no loader in core). Boot walks the `.gam` list in order, looks each name up and makes a full package entry (`version`, `namespace`, `requests`, `program`), a `ResolvedPlugin` whose definition is a host-made `{ id, version, commands: [] }` shell with the namespace set, and one start-up `ProgramRef` tagged `withOwner(ref, name)` (PKG-8). After the services are built and before the main file's start-up program runs, the engine runs `runPackageStartup` over those references in manifest order; `reset` rebuilds the services and runs them again; a restore helper runs them on a scratch fresh state and then loads the saved state, the order `restoreScriptHost` already uses (19.8).

## Boundaries

Touches: `script/manifest.ts` (the optional `program` field of a package entry and of `PackageDeclaration`, validated like the other fields and allowed only on a package entry), `engine/boot.ts` and `engine/engine.ts` (the catalogue input, entry upgrade, start-up at boot and `reset`), a restore helper beside `package-startup.ts`, the runner-harness resolver and `script-host.ts` (the harness reads the same catalogue; its `packageStartups` input stays and keeps working unchanged), and the spec rows below. The first step is doc-first (G7): PKG-2 (field spelling, now including `program`) and PKG-7 (where a package's code comes from) are Proposed rulings in `rpgcode-modules-and-objects.md`; this entry rules them as built and amends E-02 step 3 and the main-file page's paragraph on the package list, which today describe one appended `{ id }` entry and an unresolved name as the only outcome.

The `program` field named below is delivered as the catalogue's `startup` program reference (see Delivered); no manifest or declaration field of that name exists.

Does not: add a file format reader (the descriptor is read by the host; where the file sits and how it is parsed is the host's), change `registerPlugin`, rule how packages are distributed to the editor (Epic 11/12), load native TypeScript packages (they stay author-installed, ADR 0008), add the `ns.name(...)` lookup of a package's script functions and objects (PKG-4's last clause; recorded below as an owner question, not built here), or add a capability model. It must not touch the files the closed 19.14 and 19.15 changed beyond the harness seams named above.

## Key Decisions

1. **Package names are lower-case ASCII identifiers; no hyphens (Assumption A-6, to confirm).** `FOLDED_IDENTIFIER` in `script/manifest.ts` (`/^[a-z_][a-z0-9_]*$/`) already rejects `stock_battle`, `stock_menu` and `stock_rpg`; the smaller change is to keep the rule and rename (`stock_battle`, `stock_menu`, behaviour names `stock_rpg.hero`), because the other choice (allow a hyphen in the manifest id and derive an underscore namespace) changes the 19.6 parser and adds a derivation rule to PKG-4. Rejected alternative: hyphenated ids with a derived namespace. <!-- OWNER: package-name grammar, Assumption A-6 (agent proposal 2026-10-20, not yet ruled by the owner) -->
2. **Package source and descriptor (PKG-7, Assumption A-7, to confirm).** A package is a folder `Packages\<name>\` inside the project holding its descriptor and its `.prg` sources; hosts also bundle the stock packages from the repo `stock/` folder (Epic 20 Assumption A-2) and the catalogue merges both, a project folder winning a name clash with a diagnostic. The descriptor spelling (a JSON file) and its location are the host's contract with the project and are written in PKG-7 by this entry. Rejected alternative: carry version, namespace and program in the `.gam` TKR block, which widens a legacy-adjacent file format for data a package already owns. <!-- OWNER: package folder and descriptor, Assumption A-7 (agent proposal 2026-10-20) -->
3. **One mechanism, one table.** The catalogue feeds the existing manifest (`PluginManifestEntry`, PKG-1), the existing resolver shape (`ResolvedPlugin.namespace`, PKG-4) and the existing start-up run (`runPackageStartup`, PKG-5). No second package list and no second dispatch.
4. **Located failure, not a refused game.** A listed name with no descriptor is `plugin.unresolved` carrying the main file and the list position, as the resolver diagnostics already carry a path and index; the game boots without it. A descriptor that fails validation is the existing located `manifest.*` diagnostic. A start-up that waits keeps its load-time `package.startup-unfinished` failure (PKG-5).
5. **Owner equals package name.** The start-up reference and every program the package supplies are tagged `withOwner(ref, name)`, which is what the 19.13 step counters and 19.8 layer ownership already read.

## Acceptance

1. PKG-2 and PKG-7 are ruled in `docs/spec`, E-02 step 3 and the main-file page describe the loader, and an A-6 and an A-7 line sit in the Epic 19 Notes.
2. A package named in the `.gam` list and present in the catalogue becomes a versioned package entry with a namespace and a `program`; one not in the catalogue is one located `plugin.unresolved` and the game still boots.
3. Boot runs the start-ups in manifest order after services exist and before the main file's start-up program; `reset` rebuilds the layer table; the restore helper runs them on a scratch state before the saved state loads and finishes with the same state hash as an uninterrupted run.
4. The runner-harness `packageStartups` path and the 19.14 fixtures pass unchanged; every legacy golden is unchanged.

## Verification

Unit tests over a fixture package folder (a start-up that wraps an existing engine command), an engine boot test, a `reset` test, a restore test against the hash, the validation diagnostics; `pnpm typecheck`, `pnpm lint`, `pnpm test:strict`, `pnpm golden`, `pnpm graph`, `pnpm provenance`, `pnpm licence`, `pnpm catalogue:check`, `pnpm command-docs:check`.

## Open for the owner

- `ns.name(...)` for a package's script functions and objects (PKG-4's clause "when the package loader of PKG-7 supplies them"): today a namespace reaches only a native definition's commands, and `registerPlugin`'s `name` is a free label. Not needed by Epic 20. Taken: not in this entry. <!-- OWNER: build the namespace lookup of RPGCode-package exports here, or leave to Epic 7 or a later entry -->

## Delivered

The loader itself shipped in entry 19.17 (`story-implement-package-catalogue-loader-and-startup-runtime`), which ruled the catalogue shape on `docs/spec/engine/rpgcode-package-loader.md`: a host-built catalogue entry carries `{ name, version, namespace?, requests, definition, startup: ProgramRef }`, and the manifest entry is upgraded from it in `engine/boot.ts` (`pluginManifestFor`). The `program` field this plan proposed on the manifest entry was therefore implemented as the catalogue's `startup` program reference; both the ruling and the code agree, and no second spelling exists.

What this entry added on top, and what each verify clause now rests on:

| Verify clause | Evidence |
|---|---|
| A project folder holding one RPGCode package and a `.gam` list naming it boots with that package's version and namespace in the manifest, its start-up having registered a layer on an engine command | `packages/core/test/engine-boot.test.ts`, "a project folder's RPGCode package layers an engine command and is rebuilt by reset": a `Main/` game folder under `Game/Sample/`, the package named in the `.gam` list, a catalogue entry with version `1.2` and namespace `climate`, and a start-up that registers a `registerPlugin` layer over the engine's `getgp`; the main program observes the wrapper ran once and the wrapped command still answered. The manifest identity itself is asserted by the existing "manifest package lookup folds ASCII package identity", now also checking `package.version` and `package.namespace`. |
| The layer table is rebuilt after `reset` | Same test: after the main program calls `reset()`, the fresh state runs the package start-up again and the wrapper still runs exactly once. `engine.ts` `resetLifecycle` now builds a fresh `createPluginLayers()` before `makeServices`, as `docs/spec/engine/rpgcode-package-loader.md#reset-and-restore` rules ("each fresh service/layer table derives its registrations deterministically from the installed packages"); before this entry the shared table was reused, so every reset stacked a second copy of each RPGCode layer and a wrapped engine command ran twice. |
| The layer table is rebuilt through the restore helper before a saved state loads | `engine.ts` `applyLoadedGame` already builds `restoredLayers = createPluginLayers()` and reruns the active packages' start-up (documented at `rpgcode-package-loader.md:41` after #861); exercised end to end by `packages/core/test/battle-fresh-load.test.ts`, which loads a real game save whose package owns a start-up and continues the fight. |
| A start-up that waits fails with `package.startup-unfinished` | Existing `engine-boot.test.ts` case "a package startup that waits is rejected by the lifecycle clock guard". |
| A listed name the catalogue lacks is one located `plugin.unresolved` naming the main file and the list position, and the game still boots | `engine-boot.test.ts:444-451` — both names, `diagnostic.file === game.main`, lines `[0, 1]`, and the engine still reaches its running stage. |
| A name that is not a legal package identifier is `manifest.package-name` | `script-manifest.test.ts:159`, and negatively in `engine-boot.test.ts:440`. |
| The 19.14 corpus start-up path and the legacy goldens are unchanged | `packages/runner-harness/src/corpus.ts:816-842` (`startups`) keeps working unchanged, and `pnpm golden`, `pnpm golden:bun` and `pnpm closing` (8/8) are green. |

### Defect found and fixed

`resetLifecycle` reused the engine's one `pluginLayers` table when it rebuilt services, so a package's `registerPlugin` layer was registered again on top of the copy already there. A wrapped engine command then ran once per reset (measured: two runs after one reset). The fix builds a fresh layer table first; `pnpm test:strict` passes 2,430 tests with it.

### Plan Change Log

- 2026-10-31 (built): the `program` field is recorded as delivered by the catalogue `startup` reference (19.17's ruling); added the project-folder boot and reset-rebuild test; fixed the reset layer-table reuse it exposed.
