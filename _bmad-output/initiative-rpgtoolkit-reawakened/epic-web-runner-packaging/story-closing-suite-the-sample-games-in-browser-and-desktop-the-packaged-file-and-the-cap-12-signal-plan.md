---
title: 'Closing suite: the sample games in browser and desktop, the packaged file, and the CAP-12 signal'
type: feature
ticket: 14
created: '2026-11-11'
status: in-progress
tracker_id: "#944"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/944"
baseline_revision: '23d7c590'
risk: medium
context:
  - 'docs/spec/engine/runners.md#conformance-lane, #load-modes, #desktop-shell'
  - 'golden/closing/plan.json (eight games, three batchings) and golden/regression/closing.json'
  - 'packages/runner-harness/src/closing.ts — runClosingGame / runClosingSuite / checkClosingSuite, the single comparison'
---

# The closing suite, one command

## Intent

Entry 9.14 is the epic's CAP-12 signal: proof that the same core build plays the sample games in a browser and in the
desktop player, that a packaged single-file game loads in both, and that a recorded input log produces identical per-tick
state and draw hashes under Node and headless Chromium. Before this entry the pieces existed but nothing put them
together: `pnpm closing` checked Node only, the browser lane had a demo-only parity spec, and the desktop measurement
covered one frame of one game.

## Decisions taken here

1. **One comparison function, three hosts.** `checkClosingSuite` already compares a run's record with the committed
   baseline, the PNGs and the ledger, and fails on any batching disagreement. The browser page and the desktop page call
   the same function through `runClosingCheck` (`packages/runner-web/src/closing-run.ts`), so "the hosts agree" is not
   two comparisons written twice — it is one comparison fed by three engines. Node keeps its own CLI path.
2. **Fixtures reach a page through a build-written list.** A PWA origin cannot list a directory over HTTP, and the
   desktop shell serves static paths over `app://` with no API. `tools/closing/manifest.mjs` writes
   `apps/closing-files.json` at build time (the same pattern as `apps/bundled.json`), and both hosts fetch ordinary
   static URLs from it. The bundled assets use the static list too, because `/api/bundled` does not exist over `app://`.
3. **The desktop runs the whole plan, not two games.** Acceptance names `demo` and `Basic` for desktop; running all eight
   (the six TK2 games are expected failures with located diagnostics) is the same work, needs no subset logic inside the
   checker, and cannot silently skip a game. `demo` and `Basic` are in it.
4. **The packaged file is proved inside the same run.** The page re-runs `demo` from `fixtures/packages/demo.tpk` and
   requires the record the folder load produced — one game, two ways in, identical hashes — in both the PWA page and the
   Electron page. The desktop's launched game is a package too, so the desktop never opens a loose folder.
5. **`pnpm closing:suite` runs every part even when one fails**, prints a per-part verdict, and exits non-zero if any part
   did not pass. `--skip=<part>` runs the rest.

## What was built

- `packages/runner-web/src/closing-run.ts` — `runClosingCheck` (async loads, then the synchronous checker),
  `closingManifestLoader`, `closingBundled`, `packagedDemoRecord`, and the small optional fetch helpers.
- `packages/runner-web/app/closing.html` + `closing.ts` — the PWA page: all eight games plus the packaged demo.
- `packages/runner-web/src/player-page.ts` — a `closing` mode on the shared page, so the Electron measurement page runs
  the same suite over `app://` and reports it in `report.closing`.
- `packages/runner-desktop/app/player.ts` — `?closing` passes the mode through and publishes `window.__closing`.
- `tools/closing/manifest.mjs` (+ tests) — the build-written file list, called from both build scripts.
- `tools/closing/suite.mjs` + `pnpm closing:suite` — the one command.
- `tools/browser/tests/closing.spec.ts` — the browser limb: all games, the packaged demo, records compared to
  `golden/regression/closing.json` field for field.
- `tools/desktop/measure.mjs --closing` — the desktop limb.
- CI: the browser job runs `xvfb-run -a pnpm closing:suite` after the lane.

## Verification (macOS, Electron 45.2.1, Chromium from the lane)

`pnpm closing:suite`, 27.9 s total:

```
ok   node
ok   browser
ok   desktop-build
ok   desktop-suite
closing:suite: every host matches the committed closing baseline
```

Every host printed the same eight game lines, for example:

```
demo: boots; board boards/start.brd; 600 ticks; state 0e671f4d4e66668b; frames title=1cc782d3dcb721b9 board=bfddf1a2fd52363a later=bfddf1a2fd52363a(=board)
School2Demo: expected failure (tk2-support): stopped; stage stopped; 0 ticks; state none; frames none; diagnostics asset.missing@main/schoolsout2.gam:0, syntax.error@prg/start.prg:53, startup.no-player@main/schoolsout2.gam:0
```

The browser test additionally asserts, game by game, that the Chromium record equals the Node baseline record
(dialect, outcome, ticks, boot stage, board, diagnostics, checkpoints, and every frame's state, draw, pixel and command
hash) and that no game reports a batching disagreement. The packaged demo reports `packaged: true` in both page hosts.

Not claimed: the six TK2 games still stop — that is the recorded `tk2-support` expectation, not a regression; and the
suite is a correctness gate, not a performance measurement.
