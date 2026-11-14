import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { chromium } from "@playwright/test";

const nodeModulesRoot = process.env.TKR_JOLLYPIXEL_NODE_MODULES;
if (!nodeModulesRoot) {
  throw new Error("Set TKR_JOLLYPIXEL_NODE_MODULES to the isolated candidate install's node_modules directory");
}
const root = resolve(nodeModulesRoot);
const packageMetadata = JSON.parse(await readFile(resolve(root, "@jolly-pixel/pixel-draw.renderer/package.json"), "utf8"));
if (packageMetadata.version !== "7.0.0") {
  throw new Error(`Expected the evaluated @jolly-pixel/pixel-draw.renderer@7.0.0, got ${packageMetadata.version}`);
}

const imports = {
  "@jolly-pixel/color": "/@jolly-pixel/color/dist/index.js",
  "@jolly-pixel/image": "/@jolly-pixel/image/dist/index.js",
  "@jolly-pixel/image/browser": "/@jolly-pixel/image/dist/raster/index.js",
  "@openally/emitt": "/@openally/emitt/dist/index.js",
  "js-base64": "/js-base64/base64.mjs",
};
const html = `<!doctype html>
<meta charset="utf-8">
<style>html,body,#root{margin:0;width:640px;height:480px}canvas{image-rendering:pixelated}</style>
<div id="root"></div>
<script type="importmap">${JSON.stringify({ imports })}</script>
<script type="module">
  import { PixelArtCanvas, PixelDocument } from "/@jolly-pixel/pixel-draw.renderer/dist/index.js";
  const documentModel = new PixelDocument({
    size: { x: 16, y: 8 },
    defaultColor: [0, 0, 0, 0],
    history: { enabled: false },
  });
  const updates = [];
  const canvas = new PixelArtCanvas(document.querySelector("#root"), {
    document: documentModel,
    defaultMode: "paint",
    brush: { size: 1, color: "#ff0000" },
    history: { enabled: false },
    onBufferUpdated(event) {
      const position = event.metadata.positions?.[0];
      updates.push({
        event,
        pixelAtHook: position ? Array.from(documentModel.buffer.samplePixel(position.x, position.y)) : null,
      });
    },
  });
  window.probe = { documentModel, canvas, updates };
</script>`;

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/__probe.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    const file = resolve(root, `.${decodeURIComponent(pathname)}`);
    if (file !== root && !file.startsWith(`${root}${sep}`)) {
      response.writeHead(403);
      response.end();
      return;
    }
    const body = await readFile(file);
    const extension = file.split(".").at(-1);
    const contentType = extension === "js" || extension === "mjs"
      ? "text/javascript"
      : extension === "json"
        ? "application/json"
        : "application/octet-stream";
    response.writeHead(200, { "content-type": contentType });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/__probe.html`);
  await page.waitForFunction(() => Boolean(window.probe?.canvas));
  const target = await page.evaluate(() => {
    const element = window.probe.canvas.canvas();
    const bounds = element.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2;
    const y = bounds.top + bounds.height / 2;
    return {
      point: { x, y },
      texturePosition: window.probe.canvas.viewport.mouseTexturePosition(x, y, { bounds, limit: true }),
    };
  });
  await page.mouse.click(target.point.x, target.point.y);
  await page.waitForFunction(() => window.probe.updates.length > 0);
  const afterStroke = await page.evaluate(() => {
    const { canvas, documentModel, updates } = window.probe;
    return {
      updates,
      historyEnabled: documentModel.history.enabled,
      canUndo: canvas.canUndo(),
      localUndo: canvas.undo(),
    };
  });
  await page.evaluate(() => {
    const { documentModel } = window.probe;
    documentModel.loadSnapshot({ x: 16, y: 8 }, new Uint8ClampedArray(16 * 8 * 4));
  });
  const afterExternalSnapshot = await page.evaluate(() => {
    const { canvas, documentModel, updates } = window.probe;
    return {
      pixelAtStroke: Array.from(documentModel.buffer.samplePixel(8, 4)),
      updateCount: updates.length,
      historyEnabled: documentModel.history.enabled,
      canUndo: canvas.canUndo(),
      localUndo: canvas.undo(),
    };
  });
  const result = { candidateVersion: packageMetadata.version, target, afterStroke, afterExternalSnapshot, errors };
  console.log(JSON.stringify(result, null, 2));
  const event = afterStroke.updates[0]?.event;
  const pixel = afterStroke.updates[0]?.pixelAtHook;
  if (
    errors.length > 0 ||
    afterStroke.updates.length !== 1 ||
    event?.action !== "stroke" ||
    event.metadata.positions.length !== 1 ||
    pixel?.join(",") !== "255,0,0,255" ||
    afterStroke.historyEnabled ||
    afterStroke.canUndo ||
    afterStroke.localUndo ||
    afterExternalSnapshot.pixelAtStroke.join(",") !== "0,0,0,0" ||
    afterExternalSnapshot.updateCount !== 1 ||
    afterExternalSnapshot.canUndo ||
    afterExternalSnapshot.localUndo
  ) {
    process.exitCode = 1;
  }
  await page.evaluate(() => window.probe.canvas.destroy());
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
