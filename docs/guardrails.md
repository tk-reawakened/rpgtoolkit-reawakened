# Engineering Guard-rails (G1–G7)

> **Status:** Normative. These rules are **binding** for all code in this repository, including code written by AI agents.
> **Why they exist:** [ADR 0001](adr/0001-typescript-core.md) chose TypeScript everywhere. TypeScript does not enforce architecture the way a stricter language would. These seven rules restore what we gave up, and each one is backed by an automated check.
> **Changing a rule:** only through a new ADR that amends this file. Do not "temporarily" ignore a rule.

The key words **MUST**, **MUST NOT** and **MAY** are used as in RFC 2119.

| ID | Rule | Weak spot it hardens | Primary check |
|---|---|---|---|
| **G1** | Step-machine script VM with saveable state | Language async/generators make thread state unsaveable | Lint ban + snapshot/restore test |
| **G2** | Hard package boundaries (pure core; host-agnostic editor UI) | Nothing in TS stops DOM/Node/IO leaking into the core | `tsconfig` libs + lint + dependency graph check |
| **G3** | Determinism (injected clock and RNG, fixed tick) | Easy access to `Date.now`, `Math.random` and frame-time coupling | Lint ban + replay hash test |
| **G4** | Renderers only replay draw lists | Game frameworks want to own the loop and the state | Dependency graph check + review |
| **G5** | Headless golden tests on every change | Regressions are invisible without a reference | CI job (required) |
| **G6** | Licence gate | npm transitive dependencies can quietly pull in copyleft | CI job (required) |
| **G7** | Clean-room provenance | Legacy source is GPL-2 | CI provenance scan + process |

---

## G1 — Step-machine script VM with saveable state

**Rule.**
1. The RPGCode interpreter **MUST** be an explicit step machine. Its entry point advances execution by a bounded budget (e.g. `step(budget) → status`) and returns a status such as *running*, *yielded-waiting-for-key*, *yielded-waiting-for-movement*, *sleeping-until*, or *finished*.
2. All interpreter state (instruction pointer, call frames, locals, operand stack, thread table, sleep and wait reasons, error-handler state) **MUST** be **plain data**: JSON-serialisable values only. No functions, closures, class instances with behaviour, `Map`/`Set` inside the state, host handles, or Promises.
3. Blocking RPGCode built-ins (`wait`, `delay`, blocking movement, modal UI) **MUST** be implemented by **yielding a status**, never by blocking or awaiting.
4. Script threads **MUST NOT** be implemented with generators (`function*`), `async`/`await`, Promises, Web Workers or timers.

**Rationale.** E-90…E-96, E-33 and E-120/E-121 (saves include running threads). Requirements R1/R2 in architecture-options §1.

**Enforcement.**
* Lint (scope `packages/core/src/script/**`): forbid generator functions, `async` functions, `await`, `Promise` and `queueMicrotask`.
* Type check: the VM state type **MUST** satisfy a `PlainData` (JSON-value) constraint, so the compiler rejects functions and class instances.
* Test (required): for every sample program in the test corpus, run to a random step count, `JSON.stringify` the state, restore it into a fresh VM, run both to completion with the same inputs, and assert identical results and state hashes.

---

## G2 — Hard package boundaries

**Rule.**
1. `core` **MUST NOT** reference any host environment. That means no DOM or browser APIs (`window`, `document`, `navigator`, `fetch`, `localStorage`, `requestAnimationFrame`, canvas, audio), no Node APIs (`fs`, `path`, `process`, `Buffer`, `node:*`), and no timers.
2. `core` performs **no I/O**. Assets enter as bytes supplied by a runner through the asset-provider interface. Persistence leaves as data through the save interface.
3. `core` **MUST NOT** import any other workspace package except an approved, pure helper package listed in its `package.json`. Runtime npm dependencies of `core` **MUST** be on an explicit allowlist (initially empty).
4. `editor-ui` **MUST** reach the host only through the **platform-services** interface. It **MUST NOT** import `vscode`, Electron, Tauri, Capacitor or any `host-*` package. Host packages contain only platform services and chrome. Every editor feature lands in `editor-ui` first.
5. Dependency direction is fixed: `core` ← `synth` ← `runner-*` / `lsp` / `dap` / `editor-ui` ← `host-*`. Nothing points the other way.

**Rationale.** Architecture-options §2 (the seam) and §8. Keeps runners and editor hosts swappable (VS Code, PWA, desktop).

**Enforcement.**
* `packages/core/tsconfig.json`: `"lib": ["ES2022"]` (no `DOM`), `"types": []` (no `@types/node`). Any host global then fails to compile.
* Lint (`core`, `editor-ui`): restricted globals and restricted imports for every item above.
* A dependency-graph check in CI (e.g. a dependency-cruiser style rule set) asserting the direction in item 5 and the `editor-ui` ↛ `host-*` rule.
* CI asserts that `core`'s runtime dependencies match the allowlist exactly.

