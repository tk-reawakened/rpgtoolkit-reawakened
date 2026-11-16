import { HISTORY_FOLDER, type CheckpointGroup, type DocumentHistoryEntry, type DocumentWorkspace } from "@tk-reawakened/editor-model";

/**
 * The VS Code History command (#2833): the shared workspace does the work (timeline, preview bytes, restore with its
 * per-file report), and VS Code only shows a pick list and messages — a thin adapter, like the other VS Code commands.
 * The preview is the shared History panel in the browser and desktop hosts; here the entry's saved bytes are offered to
 * the editor the same way a file is, so no host-only history exists (ADR 0022 D12.9).
 */
export interface HistoryCommandUi {
  pick(items: readonly { readonly id: string; readonly label: string; readonly description: string }[], placeholder: string): Promise<string | undefined>;
  tell(message: string): Promise<void>;
  /** Open saved bytes in a read-only editor tab; resolves `false` when this host cannot. */
  showPreview?(path: string, bytes: Uint8Array, description: string): Promise<boolean>;
}

const reasonWords: Readonly<Record<DocumentHistoryEntry["reason"], string>> = {
  auto: "autosave", manual: "saved", "before-run": "before a run", "before-restore": "before a restore",
  "before-conflict-resolution": "before resolving a conflict", "before-delete": "before a delete", "before-wizard": "before a wizard", checkpoint: "checkpoint",
};

const labelOf = (entry: DocumentHistoryEntry, withPath: boolean): string =>
  `${new Date(entry.savedAt).toLocaleString()} · ${withPath ? `${entry.path} · ` : ""}${reasonWords[entry.reason]} · ${entry.size} bytes`;

/** Offer the active document's history (or the whole project when nothing is open), preview one entry and restore it. */
export async function runHistoryCommand(workspace: DocumentWorkspace, activePath: string | null, ui: HistoryCommandUi): Promise<void> {
  try {
    await workspace.history.reload();
    const entries = activePath === null ? await workspace.history.projectTimeline() : await workspace.history.documentTimeline(activePath);
    const groupsResult = await workspace.checkpoints.list();
    if (!groupsResult.ok) throw new Error(groupsResult.error.message);
    const groups = groupsResult.value.filter((entry): entry is CheckpointGroup => "files" in entry
      && (activePath === null || entry.files.some((file) => file.path === activePath)));
    if (entries.length === 0 && groups.length === 0) {
      await ui.tell(`No history yet${activePath === null ? "" : ` for ${activePath}`}. Save a document and it is kept in ${HISTORY_FOLDER}/.`);
      return;
    }
    const newestFirst = [...entries].reverse();
    const items = [
      ...newestFirst.map((entry) => ({ id: `entry:${entry.id}`, label: labelOf(entry, activePath === null), description: entry.sha256.slice(0, 12) })),
      ...groups.map((group) => ({
        id: `group:${group.id}`,
        label: `${new Date(group.time).toLocaleString()} · ${group.name ?? group.reason} · ${group.files.length} files`,
        description: "recovery group",
      })),
    ];
    const chosen = await ui.pick(items, "Restore a saved version or recovery group");
    if (chosen === undefined) return;
    if (chosen.startsWith("group:")) {
      const group = groups.find((candidate) => candidate.id === chosen.slice("group:".length));
      if (group === undefined || !("files" in group)) return;
      const report = await workspace.restoreHistoryGroup(group.id, activePath === null ? undefined : { only: [activePath] });
      const lines = report.files.map((file) => `${file.path === "" ? "Checkpoint" : file.path}: ${file.result}${file.message === undefined ? "" : ` (${file.message})`}`);
      await ui.tell(report.restoreGroupId === null ? `Nothing was restored. ${lines.join("; ")}` : `Recovery group restored. ${lines.join("; ")} Each file is reported separately; the restore is itself in history, so it can be undone.`);
      return;
    }
    const entry = newestFirst.find((candidate) => `entry:${candidate.id}` === chosen);
    if (entry === undefined) return;
    const preview = await workspace.history.preview(entry.id);
    if (preview !== null && ui.showPreview !== undefined) await ui.showPreview(entry.path, preview.bytes, new Date(entry.savedAt).toLocaleString());
    const report = await workspace.restoreHistoryEntry(entry.id);
    const lines = report.files.map((file) => `${file.path === "" ? "Checkpoint" : file.path}: ${file.result}${file.message === undefined ? "" : ` (${file.message})`}`);
    await ui.tell(report.restoreGroupId === null ? `Nothing was restored. ${lines.join("; ")}` : `Restored. ${lines.join("; ")} Each file is reported separately; the restore is itself in history, so it can be undone.`);
  } catch (error) {
    await ui.tell(`History could not be shown: ${error instanceof Error ? error.message : String(error)}`);
  }
}
