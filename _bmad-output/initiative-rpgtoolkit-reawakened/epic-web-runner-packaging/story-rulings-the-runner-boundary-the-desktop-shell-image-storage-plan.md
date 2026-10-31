---
title: "Rulings: the runner boundary, the desktop shell, image storage, load modes and mobile scope"
type: 'feature'
ticket: 1
created: '2026-10-31'
status: blocked
blocked_at: '2026-10-31'
blocked_reason: 'awaiting the owner review of the ruling text recorded here'
tracker_id: "#926"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/926"
baseline_revision: '674c8a03'
risk: 'high'
context:
  - '_bmad-output/initiative-rpgtoolkit-reawakened/epic-web-runner-packaging/discovery/inception-proposal.md, section 3'
  - '_bmad-output/initiative-rpgtoolkit-reawakened/epic-web-runner-packaging/epic-web-runner-packaging.md'
  - '_bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md, AD-1, AD-3, AD-5, AD-6, AD-14, AD-17, AD-22, AD-27, AD-33, Stack, Operations, Deferred'
  - 'docs/guardrails.md, G5, G6'
  - 'docs/architecture-options.md, section 8'
  - 'docs/spec/engine/audio-media.md#epic9-audio-handoff, #audio-prefetch, #audio-browser-test, #path-b-bank'
  - 'docs/spec/formats/packaging-and-paths.md, Distribution package'
  - 'docs/spec/formats/images.md'
  - 'docs/adr/0002-core-pixels-and-deterministic-maths.md'
---

# Rulings: the runner boundary, the desktop shell, image storage, load modes and mobile scope

## Intent

Give the owner one page of finished ruling text to approve or redirect, so entry 9.1 can land the normative
paragraphs instead of deciding them during a build. Each block below **is** the paragraph: it is written to be lifted
into the file it names, unchanged, and every block is marked `Proposed ruling (pending owner review; entry 9.1)`.

## Boundaries

A plan file only. This document changes no `docs/` page, no ADR, no guard-rail, no spine section, no code and no
config. Approving it does not edit them either: entry 9.1 lands each paragraph in its own docs-first commit, per
G7 rule 4. The mechanical half of 9.1 — merging the envelope's two `## Notes` headings and recording the four
`Source conflict:` lines — was already done when the breakdown was published, so 9.1 now starts at the rulings.

## What approving this looks like

Answer per decision: **approve verbatim**, or redirect with the alternative, or defer with the open question kept.
Seven are gating — 9.2 to 9.14 cannot start without them (D-1, D-3, D-4, D-5, D-6, D-8, D-9). Four are advisory —
9.2 to 9.14 can start with them left open, and their paragraphs are written so a later answer amends one section
(D-2, D-7, D-10, D-11).

| ID | Ruling in one line | Gating? | Lands in |
|---|---|---|---|
| D-1 | Electron 44.7.0 is the desktop runner's shell, with an evidence gate that can replace it | **yes** | `docs/adr/0013-desktop-runner-shell-electron.md` (new), `docs/spec/engine/runners.md#desktop-shell` |
| D-2 | Store images as they are; no BMP/GIF transcode; no WebP; PNG only for what we write | no | `docs/spec/formats/images.md` (new Storage policy section), epic Notes |
| D-3 | One normative runner page, one JSON Schema, one vector kit; the TypeScript packages are a binding | **yes** | `docs/spec/engine/runners.md` (new), `packages/runner-harness/schema/runner-protocol-v1.schema.json` (new), `tools/fixtures/runner-protocol/` (new) |
| D-4 | Two load modes with a measured threshold; the core computes the prefetch plan; manifest unchanged | **yes** | `docs/spec/engine/runners.md#load-modes`, `#prefetch`; AD-5 amendment |
| D-5 | The player ships a service worker that updates on next launch and never mid-session | **yes** | `docs/spec/engine/runners.md#offline` |
| D-6 | `runner-mobile` is Capacitor 8.5.3 around the web build; one platform proved; no store work | **yes** | `docs/spec/engine/runners.md#mobile` |
| D-7 | Exact for key, tint and blend choice; at most one unit per channel on blend arithmetic | no | `docs/spec/engine/runners.md#webgl2-agreement` |
| D-8 | esbuild 0.28.2; Vite not installed; single-file IIFE worker and AudioWorklet | **yes** | `docs/adr/0014-web-build-and-test-toolchain.md` (new), `docs/spec/engine/runners.md#build` |
| D-9 | Playwright 1.64.0, Apache-2.0, dev-only and named in ADR 0014 in the `ovsx` pattern | **yes** | `docs/adr/0014-web-build-and-test-toolchain.md` (new), `docs/spec/engine/runners.md#conformance-lane` |
| D-10 | SF2 on the default path and no WebAssembly, so no `wasm-unsafe-eval` there | no | `docs/spec/engine/runners.md#csp-and-banks` |
| D-11 | The player page is `runner-web`'s declared `./app` subpath, not a new package | no | AD-22 amendment in the spine, `packages/runner-web/package.json` |

