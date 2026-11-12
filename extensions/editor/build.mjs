import { cp, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = dirname(fileURLToPath(import.meta.url));
const source = resolve(extensionRoot, "../../packages/host-vscode/dist");
const destination = resolve(extensionRoot, "dist");
await mkdir(destination, { recursive: true });
for (const file of ["extension.js", "extension.js.map", "extension.browser.js", "extension.browser.js.map", "webview.js", "webview.js.map"]) {
  await cp(resolve(source, file), resolve(destination, file));
}
const manifest = JSON.parse(await readFile(resolve(extensionRoot, "package.json"), "utf8"));
if (manifest.main !== "./dist/extension.js" || manifest.browser !== "./dist/extension.browser.js") throw new Error("The editor extension must declare both desktop and web entry points.");
