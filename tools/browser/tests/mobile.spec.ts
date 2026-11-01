import { expect, test } from "@playwright/test";

/**
 * Entry 9.12's provable-green part: the **mobile page is the same shared page**, run against a host shaped like the
 * wrapper's — four calls over a filesystem — and it boots the package to the committed tick-120 hashes.
 *
 * No device and no emulator are involved, and none is claimed: this proves the page, the host contract and the package
 * path. The device step (Capacitor's own `Filesystem` plugin on real hardware) is a person's, and the plan lists it.
 *
 * The stub stands in for `window.Capacitor.Plugins.Filesystem`, so the page's own code path — not a test double of it —
 * is what runs.
 */
test("the mobile page boots the package to the tick-120 hashes through a Capacitor-shaped host", async ({ page }) => {
  // A filesystem stub backed by the served package, installed before the page's bundle runs.
  await page.addInitScript(() => {
    const files = new Map<string, Uint8Array>();
    (window as unknown as { __files: Map<string, Uint8Array> }).__files = files;
    const toBase64 = (bytes: Uint8Array): string => {
      let text = "";
      for (const byte of bytes) text += String.fromCharCode(byte);
      return btoa(text);
    };
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      Plugins: {
        Filesystem: {
          async writeFile({ path, data, encoding, directory }: { path: string; data: string; encoding: "base64" | "utf8"; directory?: "DATA" }): Promise<void> {
            if (directory !== "DATA") throw new Error(`unexpected directory ${String(directory)}`);
            if (encoding !== "base64") throw new Error(`expected base64, got ${encoding}`);
            files.set(path, new Uint8Array([...atob(data)].map((character) => character.charCodeAt(0))));
          },
          async readFile({ path, encoding, directory }: { path: string; encoding?: "base64" | "utf8"; directory?: "DATA" }): Promise<{ data: string }> {
            if (path === "public/game.tpk") {
              const response = await fetch("/fixtures/packages/demo.tpk");
              if (!response.ok) throw new Error(`missing package ${response.status}`);
              return { data: toBase64(new Uint8Array(await response.arrayBuffer())) };
            }
            const found = files.get(path);
            if (found === undefined) throw new Error(`absent ${path}`);
            return { data: toBase64(found) };
          },
          async readdir({ path }: { path: string }): Promise<{ files: { name: string; type: string }[] }> {
            return {
              files: [...files.keys()]
                .filter((key) => key.startsWith(`${path}/`))
                .map((key) => ({ name: key.slice(path.length + 1), type: "file" })),
            };
          },
        },
      },
    };
  });

  // Everything the page says before it reports: a missing resource or a thrown boot step names itself instead of
  // disappearing into a bare timeout.
  const log: string[] = [];
  page.on("console", (message) => log.push(`console[${message.type()}]: ${message.text()}`));
  page.on("pageerror", (error) => log.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => log.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ""}`));
  page.on("response", (response) => {
    if (response.status() >= 400) log.push(`http ${response.status()}: ${response.url()}`);
  });

  await page.goto("/packages/runner-mobile/app/player.html");
  await page.waitForFunction(() => window.__mobile !== undefined, undefined, { timeout: 90_000 }).catch((error: unknown) => {
    throw new Error(`the page never reported; what it said:\n${log.join("\n")}\n(${String(error)})`);
  });
  const report = (await page.evaluate(() => window.__mobile)) as Record<string, unknown>;
  console.log("mobile page:", JSON.stringify(report));

  expect(report["error"]).toBeNull();
  expect(report["tick"]).toBe(120);
  // Current `golden/regression/closing.json` demo tick-120 baseline (post-E-02).
  expect(report["stateHash"]).toBe("91172695de52cfd6");
  expect(report["drawHash"]).toBe("9a40be8a0b5ca816");
  expect(report["commands"]).toBe(128);
  // The save went through the same four-call host the wrapper implements.
  const save = report["save"] as { written: boolean };
  expect(save.written).toBe(true);
});
