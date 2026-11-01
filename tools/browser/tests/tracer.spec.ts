import { expect, test } from "@playwright/test";

test("demo tracer reports the committed tick-120 hashes and presents its captured frame", async ({ page }) => {
  const started = Date.now();
  await page.goto("/packages/runner-web/app/index.html?game=demo&tracer=1");
  await page.waitForFunction(() => window.__report !== undefined, undefined, { timeout: 45_000 });
  const report = await page.evaluate(() => window.__report as Record<string, unknown>);
  const seconds = (Date.now() - started) / 1000;
  console.log(`demo boot to report: ${seconds.toFixed(2)}s`, JSON.stringify(report));
  expect(report["error"]).toBeUndefined();
  expect(report["package"]).toBeNull();
  expect(report["tick"]).toBe(120);
  expect(report["stateHash"]).toBe("91172695de52cfd6");
  expect(report["drawHash"]).toBe("9a40be8a0b5ca816");
  expect(report["commands"]).toBe(128);
  const render = report["render"] as { drawn: number; deferred: number; deferredByKind: Record<string, number> };
  expect(render.drawn).toBe(128);
  expect(render.deferred).toBe(0);
  expect(render.deferredByKind["text"]).toBeUndefined();
  const sample = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (canvas === null) return null;
    const gl = canvas.getContext("webgl2");
    if (gl === null) return null;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let nonBlack = 0;
    for (let index = 0; index < pixels.length; index += 4) if (pixels[index] !== 0 || pixels[index + 1] !== 0 || pixels[index + 2] !== 0) nonBlack += 1;
    return { width: canvas.width, height: canvas.height, nonBlack };
  });
  expect(sample).not.toBeNull();
  expect(sample?.width).toBe(640);
  expect(sample?.height).toBe(480);
  expect(sample?.nonBlack ?? 0).toBeGreaterThan(1000);
  expect(seconds, "boot cost, for the record").toBeLessThan(30);
});

test("the browser probes VP9+Opus and no WebAssembly on the default player path", async ({ page }) => {
  await page.goto("/packages/runner-web/app/index.html?game=demo");
  const probes = await page.evaluate(() => {
    const video = document.createElement("video");
    return {
      vp9: video.canPlayType('video/webm; codecs="vp9"'),
      opus: video.canPlayType('audio/webm; codecs="opus"'),
      wasm: typeof WebAssembly,
      wasmUsed: (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).some((entry) => entry.name.endsWith(".wasm")),
    };
  });
  expect(probes.vp9).not.toBe("");
  expect(probes.opus).not.toBe("");
  expect(probes.wasmUsed).toBe(false);
});
