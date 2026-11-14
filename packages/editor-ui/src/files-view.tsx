import type { PackageArtifact, PreparedGamePackage, ProjectTree, TreeOpenResult, TreeRow } from "@tk-reawakened/editor-model";
import type { FileSystemService } from "@tk-reawakened/platform-services";
import { useEffect, useRef, useState } from "preact/hooks";
import { useDocumentSnapshot } from "./use-document.ts";

let viewsMade = 0;

export type PackageActionOutcome =
  | { readonly ok: true; readonly prepared: PreparedGamePackage }
  | { readonly ok: false; readonly message: string };

export interface FilesViewProps {
  readonly tree: ProjectTree;
  readonly fs: Pick<FileSystemService, "list">;
  readonly onPackage: (mainPath: string, version: string) => Promise<PackageActionOutcome>;
  readonly onDownload: (artifact: PackageArtifact) => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
  /** Called after a file opens, so the host can show its editor (a Toolkit document) in a tab. */
  readonly onOpened?: (result: Extract<TreeOpenResult, { readonly ok: true }>, row: TreeRow) => void;
  /** Ask the host for the new-board questions (T-20); the button is shown only when the host can answer. */
  readonly onNewBoard?: () => void;
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
export function FilesView({ tree, fs, onOpened, onNewBoard, onPackage, onDownload }: FilesViewProps) {
  const snapshot = useDocumentSnapshot(tree);
  const [ids] = useState(() => {
    viewsMade += 1;
    return `tkr-files-${viewsMade}`;
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [packageOpen, setPackageOpen] = useState(false);
  const [mainFiles, setMainFiles] = useState<readonly string[]>([]);
  const [mainPath, setMainPath] = useState("");
  const [packageVersion, setPackageVersion] = useState("");
  const [packageBusy, setPackageBusy] = useState(false);
  const [packageMessage, setPackageMessage] = useState("");
  const [prepared, setPrepared] = useState<PreparedGamePackage | null>(null);
  const [inventoryReviewed, setInventoryReviewed] = useState(false);
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
  const openPackage = (): void => {
    setPackageOpen(true);
    setPrepared(null);
    setPackageMessage("Loading main files…");
    void fs.list("Main").then((listing) => {
      if (!listing.ok) {
        setMainFiles([]);
        setMainPath("");
        setPackageMessage(`Could not list Main/: ${listing.error.message}`);
        return;
      }
      const paths = listing.value
        .filter((entry) => entry.kind === "file" && entry.name.toLowerCase().endsWith(".gam"))
        .map((entry) => `Main/${entry.name}`);
      setMainFiles(paths);
      setMainPath(paths[0] ?? "");
      setPackageMessage(paths.length === 0 ? "No .gam main files were found in Main/." : "");
    }).catch(() => setPackageMessage("Could not list the project's Main folder."));
  };
  const packageGame = (): void => {
    if (mainPath.length === 0 || packageVersion.trim().length === 0) {
      setPackageMessage("Choose a main file and enter its release version.");
      return;
    }
    setPackageBusy(true);
    setPrepared(null);
    setInventoryReviewed(false);
    setPackageMessage("Saving open documents and checking the package…");
    void onPackage(mainPath, packageVersion).then((outcome) => {
      if (!outcome.ok) {
        setPackageMessage(outcome.message);
        return;
      }
      setPrepared(outcome.prepared);
      setPackageMessage("Preflight passed. Review the inventory below, then download the package and its install descriptor.");
    }).catch(() => setPackageMessage("Package export failed before completion. No successful export was reported."))
      .finally(() => setPackageBusy(false));
  };
  const download = (artifact: PackageArtifact): void => {
    setPackageBusy(true);
    setPackageMessage(`Starting download for ${artifact.fileName}…`);
    void onDownload(artifact).then((result) => {
      setPackageMessage(result.ok
        ? `Download started for ${artifact.fileName}. If your browser saved it under a different name (for example with " (1)" added because a file of that name already existed), rename it back to exactly ${artifact.fileName} before using it.`
        : result.message);
    }).catch(() => setPackageMessage(`Could not start the download for ${artifact.fileName}.`))
      .finally(() => setPackageBusy(false));
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
        {onNewBoard === undefined ? null : <button type="button" class="tkr-files-new-board" disabled={busy} onClick={onNewBoard}>New board…</button>}
        <button type="button" class="tkr-files-refresh" disabled={busy} onClick={() => run(() => tree.refresh())}>Refresh</button>
        <button type="button" class="tkr-files-collapse" onClick={() => tree.collapseAll()}>Collapse all</button>
        <button type="button" class="tkr-files-open" disabled={busy || current === null} onClick={() => current !== null && open(current)}>
          {current?.kind === "directory" ? (current.expanded ? "Close folder" : "Open folder") : "Open"}
        </button>
        <button type="button" class="tkr-files-rename" disabled={busy || current === null} onClick={() => current !== null && startRename(current)}>Rename…</button>
        <button type="button" class="tkr-files-delete" disabled={busy || current === null} onClick={() => current !== null && run(() => tree.remove(current.path))}>Delete…</button>
        <button type="button" class="tkr-files-package" disabled={packageBusy} onClick={openPackage}>Package game…</button>
      </div>
      {packageOpen ? (
        <div class="tkr-files-package-panel" role="group" aria-label="Package game">
          <h3>Package game</h3>
          <p>Creates a playable TPK archive and its sibling install descriptor. Saved/, other Main files, editor-only assets, test-only programs, and .tkr-history/ are excluded.</p>
          <label for={`${ids}-main`}>Main game file</label>
          <select
            id={`${ids}-main`}
            value={mainPath}
            onChange={(event) => {
              const next = event.currentTarget.value;
              setMainPath(next);
              setPrepared(null);
              setInventoryReviewed(false);
              if (prepared !== null) setPackageMessage("Main file changed. Prepare and review the package again.");
            }}
            disabled={packageBusy || mainFiles.length === 0}
          >
            {mainFiles.map((path) => <option key={path} value={path}>{path}</option>)}
          </select>
          <label for={`${ids}-version`}>Release version</label>
          <input
            id={`${ids}-version`}
            type="text"
            required
            maxLength={128}
            value={packageVersion}
            onInput={(event) => {
              setPackageVersion(event.currentTarget.value);
              setPrepared(null);
              setInventoryReviewed(false);
              if (prepared !== null) setPackageMessage("Release version changed. Prepare and review the package again.");
            }}
            disabled={packageBusy}
          />
          <div class="tkr-files-package-actions">
            <button type="button" disabled={packageBusy || mainFiles.length === 0 || packageVersion.trim().length === 0} onClick={packageGame}>
              {packageBusy ? "Working…" : "Prepare package"}
            </button>
            <button type="button" disabled={packageBusy} onClick={() => setPackageOpen(false)}>Close</button>
          </div>
          {packageMessage.length === 0 ? null : <p class="tkr-files-package-status" role="status">{packageMessage}</p>}
          {prepared === null ? null : (
            <div class="tkr-files-package-result">
              <p>{prepared.includedFiles.length} files included; {prepared.excludedFiles.length} excluded.</p>
              <p>Package output: <code>{prepared.package.fileName}</code>; install descriptor: <code>{prepared.descriptor.fileName}</code>.</p>
              <p>This preflight uses the saved project files from the time it completed, and the downloads carry exactly the bytes reviewed here. The files are offered as ordinary downloads; this page does not write into the project folder, so nothing in the project is replaced.</p>
              <p>The package and its descriptor are two separate downloads, and the descriptor names the package file. Keep both together under exactly the names shown above. Your browser may rename a download when a file of that name already exists (for example "{prepared.package.fileName} (1)"); if it renames only one of the pair, or either differs from the names above, rename it back (or remove the older copy first) before installing, or the descriptor will not match the package.</p>
              <p>This page cannot tell whether a folder entry is a link to somewhere else on your computer. Every file that will be packaged is listed in the inventory below; do not use the package if it lists files that do not belong to your game.</p>
              <details>
                <summary>Included and excluded file inventory</summary>
                <h4>Included</h4>
                <ul>{prepared.includedFiles.map((path) => <li key={`in-${path}`}>{path}</li>)}</ul>
                <h4>Excluded</h4>
                {prepared.excludedFiles.length === 0
                  ? <p>No excluded files were found.</p>
                  : <ul>{prepared.excludedFiles.map((path) => <li key={`out-${path}`}>{path}</li>)}</ul>}
              </details>
              <label for={`${ids}-reviewed`}>
                <input
                  id={`${ids}-reviewed`}
                  type="checkbox"
                  checked={inventoryReviewed}
                  disabled={packageBusy}
                  onChange={(event) => setInventoryReviewed(event.currentTarget.checked)}
                />
                I reviewed the included and excluded files.
              </label>
              <div class="tkr-files-package-downloads">
                <button type="button" disabled={packageBusy || !inventoryReviewed} onClick={() => download(prepared.package)}>Download {prepared.package.fileName}</button>
                <button type="button" disabled={packageBusy || !inventoryReviewed} onClick={() => download(prepared.descriptor)}>Download {prepared.descriptor.fileName}</button>
              </div>
            </div>
          )}
        </div>
      ) : null}
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
