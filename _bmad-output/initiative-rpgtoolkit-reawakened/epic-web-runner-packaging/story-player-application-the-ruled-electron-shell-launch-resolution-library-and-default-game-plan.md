---
title: 'Player application: the ruled Electron shell, launch resolution, library and default game'
type: feature
ticket: 10
created: '2026-11-10'
status: in-progress
tracker_id: "#936"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/936"
baseline_revision: 'ba739779'
risk: high
route: full
route_source: auto
review: quick
ticket_note: 'plan checkpoint — this page is the plan presented for owner approval before code; the ruling that scopes it is recorded in tickets.toml entry 10 and in the epic envelope note dated 2026-11-10'
context:
  - 'docs/spec/engine/runners.md#desktop-shell and #install (the launch order, the library, the descriptor)'
  - 'docs/spec/engine/launcher.md#launch-resolution, #standalone-distribution, #storage-and-registry, #runner-handoff'
  - 'docs/adr/0013-desktop-shell-electron.md, decisions 3 to 5 and the G6 exception'
  - 'entry 9.11 and its plan: packages/runner-desktop, tools/desktop/*, docs/playing-the-desktop-player.md'
---

# Player application: the ruled Electron shell, launch resolution, library and default game

## Intent

**Problem:** `runner-desktop` is a shell with one way in. `src/main.ts:59` reads a single `--package <file.tpk>`
argument, and `bootPlayerPage` throws `no package was named on the command line` when it is absent
(`packages/runner-web/src/player-page.ts`). There is no `--game`, no deep link, no `player.json`, no baked default and no
library, so the player application entry 9.10 promises does not exist: a person who double-clicks the player with
nothing configured gets a crash, not a window that says why.

**Approach:** Build the ruled resolution order in the main process as one tested pure function, add the
`library.schema = 1` registry beside the saves, and prove all of it by re-running the measurement that entry 9.11
already owns. The shell, the scheme, the preload bridge, the four measurements, the live page and the three-OS CI lane
all exist, so this entry adds a resolver, a registry, two views and the proof, not a second player.

## Boundaries & Constraints

**Always:**

- Follow the order in `docs/spec/engine/runners.md#install` exactly and in one place: `--game` or the `tkr://play` deep
  link, then `player.json`, then the baked default, then the library. No other path may name a game.
- Keep `core` I/O-free (G2): the application resolves bytes and hands them to the page through the existing
  `openPackage`-shaped bridge; no core type learns a registry exists.
- Follow `library.schema = 1` from `docs/spec/engine/launcher.md#storage-and-registry` field for field, so epic 25's
  entries extend one document instead of inventing a second.
- Verify `sha256` and `size` against the descriptor before a library entry is launched or registered, and refuse with a
  diagnostic that names the mismatch.
- Give every failure a stated reason on screen: an empty library, a missing `player.json`, a corrupt package.

**Never:**

- Add an exporter or bake anything at build time — that is 25.6's. This entry reads the slot and proves the read with a
  harness-baked package.
- Build the Launcher UI (tabs, cards, marketplace, drag-and-drop) — that is 25.4 and 25.2's. The step-4 fallback here is
  a plain listing and a sentence, which 25.4 replaces.
- Add a second player page, renderer, input path or asset source. Every case reuses `bootPlayerPage` / the live page.
- Add a file association, a per-game stub, or a self-running executable (D-1).
- Change `packages/core`, a golden, or a spec page's existing ruling without stopping and asking.

## I/O & Edge-Case Matrix

| Scenario | Input / state | Expected behaviour |
|---|---|---|
| Argument wins | `--game a.tpk` plus a valid `player.json` naming `b.tpk` | Opens `a.tpk`; the report records `step: "argument"`. |
| Deep link | `tkr://play?game=/abs/a.tpk` as argv (Linux/Windows) or an `open-url` event (macOS) | Same target as `--game`; an unparsable link falls through to the next step, never crashes. |
| Config file | No argument, `player.json { "defaultGame": "game.tpk" }` beside the executable | Opens the sibling file; a relative `defaultGame` resolves against `player.json`'s own directory. |
| Config file, installed | No argument, no portable file, `player.json` in the application-data directory | Resolves from there; the portable location wins when both exist. |
| Baked default | No argument or config, `resources/game.tpk` present | Opens it; the report records `step: "baked"` and the four measurements. |
| Library | No argument, config or baked package; `library.json` has the demo registered | The page lists the entry, the person's pick opens it, and the four measurements are reported for that entry. |
| Empty library | Nothing configured, `library.json` absent or empty | Window shows the reason (“no game chosen: pass `--game`, write `player.json`, or install a package”) and the empty list; never blank, never a crash. |
| Integrity | Library entry whose bytes do not match `sha256`/`size` | Refused with the expected and actual values; the game does not open. |
| Corrupt config | `player.json` invalid JSON or a missing `defaultGame` | Ignored with a diagnostic naming the file, and resolution continues to the next step. |
| Escape attempt | `defaultGame: "../../etc/passwd"` or a library `packageLocation` outside the data directory | Refused; path resolution stays inside the file's directory or the library root. |

