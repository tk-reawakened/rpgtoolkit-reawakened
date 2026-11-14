import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = dirname(fileURLToPath(import.meta.url));
const source = resolve(extensionRoot, "../../packages/host-vscode/dist");
const destination = resolve(extensionRoot, "dist");
const repositoryRoot = resolve(extensionRoot, "../..");
await mkdir(destination, { recursive: true });
await mkdir(resolve(destination, "player-assets"), { recursive: true });
for (const file of ["extension.js", "extension.js.map", "extension.browser.js", "extension.browser.js.map", "webview.js", "webview.js.map", "tileset-browser.css", "player.js", "audio-worklet.js", "decode-worker.js"]) {
  await cp(resolve(source, file), resolve(destination, file));
}
const assetFolders = ["media/fonts", "media/cursors", "media/soundfonts", "stock/stock_menu", "stock/stock_battle", "stock/stock_rpg"];
for (const folder of assetFolders) {
  await cp(resolve(repositoryRoot, folder), resolve(destination, "player-assets", folder), { recursive: true });
}
const assets = [];
async function collect(folder) {
  for (const entry of await readdir(resolve(destination, "player-assets", folder), { withFileTypes: true })) {
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile()) assets.push(path);
  }
}
for (const folder of assetFolders) await collect(folder);
assets.sort();
await writeFile(resolve(destination, "player-assets.json"), JSON.stringify(assets));
const manifest = JSON.parse(await readFile(resolve(extensionRoot, "package.json"), "utf8"));
if (manifest.main !== "./dist/extension.js" || manifest.browser !== "./dist/extension.browser.js") throw new Error("The editor extension must declare both desktop and web entry points.");