---

## G3 — Determinism

**Rule.**
1. `core` **MUST** obtain time only from an injected clock and randomness only from an injected, seedable RNG whose state is part of the save state.
2. Simulation **MUST** advance on a **fixed time tick**. Runners convert real elapsed time into a whole number of fixed ticks. Rendering may interpolate, but game state **MUST NOT** depend on frame rate.
3. Given the same game data, seed and input log, `core` **MUST** produce identical state and draw lists on every runner and machine.
4. `core` **MUST NOT** depend on iteration order that the language does not guarantee, or on locale- or time-zone-sensitive APIs.

**Rationale.** E-04, E-22…E-34, E-70…E-76. Makes G5 possible and keeps saves portable.

**Enforcement.**
* Lint (`core`): ban `Math.random`, `Date`, `Date.now`, `performance.now`, `Intl` and `toLocale*`.
* Lint (`core`), added by [ADR 0002](adr/0002-core-pixels-and-deterministic-maths.md): `Math` is an allowlist (`abs`, `ceil`, `floor`, `round`, `trunc`, `sign`, `min`, `max`, `fround`, `imul`, `clz32`, `sqrt`); every other `Math` member and the `**` and `**=` operators are banned, because their results may differ between JavaScript engines. Other maths comes from `core/fmath`.
* Test (required): replay recorded input logs twice, and once under Node and once in a headless browser, asserting identical per-tick state hashes and draw-list hashes.

---

## G4 — Renderers only replay draw lists

**Rule.**
1. Every renderer (WebGL2, Canvas2D, and any Phaser/Pixi-based one) **MUST** implement the draw-list replay interface and nothing more: it receives a draw list and produces pixels. The single reference rasteriser lives in `core/raster`, is pure, and is not a renderer in this sense: it is part of `core`, so scripts read the same pixels on every runner ([ADR 0002](adr/0002-core-pixels-and-deterministic-maths.md)).
2. Renderers **MUST NOT** own the game loop, hold game state, run game logic, or call back into `core` except through the public runner API.
3. Renderers **MAY** keep caches (textures, glyph atlases), as long as discarding them changes no observable behaviour.
4. Third-party engines (Phaser, PixiJS, Excalibur, and so on), if used, **MUST** be confined to a renderer implementation. Their scene graphs, physics, tilemaps, input and loop are not used for game behaviour.

**Rationale.** Architecture-options §2 and §3 (Option B caveat). Keeps the headless renderer (G5) and every runner equivalent.

**Enforcement.**
* Dependency-graph check: `runner-*` may import only `core`'s public entry point (not internals). Third-party engine imports are allowed only under `runner-*/src/render/**`.
* Test: the same draw list rendered by the reference rasteriser in `core/raster` and replayed by the WebGL2 renderer gives exactly the same result for colour keys and tint, and images otherwise within the golden tolerance (part of G5).
* Code review checklist item.

---

## G5 — Headless golden tests on every change

**Rule.**
1. A headless runner (Node/Bun, CPU rasteriser, null audio, scripted input) **MUST** exist from milestone 1 and **MUST** run in CI on every pull request as a **required** check.
2. The suite **MUST** cover: format round-trips; scripted play-throughs of the legacy sample games (`build/game/demo`, `build/game/Basic`) with recorded inputs; golden images at defined ticks; G1 snapshot/restore; and G3 replay hashes.
3. Golden files change only in a pull request that says why, reviewed as a behaviour change.
4. Legacy sample games are **test fixtures fetched at CI time** from their source. Whole games are **not** committed to this repository. Small anonymised or authored test fixtures **may** be committed (see G7 rule 3).

**Rationale.** Engine parity checklist ([docs/spec/engine/parity-checklist.md](spec/engine/parity-checklist.md), under [ADR 0007](adr/0007-docs-spec-is-the-normative-specification.md)). Without references, parity regressions are silent.

**Enforcement.** A required CI job. Merges are blocked if it fails or is skipped. The job runs on every pull request and reports a real result; for a change that touches only the inert paths named in [ADR 0016](adr/0016-ci-classified-steps.md), a fail-closed classifier may defer that job's expensive steps, and the job then prints the classifier's reason and still succeeds, so no job is ever skipped and any uncertainty or classifier failure runs everything and fails `gate`.

---

## G6 — Licence gate