ADR numbers are the next two free in `docs/adr/` (0001 to 0012 exist); renumber if another ADR lands first.

---

## D-1 — Desktop runner shell: Electron 44.7.0

**Proposed ruling (pending owner review; entry 9.1).** The desktop runner is **Electron 44.7.0**, wrapping the
`runner-web` bundle unchanged. Electron is chosen because the desktop runner must present WebGL2 frames within the
agreement bound of [D-7] and produce Web Audio output identically on macOS, Windows and Linux, and a bundled Chromium
is the only way to guarantee both on the Linux target where WebKitGTK is the known risk; a pure TypeScript core makes
Tauri's native-backend advantage moot. Entry 9.10 measures this shell on all three operating systems and may replace
it only if a named measurement fails on Electron — WebGL2 absent, or the [D-7] agreement unmet; no non-silent audio of
the expected length; or a distribution package failing to load from disk — in which case Tauri 2.12.2 is tried under
the same gate, and if both fail the epic stops with the failure recorded in the ADR rather than shipping an unproven
shell. `electron` is MIT; it is a build-time dev dependency whose runtime is downloaded at install time and never
linked into an npm production tree, so ADR 0013 names it as a dev-only tool in the pattern of ADR 0002's `ovsx`
clause.

- **Lands in:** `docs/adr/0013-desktop-runner-shell-electron.md` (new), and `docs/spec/engine/runners.md#desktop-shell`
  as the runner-facing half (what the wrapper must provide, not which binary provides it).
- **Evidence:** `docs/architecture-options.md:259-264` — "With a TypeScript core, Tauri's main advantage … no longer
  applies"; Tauri "smallest bundle", Electron "consistent Chromium", Electrobun "young", and the explicit instruction
  to spike "on all three desktop OSes (Linux WebKitGTK especially)"; the spine's Stack pins Electron 44.7.0 and Tauri
  2.12.2 / CLI 2.12.1 (`architecture-rpgtoolkit-reawakened.md:454-455`); ADR 0001 decision 6 defers the choice to a
  spike and calls it reversible; `electron` licence MIT read from the npm registry on 2026-10-31 (G6 rule 1).
- **Rejected alternative.** Tauri as the default. It ships a far smaller bundle and is the better *editor* shell, but
  the two properties this runner cannot trade are precisely the ones a system WebView varies by distribution — WebGL2
  behaviour and AudioWorklet availability — and the repo already names Linux WebKitGTK as the risk. Electrobun is
  rejected for the runner because it is young and unproven on Linux.
- **If it goes the other way (Tauri ruled):** 9.10 becomes a Tauri-first gate whose primary metric is bundle size;
  9.11 wraps Tauri instead, so its main process, capabilities file and IPC surface change and Electron's main-process
  code is not written at all; 9.14's desktop limb runs the Tauri build; and 9.3's player page must be shown to load
  under WebKitGTK, because the browser lane then stands in for the desktop WebView. If Electrobun is ruled, add a
  front-end bundler question to 9.3 and treat 9.10 as a language-level spike, not a measurement.

## D-2 — Stored image format (advisory)

