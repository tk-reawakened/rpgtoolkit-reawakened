import { createSessionCopy, createWorkbench, listRecentWebProjects, openWebProject, reopenWebProject, type WebProject, type Workbench } from "@tk-reawakened/host-web";
import type { AnyDocument } from "@tk-reawakened/editor-model";
import type { ProjectHandle } from "@tk-reawakened/platform-services";

const status = document.querySelector<HTMLElement>("#host-status")!;
const settings = document.querySelector<HTMLElement>("#settings")!;
const folderButton = document.querySelector<HTMLButtonElement>("#open-project")!;
const fileInput = document.querySelector<HTMLInputElement>("#open-session")!;
const gameLabel = document.querySelector<HTMLLabelElement>("#project-game-label")!;
const gameSelect = document.querySelector<HTMLSelectElement>("#project-game")!;
const openSelectedGame = document.querySelector<HTMLButtonElement>("#open-selected-game")!;
const recentLabel = document.querySelector<HTMLLabelElement>("#recent-project-label")!;
const recentSelect = document.querySelector<HTMLSelectElement>("#recent-project")!;
const reopenButton = document.querySelector<HTMLButtonElement>("#reopen-project")!;
const actions = document.querySelector<HTMLElement>("#document-actions")!;

interface Shown {
  readonly project: WebProject;
  readonly workbench: Workbench;
  readonly element: HTMLElement;
  readonly unsubscribeTabs: () => void;
}

let shown: Shown | null = null;
let projectWithChoices: WebProject | null = null;
let openRequest = 0;

folderButton.addEventListener("click", () => {
  const request = ++openRequest;
  void (async () => {
    const project = await openWebProject();
    if (request !== openRequest) return;
    if (!project) {
      status.textContent = "A persistent project folder could not be registered. Open a .gam session copy instead; folder changes will not be saved.";
      return;
    }
    await openProjectGame(project, request);
  })().catch((error: unknown) => { if (request === openRequest) showFailure(error); });
});
reopenButton.addEventListener("click", () => {
  const request = ++openRequest;
  void (async () => {
    const project = await reopenWebProject(recentSelect.value);
    if (request !== openRequest) return;
    if (!project) {
      status.textContent = "This project could not be reopened. Select its folder again or open a .gam session copy.";
      return;
    }
    await openProjectGame(project, request);
  })().catch((error: unknown) => { if (request === openRequest) showFailure(error); });
});

void refreshRecentProjects().catch(showFailure);

openSelectedGame.addEventListener("click", () => {
  const project = projectWithChoices;
  const path = gameSelect.value;
  if (!project || !path) return;
  const request = ++openRequest;
  void show(project, path, request).then(() => { if (request === openRequest) hideProjectChoices(); })
    .catch((error: unknown) => { if (request === openRequest) showFailure(error); });
});

async function refreshRecentProjects(): Promise<void> {
  const projects = await listRecentWebProjects();
  recentSelect.replaceChildren();
  if (!projects) {
    recentLabel.hidden = true;
    recentSelect.hidden = true;
    reopenButton.hidden = true;
    return;
  }
  recentSelect.replaceChildren(...projects.map((project: ProjectHandle) => {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    return option;
  }));
  const hasProjects = projects.length > 0;
  recentLabel.hidden = !hasProjects;
  recentSelect.hidden = !hasProjects;
  reopenButton.hidden = !hasProjects;
}

async function openProjectGame(project: WebProject, request: number): Promise<void> {
  hideProjectChoices();
  await refreshRecentProjects();
  const paths = await projectGames(project);
  if (request !== openRequest) return;
  if (paths.length === 0) {
    status.textContent = "The selected folder has no .gam files.";
    return;
  }
  if (paths.length > 1) {
    projectWithChoices = project;
    gameSelect.replaceChildren(...paths.map((path) => {
      const option = document.createElement("option");
      option.value = path;
      option.textContent = path;
      return option;
    }));
    gameLabel.hidden = false;
    gameSelect.hidden = false;
    openSelectedGame.hidden = false;
    status.textContent = `${paths.length} games found; select the game to open.`;
    return;
  }
  await show(project, paths[0]!, request);
}

fileInput.addEventListener("change", () => {
  const request = ++openRequest;
  void (async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (request !== openRequest) return;
    hideProjectChoices();
    await show(createSessionCopy(file.name, bytes), file.name, request);
  })().catch((error: unknown) => { if (request === openRequest) showFailure(error); });
});

async function projectGames(project: WebProject): Promise<string[]> {
  const pending = [""];
  const games: string[] = [];
  while (pending.length > 0) {
    const folder = pending.pop()!;
    const listed = await project.services.fs.list(folder);
    if (!listed.ok) throw new Error(listed.error.message);
    for (const entry of listed.value) {
      const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
      if (entry.kind === "directory") pending.push(path);
      else if (entry.kind === "file" && entry.name.toLowerCase().endsWith(".gam")) games.push(path);
    }
  }
  return games.sort();
}

function hideProjectChoices(): void {
  projectWithChoices = null;
  gameLabel.hidden = true;
  gameSelect.hidden = true;
  openSelectedGame.hidden = true;
  gameSelect.replaceChildren();
}

