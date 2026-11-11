# Play a game with the desktop player

This page tells you how to run a game in TK Reawakened's desktop player on your own machine, and how the player decides
which game to open. The instructions are for a built checkout and a packaged game.

## What the desktop player is

The desktop player is a small Electron window that opens a packaged game and runs it through the same persistent core
engine as the browser and headless runner. A game is data: you hand the player a package, either by naming it, by writing
a small configuration file, by shipping it inside the application, or by installing it into the player's library.

| What works | Limits |
|---|---|
| `pnpm desktop:run --game <your.tpk>` opens any packaged game that has its `.tpk.json` descriptor beside it. A macOS launch of a small authored package showed that package's own board on the canvas, with the status reporting a player position. | One observed package, not a claim that every game is playable. |
| Closing the game window ends the game: the window, the player process and the `pnpm desktop:run` command all stop, including on macOS, where an application usually stays open after its last window closes. | — |
| Keyboard movement works in the Electron window: `pnpm desktop:input` sends a trusted right-arrow key event to the running player and the reported position moves one 32-pixel step (`208, 191` → `240, 191` on the authored probe package). | Pointer input (click to walk) is wired but not proven the same way as keys. |
| The window shows the game at the resolution its own main file asks for — 640×480, 800×600, 1024×768 or a custom size. The whole frame fits and is centred on black. | The window starts at 960×720 and can be resized. The picture normally uses whole-number scaling; if 1× cannot fit, it shrinks fractionally to keep the whole frame visible. |
| A board larger than the frame scrolls: the camera follows the player and clamps to the board's edges. A smaller board is centred. | — |
| A save is written to the desktop host's own storage, under the package's canonical game key. | A save does **not** move between hosts yet: the browser and desktop keep separate stores, so a save made in one is not visible to the other. |
| The desktop measurement compares against the committed baseline: `golden/regression/closing.json` expects the `demo` board at tick 120 to be state `ce528fd5b323787f`, draw `225e1b4a09cd7330`, 147 commands. | Those values are from the closing configuration, not an interactive session. |

## Which game it opens

The player resolves its target in one fixed order and never by a file association (an association is a promise the
operating system lets a user break). The first step that names a real file wins.

| Step | What you do | What the player reports |
|---|---|---|
| 1 | Pass `--game <file.tpk>`, or open a `tkr://play?game=<path>` link | `argument` or `deep-link` |
| 2 | Write `player.json` beside the player executable, or in the application-data directory (below) | `config` |
| 3 | Ship a package baked into the application's `resources/` directory as `game.tpk`, with `game.tpk.json` beside it | `baked` |
| 4 | Install a game into the player's library and pick it from the list | `library` |
| — | Nothing is configured and the library is empty | `none`, with a sentence saying what to do |

`player.json` is a small file: `{ "schema": 1, "defaultGame": "game.tpk" }`. A relative `defaultGame` is resolved against
the directory that holds `player.json`; an absolute path is taken as written. A copy beside the executable wins over the
one in the application-data directory, which is what makes a portable "player plus my game" folder work.

The library is a versioned registry, `library.json`, in the application-data directory beside the saves. Each entry
records the package's path, its `sha256`, its size and the game's settings. The player verifies the hash and the size
before it opens an entry, so a package swapped on disk is refused with a message naming both values instead of launching
whatever is there now.

## Where the two files live

| Platform | Application-data directory |
|---|---|
| macOS | `~/Library/Application Support/TK Reawakened/` |
| Windows | `%APPDATA%\TK Reawakened\` |
| Linux | `~/.config/TK Reawakened/` |

`player.json` and `library.json` sit there. Saves and file blobs sit under `saves/` and `files/` in the same directory.

## How the picture is sized

The game's main file names the resolution the engine draws. The player fits the whole frame into the available window
space and centres it on black. It uses the largest whole-number scale that fits (`1×`, `2×`, `3×` …), keeping pixels
crisp. If the frame is too large even at `1×`, it scales down fractionally instead, preserving the proportions and
showing every edge. Resizing the window recomputes the fit. A board wider than the frame scrolls with the player; a
smaller board sits centred on its own background.

## Where saves live

A save is durable on the host that wrote it, filed under the key every runner derives from the package:
`derivePackageIdentity(sorted files)` folded with the main file's bytes. The desktop host stores it as files under
Electron's user data directory (`saves/<gameId>/…`); the browser page stores it in that origin's `localStorage` under
`tkr:saves:<gameId>:…`.

The two stores are separate by construction. The shared key means two hosts agree *which game* a save belongs to; it does
not let one read the other's files. Moving a save between the browser and desktop players needs an export/import path or
a shared blob service, and neither exists yet.

## What you need

- **git** — to get the source.
- **Node.js** — use the project-pinned version.
- **pnpm** — use the version provided by Corepack and the lockfile.
- **Network access** — sample games are downloaded on demand, not shipped in the repository.

## Run it

Run these from the repository root, in order.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm fixtures:fetch
pnpm make-package fixtures/legacy/demo --closing-plan golden/closing/plan.json --game demo --out fixtures/packages/demo.tpk --title Demo
pnpm desktop:build
```

Then run a measurement or open a visible player window:

```sh
pnpm desktop:measure
pnpm desktop:input --game fixtures/packages/demo.tpk
pnpm desktop:run --game fixtures/packages/demo.tpk
```

