import { copyFile, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

/** Create isolated inputs and a browser profile, removing the workspace if setup fails. */
export async function createProofDirectories(gameFile, gamePath, root = tmpdir(), makeProfile = mkdtemp, sourceWorkspace) {
  const workspace = await mkdtemp(join(root, "tkr-editor-vscode-proof-"));
  try {
    if (sourceWorkspace !== undefined) {
      await cp(sourceWorkspace, workspace, {
        recursive: true,
        filter(source) {
          const relativePath = relative(sourceWorkspace, source);
          return relativePath.length === 0
            || (relativePath.split(sep)[0] !== ".vscode" && !relativePath.toLowerCase().endsWith(".gam"));
        },
      });
    }
    const gameCopy = resolve(workspace, gamePath);
    await mkdir(dirname(gameCopy), { recursive: true });
    await copyFile(gameFile, gameCopy);
    await copyFile(gameFile, resolve(workspace, "__tkr_sentinel.gam"));
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
