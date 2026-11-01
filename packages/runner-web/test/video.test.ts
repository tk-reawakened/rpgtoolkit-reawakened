// The runner's video half (docs/spec/engine/audio-media.md#video-request, #video-music): one reply per request, a hold
// for every other voice, and never a hang. The page binds a `<video>` element; these tests drive the same object without
// a DOM, which is also why the presentation rule is asserted as CSS rather than as pixels.

import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import type { AssetKey } from "@tk-reawakened/core";
import { VideoHost, videoPresentationStyle } from "../src/video.ts";
import type { VideoDiagnostic } from "../src/video.ts";

type Harness = {
  readonly host: VideoHost;
  readonly ended: number[];
  readonly diagnostics: readonly VideoDiagnostic[];
  readonly holds: number;
  readonly releases: number;
  finishWith: (reqId: number) => void;
  failWith: (reqId: number, detail: string) => void;
};

function harness(assets: ReadonlyMap<string, Uint8Array>): Harness {
  const ended: number[] = [];
  const diagnostics: VideoDiagnostic[] = [];
  let current: { reqId: number; stop: () => void } | null = null;
  let holds = 0;
  let releases = 0;
  const host = new VideoHost({
    readAsset: (key) => assets.get(key) ?? null,
    hold: () => {
      holds += 1;
    },
    release: () => {
      releases += 1;
    },
    ended: (reqId) => ended.push(reqId),
    diagnose: (diagnostic) => diagnostics.push(diagnostic),
    present: (_bytes, _presentation) => {
      current = { reqId: 0, stop: () => undefined };
      return current;
    },
  });
  return {
    host,
    ended,
    get diagnostics() {
      return diagnostics;
    },
    get holds() {
      return holds;
    },
    get releases() {
      return releases;
    },
    finishWith: (reqId) => host.finish(reqId),
    failWith: (reqId, detail) => host.finish(reqId, detail),
  };
}

const clip = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]); // a WebM EBML header, enough for a "fetch works" test
const assets = new Map<string, Uint8Array>([["media/cutscene.webm", clip]]);

test("a missing video replies immediately with media.video-missing and holds nothing", () => {
  const made = harness(assets);
  made.host.handle({ reqId: 7, key: "media/absent.webm" as AssetKey, presentation: "full" });
  deepEqual(made.ended, [7]);
  deepEqual(made.diagnostics.map((diagnostic) => diagnostic.code), ["media.video-missing"]);
  equal(made.holds, 0);
  equal(made.host.current, null);
});

test("a played video holds, and its end releases before the reply", () => {
  const made = harness(assets);
  made.host.handle({ reqId: 8, key: "media/cutscene.webm" as AssetKey, presentation: "full" });
  deepEqual(made.ended, [], "no reply until the video ends");
  equal(made.holds, 1);
  equal(made.host.isHolding, true);
  made.finishWith(8);
  deepEqual(made.ended, [8]);
  equal(made.releases, 1);
  equal(made.host.isHolding, false);
  equal(made.host.current, null);
});

test("a second video while one is playing gets media.video-busy and its own reply at once", () => {
  const made = harness(assets);
  made.host.handle({ reqId: 1, key: "media/cutscene.webm" as AssetKey, presentation: "full" });
  made.host.handle({ reqId: 2, key: "media/cutscene.webm" as AssetKey, presentation: "small" });
  deepEqual(made.ended, [2], "the busy request is answered, the first is untouched");
  deepEqual(made.diagnostics.map((diagnostic) => diagnostic.code), ["media.video-busy"]);
  equal(made.host.current?.reqId, 1);
});

test("a decode failure still gets exactly one reply, with a diagnostic", () => {
  const made = harness(assets);
  made.host.handle({ reqId: 3, key: "media/cutscene.webm" as AssetKey, presentation: "full" });
  made.failWith(3, "no VP9 decoder");
  deepEqual(made.ended, [3]);
  deepEqual(made.diagnostics.map((diagnostic) => diagnostic.code), ["media.video-format"]);
  // A second report for the same id is ignored: the reply is exactly one.
  made.host.finish(3);
  deepEqual(made.ended, [3]);
});

test("a reply for an unknown reqId is ignored", () => {
  const made = harness(assets);
  made.finishWith(99);
  deepEqual(made.ended, []);
  equal(made.releases, 0);
});

test("a present that throws is a diagnostic and a reply, not a hang", () => {
  const ended: number[] = [];
  const diagnostics: VideoDiagnostic[] = [];
  const host = new VideoHost({
    readAsset: () => clip,
    hold: () => {
      throw new Error("hold must not be called for a video that never started");
    },
    release: () => undefined,
    ended: (reqId) => ended.push(reqId),
    diagnose: (diagnostic) => diagnostics.push(diagnostic),
    present: () => {
      throw new Error("VP9 unsupported");
    },
  });
  host.handle({ reqId: 4, key: "media/cutscene.webm" as AssetKey, presentation: "full" });
  deepEqual(ended, [4]);
  deepEqual(diagnostics.map((diagnostic) => diagnostic.code), ["media.video-format"]);
  ok(diagnostics[0]?.detail.includes("VP9 unsupported"));
});

test("presentation is CSS: full fills, small centres at its own size and never upscales", () => {
  const full = videoPresentationStyle("full", { width: 640, height: 480 }, { width: 320, height: 240 });
  equal(full["objectFit"], "contain");
  equal(full["width"], "100%");

  const small = videoPresentationStyle("small", { width: 640, height: 480 }, { width: 320, height: 240 });
  deepEqual([small["width"], small["height"]], ["320px", "240px"]);
  deepEqual([small["left"], small["top"]], ["160px", "120px"]);

  const tooBig = videoPresentationStyle("small", { width: 640, height: 480 }, { width: 1280, height: 960 });
  deepEqual([tooBig["width"], tooBig["height"]], ["640px", "480px"], "a larger video is scaled down, never up");
  deepEqual([tooBig["left"], tooBig["top"]], ["0px", "0px"]);
});
