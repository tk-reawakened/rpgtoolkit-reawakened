import { createSessionCopy, listRecentWebProjects, mountDocumentView, mountEditor, openEditor, openWebProject, reopenWebProject, type DocumentView, type EditorOpenResult, type EditorView, type WebProject } from "@tk-reawakened/host-web";
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
const projectFile = document.querySelector<HTMLInputElement>("#project-file")!;
const mirrorElement = document.querySelector<HTMLElement>("#mirror")!;
const mirrorButton = document.querySelector<HTMLButtonElement>("#mirror-view")!;
/** The one document this page shows: its project, its model and the view mounted over it. */
interface Shown {
  readonly project: WebProject;
  readonly document: AnyDocument;
  readonly view: EditorView;
  readonly element: HTMLElement;
}
let shown: Shown | null = null;
let mirrorView: DocumentView | null = null;
let mirrorRequested = false;
let openedProject: WebProject | null = null;
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

/**
 * Show `path` in place of the shown document. The new view is made first, so a failed open leaves the old one; then the
 * old document is closed, which asks before losing unsaved work (ADR 0022 D3.6). Cancelling keeps the old document.
 */
async function show(project: WebProject, path: string, request: number): Promise<void> {
  const identityKey = createDocumentIdentity(project.project.id, path).key;
  let opens = pendingDocumentOpens.get(project.workspace);
  if (opens === undefined) {
    opens = new Map();
    pendingDocumentOpens.set(project.workspace, opens);
  }
  let pending = opens.get(identityKey);
  if (pending === undefined) {
    pending = { count: 0, closing: undefined, abandonedDocuments: [] };
    opens.set(identityKey, pending);
  }
  pending.count += 1;
  const candidateElement = document.createElement("div");
  candidateElement.hidden = true;
  settings.append(candidateElement);
  let result: EditorOpenResult;
  try {
    // A failed close leaves the document queued for a later attempt, but must not block this acquisition.
    if (pending.closing !== undefined) {
      try {
        await pending.closing;
      } catch {
        // finishDocumentOpen restored the document to the cleanup queue.
      }
    }
    if (request !== openRequest) {
      candidateElement.remove();
      await finishDocumentOpen(project.workspace, identityKey);
      return;
    }
    result = await openEditor(project, path, candidateElement);
  } catch (error) {
    candidateElement.remove();
    await finishDocumentOpen(project.workspace, identityKey);
    throw error;
  }
  if (request !== openRequest) {
    try {
      if (result.ok) await abandonCandidate(project, result.document, result.view, identityKey);
    } finally {
      candidateElement.remove();
      await finishDocumentOpen(project.workspace, identityKey);
    }
    return;
  }
  await finishDocumentOpen(project.workspace, identityKey);
  if (request !== openRequest) {
    try {
      if (result.ok) await abandonCandidate(project, result.document, result.view, identityKey);
    } finally {
      candidateElement.remove();
    }
    return;
  }
  if (!result.ok) {
    candidateElement.remove();
    await finishDocumentOpen(project.workspace, identityKey);
    throw new Error(result.error.kind === "case-conflict" || result.error.kind === "unsupported" ? result.error.message : `${result.error.document}: ${result.error.error.message}`);
  }

  const previous = shown;
  if (previous !== null && previous.document !== result.document) {
    const closed = await previous.view.close();
    if (!closed.closed) {
      await abandonCandidate(project, result.document, result.view, identityKey);
      candidateElement.remove();
      if (project !== previous.project) project.deactivate();
      status.textContent = closed.reason === "cancelled"
        ? `${previous.document.identity.path} is still open; ${path} was not opened.`
        : `${previous.document.identity.path} is still open: ${closed.failure.message}`;
      return;
    }
    if (request !== openRequest) {
      await abandonCandidate(project, result.document, result.view, identityKey);
      candidateElement.remove();
      return;
    }
  }
  if (openedProject !== project) openedProject?.deactivate();
  openedProject = project;
  replaceShown({ project, document: result.document, view: result.view, element: candidateElement });
  status.textContent = `${project.project.name}: ${result.document.identity.path}${project.sessionCopy ? " (session copy; changes stay in memory)" : " (project folder; changes write to disk)"}`;
}

