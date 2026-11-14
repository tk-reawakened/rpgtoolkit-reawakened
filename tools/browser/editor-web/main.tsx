import { createSessionCopy, createWorkbench, listRecentWebProjects, mountDocumentView, openWebProject, reopenWebProject, type DocumentView, type WebProject, type Workbench } from "@tk-reawakened/host-web";
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
const mirrorElement = document.querySelector<HTMLElement>("#mirror")!;
const mirrorButton = document.querySelector<HTMLButtonElement>("#mirror-view")!;
/** The one project this page shows: its workspace, tabs and mounted workbench. */
interface Shown {
  readonly project: WebProject;
  readonly workbench: Workbench;
  readonly element: HTMLElement;
  readonly unsubscribeTabs: () => void;
}
let shown: Shown | null = null;
let mirrorView: DocumentView | null = null;
let mirroredDocument: AnyDocument | null = null;
let mirroredProject: WebProject | null = null;
let mirrorRequested = false;


let projectWithChoices: WebProject | null = null;
let openRequest = 0;
interface PendingDocumentOpen {
  count: number;
  closing: Promise<void> | undefined;
  readonly abandonedDocuments: AnyDocument[];
}
/** Opens are scoped to a workspace instance, not just its stable project id. */
const pendingDocumentOpens = new WeakMap<WebProject["workspace"], Map<string, PendingDocumentOpen>>();
const pendingProjectUses = new WeakMap<WebProject["workspace"], number>();
const retiredProjects = new WeakSet<WebProject>();
let commitQueue: Promise<void> = Promise.resolve();
interface PendingShownOpen {
  count: number;
  restoreActive: string | null;
  readonly retainedKeys: Set<string>;
  readonly openCounts: Map<string, number>;
  readonly deferredWorkbench: Shown[];
}
/** Same-workspace opens mutate the visible tabs; retain a stable rollback target across overlap. */
const pendingShownOpens = new WeakMap<WebProject["workspace"], PendingShownOpen>();

function retainProjectUse(project: WebProject): void {
  const workspace = project.workspace;
  pendingProjectUses.set(workspace, (pendingProjectUses.get(workspace) ?? 0) + 1);
}

function releaseProjectUse(project: WebProject): void {
  const workspace = project.workspace;
  const remaining = (pendingProjectUses.get(workspace) ?? 1) - 1;
  if (remaining > 0) pendingProjectUses.set(workspace, remaining);
  else pendingProjectUses.delete(workspace);
  retireProjectIfUnowned(project);
}

function retireProjectIfUnowned(project: WebProject): void {
  if (retiredProjects.has(project) || pendingProjectUses.has(project.workspace)) return;
  if (shown?.project.workspace === project.workspace || projectWithChoices?.workspace === project.workspace) return;
  retiredProjects.add(project);
  project.deactivate();
}
function beginShownOpen(current: Shown, identityKey: string): PendingShownOpen {
  const workspace = current.project.workspace;
  let pending = pendingShownOpens.get(workspace);
  if (pending === undefined) {
    const snapshot = current.workbench.tabs.getSnapshot();
    pending = {
      count: 0,
      restoreActive: snapshot.active,
      retainedKeys: new Set(snapshot.tabs.map((tab) => tab.key)),
      openCounts: new Map(),
      deferredWorkbench: [],
    };
    pendingShownOpens.set(workspace, pending);
  }
  pending.count += 1;
  pending.openCounts.set(identityKey, (pending.openCounts.get(identityKey) ?? 0) + 1);
  return pending;
}

function finishShownOpen(workspace: WebProject["workspace"], identityKey: string, pending: PendingShownOpen): void {
  const openCount = (pending.openCounts.get(identityKey) ?? 1) - 1;
  if (openCount > 0) pending.openCounts.set(identityKey, openCount);
  else pending.openCounts.delete(identityKey);
  pending.count -= 1;
  if (pending.count > 0) return;
  pendingShownOpens.delete(workspace);
  for (const deferred of pending.deferredWorkbench) disposeShown(deferred);
}

async function rollbackShownOpen(current: Shown, identityKey: string, pending: PendingShownOpen): Promise<boolean> {
  const tabs = current.workbench.tabs;
  let canAbandonDocument = !tabs.getSnapshot().tabs.some((tab) => tab.key === identityKey);
  if (!canAbandonDocument
    && !pending.retainedKeys.has(identityKey)
    && pending.openCounts.get(identityKey) === 1) {
    try {
      await tabs.close(identityKey);
    } catch {}
  }
  const snapshot = tabs.getSnapshot();
  const restoreKey = snapshot.tabs.some((tab) => tab.key === pending.restoreActive)
    ? pending.restoreActive
    : snapshot.tabs.find((tab) => pending.retainedKeys.has(tab.key))?.key ?? null;
  if (restoreKey !== null) tabs.activate(restoreKey);
  return canAbandonDocument;
}

