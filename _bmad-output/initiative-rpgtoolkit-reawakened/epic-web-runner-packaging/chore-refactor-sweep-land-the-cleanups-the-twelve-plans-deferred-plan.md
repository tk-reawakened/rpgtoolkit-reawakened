---
title: 'Refactor sweep: land the cleanups the twelve plans deferred'
type: chore
ticket: 13
created: '2026-11-11'
status: done
tracker_id: "#942"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/942"
baseline_revision: 'c33ea5dc'
risk: low
context:
  - 'the 29 `*-plan.md` files and `tickets.toml` notes in this folder'
  - 'docs/guardrails.md G5 (goldens change only deliberately) and G6'
  - 'entry 9.13: cleanup only, no behaviour change, goldens untouched'
---

# Refactor sweep

## What the sweep is for

Entry 9.13 exists so the cleanups the twelve landed plans deferred do not rot into the closing suite. Its acceptance is
"every deferred cleanup named in the twelve plans is either landed or recorded with a reason", with `pnpm checks`,
`pnpm golden`, `pnpm golden:bun` and the browser lane green and **no golden changed**.

## The inventory

All 29 plan files and the `tickets.toml` notes were read. Twenty-five record no sweep work: what looks like a deferral in
them is excluded scope (new behaviour, another entry's work, a missing fixture, an unimplemented load mode, a
test-coverage gap, or the undiagnosed desktop-measurement hang). Four candidates survive, and this is what happened to
each.

| Candidate | Source | Verdict |
|---|---|---|
| `runner-desktop` is outside the TypeScript build graph, so `main.ts`, `preload.ts` and the two player pages were never type-checked | this epic's own entry 9.10 plan ("What changed during implementation", 6) | **Landed.** The package gains a `tsconfig.json` and a `typecheck:tests` script, so `pnpm typecheck` covers it. It immediately found two real type errors, both fixed below. |
| A deprecated `ScriptProcessorNode` fallback still ships (2048 frames) | `story-migrate-web-audio-output-from-scriptprocessornode-to-audioworklet-plan.md:18` | **Recorded, not removed.** It is a deliberate compatibility path, not dead code: it is feature-detected on `AudioWorklet`/`addModule`, and `docs/spec/engine/runners.md#audio` now specifies 2048 frames, pinned by a unit test. Removing it would be a behaviour change, which this entry forbids. |
| A second way to fetch bundled assets survives: `fetchBundled` + the `/api/bundled` route beside the build-written `apps/bundled.json` | `story-load-modes-storage-tiers-and-the-offline-service-worker-plan.md:26` | **Recorded.** `packages/runner-web/app/main.ts:92` still uses `fetchBundled` on its scripted-frame route, which is the route entry 9.16's proof rides on. Consolidating it would rewrite that route inside a no-behaviour-change entry; it belongs in its own ticket with the parity route re-proved. |
| The retired 2048→8192 buffer workaround | `bug-player-defects-audio-dropouts-electron-csp-hygiene-and-menu-plan.md:9`, `bug-live-player-audio-stutters-from-scriptprocessornode-underruns-plan.md:16` | **Already gone.** `audio-sink.ts` carries no 8192 default, `tools/browser/tests/audio.spec.ts` asserts `graphBufferSize` is `null` on the shipped default, and the only remaining node choice is the 2048 fallback above. |

## What landed

1. **`packages/runner-desktop/tsconfig.json`** — a `noEmit` check of `src`, `app` and `test` with `ES2022` + `DOM` and
   `types: ["node"]` (the main process is a Node/Electron program, and the pages are browser code; one program checks
   both without emitting). `typecheck:tests` is the hook the root `pnpm typecheck` already runs for every workspace
   package. `@types/node` joins the package's dev dependencies at the repo's pinned version, MIT like every other
   package's.
2. **Two type errors it found, fixed without changing behaviour:**
   - `src/main.ts`: the `--report` writer used `process.argv[at + 1]` directly, which is `string | undefined`; it now
     reads through the same `argumentValue` helper the rest of the launch code uses.
   - `src/library.ts`: re-registering a package copied `customSettings` even when the earlier entry had none, which
     `exactOptionalPropertyTypes` refuses; the key is now omitted instead of written as `undefined`.

## A defect the gates found

Running `pnpm browser:test` on this clean checkout failed two specs: `tools/browser/tests/desktop-parity.spec.ts` launches
the built Electron player, but the lane relied on somebody having run `pnpm desktop:build` first. The web server command
in `playwright.config.ts` builds the desktop bundles now, beside the browser bundles it already builds, and the redundant
CI step is gone. Proved by deleting `packages/runner-desktop/dist` and `apps/` and running only the parity spec: both
cases pass and the lane recreates the player.

## Verification

- `pnpm typecheck` — the new project is included and clean.
- `pnpm golden`, `pnpm golden:bun`, `pnpm browser:test` — green, and `git diff --stat` shows **no change under `golden/`**.
- `pnpm test` — the unit suite, including the desktop package's resolver and registry tests.
- `pnpm desktop:measure --case argument` — the desktop player still measures the committed frame, so the typecheck
  project did not disturb what ships.
