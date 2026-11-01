/**
 * The runner's video half (`docs/spec/engine/audio-media.md#video-request`, `#video-policy`, `#video-music`).
 *
 * A `playVideo` request is a **stream** request: no bytes go back, so the runner fetches the asset by its key, presents
 * it, and answers exactly one `video.ended { reqId }` — including on every failure, so a bad video can never hang a
 * game. While it plays the runner holds every realised voice but the music, which the core already stopped in the same
 * tick; the music's restart arrives as the core's own `music.play` cue and is not this module's business.
 *
 * This module is the policy and the state machine, with no DOM: the host binds a `<video>` element through `attach`, and
 * the same object is what a test drives. `presentation` is runner presentation, never state: `"full"` fits the logical
 * screen with the aspect ratio kept, `"small"` shows the video at its own size, centred and never upscaled.
 */

import type { AssetKey } from "@tk-reawakened/core";

/** The request fields the runner reads (AD-17 as amended by V2). */
export type PlayVideoInput = {
  readonly reqId: number;
  readonly key: AssetKey;
  readonly presentation: "full" | "small";
};

export type VideoDiagnostic = {
  readonly code: "media.video-missing" | "media.video-busy" | "media.video-format";
  readonly detail: string;
};

export type VideoHostOptions = {
  /** The asset's bytes; `null` when the game does not carry it (`media.video-missing`). */
  readonly readAsset: (key: AssetKey) => Uint8Array | null;
  /** Start the hold: the cue player pauses every realised voice but the stopped music. */
  readonly hold: () => void;
  /** Release the hold, before the core's restart cue is processed. */
  readonly release: () => void;
  /** Queue the one `video.ended { reqId }` input (AD-14). */
  readonly ended: (reqId: number) => void;
  /** A runner diagnostic; the request still gets its `video.ended`. */
  readonly diagnose: (diagnostic: VideoDiagnostic) => void;
  /**
   * Ask the browser to make the bytes decodable, returning a handle whose `finished` resolves when playback ends and
   * whose `failure` reports an undecodable container. The page implements this over a `<video>` element; a test
   * implements it directly.
   */
  readonly present: (bytes: Uint8Array, presentation: "full" | "small") => { readonly stop: () => void };
};

type Active = { readonly reqId: number; readonly stop: () => void };

/**
 * The video host: one outstanding video at a time (rule 2), one reply per request (rule 3), a reply for an unknown
 * `reqId` ignored (rule 4), and no skip (rule 5 — there is nothing here to call).
 */
export class VideoHost {
  private readonly options: VideoHostOptions;
  private active: Active | null = null;
  private readonly replies: number[] = [];
  private readonly held: boolean[] = [];

  constructor(options: VideoHostOptions) {
    this.options = options;
  }

  /** The request being played, or `null`. */
  get current(): { readonly reqId: number } | null {
    return this.active === null ? null : { reqId: this.active.reqId };
  }

  /** Every `video.ended` this host has queued, in order. */
  get endedReplies(): readonly number[] {
    return this.replies;
  }

  /** Whether a hold is in force, as the host last set it. */
  get isHolding(): boolean {
    return this.held.at(-1) ?? false;
  }

  /** Handle one `playVideo` request from a `TickReport`. */
  handle(request: PlayVideoInput): void {
    if (this.active !== null) {
      // At most one video is outstanding; the later call gets its reply immediately and is otherwise ignored.
      this.options.diagnose({ code: "media.video-busy", detail: `req ${request.reqId}: ${this.active.reqId} is still playing` });
      this.reply(request.reqId);
      return;
    }
    const bytes = this.options.readAsset(request.key);
    if (bytes === null) {
      this.options.diagnose({ code: "media.video-missing", detail: `req ${request.reqId}: ${request.key} is not in the game` });
      this.reply(request.reqId);
      return;
    }
    let presentation: { readonly stop: () => void };
    try {
      presentation = this.options.present(bytes, request.presentation);
    } catch (error) {
      this.options.diagnose({ code: "media.video-format", detail: `req ${request.reqId}: ${error instanceof Error ? error.message : String(error)}` });
      this.reply(request.reqId);
      return;
    }
    this.active = { reqId: request.reqId, stop: presentation.stop };
    this.hold();
  }

  /**
   * The element reported the end — or an error, which is the same reply with a diagnostic. A second call for the same
   * `reqId`, and a call for any other id, is ignored (rule 4).
   */
  finish(reqId: number, failure: string | null = null): void {
    if (this.active === null || this.active.reqId !== reqId) return;
    this.active = null;
    if (failure !== null) this.options.diagnose({ code: "media.video-format", detail: `req ${reqId}: ${failure}` });
    this.release();
    this.reply(reqId);
  }

  /** Abandon whatever is playing (a page teardown, a reload): the hold is released and no reply is invented. */
  dispose(): void {
    this.active?.stop();
    this.active = null;
    if (this.isHolding) this.release();
  }

  private hold(): void {
    this.held.push(true);
    this.options.hold();
  }

  private release(): void {
    this.held.push(false);
    this.options.release();
  }

  private reply(reqId: number): void {
    this.replies.push(reqId);
    this.options.ended(reqId);
  }
}

/**
 * The presentation CSS for the two modes: `full` fits the logical screen with the aspect ratio kept and black bars,
 * `small` is the video's own pixel size (centred, and scaled **down**, never up, when it is larger than the screen).
 */
export function videoPresentationStyle(presentation: "full" | "small", screen: { readonly width: number; readonly height: number }, size: { readonly width: number; readonly height: number }): { readonly [property: string]: string } {
  if (presentation === "full") {
    return { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "contain", background: "black" };
  }
  const scale = Math.min(1, screen.width / Math.max(1, size.width), screen.height / Math.max(1, size.height));
  const width = Math.max(1, Math.floor(size.width * scale));
  const height = Math.max(1, Math.floor(size.height * scale));
  return {
    position: "absolute",
    left: `${Math.floor((screen.width - width) / 2)}px`,
    top: `${Math.floor((screen.height - height) / 2)}px`,
    width: `${width}px`,
    height: `${height}px`,
    objectFit: "fill",
    background: "black",
  };
}
