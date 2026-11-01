# Play a game with the desktop player

This page tells you how to run a game in TK Reawakened's desktop player on your own machine. The instructions are for a built checkout and a packaged game.

## What the desktop player is

The desktop player is a small Electron window that opens a packaged game and runs it through the same persistent core engine as the browser and headless runner.

| What works | Limits |
|---|---|
| `pnpm desktop:run --package <your.tpk>` opens any packaged game that has its `.tpk.json` descriptor beside it. A macOS launch of a small authored package showed that package's own board on the canvas, with the status reporting a player position. | This is one observed package, not a claim that every game is playable. |
| In the browser's interactive demo test, a real right-arrow key moved the player one 32-pixel step and changed the canvas image. | Pointer input and desktop keyboard movement have not been verified end-to-end. |
| A save is written to the desktop host's own storage, under the package's canonical game key. | A save does **not** move between hosts yet: the browser and desktop keep separate stores, so a save made in one is not visible to the other. |
| A rebuilt desktop measurement reports demo tick-120 state `91172695de52cfd6`, draw `9a40be8a0b5ca816` and frame worst 0. | Those values are from the closing configuration, not an interactive session. |

Mobile is not included: the mobile wrapper does not exist yet.

## Where saves live

A save is durable on the host that wrote it, filed under the key every runner derives from the package: `derivePackageIdentity(sorted files)` folded with the main file's bytes. The desktop host stores it as files under Electron's user data directory (`<userData>/saves/<gameId>/…`); the browser page stores it in that origin's `localStorage` under `tkr:saves:<gameId>:…`.

The two stores are separate by construction. The shared key means two hosts agree *which game* a save belongs to; it does not let one read the other's files. Moving a save between the browser and desktop players needs an export/import path or a shared blob service, and neither exists yet.

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

Then run the measurement or open a visible player window:

```sh
pnpm desktop:measure
pnpm desktop:run --package fixtures/packages/demo.tpk
```

`pnpm desktop:measure` emits machine-readable closing-suite and renderer evidence and closes its window. On macOS arm64, after `pnpm desktop:build`, it reported state `91172695de52cfd6`, draw `9a40be8a0b5ca816` and frame worst 0. Rebuild after source changes: the measurement runs the existing desktop build.

## Measurement report

The measured closing-suite report for `demo` at tick 120 contains:

```json
"tick": 120,
"stateHash": "91172695de52cfd6",
"drawHash": "9a40be8a0b5ca816",
```

Those hashes describe the closing harness configuration, which has no interactive bindings or input/movement owners; they are not hashes for an interactive play session. The visible live session is separate and has its own state as input is received.

## Open the window yourself

A macOS launch showed the room on the attached canvas, with the title/menu text still overlaid. The status showed a player position. The browser interaction test, rather than that desktop observation, proves the right-arrow movement described above.

`pnpm desktop:run` builds the `demo` package for you when you leave `--package` off, and passes the player's other flags through unchanged (`--serve <dir>`, `--page <path>`, `--devtools`, `--quit-after`, `--report <file>`).

## Operating-system notes

- **macOS** — use a running desktop session to see the window.
- **Linux** — on a machine without a display, run the measurement headlessly with `xvfb-run -a pnpm desktop:measure`; a visible window needs a desktop session.
- **Windows** — package paths use backslashes (`fixtures\packages\demo.tpk`). `pnpm desktop:run` handles the Electron binary path for you.

## Two things that can trip you up

- **Electron's download.** On a fresh checkout, `pnpm install` can return before Electron's runtime has finished downloading. If the first `desktop:measure` fails with `ENOENT …/Electron`, allow the download to finish and rerun it.
- **The sample game.** Package creation and measurement need sample games, which `pnpm fixtures:fetch` downloads. If you skip that step, there is no package to open.

## What is out of scope here

- **Mobile / Android** — the mobile wrapper remains a follow-up and is not tested or claimed here.

## References

- The desktop player's own description and rules: `docs/spec/engine/runners.md` ("The desktop applications", "Install, the library and the descriptor").
- The decision that made Electron the shell: `docs/adr/0013-desktop-shell-electron.md`.
- The task that built the player's desktop package: entry 11 of `_bmad-output/initiative-rpgtoolkit-reawakened/epic-web-runner-packaging/tickets.toml`.
