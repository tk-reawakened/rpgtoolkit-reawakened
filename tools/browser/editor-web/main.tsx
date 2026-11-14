import { createSessionCopy, createWorkbench, listRecentWebProjects, openWebProject, reopenWebProject, type WebProject, type Workbench } from "@tk-reawakened/host-web";
import { createDocumentIdentity, type AnyDocument } from "@tk-reawakened/editor-model";
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
/** The one project this page shows: its workspace, tabs and mounted workbench. */
interface Shown {
  readonly project: WebProject;
  readonly workbench: Workbench;
  readonly element: HTMLElement;
  readonly unsubscribeTabs: () => void;
}
let shown: Shown | null = null;
let projectWithChoices: WebProject | null = null;
let openRequest = 0;
interface PendingDocumentOpen {
  count: number;
  closing: Promise<void> | undefined;
  readonly abandonedDocuments: AnyDocument[];
}
/** Opens are scoped to a workspace instance, not just its stable project id. */
const pendingDocumentOpens = new WeakMap<WebProject["workspace"], Map<string, PendingDocumentOpen>>();

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

let showQueue: Promise<void> = Promise.resolve();
async function show(project: WebProject, path: string, request: number): Promise<void> {
  const previous = showQueue;
  let release!: () => void;
  showQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    if (request === openRequest) await showProject(project, path, request);
  } finally {
    release();
  }
}

async function showProject(project: WebProject, path: string, request: number): Promise<void> {
  const identityKey = createDocumentIdentity(project.project.id, path).key;
  const previous = shown;
  const workspace = previous !== null && previous.project.project.id === project.project.id
    ? previous.project.workspace
    : project.workspace;
  beginDocumentOpen(workspace, identityKey);
  if (previous !== null && previous.project.project.id === project.project.id) {
    if (previous.project !== project) project.deactivate();
    try {
      await previous.workbench.openPath(path);
      if (request !== openRequest) return;
      if (!previous.workbench.tabs.getSnapshot().tabs.some((tab) => tab.key === identityKey)) {
        throw new Error(`Could not open ${path} as a registered Toolkit document.`);
      }
      status.textContent = projectStatus(previous.project, path);
      return;
    } finally {
      await finishDocumentOpen(previous.project.workspace, identityKey);
    }
  }

  const element = document.createElement("section");
  element.hidden = true;
  settings.append(element);
  const workbench = createWorkbench(project, element);
  let candidate!: Shown;
  const unsubscribeTabs = workbench.tabs.subscribe(() => updateActions(candidate));
  candidate = { project, workbench, element, unsubscribeTabs };
  let openedDocument: AnyDocument | undefined;
  try {
    await workbench.openPath(path);
    openedDocument = project.workspace.documents().find((item) => item.identity.key === identityKey);
    if (!workbench.tabs.getSnapshot().tabs.some((tab) => tab.key === identityKey)) {
      throw new Error(`Could not open ${path} as a registered Toolkit document.`);
    }
  } catch (error) {
    candidate.unsubscribeTabs();
    workbench.dispose();
    element.remove();
    if (openedDocument !== undefined) abandonCandidate(project, openedDocument, identityKey);
    await finishDocumentOpen(project.workspace, identityKey);
    project.deactivate();
    throw error;
  }
  if (request !== openRequest) {
    candidate.unsubscribeTabs();
    workbench.dispose();
    element.remove();
    if (openedDocument !== undefined) abandonCandidate(project, openedDocument, identityKey);
    await finishDocumentOpen(project.workspace, identityKey);
    project.deactivate();
    return;
  }

  if (previous !== null) {
    const closedPaths: string[] = [];
    for (const tab of [...previous.workbench.tabs.getSnapshot().tabs]) {
      const closed = await previous.workbench.tabs.close(tab.key);
      if (!closed.closed || request !== openRequest) {
        await restoreClosedTabs(previous, closedPaths);
        candidate.unsubscribeTabs();
        workbench.dispose();
        element.remove();
        if (openedDocument !== undefined) abandonCandidate(project, openedDocument, identityKey);
        await finishDocumentOpen(project.workspace, identityKey);
        project.deactivate();
        if (request === openRequest && !closed.closed) {
          const previousPath = previous.workbench.tabs.getSnapshot().tabs[0]?.path ?? tab.path;
          status.textContent = closed.reason === "cancelled"
            ? `${previousPath} is still open; ${path} was not opened.`
            : `${previousPath} is still open: ${closed.failure.message}`;
        }
        return;
      }
      closedPaths.push(tab.path);
    }
    if (request !== openRequest) {
      await restoreClosedTabs(previous, closedPaths);
      candidate.unsubscribeTabs();
      workbench.dispose();
      element.remove();
      if (openedDocument !== undefined) abandonCandidate(project, openedDocument, identityKey);
      await finishDocumentOpen(project.workspace, identityKey);
      project.deactivate();
      return;
    }
  }
  replaceShown(candidate);
  status.textContent = projectStatus(project, path);
  await finishDocumentOpen(project.workspace, identityKey);
}