## Code Map

- `packages/runner-desktop/src/main.ts` — `serveRoot`, `packageArgument`, `registerIpc`. Gains the resolver call, the
  deep-link registration, `--game` (replacing `--package`), `--resources` and `--user-data-dir` seams, and a
  `desktop:launch` handler returning either a resolved target or the library result.
- `packages/runner-desktop/src/preload.ts` — `DesktopHost.openPackage` becomes `launch()`; the type of the library
  result is added. Four calls become six (`launch`, `readBlob`, `writeBlob`, `listBlobs`, `report`, `quit`).
- `packages/runner-desktop/app/player-live.ts` — the interactive page. Handles `{ step: "library" }` by rendering the
  listing and the reason, and boots a session when an entry is picked.
- `packages/runner-desktop/app/player.ts` + `app/player-measure.html` — the measurement page. Reports the resolution
  step beside the four measurements it already reports (`webgl2`, `blendWorst`, `audio.lengthTicks`, package name and
  size, `frame.worst`).
- `packages/runner-web/src/player-page.ts` — `bootPlayerPage` takes the richer launch result. No rendering change.
- New: `packages/runner-desktop/src/launch.ts` (pure resolver), `src/library.ts` (registry read/write/validate/verify),
  `test/launch.test.ts`, `test/library.test.ts`.
- `tools/desktop/{run,measure,probe-input}.mjs` — `--package` becomes `--game`; `measure.mjs` gains
  `--case argument|player-json|baked|library|library-empty` and sets up each case's directory layout.
- `.github/workflows/ci.yml` — the `desktop` job runs the five cases on its existing `ubuntu-24.04` / `macos-15` /
  `windows-2022` matrix; the `browser` job gains `node tools/desktop/build.mjs` and the parity spec.
- New: `tools/browser/tests/desktop-parity.spec.ts`.
- `docs/playing-the-desktop-player.md` — rewritten for the four steps, the two files, and the new flag.

## Decisions taken here

1. **`--game` is the flag; `--package` is deleted.** The spec names `--game <path>` as the only argument mechanism
   (`runners.md:293`), and the dev tools pass it through. No alias remains (this is the same clean cutover the entry's
   own description implies). The measurement harness keeps its own `--report`, `--serve`, `--page` and adds
   `--resources` and `--user-data-dir`, all documented as harness seams in `main.ts`'s header comment.
2. **`player.json` is `{ "schema": 1, "defaultGame": <path> }`** — the shape `launcher.md#standalone-distribution`
   already writes — and `defaultGame` resolves against the file's own directory. Search order: beside the executable
   first (portable), then `app.getPath("appData")/<product>/player.json`, where `<product>` is the same application name
   the library directory uses (settled once in step 3, not invented per call site). A one-sentence spec amendment to
   `runners.md#install` lands first, in its own commit, because the base directory was unstated (G7).
3. **The library lives at `app.getPath("userData")/library.json`.** On macOS that is
   `~/Library/Application Support/<product>/library.json`, which is the application-data directory the two spec pages
   name; on Windows `%APPDATA%\<product>\library.json`; on Linux `~/.config/<product>/library.json`.
4. **Hash once at registration, verify size before every launch.** `sha256` of a 33 MB package is ~100 ms, and the
   registry must be able to refuse a swapped file; re-hashing on every open would add that cost to every launch, so the
   launch check compares `size` (cheap, catches truncation and replacement) and the registration check hashes. Recorded
   as a deviation so a later entry can decide otherwise.
5. **Deep links are delivered by the OS and tested at the seam.** macOS needs a signed bundle to route `open-url`; CI
   cannot synthesise that. The parser and the resolution order are unit-tested, Linux and Windows observe a real
   `second-instance` argument in the desktop lane, and the macOS gap is stated in the plan and the docs rather than
   papered over.
