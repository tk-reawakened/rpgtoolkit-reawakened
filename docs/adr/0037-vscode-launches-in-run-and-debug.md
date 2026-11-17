# ADR 0037 — VS Code launches in Run and Debug

* **Status:** Accepted (2026-11-16), as an implementation choice under ADR 0022 D8; the owner can still rule differently.
* **Date:** 2026-11-16
* **Context documents:** [ADR 0022 D8](0022-shared-editor-authoring-contracts.md) (launches and run snapshots), [architecture-options.md](../architecture-options.md) §platform-services ("VS Code (workspace FS + tasks/debug APIs)"), issue [#2919](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2919), follow-up [#2920](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2920).

## Summary

In plain terms: in VS Code you start the game, a board test or a program test from the **Run and Debug** view, the way you start any program there. You pick or write a launch configuration in `launch.json`, press F5, and the game opens in the same **Running Game** tab as before. The red Stop button on the debug toolbar stops it, Restart runs it again from freshly saved files, and run messages appear in the Debug Console. A configuration can leave values out; VS Code then asks for them with the same questions the commands ask.

## Context

The editor extension offered its launches only as Command Palette commands (`tkr.runGame`, `tkr.testProgram`) and an internal board-test command (`tkr.startBoard`) that collect their inputs with quick picks. VS Code users look for launches in Run and Debug, where they can keep a configuration, start it with F5 and stop or restart it from the debug toolbar. The browser editor has its own Run panel; that is a host chrome difference and is not changed here.

The RPGCode language extension already contributes a debug type, `rpgcode`. It is a **headless** debugger: one program on one board, run by `runner-harness` through `packages/dap`, with breakpoints, and no visual player.

## Decision

1. **A new debug type, `tkr`, in the editor extension.** It is not an extension of `rpgcode`.
   * The editor extension owns the visual player, its bundled assets, save-before-run and the run service. The `rpgcode` extension is a language extension that ships none of these, and the two extensions must work without each other.
   * The two debuggers answer different questions. `rpgcode` steps through one program headlessly; `tkr` plays the game, a board or a program in the real player. Merging them would mix two launch shapes behind one `request: "launch"` and make the `rpgcode` schema lie about what each field does.
   * They stay side by side in the debugger list as "RPGCode" and "TK Reawakened game".
2. **One configuration is a platform-services `Launch`, field for field.** Besides VS Code's own `type`, `request` and `name`, a `tkr` configuration uses exactly the `Launch` field names and nesting, so a `Launch` object is a valid configuration as written: `kind` (`"game"`, `"board"` or `"program"`, which keeps the three launches distinct, D8.1), `main`, `projectFolder`, `seed`; for a board test `start` (`board`, `x`, `y`, `layer`) and `party`; for a program test `program` and `fixture` (`id`, `font`, `fontSize`, `windowGraphic`, `party`, `start`). The fixture's `id` defaults to the program path. Paths are workspace-relative, or absolute under the configuration's workspace folder (so `${workspaceFolder}/…` works). A value of the wrong type, or a path outside the workspace folder, refuses the launch with a message naming the field (for example `fixture.start.layer`); it is never guessed. **Owner decision, 2026-11-16:** saved run setups will live in one project file that the browser editor and this debug type both read (`.tkr/launch.json`, being specified separately), so this type defines no field set of its own; a configuration that names a saved setup is added when that format lands.
3. **Missing values are asked for.** A missing field is asked for with the same quick pick, file dialog or input box the palette command uses, so an empty configuration, or F5 with no `launch.json`, still works (VS Code first asks which launch). A `start` given in part has only its missing members asked for. A program test with no `fixture` asks for every test setting, as the Test Program command does; a `fixture` that is given is taken as the `ProgramFixture` it is, so an absent `font`, `fontSize`, `windowGraphic` or `start` means the game's default, none, or no board, and only a missing `party` is asked for. A board test asks for one or more party members, because an empty party is refused (D8.1). Cancelling any question cancels the launch with no error.
4. **The run is the command's run.** Starting a `tkr` session calls the same run service as the commands: it saves first (D8.2), refuses if a save fails or a saved file changes before the player starts, records the snapshot (D8.3) and opens the same Running Game webview tab. The configuration is resolved before the save, so nothing is read from unsaved memory.
5. **The debug toolbar drives the run handle.**
   * **Stop** (and Disconnect) stops the run handle; that closes the Running Game tab.
   * **Restart** stops the current run and starts the same configuration again, which saves again and makes a **new snapshot** (D8.4). It does not ask again for values answered when the session started.
   * **Closing the Running Game tab** stops the run, and a run that ends or fails ends the debug session.
   * The Debug Console shows the snapshot (kind, target hashes, manifest, seed, runner), each change of run state, the run's located diagnostics and the final message.
6. **An inline adapter.** The adapter is a `vscode.DebugAdapterInlineImplementation`, as `rpgcode`'s is, so the desktop and web extension hosts register the same factory. Its protocol logic is plain TypeScript with no `vscode` import, so unit tests drive it directly.
7. **No breakpoints yet.** A `tkr` session supports launch, restart, terminate and disconnect only; it reports no threads and never stops. Breakpoints, pause and stepping in the visual player are follow-up [#2920](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2920). Until then, use the `rpgcode` debugger for breakpoints in one program.
8. **The commands stay.** `tkr.runGame`, `tkr.testProgram`, `tkr.startBoard` and `tkr.startProgram` keep their behaviour. Both routes share the prompts and the run service, so they cannot drift apart.

## Consequences

* VS Code gets the Run and Debug experience its users expect, with no new player, no new run rules and no change to the browser or desktop hosts.
* The prompts move from `player.ts` into a shared module used by both the commands and the debug configuration provider.
* A `tkr` session shows an empty Call Stack until #2920 is done; that is expected, not a fault.
