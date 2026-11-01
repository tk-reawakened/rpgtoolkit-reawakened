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
  // The package is fetched from the app origin, not from writable native storage.
  await page.route("**/public/game.tpk", async (route) => {
    const response = await route.fetch({ url: "/fixtures/packages/demo.tpk" });
    await route.fulfill({ response });
  });
  // Model native base64 strings, Directory.Data, and nonrecursive directory listings.
  await page.addInitScript(() => {
    const files = new Map<string, Uint8Array>();
    (window as unknown as { __files: Map<string, Uint8Array> }).__files = files;
    const toBase64 = (bytes: Uint8Array): string => {
      let text = "";
      for (const byte of bytes) text += String.fromCharCode(byte);
      return btoa(text);
    };
    const calls: string[] = [];
    (window as unknown as { __nativeCalls: string[] }).__nativeCalls = calls;
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      PluginHeaders: [{ name: "Filesystem", methods: ["writeFile", "readFile", "readdir"].map((name) => ({ name, rtype: "promise" })) }],
      async nativePromise(plugin: string, method: string, options: { path: string; data?: string; directory: string }): Promise<unknown> {
        if (plugin !== "Filesystem" || options.directory !== "DATA") throw new Error("invalid native request");
        calls.push(method);
        const { path, data } = options;
        if (method === "writeFile") {
          if (typeof data !== "string") throw new Error("invalid native write");
          const binary = atob(data);
          files.set(path, Uint8Array.from(binary, (character) => character.charCodeAt(0)));
          return { uri: path };
        }
        if (method === "readFile") {
          const found = files.get(path);
          if (found === undefined) throw new Error(`absent ${path}`);
          return { data: toBase64(found) };
        }
        if (method === "readdir") {
          const entries = new Map<string, string>();
          for (const key of files.keys()) {
            if (!key.startsWith(`${path}/`)) continue;
            const [name, ...rest] = key.slice(path.length + 1).split("/");
            if (name !== undefined) entries.set(name, rest.length === 0 ? "file" : "directory");
          }
          return { files: [...entries].map(([name, type]) => ({ name, type })) };
        }
        throw new Error(`unexpected native method ${method}`);
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
  expect(report["stateHash"]).toBe("bff947dce3a11b4f");
  expect(report["drawHash"]).toBe("9a40be8a0b5ca816");
  expect(report["commands"]).toBe(128);
  // The save went through the same four-call host the wrapper implements.
  const save = report["save"] as { written: boolean };
  expect(save.written).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __nativeCalls: string[] }).__nativeCalls)).toEqual(["writeFile", "readFile"]);
});
