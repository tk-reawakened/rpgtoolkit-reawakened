import { foldPath } from "@tk-reawakened/core";
import type { AnyDocument } from "./kinds.ts";
import type { DocumentWorkspace, WorkspaceOpenError } from "./workspace.ts";

/**
 * Linked-document visits (story 11.4): an editor follows a link (a board's link to another board, a character's picture)
 * to the document it names, and can come back. A visit remembers where it started. It never changes either document:
 * coming back to an origin that has been closed reopens it from its file and says so, and coming back to one whose file
 * is gone says that and does nothing else.
 */

export interface VisitEntry {
  /** The project-relative path the visit started from. */
  readonly originPath: string;
  /** The project-relative path visited. */
  readonly targetPath: string;
}

export interface VisitSnapshot {
  /** The visits in progress, the earliest first; the last is the one `returnFromVisit` undoes. */
  readonly stack: readonly VisitEntry[];
  readonly canReturn: boolean;
}

export type VisitResult =
  | { readonly ok: true; readonly document: AnyDocument }
  | { readonly ok: false; readonly error: WorkspaceOpenError };

export type ReturnResult =
  /** The origin is open again in front. `reopened` is true when it had been closed and was read from its file. */
  | { readonly ok: true; readonly document: AnyDocument; readonly reopened: boolean; readonly message: string | null }
  | { readonly ok: false; readonly reason: "nothing-to-return-to" | "origin-lost"; readonly message: string };

export interface Visits {
  getSnapshot(): VisitSnapshot;
  subscribe(listener: () => void): () => void;
  /**
   * Open `targetPath` (one model per document, so a document already open is the same one) and remember `origin`. A
   * visit to the origin itself, or to a document that is already the latest visit's target from the same origin, is
   * not recorded twice.
   */
  visit(origin: AnyDocument, targetPath: string): Promise<VisitResult>;
  /** Go back to the origin of the latest visit. */
  returnFromVisit(): Promise<ReturnResult>;
}

export function createVisits(workspace: DocumentWorkspace): Visits {
  const listeners = new Set<() => void>();
  let stack: readonly VisitEntry[] = [];
  let snapshot: VisitSnapshot = { stack, canReturn: false };

  const publish = (next: readonly VisitEntry[]): void => {
    stack = next;
    snapshot = { stack, canReturn: stack.length > 0 };
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A view that cannot update is that view's fault; the snapshot it missed is still current.
      }
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async visit(origin, targetPath) {
      const opened = await workspace.open(targetPath);
      if (!opened.ok) return opened;
      const entry: VisitEntry = { originPath: origin.identity.path, targetPath: opened.document.identity.path };
      const last = stack.at(-1);
      const same = foldPath(entry.originPath) === foldPath(entry.targetPath)
        || (last !== undefined && foldPath(last.originPath) === foldPath(entry.originPath) && foldPath(last.targetPath) === foldPath(entry.targetPath));
      if (!same) publish([...stack, entry]);
      return { ok: true, document: opened.document };
    },
    async returnFromVisit() {
      const entry = stack.at(-1);
      if (entry === undefined) return { ok: false, reason: "nothing-to-return-to", message: "There is no visit to return from." };
      const open = workspace.documents().find((document) => foldPath(document.identity.path) === foldPath(entry.originPath));
      if (open !== undefined) {
        publish(stack.slice(0, -1));
        return { ok: true, document: open, reopened: false, message: null };
      }
      // The origin was closed while the visit was open. Reopen it from its file: this reads, and changes nothing.
      const reopened = await workspace.open(entry.originPath);
      if (!reopened.ok) {
        publish(stack.slice(0, -1));
        const why = reopened.error.kind === "read" ? reopened.error.error.message : reopened.error.kind === "format" ? reopened.error.error.message : reopened.error.message;
        return {
          ok: false,
          reason: "origin-lost",
          message: `${entry.originPath} is no longer open and could not be opened again (${why}). Nothing was changed.`,
        };
      }
      publish(stack.slice(0, -1));
      return {
        ok: true,
        document: reopened.document,
        reopened: true,
        message: `${entry.originPath} had been closed, so it was opened again from its file. Edits that were not saved before it closed are not in it.`,
      };
    },
  };
}