**Rule.**
1. Every shipped artefact (npm packages, the VS Code extension, web bundles, desktop and mobile builds) **MUST** contain only dependencies under licences rated **Bronze or better** on the [Blue Oak Council licence list](https://blueoakcouncil.org/list) (Model, Gold, Silver or Bronze; version pinned in the repo), except those on the repo's exception list (today only MS-PL, which has per-file copyleft terms). See [ADR 0003](adr/0003-permissive-licences-acceptable.md). Examples: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, Zlib, 0BSD, BlueOak-1.0.0. For data and assets: CC0-1.0 (Bronze), or any other licence that passes the same test.
2. Copyleft of any strength (GPL, LGPL, AGPL, MPL-2.0, EPL, EUPL, MS-PL, SSPL), source-available or restricted licences (for example the Defold Licence) and "unknown/unlicensed" are **blocked**. A licence rated Lead on the Blue Oak list, or not on it, needs an ADR exception.
3. Bundled assets (SoundFonts, fonts, sample art) **MUST** be listed in `THIRD_PARTY_NOTICES` with their licence text. The default SoundFont is FluidR3_GM (MIT notice shipped with it).
4. Our own code is released under MIT and/or Apache-2.0.

**Rationale.** Brief (MIT/Apache) and architecture-options §7.

**Enforcement.** A required CI job that lists the licences of the full production dependency tree (all workspaces, including the extension bundle) and fails on any licence that is not rated Bronze or better on the pinned Blue Oak list or that is on the exception list. A dependency vulnerability audit runs in the same job. Lockfiles are committed and pinned. Dev-only tools that are never shipped, bundled or linked sit outside this production-tree scan, because they never reach users; each one is named, with its licence, in [ADR 0002](adr/0002-core-pixels-and-deterministic-maths.md) or a later ADR (currently only `ovsx`, EPL-2.0, used to publish to Open VSX). The scan still fails if such a tool appears in a production tree, and the same job also lists the licences of dev-only dependencies and fails on any that does not pass the same test and is not named in an ADR.

---

## G7 — Clean-room provenance

**Rule.**
1. Implementation **MUST** be derived from this repository's `docs/` only. The legacy RPG Toolkit source (GPL-2) **MUST NOT** be copied, translated, paraphrased line by line, or kept open as a reference while writing code.
2. Knowledge flows one way: legacy behaviour is described in `docs/spec/` (the normative specification, [ADR 0007](adr/0007-docs-spec-is-the-normative-specification.md)) and `docs/editor-features.md` as behaviour and byte layouts in our own words. Code then cites the doc sections it implements.
3. **No legacy source files or headers are committed.** G7 is about the GPL-2 *source code*, not about test data: small test fixtures (a few kilobytes of file layout, anonymised or authored from `docs/`) **may** be committed under `packages/core/test/fixtures/`, but whole legacy games and their assets are still fetched at CI time (G5 rule 4). Tables needed for compatibility (e.g. the VGA palette) come from public specifications or are rebuilt from sample data, not from the legacy code.
4. When a doc is wrong or incomplete, fix the **doc** first (in its own commit), then the code.
5. AI agents working on implementation follow the same rules (see `CLAUDE.md`).
6. `docs/spec/` is accepted on the owner's attestation (extraction log round 4, ADR 0007). Any later extraction from the legacy source follows [ADR 0006](adr/0006-clean-room-spec-extraction.md).

**Rationale.** The legacy engine is GPL-2. The new project must be freely licensed.

**Enforcement.**
* A CI provenance scan over source files fails on legacy markers: the GPL licence header text, legacy copyright holder names, legacy module and class identifiers (e.g. `trans3`, `tkCommon`, `CBoardEditor`, `CProgram`, `actkrt3`), VB6 syntax markers, and legacy file headers other than the magic strings the formats need. The marker list is kept in the repo.
* Pull requests implementing behaviour **MUST** cite the `docs/` section(s) they implement (template checkbox).

---

## Exceptions

An exception is allowed only when an ADR approves it. The code **MUST** carry an inline marker naming the rule and the ADR, e.g. `guardrail-exception: G3 ADR-NNNN`. Lint rejects unreferenced suppressions of guard-rail rules.

## Rollout

The checks are created **with the first code commit** (repository scaffolding), not later. Until the code exists, this document is the specification for that scaffolding:

1. Workspace layout and `tsconfig` per package (G2).
2. Lint configuration with the restricted globals, imports and syntax above (G1–G3).
3. Dependency-graph rules (G2, G4).
4. CI workflow with the checks that enforce these rules: `checks` (typecheck, lint, licence, provenance, the dependency graph, catalogue and command docs, and the tests the tools own), `unit` (one shard per test group), **headless golden** (G5) and its **Bun replay**, and a `gate` job that fails unless every one of them succeeded, so a skipped job cannot merge. The repository ruleset requires that single `gate` check, which names the others in `needs`. A job whose steps the ADR 0016 classifier defers still runs, prints why and reports success, so it is not a skipped job and `gate` still requires it.
5. A pull-request template with the guard-rail checklist (already in `.github/`).
