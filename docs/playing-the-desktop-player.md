# Play a game with the desktop player

This page tells you how to run a game in TK Reawakened's desktop player, right now, on your own machine. It is written from the commands actually run on a clean checkout, so every command below has been tested.

## What the desktop player is

The desktop player is a small desktop window that opens a packaged game and runs it through the same engine as the browser and the headless test runner. It is built on Electron, the same technology behind apps like Slack and VS Code.

What the player can do **today** is narrower than what it will do:

| Works today | Does not work yet |
|---|---|
| Open a packaged game from disk | Play interactively — there is no input loop yet |
| Boot the game to the board and verify the state and drawing match the committed reference, pixel for pixel | Show a visible, animated board — the board is drawn and checked off-screen, so the window stays black |
| Write a save and read it back under the game's key | Resume or list real in-game saves from the menu |
| Report a machine-readable measurement (`error`, `tick`, the two hashes, the pixel difference) | Anything on mobile or Android |

The missing row — turning this into an interactive, animated game you can sit down and play — is the project's next step: the live player page in the web-runner-packaging epic (entry 16, #1018). Until that lands, "run the desktop player" means: watch it open a game, reach the board, and report that it rendered correctly. Think of it as a smoke test for now.

## What you need

- **git** — to get the source.
- **Node.js** — version 24.21.0 is the one the project pins and tests. A newer version will probably work (it was tested with Node 26), but 24.21.0 is the safe choice.
- **pnpm** — version 12.10.1, which `corepack enable` picks up automatically.
- **Network access** — the sample games are downloaded on demand, not shipped in the repository.

## Run it

Run these from the repository root, in order.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm fixtures:fetch
pnpm make-package fixtures/legacy/demo --closing-plan golden/closing/plan.json --game demo --out fixtures/packages/demo.tpk --title Demo
pnpm desktop:build
pnpm desktop:measure
```

What each step does, and what you should see:

| Command | What it does | Expected result |
|---|---|---|
| `pnpm install --frozen-lockfile` | Installs the dependencies from the committed lockfile. | A few seconds, then the prompt returns. |
| `pnpm build` | Compiles the TypeScript. | The prompt returns with no errors. |
| `pnpm fixtures:fetch` | Downloads the sample games. | Prints one line per game and ends with `fetched`. |
| `pnpm make-package …` | Turns the `demo` sample into one `.tpk` package plus a descriptor. | Prints `fixtures/packages/demo.tpk: 623286 bytes, 77 files` and a `demo.tpk.json` line. |
| `pnpm desktop:build` | Builds the player's main process, its bridge, and its page. | Prints `built runner-desktop: dist/main.js, dist/preload.js, apps/player-desktop.js (9 bundled assets listed)`. |
| `pnpm desktop:measure` | Launches the player, opens the package, runs it to the board, and prints the measurement. | A JSON report (below). |

The report contains these key lines that prove it worked (`error` is first, and a `save` block follows `frame`):

```json
"error": null,
"tick": 120,
"stateHash": "bff947dce3a11b4f",
"drawHash": "9a40be8a0b5ca816",
"commands": 128,
"frame": { "worst": 0, "width": 640, "height": 480 }
```

- `"error": null` — the player opened the game with no error.
- `"tick": 120` and the two hashes — the game reached the board, and its state and drawing match the committed reference values exactly.
- `"frame": { "worst": 0 }` — the picture it drew differs from the reference by zero, pixel for pixel.

## Open the window yourself

`pnpm desktop:measure` opens the player, measures it, and closes it. To open the window and leave it open, run the player:

```sh
pnpm desktop:run --package fixtures/packages/demo.tpk
```

A window opens, and its title changes to `desktop: bff947dce3a11b4f`. That title is the sign the game booted to the board and reached a stable state (`desktop: ${error ?? stateHash}` in the player page); pixel-for-pixel drawing correctness is shown by `frame.worst` in the measurement report, not by the title. As noted above, the board itself is drawn off-screen for now, so the window body stays black until the live player page lands (web-runner-packaging entry 16, #1018).

`pnpm desktop:run` builds the `demo` package for you when you leave `--package` off, and passes the player's other flags through unchanged (`--serve <dir>`, `--page <path>`, `--devtools`, `--quit-after`, `--report <file>`).

## Operating-system notes

- **macOS** — works as written.
- **Linux** — the same commands work. A machine with no display (a server or a CI runner) runs the measurement headlessly with `xvfb-run -a pnpm desktop:measure`. To open the visible window you need a running desktop session.
- **Windows** — the same `pnpm` commands work in PowerShell; package paths use backslashes (`fixtures\packages\demo.tpk`). `pnpm desktop:run` handles the Electron binary path for you.

## Two things that can trip you up

- **Electron's download.** On a fresh checkout, `pnpm install` can return before Electron's roughly 100 MB runtime has finished downloading in the background. If the first `desktop:measure` fails with `ENOENT …/Electron`, wait a moment and run it again.
- **The sample game.** `pnpm make-package` and `pnpm desktop:measure` need the sample games, which `pnpm fixtures:fetch` downloaded in the earlier step. If you skip that step, the package has nothing to build from.

## What is out of scope here

- **Playing interactively** — not here yet (the live player page, web-runner-packaging entry 16, #1018).
- **Mobile / Android** — a separate wrapper, not part of this page.

## References

- The desktop player's own description and rules: `docs/spec/engine/runners.md` ("The desktop applications", "Install, the library and the descriptor").
- The decision that made Electron the shell: `docs/adr/0013-desktop-shell-electron.md`.
- The task that built the player's desktop package: entry 11 of `_bmad-output/initiative-rpgtoolkit-reawakened/epic-web-runner-packaging/tickets.toml`.
