import type { ProjectTree, TreeOpenResult, TreeRow } from "@tk-reawakened/editor-model";
import { useEffect, useRef, useState } from "preact/hooks";
import { useDocumentSnapshot } from "./use-document.ts";

let viewsMade = 0;

export interface FilesViewProps {
  readonly tree: ProjectTree;
  /** Called after a file opens, so the host can show its editor (a Toolkit document) in a tab. */
  readonly onOpened?: (result: Extract<TreeOpenResult, { readonly ok: true }>, row: TreeRow) => void;
}

/** What opening a file does, in words for a person choosing: the row's own label and the toolbar's. */
function routeNote(row: TreeRow): string {
  if (row.kind === "directory") return row.expanded ? "folder, open" : "folder, closed";
  if (row.route === "document") return `${row.documentKind ?? "document"} editor`;
  if (row.route === "external") return "opens in another application";
  return "cannot be opened here";
}

/**
 * The project file tree (T-03). One tab stop (a roving tabindex) that moves with the arrow keys; Enter opens, Right and
 * Left open and close a folder, F2 renames and Delete deletes, and every one of those is also a button in the toolbar,
 * so nothing needs a pointer or a context menu. A refusal or a host failure is shown in a live region; nothing is
 * renamed or deleted without the tree's own checks and, for delete, the user's confirmation.
 */
export function FilesView({ tree, onOpened }: FilesViewProps) {
  const snapshot = useDocumentSnapshot(tree);
  const [ids] = useState(() => {
    viewsMade += 1;
    return `tkr-files-${viewsMade}`;
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const focusRow = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const rows = snapshot.rows;
  const current = rows.find((row) => row.path === selected) ?? null;
  const active = current ?? rows[0] ?? null;

  useEffect(() => {
    void tree.refresh();
  }, [tree]);

  useEffect(() => {
    if (!focusRow.current) return;
    focusRow.current = false;
    list.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  });

  const select = (path: string): void => {
    focusRow.current = true;
    setSelected(path);
  };
  const run = (action: () => Promise<unknown>): void => {
    setBusy(true);
    void action().finally(() => setBusy(false));
  };
  const open = (row: TreeRow): void => {
    if (row.kind === "directory") {
      run(() => tree.toggle(row.path));
      return;
    }
    run(async () => {
      const result = await tree.open(row.path);
      if (result.ok) onOpened?.(result, row);
    });
  };
  const startRename = (row: TreeRow): void => {
    setRenaming(row.path);
    setDraft(row.name);
  };
  const commitRename = (): void => {
    if (renaming === null) return;
    const path = renaming;
    run(async () => {
      const result = await tree.rename(path, draft);
      if (result.ok) setRenaming(null);
    });
  };

  const onKeyDown = (event: KeyboardEvent, row: TreeRow, index: number): void => {
    const move = (to: number): void => {
      event.preventDefault();
      const target = rows[Math.max(0, Math.min(rows.length - 1, to))];
      if (target !== undefined) select(target.path);
    };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(rows.length - 1);
    else if (event.key === "ArrowRight") {
      event.preventDefault();
      if (row.kind === "directory" && !row.expanded) open(row);
      else if (row.kind === "directory") move(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (row.kind === "directory" && row.expanded) open(row);
      else {
        const parent = rows.slice(0, index).reverse().find((candidate) => candidate.kind === "directory" && candidate.depth === row.depth - 1);
        if (parent !== undefined) select(parent.path);
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open(row);
    } else if (event.key === "F2") {
      event.preventDefault();
      startRename(row);
    } else if (event.key === "Delete") {
      event.preventDefault();
      run(() => tree.remove(row.path));
    }
  };

  return (
    <section class="tkr-files" aria-label="Files">
      <h2 class="tkr-files-heading">Files</h2>
      <div class="tkr-files-toolbar" role="toolbar" aria-label="File actions">
        <button type="button" class="tkr-files-refresh" disabled={busy} onClick={() => run(() => tree.refresh())}>Refresh</button>
        <button type="button" class="tkr-files-collapse" onClick={() => tree.collapseAll()}>Collapse all</button>
        <button type="button" class="tkr-files-open" disabled={busy || current === null} onClick={() => current !== null && open(current)}>
          {current?.kind === "directory" ? (current.expanded ? "Close folder" : "Open folder") : "Open"}
        </button>
        <button type="button" class="tkr-files-rename" disabled={busy || current === null} onClick={() => current !== null && startRename(current)}>Rename…</button>
        <button type="button" class="tkr-files-delete" disabled={busy || current === null} onClick={() => current !== null && run(() => tree.remove(current.path))}>Delete…</button>
      </div>
      {renaming === null ? null : (
        <div class="tkr-files-rename-row" role="group" aria-label={`Rename ${renaming}`}>
          <label for={`${ids}-name`}>New name for {renaming}</label>
          <input
            id={`${ids}-name`}
            type="text"
            value={draft}
            onInput={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();
              else if (event.key === "Escape") setRenaming(null);
            }}
          />
          <button type="button" class="tkr-files-rename-ok" disabled={busy} onClick={commitRename}>Rename</button>
          <button type="button" class="tkr-files-rename-cancel" onClick={() => setRenaming(null)}>Cancel</button>
        </div>
      )}
      <div ref={list} class="tkr-files-tree" role="tree" aria-label="Project files">
        {rows.map((row, index) => (
          <div
            key={row.path}
            role="treeitem"
            class={row.path === active?.path ? "tkr-files-row tkr-files-row-selected" : "tkr-files-row"}
            tabIndex={row.path === active?.path ? 0 : -1}
            aria-level={row.depth + 1}
            aria-selected={row.path === active?.path}
            aria-expanded={row.kind === "directory" ? row.expanded : undefined}
            aria-label={`${row.name}, ${routeNote(row)}${row.open ? ", open" : ""}`}
            onClick={() => setSelected(row.path)}
            onDblClick={() => open(row)}
            onKeyDown={(event) => onKeyDown(event, row, index)}
          >
            {row.kind === "directory" ? (row.expanded ? "▾ " : "▸ ") : ""}
            {row.name}
          </div>
        ))}
      </div>
      {rows.length === 0 ? <p class="tkr-files-empty" role="status">This project has no files.</p> : null}
      {snapshot.failures.length === 0 ? null : (
        <ul class="tkr-files-failures" aria-label="Folders that could not be read">
          {snapshot.failures.map((failure) => <li key={failure.path}>{failure.path === "" ? "The project folder" : failure.path}: {failure.error.message}</li>)}
        </ul>
      )}
      {snapshot.message === null ? null : <p class="tkr-files-message" role="alert">{snapshot.message}</p>}
    </section>
  );
}
