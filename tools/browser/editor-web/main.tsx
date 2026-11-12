import { createSessionCopy, listRecentWebProjects, openGameSettings, openWebProject, reopenWebProject, type WebProject } from "@tk-reawakened/host-web";
import type { ProjectHandle } from "@tk-reawakened/platform-services";
import type { ViewHandle } from "@tk-reawakened/editor-ui";

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
let opened: ViewHandle | null = null;
let openedElement: HTMLElement | null = null;
let openedProject: WebProject | null = null;
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
      else if (entry.name.toLowerCase().endsWith(".gam")) games.push(path);
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
  const candidateElement = document.createElement("div");
  candidateElement.hidden = true;
  settings.append(candidateElement);
  let result: Awaited<ReturnType<typeof openGameSettings>>;
  try {
    result = await openGameSettings(project, path, candidateElement);
  } catch (error) {
    candidateElement.remove();
    throw error;
  }
  if (request !== openRequest) {
    if ("view" in result) result.view.dispose();
    candidateElement.remove();
    return;
  }
  if (!("view" in result)) {
    candidateElement.remove();
    throw new Error(`${result.error.document}: ${result.error.error.message}`);
  }

  const previous = opened;
  const previousElement = openedElement;
  if (openedProject !== project) openedProject?.deactivate();
  openedProject = project;
  opened = result.view;
  openedElement = candidateElement;
  candidateElement.hidden = false;
  previous?.dispose();
  previousElement?.remove();
  status.textContent = `${project.project.name}: ${path}${project.sessionCopy ? " (session copy; changes stay in memory)" : " (project folder; changes write to disk)"}`;
}

function showFailure(error: unknown): void {
  status.textContent = error instanceof Error ? error.message : String(error);
}

window.addEventListener("pagehide", () => {
  openRequest += 1;
  opened?.dispose();
  openedElement?.remove();
}, { once: true });
