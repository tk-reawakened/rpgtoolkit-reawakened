import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

/** Seed editable fixtures without preserving checkout ownership or mode. */
export async function copyProofAssets(source, destination, include = () => true) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    if (!include(from)) continue;
    const to = join(destination, entry.name);
    if (entry.isDirectory()) await copyProofAssets(from, to, include);
    else if (entry.isFile()) await writeFile(to, await readFile(from));
    else throw new Error(`Unsupported proof asset: ${from}`);
  }
}

/** Create isolated inputs and a browser profile, removing the workspace if setup fails. */
export async function createProofDirectories(gameFile, gamePath, root = tmpdir(), makeProfile = mkdtemp, sourceWorkspace) {
  const workspace = await mkdtemp(join(root, "tkr-editor-vscode-proof-"));
  try {
    if (sourceWorkspace !== undefined) {
      await copyProofAssets(sourceWorkspace, workspace, (source) => {
        const path = relative(sourceWorkspace, source);
        return path.split(sep)[0] !== ".vscode" && !path.toLowerCase().endsWith(".gam");
      });
    }
    const gameCopy = resolve(workspace, gamePath);
    await mkdir(dirname(gameCopy), { recursive: true });
    const gameBytes = await readFile(gameFile);
    await writeFile(gameCopy, gameBytes);
    await writeFile(resolve(workspace, "__tkr_sentinel.gam"), gameBytes);
    const settingsDirectory = resolve(workspace, ".vscode");
    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(resolve(settingsDirectory, "settings.json"), `${JSON.stringify({ "files.autoSave": "off" }, null, 2)}\n`);
    const profile = await makeProfile(join(root, "tkr-editor-vscode-profile-"));
    return { workspace, profile };
  } catch (error) {
    try { await rm(workspace, { recursive: true, force: true }); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "Proof directory setup and cleanup failed"); }
    throw error;
  }
}
