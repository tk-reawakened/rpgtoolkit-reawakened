import * as vscode from "vscode";
import { createVscodeFileSystemWithPort, type VscodeFileSystemPort } from "./filesystem-core.ts";

const port: VscodeFileSystemPort<vscode.Uri> = {
  isDirectory: (type) => (type & vscode.FileType.Directory) !== 0,
  joinPath: (root, ...segments) => vscode.Uri.joinPath(root, ...segments),
  parent: (uri) => { const index = uri.path.lastIndexOf("/"); return uri.with({ path: uri.path.slice(0, index) }); },
  readDirectory: async (uri) => await vscode.workspace.fs.readDirectory(uri),
  readFile: async (uri) => await vscode.workspace.fs.readFile(uri),
  createDirectory: async (uri) => { await vscode.workspace.fs.createDirectory(uri); },
  writeFile: async (uri, bytes) => { await vscode.workspace.fs.writeFile(uri, bytes); },
  stat: async (uri) => await vscode.workspace.fs.stat(uri),
  delete: async (uri) => { await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false }); },
  rename: async (source, target) => { await vscode.workspace.fs.rename(source, target); },
  watch: async (uri, onChange) => {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(uri, "**/*"));
    const rootPath = uri.path.replace(/\/$/, "");
    const relative = (changed: vscode.Uri, kind: "created" | "changed" | "deleted") => {
      const prefix = `${rootPath}/`;
      if (changed.path.startsWith(prefix)) onChange({ kind, path: changed.path.slice(prefix.length) });
    };
    const created = watcher.onDidCreate((item) => relative(item, "created"));
    const changed = watcher.onDidChange((item) => relative(item, "changed"));
    const deleted = watcher.onDidDelete((item) => relative(item, "deleted"));
    return { dispose: () => { created.dispose(); changed.dispose(); deleted.dispose(); watcher.dispose(); } };
  },
  errorCode: (error) => error instanceof vscode.FileSystemError ? error.code : undefined,
};

/** workspace.fs adapter for browser and desktop VS Code; it deliberately has no Node imports. */
export function createVscodeFileSystem(root: vscode.Uri) {
  return createVscodeFileSystemWithPort(root, port, root.toString());
}