6. **The PWA-vs-player parity check is a Playwright `_electron` test in the browser lane**, because that lane already
   owns Playwright and its static server, and `_electron.launch` is the only supported way to drive the built player
   from a test. It runs under `xvfb-run -a`. If `_electron` cannot attach to Electron 45.2.1, the fallback is to open
   the PWA bundle over `http://127.0.0.1` inside the desktop lane's Electron and compare there — the same engine family
   and the same two builds — and the substitution is recorded in the plan and the PR.
7. **The four measurements are re-used, not rebuilt.** `bootPlayerPage` already reports WebGL2 presence, the worst
   D-7 channel delta, the audio length and the package from disk; the cold-start cases differ only in where the bytes
   came from, so each case runs the same page with a different launch setup.

## Steps

1. **Docs first (own commit, no code).** Amend `docs/spec/engine/runners.md#install` with the `player.json` base
   directory and the concrete library filename, citing ADR 0007. If `launcher.md#storage-and-registry` needs the same
   sentence, amend it in the same commit.
2. **Resolver.** `src/launch.ts`: `resolveLaunchTarget(input)` returning
   `{ step: "argument" | "deep-link" | "config" | "baked" | "library" | "none", path?, entries?, reason? }`, with the file
   reads injected. Unit tests cover every precedence pair, the edge cases in the matrix above, and the path-escape
   refusals. Each test runs in milliseconds.
3. **Registry.** `src/library.ts`: parse and validate `library.schema = 1`, `registerPackage`, `setDefaultGame`,
   `verifyEntry`, with `node:crypto`'s `createHash`. Unit tests use a temp directory, a two-file package fixture and a
   corrupted copy.
4. **Wire the main process.** Rename the argument, register `tkr` as the protocol client, handle `open-url` and
   `second-instance`, resolve `resources` and the data directory, replace `desktop:package` with `desktop:launch`, and
   keep the existing blob, report and quit handlers untouched.
5. **The two views.** The live page renders the library listing and the stated reason for `step: "library" | "none"`,
   and opens a picked entry through the same session path it already uses. The measurement page reports the step.
6. **The five CI cases.** Extend `tools/desktop/measure.mjs` with `--case` and the directory setup each case needs
   (portable `player.json`, `resources/`, a seeded `library.json`, an empty one), assert the step in the report, and wire
   the five runs into the `desktop` job's matrix. The job keeps failing on a baseline mismatch; the per-OS records stay
   the artefact.
7. **Parity.** `tools/browser/tests/desktop-parity.spec.ts`: capture the demo board at tick 120 from the PWA build in
   Chromium and from the built player through `_electron`, decode both to RGBA, assert the worst per-channel delta is
   within the D-7 bound, and print the worst delta and its channel.
8. **Docs and changelog.** Rewrite `docs/playing-the-desktop-player.md` in plain language: what each of the four steps
   means, where `player.json` and `library.json` live on each OS, what the window says when nothing is chosen, and the
   deep-link limitation. Add the CHANGELOG entry.
9. **Gates and PR.** `pnpm checks`, `pnpm golden`, `pnpm golden:bun`, `pnpm browser:test`,
   `pnpm desktop:measure:test`, and the five `desktop:measure` cases locally (macOS). PR cites `Fixes #936` and names the
   two epic 25 entries it leaves untouched.

## Verification

- Unit: `pnpm vitest run` scoped to `packages/runner-desktop/test/launch.test.ts` and `library.test.ts`; each test under
  one second, asserted by reading the reported duration.
- Local: each of the five `--case` runs on macOS reports its `step` plus the four measurements, and the
  `library-empty` case prints the stated reason with no exception in the log.
- CI: the `desktop` job's three runners upload five records each, and the parity spec prints its worst channel delta.
- Cold-start observation is the uploaded record, never a hand-written number; the record names the step that resolved.
- Failed verification is not softened: if a case cannot pass on a runner, the PR states which and why rather than
  dropping the case.

## What this entry does not include

- The Launcher UI, marketplace, local-file ingestion and save-resume actions (25.2, 25.3, 25.4).
- The export pipeline that writes `resources/game.tpk`, its descriptor and the shipped `player.json` (25.6), and the
  web and mobile launch limbs plus the cross-host conformance suite (25.5).
- Signing, notarisation, installers and updaters; store accounts (the epic's accepted risk).
- Moving saves between the browser and desktop players (no seam exists; `docs/playing-the-desktop-player.md` says so).
- The editor application (`host-desktop`, epic desktop-shell).
