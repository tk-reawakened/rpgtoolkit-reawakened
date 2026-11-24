# ADR 0044 — Media import contracts and tool licensing

* **Status:** Proposed (2026-11-24). A draft for the owner to answer; **nothing here is decided**. Every numbered decision is a question with options, a recommendation and what it unblocks. Story 14.11 ([#1752](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1752), epic 14 parent [#1360](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1360)) stays unimplemented until the owner approves this.
* **Date:** 2026-11-24
* **Context documents:** [0008](0008-rpgcode-packages-and-trust-baseline.md), [0012](0012-headless-sessions-capture-and-mocks.md) (FFmpeg is installed by the user, never bundled), [0034](0034-tiered-dependency-licence-policy.md) (G6 tiers), [0013](0013-desktop-shell-electron.md)
* **Does not reopen:** the selected Monaco editor and Electron desktop shell (ADR 0013), the package format (packaging-and-paths.md), or the audio and video rulings F1 and F2 except as Question 7 asks.

## In plain terms

A beginner's game may hold MP3 songs, Ogg sound effects or `.avi` cutscenes. The game engine plays only a few formats, so something must convert those files **once, when the project is imported**. This ADR asks the owner five things. Which formats convert. Which video format is the target. Whether the original file is kept. Which converter tools the editor may use, and whether the author must install them. Where a player with a browser instead of the desktop app stands.

Technically: the converter is an authoring tool outside `core` and the runners. It writes a WAV or WebM copy under the **original logical name**, so the game's references do not change. It writes a provenance report outside game data. It never adds a converter to the shipped code unless that converter clears G6 ([ADR 0034](0034-tiered-dependency-licence-policy.md)).

Recommendations are the author's, not the owner's. Facts are from the repository. Anything inferred is marked **[INFERENCE]**. Converter licences not verified from the repository are marked **[UNVERIFIED]**.

## Context

* **Audio is already ruled, pending owner review.** [audio-media.md](../spec/engine/audio-media.md) F2 (around line 953) says MP3, Ogg Vorbis, Opus and FLAC are **import-time formats**, converted to WAV, 16-bit signed little-endian PCM, at the source's channel count and sample rate (resampled to 48000 Hz only when above it). The converted file keeps its original name. Encoder delay and padding are removed so `lengthTicks` is the musical length. The F2 heading reads "Proposed ruling (pending owner review)". F1 says an unconverted file is silent with `media.asset-format`.
* **Video is already ruled, pending owner review.** audio-media.md V1 (around line 1918) says `.avi`, `.mpg` and `.mov` are converted once on import to a **portable video profile**: a WebM container with VP9 video and Opus audio. The converted file keeps its original name. The text says browser support for VP9 in WebM and Opus on every target is **unverified here**, and that epic 9 verifies it and may amend the profile before the importer exists.
* **What the runtime consumes today.** `packages/synth/src/pcm.ts` parses **WAV** (`parseWav`, RIFF/WAVE) and rejects anything else with `format.unsupported`. This matches F1 and F2: no MP3, Ogg or FLAC decoder ships. [INFERENCE] MIDI is handled by `packages/synth/src/midi.ts`. `packages/runner-web/src/video.ts` exports `VideoHost` and `PlayVideoInput` and plays a presented video. This draft did not verify which container `video.ts` accepts, so the WebM target must be checked by epic 9.
* **Legacy evidence.** Toolkit 3.1.0 played MP3, Ogg and tracker files as looping music, and the final version played MIDI only (Q17 and M1). The corpus has **0 MP3/OGG** files (audio-media.md F2, evidence). E-104 (display-input-audio.md) says `.avi` is the native form and that a rebuild may transcode on import.
* **Tools already decided.** [ADR 0012](0012-headless-sessions-capture-and-mocks.md) says "MP4 export runs an FFmpeg the user installed. We never bundle, link or ship it." F2 says "a tool may call a user-installed decoder without shipping it." G6 ([guardrails.md](../guardrails.md), amended by ADR 0034) tests **direct** shipped dependencies against the Blue Oak Bronze tier. It lets transitive dependencies use a known non-copyleft test.
* **Package boundary.** A package holds only `schema`, `main` and `index` (packaging-and-paths.md). The sibling `<package>.tpk.json` descriptor has seven fields. A provenance report must not change either. It sits in the project folder, not in the package.

## Questions

### 1. Audio import profile

Which source formats are converted to WAV on import?

1. **Option A: all four, as F2 rules.** MP3, Ogg Vorbis, Opus and FLAC convert. Every common source is covered, and a beginner's song plays whatever tool made it.
2. **Option B: MP3 and Ogg only.** Opus and FLAC stay unsupported (silent, F1). Fewer converter paths to verify. A FLAC or Opus song fails silently, which the beginner must be told about.
3. **Option C: WAV only.** No conversion. Every audio file must be re-exported by the author. Simplest and fully reversible, but it fails the beginner who has only MP3 files.

**Tradeoffs.** A converts more, costs more decoder work, and needs the gapless frame-count rule for each format. B is the middle path. C removes the converter for audio entirely. Size: a converted song is far larger than its MP3 (F2, about 10 MB a minute stereo 16-bit). Corpus evidence is 0 MP3/OGG files, so the cost is for future games only.

**Recommendation: 1A.** F2 already rules it, and it keeps the 3.1.0 MP3 and Ogg playback behaviour (Q17). Mark this as the author's choice.

**Unblocks:** 14.12 (audio conversion), once the converter in Question 5 is chosen.

### 2. Video import profile

What does a converted cutscene look like?

1. **Option A: WebM, VP9 video and Opus audio (V1 as written).** Open codecs, no patent licence fee for the target. Browser support is **unverified** until epic 9 checks it.
2. **Option B: H.264 video and AAC audio in MP4.** Decodes almost everywhere. V1 rejects it for patent encumbrance ("an author may still choose it if epic 9 verifies support"). Patent position needs owner review.
3. **Option C: both, chosen per project.** The importer writes WebM by default and offers MP4 when the author asks for it.

**Tradeoffs.** A is open and the repo already leans on it. B is more widely decodable but carries patent questions the repo does not settle. C adds a second test path and a setting that beginners must understand.

**Recommendation: 2A.** It matches V1, and epic 9 must verify browser support before the importer exists. Mark this as the author's choice. If epic 9 finds VP9 or Opus unsupported on a target, the owner must choose between B and an amended profile.

**Unblocks:** 14.13 (video conversion).

### 3. Logical names and the original file

When a file is converted, what happens to the original?

1. **Option A: replace under the same name; keep the original in a recovery copy in the project folder.** Game data reads the same name. The author can restore the source. The recovery copy is never packed into the game package.
2. **Option B: replace under the same name; discard the original.** Smallest project. An error in the converter cannot be undone without re-importing the source the author kept elsewhere.
3. **Option C: keep the original in the package beside the converted copy.** Nothing is lost, but the package grows and the game references two files of one name.

**Tradeoffs.** A is reversible and keeps the package small. B is simpler but unrecoverable if the author deletes the source. C breaks the one-name rule that F2 and V1 both rely on.

**Recommendation: 3A.** It keeps F2's name rule and a reversible copy, with the recovery copy outside the package. Mark this as the author's choice.

**Unblocks:** 14.12, 14.13 and 14.14 (integration with project import and package export).

### 4. Provenance report

Where does the record of each conversion go?

1. **Option A: a report file in the project folder, outside the package.** It lists the original name, the original and output SHA-256, delay trimmed and resampling, as F2 requires. The package is unchanged.
2. **Option B: a report inside the package.** Travels with the game. Adds a file the engine must ignore, which is a new contract.
3. **Option C: no report.** Simplest. The author cannot audit a conversion later.

**Recommendation: 4A.** F2 says the report is "not game data". Keeping it outside the package means the package format needs no new file. Mark this as the author's choice.

**Unblocks:** 14.12 and 14.13.

### 5. Which converters, and who installs them

Which tools may the editor call, and does the author install them?

1. **Option A: user-installed tools only (the ADR 0012 pattern).** The editor finds an FFmpeg already on the author's machine and reports a clear message if none is found. Nothing is bundled, so nothing enters a G6 review.
2. **Option B: bundle a pinned encoder and decoder with the editor.** The beginner needs nothing installed. Each bundled tool is a direct shipped dependency that must clear the Blue Oak Bronze tier (ADR 0034) and be pinned.
3. **Option C: user-installed by default; bundle later.** Ships quickly. Bundling becomes a separate decision after one release.

**Candidate tools.** These are candidates only. No dependency is selected or added here.

| Tool | Role | Licence (as I understand it) | Status |
| --- | --- | --- | --- |
| FFmpeg | decode and encode audio and video, both directions | LGPL-2.1-or-later by default; GPL when GPL-only components are enabled, so the build flags decide | [UNVERIFIED] for the build the owner would use |
| libopus | Opus encode and decode | BSD-3-Clause | [UNVERIFIED] |
| libvpx | VP9 encode | BSD-3-Clause | [UNVERIFIED] |
| libvorbis | Ogg Vorbis decode | BSD-3-Clause | [UNVERIFIED] |
| libFLAC | FLAC decode | BSD-3-Clause (library) | [UNVERIFIED] |

**Tradeoffs.** A keeps the editor small and leaves the licence question with the user who installs the tool. It asks beginners to install something, and it can fail when they do not. B removes that step but makes the editor carry each converter, which is a G6 review each time. C defers the choice. [INFERENCE] Whether a bundled FFmpeg would count as a direct dependency under ADR 0034 depends on how the editor links it, so this needs a separate check before any bundling.

**Recommendation: 5A.** It follows ADR 0012, which already rules FFmpeg user-installed, and it avoids a G6 review for this story. Mark this as the author's choice. Verify each licence from the upstream source before bundling any tool (option B or C).

**Unblocks:** 14.12, 14.13 and 14.14.

### 6. Browser versus desktop

Can a browser-hosted editor convert media?

1. **Option A: desktop only.** A browser-hosted editor shows "Converting media needs the desktop editor" and keeps the original file. Honest, and it needs no new dependency.
2. **Option B: browser conversion through a WebAssembly build of FFmpeg.** Works everywhere. It adds a large dependency that must clear G6 and changes memory use. Not selected here.
3. **Option C: both, with the browser path deferred.** Desktop ships first. The browser path is ruled later.

**Tradeoffs.** A is simple and honest. B is powerful and expensive. C matches a staged rollout. [INFERENCE] Browser `decodeAudioData` is rejected in F2 because its delay and padding differ by browser, so it cannot serve as the converter for the exact-length rule.

**Recommendation: 6A.** The desktop shell is Electron (ADR 0013), so conversion can run in the desktop build. Mark this as the author's choice.

**Unblocks:** 14.12, 14.13 and 14.14 (the host checks each conversion must make).

### 7. Status of the pending import rulings

F2 and V1 are headed "pending owner review". What is their status after this ADR?

1. **Option A: ratify F2 and V1 as written now.** The status markers come off. V1's browser claim stays marked unverified until epic 9 checks it.
2. **Option B: ratify F2 now; keep V1 pending until epic 9 verifies VP9 and Opus.** The audio rule is settled, and the video profile waits for evidence.
3. **Option C: keep both pending.** No change until the owner returns to them.

**Tradeoffs.** A is fastest. B keeps V1 honest about its unverified target. C leaves 14.12 and 14.13 with no settled contract.

**Recommendation: 7B.** Epic 9's verification is the evidence V1 asks for. This draft does **not** edit audio-media.md. Whoever applies the owner's answer edits the status markers there. Mark this as the author's choice.

**Unblocks:** 14.12 (audio, under 7B) and 14.13 (video, after epic 9 under 7B).

## What approval unblocks

| Story | Unblocked by |
| --- | --- |
| 14.12 Convert imported audio without breaking references | Questions 1, 3, 4, 5, 6, 7 |
| 14.13 Convert legacy video to the portable playback profile | Questions 2, 3, 4, 5, 6, 7 (and epic 9 verification of the target) |
| 14.14 Connect media conversion to project import and package export | Questions 3, 4, 5, 6 |

Story 14.11 closes only when the owner approves this ADR. Until then, no conversion code, converter dependency or report format may be written.

## Owner decisions

Pending. Each question above needs an answer from the owner. The recommendation is the author's and carries no authority.
