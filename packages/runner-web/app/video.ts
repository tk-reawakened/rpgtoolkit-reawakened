/**
 * The video page (entry 9.6): the runner's video policy in a real browser.
 *
 * A `playVideo` request is answered exactly once — including on every failure — and while it plays the runner holds the
 * other voices. No VP9/WebM fixture ships yet, so the page proves the parts that do not need one: a missing asset
 * (`media.video-missing`), an undecodable container through a real `<video>` element (`media.video-format`), the
 * one-outstanding rule (`media.video-busy`), and the hold/release the cue player performs for the video's duration.
 * The played path is 9.7's, and the plan records that it needs a fixture.
 */

import type { AssetKey } from "@tk-reawakened/core";
import { CuePlayer, type AudioMessage } from "@tk-reawakened/synth";
import { VideoHost, videoPresentationStyle } from "../src/video.ts";
import type { VideoDiagnostic } from "../src/video.ts";

type VideoReport = {
  readonly missing: { readonly replies: readonly number[]; readonly code: string | null };
  readonly undecodable: { readonly replies: readonly number[]; readonly code: string | null; readonly held: boolean; readonly released: boolean };
  readonly busy: { readonly replies: readonly number[]; readonly code: string | null };
  readonly hold: { readonly paused: number; readonly resumed: number };
  readonly presentation: { readonly full: string; readonly small: readonly [string, string] };
  readonly mediaErrors: readonly string[];
};

declare global {
  interface Window {
    __video?: VideoReport;
  }
}

void (async () => {
  const sent: AudioMessage[] = [];
  // A realised voice to hold; the bytes only need to exist for the cue player, which never decodes.
  const player = new CuePlayer({ send: (message) => sent.push(message), readAsset: () => new Uint8Array([1, 2, 3]) });
  player.reach(0);
  // One realised voice to hold: a WAV voice with no bank needed.
  player.advance([{
    cueId: 1, tick: 0, kind: "media.play", track: "ambience", voice: 0,
    asset: "media/loop.wav" as AssetKey, loop: true, flags: 1, positionTicks: 0, volume: 100, targetVolume: null, durationTicks: null,
  }]);
  player.ready(1, 600);
  const pausedBefore = sent.filter((message) => message.kind === "pause").length;
  const resumedBefore = sent.filter((message) => message.kind === "resume").length;

  const replies: number[] = [];
  const diagnostics: VideoDiagnostic[] = [];
  const mediaErrors: string[] = [];
  const assets = new Map<string, Uint8Array>([["media/junk.webm", new Uint8Array([0x4e, 0x4f, 0x54, 0x41, 0x56, 0x49, 0x44, 0x45, 0x4f])]]);
  let active: { reqId: number; stop: () => void } | null = null;

  const host = new VideoHost({
    readAsset: (key) => assets.get(key) ?? null,
    hold: () => player.videoStarted(),
    release: () => player.videoEnded(),
    ended: (reqId) => replies.push(reqId),
    diagnose: (diagnostic) => diagnostics.push(diagnostic),
    present: (bytes, presentation) => {
      // A real <video>, from a Blob URL: the browser's own decoder decides, as it will for a real cutscene.
      const element = document.createElement("video");
      element.muted = true;
      element.playsInline = true;
      const style = videoPresentationStyle(presentation, { width: 640, height: 480 }, { width: 320, height: 240 });
      for (const [property, value] of Object.entries(style)) element.style.setProperty(property, value);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "video/webm" }));
      element.src = url;
      element.addEventListener("error", () => {
        mediaErrors.push(element.error === null ? "unknown" : `code ${element.error.code}`);
        host.finish(1, "the browser could not decode the container");
      });
      element.addEventListener("ended", () => host.finish(1));
      document.body.append(element);
      void element.play().catch((error: unknown) => mediaErrors.push(String(error)));
      active = {
        reqId: 1,
        stop: (): void => {
          element.pause();
          element.remove();
          URL.revokeObjectURL(url);
        },
      };
      return active;
    },
  });

  // 1. A missing asset: one reply, immediately, and no hold.
  host.handle({ reqId: 7, key: "media/absent.webm" as AssetKey, presentation: "full" });
  const missingCode = diagnostics.at(-1)?.code ?? null;

  // 2. An undecodable container through a real element: one reply once the element errors, and a hold meanwhile.
  host.handle({ reqId: 1, key: "media/junk.webm" as AssetKey, presentation: "small" });
  const heldDuringPlayback = player.isVideoHeld;

  // 3. While that one is current, the next request is busy and answered at once.
  host.handle({ reqId: 2, key: "media/junk.webm" as AssetKey, presentation: "full" });
  const afterSecond = diagnostics.at(-1)?.code ?? null;

  // Wait for the element's own verdict on req 1.
  const wait = new Promise<void>((resolve) => {
    const started = Date.now();
    const tick = (): void => {
      if (host.current === null || Date.now() - started > 5_000) resolve();
      else setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  });
  await wait;
  active = null;

  const full = videoPresentationStyle("full", { width: 640, height: 480 }, { width: 320, height: 240 });
  const small = videoPresentationStyle("small", { width: 640, height: 480 }, { width: 320, height: 240 });

  window.__video = {
    missing: { replies: [7].filter((id) => replies.includes(id)), code: missingCode },
    undecodable: {
      replies: [1].filter((id) => replies.includes(id)),
      code: mediaErrors.length > 0 ? diagnostics.find((diagnostic) => diagnostic.code === "media.video-format")?.code ?? null : null,
      held: heldDuringPlayback,
      released: !player.isVideoHeld,
    },
    busy: { replies: [2].filter((id) => replies.includes(id)), code: afterSecond },
    hold: {
      paused: sent.filter((message) => message.kind === "pause").length - pausedBefore,
      resumed: sent.filter((message) => message.kind === "resume").length - resumedBefore,
    },
    presentation: { full: full["objectFit"] ?? "", small: [small["width"] ?? "", small["height"] ?? ""] },
    mediaErrors,
  };
  window.document.title = `video: ${replies.length} replies`;
})();
