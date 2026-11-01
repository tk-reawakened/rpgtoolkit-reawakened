# TK Reawakened

**Your game, completely and freely.**

A tribute to RPG Toolkit, and an effort to bring its games and its community back. Play the classic RPGs again in your browser, and make your own.

In the early 2000s, Christopher B. Matthews' RPG Toolkit opened a door for a whole generation. It was free, it was made for role-playing games, and a community grew up around it where young people made their first maps, wrote their first scripts and shared their first games. Many of them went on to become engineers and artists. Since then the sites have gone, the games have scattered, and the tool only runs on Windows machines of twenty years ago.

TK Reawakened is not RPG Toolkit, and it doesn't try to replace it. It's a new project, built from scratch for the web, with one hope: that the games keep running and the people have somewhere to gather again.

## What we're doing

- **Remember.** We are salvaging the community's games, plugins and history before they disappear. The promise is simple: we will provide the preserved files together with the original information we gathered about them, credited to the people who made them.
- **Play.** Open a classic RPG Toolkit game from a link, and it plays the way it used to, the same way every time.
- **Make.** Draw maps, design characters, write the story and script the battles in an editor that runs in your browser.
- **Share.** Send your game to a friend as a link, or package it to publish anywhere.
- **Bring it home.** Made something with the old Toolkit? Your game opens again, and you can keep working on it.

Nothing to install, nothing to buy. Desktop, mobile and VS Code versions all run the same core — the desktop shell is already in place and can open a game, and the others are on the way.

TK Reawakened is its own project with its own version line, and its first release will be v1.0. It opens and plays classic RPG Toolkit games, and is free to define its own native format if the old ones ever hold it back.

## Free, and what you make is yours

The code is open source under the [MIT license](LICENSE). You can share your games, change them, or sell them. Nobody has to open up their own work. All we ask is that the license notice and credit travel with the engine.

## Where it stands

It's early days, and no runner presents a playable board yet: the engine boots a sample game and checks that it renders correctly (see the [desktop player guide](docs/playing-the-desktop-player.md)), but you cannot sit down and play a game end to end. The recovery work is under way, and nothing is published until the people involved have had their say. The full written specification and architecture are done, and we're setting up the project's workspace and checks. The first goal is the player: a classic community game playing start to finish in a browser. Our first candidate is *Final Destiny*, by Christopher B. Matthews himself. The editor comes right after.

One known limit: the old Toolkit allowed Windows-only add-ons called plugins, and those can't run in a browser. Toolkit 3's standard battle and menu systems were plugins too, but we're rebuilding those as part of the engine, so games that used only the standard ones should play. Games with custom-built plugins will need those parts rebuilt with the new extension system.

## Who it's for

- **The next beginner,** anyone who wants to make the RPG in their head with little or no coding.
- **Returning creators,** who made games with the Toolkit years ago and want to see them play again, and the community that made them.
- **Players,** who remember these games or are meeting them for the first time.

## Read more

- [Specification](docs/spec/README.md): what Toolkit 3.1 does, byte by byte and behaviour by behaviour (the legacy file formats the player has to read, and the engine's behaviour)
- [Editor features](docs/editor-features.md): what the editor does
- [Architecture options](docs/architecture-options.md) and [decision records](docs/adr/0001-typescript-core.md): how it's built, and why
- [Script execution observers](docs/adr/0010-script-execution-observers.md): observation-only closing-game census
- [CodeGraph navigation](docs/codegraph.md) and [independent RPGCode grammar proposal](docs/adr/0011-tree-sitter-rpgcode.md): developer navigation and editor syntax design
- [Engineering rules](docs/guardrails.md): the rules every change follows

## Helping out

We'd love the help. The earlier revivals stalled when too few people were left carrying them, so this one is meant to be built together. Start with [CONTRIBUTING.md](CONTRIBUTING.md). It has the commands to build and test the project, and the few rules that keep the project's license clean.

*Contributors: this is a clean-room project, so implement from `docs/` only. The rules are in [CONTRIBUTING.md](CONTRIBUTING.md).*

---

*TK Reawakened by Jensen Chappell, in tribute to Christopher B. Matthews, Phil "Xavier" Carty, and the RPG Toolkit community.*
