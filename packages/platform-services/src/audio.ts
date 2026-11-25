import { platformError, platformOk, type PlatformResult } from "./result.ts";

/**
 * The `audio` surface of AD-20, as far as story 14.5 needs it: audition of game audio. A host plays one WAV or MIDI
 * file at a time through its synth and audio output, and stops it. The editor offers this where a sound is chosen
 * (the board music picker, battle backgrounds and menu sounds, animation sound markers); it is not a player window.
 *
 * Audition never alters or saves the source asset: the caller's bytes are copied before a host sees them. A host that
 * cannot play sound does not provide this service and does not declare the `audioOutput` capability; the editor then
 * says so and offers no audition control.
 */
export type AuditionFormat = "wav" | "midi";

export interface AuditionOptions {
  /** Play again from the start when the sound ends, until `stop`. */
  readonly loop: boolean;
  /**
   * The bytes of the project's configured SoundFont (`defaultSoundFont`), used for MIDI. `null` when the project sets
   * none: the MIDI then plays with the bundled default bank, as the game does (`audio-media.md#soundfont-layers`,
   * rank 4). Ignored for WAV.
   */
  readonly soundFont: Uint8Array | null;
}

export interface AudioOutputService {
  /**
   * Start playing `bytes` in `format`, replacing any sound already playing. An unsupported format is `unavailable`; a
   * browser that has not yet been given a user gesture refuses with `permission-denied`, and the message says to click
   * the page and play again.
   */
  play(bytes: Uint8Array, format: AuditionFormat, options: AuditionOptions): Promise<PlatformResult<void>>;
  /** Stop the sound that is playing. Stopping when nothing plays succeeds. */
  stop(): Promise<PlatformResult<void>>;
}

/**
 * What a host reports when it tries to play. A refusal is a value, not an exception, so the factory can name the reason
 * in the message rather than guessing it from a thrown error.
 */
export type AudioPlayOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "unsupported-format" | "autoplay-locked" | "missing-soundfont" | "output-unavailable"; readonly detail: string };

/** The audio output of a host, with no DOM dependency: the host's own synth and audio graph sit behind it. */
export interface AudioOutputApi {
  play(bytes: Uint8Array, format: AuditionFormat, options: AuditionOptions): Promise<AudioPlayOutcome>;
  stop(): void;
}

/**
 * An `AudioOutputService` over a host's audio output, or `null` when the host has none. The bytes are copied before the
 * host sees them. A thrown error from the host becomes `unavailable`, never a thrown error here.
 */
export function audioOutputFromApi(api: AudioOutputApi | null | undefined): AudioOutputService | null {
  if (api === null || api === undefined || typeof api.play !== "function" || typeof api.stop !== "function") return null;
  return {
    async play(bytes, format, options) {
      let outcome: AudioPlayOutcome;
      try {
        outcome = await api.play(bytes.slice(), format, { loop: options.loop, soundFont: options.soundFont?.slice() ?? null });
      } catch {
        return platformError("unavailable", "Sound could not be played in this host. Try again, or use a different sound file.");
      }
      if (outcome.ok) return platformOk(undefined);
      if (outcome.reason === "autoplay-locked") {
        return platformError("permission-denied", "The browser blocked sound until you click the page. Click the page, then play again.");
      }
      return platformError("unavailable", outcome.detail);
    },
    async stop() {
      try {
        api.stop();
        return platformOk(undefined);
      } catch {
        return platformError("unavailable", "The sound could not be stopped in this host.");
      }
    },
  };
}
