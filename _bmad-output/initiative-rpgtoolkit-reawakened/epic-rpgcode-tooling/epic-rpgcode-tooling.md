---
type: epic
tracker_id: "#666"
remote: https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/666
title: "RPGCode language tooling: language server, linter, formatter, test framework, help and debug adapter"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-14"]
assignee: ""
risk: medium
---

# RPGCode language tooling: language server, linter, formatter, test framework, help and debug adapter

## Description

An LSP gives diagnostics from the core parser, hover and call tips from the built-in catalogue, go-to-definition across includes, outline, formatting and quick fixes for legacy syntax; a DAP launches programs against a test fixture with breakpoints, stepping, watches, threads and call stack.

Owner scope expansion (2026-10-25, with dogfooding added the same day): RPGCode must have the tool set of a modern language, not only editor features. Beyond the LSP and DAP, this epic also owns a rule-based linter, a formatter, a unit-test framework for RPGCode programs, generated language and syntax help, and a command-line front end so every tool runs the same way in a terminal, in CI and in an editor.

## Outcome

Script authors get modern tooling in any LSP or DAP client; the CAP-14 success check is the signal.

## Done when

1. The LSP reports diagnostics, hover, go-to-definition across includes and outline on the sample games' programs.
2. Each legacy-syntax form of `docs/spec/engine/rpgcode-dialects.md` gets a quick fix that preserves behaviour.
3. The whole built-in catalogue of `docs/spec/engine/rpgcode-functions.md` resolves across the registered domains, asserted by a test.
4. A DAP session built on `runner-harness` sets a breakpoint, steps and shows threads, call stack and variables against a test fixture, and runs in the `vscode.dev` web build too.
5. The LSP ships as a VS Code and Open VSX extension build on its own, before the editor.
6. **Linter.** A rule-based linter, separate from parse errors, reports unused variables, labels and functions, unreachable code, shadowing, calls to unknown or wrongly-called built-ins, deprecated legacy forms and style rules. Each rule has an ID, a default severity, a documented rationale and, where safe, an autofix. Rules are configurable per project, and one diagnostic model feeds the LSP, the CLI and CI. A visual-event-builder output lints clean (CAP-17).
7. **Formatter.** A deterministic, idempotent formatter (T-42 indent wizard, T-46 capitalisation) with configurable indent width. Formatting twice gives the same text, and it never changes behaviour (checked by running before and after on the sample games' programs).
8. **Unit-test framework for RPGCode, in the Jasmine/Mocha/Karma style.** Authors write specs in RPGCode itself with the familiar shape: `describe` blocks (nestable) containing `it`/`test` cases, `beforeEach`/`afterEach`/`beforeAll`/`afterAll`, `expect(actual)` with chainable matchers (`toBe`, `toEqual`, `toBeTruthy`, `toBeNull`, `toContain`, `toBeCloseTo`, `toThrow`, `.not`), plus `skip`/`only` for working locally (a skip fails the strict CI run, as `pnpm test:strict` does for core). Failure messages show expected against actual with the source line. The runner finds spec files by naming convention (`*.spec.prg`), runs each case in isolation from fixed fixtures (board, party, variables), is deterministic under the injected clock and seeded RNG, and runs under `runner-harness` so it works headless in CI, in a terminal and in the editor's test panel. It reports results per `describe`/`it` (spec, JUnit XML and JSON reporters), supports watch mode and a name filter, and reports which program lines ran (coverage, with the same exact line counts as `lcov`). Test doubles for input, ticks, the RNG and built-ins (spies with `toHaveBeenCalledWith`) are part of it. Stock packages and the sample games' scripts gain specs as the proof.
9. **Language and syntax help.** Hover, call tips, the quick reference (T-40) and a searchable language reference are generated from one source, the catalogue and `docs/spec`, so they cannot drift from the engine. Help follows the project's two-part rule (plain-language first, then exact ticks, units and whether the script waits). A test fails when a built-in has no help text.
10. **One command-line front end** (working name `tkr script`) with `check` (diagnostics and lint), `fmt`, `test` and `docs`, with stable exit codes and machine-readable output, used by CI and the editor alike.
11. **Dogfooding.** This repository uses its own tools on its own RPGCode: the stock packages under `stock/` and the authored fixtures run through `check` (diagnostics and lint), `fmt --check` and `test` in CI, and a contributor runs the same commands locally. A new CI job runs them only when RPGCode files change (a path rule in the smart-gates `changes` job, #664), so an RPGCode-only PR gets fast, relevant feedback instead of a blind full run. The stock packages carry their own RPGCode tests, and the lint and format baselines are committed and reviewed like goldens (G5). The tools are exercised on real, changing code before any author depends on them.
12. **A public, supported headless harness for everyone, not only this repository.** Any game author or third-party tool can run checks, specs and test-runs against the headless harness from their own repository, with nothing from our checkout. That means: published, versioned packages (semver, with a stated compatibility promise) for `runner-headless` and the script tools; the `tkr script` CLI installable standalone (`npx` or a single binary, on Node and Bun); a documented, stable programmatic API and a documented JSON result protocol (the same data the CLI reporters emit); a ready-made GitHub Action and a copy-paste CI recipe for author game repos; and a documented way to use the harness from other test runners (for example, launching a game, scripting input, advancing ticks and asserting on state or draw lists from a plain Node/Bun test). The examples and docs are tested against the published package shape, so what we dogfood is what others install. Where the harness API is not yet fit to publish, that is a defect in this epic, not an accepted limit.

## Boundaries

`lsp` and `dap` packages (transport-free; `dap` over `runner-harness`) plus a minimal extension wrapper to ship the LSP early. The linter, formatter, test framework, help generator and CLI share one transport-free library so the LSP, CLI and editor call the same code (placement of the shared library and any new package: to settle at inception, under G2). Not the custom editors or webviews (epic editor-foundation). Not the grammar (Epic 22) and not package management (Epic 19).

## References

- spec - _bmad-output/initiative-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened.md, section Capabilities
- reference - docs/editor-features.md, T-40 to T-46
- reference - docs/architecture-options.md, section 4.1
- reference - docs/spec/engine/rpgcode-language.md#e-98

## Notes

- Assumption: the early LSP release uses its own minimal extension host, folded into `host-vscode` later. Confirm.
- Decision: epic set approved by the user, 2026-10-10.
- Waits on rpgcode-vm because: the parser and the VM.
- Decision: envelope re-sliced against the architecture spine, 2026-10-10.
- Handoff (epic board-rendering inception, 2026-10-16): epic 4 entry 4.30 builds `setBreakpoints`, the `paused { thread, frame, line }` stop, the open-tick cursor and the resume modes `continue` and a one-instruction `step`. Step over, step in and step out are this epic's, built from `step` and the frame depth; watches and the call stack read state through the engine's read-only views. The initiative file now lists epic 4 in this epic's `after`.

- Handoff (owner request, 2026-10-24): Epic 22 (#624, `epic-rpgcode-grammar`) owns the independent spec-authored tree-sitter grammar and syntax artifact. This epic retains semantic LSP/DAP ownership; no dependency on Epic 22 is added. Task 22.9 integrates only syntax highlighting/outlines in the shared program editor.
- Decision (owner request, 2026-10-25): the epic's scope is widened from LSP and DAP to the full modern-language tool set (done-when 6 to 10). Epic title, `tickets.toml` and `packages.md` updated to match. This epic still has no stories and no GitHub issue; both come at inception, which should slice the tools into stories and raise the `after` list for the test framework (it needs the VM's deterministic replay and `runner-harness`, epic 4).
- Open question for inception: the spec API (`describe`, `it`, `expect`, matchers, spies) is new RPGCode, so it needs a spec page in `docs/spec/` first (G7) and an ADR, since it adds commands to the catalogue. Decide whether it is built-ins in a test-only pack that normal games never load (preferred: keeps shipped games free of test commands). Naming follows the Jasmine/Jest convention authors already know; deviations need a reason in the spec.
- Decision (owner request, 2026-10-25): dogfooding (done-when 11) is a requirement, not a nice-to-have. It also shapes ordering: ship `check`, `fmt` and `test` against `stock/` as early as each tool exists, rather than at the end. Smart gates (#664) classify RPGCode paths as needing the full suite today; once the tool job exists, an RPGCode-only change can be gated by that job plus the tests that execute those files.
- Decision (owner request, 2026-10-25): third parties must be able to run the headless harness and the test framework in their own repositories (done-when 12). The harness API is therefore a public contract: changes to it are versioned and noted, and the internal-only shortcuts that `runner-headless` and `runner-harness` may use today need review at inception. G6 applies to anything we publish (licences), and G2 still bounds the dependency direction.
