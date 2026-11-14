import { foldPath, type AssetKind } from "@tk-reawakened/core";
import type { Capabilities, DialogService, FileSystemService, PlatformError, ShellService } from "@tk-reawakened/platform-services";
import { kindForPath, type AnyDocument } from "./kinds.ts";
import { reservedFolder, unusableName, type ProjectLayout } from "./reserved-folders.ts";
import type { DocumentWorkspace, WorkspaceOpenError } from "./workspace.ts";

/**
 * The project file tree (T-03) and the Game navigation (T-02): what is in the project, what opening a file does, and the
 * file operations on it. It lists through `fs`, opens Toolkit documents in the workspace (so a document opened from the
 * tree and from the Game list is one model, ADR 0022 D1.2), hands other files to the operating system through
 * `shell.openExternal` where the host has it, and says what the host cannot do instead of failing silently.
 *
 * It never changes a document's content. Rename and delete refuse while a document under the path is open, because
 * moving or removing a file under an open model would leave the model saving over a path that is no longer the file.
 */

export interface TreeRow {
  readonly path: string;
  readonly name: string;
  readonly kind: "file" | "directory";
  readonly depth: number;
  /** For a folder: whether its children are listed. */
  readonly expanded: boolean;
  /** For a file: what opening it does. `document` opens an editor, `external` hands it to the OS, `unavailable` explains. */
  readonly route: "document" | "external" | "unavailable" | null;
  /** For a file with a document route: the registered kind that claims it. */
  readonly documentKind: string | null;
  /** Whether a document for this path is open in the workspace now. */
  readonly open: boolean;
}

export interface TreeSnapshot {
  readonly rows: readonly TreeRow[];
  /** The last action's failure or refusal, in a sentence safe to show; `null` when there is none. */
  readonly message: string | null;
  /** Folders that could not be listed, with the host's reason; they show as empty and are named here, never hidden. */
  readonly failures: readonly { readonly path: string; readonly error: PlatformError }[];
}

export type TreeOpenResult =
  | { readonly ok: true; readonly via: "document"; readonly document: AnyDocument }
  | { readonly ok: true; readonly via: "external" }
  | { readonly ok: false; readonly error: WorkspaceOpenError | { readonly kind: "unavailable"; readonly document: string; readonly message: string } };

export type TreeOperationResult = { readonly ok: true } | { readonly ok: false; readonly reason: "cancelled" | "refused" | "failed"; readonly message: string };

export interface ProjectTree {
  getSnapshot(): TreeSnapshot;
  subscribe(listener: () => void): () => void;
  /** Read the root and every expanded folder again. */
  refresh(): Promise<void>;
  /** Show or hide a folder's children. */
  toggle(path: string): Promise<void>;
  collapseAll(): void;
  /** Open the file the way its route says (T-03). */
  open(path: string): Promise<TreeOpenResult>;
  /** Rename the file or folder at `path` to `newName` inside the same folder. */
  rename(path: string, newName: string): Promise<TreeOperationResult>;
  /** Delete the file, or the folder and everything in it, after the user confirms. */
  remove(path: string): Promise<TreeOperationResult>;
  dispose(): void;
}

