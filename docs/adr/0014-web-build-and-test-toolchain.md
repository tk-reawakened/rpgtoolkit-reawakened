# ADR 0014 — The web build and test toolchain: esbuild and Playwright, both dev-only

* **Status:** Accepted (2026-10-31)
* **Date:** 2026-10-31
* **Amends:** [guardrails.md](../guardrails.md) G6 (the dev-only inventory gains two tools); the spine's Stack table and its Deferred line "Vite 8 depends on `lightningcss`"
* **Context documents:** [ADR 0002](0002-core-pixels-and-deterministic-maths.md) (the `ovsx` precedent), [spec/engine/runners.md](../spec/engine/runners.md#build), [spec/engine/runners.md](../spec/engine/runners.md#conformance-lane)

## Summary

In plain terms:

1. **We bundle the browser build with esbuild.** It is already the bundler the project names for the VS Code extension, it is MIT, and it produces exactly the single-file bundles the security policy asks for. We do not install Vite.
2. **We test in a real browser with Playwright.** It is Apache-2.0, which the licence gate admits without any exception at all; it is nonetheless listed here as a dev-only tool because nobody who installs our product ever receives it.
3. **Neither tool is "shipped".** Both run on a developer's machine and in CI, and G6's own enforcement paragraph explicitly leaves such tools outside the production-tree scan *provided* each one is named with its licence in ADR 0002 or a later ADR. This is that later ADR.

## Context

The spine's Deferred list says: "Vite 8 depends on `lightningcss` (MPL-2.0). Before the first Vite install (epics web-runner-packaging and editor-foundation), an ADR names it as a dev-only tool, or the web builds use esbuild instead." The second option costs nothing: esbuild 0.28.2 is already pinned in the spine's Stack table and already the declared bundler for `host-vscode` (AD-22).

The spine's Operations section also fixes the artefact shape: "the engine worker and the AudioWorklet are single-file IIFE bundles with no runtime `import()`". That is esbuild's native mode and a reason not to introduce a second bundler with a different output model.

The repository has no browser lane at all. Epic 6's browser limb of its Done-when 2 became untestable for exactly that reason (issue #877), and epic 9's Done-when 2, 3 and 5 cannot be verified without one: the WebGL2 agreement bound needs a GPU path, and the audio contract needs an audio graph, neither of which a Node lane can stand in for.

G6's enforcement paragraph already anticipates this: "Dev-only tools that are never shipped, bundled or linked sit outside this production-tree scan, because they never reach users; each one is named, with its licence, in ADR 0002 or a later ADR (currently only `ovsx`, EPL-2.0, used to publish to Open VSX). The scan still fails if such a tool appears in a production tree."

## Decision

1. **esbuild 0.28.2 (MIT) bundles every browser artefact** — the player page, the engine worker and the AudioWorklet — from the same `tsc -b` output the headless runner consumes. The worker and the worklet are single-file IIFE bundles with no runtime `import()`.
2. **Vite is not installed.** If it is ever wanted, an ADR for `lightningcss` (MPL-2.0) precedes its first install, as the spine requires.
3. **Playwright 1.64.0 (Apache-2.0, Blue Oak Gold) is the browser lane**: one headless Chromium project, a required `gate` dependency that runs `pnpm fixtures:fetch` first, serving the fetched `fixtures/` folder over the local static server. No test reaches the network.
4. **Both tools are listed dev-only, with their licences.** Playwright needs no licence exception — Apache-2.0 passes G6 rule 1 outright — but it is recorded here because the enforcement paragraph asks for every never-shipped tool to be named. The npm packages and the browser binaries Playwright downloads at install time are never bundled, linked or shipped; the production-tree scan never sees them, and it still fails if either tool appears in a shipped tree.
5. **A stray dev tool is a gate failure, not a judgement call.** Adding a tool to this list means adding its line here first, with its licence.

## Consequences

* **Shipped tree.** Unchanged: both are development dependencies, and neither produces licence-bearing content inside an artefact we ship.
* **What this costs.** Playwright downloads browser binaries at install time; CI must fetch fixtures before the lane runs; and a developer without the browser binaries gets a clear failure rather than a silent skip (the no-skips gate rejects a skipped test).
* **What this fixes.** Epic 6's browser limb, epic 9's Done-when 2 and 3, and the one check that keeps SF3's `wasm-unsafe-eval` allowance from widening silently all become runnable.
* **Revisit triggers.** A Vite install, a second browser engine in the lane (WebKit or Firefox) — neither needs a new exception, both need this ADR amended with the reason — or a Playwright licence change on the pinned Blue Oak list.

## Alternatives rejected

* **Vite 8.** HMR and a dev server are conveniences this project does not need, and the dependency carries MPL-2.0 transitively, which needs its own ADR.
* **A Node lane pretending to be a browser** (Bun, Deno, jsdom). None executes WebGL2 or Web Audio, which are the two things the lane exists to prove.
* **WebDriver or a hand-rolled CDP harness.** More moving parts for the same coverage, and no maintenance story for the browser binaries.
