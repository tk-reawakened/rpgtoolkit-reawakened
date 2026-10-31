---
type: discovery
title: "Closure audit: epic 21 (media as objects and events), criterion by criterion"
date: 2026-10-30
baseline_revision: f58ef11a
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
| 8 | A pure-RPGCode package (ducking and stems, event-driven) is pinned in a golden | **Unproven** | No ducking/stems package, fixture or golden exists (`grep -ri duck packages/core/test golden tools/fixtures` finds only the fade scene's wording). Owned by entry **21.7** (#486, open) — no new ticket needed |
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
- **A-02 (bookkeeping drift, not a defect).** Entries 21.9, 21.10 and 21.11 carried `built`/`review` status after
  their code had merged; 21.10 and 21.11 were flipped to `done` in PRs #835/#836. 21.9 still reads `review` on
  `main` even though its fix merged in PR #821 and its follow-ups (#825/#826) are closed — a stale-status item for
  the epic's closure pass, not a code gap.
- **A-03 (epic cannot close yet).** Criteria 8 depends on entry 21.7 (#486, open) and the epic's refactor sweep
  (21.8, #487) is open. This audit does not close the epic and does not rewrite any completed plan.

## Follow-ups

| Finding | Type | Where |
|---|---|---|
| A-01 | spike, `hitl: true` — proposed ruling recorded in its plan, owner review required | New entry 21.12 (filed with this audit) |
| A-02 | none — corrected for 21.10/21.11 already; 21.9's status belongs to the epic closure pass | Epic closure |
| Criterion 8 | already tracked | 21.7 / #486 |

## What this audit did not do

- It did not re-run every gate on `main`; it ran the media test files (66 tests) and relied on the merged PRs'
  recorded CI (`checks`, all `unit` shards, `golden`, `golden-bun`, `gate` SUCCESS) for the rest.
- It did not touch `docs/spec`: no new normative text is asserted here, and A-01's proposed wording lives in the
  spike's plan, not in the spec.
- It did not mark the epic closed or change any entry's status.