**Proposed ruling (pending owner review; entry 9.1).** The project stores every game image exactly as the game holds
it — PNG, JPEG, Windows bitmap or GIF — and decodes it only through `core/formats/image`: `decodeTexture` for a still
picture and `decodeGif` for an animation. No import step transcodes a bitmap or a GIF, because a runner hands the core
bytes through the AD-5 `asset` request and never asks the browser to decode a game picture, so native browser support
for these formats cannot affect whether a game plays. Lossless WebP **MUST NOT** be adopted: it would add a second
pure-TypeScript decoder inside `core`, which G2 and G3 make a correctness burden, against no measured benefit. For
pictures this project *writes*, PNG is the format, indexed when the picture holds 256 colours or fewer, and a JPEG is
never re-encoded to a lossless format.

- **Lands in:** `docs/spec/formats/images.md`, a new "Storage policy" section after the shared decode contract; and a
  line in the epic's Notes pointing at it.
- **Evidence:** AD-28 makes `core/formats/image` the one place bytes become pixels, and
  `packages/core/src/formats/image/index.ts:73,110` exports exactly `decodeTexture` and `decodeGif`; the BMP and GIF
  readers are merged (16.11 `e22beff4`, 16.12 `8f2e5b62`); the only measured corpus is 134 files and 6.3 MB for two
  games with a largest file of 430,086 bytes (`docs/spec/formats/packaging-and-paths.md:112`); `sharp` is excluded
  under G6 because libvips is LGPL, and the only PNG *encoder* in the tree is the harness's
  (`packages/runner-harness/src/png.ts`), so transcoding is not a one-line act even once it is wanted.
- **Rejected alternative.** Transcode every bitmap and GIF to PNG at import and add lossless WebP beside PNG. It needs
  an encoder inside the shipped tree, a new import-policy spec section, and a second decoder in `core` for WebP, to
  save bytes on a corpus smaller than a single modern web page.
- **If it goes the other way:** 9.7 gains a transcode step and an encoder decision; 9.9's threshold measurement gains
  a before/after size comparison; if WebP is ruled in, 9.4's texture upload path gains a second decode format, G2's
  allowlist and G6's scan gain a dependency and its licence record.

## D-3 — The runner boundary contract

**Proposed ruling (pending owner review; entry 9.1).** `docs/spec/engine/runners.md` is the normative contract between
the core and any runner, and the TypeScript packages are one binding of it, never the contract. It defines four
record families — the draw list (AD-3), the audio cue and its runner message protocol (AD-16 and
`audio-media.md#runner-audio-protocol`), the input event and its reply (AD-14), and the host request (AD-5, AD-17) —
and for each states what a runner **MUST** do, what it **MAY** decide and what it **MUST NOT** feed back. One JSON
Schema is published beside it (`packages/runner-harness/schema/runner-protocol-v1.schema.json`) with a vector kit
(`tools/fixtures/runner-protocol/`, whose generator has a `--check` mode on the `audio-protocol:check` pattern). A
runner proves itself by replaying the vectors; it never depends on a TypeScript type to know what is legal.

- **Lands in:** `docs/spec/engine/runners.md` (new page), `packages/runner-harness/schema/runner-protocol-v1.schema.json`
  (new), `tools/fixtures/runner-protocol/{generate.mjs,vectors.json}` (new), a `runner-protocol:check` script in the
  root `package.json`, and the CI `checks` job.
