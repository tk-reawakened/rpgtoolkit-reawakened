import { detectMidi, detectWav } from "@tk-reawakened/core";

/** What a playable audio file is, judged by its own first bytes. */
export type AudioContent = "wav" | "midi";

/**
 * Whether the bytes are a RIFF/WAVE container or a Standard MIDI File, by header alone. The game decides the same way
 * (`docs/spec/engine/audio-media.md#audio-format-policy`: an extension alone never selects a decoder), so a valid WAV
 * stored as `theme.mp3` plays and an `.wav` that holds other bytes does not.
 */
export function audioContentOf(bytes: Uint8Array): AudioContent | null {
  if (detectWav(bytes)) return "wav";
  if (detectMidi(bytes)) return "midi";
  return null;
}

/**
 * What a picker accepts besides the extensions it lists. `audio` also offers a file whose extension is not listed when
 * its bytes are a WAV or MIDI header, so a valid sound kept under another logical name can be chosen.
 */
export type AssetContent = "audio";

/** Whether `bytes` satisfy the content rule. */
export function matchesAssetContent(content: AssetContent, bytes: Uint8Array): boolean {
  return content === "audio" && audioContentOf(bytes) !== null;
}
