import { createSessionCopy, openGameSettings, openWebProject, type WebProject } from "@tk-reawakened/host-web";
import type { ViewHandle } from "@tk-reawakened/editor-ui";

const status = document.querySelector<HTMLElement>("#host-status")!;
const settings = document.querySelector<HTMLElement>("#settings")!;
const folderButton = document.querySelector<HTMLButtonElement>("#open-project")!;
const fileInput = document.querySelector<HTMLInputElement>("#open-session")!;
const gameLabel = document.querySelector<HTMLLabelElement>("#project-game-label")!;
const gameSelect = document.querySelector<HTMLSelectElement>("#project-game")!;
const openSelectedGame = document.querySelector<HTMLButtonElement>("#open-selected-game")!;
let opened: ViewHandle | null = null;
let openedElement: HTMLElement | null = null;
let projectWithChoices: WebProject | null = null;

folderButton.addEventListener("click", () => {
  void (async () => {
    const project = await openWebProject();
    if (!project) {
      status.textContent = "Project folders are not supported here; open a .gam session copy instead.";
      return;
    }
    hideProjectChoices();
    const paths = await projectGames(project);
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
    hideProjectChoices();
    await show(project, paths[0]!);
  })().catch(showFailure);
});

openSelectedGame.addEventListener("click", () => {
  const project = projectWithChoices;
  const path = gameSelect.value;
  if (!project || !path) return;
  void show(project, path).then(hideProjectChoices).catch(showFailure);
});

fileInput.addEventListener("change", () => {
  void (async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    hideProjectChoices();
    await show(createSessionCopy(file.name, bytes), file.name);
  })().catch(showFailure);
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

async function show(project: WebProject, path: string): Promise<void> {
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
  if (!("view" in result)) {
    candidateElement.remove();
    throw new Error(`${result.error.document}: ${result.error.error.message}`);
  }

  const previous = opened;
  const previousElement = openedElement;
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
  opened?.dispose();
  openedElement?.remove();
}, { once: true });
