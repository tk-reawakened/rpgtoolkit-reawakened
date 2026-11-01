---
title: 'Load modes, storage tiers and the offline service worker'
type: 'feature'
ticket: '9'
created: '2026-11-01'
status: 'draft'
baseline_revision: '454230a1e3557533d6c086efd964a258b4221abc'
route: 'full'
route_source: 'auto'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - 'docs/spec/engine/runners.md'
  - 'docs/guardrails.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** No web player plays a game. Both shipped pages boot the *golden closing harness* for a single frame
(`runner-web/app/main.ts:42`, `runner-desktop/app/player.ts:74`), so there is nothing to load, cache, stream or take
offline — and nowhere for 9.10 to hang a real player. #934's four criteria are unreachable until a live loop exists.

**Approach:** Give `runner-web` the live player: one engine kept alive, every request kind serviced (`asset`,
`saveBlob`/`loadBlob`/`listBlobs`, `playVideo`, `prefetch`, `quit`), the draw list presented each tick, plus load mode,
storage tiers, stall state and the service worker. Pages become hosts; the harness stays the oracle.

## Boundaries & Constraints

**Always:** core stays I/O-free and clock-free (G2/G3); runners only replay draw lists (G4); the runner never parses a
board to guess prefetch (9.8 plans it); the threshold is measured, never asserted; saves use the `GameId` the engine is
given (AD-17); the worker never reads a save; the worker updates on next launch, never mid-session; `app://` registers
no worker.

