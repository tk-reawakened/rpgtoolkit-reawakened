/**
 * The desktop player page (entry 9.11; launch resolution added by entry 9.10): the same `runner-web` build, booted from
 * a package the **main process** resolved. It reports what the entry's evidence needs — which launch step named the
 * game, the tick-120 hashes, the four measurements and the save it wrote.
 */

import { type AssetKey, type DrawList, type HostDisplayGeometry } from "@tk-reawakened/core";
import { createWebgl2Renderer } from "@tk-reawakened/render-webgl2";
import { fontProvider, packageFiles, PcmSink } from "@tk-reawakened/runner-web";

import { frameBase64, renderClosingDemoFrame } from "./closing-frame.ts";
import {
  closingBundled,
  closingManifestLoader,
  packagedDemoRecord,
  runClosingCheck,
  type ClosingManifest,
  type ClosingPageReport,
  type PackagedClosingReport,
} from "./closing-run.ts";

/** One row of the fallback listing: what a person picks from when nothing named a game. No hashes, no settings. */
export type LibraryRow = {
  readonly gameId: string;
  readonly title: string;
  readonly version: string;
  readonly lastPlayedAt: string | null;
};

/**
 * Which rule named the game, as the host resolved it (`docs/spec/engine/runners.md#install`). `library` and `none` carry
 * the rows to show and the sentence that says why nothing opened.
 */
export type LaunchInfo =
  | { readonly step: "argument" | "deep-link" | "config" | "baked"; readonly rows: readonly LibraryRow[]; readonly reason: null }
  | { readonly step: "library" | "none"; readonly rows: readonly LibraryRow[]; readonly reason: string };

/**
 * What a wrapper's bridge must provide: the desktop preload's calls, and the mobile host's four. `gameId` names a
 * library entry to open; omitting it resolves the default order. `launchInfo` is optional because a wrapper that has no
 * launch resolution (mobile today) simply does not offer one.
 */
export type PlayerHost = {
  openPackage(gameId?: string): Promise<{ readonly name: string; readonly bytes: Uint8Array } | null>;
  launchInfo?(): Promise<LaunchInfo>;
  writeBlob(area: "saves" | "files", gameId: string, path: string, bytes: Uint8Array): Promise<boolean>;
  readBlob(area: "saves" | "files", gameId: string, path: string): Promise<Uint8Array | null>;
};

export type PlayerReport = {
  scheme: string;
  serviceWorkers: number;
  /** Which launch step named the game; `host` when the wrapper reports no resolution (the mobile wrapper today). */
  resolvedBy: string;
  /** The library entry the page opened, or `null`. */
  picked: string | null;
  /** Why no game opened, when that is what happened. */
  reason: string | null;
  packageName: string;
  tick: number;
  stateHash: string;
  drawHash: string;
  commands: number;
  webgl2: string;
  blendWorst: number;
  audio: { lengthTicks: number | null; energy: number };
  /**
   * The presented frame and its agreement with the reference rasteriser. Absent when nothing was measured — a launch that
   * named no game reports its reason instead, and a reader must not assume a frame exists.
   *
   * `rgba` carries the base64 pixels only when the caller asked to capture them.
   */
  frame?: { worst: number; width: number; height: number; rgba?: string };
  save: { gameId: string; path: string; written: boolean; bytes: number };
  /** The closing suite's verdict, present only when the page was asked to run it (entry 9.14). */
  closing?: ClosingPageReport & { readonly packaged?: PackagedClosingReport };
  error: string | null;
};

/**
 * Boot the page's measurement against one wrapper's bridge and report what it measured. One implementation for the
 * desktop shell and the mobile wrapper (runners.md#mobile's MUST NOT: a platform difference is a host service, never a
 * second rendering, input or asset path).
 */