export interface ProjectTreeOptions {
  readonly services: {
    readonly fs: FileSystemService;
    readonly dialogs: DialogService;
    readonly capabilities: Capabilities;
    readonly shell?: ShellService;
  };
  readonly workspace: DocumentWorkspace;
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function sortEntries<T extends { readonly name: string; readonly kind: "file" | "directory" }>(entries: readonly T[]): T[] {
  // Folders first, then names by ASCII fold: the order is the same on every host and does not depend on the locale.
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    const x = foldPath(a.name);
    const y = foldPath(b.name);
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

export function createProjectTree(options: ProjectTreeOptions): ProjectTree {
  const { services, workspace } = options;
  const { fs, dialogs, capabilities } = services;
  const listeners = new Set<() => void>();
  /** Listed folders by path (`""` is the root), with their entries as the host gave them. */
  const listed = new Map<string, readonly { readonly name: string; readonly kind: "file" | "directory" }[]>();
  const expanded = new Set<string>();
  let failures: TreeSnapshot["failures"] = [];
  let message: string | null = null;
  let snapshot: TreeSnapshot = { rows: [], message: null, failures: [] };
  let disposed = false;
  let generation = 0;

  const openPaths = (): Set<string> => new Set(workspace.documents().map((document) => foldPath(document.identity.path)));
  const underOpenDocument = (path: string): string | null => {
    const folded = foldPath(path);
    for (const document of workspace.documents()) {
      const documentPath = foldPath(document.identity.path);
      if (documentPath === folded || documentPath.startsWith(`${folded}/`)) return document.identity.path;
    }
    return null;
  };

  const routeOf = (path: string): Pick<TreeRow, "route" | "documentKind"> => {
    const kind = kindForPath(path);
    if (kind !== null) return { route: "document", documentKind: kind.id };
    return { route: capabilities.has("openExternal") && services.shell !== undefined ? "external" : "unavailable", documentKind: null };
  };

  const build = (): TreeSnapshot => {
    const rows: TreeRow[] = [];
    const open = openPaths();
    const walk = (folder: string, depth: number): void => {
      for (const entry of sortEntries(listed.get(folder) ?? [])) {
        const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
        if (entry.kind === "directory") {
          const isOpen = expanded.has(path);
          rows.push({ path, name: entry.name, kind: "directory", depth, expanded: isOpen, route: null, documentKind: null, open: false });
          if (isOpen) walk(path, depth + 1);
        } else {
          rows.push({ path, name: entry.name, kind: "file", depth, expanded: false, ...routeOf(path), open: open.has(foldPath(path)) });
        }
      }
    };
    walk("", 0);
    return { rows, message, failures };
  };

  const publish = (): void => {
    if (disposed) return;
    snapshot = build();
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A view that cannot update is that view's fault; the snapshot it missed is still current.
      }
    }
  };

  const read = async (folder: string): Promise<void> => {
    const result = await fs.list(folder);
    if (result.ok) {
      listed.set(folder, result.value.map((entry) => ({ name: entry.name, kind: entry.kind })));
      failures = failures.filter((failure) => failure.path !== folder);
    } else {
      listed.set(folder, []);
      failures = [...failures.filter((failure) => failure.path !== folder), { path: folder, error: result.error }];
    }
  };

  const fail = (reason: "refused" | "failed", text: string): TreeOperationResult => {
    message = text;
    publish();
    return { ok: false, reason, message: text };
  };

