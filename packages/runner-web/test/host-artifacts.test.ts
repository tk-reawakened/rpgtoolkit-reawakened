import { deepEqual, rejects } from "node:assert/strict";
import { test } from "node:test";
import { closingBundled, closingManifestLoader, fetchClosingManifest } from "../src/closing-run.ts";

test("closing manifests and bundled indexes resolve from the selected host output", async () => {
  const urls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    return new Response(JSON.stringify(url.endsWith("/bundled.json") ? { files: [] } : { schema: 1, games: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await fetchClosingManifest("", "desktop");
    await fetchClosingManifest();
    await closingBundled("", "desktop");
    await closingBundled();
    deepEqual(urls, [
      "/apps/desktop/closing-files.json",
      "/apps/browser/closing-files.json",
      "/apps/desktop/bundled.json",
      "/apps/browser/bundled.json",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("closing-manifest diagnostics name the selected host output", async () => {
  await rejects(
    closingManifestLoader("", { schema: 1, games: {} }, "desktop")("missing"),
    /apps\/desktop\/closing-files\.json/,
  );
});