/** Close stale documents only after same-workspace opens have finished mounting or failing. */
async function finishDocumentOpen(workspace: WebProject["workspace"], identityKey: string): Promise<void> {
  const opens = pendingDocumentOpens.get(workspace);
  const pending = opens?.get(identityKey);
  if (opens === undefined || pending === undefined) return;
  pending.count -= 1;
  if (pending.count > 0) return;
  while (pending.abandonedDocuments.length > 0) {
    const abandoned = pending.abandonedDocuments.pop()!;
    const closing = workspace.close(abandoned).then(() => {});
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

/** Release the candidate view immediately; workspace.close respects any active view still owning the document. */
async function abandonCandidate(
  project: WebProject,
  document: AnyDocument,
  view: EditorView,
  identityKey: string,
): Promise<void> {
  view.dispose();
  const pending = pendingDocumentOpens.get(project.workspace)?.get(identityKey);
  if (pending !== undefined && pending.count > 0) {
    pending.abandonedDocuments.push(document);
    return;
  }
  await project.workspace.close(document);
}



function replaceShown(next: Shown | null): void {
  const previous = shown;
  shown = next;
  syncMirror();
  projectFile.value = next?.document.identity.path ?? "";
  if (next !== null) next.element.hidden = false;
  previous?.view.dispose();
  previous?.element.remove();
  actions.hidden = next === null;
}

/** A second surface shares the shown tab's lease; it never owns or copies a document. */
function syncMirror(): void {
  mirrorView?.dispose();
  mirrorView = null;
  mirrorElement.replaceChildren();
  mirrorElement.hidden = shown === null || !mirrorRequested;
  mirrorButton.setAttribute("aria-pressed", String(mirrorRequested));
  if (shown !== null && mirrorRequested) mirrorView = mountDocumentView(shown.project, shown.document, mirrorElement);
}

/** Run a document action on the shown document; a newer open makes its outcome stale. */
function onShown(button: string, action: (current: Shown) => Promise<string | null> | string | null): void {
  document.querySelector<HTMLButtonElement>(button)!.addEventListener("click", () => {
    const current = shown;
    if (current === null) return;
    void Promise.resolve(action(current))
      .then((message) => { if (message !== null && shown === current) status.textContent = message; })
      .catch((error: unknown) => { if (shown === current) showFailure(error); });
  });
}

onShown("#open-file", async ({ project }) => {
  await show(project, projectFile.value, ++openRequest);
  return null;
});
onShown("#mirror-view", () => {
  mirrorRequested = !mirrorRequested;
  syncMirror();
  return null;
});
onShown("#save-current", async ({ document }) => {
  const saved = await document.save();
  return saved.ok ? `Saved ${document.identity.path}.` : saved.failure.message;
});

// Text controls keep their native editing shortcuts; a drawing surface uses its host's document actions.
document.addEventListener("keydown", (event) => {
  if (shown === null || event.defaultPrevented || event.altKey || !(event.ctrlKey || event.metaKey)) return;
  const target = event.target;
  if (target instanceof Element && target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])") !== null) return;
  const key = event.key.toLowerCase();
  const action = key === "z" ? (event.shiftKey ? "#redo" : "#undo")
    : key === "y" && !event.shiftKey ? "#redo"
    : key === "s" ? (event.shiftKey ? "#save-as" : "#save-current")
    : null;
  if (action === null) return;
  event.preventDefault();
  document.querySelector<HTMLButtonElement>(action)!.click();
});

onShown("#undo", ({ project, document }) => {
  const undone = project.workspace.undo(document);
  return undone.ok ? null : "Nothing to undo.";
});
onShown("#redo", ({ project, document }) => {
  const redone = project.workspace.redo(document);
  return redone.ok ? null : "Nothing to redo.";
});
onShown("#save-as", async (current) => {
  const saved = await current.project.workspace.saveAs(current.document);
  if (!saved.ok) return saved.reason === "cancelled" ? null : saved.failure.message;
  if (shown !== current) return null;
  // The copy is a new document (ADR 0022 D1.3): it replaces the source, which the workspace has closed.
  const element = document.createElement("div");
  settings.append(element);
  replaceShown({ project: current.project, document: saved.document, view: mountEditor(current.project, saved.document, element), element });
  return `${current.project.project.name}: ${saved.document.identity.path} (saved as a copy of ${current.document.identity.path})`;
});
onShown("#save-all", async ({ project }) => {
  const results = await project.workspace.saveAll();
  if (results.length === 0) return "Nothing to save.";
  // Each document is saved or not on its own (ADR 0022 D4.1); the message names every one.
  return results.map(({ document, result }) => (result.ok ? `Saved ${document}.` : result.failure.message)).join(" ");
});
onShown("#revert", async ({ project, document }) => {
  const reverted = await project.workspace.revert(document);
  if (reverted.ok) return `Reverted ${document.identity.path} to the version on disk.`;
  return reverted.reason === "cancelled" ? null : reverted.failure.message;
});
onShown("#close", async (current) => {
  const closed = await current.view.close();
  if (!closed.closed) return closed.reason === "cancelled" ? null : `${current.document.identity.path} is still open: ${closed.failure.message}`;
  if (shown === current) replaceShown(null);
  return "No game open.";
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