function projectStatus(project: WebProject, path: string): string {
  return `${project.project.name}: ${path}${project.sessionCopy ? " (session copy; changes stay in memory)" : " (project folder; changes write to disk)"}`;
}

function beginDocumentOpen(workspace: WebProject["workspace"], identityKey: string): void {
  let opens = pendingDocumentOpens.get(workspace);
  if (opens === undefined) {
    opens = new Map();
    pendingDocumentOpens.set(workspace, opens);
  }
  let pending = opens.get(identityKey);
  if (pending === undefined) {
    pending = { count: 0, closing: undefined, abandonedDocuments: [] };
    opens.set(identityKey, pending);
  }
  pending.count += 1;
}

function shownOwnsDocument(workspace: WebProject["workspace"], identityKey: string): boolean {
  return shown?.project.workspace === workspace
    && shown.workbench.tabs.getSnapshot().tabs.some((tab) => tab.key === identityKey);
}

async function finishDocumentOpen(workspace: WebProject["workspace"], identityKey: string): Promise<void> {
  const opens = pendingDocumentOpens.get(workspace);
  const pending = opens?.get(identityKey);
  if (opens === undefined || pending === undefined) return;
  pending.count -= 1;
  if (pending.count > 0) return;
  while (pending.abandonedDocuments.length > 0) {
    const abandoned = pending.abandonedDocuments.pop()!;
    if (shownOwnsDocument(workspace, identityKey)) continue;
    const closing = workspace.close(abandoned).then((result) => {
      if (!result.closed) throw new Error(`Could not close abandoned document ${abandoned.identity.path}.`);
    });
    pending.closing = closing;
    try {
      await closing;
    } catch {
      pending.abandonedDocuments.push(abandoned);
      return;
    } finally {
      pending.closing = undefined;
    }
    if (pending.count > 0) return;
  }
  opens.delete(identityKey);
  if (opens.size === 0) pendingDocumentOpens.delete(workspace);
}

function abandonCandidate(project: WebProject, document: AnyDocument, identityKey: string): void {
  const pending = pendingDocumentOpens.get(project.workspace)?.get(identityKey);
  if (pending !== undefined && !pending.abandonedDocuments.includes(document)) {
    pending.abandonedDocuments.push(document);
  }
}

async function restoreClosedTabs(previous: Shown, paths: readonly string[]): Promise<void> {
  for (const path of paths) await previous.workbench.openPath(path);
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
  const sourceTab = active.identity.key;
  const sourceClosed = saved.document === active
    ? { closed: true }
    : await current.workbench.tabs.close(sourceTab);
  if (shown !== current) return null;
  current.workbench.tabs.open(saved.document);
  const sourceNotice = sourceClosed.closed ? "" : ` The source ${active.identity.path} remains open.`;
  return `${current.project.project.name}: ${saved.document.identity.path} (saved as a copy of ${active.identity.path}).${sourceNotice}`;
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
  }).catch((error: unknown) => { if (shown === current) showFailure(error); });
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
      status.textContent = "No document open.";
      actions.hidden = true;
    }
  }).catch((error: unknown) => { if (shown === current) showFailure(error); });
});

// Leaving the page closes the document too: the browser asks first while there is unsaved work (D3.6).
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
