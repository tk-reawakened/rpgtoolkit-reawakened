import { expect, test } from "@playwright/test";

/**
 * The tracer's evidence (entry 9.3): a sample game boots in a real browser from the same core build the headless runner
 * uses, reports the committed closing-suite hashes at tick 120, and presents the frame through WebGL2.
 *
 * `golden/regression/closing.json` carries both numbers; this lane does not re-baseline them.
 */
test("demo boots in Chromium to the committed tick-120 hashes", async ({ page }) => {
  const started = Date.now();
  await page.goto("/packages/runner-web/app/index.html?game=demo");
  await page.waitForFunction(() => window.__report !== undefined, undefined, { timeout: 45_000 });
  const report = await page.evaluate(() => window.__report as Record<string, unknown>);
  const seconds = (Date.now() - started) / 1000;
  console.log(`demo boot to report: ${seconds.toFixed(2)}s`, JSON.stringify(report));

  expect(report["error"]).toBeUndefined();
  expect(report["tick"]).toBe(120);
  expect(report["stateHash"]).toBe("bff947dce3a11b4f");
  expect(report["drawHash"]).toBe("9a40be8a0b5ca816");
  expect(report["commands"]).toBe(128);

  const render = report["render"] as { drawn: number; deferred: number; deferredByKind: Record<string, number> };
  // 128 commands: fill + blits are drawn; the five text commands are entry 9.4's and are counted, not faked.
  expect(render.drawn + render.deferred).toBe(128);
  expect(render.deferredByKind["text"]).toBe(5);

  // The frame is really on the canvas: read a pixel the board draws, and check the canvas is not blank.
  const sample = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (canvas === null) return null;
    const gl = canvas.getContext("webgl2");
    if (gl === null) return null;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let nonBlack = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] !== 0 || pixels[index + 1] !== 0 || pixels[index + 2] !== 0) nonBlack += 1;
    }
    return { width: canvas.width, height: canvas.height, nonBlack };
  });
  expect(sample).not.toBeNull();
  expect(sample?.width).toBe(640);
  expect(sample?.height).toBe(480);
  expect(sample?.nonBlack ?? 0).toBeGreaterThan(1000);
  // The owner rule for ordinary tests is one second; a boot is a cross-layer contract, so the cost is reported instead.
  expect(seconds, "boot cost, for the record").toBeLessThan(30);
});

test("the browser probes the rulings need: VP9+Opus and no WebAssembly on the default path", async ({ page }) => {
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
  // The default audio path is SF2, so nothing on this page instantiates WebAssembly (D-10).
  expect(probes.wasmUsed).toBe(false);
});
