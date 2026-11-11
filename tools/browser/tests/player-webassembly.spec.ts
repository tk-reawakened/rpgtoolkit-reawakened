import { expect, test } from "@playwright/test";

/**
 * #1325, and the normative sentence in `docs/spec/engine/runners.md#csp-and-banks`: the browser player's strict policy
 * stays, and its default path instantiates no WebAssembly. The MIDI dependency's Vorbis decoder initialises itself at
 * import time, so bundling it makes the promise false even when only the bundled uncompressed SF2 is used; the browser
 * build therefore excludes it.
 *
 * This test instruments `WebAssembly` before any page script runs and fails if the player compiles or instantiates a
 * module, or if the page reports the CSP violation as an unhandled error.
 */

type WasmUse = { readonly instantiate: number; readonly compile: number; readonly instance: number };

declare global {
  interface Window {
    __wasm?: WasmUse;
    __live?: { readonly tick: number };
  }
}

test("the shipped browser player instantiates no WebAssembly on the default path", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.addInitScript(() => {
    const use = { instantiate: 0, compile: 0, instance: 0 };
    window.__wasm = use;
    const instantiate = WebAssembly.instantiate.bind(WebAssembly);
    const compile = WebAssembly.compile.bind(WebAssembly);
    const OriginalInstance = WebAssembly.Instance;
    WebAssembly.instantiate = ((...args: Parameters<typeof instantiate>) => {
      use.instantiate += 1;
      return instantiate(...args);
    }) as typeof WebAssembly.instantiate;
    WebAssembly.compile = ((...args: Parameters<typeof compile>) => {
      use.compile += 1;
      return compile(...args);
    }) as typeof WebAssembly.compile;
    WebAssembly.Instance = class extends OriginalInstance {
      constructor(...args: ConstructorParameters<typeof OriginalInstance>) {
        use.instance += 1;
        super(...args);
      }
    } as typeof WebAssembly.Instance;
  });

  // The live player with the bundled SoundFont: the default path, under the page's own strict policy.
  await page.goto("/packages/runner-web/app/index.html?package=fixtures/packages/demo.tpk");
  await page.waitForFunction(() => (window.__live?.tick ?? 0) > 30, undefined, { timeout: 90_000 });

  const use = await page.evaluate(() => window.__wasm);
  expect(use, "the instrumentation must still be in place").toBeDefined();
  expect(use?.instantiate, "WebAssembly.instantiate calls").toBe(0);
  expect(use?.compile, "WebAssembly.compile calls").toBe(0);
  expect(use?.instance, "WebAssembly.Instance constructions").toBe(0);
  expect(errors.filter((message) => /WebAssembly|Content Security Policy/i.test(message)), "page errors").toEqual([]);
});
