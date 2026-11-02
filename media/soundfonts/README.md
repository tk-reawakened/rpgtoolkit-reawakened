# TK-16 SoundFonts

Three compact General MIDI SoundFont 2 banks for RPG Toolkit Reawakened, built entirely from
mathematics. They are small (about half a megabyte each), they carry no recorded samples, and they
are dedicated to the public domain under CC0 1.0 (see [LICENSE](LICENSE)).

| File | Style | What it sounds like |
|---|---|---|
| `TK-16.sf2` | **Classic RPG** (the default) | A textbook chip-music palette: saw and pulse blends, a static low-pass and a standard envelope for each instrument family. Warm, clear and tidy. |
| `TK-16-Whimsical.sf2` | Whimsical | The classic palette with cartoon behaviour: a tack piano, toy marimba, rubber bass, kazoo-like reed, boing lead, late-vibrato whistle, brass and voices that scoop into notes, a water-drop boop for effects, and a toy percussion kit. |
| `TK-16-Arcade.sf2` | Arcade | A cabinet board: two-operator FM bass and chime, feedback-FM guitar and lead, a ripping pulse brass, a power chord, a clipped kick and a gated crack of a snare. |

## Using them

Load any of them in a SoundFont 2 player or synthesiser (SpessaSynth, FluidSynth, TinySoundFont,
and so on). They follow General MIDI Level 1:

- Programs 0-127 on bank 0, with middle C at key 60. (General MIDI numbers programs from 1, so
  preset 0 is GM program 1.)
- Percussion on bank 128, program 0, with a distinct sound on every key from 35 to 81.
- Each bank has 16 instruments that every General MIDI program is mapped onto by family: piano,
  bright piano, electric piano, organ, guitar, bass, strings, choir, brass, reed or synth, bell,
  lead, pad, pluck, flute and effects. That is what makes them small. They are **compact
  synthesised banks, not realistic General MIDI banks**: a trombone and a trumpet share a voice.

Samples loop on whole numbers of waveform cycles, and each loop plays the note it is written for:
every melodic program measures within a cent of the written pitch once any start-up pitch bend
has settled.

## How they are made

Everything comes from `tools/licences/tk16_build.py` in the main repository. It synthesises each
sample from formulas (additive harmonics, pulse waves, two-operator FM and feedback FM, shaped noise
from a 15-bit shift register), writes the SoundFont tables, and records every sample in
`tools/licences/tk16-provenance.json`: its generator, root key, rate and loop. The build is
deterministic. A test rebuilds all three banks and checks them byte for byte against these files
(`pnpm licence:test`).

No recorded or third-party sample, waveform, envelope table or tuning table is read or embedded.
The sound of each style was chosen by listening to, and coarsely measuring, reference sample sets
(attack time, brightness, decay, grit). That is the only thing that came from them, and none of
their audio is in the build or in these files.

To change a sound, edit the generator, rebuild, and run the checks. Do not edit the `.sf2` files by
hand:

```bash
python3 tools/licences/tk16_build.py
pnpm licence && pnpm licence:test
node --test packages/synth/test/tk16-bank.test.ts packages/synth/test/tk16-pieces.test.ts
```

## Known limits

- No effects are stored in the files. There is no reverb, chorus or echo, and an echo cannot be
  stored in a SoundFont for looped voices, so it belongs to the player.
- Several instruments start with a deliberate pitch bend (bass, brass, the Whimsical boing and
  scoops), so a very short note can be heard off pitch by design.
- Vibrato on sustained voices (strings, organ, whistle and so on) is part of the sound, so a long
  held note moves slightly.
- Reed, brass and pipe programs share voices, so a woodwind section sounds like one family.

## Licence

The banks are CC0 1.0 Universal: you can copy, modify, distribute and use them for any purpose,
including commercially, without asking or crediting anyone. See [LICENSE](LICENSE) for the legal
code. The generator that makes them (`tools/licences/tk16_build.py`) is part of the project's own
code and is released under its MIT licence (the repository's `LICENSE`). The project's
bundled-asset record is `THIRD_PARTY_NOTICES` at the repository root and
`tools/licences/config.json`, which also carry each file's hash.

### Music you make with them

Songs, rendered audio and game soundtracks made with these banks belong to whoever composed them.
You can use rendered audio in commercial and non-commercial games with no credit, no notice and no
licence text in your game. The only thing the licence ever asks of you is nothing: the banks are in
the public domain.