The rebuilt demo package names the stock menu and battle systems. Once the title screens have finished and the player is
on the board, press **Enter** to open the menu and **Escape** to close it. Rebuild both the package and the player after
updating: an older package made from the sample may not name the stock systems.

`pnpm desktop:input` opens the player, sends real key events through Chromium's debugging protocol, and prints the player
position before and after — it exits non-zero when the key did not move the player.

`pnpm desktop:measure` emits machine-readable closing-suite and renderer evidence and closes its window. It compares the
`demo` tick-120 result against the committed closing baseline in `golden/regression/closing.json` and fails when the frame
or the hashes differ; it never reads the numbers quoted on this page. The committed macOS report
`tools/desktop/measurements/macos.json` is a historical artefact of the date its `measuredAt` field records
(2026-11-01); it predates later baseline re-records and does not describe what a measurement reports on `main` today.

### The five cold-start cases

`pnpm desktop:measure --case <name>` lays out the directories one launch step reads and then launches the player:

```sh
pnpm desktop:measure --case argument       # --game names the package
pnpm desktop:measure --case player-json    # player.json in a temporary application-data directory
pnpm desktop:measure --case baked          # resources/game.tpk in a temporary resources directory
pnpm desktop:measure --case library        # library.json with the demo package installed
pnpm desktop:measure --case library-empty  # nothing configured: the player states why and opens nothing
```

Each case gets its own `--user-data-dir`, so nothing leaks between them. The record it writes names the launch step that
resolved (`resolvedBy`), the entry it picked when a library offered one (`picked`), and the four measurements — WebGL2
present, the worst blend-arithmetic channel delta, the audio length, and the package resolving from disk. The four
game-opening cases must also agree with the committed baseline; the empty case must print the stated reason and exit 0.
The CI `desktop` job runs all five on macOS, Linux and Windows and uploads one record per case.

## The closing suite

One command plays every sample game in every host and compares the results with the committed baseline:

```sh
pnpm closing:suite
```

It runs the headless suite, then the same suite in headless Chromium, then the same suite inside the built Electron
player, and prints a verdict per part. Each host boots all eight games in `golden/closing/plan.json` — the two that play
and the six Toolkit 2 games that still stop with a recorded diagnostic — at all three tick batchings, and compares every
frame's state, draw, pixel and command hash with `golden/regression/closing.json`. The demo is also opened from its
packaged `.tpk` in the browser page and in the player, so the packaged single-file load is covered in both.

A part that fails does not stop the others; the command exits non-zero and names which part did. `--skip=browser` (or
`--skip=node`, `--skip=desktop`) runs the rest.

## Open the window yourself

A macOS launch showed the room on the attached canvas, with the title/menu text still overlaid. The status showed a
player position. The browser interaction test, rather than that desktop observation, proves the right-arrow movement
described above.

`pnpm desktop:run` builds the `demo` package for you when you pass no `--game`, and passes the player's other flags
through unchanged (`--serve <dir>`, `--page <path>`, `--devtools`, `--report <file>`). Close the window to quit: the game
does not keep running in the background, and the command you started exits with it.

## Deep links

`tkr://play?game=<path>` is the first launch step's other half. A packaged player registers itself as the scheme's
handler, so a link opens the game even when the player is already running. **This is only proven where the operating
system delivers the link as a command-line argument** (Linux and Windows). macOS delivers it through its own event, which
needs a signed application bundle; no such bundle exists yet, so that path is wired and parser-tested but not observed on
a real machine. Naming the game with `--game` works everywhere today.

## Operating-system notes

- **macOS** — use a running desktop session to see the window.
- **Linux** — on a machine without a display, run the measurement headlessly with `xvfb-run -a pnpm desktop:measure`; a
  visible window needs a desktop session.
- **Windows** — package paths use backslashes (`fixtures\packages\demo.tpk`). `pnpm desktop:run` handles the Electron
  binary path for you.

## Two things that can trip you up

- **Electron's download.** On a fresh checkout, `pnpm install` can return before Electron's runtime has finished
  downloading. If the first `desktop:measure` fails with `ENOENT …/Electron`, allow the download to finish and rerun it.
- **The sample game.** Package creation and measurement need sample games, which `pnpm fixtures:fetch` downloads. If you
  skip that step, there is no package to open.

## What is out of scope here

- **The Launcher UI, marketplace and local-file picking.** The player lists installed games and opens the one you pick;
  the full launcher with tabs, cards and a marketplace is a later epic, and it replaces that list.
- **Export.** The pipeline that bakes a package into an application's `resources/` and writes a shipped `player.json` is
  not built here; the player only reads that slot.
- **Mobile / Android** — the mobile wrapper is proven by its own CI lane and is not claimed here.

## References

- The player's rules and its launch order: `docs/spec/engine/runners.md` ("The desktop applications", "Install, the
  library and the descriptor").
- The launcher contract the fallback list feeds: `docs/spec/engine/launcher.md`.
- The decision that made Electron the shell: `docs/adr/0013-desktop-shell-electron.md`.
- The entries that built this: 9.11 (the desktop package) and 9.10 (launch resolution and the library) in
  `_bmad-output/initiative-rpgtoolkit-reawakened/epic-web-runner-packaging/tickets.toml`.
