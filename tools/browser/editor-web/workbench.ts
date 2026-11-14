// The browser host's whole workbench (files panel, tabs, editors of every registered kind) over a project folder that
// the browser proofs seed in the origin-private file system: `workbench.html?folder=<name of the seeded folder>`.
// It is the page the real-browser proofs of the document editors (story 12.8) drive; the shipped game-settings page
// is `index.html`.
import { createFolderProject, createWorkbench } from "@tk-reawakened/host-web";

async function start(): Promise<void> {
  const folder = new URLSearchParams(location.search).get("folder");
  const mount = document.querySelector<HTMLElement>("#workbench");
  if (folder === null || mount === null) throw new Error("workbench.html needs ?folder=<seeded folder> and a #workbench element");
  const storage = await navigator.storage.getDirectory();
  const root = await storage.getDirectoryHandle(folder);
  createWorkbench(createFolderProject(root, { id: `web:${folder}`, name: folder }), mount);
}

void start();
