# Runners

What a runner is, what it must do, and what it is allowed to decide. This page is the normative contract between the
core and any runner — browser, desktop application, mobile wrapper or the headless harness — and it is the page a
non-TypeScript runner is written against.

It exists because the owner ruled on 2026-10-31 that **the runners in any language share one shape**: the behaviour is
normative prose, the boundary is plain data, and a conformance kit decides who complies. The TypeScript packages are
one binding of this page, never the contract itself.

**Status.** This page is normative from its landing date. No runner package exists in `packages/` yet: epic
`web-runner-packaging` builds them, and the table at [Implementation status](#implementation-status) names which entry
delivers each section. Nothing here describes a feature that no entry will build; where a section names a file, that
file is that entry's destination.

**What this page does not restate.** The engine API is AD-1; the draw
command union is AD-3; the event union is AD-14; the request union is AD-17; audio cues are AD-16 and
[audio-media.md#runner-audio-protocol](audio-media.md#runner-audio-protocol). Those pages own the record shapes. This
page owns the runner's obligations, the latitude it has, and the checks that prove it.

<a id="boundary"></a>
## The boundary

A runner is everything outside `core` that makes a game visible and audible. It owns four jobs and no others:

| Job | It receives | It must not |
|---|---|---|
| Replay draw lists | a `DrawList` per frame (AD-3) | own the game loop, hold game state, run game logic, or call into `core` except through the engine API (G4) |
| Play audio | `AudioCue` records and the audio protocol's messages (AD-16, [audio-media.md#runner-audio-protocol](audio-media.md#runner-audio-protocol)) | change a cue's meaning, invent or drop an `audio.ended` a cue owes, or send anything back except an AD-14 input |
| Deliver input | the host's own events | decide a tick, reorder a tick's events, or write the input log (AD-14: the core writes it) |
| Service requests | `TickReport.requests` (AD-5, AD-17) | return bytes any other way, cache a reply's *content* as state, or block the simulation itself |

The core never waits on a runner except through a blocking request, never reads anything back except an AD-14 input, and
never learns a runner's name. Everything a runner sends the core is an input `{ tick, event }`; everything the core
sends a runner is plain data — structured-cloneable, fixed keys, absent values `null` (AD-1, AD-14).

<a id="runner-may-decide"></a>
## What a runner may decide, and what it may not

**May:** the output API (WebGL2, Canvas2D, a native surface), buffer sizes and threading, which work runs in a worker,
which sources and banks are installed, presentation scaling and letterboxing (AD-33), where a save physically lives
(AD-17), and the player-facing preferences of [audio-media.md#soundfont-layers](audio-media.md#soundfont-layers).

**May not:** change the meaning of a record, drop or invent a reply the core expects (AD-5, AD-14), feed device state
into the simulation, depend on how ticks were batched (AD-1), or keep anything caches hold observable: discarding a
cache at any moment must change no pixel, no sound and no hash (G4 rule 3).

<a id="draw-list"></a>
## Draw-list replay and the presented frame

A runner replays the `DrawList` of the current tick and nothing more (G4). Two obligations follow.

**Scaling is presentation.** The core emits a draw list for the logical viewport; a runner maps it to the physical
display in one of the two modes AD-33 allows — integer-scaled pixel-perfect letterbox, or responsive expand-viewport —
chosen by the player, never by the game state. `alpha` is presentation-only and is excluded from state and draw hashes,
so a runner may interpolate between ticks and may not let interpolation reach anything the core reads.

**Textures come from the core, not from the runner's own decoder.** A runner fetches asset bytes through an AD-5
request; the core decodes them (AD-28) and the runner pulls pixels it needs from surfaces with
`engine.surfacePixels(id, rev)` (AD-27). A runner may keep a texture, glyph-atlas or tile cache keyed by `(id, rev)`,
because `rev` increments on every mutation and an unknown or stale `rev` returns `null`; it must be able to refill at
any time, and a test that flushes every cache every frame must produce identical pixels.

<a id="webgl2-agreement"></a>
## The WebGL2 agreement bound

The WebGL2 replayer and the reference rasteriser in `core/raster` are compared per draw command, on the conformance
vectors and on every gating golden scene:

- **exactly** on every decision the CPU pipeline makes discretely — colour-key exclusion, tint saturation, and the
  choice of blend;
- **within one unit per channel** on the arithmetic a GPU may round differently, which is the `translucent` and
  `additive` blend of AD-3's pixel pipeline, with the worst per-channel difference reported per vector.

This bound never widens a PNG golden: `independent-reference` and `regression-baseline` rows stay exact
([parity-checklist.md#golden-image-oracle](parity-checklist.md#golden-image-oracle)), and a `legacy-screenshot` row stays
report-only. A replayer that needs more than one unit on a blend is a defect to fix or a case for a new ADR — not a
reason to widen the bound.

<a id="input"></a>
## Input and focus

A runner turns its host's events into the AD-14 input records and feeds them to `advance` with the tick they belong to:
`key { name, code, char, down }` with `name` in the legacy logical vocabulary (`"ENTER"`, `"LEFT"`, `"A"`), `pointer` in
logical integer pixels, `gamepad`, `focus { lost | gained }`. The DOM-to-legacy name table lives in `core/input`; a
runner maps, it does not name.

Focus is the core's, not the runner's: after `focus.lost` the core consumes no ticks until `focus.gained` (E-03). A
runner keeps calling `advance` — it must not stop its own loop — and lets the core return `ticksRun: 0`.

Unlock is a runner event, not an input: a browser's first gesture releases audio without the core ever seeing it
([audio-media.md#audio-autoplay](audio-media.md#audio-autoplay)).

<a id="audio"></a>
## Audio

The runner plays the cue stream through the audio protocol v1 messages and reports the one reply the core accepts —
`audio.ended { cueId }` — as an AD-14 input (AD-16). The cue-to-message mapping is
[audio-media.md#cue-player](audio-media.md#cue-player) and the message and event records are
[audio-media.md#runner-audio-protocol](audio-media.md#runner-audio-protocol); this page does not restate either.

Three runner rules come with the contract, and all three are the runner's, not the core's: the autoplay unlock of
[audio-autoplay](audio-media.md#audio-autoplay), the focus hold of [audio-focus](audio-media.md#audio-focus) (the
default is `"pause"`), and the late-sound drop of [audio-late-sounds](audio-media.md#audio-late-sounds) measured from
ready, not from receipt. A blocking asset request freezes core ticks and adds no lateness by itself; decode time after
the reply does.

A runner also owns the player's preferences — per-bus volume and mute, and the bank picker — and the shared bank cache
of [audio-media.md#audio-soundfont-cache](audio-media.md#audio-soundfont-cache): banks keyed by the SHA-256 of their
bytes, cached per runner and shared across games, with eviction that never removes the bank in use.

<a id="desktop-shell"></a>
## The desktop applications

There are **two desktop applications from one codebase**, and one ruled shell for both. The **player** is a
distribution artefact; the **editor** is its own package and application, with its own `platform-services`
instantiation, the harness embedded for preview, and its own update cadence. The player is not a stripped editor, the
editor is not a mode of the player, and neither is the PWA.

Both are **Electron 45.2.1** (Chromium 156.0.8078.75), ruled in [ADR 0013](../../adr/0013-desktop-shell-electron.md),
and both:

- serve every page over a **privileged `app://` scheme** — `standard`, `secure`, `supportFetchAPI`, `corsEnabled` —
  registered before `app.ready`, and never load a page with `loadFile`. A `file://` page cannot be trusted with the
  audio graph: in a system WebView it refuses `audioWorklet.addModule` under a cross-origin rule, and WebKit cannot
  register a service worker at all without a browser entitlement. The scheme is what keeps loading a game from an
  arbitrary path from being what breaks sound;
- register **no service worker**. A desktop application is already offline; the only artefact with a worker is the PWA
  ([offline](#offline));
- provide `platform-services`, an asset source for a folder or a package, and the save-blob host behind AD-17's keys.

**The player's launch resolution** is fixed, in this order, and is the only mechanism:

1. an explicit `--game <path>` argument, or a deep link;
2. a configuration file by convention — `player.json` beside the executable, or, when installed, in the operating
   system's configuration directory for the application;
3. an embedded default project baked in at export;
4. if none of those name a project, the installed-game library.

Handing somebody "the player plus my game" is therefore a pre-configured build or a configuration file, never a
per-game stub. There is **no file association to rely on**: an association is a promise the OS lets a user break and
does not exist in the PWA. A cold start with nothing configured shows the library and says why, never a blank window.

**The editor application** is epic `desktop-shell`'s (`host-desktop`): its own package, its own measurements, its own
signing/notarisation/updater and its own cadence. This page rules only what both applications share — the shell, the
scheme, the absence of a worker and the `platform-services` surface.

<a id="install"></a>
## Install, the library and the descriptor

A game is **data**, not an executable. An export writes a distribution package — a `.tpk`-compatible ZIP with
`manifest.json { schema, main, index }` — plus an **install descriptor**, and installing means **registering the package
with the player**, never wrapping it.

The library is a host-side registry, outside the save store: AD-17's blob keys are untouched. It holds each installed
package's identity (the manifest's `schema` and `main`, and the descriptor's `sha256` and `size`), its path on the
desktop or its OPFS handle on the web, that game's settings, and the **default game**. On the desktop it is a small
versioned JSON file in the application-data directory beside the installed packages; in the PWA it is a `library`
directory and index in OPFS, with Cache Storage left to the app shell under [offline](#offline).

Core stays I/O-free (G2): the application resolves a library entry and hands `core` the package's bytes through the
existing asset source. `core` never knows a registry exists, and an install is not a save.

The descriptor is a **sibling file** the exporter writes next to the package, `<package>.tpk.json`, with
`{ schema, file, sha256, size, gameId, title, version }` — see
[../formats/packaging-and-paths.md#install-descriptor](../formats/packaging-and-paths.md#install-descriptor). The
package's own manifest keeps exactly three fields, because AD-6 refuses any other.

<a id="load-modes"></a>
## Load modes and the threshold

The web player has two load modes. Below a threshold it downloads the whole distribution package once, behind a
progress screen, and keeps it; above it, it streams assets on demand.

The threshold is **measured, not asserted**: it is the uncompressed size of the largest corpus package, rounded up to
the next whole mebibyte, recorded here with the date it was measured. The table starts empty because no sample game
ships a package — "no sample ships a package, so the package numbers have no corpus evidence at all"
([../formats/packaging-and-paths.md](../formats/packaging-and-paths.md)) — and entry 9.9 measures the fetched corpus
before the first number is written.

| Corpus | Largest package | Threshold | Measured |
|---|---|---|---|
| *pending 9.9* | — | — | — |

A package in the cache is keyed by the SHA-256 of its bytes. Per-entry hashes and delta updates are deferred until a
second published package version exists, because they would otherwise amend AD-6 and the manifest contract for a
benefit no artefact can use.

<a id="prefetch"></a>
## Prefetch hints

The **core** computes the deterministic prefetch plan and sends it as tiered hints at the AD-5 seam; a runner only
fetches and decodes ahead. A runner **MUST NOT** parse a board to guess what to prefetch — that duplicates the board
reader in every host.

| Tier | What is in it |
|---|---|
| `now` | the current board's assets and `bkgMusic`, the `.anm` frame sounds of the animations the board uses, and the default bank when a MIDI is in this tier |
| `next` | the music of boards reachable by edge links and literal `send(...)` targets, and the battle background's `music`, `selectSound`, `chooseSound`, `readySound` and `cantDoSound` |
| `always` | the main file's `cursorMoveSound`, `cursorSelectSound` and `cursorCancelSound`, and the default bank |

A hint **never blocks**, **never changes state**, **never appears in a state or draw hash**, and **never earns a reply**.
Core keeps the hint on [audio-media.md#audio-prefetch](audio-media.md#audio-prefetch)'s terms for audio's share; the wire
record is an AD-5 and AD-17 amendment, added by entry 9.8.

<a id="offline"></a>
## The PWA and offline play

The PWA is the web player, and it is the **only artefact this epic ships with a service worker**; the editor PWA is
`host-web`'s and its worker is epic `editor-foundation`'s. Neither desktop application registers one.

The worker caches the app shell, the bundled default bank and the whole-package download, and it updates on the **next
launch** and **never** mid-session. Save blobs go through `saveBlob` / `loadBlob` / `listBlobs` under `GameId`-keyed
paths and the worker never reads a save. The runner **SHOULD** call `navigator.storage.persist()` and **MUST** report an
unpersisted or quota-limited state rather than swallowing it, falling back to streaming for anything it cannot keep. No
background sync, push, accounts or telemetry are added.

<a id="mobile"></a>
## The mobile wrapper

`runner-mobile` is the `runner-web` build inside **Capacitor 8.5.3** and nothing else: it proves one sample game on a
real device or emulator and carries the same asset source and the same AD-17 blob keys, with the Capacitor filesystem
behind them. Store submission, signing, icons, splash screens, deep links and per-platform chrome are out of scope and
belong to a release owner that does not exist yet.

The wrapper **MUST NOT** fork the player: a platform difference is a host service or a policy on this page, never a
second rendering or input path.

<a id="build"></a>
## Build and artefact shape

The browser artefacts are bundled with **esbuild 0.28.2** — the bundler AD-22 names for `host-vscode`, MIT licensed.
Vite **MUST NOT** be installed: it pulls `lightningcss` (MPL-2.0) and would need its own ADR before a first install, and
nothing here needs HMR. See [ADR 0014](../../adr/0014-web-build-and-test-toolchain.md).

The engine worker and the AudioWorklet are **single-file IIFE bundles with no runtime `import()`**. The player page is a
static HTML file plus one bundle, served in development and in the browser tests by a small static server; no framework
and no dev server enters the shipped artefact. The same `tsc -b` output feeds the browser bundle and the headless runner,
which is what "the same core build" in the capability's success check means.

<a id="csp-and-banks"></a>
## CSP and the audio path

The default audio path ships **SF2** banks only, so it instantiates **no WebAssembly** and the shipped CSP needs no
`wasm-unsafe-eval` for it. `script-src 'wasm-unsafe-eval'` is allowed only in a build that can load an SF3 bank or a
user-supplied `.sf2` that is SF3, and the page states which build it is.

The browser lane **MUST** assert that the default path instantiates no WebAssembly, so the allowance can never widen
silently. SF3 support itself is unverified and is not promised by this page.

<a id="conformance-lane"></a>
## Conformance: the schema and the vector kit

A runner proves itself by replaying vectors, not by sharing types. Two artefacts do that:

- **the schema** — `packages/runner-harness/schema/runner-protocol-v1.schema.json`, one JSON Schema for every record
  this page's boundary carries, with fixed keys and `null` for absence (AD-14). A non-TypeScript runner validates its
  messages against it;
- **the vector kit** — `tools/fixtures/runner-protocol/`, a generator with a `--check` mode on the
  `audio-protocol:check` pattern, holding `(bytes, record script) → expected records and pixels` cases. A runner passes
  by replaying them.

The browser lane is **Playwright 1.64.0** (Apache-2.0, Blue Oak Gold), one headless Chromium project, a required `gate`
dependency that runs `pnpm fixtures:fetch` first and serves the fetched `fixtures/` folder over the local static server.
Its licence, and why it is a dev-only tool outside the production-tree scan, are recorded in
[ADR 0014](../../adr/0014-web-build-and-test-toolchain.md). No test reaches the network.

<a id="implementation-status"></a>
## Implementation status

| Section | Delivered by |
|---|---|
| [webgl2-agreement](#webgl2-agreement), [draw-list](#draw-list) | 9.4 |
| [audio](#audio) | 9.5, 9.6 |
| [install](#install), [desktop-shell](#desktop-shell) (player) | 9.10, 9.11 |
| [load-modes](#load-modes), [prefetch](#prefetch), [offline](#offline) | 9.8, 9.9 |
| [mobile](#mobile) | 9.12 |
| [build](#build), [conformance-lane](#conformance-lane), [csp-and-banks](#csp-and-banks) | 9.3 |
| the schema and the vector kit themselves | 9.2 |
| the whole page replayed end to end | 9.14 |