async function show(project: WebProject, path: string, request: number): Promise<void> {
  const previous = shown;
  if (previous !== null && previous.project.project.id === project.project.id) {
    if (previous.project !== project) project.deactivate();
    await previous.workbench.openPath(path);
    if (request !== openRequest) return;
    if (!previous.workbench.tabs.getSnapshot().tabs.some((tab) => tab.path === path)) {
      throw new Error(`Could not open ${path} as a registered Toolkit document.`);
    }
    status.textContent = projectStatus(previous.project, path);
    return;
  }

  const element = document.createElement("section");
  element.hidden = true;
  settings.append(element);
  const workbench = createWorkbench(project, element);
  let candidate!: Shown;
  const unsubscribeTabs = workbench.tabs.subscribe(() => updateActions(candidate));
  candidate = { project, workbench, element, unsubscribeTabs };
  try {
    await workbench.openPath(path);
    if (!workbench.tabs.getSnapshot().tabs.some((tab) => tab.path === path)) {
      throw new Error(`Could not open ${path} as a registered Toolkit document.`);
    }
  } catch (error) {
    candidate.unsubscribeTabs();
    workbench.dispose();
    element.remove();
    throw error;
  }
  if (request !== openRequest) {
    candidate.unsubscribeTabs();
    workbench.dispose();
    element.remove();
    project.deactivate();
    return;
  }

  if (previous !== null) {
    for (const tab of [...previous.workbench.tabs.getSnapshot().tabs]) {
      const closed = await previous.workbench.tabs.close(tab.key);
      if (!closed.closed) {
        candidate.unsubscribeTabs();
        workbench.dispose();
        element.remove();
        project.deactivate();
        const previousPath = previous.workbench.tabs.getSnapshot().tabs[0]?.path ?? tab.path;
        status.textContent = closed.reason === "cancelled"
          ? `${previousPath} is still open; ${path} was not opened.`
          : `${previousPath} is still open: ${closed.failure.message}`;
        return;
      }
    }
  }
  replaceShown(candidate);
  status.textContent = projectStatus(project, path);
}

function projectStatus(project: WebProject, path: string): string {
  return `${project.project.name}: ${path}${project.sessionCopy ? " (session copy; changes stay in memory)" : " (project folder; changes write to disk)"}`;
}

function replaceShown(next: Shown | null): void {
  const previous = shown;
  shown = next;
  if (next !== null) next.element.hidden = false;
  actions.hidden = activeDocument(next) === null;
  if (previous !== null && previous !== next) {
    previous.unsubscribeTabs();
    previous.workbench.dispose();
    previous.element.remove();
    previous.project.deactivate();
  }
}

function activeDocument(current: Shown | null): AnyDocument | null {
  if (current === null) return null;
  const active = current.workbench.tabs.getSnapshot().active;
  if (active === null) return null;
  return current.project.workspace.documents().find((candidate) => candidate.identity.key === active) ?? null;
}

function updateActions(current: Shown): void {
  if (shown === current) actions.hidden = activeDocument(current) === null;
}

function onActive(button: string, action: (current: Shown, document: AnyDocument) => Promise<string | null> | string | null): void {
  document.querySelector<HTMLButtonElement>(button)!.addEventListener("click", () => {
    const current = shown;
    const active = activeDocument(current);
    if (current === null || active === null) return;
    void Promise.resolve(action(current, active))
      .then((message) => { if (message !== null && shown === current) status.textContent = message; })
      .catch((error: unknown) => { if (shown === current) showFailure(error); });
  });
}

onActive("#undo", ({ project }, active) => {
  const undone = project.workspace.undo(active);
  return undone.ok ? null : "Nothing to undo.";
});
onActive("#redo", ({ project }, active) => {
  const redone = project.workspace.redo(active);
  return redone.ok ? null : "Nothing to redo.";
});
onActive("#save-as", async (current, active) => {
  const saved = await current.project.workspace.saveAs(active);
  if (!saved.ok) return saved.reason === "cancelled" ? null : saved.failure.message;
  if (shown !== current) return null;
  current.workbench.tabs.open(saved.document);
  return `${current.project.project.name}: ${saved.document.identity.path} (saved as a copy of ${active.identity.path})`;
});
document.querySelector<HTMLButtonElement>("#save-all")!.addEventListener("click", () => {
  const current = shown;
  if (current === null) return;
  void current.project.workspace.saveAll().then((results) => {
    if (shown !== current) return;
    if (results.length === 0) {
      status.textContent = "Nothing to save.";
      return;
    }
    status.textContent = results.map(({ document, result }) => (result.ok ? `Saved ${document}.` : result.failure.message)).join(" ");
  }).catch(showFailure);
});
onActive("#revert", async (current, active) => {
  const reverted = await current.project.workspace.revert(active);
  if (reverted.ok) return `Reverted ${active.identity.path} to the version on disk.`;
  return reverted.reason === "cancelled" ? null : reverted.failure.message;
});
document.querySelector<HTMLButtonElement>("#close")!.addEventListener("click", () => {
  const current = shown;
  const active = activeDocument(current);
  if (current === null || active === null) return;
  void current.workbench.tabs.close(active.identity.key).then((closed) => {
    if (shown !== current) return;
    if (!closed.closed) {
      if (closed.reason !== "cancelled") status.textContent = `${active.identity.path} is still open: ${closed.failure.message}`;
      return;
    }
    if (current.workbench.tabs.getSnapshot().tabs.length === 0) {
      status.textContent = "No game open.";
      actions.hidden = true;
    }
  }).catch(showFailure);
});

window.addEventListener("beforeunload", (event) => {
  if (shown?.project.workspace.documents().some((document) => document.getSnapshot().dirty)) event.preventDefault();
});

function showFailure(error: unknown): void {
  status.textContent = error instanceof Error ? error.message : String(error);
}

window.addEventListener("pagehide", () => {
  openRequest += 1;
  replaceShown(null);
}, { once: true });