export async function bootPlayerPage(
  bridge: PlayerHost | undefined,
  options: { readonly captureFrame?: boolean; readonly closing?: boolean } = {},
): Promise<PlayerReport> {
  const report = { error: null as string | null, resolvedBy: "unknown", picked: null, reason: null } as PlayerReport;
  try {
    const host = bridge;
    if (host === undefined) throw new Error("the host bridge is absent");

    // The closing suite (entry 9.14): the same check the headless runner and the PWA page run, over `app://`. It needs no
    // launched game — the fixtures and the baseline are static files under the served root — so it returns before the
    // single-game measurement below.
    if (options.closing === true) {
      const planText = await (await fetch("/golden/closing/plan.json")).text();
      const manifest = (await (await fetch("/apps/desktop/closing-files.json")).json()) as ClosingManifest;
      const bundled = await closingBundled("", "desktop");
      const suite = await runClosingCheck({
        planText,
        baselineText: await (await fetch("/golden/regression/closing.json")).text(),
        ledgerText: await (await fetch("/golden/ledger.json")).text(),
        bundled,
        load: closingManifestLoader("", manifest, "desktop"),
        readPng: async (path) => {
          const response = await fetch(`/${path}`);
          return response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined;
        },
      });
      const packaged = await packagedDemoRecord({
        planText,
        bundled,
        reference: suite.games,
        packageFiles: (name, bytes) => packageFiles(name, bytes),
      });
      report.closing = { ...suite, ...(packaged === undefined ? {} : { packaged }) };
      report.resolvedBy = "closing-suite";
      report.error = suite.ok ? null : (suite.lines.at(-1) ?? "the closing suite failed");
      return report;
    }
    // The page is on `app://`, and no service worker is registered or claimed.
    const scheme = location.protocol.replace(":", "");
    // The scheme is registered without `allowServiceWorkers`, so the API refuses here; that refusal is the proof that no
    // worker is registered (ADR 0013 decision 3).
    let serviceWorkers = 0;
    try {
      serviceWorkers = "serviceWorker" in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0;
    } catch {
      serviceWorkers = 0;
    }

    // Which rule named the game (entry 9.10). A wrapper without a resolution reports `host` and opens its one package.
    const info = await host.launchInfo?.();
    // Recorded before the refusal below, so a launch that names no game still reports which step decided that.
    report.resolvedBy = info?.step ?? "host";
    if (info !== undefined && info.step === "none") throw new Error(info.reason);
    // The `library` step has no game until someone picks one; this measurement picks the first row, which is the only
    // entry its case registers, and records which one it took.
    const picked = info !== undefined && info.step === "library" ? info.rows[0]?.gameId ?? null : null;
    const opened = await host.openPackage(picked ?? undefined);
    if (opened === null) throw new Error("no package was named on the command line");
    const files = packageFiles(opened.name, new Uint8Array(opened.bytes));

    const planText = await (await fetch("/golden/closing/plan.json")).text();
    // Bundled assets travel with the build, not with the game; a desktop origin has no directory listing, so the build
    // writes the list beside the bundle.
    const bundled = new Map<string, Uint8Array>();
    const listed = (await (await fetch("/apps/desktop/bundled.json")).json()) as { files: readonly string[] };
    for (const name of listed.files) {
      const response = await fetch(`/${name}`);
      if (response.ok) bundled.set(name, new Uint8Array(await response.arrayBuffer()));
    }

    // Measurement 1: WebGL2 present, and its limits.
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, antialias: false, alpha: true, preserveDrawingBuffer: true });
    if (gl === null) throw new Error("no WebGL2 context");
    const webgl2 = `webgl2 ${String(gl.getParameter(gl.VERSION))} max ${String(gl.getParameter(gl.MAX_TEXTURE_SIZE))}`;

    // Measurement 5: the frame through the replayer, and the same draw list through the reference. One implementation of
    // that comparison, shared with the PWA's parity page (entry 9.10).
    const rendered = renderClosingDemoFrame({ files, bundled, fonts: fontProvider(bundled), planText });

    // Measurement 2: the D-7 blend bound, on the committed vector that exercises the blend arithmetic.
    const kit = (await (await fetch("/tools/fixtures/conformance/raster/vectors.json")).json()) as {
      vectors: readonly { id: string; width: number; height: number; texture?: { asset: string; w: number; h: number; rgba: string }; commands: readonly unknown[]; rgba: string }[];
    };
    const blend = kit.vectors.find((vector) => vector.id === "translucent-127");
    let blendWorst = 0;
    if (blend !== undefined) {
      const blendCanvas = document.createElement("canvas");
      const blendGl = blendCanvas.getContext("webgl2", { premultipliedAlpha: false, antialias: false, alpha: true, preserveDrawingBuffer: true });
      if (blendGl !== null) {
        const texture = blend.texture;
        const blendTextures = new Map<AssetKey, { w: number; h: number; rgba: Uint8Array }>();
        if (texture !== undefined) {
          const bytes = new Uint8Array(texture.rgba.length / 2);
          for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(texture.rgba.slice(index * 2, index * 2 + 2), 16);
          blendTextures.set(texture.asset as AssetKey, { w: texture.w, h: texture.h, rgba: bytes });
        }
        const blendRenderer = createWebgl2Renderer(blendGl);
        const blendList: DrawList = { tick: 0, width: blend.width, height: blend.height, commands: blend.commands as DrawList["commands"], marginCommands: [] };
        const blendGeometry: HostDisplayGeometry = {
          content: { width: blend.width, height: blend.height },
          game: { x: 0, y: 0, width: blend.width, height: blend.height },
          safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
        };
        blendRenderer.render(blendList, blendGeometry, { textures: (asset) => blendTextures.get(asset) ?? null });
        const out = new Uint8Array(blend.width * blend.height * 4);
        blendGl.readPixels(0, 0, blend.width, blend.height, blendGl.RGBA, blendGl.UNSIGNED_BYTE, out);
        const expected = new Uint8Array(blend.rgba.length / 2);
        for (let index = 0; index < expected.length; index += 1) expected[index] = Number.parseInt(blend.rgba.slice(index * 2, index * 2 + 2), 16);
        const bs = blend.width * 4;
        const flipped = new Uint8Array(out.length);
        for (let row = 0; row < blend.height; row += 1) flipped.set(out.subarray(row * bs, (row + 1) * bs), (blend.height - 1 - row) * bs);
        for (let index = 0; index < expected.length; index += 1) blendWorst = Math.max(blendWorst, Math.abs(expected[index]! - flipped[index]!));
        blendRenderer.dispose();
      }
    }

    // Measurement 3: audio of the expected length, pulled from the same sink the browser uses.
    const audioBytes = new Uint8Array(
      await (await fetch("/packages/core/test/fixtures/audio/files/pcm16-mono-8000.wav")).arrayBuffer(),
    );
    let lengthTicks: number | null = null;
    const sink = new PcmSink({
      readAsset: () => audioBytes,
      outputRateHz: 8_000,
      onEvent: (event) => {
        if (event.kind === "ready") lengthTicks = event.lengthTicks;
      },
    });
    sink.handle({ kind: "load", voice: 1, track: "sfx", asset: "media/probe.wav" as AssetKey, data: audioBytes });
    sink.handle({ kind: "play", voice: 1, cue: 1, loop: false, volume: 100, positionTicks: 0 });
    const audioFrames = 2_400;
    const left = new Float32Array(audioFrames);
    const right = new Float32Array(audioFrames);
    sink.render(left, right, audioFrames);

    // The save this runner writes, under the descriptor's GameId, for the web runner to read back.
    const gameId = "desktop-probe-game";
    const savePath = "slot-1.json";
    const saveBytes = new TextEncoder().encode(JSON.stringify({ gameId, tick: rendered.tick }));
    const written = await host.writeBlob("saves", gameId, savePath, saveBytes);
    // The web runner reads it back through the same AD-17 key, which is what makes the save portable between runners.
    const readBack = await host.readBlob("saves", gameId, savePath);

    report.scheme = scheme;
    report.serviceWorkers = serviceWorkers;
    report.picked = picked;
    report.packageName = opened.name;
    report.tick = rendered.tick;
    report.stateHash = rendered.stateHash;
    report.drawHash = rendered.drawHash;
    report.commands = rendered.commands;
    report.webgl2 = webgl2;
    report.blendWorst = blendWorst;
    report.audio = { lengthTicks, energy: PcmSink.energy(left, audioFrames) };
    report.frame = {
      worst: rendered.worst,
      width: rendered.width,
      height: rendered.height,
      ...(options.captureFrame === true ? { rgba: frameBase64(rendered.topFirst) } : {}),
    };
    report.save = { gameId, path: savePath, written: written && readBack !== null && readBack.length === saveBytes.length, bytes: saveBytes.length };
    report.error = null;

  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    report.reason = report.error;
  }
  return report;
}
