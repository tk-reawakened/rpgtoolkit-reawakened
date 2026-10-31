---
type: discovery
title: "Closure audit: epic 6 (audio synth), criterion by criterion"
date: 2026-10-31
baseline_revision: 3c7c71903422c3025ca592cac330e0b9b4381adf
---

# Epic 6 closure audit

Audited at **`3c7c7190`**. All 17 child issues are CLOSED and every entry reads `done`. One criterion is only
partially evidenced; it is recorded as an **evidence gap**, not a defect.

| # | Done when | Verdict | Evidence |
|---|---|---|---|
| 1 | Music and sound-effect cues from boards, battles, animation frames and scripts appear in headless null-audio tests | **Proven** | `pnpm golden`'s audio rows today: `audio-golden: demo: 4 null-audio cues stable`, `Basic: 3`, `Caoquest: 2`, `ChimeranEmpire: 2`, `FinalDestiny: 2`, `School2Demo: 1`, `LittleMan: 1`, `BusDriver: 1`, `synthetic battle (demo, source=battle): 6`; the scene corpus adds the authored `animation-frame-sfx`, `battle-music-handoff` and `media-wait-suspend` cases (`packages/core/test/fixtures/audio/*.json`, driven by `audio-oracle.ts`) |
| 2 | The synth plays a sample MIDI file through the SoundFont **in a browser test**, with the SoundFont lazy-loaded and listed in `THIRD_PARTY_NOTICES` | **Partially proven — evidence gap** | The synth half is proven in Node: `packages/synth/test/render.test.ts:43` “SpessaSynth renders authored MIDI to non-silent PCM at the core AudioInfo length”; the only bundled bank is the authored 800-byte CC0 fixture listed in `THIRD_PARTY_NOTICES` (§“TK Reawakened minimal SoundFont test fixture — CC0-1.0”), and `THIRD_PARTY_NOTICES` states that no third-party GM bank ships until TK-16's PB-1–PB-10 audit passes. **No browser test of that path exists** (`grep -rn "browser\|playwright\|chromium" packages/synth/test packages/runner-harness/test` → no match) |
| 3 | A user can point the runner at their own `.sf2` | **Proven, with superseded wording** | The bank is named by the game file's audio settings (MEDIA-4, `docs/spec/engine/audio-media.md:708-711`), and the engine resolves it from the asset root: `packages/core/test/audio-engine.test.ts:267-275` shows `Media/town.sf2` honoured and `Media/nope.sf2` refused with one located `media.soundfont-missing`; a host that wants a user-picked bank supplies it as that asset. There is no runner CLI flag, which the later MEDIA-4 ruling made unnecessary |
| 4 | Audio built-ins register with the VM and drive the cues | **Proven** | The media pack (`packages/core/src/script/packs/media.ts`) is in the catalogue with `catalogue:check`/`command-docs:check` green, and the cue assertions above come from real programs driven through the engine |

## Findings

- **F-01 (evidence gap, no code defect).** Criterion 2's browser limb has no test: the MIDI-through-SoundFont path is
  proven under Node only. Nothing about the synth is browser-specific in the current design (the renderer is pure and
  the test measures PCM), so this is a missing *test*, not a broken behaviour. It is reported rather than filed as a
  ticket because filing would assert a defect the code does not show; if the initiative wants the criterion honoured
  literally, a browser smoke test of `render.test.ts`'s case belongs in the web-runner epic that owns browser tests.
- No store correction needed: 17/17 entries `done`, 17/17 issues closed.

## Not probed

The browser limb above. Everything else was executed on this SHA.