**Never:** rewrite `runner-desktop`, or implement launch resolution, the library, the default game or the bank picker
(9.10's); change `runClosingFrames`/`runLog` behaviour (goldens must not move); add a second board parser, a second bank
cache, or per-entry manifest hashing.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Whole-package load | package ≤ threshold | one download behind a progress screen, kept, boots past tick 120 | a hash mismatch is reported, not served |
| Streaming load | `?mode=streaming` or injected threshold | assets fetched on demand, hinted ones ahead of the engine's request | an unhinted stall is recorded, not hidden |
| Blocking stall | engine `loading` | last frame kept, spinner only after ~300 ms, cues keep sounding | every blocking request answered, never dropped |
| Package-cache quota | durable put throws | state reports quota, mode falls back to streaming, game still boots | no silent stop, no throw out of the loop |
| Offline relaunch | network blocked, package and shell cached | identical tick-120 hashes, same `GameId` save restores | a miss is a stated load error |
| Open page at deploy | new worker installs | this session keeps the old one, the new waits | no `skipWaiting` mid-session |

</frozen-after-approval>

## Code Map

- `packages/runner-harness/src/closing.ts:162-380` — the only real engine loop: `createBootDoubles` (:162, camera
  target :205, effect appliers :197-207), request/advance shape and the per-tick capture to copy. `runClosingFrames:434`
  is the oracle and stays untouched; `driver.ts:112-124` throws when `loading` or `ticksRun` differ, which is why it
  cannot be the player.
- `golden/closing/plan.json:3-12` with `closing.ts:124` — the run definition the tick-120 hashes are tied to: seed 3,
  640×480, `maxTicks` 600, ENTER at ticks 30/60/90, and the `include {shading,images,sprites}` the harness sets.
- `packages/runner-web/src/index.ts:9,148` — `runScriptedFrame` and the harness import that must leave the player path;
  `packageFiles:112`, `fetchGame:62` and `textureProvider:80` are reused. `fetchBundled:67` (`/api/bundled`) is
  **replaced** for the player by a build-emitted static manifest precached with the shell, and the page's
  `golden/closing/plan.json` fetch (`app/main.ts:35`) leaves with the scripted frame.
- `packages/core/src/ports/engine.ts:64-118` — `advance`/`TickReport`; `engine.ts:2971-3016` freezes time on `loading`;
  `ports/requests.ts:25-99` — the request union, including `quit:62` and `prefetch:67`; `engine.ts:1586` emits `quit`.
- `packages/core/src/script/builtins/files.ts:46,108` — save path `<GameId>/saved/<file>.sav`, emitted as `saveBlob`;
  `engine.ts:1419` restores on `blob.loaded`; `runner-harness/src/script-host.ts:96` (`blobKey`) is the `area:path`
  convention.
- `packages/core/src/prefetch/plan.ts:24-108` — the landed planner; `engine.ts:1714` posts it only when it changes.
- `packages/synth/src/cue-player.ts:139`, `runner-web/src/audio-sink.ts:36` — synchronous `readAsset`, so the loop keeps
  a byte cache answerable in O(1).
- `runner-web/app/main.ts:30-56`, `app/index.html` — the page that becomes a host; `app/audio.ts:89` shows the wiring.
- `tools/browser/build.mjs:17-23`, `serve.mjs:47`, `playwright.config.ts:16` — worker entries, a package route and
  `Service-Worker-Allowed`; `demo.tpk` is already generated.

## Tasks & Acceptance

**Execution:**
- [ ] `tools/make-package/measure-corpus.mjs` -- new: build each fetched corpus package, report the largest
  uncompressed byte sum and the rounded MiB, `--check` against the docs and **fail loudly when `fixtures/` is absent**
  -- measure before anything consumes the number; register as `pnpm corpus:measure`.
- [ ] `docs/spec/engine/runners.md:215` -- fill the threshold table (corpus, largest, threshold, date) -- a docs-only
  commit, before code (epic rule, `tickets.toml:28`; this is not G7, which is clean-room provenance).
- [ ] `packages/runner-web/src/player-loop.ts` -- new: `createEngine` with the closing recipe's seed, size, `maxTicks`,
  `DrawListInclude` and injected `startup` ports; advance; service every request kind; **fetch and decode a report's
  hinted `now` assets before draining that report's cues**, because `arrive()` posts board music and the hint in the same
  report (`engine.ts:1900-1901`) and `readAsset` is synchronous; a `runTo(tick)` that presents and captures exactly that
  tick's list; an injected clock; record `{key, hinted, waitedMs}` stalls -- the one loop 9.10 will run, and the only way
  the tick-120 hashes are observable.
- [ ] `tools/fixtures/author/generate.mjs` -- new: an authored save fixture under `packages/core/test/fixtures/authored`
  (an already-served root, and a path `fixtures:author:check` covers) whose board thread calls `Save("slot")` at a known
  tick and, on a later run, `Load("slot")`, plus its committed `expected.json` post-load state hash -- the only real save
  round trip, since `SavedGamePort.load` returns `LoadResult` and core only asks `restored()`
  (`ports/startup.ts:24-42`, `engine.ts:2476`); the byte restore is `Load` → `loadBlob` → `blob.loaded` →
  `engine.ts:1419`.
- [ ] `packages/runner-web/test/save-baseline.ts` -- new: run the **same** `player-loop` under Node with an in-memory
  blob store and a no-op presenter to record that hash -- the closing oracle cannot be the headless host (its `reply()`
  answers only `asset`/`playVideo`, `closing.ts:293-300`, so a blob request never settles), and `createScriptHost` says
  it cannot capture a canonical save (`script-host.ts:2-15`); do not extend the oracle.
- [ ] `packages/runner-web/src/assets/source.ts` -- new: memory → Cache Storage/OPFS → network, whole-package and
  streaming readers, a threshold that can be injected -- cache tiers and the mode seam.
- [ ] `packages/runner-web/src/storage/blobs.ts` -- new: `saveBlob`/`loadBlob`/`listBlobs` by full `area:path`,
  `persist()` state, quota reported as state -- the durable store, never touched by the worker.
- [ ] `packages/runner-web/src/load/controller.ts` -- new: mode from the measured threshold, progress, `PlayerState`,
  and the streaming fallback **when the package cache cannot store** -- the state the tests read.
- [ ] `packages/runner-web/app/decode-worker.ts` + `app/service-worker.ts` -- new: decode-ahead; shell, bundled-asset
  manifest, default bank and package cached; no save access, no mid-session swap.
- [ ] `packages/runner-web/app/main.ts` and `app/index.html` -- boot the loop, map host input, present, progress screen,
  the >300 ms spinner over the kept frame, gesture unlock -- the visible player.
- [ ] `tools/browser/build.mjs` -- emit the static bundled-asset manifest beside the player bundle and build the
  `decode-worker` and `service-worker` IIFE entries -- the page's offline boot needs the manifest at a stable URL, and
  the lane never runs the desktop build that writes `apps/bundled.json` today.
- [ ] `tools/browser/serve.mjs` -- serve the worker at the page's scope with `Service-Worker-Allowed`, and a package
  route that supports the range/entry reads OQ1 chooses -- a worker cannot control the page without the header, and the
  streaming and quota acceptance cannot be exercised without the route.
- [ ] `.github/workflows/ci.yml` -- run `pnpm corpus:measure --check` in the `checks` job beside the other `--check`
  gates (the corpus gate is :113) -- a recorded number that only a PR author runs will drift against the docs.

**Acceptance Criteria:**
- Given `demo.tpk` loaded once, when the network is blocked and the page reloads, then it boots to tick 120 with state
  `bff947dce3a11b4f`, draw `9a40be8a0b5ca816`, 128 commands and **no `/api/` request at all** — the bundled list is a
  static manifest precached with the shell.
- Given the authored save fixture's scripted `Save("slot")` at a known tick, when the page reloads and the script runs
  `Load("slot")`, then `saveBlob` and `loadBlob` carry the same `GameId`-prefixed path, the post-load state hash equals
  the headless baseline recorded for that script, and the bytes are not in Cache Storage.
- Given `?mode=streaming` with a delayed unhinted asset, when the run reaches a fixed tick, then every recorded stall is
  unhinted and at least one exists; a hinted asset never appears as a stall, and the first board's music is playing
  because its hinted fetch completed before that report's cues were drained.
- Given a package-cache `put` that throws a quota error, when the game continues, then `state.storage` reports quota,
  `state.mode` is streaming, and the run still reaches a hash — **gated on OQ1(a)**, because the fallback streams a
  single-file package and cannot exist without the range reader; if OQ1 lands as (b) or (c), AC#3 and AC#4 must name
  their source (test endpoint, or folder) and say which product case they do not prove.
- Given a stalled run on a fake clock, when 250 ms pass then 350 ms, then no spinner at 250, spinner at 350, the frame
  pixels are unchanged, and cue handling continued throughout.
- Given an open page while a new worker installs, when it activates, then this session still runs the old worker.

## Open Questions

1. **Streaming package access.** `loadPackage`/`readZip` take the whole archive (`package.ts:169`, `zip.ts:451`), so a
   single-file package cannot stream — and with it the quota fallback cannot fall back. Options: (a) export a
   central-directory reader from core and fetch entry ranges over HTTP Range — production-correct, touches core's
   package module; (b) a per-entry endpoint on the test/build server only — proves the loop, not the product;
   (c) folder sources only, package above threshold unsupported. *Recommendation: (a).*
2. **`GameId` parity.** `make-package` writes `gameId: deriveGameId(mainBytes, title)` (`run.mjs:142`), while the
   harness gives the engine `derivePackageIdentity(files)` (`closing.ts:442`). The engine never derives an identity — it
   is an input (`engine.ts:224`). So a save written by the player and one by the baseline can use different keys.
   Options: (a) the tool writes `deriveGameId(mainBytes, derivePackageIdentity(files))` and the page passes the same
   identity — the descriptor's meaning is unchanged, its value moves; (b) the page passes the title, matching today's
   descriptor and diverging from the baseline; (c) defer to 9.10 — a landmine in the library.
   *Recommendation: (a), with the descriptor value re-checked against `packaging-and-paths.md:124`.*
3. **Worker decode scope.** The epic assumption names images, WAV/ADPCM, MIDI and SoundFonts; the PCM decoders are not
   exported and `SourceVoice` is a stateful pull (`synth/src/source.ts`). Options: (a) images, `AudioInfo` and bank
   validation in the worker now, PCM on the main thread with the gap recorded; (b) add a pure PCM export so the worker
   decodes WAV/ADPCM too — more scope, honours the assumption. *Recommendation: (b) if the export is under ~150 lines,
   else (a) with the gap recorded.*
4. **Prefetch table drift.** `runners.md:229-234` promises board assets, `.anm` frame sounds and literal `send(...)`
   targets the landed planner does not produce (`engine.ts:1721-1737`). Options: (a) amend the table to what core plans,
   recorded as an owner ruling; (b) test acceptance against the landed plan and leave the text overstating.
   *Recommendation: (a).*

## Design Notes

The loop lives in `runner-web`, not `runner-harness`: the harness's drivers exist to assert an exact replay (`runLog`
requires `loading === false` and an exact `ticksRun`, `driver.ts:112-124`), and production must not ship that boot path.
The player copies the closing loop's shape and services the full union:

