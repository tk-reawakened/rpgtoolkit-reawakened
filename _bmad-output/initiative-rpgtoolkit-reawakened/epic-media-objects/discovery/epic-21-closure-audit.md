---
type: discovery
title: "Closure audit: epic 21 (media as objects and events), criterion by criterion"
date: 2026-10-31
baseline_revision: 50fd8d35
---

# Epic 21 closure audit

Audited against **merged code and tests at `f58ef11a`**, not bookkeeping: entry status, issue state and compiled
plans were ignored. Every verdict cites a file or a test; a criterion with no merged evidence is marked unproven
even where a ticket says done. Entry 21.6 (the surface retirement, PR #838) and entries 21.10/21.11 (PRs #831/#834)
had already merged when this audit ran.

Method: read `epic-media-objects.md` Done-when 1–9, then for each criterion search `packages/core/src`,
`packages/core/test`, `docs/spec`, `golden/` and the catalogue; run the media test files where a claim needed
execution. No sample game and no legacy source was consulted (G7).

## Verdict table

| # | Criterion | Verdict | Anchor evidence |
|---|---|---|---|
| 1 | `mediaPlay` + the 3.1 aliases behave per the parity ledger; cue streams and goldens unchanged | **Proven** | `script/packs/media.ts` `MEDIA_COMMANDS` (playmidi/midiplay/wav/mp3/mediarest/midirest/wavstop/mp3pause/setvolume plus `MEDIA_PLAY`/`MEDIA_STOP`); reference rows `rpgcode-functions.md:545-549`; `audio-scenes.test.ts` + `audio-oracle.ts` scenario corpus; `pnpm golden` green (24 compared, 27 programs, audio-golden rows stable) |
| 2 | `mediaPlay` returns a voice object that reads core state, controls itself and goes stale with a located diagnostic | **Proven** | `audio/script.ts:96-100` (`mediaVoiceRef`: track/slot/cueId only), `:315-345` (host type: read/methods), `audio/runtime.ts:359-371` (`media.unknown-voice` for an unknown or stale voice), `:1060-1074` (seek/volume rules); 66 tests pass across `media-objects`, `audio-events`, `audio-lifecycle-engine`, `audio-runtime` |
| 3 | `media`, each track and each voice are emitters; voices emit started/stopped/ended/looped/paused/resumed/faded and the others re-emit; events come from core state at the waits phase, never from `audio.ended` | **Proven** | `audio/events.ts:20-50` (emitter keys and the re-emit list `[voice, track, media]`), `audio/runtime.ts::phase()` (end/loop authority is the fixed tick), `input/input.ts:166` (`audio.ended` is a no-op in core input), `script/waits.ts:192,241` (`mediaStart` resolves the voice from audio state); `audio-lifecycle-*.test.ts` |
| 4 | A cancelable `beforePlay` fires for every start, scripted or engine-originated, carries its source, and lets listeners cancel or change file, volume or loop | **Proven** | `audio/runtime.ts:571-600` (cancelable step in front of every `media.play` apply, incl. engine-originated), `:394-444` (writable `file`/`volume`/`loop`, read-only `source`/`track`/`slot`/`cueId`, located `media.beforePlay-invalid`); 20 test references to `beforePlay`/`detail.source` across `battle-cues*`, `media-objects`, `audio-runtime` |
| 5 | The main file carries the audio settings block; it replaces the startup `defaultSoundFont` and runtime `mediaTrack`; legacy rows untouched; settings stay out of saves | **Proven** | Ruling `audio-media.md:708-711` (MEDIA-4); `audio/runtime.ts:840` `applyGameAudio`, `engine/engine.ts:1952-1957` (`media.voice-cap`, fall back to defaults); `audio-restore.test.ts` (settings travel in a snapshot, never in a save); `engine-boot.test.ts`, `format-audio.test.ts` |
| 6 | A save carries playback as data; no callbacks; **a package missing on load loses its listeners with a diagnostic, never a refused load** | **Partially proven** | Data-only playback and no callables: `docs/spec/engine/rpgcode-modules-and-objects.md` EMIT-15 (`listeners` are callable records), `events/emitter.ts:128,151`; save/restore tests green. **The missing-package clause has no rule text, no diagnostic code and no test** — see finding A-01 |
| 7 | The net-new procedural surface, `&voice`, `tkMD_*`, `priority`/`syncTrack` as positional arguments are removed and everything migrated | **Proven** | No `mediaTrack`/`mediaLoad`/`tkMD_`/`&voice` remains in `packages/` or `docs/spec`; `mediatrackget`/`mediatrackfade` survive only as `doc.access: "internal"` method targets (`script/packs/media.ts:266-300`, `:400-420`); `priority`/`sync` survive only as options-dictionary fields, as MEDIA-5 rules (`audio-media.md:720-731`); `catalogue:check` and `command-docs:check` green; retired surface removed in PR #838 |
| 8 | A pure-RPGCode package (ducking and stems, event-driven) is pinned in a golden | **Proven (re-audit)** | Entry 21.7 merged as PR #846 (`bde11f32`), ticket flipped in #856: `packages/core/test/fixtures/media/{ducking,stems,region-music}.prg` load by name from the main file's package list through a package catalogue; `packages/core/test/audio-packages.test.ts` (4 tests, all passing on `50fd8d35`) asserts each package's audio consequence, replays the scenario to the same per-tick hashes and restores a save at every tick; `golden/audio/media-packages.json` pins the per-tick record |
| 9 | Every Epic 6 audio golden that does not use the removed surface is unchanged; typecheck, lint, licence, provenance, catalogue and command-docs gates pass | **Proven, with one recorded re-record** | `pnpm golden` (24 compared, 27 programs, scene S-01 exact), `closing` 8/8, `golden:bun` exit 0 on the branch that carried 21.10/21.11; gates green on the merged PRs. 21.6 re-recorded the **audio fixture labels only** (options/object form), stated in the epic Notes — a deliberate, explained change, not silent drift |

## Findings

- **A-01 (coverage gap and contract question, criterion 6).** The criterion promises that a save whose listeners
  came from a package that is absent on load "loses its listeners with a diagnostic, never a refused load". The
  spec does not say this: EMIT-15 makes listeners script-state records (`{ emitter, type, once, callable }`), so a
  listener survives a load without its package — the *callable* is saved data, not package code. Nothing in
  `packages/core/src` emits a diagnostic for a listener whose package is missing, and no test exercises a save
  taken with a package-provided listener and loaded without that package. Either the criterion is stale wording or
  a rule is missing; that is an owner wording decision, so it is filed as a spike with a proposed ruling rather
  than as a bug.
- **A-02 (bookkeeping drift, not a defect).** On `50fd8d35` the store still reports `review` for 21.5, 21.6, 21.7
  and 21.9 although every one of their code changes is merged (21.5 in #484's closure, 21.6 in #838, 21.7 in #846,
  21.9 in #821); only their plan `status` was left at `built`. 21.12 also shows up as an extra row keyed by its
  file name, so the tool is not reading that plan's `ticket:` field. Both are for the epic's closure pass, not code
  gaps; this audit changed none of them.
- **A-03 (epic cannot close yet).** Criteria 8 depends on entry 21.7 (#486, open) and the epic's refactor sweep
  (21.8, #487) is open. This audit does not close the epic and does not rewrite any completed plan.

## Follow-ups

| Finding | Type | Where |
|---|---|---|
| A-01 | spike, `hitl: true` — proposed ruling recorded in its plan, owner review required | New entry 21.12 (filed with this audit) |
| A-02 | none — the plan statuses are corrected in the closure pass | Epic closure |
| Criterion 8 | **closed** — delivered by #846, ticket flipped in #856; verified again here | 21.7 / #486 (done) |

## What this audit did not do

- It did not re-run every gate on `main`; it ran the media test files (66 tests) and relied on the merged PRs'
  recorded CI (`checks`, all `unit` shards, `golden`, `golden-bun`, `gate` SUCCESS) for the rest.
- It did not touch `docs/spec`: no new normative text is asserted here, and A-01's proposed wording lives in the
  spike's plan, not in the spec.
- It did not mark the epic closed or change any entry's status.

## Re-audit after 21.6 and 21.7 merged (`50fd8d35`)

Entry 21.6 (surface retirement) merged as PR #838 and entry 21.7 as PR #846, so the two criteria this audit left
open were re-checked against the merged tree rather than taken from the store:

- Criterion 7 stays **proven**: nothing from the retired procedural surface is reachable from a script; the only
  survivors are the `access: "internal"` method targets the media object hydrates.
- Criterion 8 becomes **proven**: `node --test packages/core/test/audio-packages.test.ts` reports 4 passed, 0
  failed; those tests load the three packages by name from the package list, assert each package's audio
  consequence, and restore a save at every tick to the same hash. `pnpm golden` on the same tree reports
  `scripts: 27 programs ok (snapshot/restore verified)` with no drift, so the new record changed nothing that was
  already pinned.
- Criterion 6 is unchanged and remains the epic's only open contract question (spike 21.12 / #843, owner-gated).

A parallel implementation of entry 21.7 was written in this session (PR #858) before #846 landed; it was closed as
a duplicate rather than merged, so `main` keeps a single fixture folder, a single media-package golden and one
reviewed behaviour suite.

## Addendum (2026-10-31, second cross-check)

Re-derived after the epic's last entries merged. The nine verdicts above still hold; three items in the audit text are
superseded:

- **A-03** said "criteria 8 depends on entry 21.7 (#486, open) and the epic's refactor sweep (21.8, #487) is open". Both
  merged (#846 and #859), so nothing in the buildable scope is open.
- **A-02** (store drift) is corrected in its own PR: entries 21.5–21.9 are marked done in their plan files, and the
  21.12 spike plan now carries a plan type so the store joins it to entry 12 instead of listing it as a stray row.
- The epic still does **not** close: 21.12 / #843 is the owner-gated load-time listener ruling (criterion 6), exactly as
  recorded above.
