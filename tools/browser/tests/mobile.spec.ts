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
          async writeFile({ path, data }: { path: string; data: Uint8Array }): Promise<void> {
            files.set(path, new Uint8Array(data));
          },
          async readFile({ path }: { path: string }): Promise<{ data: string }> {
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

  await page.goto("/packages/runner-mobile/app/player.html");
  await page.waitForFunction(() => window.__mobile !== undefined, undefined, { timeout: 90_000 });
  const report = (await page.evaluate(() => window.__mobile)) as Record<string, unknown>;
  console.log("mobile page:", JSON.stringify(report));

  expect(report["error"]).toBeNull();
  expect(report["tick"]).toBe(120);
  expect(report["stateHash"]).toBe("bff947dce3a11b4f");
  expect(report["drawHash"]).toBe("9a40be8a0b5ca816");
  expect(report["commands"]).toBe(128);
  // The save went through the same four-call host the wrapper implements.
  const save = report["save"] as { written: boolean };
  expect(save.written).toBe(true);
});
