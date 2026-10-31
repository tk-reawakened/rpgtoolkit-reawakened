---
title: "Build the package catalogue in the host"
type: 'feature'
ticket: 20
tracker_id: "#853"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/853"
parent: epic-rpgcode-platform
created: '2026-10-30'
status: built
baseline_revision: '9ab477f66872d20bc97ef635384a72287e0ac024'
risk: "high"
context:
  - "spec - docs/spec/engine/rpgcode-package-loader.md"
  - "code - packages/runner-harness/src/package-catalogue.ts (new), packages/runner-harness/src/index.ts"
  - "code - stock/stock_battle/manifest.json + startup.prg (the real folder under test)"
---

# Build the package catalogue in the host

## Intent

Core consumes a `PackageCatalogueEntry[]` and reads nothing itself (G2); 19.16/19.17 proved the
consuming side. No host built the list, so a `.gam` naming a package folder only loaded in tests that
hand-assembled a catalogue. This entry adds the host side: a package folder's `manifest.json` plus its
start-up program become the catalogue entry core needs, and a real engine boot proves it.

## Boundaries

Nothing in `core`; the new module is `packages/runner-harness/src/package-catalogue.ts` and it does no
I/O — the runner, editor or test reads the folder and passes text. No new package format, no archive or
descriptor reader, no capability model, no change to `registerPlugin` or to the plugin manifest.

## What shipped

- `parsePackageManifest(text, label)` validates a folder's manifest: `name` (and optional `namespace`)
  must match the package-identity grammar `^[a-z][a-z0-9_]*$`, `version` must be a non-empty string,
  `requests` must be a subset of the host-request kinds, and `program` must be a package-relative path
  without `..`. A refusal names the manifest and the field, so a bad folder never reaches boot.
- `catalogueEntry(manifest, programSource)` builds the entry: identity from the manifest, a definition
  shell with no native commands (a package's commands come from its RPGCode start-up), and one inline
  startup `ProgramRef` at the current instruction version.
- `buildPackageCatalogue(folders)` validates every folder first and refuses the whole list with the
  problems named, rather than booting a half-catalogue; a duplicate package name is one of those
  problems because the `.gam` list must select exactly one package per name.
- Exported from the harness barrel so a runner, the editor preview and a test all build the catalogue
  the same way.

## Verification

`packages/runner-harness/test/package-catalogue.test.ts`, three cases over the real `stock/stock_battle`
folder:

1. The catalogue built from that folder boots a game whose `.gam` list names `stock_battle`: no
   `plugin.unresolved`, the engine reaches `running`, and the package's start-up ran (its `stockBattle`
   table exists in the state).
2. A second name the catalogue lacks is exactly one located `plugin.unresolved` naming it, and the game
   still boots.
3. A folder whose manifest is not a package (hyphenated name) is refused by name before boot, and a
   duplicate package name refuses the whole catalogue with the reason.

Gates: `pnpm typecheck`, `pnpm lint`, `pnpm graph`, `pnpm test:strict`, `pnpm fixtures:author:check`,
`pnpm catalogue:check`, `pnpm command-docs:check`, `pnpm licence`, `pnpm provenance`, `pnpm no-skips:test`,
`pnpm golden`, `pnpm golden:bun`, `pnpm closing`.

## Plan Change Log

- 2026-10-31 (built): host catalogue builder, barrel export and the three tests over the real stock
  package folder.
