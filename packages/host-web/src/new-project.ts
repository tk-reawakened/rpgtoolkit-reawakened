import { createNewProject, type NewProjectSettings, type StarterDefinition } from "@tk-reawakened/editor-model";
import type { ProjectHandle } from "@tk-reawakened/platform-services";
import { mountNewProject, type ViewHandle } from "@tk-reawakened/editor-ui";
import { createWebFileSystem } from "./filesystem.ts";
import { createFolderProject, type WebProject, type WebProjectOptions } from "./index.ts";
import { registerWebProject } from "./projects.ts";

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (this: Window, options: { readonly mode: "readwrite" }) => Promise<FileSystemDirectoryHandle>;
};

/** What the new-project wizard is made with: where it is shown, and optionally how a folder is chosen. */
export interface NewWebProjectOptions extends WebProjectOptions {
  /** The element the wizard is shown over; the overlay is removed when the wizard ends. */
  readonly element: HTMLElement;
  /**
   * Choose the destination folder: `null` when the person cancels. The browser's own directory picker by default (a host
   * built without one cannot create projects); a test supplies its own.
   */
  readonly pickDirectory?: () => Promise<FileSystemDirectoryHandle | null>;
  /** Remember the folder as a stable project (the browser's IndexedDB registry by default); `null` when it cannot. */
  readonly register?: (root: FileSystemDirectoryHandle) => Promise<ProjectHandle | null>;
  /** The starter catalogue the wizard can display and write; the built-in catalogue by default. */
  readonly starters?: readonly StarterDefinition[];
}

export type NewWebProjectResult =
  | {
      readonly ok: true;
      /** The created project, open on its folder. */
      readonly project: WebProject;
      /** The generated main file, project-relative. */
      readonly mainPath: string;
    }
  | { readonly ok: false; readonly reason: "cancelled" | "unsupported"; readonly message: string }
  /** The project was made but this browser could not remember the folder, so it cannot be opened as a stable project. */
  | { readonly ok: false; readonly reason: "unregistered"; readonly message: string };

/** The id the staging filesystem is bound to while the project is written; it is never registered or reused. */
const STAGING_ID = "web:new-project";

function browserPicker(): (() => Promise<FileSystemDirectoryHandle | null>) | null {
  if (typeof window === "undefined") return null;
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (typeof picker !== "function") return null;
  return async () => {
    try {
      return await picker.call(window, { mode: "readwrite" });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
      throw error;
    }
  };
}

/**
 * Show the new-project wizard (T-04) over `options.element` and, when it is completed, create the project in the folder
 * the person chose, register that folder as a stable project and return it open. The destination is the project root. The
 * model compares everything with the folder first and never replaces a file; cancelling, or a refused or failed creation,
 * changes nothing that was already there, and a refused or failed one leaves the wizard open to try again.
 */
export function newWebProject(options: NewWebProjectOptions): Promise<NewWebProjectResult> {
  const pick = options.pickDirectory ?? browserPicker();
  if (pick === null) {
    return Promise.resolve({ ok: false, reason: "unsupported", message: "This browser cannot choose a folder to write to, so it cannot create a project. Use a Chromium-based browser, or create the project in VS Code." });
  }
  const { element } = options;
  const doc = element.ownerDocument;
  const before = doc.activeElement;
  const overlay = doc.createElement("div");
  overlay.className = "tkr-picker-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "New project");
  element.append(overlay);
  const focusable = (): HTMLElement[] => [...overlay.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])')];
  const containFocus = (event: KeyboardEvent): void => {
    if (event.key !== "Tab") return;
    const controls = focusable();
    const first = controls[0];
    const last = controls.at(-1);
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && (doc.activeElement === first || !overlay.contains(doc.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (doc.activeElement === last || !overlay.contains(doc.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  };
  overlay.addEventListener("keydown", containFocus);
  let destination: FileSystemDirectoryHandle | null = null;

  // The host's TypeScript library predates `Promise.withResolvers`, so the resolver is taken from the executor.
  let resolve!: (result: NewWebProjectResult) => void;
  const promise = new Promise<NewWebProjectResult>((done) => { resolve = done; });
  let handle: ViewHandle | null = null;
  const close = (result: NewWebProjectResult): void => {
    handle?.dispose();
    overlay.remove();
    if (before instanceof HTMLElement) before.focus();
    overlay.removeEventListener("keydown", containFocus);
    resolve(result);
  };
  handle = mountNewProject(overlay, {
    ...(options.starters === undefined ? {} : { starters: options.starters }),
    chooseDestination: async () => {
      const chosen = await pick();
      if (chosen === null) return null;
      destination = chosen;
      return chosen.name;
    },
    onCancel: () => close({ ok: false, reason: "cancelled", message: "No project was created." }),
    onCreate: async (settings: NewProjectSettings) => {
      const root = destination;
      if (root === null) return { ok: false, message: "Choose the folder to make the project in." };
      const created = await createNewProject(createWebFileSystem(root, STAGING_ID), settings, options.starters);
      if (!created.ok) {
        return { ok: false, message: created.message, ...(created.reason === "conflicts" ? { details: created.conflicts.map((conflict) => conflict.path) } : created.reason === "failed" ? { details: created.pending } : {}) };
      }
      const registered = await (options.register ?? registerWebProject)(root);
      if (registered === null) {
        close({ ok: false, reason: "unregistered", message: `The project was created in ${root.name}, but this browser could not remember the folder. Open it with "Open project folder".` });
        return { ok: true };
      }
      close({ ok: true, project: createFolderProject(root, registered, options), mainPath: created.mainPath });
      return { ok: true };
    },
  });
  return promise;
}
