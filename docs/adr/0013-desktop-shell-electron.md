# ADR 0013 — The desktop shell is Electron; two applications from one codebase

* **Status:** Accepted (2026-10-31)
* **Date:** 2026-10-31
* **Amends:** [guardrails.md](../guardrails.md) G6 (the dev-only inventory gains two shipped binaries); [architecture-options.md](../architecture-options.md) §8 (the desktop-shell paragraph); ADR [0001](0001-typescript-core.md) decision 6 (the shell is no longer deferred)
* **Guard-rail exception:** `guardrail-exception: G6 ADR-0013` — one inventory, two binaries: the **player** and the **editor**
* **Context documents:** [spec/engine/runners.md](../spec/engine/runners.md), [spec/formats/packaging-and-paths.md](../spec/formats/packaging-and-paths.md), [epic 9's ruling draft](../../_bmad-output/initiative-rpgtoolkit-reawakened/epic-web-runner-packaging/story-rulings-the-runner-boundary-the-desktop-shell-image-storage-plan.md)

## Summary

In plain terms:

1. **Our desktop applications run on Electron.** The game player and the game editor are each their own application, built from the same code, and both use the same Electron shell. That means everyone gets the same browser engine on macOS, Windows and Linux — the engine our web player already claims.
2. **A game is data.** The player is installed once; a game arrives as a package, is registered in the player's library, and is opened from there. No game carries its own copy of the engine.
3. **One licence exception covers both applications.** Electron is MIT, but the Electron binary embeds a browser whose licence inventory includes two licences our gate blocks. Rather than hide that, this ADR records it once for both binaries and adds a check that reads the inventory from each built artefact.

## Context

[architecture-options.md](../architecture-options.md) §8 left the desktop shell open and asked for a three-way spike (Tauri, Electron, Electrobun) on the game runner and the board editor, with Linux WebKitGTK named as the risk. ADR 0001 decision 6 deferred the choice and called it reversible through `platform-services`.

The owner ruled the shell and the product shape on 2026-10-31: the harness is separate from the game bundle, so a shell is installed once rather than copied into every export; and there are **two desktop applications from one codebase** — a **player** and an **editor** — plus the PWA. That ruling is recorded in epic 9's entry 9.1 and the ruling text is D-1 in that plan.

**Measured on 2026-10-31** (macOS 27.0.1, Apple M1 Pro), Electron 44.7.0 against a WKWebView host, because the question "does the shell change what a game looks and sounds like?" is answerable before a three-OS build exists:

| Measurement | Electron 44.7.0 | WKWebView host |
|---|---|---|
| WebGL2 | present, 16,384 max texture | present, 16,384 max texture |
| Only extension difference | `EXT_disjoint_timer_query_webgl2` (Chromium-only) | — |
| The AD-3 CPU blend `(dst·(255−a) + c·a + 127)/255` | **exact — worst delta 0 across 1,536 channel comparisons** | **exact, same** |
| Real `spessasynth_processor.min.js` (4.4.2, 580 KB), no SoundFont | loads and instantiates | loads and instantiates |
| Download, macOS arm64 / Windows x64 | 130,394,296 B / 158,293,649 B | — |
| Extracted on disk (macOS) | 312 MB, of which `Electron.app` 293 MB | — |
| Summed RSS, page with a WebGL2 context and an AudioWorklet | 429,168 KB | — |
| Spawn to first WebGL2 frame | 1,066.9 ms | 439–464 ms |

**Electron shows no rendering advantage on macOS.** The choice below does not rest on observed superiority; it rests on **engine parity with the browser we already claim**. A single Chromium means one replayer can be proved once, on the engine the PWA ships and the engine inside Electron, instead of four engines (Chromium, WKWebView, WebView2, WebKitGTK) on which the same draw list would have to be proven.

**Two findings on `file://`, measured the same day.** In WKWebView a `file://` page refuses `audioWorklet.addModule(blob:)` — "Cross-origin script load denied by Cross-Origin Resource Sharing policy" — while the same page in Electron loads it; and WKWebView cannot register a service worker at all without Apple's `com.apple.developer.web-browser` entitlement (WebKit bug **206741**, open, filed 2020-01-24). The second does not bind us (no desktop application ships a worker), the first does: it is why decision 3 below requires a secure scheme rather than `file://`.

## Decision

1. **Electron 45.2.1 (Chromium 156.0.8078.75) is the desktop shell**, and it is the same shell for both applications. The 44.7.0 measured above is one Chromium major behind Chrome stable 156.0.8078.80, so the pin moves forward with this decision; the measurements are re-taken on 45.2.1 when entry 9.11 first builds it.
2. **Two applications, one codebase.** The **player** (`runner-desktop`) is a distribution artefact: it carries no editor code and no editor chrome. The **editor** (`host-desktop`) is its own package and application, with its own `platform-services` instantiation, the harness embedded for preview, and its own signing, notarisation, updater and release cadence. The player is not a stripped editor; the editor is not a mode of the player. Each is installed once.
3. **A privileged `app://` scheme, no service worker.** Both applications serve their own pages over a scheme registered as `standard`, `secure`, `supportFetchAPI` and `corsEnabled`, before `app.ready`, and never load a page with `loadFile`. Both register no service worker. The PWA is the only artefact with one.
4. **The player's launch resolution is fixed:** an explicit `--game` argument or a deep link; then `player.json` beside the executable or in the OS configuration directory; then an embedded default baked in at export; then the installed-game library. No per-game stub and no file association: handing somebody "the player plus my game" is a pre-configured build or a configuration file.
5. **A game is a package.** An export writes a distribution package plus an install descriptor; installing registers it with the player. The player keeps a versioned library registry outside the save store, with the default game. Core stays I/O-free: the application resolves a library entry and hands the core bytes through the existing asset source.
6. **The maintenance line.** Electron ships a major every 8 weeks and supports the latest three. This ADR is amended whenever the pin falls more than one major behind Chrome stable, and both applications take a bump together from the same amendment so the two binaries never drift.
7. **One G6 exception, two binaries.** See below.

## The G6 exception

`electron` is MIT and the npm package is a build-time dev dependency, but that sentence does not cover the artefact we ship. The **Electron 44.7.0 macOS bundle** (the version measured) carries `LICENSES.chromium.html` (**20,115,518 bytes**) whose per-product blocks place **ffmpeg under LGPL-2.1-or-later** and **`symphonia-core` under MPL-2.0**, and it ships `libffmpeg.dylib` (**2,317,968 bytes**). G6 rule 2 blocks both licences, and G6 rule 1 names "desktop and mobile builds" explicitly.

The deviation is therefore **recorded, not described away**:

* this ADR is the exception, and its line above carries the marker `guardrail-exception: G6 ADR-0013`;
* the marker also goes **inline in the Electron main-process entry point** that entry 9.11 writes, as the guard-rails' Exceptions section requires, so a reader of the code sees which rule and which ADR allow it;
* **one inventory covers both binaries**: the player's built artefact and the editor's are read from the same Electron version, so a second exception is never needed for the second application (the editor's line is completed when epic `desktop-shell` first builds it);
* a CI check lists each built artefact's `LICENSES.chromium.html` and `libffmpeg*` with their licences, and **any Electron major that changes that inventory re-opens this exception**;
* the PWA needs no exception: it ships no browser engine.

## Consequences

* **What improves.** One engine for both applications and the PWA: one replayer, one agreement-bound check, one audio path, and no system-WebView variance to prove.
* **What it costs, stated plainly.** Two signing, notarisation and updater pipelines and two release cadences, because the player goes to people who never author and must not carry an editor's size or update churn; and roughly 293 MB of shell per installed application — paid **once per installation**, not once per game, and twice for a user who installs both.
* **What it does not cost.** No game carries an engine copy; `runner-web` is unchanged between the three artefacts; `platform-services` keeps the editor host-agnostic; and a divergence is raised as a new ADR that supersedes this one, never as a second shell.
* **Browser floor.** The runner claims Chromium, i.e. Electron 45.2.1's Chrome 156. No system-WebView leg is claimed or measured while no system-WebView application ships.

## Alternatives rejected

* **One application that is both editor and player.** Withdrawn by the owner on 2026-10-31. It is the cheaper build and one update pipeline, but it puts an editor's size and release churn on people who will never author.
* **Tauri** (the named fallback). Smaller download and no licence exception, but it turns the desktop leg into three engines — WKWebView, WebView2, WebKitGTK — against the one Chromium the web player claims, so the same draw list would have to be proven on four engines instead of two. **It takes over if any of these holds:** this exception is refused for either binary; the player fails one of its four measurements on any of the three operating systems; the owner rules a ~124 MiB macOS / ~151 MiB Windows download unacceptable for the audience; or the eight-week major cadence cannot be staffed.
* **Electrobun.** Its default is the same system webview as Tauri (no gain), its CEF option is 147,695,098 B for `darwin-arm64` (worse than Electron), its official Linux tier is Ubuntu 24.04+ only, and its packaged Bun statically links JavaScriptCore under **LGPL-2**, an obligation its MIT licence file does not mention.
* **Wails v3, NW.js.** A third language, and a licence-free 0.x line that hands page JavaScript full Node privilege with no updater.
* **Per-game bundled executables; a per-game system-WebView stub; file association as the distribution mechanism.** All three withdrawn by the owner on 2026-10-31: the shell is installed once and the game is data, and the single-project case is configuration, not packaging.
