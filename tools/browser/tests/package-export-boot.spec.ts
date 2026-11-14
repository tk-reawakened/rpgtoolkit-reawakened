import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createDocumentWorkspace, prepareGamePackage } from "../../../packages/editor-model/src/index.ts";
import { createMemoryPlatformServices } from "../../../packages/platform-services/src/testing.ts";
import { platformOk } from "../../../packages/platform-services/src/result.ts";
type RunnerWindow = Window & { __live?: { readonly board: string | null } };

function addSampleFiles(directory: string, prefix: string, files: Record<string, Uint8Array>): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const sourcePath = join(directory, entry.name);
    const projectPath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) addSampleFiles(sourcePath, projectPath, files);
    else if (entry.isFile()) files[projectPath] = new Uint8Array(readFileSync(sourcePath));
  }
}

async function generatedPackage() {
  const files: Record<string, Uint8Array> = {
    "Main/example.gam": new Uint8Array(readFileSync(resolve("docs/spec/examples/game/Main/example.gam"))),
  };
  addSampleFiles(resolve("docs/spec/examples/game/Game/Example"), "", files);
  const host = createMemoryPlatformServices({ files });
  const workspace = createDocumentWorkspace({ projectId: "runner-smoke", services: host });
  try {
    const services = {
      fs: host.fs,
      packageExport: {
        async sha256(bytes: Uint8Array) {
          return platformOk(createHash("sha256").update(bytes).digest("hex"));
        },
        async downloadFile() {
          return platformOk(undefined);
        },
      },
    };
    const prepared = await prepareGamePackage({ workspace, services, mainPath: "Main/example.gam", version: "1.0.0" });
    if (!prepared.ok) throw new Error(prepared.message);
    return prepared.value;
  } finally {
    workspace.dispose();
  }
}

test("exported package boots in the real interactive web runner without its source folder", async ({ page }) => {
  const prepared = await generatedPackage();
  const packageName = prepared.package.fileName;
  const archiveBytes = Buffer.from(prepared.package.bytes);
  await page.route(`**/${packageName}`, (route) => {
    const range = /^bytes=(\d+)-(\d+)$/.exec(route.request().headers()["range"] ?? "");
    if (range === null) {
      return route.fulfill({ status: 200, headers: { "accept-ranges": "bytes" }, contentType: "application/octet-stream", body: archiveBytes });
    }
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (start >= archiveBytes.length || end < start) {
      return route.fulfill({ status: 416, headers: { "content-range": `bytes */${archiveBytes.length}` } });
    }
    const last = Math.min(end, archiveBytes.length - 1);
    return route.fulfill({
      status: 206,
      headers: {
        "accept-ranges": "bytes",
        "content-range": `bytes ${start}-${last}/${archiveBytes.length}`,
        "content-length": String(last - start + 1),
      },
      contentType: "application/octet-stream",
      body: archiveBytes.subarray(start, last + 1),
    });
  });
  await page.route(`**/${packageName}.json`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: Buffer.from(prepared.descriptor.bytes) }));

  await page.goto(`/packages/runner-web/app/index.html?package=${packageName}&mode=whole`);
  await page.waitForFunction(() => (window as RunnerWindow).__live !== undefined, undefined, { timeout: 45_000 });
  for (let press = 0; press < 6; press += 1) {
    const board = await page.evaluate(() => (window as RunnerWindow).__live?.board);
    if (board === "boards/start.brd") break;
    await page.keyboard.press("Enter");
    await page.waitForTimeout(250);
  }
  await expect.poll(() => page.evaluate(() => (window as RunnerWindow).__live?.board), { timeout: 20_000 }).toBe("boards/village.brd");
});