- **Evidence:** the owner direction recorded in `epic-audio-synth/discovery/audio-exploration.md` §12 ("a runner may
  not be written in TypeScript, but it must have the same shape … a normative behaviour page, a language-neutral
  message schema and conformance vectors"); two working precedents in this tree — raster vectors as plain JSON
  (`tools/fixtures/conformance/raster/vectors.json:1` plus text and TrueType vectors) and the audio protocol's schema
  with a generating `--check` (`packages/synth/schema/audio-protocol-v1.schema.json:1`,
  `tools/fixtures/audio-protocol/generate.mjs`); AD-1 already guarantees every engine argument and result is
  structured-cloneable plain data; the draw union to describe is the eight commands at
  `packages/core/src/ports/draw.ts:94-160`.
- **Rejected alternative.** TypeScript-only: let the package types be the contract. Cheapest, and what most entries
  build anyway, but it fails the recorded direction and leaves the desktop and mobile wrappers — the two places a
  reimplementation is most likely — with nothing to check against.
- **If it goes the other way:** 9.2 shrinks to a responsibilities page for our own runners; the JSON Schema and the
  vector kit are dropped; 9.4 and 9.5 verify against TypeScript fixtures only; 9.3's `tools/browser` harness loses the
  schema-validation step; 9.10 to 9.12 keep their checks but stop promising a portable proof.

## D-4 — Load modes, the threshold and who plans prefetching

**Proposed ruling (pending owner review; entry 9.1).** The web runner has two load modes. Below a threshold it
downloads the whole distribution package once, behind a progress screen, and keeps it; above it, it streams assets on
demand. The threshold is not a fixed constant: it is the measured uncompressed size of the largest corpus package,
rounded up to the next whole mebibyte and recorded in a table with its measurement date, 64 MiB standing in until the
tracer measures the fetched corpus. The **core** computes the deterministic prefetch plan and sends it as tiered hints
at the AD-5 seam — `now`: the current board, its music, the `.anm` frame sounds of the animations it uses and the
default bank when a MIDI is in this tier; `next`: boards reachable by edge links and literal `send(...)` targets, the
battle background and its sounds; `always`: main-file cursor sounds and the default bank — and a runner only fetches
and decodes ahead. A runner **MUST NOT** parse a board to guess what to prefetch. A hint never blocks, never changes
state or a hash, and never earns a reply. `manifest.json` keeps exactly `schema`, `main` and `index`; a cached package
is keyed by the SHA-256 of its bytes, and per-entry hashes and delta updates wait until a second published package
version exists.

- **Lands in:** `docs/spec/engine/runners.md#load-modes` and `#prefetch`; an AD-5 amendment in the spine adding the
  hint request kind; and 9.8's code half in `packages/core/src/ports/requests.ts` with the matching
  `HOST_REQUEST_KINDS` entry in `packages/core/src/script/manifest.ts` and the `isRequest` guard in
  `packages/runner-harness/src/driver.ts`.
- **Evidence:** AD-5 (blocking versus stream requests; hints allowed and unable to change state); AD-6 and
  `docs/spec/formats/packaging-and-paths.md:98-106` fix the manifest at exactly three fields and require a reader to
  refuse any other; the synchronous `ProgramLoader.read` (`packages/core/src/script/loader.ts:24-29`) is satisfied by
  the whole-package mode and not by streaming; `audio-media.md#audio-prefetch` supplies audio's share of the tiers;
  the envelope's "about 64 MB" and "largest about 33 MB uncompressed" have no recorded source while the only corpus
  measurement is 6.3 MB for two games (`packaging-and-paths.md:112`); the ZIP reader already parses each entry's
  CRC-32 and sizes (`packages/core/src/formats/package/zip.ts:83,178`), so per-entry keys stay a cheap later step.
- **Rejected alternative.** Stream everything from the start, or let each runner parse boards to guess. The first
  makes every first load a visible stall; the second duplicates the board reader in every host, which
  `audio-media.md#audio-prefetch` rejects by name. Adding per-entry manifest hashes now is rejected because it amends
  AD-6 and the manifest contract for a delta-update benefit no v1 artefact can use.
- **If it goes the other way:** per-entry hashes now add an AD-6 and `docs/spec/formats/` amendment to 9.7 and 9.9 plus
  a re-proof that the write stays byte-identical; dropping streaming leaves 9.9 with storage tiers and stall
  presentation only, and the threshold table still lands; letting a runner parse boards removes 9.8 and gives 9.9 a
  second board parser.

## D-5 — The offline service worker

**Proposed ruling (pending owner review; entry 9.1).** The player ships a service worker that caches the app shell,
the bundled default bank and the whole-package download, and that updates on the next launch and **never** mid-session.
Save blobs go through the existing `saveBlob` / `loadBlob` / `listBlobs` contract under `GameId`-keyed paths, and the
service worker never reads a save. The runner **SHOULD** call `navigator.storage.persist()` and **MUST** report an
unpersisted or quota-limited state rather than swallowing it, falling back to streaming for anything it cannot keep. No
background sync, push, accounts or telemetry are added. The player is its own static artefact: the editor PWA stays
`host-web`'s, and publishing or deploying the player is out of scope for this epic.

- **Lands in:** `docs/spec/engine/runners.md#offline`, and 9.9's code half in
  `packages/runner-web/app/service-worker.ts`.
- **Evidence:** the spine's Operations section fixes the CSP, the offline-first stance and the update policy in one
  place (`architecture-rpgtoolkit-reawakened.md:497`, "the PWA updates on next launch, never mid-session"); AD-17 fixes
  the blob keys and `GameId`; `host-web` is the editor's PWA (epic editor-foundation), so a player artefact cannot be
  assumed; the release pipeline has no owner (epic 17's proposal D-13).
- **Rejected alternative.** Defer offline to a release epic. It leaves `persist()`, the quota fallback and the cache-key
  policy unowned, and the cache-key policy has to be decided alongside D-4.
- **If it goes the other way:** 9.9 keeps storage tiers and the stall presentation and drops the service worker and the
  `persist()` handling; Done-when 1 to 3 are unaffected; the envelope's "kept offline" narrative is struck.

## D-6 — Mobile wrapper scope

**Proposed ruling (pending owner review; entry 9.1).** `runner-mobile` is the `runner-web` build inside **Capacitor
8.5.3** and nothing else: v1 proves one sample game running on a real device or emulator, carrying the same asset
source and the same AD-17 blob keys as the web runner with the Capacitor filesystem behind them. Store submission,
signing, icons, splash screens, deep links and per-platform chrome are out of scope and belong to a release owner that
does not yet exist. The wrapper **MUST NOT** fork the player: a platform difference is a host service or a policy in
the runner page, never a second rendering or input path.

- **Lands in:** `docs/spec/engine/runners.md#mobile`, and 9.12's code half in `packages/runner-mobile/`.
- **Evidence:** `spec-rpgtoolkit-reawakened/packages.md:14` ("`runner-web` in Capacitor"); the edge list already has
  `["runner-web", "runner-mobile"]` (`tools/deps/edges.json`); the spine pins Capacitor 8.5.3
  (`architecture-rpgtoolkit-reawakened.md:453`); `@capacitor/core` is MIT (npm registry, 2026-10-31); ADR 0005 makes
  this its own product with its own packaging decisions.
- **Rejected alternative.** Tauri mobile, which the desktop spike might prefer, or a native shell. The first doubles the
  shell work and carries Tauri 2's documented mobile caveats; the second contradicts "one core, replaying draw lists"
  (G2, G4) for a platform no Done-when criterion asks for.
- **If it goes the other way:** if a native shell is ruled, 9.12 becomes a platform port with its own binding of the
  vector kit and Done-when 5's proof changes from a WebView run to a native run; if store-readiness is required at v1,
  the epic needs an owner and accounts it does not have, and 9.12 grows a limb it cannot finish.

## D-7 — What the WebGL2 agreement bound means (advisory)

**Proposed ruling (pending owner review; entry 9.1).** The WebGL2 replayer and the reference rasteriser are compared
**exactly** on every decision the CPU pipeline makes discretely — colour-key exclusion, tint saturation and the choice
of blend — and within **at most one** unit per channel on the arithmetic a GPU may round differently, the `translucent`
and `additive` blends, with the worst per-channel difference reported per vector. The comparison never widens a PNG
golden: `independent-reference` and `regression-baseline` rows stay exact, and a `legacy-screenshot` row stays
report-only.

- **Lands in:** `docs/spec/engine/runners.md#webgl2-agreement`. No guard-rail change is needed: G4's enforcement prose
  already separates "exactly the same result for colour keys and tint" from "images otherwise within the golden
  tolerance", and this ruling is the second half stated once.
- **Evidence:** AD-3's check reads "per-command CPU-vs-WebGL2 conformance fixtures with **exact** match for key and
  tint" (`architecture-rpgtoolkit-reawakened.md:111`); G4's enforcement adds "images otherwise within the golden
  tolerance" (`docs/guardrails.md`, G4); the CPU pipeline's blend is integer division,
  `(dst·(255−a) + c·a + 127) / 255`, which a float blend cannot reproduce bit-exactly on every driver; the ledger
  policy keeps PNG comparison exact for the two gating classes (`docs/spec/engine/parity-checklist.md:30`).
- **Rejected alternative.** Exact equality everywhere. Honest, but unachievable across drivers; chasing it produces
  driver-specific hacks, which is what G4 exists to prevent.
- **If it goes the other way:** requiring exact-everywhere gives 9.4 a software-blend path for the two blends and
  roughly doubles its scope; permitting more than one unit per channel would keep the GL blend but add a tolerance
  field to the ledger and weaken the agreement claim in 9.14.

## D-8 — The web build tool

**Proposed ruling (pending owner review; entry 9.1).** The browser artefacts are bundled with **esbuild 0.28.2**, the
bundler AD-22 already names for `host-vscode`. The engine worker and the AudioWorklet are single-file IIFE bundles with
no runtime `import()`, as the spine's Operations section requires. Vite **MUST NOT** be installed: it pulls
`lightningcss` (MPL-2.0) and would need its own ADR before a first install, and nothing here needs HMR. The player page
is a static HTML file plus one bundle, served in development and in the browser tests by a small static server, and no
framework or dev server enters the shipped artefact.

- **Lands in:** `docs/adr/0014-web-build-and-test-toolchain.md` (new, shared with D-9) and
  `docs/spec/engine/runners.md#build` for the artefact shape; 9.3's code half in `tools/browser/build.mjs` and the root
  `package.json` dev dependencies.
- **Evidence:** the spine's Deferred list (`architecture-rpgtoolkit-reawakened.md:545`): "Vite 8 depends on
  `lightningcss` (MPL-2.0). Before the first Vite install (epics web-runner-packaging and editor-foundation), an ADR
  names it as a dev-only tool, or the web builds use esbuild instead"; Operations requires the single-file IIFE bundles
  (`:497`); AD-22 names esbuild for `host-vscode` (`:321`); the spine pins esbuild 0.28.2 (`:439`); `esbuild` is MIT
  (npm registry, 2026-10-31).
- **Rejected alternative.** Vite 8 for HMR and a dev server. It costs an ADR for a copyleft-ish transitive dependency
  that only ever runs on a developer's machine, for a convenience this epic does not need.
- **If it goes the other way:** choosing Vite adds the `lightningcss` dev-only ADR to 9.1 before 9.3 and changes 9.3's
  build script and CI step; choosing neither leaves the epic with no way to ship a browser bundle, which is a stop
  condition rather than a variant.

## D-9 — The browser lane, and why Playwright passes G6

**Proposed ruling (pending owner review; entry 9.1).** The browser lane is **Playwright 1.64.0**, one headless Chromium
project, and it is a required `gate` dependency that runs `pnpm fixtures:fetch` first. Playwright is **Apache-2.0**,
rated Gold on the pinned Blue Oak list, so G6 rule 1 admits it outright. It is nevertheless declared a **dev-only**
tool in ADR 0014 in the exact pattern ADR 0002 uses for `ovsx`: the npm packages and the browser binaries Playwright
downloads at install time are never bundled, linked or shipped in any artefact, so the production-tree licence scan
never sees them, and the scan still fails if any Playwright code appears in a shipped tree. The lane serves the fetched
`fixtures/` folder over the local static server, and no test reaches the network.

- **Lands in:** `docs/adr/0014-web-build-and-test-toolchain.md` (new, shared with D-8) and
  `docs/spec/engine/runners.md#conformance-lane`; 9.3's code half in `.github/workflows/ci.yml` (job plus `gate`
  dependency) and the `GROUPS` list in `tools/no-skips/run.mjs`.
- **Evidence:** G6 rule 1 lists Apache-2.0 among the licences it admits, and its Enforcement paragraph is where the
  dev-only rule lives (`docs/guardrails.md:108,115`: "Dev-only tools that are never shipped, bundled or linked sit
  outside this production-tree scan … each one is named, with its licence, in ADR 0002 or a later ADR"); ADR 0002
  records the pattern three times (`docs/adr/0002-core-pixels-and-deterministic-maths.md:14,36,57`, the `ovsx`
  clause); the spine pins Playwright 1.64.0 for headless-browser tests (`:441`); `audio-media.md#audio-browser-test`
  already names Playwright as the tool this epic must use; `@playwright/test` and `playwright-core` declare
  Apache-2.0 on the npm registry (read 2026-10-31).
- **Rejected alternative.** A Node lane pretending to be a browser, or a WebDriver setup. Neither executes WebGL2 or
  Web Audio, which are the two things Done-when 2 and 3 exist to prove.
- **If it goes the other way:** refusing Playwright is a stop condition, not a preference — 9.3, 9.4, 9.5, 9.6 and 9.14
  lose their verification and Done-when 2, 3 and 5's audio limb become unprovable. If a different tool is chosen, it
  needs the same two facts in ADR 0014: its licence on the pinned Blue Oak list, and why it is dev-only.

## D-10 — SF2, WebAssembly and the CSP note (advisory)

**Proposed ruling (pending owner review; entry 9.1).** The default audio path ships **SF2** banks only, so it
instantiates **no WebAssembly** and the shipped CSP needs no `wasm-unsafe-eval` for it. `script-src 'wasm-unsafe-eval'`
is allowed only in a build that can load an SF3 bank or a user-supplied `.sf2` that is SF3, and the player page states
which build it is. The web runner **MUST** assert in the browser lane that the default path instantiates no
WebAssembly, so the allowance can never widen silently. SF3 support itself stays unverified and is not promised by
this epic.

- **Lands in:** `docs/spec/engine/runners.md#csp-and-banks`, plus a line in the epic's Notes so the caveat survives
  beside the audio handoff.
- **Evidence:** `audio-media.md#audio-browser-test` states the bundled banks are SF2 so the default path needs no
  WebAssembly, and calls the SF3 requirement **unverified**; the spine's Operations section allows
  `'wasm-unsafe-eval'` in the shipped CSP (`:497`) and the review record explains that `spessasynth_core` reaches
  WebAssembly through `stb-vorbis` only for SF3; `audio-media.md#path-b-bank` leaves the bundled bank unresolved, so a
  bank may be TK-16 (SF2) or none.
- **Rejected alternative.** Always allow `wasm-unsafe-eval`. It widens the shipped CSP for a path most games never take,
  and nothing in the epic needs the permission.
- **If it goes the other way:** an SF3 default makes the CSP note mandatory and gives 9.5 a WebAssembly assertion in the
  opposite direction; allowing user banks to be SF3 forces 9.6 to detect the container before promising playback.

## D-11 — Where the player page lives (advisory)

**Proposed ruling (pending owner review; entry 9.1).** The player page lives in `packages/runner-web` as a declared
**`./app`** subpath beside the package's `src/index.ts`, and `host-web` remains the editor's PWA. AD-22 gains that
subpath in its own list — "every package exports one public entry `src/index.ts`, plus `./testing` and, for
`runner-web`, `./app`, where needed" — and no new workspace package is created, so `tools/deps/edges.json`, the spine's
Structural Seed and its generated diagram are unchanged.

- **Lands in:** the AD-22 amendment in
  `_bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md`,
  and `packages/runner-web/package.json`'s `exports` map.
- **Evidence:** AD-22's rule is written with an explicit "plus `./testing` where needed"
  (`architecture-rpgtoolkit-reawakened.md:321`), so a second declared subpath is an amendment of one clause rather than
  a new convention; `spec-rpgtoolkit-reawakened/packages.md` gives `runner-web` both a player and a preview role
  already; the edge list contains no player package, and adding one means editing the single edge list plus the
  generated diagram for a page with one job.
- **Rejected alternative.** A new `apps/player` package. Cleaner separation, but it changes the single edge list, the
  structural seed and the generated diagram for one template file, and it invites a second runner entry point that
  drifts from `runner-web`'s.
- **If it goes the other way:** a separate package adds itself to `packages/`, `tools/deps/edges.json`, the spine's
  Structural Seed and the regenerated diagram in 9.3, and the AD-22 clause is not needed; 9.9's service worker then
  belongs to that package rather than to `runner-web`.

---

## Acceptance

Entry 9.1 is done when the epic's single `## Notes` section holds a dated owner line for D-1, D-3, D-4, D-5, D-6, D-8
and D-9, and each paragraph above has landed in the file it names, in a docs-first commit that no code commit precedes.
The four advisory rulings are either dated lines or recorded open questions with the entries they would change. The
`Source conflict:` lines and the Notes merge are already in place from the publication commit.

## Verification

`pnpm provenance`, `pnpm lint` and `tickets.py status` on the epic folder; an anchor check that every `#…` target named
here exists in `docs/spec/engine/runners.md` once written; and a person confirming that each landed paragraph is the
one they approved, word for word.

## Evidence and sources

Consolidated: `docs/architecture-options.md` §8; the spine's Stack, Operations, Deferred and AD-1, AD-3, AD-5, AD-6,
AD-14, AD-17, AD-22, AD-27, AD-33; `docs/guardrails.md` G4, G5 and G6; `docs/spec/engine/audio-media.md` anchors
`#epic9-audio-handoff`, `#audio-prefetch`, `#audio-browser-test`, `#path-b-bank`; `docs/spec/formats/packaging-and-paths.md`
and `docs/spec/formats/images.md`; `docs/spec/engine/parity-checklist.md`; `docs/adr/0001`, `0002`, `0005`; and the
npm registry licence reads of 2026-10-31 (`@playwright/test` and `playwright-core` Apache-2.0, `electron` MIT,
`esbuild` MIT, `@capacitor/core` MIT, `@tauri-apps/cli` Apache-2.0 OR MIT).

## Changed artifacts when approved

- three new files: `docs/spec/engine/runners.md`, `docs/adr/0013-desktop-runner-shell-electron.md`,
  `docs/adr/0014-web-build-and-test-toolchain.md`;
- one new section in `docs/spec/formats/images.md`, one amendment to AD-22 and one to AD-5 in the spine;
- the epic's Notes gain the dated decision lines;
- no code, no guard-rail, no manifest and no dependency change in this entry.

## Plan impact on later entries

| Entry | Unchanged by these rulings | Changes if a ruling flips |
|---|---|---|
| 9.2 | writes `runners.md` and the schema under D-3 | D-3 flipped: page only, no schema, no vector kit |
| 9.3 | esbuild bundle, player page, Playwright lane, probes | D-8 flipped: Vite + `lightningcss` ADR first; D-9 flipped: stop; D-11 flipped: new package, edge list and diagram |
| 9.4 | the replayer and the agreement check | D-7 flipped: software-blend path; D-3 flipped: TypeScript fixtures only |
| 9.5 | cue player and Web Audio output | D-10 flipped: WebAssembly assertion in the other direction |
| 9.6 | banks, cache, user `.sf2` | D-10 flipped: container detection before promising playback |
| 9.7 | `make-package`, package load in the browser | D-2 flipped: transcode step and an encoder; D-4 flipped: manifest hashes |
| 9.8 | core planner and the hint wire | D-4 flipped: either dropped (runner parses boards) or joined by manifest hashing |
| 9.9 | load modes, storage tiers, service worker | D-5 flipped: no service worker; D-4 flipped: per-entry cache keys |
| 9.10 | three-OS gate on the chosen shell | D-1 flipped: Tauri-first gate, bundle size primary |
| 9.11 | desktop wrapper over the web build | D-1 flipped: Tauri config and IPC replace the Electron main process |
| 9.12 | Capacitor wrapper on a device | D-6 flipped: native port and vector binding |
| 9.13 | refactor sweep | nothing here changes it |
| 9.14 | closing suite and the CAP-12 signal | D-1 flipped: desktop limb runs the Tauri build; D-7 flipped: agreement claim weakens |
