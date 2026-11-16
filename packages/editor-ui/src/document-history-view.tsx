import type { DocumentWorkspace, HistoryPreview } from "@tk-reawakened/editor-model";
import type { FileSystemService } from "@tk-reawakened/platform-services";
import { useEffect, useState } from "preact/hooks";

export interface DocumentHistoryViewProps {
  readonly workspace: DocumentWorkspace;
  readonly fs: Pick<FileSystemService, "list" | "read">;
  readonly activePath: string | null;
}

const HISTORY_ROOT = ".tkr-history";

function textPreview(preview: HistoryPreview): string {
  const bytes = preview.bytes;
  if (bytes.length > 32768) return `Preview omitted (${bytes.length} bytes).`;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return `Binary content · ${bytes.length} bytes · SHA-256 ${preview.entry.sha256}`;
  }
}

/** Read-only history timelines and explicit, per-file restore controls. */
export function DocumentHistoryView({ workspace, fs, activePath }: DocumentHistoryViewProps) {
  const [tab, setTab] = useState<"document" | "project" | "checkpoints">("document");
  const [rows, setRows] = useState<readonly { id: string; label: string; path: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<HistoryPreview | null>(null);
  const [status, setStatus] = useState("");
  const [armed, setArmed] = useState(false);
  const refresh = async () => {
    try {
      if (tab === "document") {
        const path = activePath;
        const entries = path === null ? [] : await workspace.history.documentTimeline(path);
        setRows(entries.map((entry) => ({ id: entry.id, path: entry.path, label: `${new Date(entry.savedAt).toLocaleString()} · ${entry.reason} · ${entry.sha256.slice(0, 12)}` })));
      } else if (tab === "project") {
        const entries = await workspace.history.projectTimeline();
        setRows(entries.map((entry) => ({ id: entry.id, path: entry.path, label: `${new Date(entry.savedAt).toLocaleString()} · ${entry.path} · ${entry.reason}` })));
      } else {
        const groups = await workspace.history.groupTimeline();
        setRows(groups.map((group) => ({ id: group.id, path: group.before[0]?.path ?? "", label: `${new Date(group.createdAt).toLocaleString()} · ${group.name ?? "Checkpoint"} · ${group.before.length} files` })));
      }
      setSelected(null);
      setPreview(null);
      setArmed(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };
  useEffect(() => { void refresh(); }, [tab, activePath, workspace]);

  const previewSelected = async (id: string) => {
    setSelected(id);
    setPreview(null);
    setArmed(false);
    try {
      if (tab === "checkpoints") {
        const path = rows.find((row) => row.id === id)?.path;
        const item = path === undefined || path === "" ? null : await workspace.history.previewGroup(id, path);
        setPreview(item === null ? null : { entry: { id, path: item.path, savedAt: 0, reason: "checkpoint", sha256: item.sha256, size: item.bytes.length, groupId: id }, bytes: item.bytes });
      } else setPreview(await workspace.history.preview(id));
      setStatus("");
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  };

  const restore = async () => {
    if (selected === null) return;
    if (!armed) { setArmed(true); return; }
    try {
      if (tab === "checkpoints") {
        const result = await workspace.history.restoreGroup(selected);
        setStatus(result.files.map((file) => `${file.path || "Checkpoint"}: ${file.result}${file.message ? ` (${file.message})` : ""}`).join("\n"));
      } else {
        const result = await workspace.history.restoreEntry(selected);
        setStatus(result.ok ? "File restored; the restore was added to history." : result.message);
      }
      setArmed(false);
      await refresh();
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  };

  const createCheckpoint = async () => {
    try {
      const documents: { path: string; bytes: Uint8Array }[] = [];
      const visit = async (folder: string): Promise<void> => {
        const result = await fs.list(folder);
        if (!result.ok) throw new Error(result.error.message);
        for (const item of result.value) {
          const path = folder === "" ? item.name : `${folder}/${item.name}`;
          if (item.kind === "directory") {
            if (item.name !== HISTORY_ROOT && !item.name.startsWith(".tkr-exports")) await visit(path);
          } else if (item.kind === "file") {
            const read = await fs.read(path);
            if (!read.ok) throw new Error(`Could not read ${path}: ${read.error.message}`);
            documents.push({ path, bytes: read.value });
          }
        }
      };
      await visit("");
      const name = globalThis.prompt("Checkpoint name");
      if (name === null) return;
      await workspace.history.createNamedCheckpoint(name, documents);
      setStatus(`Checkpoint “${name.trim() || "Checkpoint"}” saved (${documents.length} files).`);
      setTab("checkpoints");
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  };

  return <section class="tkr-history" aria-label="Document history">
    <h2>Document history</h2>
    <nav aria-label="History timelines">
      <button type="button" aria-pressed={tab === "document"} onClick={() => setTab("document")}>Document</button>
      <button type="button" aria-pressed={tab === "project"} onClick={() => setTab("project")}>Project</button>
      <button type="button" aria-pressed={tab === "checkpoints"} onClick={() => setTab("checkpoints")}>Checkpoints</button>
      <button type="button" onClick={() => void createCheckpoint()}>Create checkpoint</button>
      <button type="button" onClick={() => void refresh()}>Refresh</button>
    </nav>
    <ol>{rows.map((row) => <li key={row.id}><button type="button" aria-pressed={selected === row.id} onClick={() => void previewSelected(row.id)}>{row.label}</button></li>)}</ol>
    {preview !== null && <section aria-label="History preview"><h3>{preview.entry.path}</h3><pre>{textPreview(preview)}</pre><button type="button" onClick={() => void restore()}>{armed ? "Confirm restore" : "Restore this version"}</button>{armed && <button type="button" onClick={() => setArmed(false)}>Cancel</button>}</section>}
    {status !== "" && <pre role="status">{status}</pre>}
  </section>;
}
