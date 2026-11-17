import { useEffect, useState } from "preact/hooks";
import type { CheckpointEntry, CheckpointGroups } from "@tk-reawakened/editor-model";

export function CheckpointView({ groups, version = 0 }: { readonly groups: Pick<CheckpointGroups, "list" | "retry" | "restore" | "ignoreHistory" | "deleteGroup">; readonly version?: number }) {
  const [items, setItems] = useState<readonly CheckpointEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const refresh = async (): Promise<void> => {
    const result = await groups.list();
    if (result.ok) setItems(result.value); else setMessage(result.error.message);
  };
  useEffect(() => { void refresh(); }, [groups, version]);
  const run = async (id: string, action: "retry" | "restore" | "deleteGroup"): Promise<void> => {
    setBusy(true);
    try {
      const result = await groups[action](id);
      setMessage(result.ok ? action === "deleteGroup" ? "Recovery group deleted." : "Operation finished; review each file below." : result.error.message);
      await refresh();
    } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); setDeleting(null); }
  };
  return <section aria-label="Animation recovery">
    <h2>Project recovery</h2>
    <p>Groups remain in .tkr-history until you delete them. Restore makes a separate recoverable group. Close affected documents if recovery asks you to preserve their open work.</p>
    <p>Keep history out of Git by adding <code>/.tkr-history/</code> to your project’s .gitignore. The editor does not change ignore files automatically.</p>
    <button type="button" disabled={busy} onClick={() => { setBusy(true); void groups.ignoreHistory().then((result) => { setMessage(result.ok ? "History ignored in Git; the previous ignore file is recoverable." : result.error.message); return refresh(); }).finally(() => setBusy(false)); }}>Add history to .gitignore</button>
    <button type="button" disabled={busy} onClick={() => void refresh()}>Refresh recovery groups</button>
    {items.map((group) => <article key={"error" in group ? group.path : group.id} aria-label={`Recovery ${group.id}`}>
      {"error" in group ? <><h3>Unavailable recovery group: {group.id}</h3><p role="alert">{group.path}: {group.error} Retry and restore are unavailable.</p></> : <>
      <h3>{group.reason} — {group.time}</h3>
      <ol>{group.files.map((file) => <li key={file.path}>{file.path}: {file.status} {file.message ?? ""}</li>)}</ol>
      <button type="button" disabled={busy || group.files.every((file) => file.status === "written")} onClick={() => void run(group.id, "retry")}>Retry remaining</button>
      <button type="button" disabled={busy} onClick={() => setMessage("Files left as they are. This recovery group remains available after reopening the project.")}>Leave as is</button>
      <button type="button" disabled={busy} onClick={() => void run(group.id, "restore")}>Restore group</button></>}
      <button type="button" disabled={busy || ("error" in group && !group.deletable)} onClick={() => setDeleting(group.id)}>Delete recovery group…</button>
      {deleting === group.id && <div role="group" aria-label="Confirm recovery deletion"><p>Delete this recovery group permanently?</p><button type="button" disabled={busy} onClick={() => void run(group.id, "deleteGroup")}>Delete permanently</button><button type="button" onClick={() => setDeleting(null)}>Cancel</button></div>}
    </article>)}
    {items.length === 0 && <p>No recovery groups.</p>}
    {message !== null && <p role="status">{message}</p>}
  </section>;
}