async function serializeCommit(commit: () => Promise<void>): Promise<void> {
  const previous = commitQueue;
  let release!: () => void;
  commitQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    await commit();
  } finally {
    release();
  }
}

folderButton.addEventListener("click", () => {
  const request = ++openRequest;
  void (async () => {
    const project = await openWebProject();
    if (request !== openRequest) {
      if (project) retireProjectIfUnowned(project);
      return;
    }
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
    if (request !== openRequest) {
      if (project) retireProjectIfUnowned(project);
      return;
    }
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
  retainProjectUse(project);
  try {
    hideProjectChoices();
    await refreshRecentProjects();
    if (request !== openRequest) return;
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
  } finally {
    releaseProjectUse(project);
  }
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
  const previous = projectWithChoices;
  projectWithChoices = null;
  gameLabel.hidden = true;
  gameSelect.hidden = true;
  openSelectedGame.hidden = true;
  gameSelect.replaceChildren();
  if (previous !== null) retireProjectIfUnowned(previous);
}

async function show(project: WebProject, path: string, request: number): Promise<void> {
  retainProjectUse(project);
  try {
    if (request === openRequest) await showProject(project, path, request);
  } finally {
    releaseProjectUse(project);
  }
}

async function showProject(project: WebProject, path: string, request: number): Promise<void> {
  const identityKey = createDocumentIdentity(project.project.id, path).key;
  const previousAtStart = shown;
  if (previousAtStart?.project.workspace === project.workspace) {
    await showInShownWorkbench(previousAtStart, project, path, request, identityKey);
    return;
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
    await beginDocumentOpen(project.workspace, identityKey);
    if (request === openRequest) await workbench.openPath(path);
    openedDocument = project.workspace.documents().find((item) => item.identity.key === identityKey);
    if (request === openRequest && !workbench.tabs.getSnapshot().tabs.some((tab) => tab.key === identityKey)) {
      throw new Error(`Could not open ${path} as a registered Toolkit document.`);
    }
  } catch (error) {
    openedDocument ??= project.workspace.documents().find((item) => item.identity.key === identityKey);
    await discardCandidate(candidate, openedDocument, identityKey);
    throw error;
  }
  if (request !== openRequest) {
    await discardCandidate(candidate, openedDocument, identityKey);
    return;
  }

  let committed = false;
  try {
    await serializeCommit(async () => {
      if (request !== openRequest) return;
      const previous = shown;
      if (previous !== null && previous.project.workspace === project.workspace) {
        for (const tab of previous.workbench.tabs.getSnapshot().tabs) {
          if (workbench.tabs.getSnapshot().tabs.some((candidateTab) => candidateTab.key === tab.key)) continue;
          await workbench.openPath(tab.path);
          if (request !== openRequest) return;
          if (!workbench.tabs.getSnapshot().tabs.some((candidateTab) => candidateTab.key === tab.key)) {
            throw new Error(`Could not preserve open document ${tab.path}.`);
          }
        }
        workbench.tabs.activate(identityKey);
      }

      if (previous !== null) {
        const closedPaths: string[] = [];
        try {
          for (const tab of [...previous.workbench.tabs.getSnapshot().tabs]) {
            const closed = await previous.workbench.tabs.close(tab.key);
            if (!closed.closed || request !== openRequest) {
              await restoreClosedTabs(previous, closedPaths);
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
        } catch (error) {
          await restoreClosedTabs(previous, closedPaths);
          throw error;
        }
      }
      if (request !== openRequest) return;
      replaceShown(candidate);
      status.textContent = projectStatus(project, path);
      committed = true;
    });
  } catch (error) {
    await discardCandidate(candidate, openedDocument, identityKey);
    throw error;
  }
  if (!committed) {
    await discardCandidate(candidate, openedDocument, identityKey);
    return;
  }
  await finishDocumentOpen(project.workspace, identityKey);
}

async function showInShownWorkbench(
  current: Shown,
  project: WebProject,
  path: string,
  request: number,
  identityKey: string,
): Promise<void> {
  const workspace = current.project.workspace;
  const pending = beginShownOpen(current, identityKey);
  let openedDocument: AnyDocument | undefined;
  try {
    await beginDocumentOpen(workspace, identityKey);
    if (request !== openRequest) return;
    await current.workbench.openPath(path);
    openedDocument = workspace.documents().find((item) => item.identity.key === identityKey);
    if (!current.workbench.tabs.getSnapshot().tabs.some((tab) => tab.key === identityKey)) {
      throw new Error(`Could not open ${path} as a registered Toolkit document.`);
    }
    if (request !== openRequest) {
      if (await rollbackShownOpen(current, identityKey, pending) && openedDocument !== undefined) {
        abandonCandidate(project, openedDocument, identityKey);
      }
      return;
    }
    pending.retainedKeys.add(identityKey);
    pending.restoreActive = identityKey;
    status.textContent = projectStatus(project, path);
  } catch (error) {
    openedDocument ??= workspace.documents().find((item) => item.identity.key === identityKey);
    if (await rollbackShownOpen(current, identityKey, pending) && openedDocument !== undefined) {
      abandonCandidate(project, openedDocument, identityKey);
    }
    throw error;
  } finally {
    finishShownOpen(workspace, identityKey, pending);
    await finishDocumentOpen(workspace, identityKey);
  }
}

async function discardCandidate(candidate: Shown, openedDocument: AnyDocument | undefined, identityKey: string): Promise<void> {
  candidate.unsubscribeTabs();
  candidate.workbench.dispose();
  candidate.element.remove();
  if (openedDocument !== undefined) abandonCandidate(candidate.project, openedDocument, identityKey);
  await finishDocumentOpen(candidate.project.workspace, identityKey);
}

function projectStatus(project: WebProject, path: string): string {
  return `${project.project.name}: ${path}${project.sessionCopy ? " (session copy; changes stay in memory)" : " (project folder; changes write to disk)"}`;
}

async function beginDocumentOpen(workspace: WebProject["workspace"], identityKey: string): Promise<void> {
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
  if (pending.closing !== undefined) await pending.closing.catch(() => {});
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
    if (shownOwnsDocument(workspace, identityKey)) {
      // Let the workspace confirm the new view lease before discarding this stale cleanup entry.
      try { await workspace.close(abandoned); } catch {}
      continue;
    }
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



function disposeShown(current: Shown): void {
  current.unsubscribeTabs();
  current.workbench.dispose();
  current.element.remove();
}

function replaceShown(next: Shown | null): void {
  const previous = shown;
  shown = next;
  syncMirror();

  if (next !== null) next.element.hidden = false;
  actions.hidden = activeDocument(next) === null;
  if (previous !== null && previous !== next) {
    const pending = pendingShownOpens.get(previous.project.workspace);
    if (pending !== undefined && pending.count > 0) {
      previous.element.hidden = true;
      pending.deferredWorkbench.push(previous);
    } else {
      disposeShown(previous);
    }
    if (next?.project.workspace !== previous.project.workspace) retireProjectIfUnowned(previous.project);
  }
}

function activeDocument(current: Shown | null): AnyDocument | null {
  if (current === null) return null;
  const active = current.workbench.tabs.getSnapshot().active;
  if (active === null) return null;
  return current.project.workspace.documents().find((candidate) => candidate.identity.key === active) ?? null;
}

function updateActions(current: Shown): void {
  if (shown !== current) return;
  actions.hidden = activeDocument(current) === null;
  syncMirror();
}

function syncMirror(): void {
  const active = activeDocument(shown);
  const project = shown?.project ?? null;
  const visible = active !== null && project !== null && mirrorRequested;
  mirrorElement.hidden = !visible;
  mirrorButton.setAttribute("aria-pressed", String(mirrorRequested));
  if (visible && mirrorView !== null && mirroredDocument === active && mirroredProject === project) return;
  mirrorView?.dispose();
  mirrorView = null;
  mirroredDocument = null;
  mirroredProject = null;
  mirrorElement.replaceChildren();
  if (visible && active !== null && project !== null) {
    mirrorView = mountDocumentView(project, active, mirrorElement);
    mirroredDocument = active;
    mirroredProject = project;
  }
}

mirrorButton.addEventListener("click", () => {
  mirrorRequested = !mirrorRequested;
  syncMirror();
});

function activeCommand(action: (current: Shown, document: AnyDocument) => Promise<string | null> | string | null): () => void {
  return () => {
    const current = shown;
    const active = activeDocument(current);
    if (current === null || active === null) return;
    void Promise.resolve(action(current, active))
      .then((message) => { if (message !== null && shown === current) status.textContent = message; })
      .catch((error: unknown) => { if (shown === current) showFailure(error); });
  };
}

function onActive(button: string, action: (current: Shown, document: AnyDocument) => Promise<string | null> | string | null): () => void {
  const run = activeCommand(action);
  document.querySelector<HTMLButtonElement>(button)!.addEventListener("click", run);
  return run;
}

const undoActive = onActive("#undo", ({ project }, active) => {
  const undone = project.workspace.undo(active);
  return undone.ok ? null : "Nothing to undo.";
});
const redoActive = onActive("#redo", ({ project }, active) => {
  const redone = project.workspace.redo(active);
  return redone.ok ? null : "Nothing to redo.";
});
const saveActive = activeCommand(async (_current, active) => {
  const saved = await active.save();
  return saved.ok ? null : saved.failure.message;
});

window.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();
  const save = key === "s" && !event.shiftKey;
  const undo = key === "z" && !event.shiftKey;
  const redo = key === "z" && event.shiftKey || key === "y" && !event.shiftKey;
  if (!save && !undo && !redo) return;
  const target = event.target;
  if (!save && target instanceof HTMLElement
    && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)) return;
  if (activeDocument(shown) === null) return;
  event.preventDefault();
  if (save) saveActive();
  else if (undo) undoActive();
  else redoActive();
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