  const tree: ProjectTree = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async refresh() {
      const mine = ++generation;
      const folders = ["", ...expanded].sort();
      for (const folder of folders) await read(folder);
      if (mine !== generation) return;
      // A folder that no longer exists is no longer expanded.
      for (const folder of [...expanded]) {
        const parent = listed.get(parentOf(folder));
        if (parent === undefined || !parent.some((entry) => entry.kind === "directory" && entry.name === nameOf(folder))) expanded.delete(folder);
      }
      message = null;
      publish();
    },
    async toggle(path) {
      if (expanded.has(path)) {
        expanded.delete(path);
      } else {
        expanded.add(path);
        await read(path);
      }
      publish();
    },
    collapseAll() {
      expanded.clear();
      publish();
    },
    async open(path) {
      const route = routeOf(path);
      if (route.route === "document") {
        const opened = await workspace.open(path);
        if (!opened.ok) {
          message = opened.error.kind === "read" || opened.error.kind === "format" ? `${opened.error.document}: ${opened.error.error.message}` : opened.error.message;
          publish();
          return { ok: false, error: opened.error };
        }
        message = null;
        publish();
        return { ok: true, via: "document", document: opened.document };
      }
      if (route.route === "external" && services.shell !== undefined) {
        const result = await services.shell.openExternal(path);
        if (!result.ok) {
          message = `${path} could not be opened in another application: ${result.error.message}`;
          publish();
          return { ok: false, error: { kind: "unavailable", document: path, message } };
        }
        message = null;
        publish();
        return { ok: true, via: "external" };
      }
      message = `${path} is not a file the editor opens, and this host cannot open it in another application.`;
      publish();
      return { ok: false, error: { kind: "unavailable", document: path, message } };
    },
    async rename(path, newName) {
      const unusable = unusableName(newName);
      if (unusable !== null) return fail("refused", unusable);
      const holder = underOpenDocument(path);
      if (holder !== null) return fail("refused", `${holder} is open. Close it before renaming ${path}, so no editor saves over a file that has moved.`);
      const parent = parentOf(path);
      const siblings = await fs.list(parent);
      if (!siblings.ok) return fail("failed", `Could not read ${parent === "" ? "the project folder" : parent}: ${siblings.error.message}`);
      const target = parent === "" ? newName : `${parent}/${newName}`;
      if (siblings.value.some((entry) => foldPath(entry.name) === foldPath(newName) && foldPath(entry.name) !== foldPath(nameOf(path)))) {
        return fail("refused", `${target} already exists (names are compared without regard to A-Z case). Nothing was renamed.`);
      }
      const renamed = await fs.rename(path, target);
      if (!renamed.ok) return fail("failed", `Could not rename ${path} to ${newName}: ${renamed.error.message}`);
      if (expanded.delete(path)) expanded.add(target);
      await tree.refresh();
      return { ok: true };
    },
    async remove(path) {
      const holder = underOpenDocument(path);
      if (holder !== null) return fail("refused", `${holder} is open. Close it before deleting ${path}.`);
      const stat = await fs.stat(path);
      if (!stat.ok) return fail("failed", `Could not find ${path}: ${stat.error.message}`);
      const folder = stat.value.kind === "directory";
      const answer = await dialogs.ask({
        message: folder ? `Delete the folder ${path} and everything in it?` : `Delete ${path}?`,
        detail: "This cannot be undone from the editor. Cancel deletes nothing.",
        choices: [{ id: "delete", label: "Delete" }, { id: "cancel", label: "Cancel" }],
        cancel: "cancel",
      });
      if (answer !== "delete") return { ok: false, reason: "cancelled", message: `${path} was not deleted.` };
      const removed = await fs.delete(path);
      if (!removed.ok) return fail("failed", `Could not delete ${path}: ${removed.error.message}`);
      for (const known of [...expanded]) if (known === path || known.startsWith(`${path}/`)) expanded.delete(known);
      await tree.refresh();
      return { ok: true };
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
  return tree;
}

/** The friendly name of each reserved folder in the Game list. */
const GAME_LABELS: Readonly<Partial<Record<AssetKind, string>>> = {
  boards: "Boards",
  characters: "Characters",
  items: "Items",
  enemies: "Enemies",
  specialMoves: "Special moves",
  statusEffects: "Status effects",
  backgrounds: "Battle backgrounds",
  animations: "Animations",
  tiles: "Tiles",
  bitmaps: "Pictures",
  media: "Sound and music",
  programs: "Programs",
  fonts: "Fonts",
  plugins: "Plugins",
};

export interface GameGroup {
  readonly kind: AssetKind;
  readonly label: string;
  readonly folder: string;
  /** The files below the folder and its sub-folders, by path. */
  readonly files: readonly { readonly path: string; readonly name: string; readonly openable: boolean }[];
}

/**
 * The Game view (T-02): the project grouped by what each file is (its reserved folder), not by where it sits. A group is
 * listed only if its folder holds a file. The same `ProjectTree.open` opens an entry, so a file reached from Game and
 * from Files is one document.
 */
export async function listGame(fs: Pick<FileSystemService, "list">, layout: ProjectLayout): Promise<{ readonly groups: readonly GameGroup[]; readonly failures: readonly { readonly path: string; readonly error: PlatformError }[] }> {
  const groups: GameGroup[] = [];
  const failures: { path: string; error: PlatformError }[] = [];
  for (const kind of Object.keys(GAME_LABELS) as AssetKind[]) {
    const folder = reservedFolder(layout, kind);
    const files: { path: string; name: string; openable: boolean }[] = [];
    const pending = [folder];
    while (pending.length > 0) {
      const current = pending.pop()!;
      const entries = await fs.list(current);
      if (!entries.ok) {
        if (entries.error.code !== "not-found") failures.push({ path: current, error: entries.error });
        continue;
      }
      for (const entry of entries.value) {
        const path = `${current}/${entry.name}`;
        if (entry.kind === "directory") pending.push(path);
        else files.push({ path, name: entry.name, openable: kindForPath(path) !== null });
      }
    }
    if (files.length === 0) continue;
    files.sort((a, b) => (foldPath(a.path) < foldPath(b.path) ? -1 : foldPath(a.path) > foldPath(b.path) ? 1 : 0));
    groups.push({ kind, label: GAME_LABELS[kind] ?? folder, folder, files });
  }
  return { groups, failures };
}