```ts
let report = engine.advance(left, replies);
await fetchHinted(report.requests);          // the `now` tier before its cues: see above
drain(report.audioCues);                     // cues keep sounding through a stall
for (const req of report.requests) replies.push(await service(req, report.tickAfter));
if (report.loading) report = engine.advance(0, replies);   // never drop a blocker
```

The tick-120 hashes are tied to a recipe, not to a tick number: seed 3, 640×480, `maxTicks` 600, include
`{shading,images,sprites}`, ENTER at 30/60/90, and `gameIdentity = derivePackageIdentity(files)`. `runTo(120)` replays
that recipe under an injected clock, so the assertion is reproducible instead of racing a live cadence.

Streaming has one ordering trap: core posts a board's music request and its prefetch hint in the same `TickReport`
(`engine.ts:1900-1901`), and both audio layers read bytes synchronously (`audio-sink.ts:136`, `cue-player.ts:139`). So the
loop fetches and decodes the hinted `now` tier **before** draining that report's cues; draining first leaves the first
board silent, and audio is outside the state hash, so no hash-based test would notice.

Saves: the engine emits `area` plus a path already starting with the `GameId`; the web store keys the full `area:path`.
The desktop IPC instead takes `(area, gameId, path)` and joins them (`main.ts:88-99`), so a core-emitted path passed
verbatim would double-prefix — a portability constraint 9.13's sweep must settle, not a defect fixed here.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: no errors; core dependency allowlist unchanged.
- `pnpm test && pnpm test:strict && pnpm browser:test` -- expected: existing hashes unchanged; every group in the
  no-skips guard passes, including the new units; the new specs pass.
- `pnpm corpus:measure --check` -- expected: the recorded threshold matches the corpus, or fails with the reason.
- `pnpm make-package:test` -- expected: the descriptor still validates after the `GameId` decision (OQ2).
- `pnpm licence && pnpm provenance && pnpm graph` -- expected: G6/G7 pass, no new violations.
