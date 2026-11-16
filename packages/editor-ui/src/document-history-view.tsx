import {
  acceptIgnoreOffer,
  diffLines,
  ignoreOffer,
  textOf,
  type AnyDocument,
  type DocumentHistoryEntry,
  type DocumentWorkspace,
  type GroupRestoreReport,
  type HistoryGroup,
  type HistoryUsage,
  type IgnoreOffer,
  type ThinningCandidate,
  type UncoveredFile,
} from "@tk-reawakened/editor-model";
import type { FileSystemService } from "@tk-reawakened/platform-services";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ViewHandle } from "./mount.ts";

export interface DocumentHistoryViewProps {
  readonly workspace: DocumentWorkspace;
  /** The project's files, for the ignore offer. */
  readonly files: Pick<FileSystemService, "list" | "read" | "write">;
  /** The document in front; the Document timeline follows it. */
  readonly activePath: string | null;
  /** Mount the view of a document's kind into an element: the host's own mount, so a preview is the same editor (D12.10 item 13). */
  readonly mountPreview?: (element: HTMLElement, document: AnyDocument) => ViewHandle;
  /** Whether the ignore offer may be shown (the `history.offerIgnore` setting); shown when absent. */
  readonly offerIgnore?: () => Promise<boolean>;
  /** The user chose never to be asked again. */
  readonly onNeverOfferIgnore?: () => void;
}

type Tab = "document" | "project" | "checkpoints";

const KIB = 1024;
const MIB = KIB * KIB;

function sizeText(bytes: number): string {
  return bytes >= MIB ? `${(bytes / MIB).toFixed(1)} MiB` : bytes >= KIB ? `${(bytes / KIB).toFixed(1)} KiB` : `${bytes} bytes`;
}

const REASON_LABEL: Readonly<Record<DocumentHistoryEntry["reason"], string>> = {
  auto: "autosave",
  manual: "saved",
  "before-run": "before a run",
  "before-restore": "before a restore",
  "before-conflict-resolution": "before resolving a conflict",
  "before-delete": "before a delete",
  "before-wizard": "before a wizard",
  checkpoint: "checkpoint",
};

function entryLabel(entry: DocumentHistoryEntry, withPath: boolean): string {
  const merged = entry.merged !== undefined && entry.merged > 1 ? ` · ${entry.merged} saves merged` : "";
  return `${new Date(entry.savedAt).toLocaleString()} · ${withPath ? `${entry.path} · ` : ""}${REASON_LABEL[entry.reason]} · ${sizeText(entry.size)}${merged}${entry.groupId === null ? "" : " · in a group"}`;
}

/** A read-only view of the same editor over saved bytes. It is mounted by the host and disposed with this pane. */
function PreviewPane({ workspace, path, bytes, description, mountPreview, label }: {
  readonly workspace: DocumentWorkspace;
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly description: string;
  readonly mountPreview: (element: HTMLElement, document: AnyDocument) => ViewHandle;
  readonly label: string;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const target = element.current;
    if (target === null) return undefined;
    const opened = workspace.openHistoryPreview(path, bytes, description);
    if (!opened.ok) { setProblem(opened.message); return undefined; }
    setProblem(null);
    let handle: ViewHandle | null = null;
    try { handle = mountPreview(target, opened.document); }
    catch (error) { setProblem(error instanceof Error ? error.message : String(error)); }
    return () => { handle?.dispose(); };
  }, [workspace, path, bytes, description, mountPreview]);
  return <section class="tkr-history-preview" aria-label={label}>
    <h3>{label}</h3>
    {problem === null ? null : <p role="alert">{problem}</p>}
    <div ref={element} class="tkr-history-preview-editor" />
  </section>;
}

function ReportList({ report, onRetry, onDeleteUncertain, onUndo }: {
  readonly report: GroupRestoreReport;
  readonly onRetry: (paths: readonly string[]) => void;
  readonly onDeleteUncertain: (path: string) => void;
  readonly onUndo: () => void;
}) {
  const failed = report.files.filter((file) => file.result === "failed").map((file) => file.path);
  return <section class="tkr-history-report" aria-label="Restore report">
    <h3>Restore report</h3>
    <ul>{report.files.map((file) => <li key={`${file.path}:${file.result}`} data-result={file.result}>
      <strong>{file.path === "" ? "Checkpoint" : file.path}</strong>: {file.result.replace(/-/g, " ")}{file.message === undefined ? "" : ` — ${file.message}`}
      {file.result === "kept-uncertain" && <button type="button" onClick={() => onDeleteUncertain(file.path)}>Delete it anyway</button>}
    </li>)}</ul>
    <p>Each file is restored on its own; nothing here is all-or-nothing.</p>
    {failed.length > 0 && <button type="button" onClick={() => onRetry(failed)}>Retry the files that failed</button>}
    {report.restoreGroupId !== null && <button type="button" onClick={onUndo}>Undo this restore</button>}
  </section>;
}

/** Document and project timelines, checkpoint groups, read-only previews of the same editor, compare, restore, usage and thinning (ADR 0022 D12). */
export function DocumentHistoryView({ workspace, files, activePath, mountPreview, offerIgnore, onNeverOfferIgnore }: DocumentHistoryViewProps) {
  const store = workspace.history;
  const [tab, setTab] = useState<Tab>("document");
  const [version, setVersion] = useState(0);
  const [entries, setEntries] = useState<readonly DocumentHistoryEntry[]>([]);
  const [groups, setGroups] = useState<readonly HistoryGroup[]>([]);
  const [usage, setUsage] = useState<HistoryUsage | null>(null);
  const [uncovered, setUncovered] = useState<readonly UncoveredFile[]>([]);
  const [plan, setPlan] = useState<readonly ThinningCandidate[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [groupPath, setGroupPath] = useState<string | null>(null);
  const [compareWith, setCompareWith] = useState<string>("none");
  const [shown, setShown] = useState<{ readonly path: string; readonly bytes: Uint8Array; readonly description: string } | null>(null);
  const [other, setOther] = useState<{ readonly path: string; readonly bytes: Uint8Array; readonly description: string } | null>(null);
  const [armed, setArmed] = useState<"restore" | "delete" | null>(null);
  const [report, setReport] = useState<GroupRestoreReport | null>(null);
  const [status, setStatus] = useState("");
  const [checkpointName, setCheckpointName] = useState("");
  const [offer, setOffer] = useState<IgnoreOffer>({ offer: false });
  const [problems, setProblems] = useState(store.problems());
  const reload = (): void => setVersion((current) => current + 1);
  const say = (error: unknown): void => setStatus(error instanceof Error ? error.message : String(error));

  useEffect(() => store.subscribe(() => { setProblems(store.problems()); reload(); }), [store]);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        await store.reload();
        const [timeline, groupList, used, notKept] = await Promise.all([
          tab === "project" ? store.projectTimeline() : activePath === null ? Promise.resolve([]) : store.documentTimeline(activePath),
          store.groupTimeline(),
          store.usage(),
          store.uncovered(),
        ]);
        if (!live) return;
        setEntries([...timeline].reverse());
        setGroups([...groupList].reverse());
        setUsage(used);
        setUncovered(notKept);
        setProblems(store.problems());
      } catch (error) { if (live) say(error); }
    })();
    return () => { live = false; };
  }, [store, tab, activePath, version]);
  useEffect(() => {
    let live = true;
    void (async () => {
      const allowed = offerIgnore === undefined ? true : await offerIgnore();
      const result = allowed ? await ignoreOffer(files) : { offer: false as const };
      if (live) setOffer(result);
    })();
    return () => { live = false; };
  }, [files, offerIgnore, version]);

  const choose = async (id: string): Promise<void> => {
    setSelected(id);
    setArmed(null);
    setReport(null);
    setCompareWith("none");
    setOther(null);
    setShown(null);
    try {
      if (tab === "checkpoints") {
        const group = groups.find((candidate) => candidate.id === id);
        const first = group?.before.find((item) => item.sha256 !== null)?.path ?? null;
        setGroupPath(first);
        if (group !== undefined && first !== null) await showGroupFile(group, first);
        return;
      }
      const preview = await store.preview(id);
      if (preview === null) { setStatus("That history entry no longer exists."); return; }
      setShown({ path: preview.entry.path, bytes: preview.bytes, description: new Date(preview.entry.savedAt).toLocaleString() });
      setStatus("");
    } catch (error) { say(error); }
  };
  const showGroupFile = async (group: HistoryGroup, path: string): Promise<void> => {
    setGroupPath(path);
    try {
      const preview = await store.previewGroup(group.id, path);
      setShown(preview === null ? null : { path, bytes: preview.bytes, description: `${group.name ?? "checkpoint"}, ${new Date(group.createdAt).toLocaleString()}` });
    } catch (error) { say(error); }
  };
  const compare = async (target: string): Promise<void> => {
    setCompareWith(target);
    setOther(null);
    if (target === "none" || shown === null) return;
    try {
      if (target === "current") {
        const read = await files.read(shown.path);
        if (!read.ok) { setStatus(`The current file could not be read: ${read.error.message}`); return; }
        setOther({ path: shown.path, bytes: read.value, description: "the file as it is now" });
        return;
      }
      const preview = await store.preview(target);
      if (preview !== null) setOther({ path: preview.entry.path, bytes: preview.bytes, description: new Date(preview.entry.savedAt).toLocaleString() });
    } catch (error) { say(error); }
  };

  const finishRestore = async (result: Promise<GroupRestoreReport>): Promise<void> => {
    try {
      const outcome = await result;
      setReport(outcome);
      setArmed(null);
      setStatus(outcome.restoreGroupId === null ? "Nothing was restored." : "Restore finished. It was recorded as its own group, so it can be undone.");
      reload();
    } catch (error) { say(error); }
  };
  const restore = (): void => {
    if (selected === null) return;
    if (armed !== "restore") { setArmed("restore"); return; }
    void finishRestore(tab === "checkpoints" ? workspace.restoreHistoryGroup(selected) : workspace.restoreHistoryEntry(selected));
  };
  const retry = (paths: readonly string[]): void => { if (selected !== null && tab === "checkpoints") void finishRestore(workspace.restoreHistoryGroup(selected, { only: paths })); else if (selected !== null) void finishRestore(workspace.restoreHistoryEntry(selected)); };
  const deleteUncertain = (path: string): void => { if (selected !== null) void finishRestore(workspace.restoreHistoryGroup(selected, { only: [path], deleteUncertain: [path] })); };
  const undoRestore = (): void => { if (report?.restoreGroupId != null) void finishRestore(workspace.restoreHistoryGroup(report.restoreGroupId)); };

  const createCheckpoint = async (): Promise<void> => {
    try {
      const group = await store.createNamedCheckpoint(checkpointName);
      const skipped = group.uncovered.length;
      setStatus(`Checkpoint “${group.name ?? "Checkpoint"}” saved: ${group.before.length} file${group.before.length === 1 ? "" : "s"} kept${skipped === 0 ? "" : `, ${skipped} not kept by history (listed under the checkpoint)`}.`);
      setCheckpointName("");
      setTab("checkpoints");
      reload();
    } catch (error) { say(error); }
  };
  const remove = async (): Promise<void> => {
    if (selected === null) return;
    if (armed !== "delete") { setArmed("delete"); return; }
    try {
      if (tab === "checkpoints") await store.deleteGroup(selected); else await store.deleteEntry(selected);
      setSelected(null); setShown(null); setArmed(null); setStatus("Deleted from history."); reload();
    } catch (error) { say(error); }
  };
  const thin = async (): Promise<void> => {
    if (plan === null) return;
    try {
      const freed = await store.thin(plan.map((candidate) => candidate.entry.id));
      setStatus(`Thinned ${plan.length} autosave entr${plan.length === 1 ? "y" : "ies"}; ${sizeText(freed)} freed.`);
      setPlan(null);
      reload();
    } catch (error) { say(error); }
  };
  const acceptOffer = async (): Promise<void> => {
    const result = await acceptIgnoreOffer(files);
    setStatus(result.ok ? "Added .tkr-history/ to .gitignore." : result.message);
    reload();
  };

  const selectedGroup = tab === "checkpoints" ? groups.find((group) => group.id === selected) : undefined;
  const rows = tab === "checkpoints" ? groups : entries;
  const sameText = shown !== null && other !== null ? [textOf(shown.bytes), textOf(other.bytes)] as const : null;
  const lineDiff = sameText !== null && sameText[0] !== null && sameText[1] !== null ? diffLines(sameText[0], sameText[1]) : null;
  const comparable = tab === "checkpoints" ? [] : entries.filter((entry) => entry.id !== selected && shown !== null && entry.path === shown.path);

  return <section class="tkr-history" aria-label="Document history">
    <h2>Document history</h2>
    <p data-history-location={store.location.kind}>{store.location.description}</p>
    {problems.length > 0 && <ul role="alert" aria-label="History problems">{problems.map((problem, position) => <li key={position}>{problem.message}</li>)}</ul>}
    {usage !== null && <p data-history-usage>{usage.entries} entries, {usage.groups} groups, {usage.distinctContents} distinct versions, {sizeText(usage.bytes)} used; the warning is at {sizeText(usage.warnBytes)}.</p>}
    {usage?.overWarning === true && <div role="alert" class="tkr-history-warning">
      <p>This project's history is larger than {sizeText(usage.warnBytes)}. Nothing has been removed.</p>
      {plan === null
        ? <button type="button" onClick={() => void store.thinningPlan().then(setPlan, say)}>Show what could be thinned</button>
        : <div>
          <p>{plan.length === 0 ? "No autosave entry is old enough to thin yet." : `${plan.length} autosave entr${plan.length === 1 ? "y" : "ies"} older than the floor can be removed, freeing ${sizeText(plan.reduce((total, candidate) => total + candidate.frees, 0))}. Saves you made yourself, group records and checkpoints are never in this list.`}</p>
          {plan.length > 0 && <button type="button" onClick={() => void thin()}>Remove these {plan.length} entries</button>}
          <button type="button" onClick={() => setPlan(null)}>Keep everything</button>
        </div>}
    </div>}
    {offer.offer && <div role="region" aria-label="Git ignore offer">
      <p>This project is a Git repository. Add <code>{offer.line}</code> to <code>{offer.file}</code> so history is not committed? Nothing is written unless you accept.</p>
      <button type="button" onClick={() => void acceptOffer()}>Add the line</button>
      <button type="button" onClick={() => setOffer({ offer: false })}>Not now</button>
      {onNeverOfferIgnore !== undefined && <button type="button" onClick={() => { onNeverOfferIgnore(); setOffer({ offer: false }); }}>Don't ask again</button>}
    </div>}
    <nav aria-label="History timelines">
      <button type="button" aria-pressed={tab === "document"} onClick={() => { setTab("document"); setSelected(null); setShown(null); }}>Document</button>
      <button type="button" aria-pressed={tab === "project"} onClick={() => { setTab("project"); setSelected(null); setShown(null); }}>Project</button>
      <button type="button" aria-pressed={tab === "checkpoints"} onClick={() => { setTab("checkpoints"); setSelected(null); setShown(null); }}>Checkpoints</button>
    </nav>
    <form onSubmit={(event) => { event.preventDefault(); void createCheckpoint(); }}>
      <label>Checkpoint name <input type="text" value={checkpointName} onInput={(event) => setCheckpointName((event.currentTarget as HTMLInputElement).value)} /></label>
      <button type="submit">Create project checkpoint</button>
    </form>
    {tab === "document" && activePath === null && <p>Open a document to see its history.</p>}
    <ol aria-label="History entries">{rows.map((row) => <li key={row.id}>
      <button type="button" aria-pressed={selected === row.id} onClick={() => void choose(row.id)}>
        {"before" in row
          ? `${new Date(row.createdAt).toLocaleString()} · ${row.name ?? "Checkpoint"} · ${row.kind === "named" ? "named checkpoint" : row.restores === null ? "operation group" : "restore"} · ${row.before.length} files${row.uncovered.length === 0 ? "" : ` · ${row.uncovered.length} not kept`}`
          : entryLabel(row, tab === "project")}
      </button>
    </li>)}</ol>
    {selectedGroup !== undefined && <section aria-label="Checkpoint contents">
      <h3>{selectedGroup.name ?? "Checkpoint"}</h3>
      <ul>{selectedGroup.before.map((item) => <li key={item.path}>
        {item.sha256 === null ? `${item.path} (did not exist)` : <button type="button" aria-pressed={groupPath === item.path} onClick={() => void showGroupFile(selectedGroup, item.path)}>{item.path} · {sizeText(item.size)}</button>}
      </li>)}</ul>
      {selectedGroup.uncovered.length > 0 && <div><p>History does not keep these files, so they cannot be restored:</p>
        <ul>{selectedGroup.uncovered.map((item) => <li key={item.path}>{item.path} ({item.reason === "size" ? `larger than history keeps, ${sizeText(item.size)}` : "a type history does not keep"})</li>)}</ul></div>}
    </section>}
    {shown !== null && mountPreview !== undefined && <div class="tkr-history-compare">
      <PreviewPane workspace={workspace} path={shown.path} bytes={shown.bytes} description={shown.description} mountPreview={mountPreview} label={`Saved version of ${shown.path}`} />
      {other !== null && <PreviewPane workspace={workspace} path={other.path} bytes={other.bytes} description={other.description} mountPreview={mountPreview} label={`Compared with ${other.description}`} />}
    </div>}
    {shown !== null && mountPreview === undefined && <p>This host cannot show a saved version in the editor, so only restore is available.</p>}
    {shown !== null && tab !== "checkpoints" && <label>Compare with{" "}
      <select value={compareWith} onChange={(event) => void compare((event.currentTarget as HTMLSelectElement).value)}>
        <option value="none">Nothing</option>
        <option value="current">The file as it is now</option>
        {comparable.map((entry) => <option key={entry.id} value={entry.id}>{entryLabel(entry, false)}</option>)}
      </select>
    </label>}
    {lineDiff !== null && <pre aria-label="Line comparison">{lineDiff.map((line, position) => <div key={position} data-change={line.kind}>{line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  "}{line.text}</div>)}</pre>}
    {selected !== null && <div class="tkr-history-actions">
      <button type="button" onClick={restore}>{armed === "restore" ? "Confirm restore" : tab === "checkpoints" ? "Restore this group" : "Restore this version"}</button>
      <button type="button" onClick={() => void remove()}>{armed === "delete" ? "Confirm delete" : "Delete from history"}</button>
      {armed !== null && <button type="button" onClick={() => setArmed(null)}>Cancel</button>}
    </div>}
    {report !== null && <ReportList report={report} onRetry={retry} onDeleteUncertain={deleteUncertain} onUndo={undoRestore} />}
    {uncovered.length > 0 && <details><summary>{uncovered.length} saved file{uncovered.length === 1 ? "" : "s"} history does not keep</summary>
      <ul>{uncovered.map((item) => <li key={item.path}>{item.path} — {item.reason === "size" ? `larger than history keeps (${sizeText(item.size)})` : "a type history does not keep"}</li>)}</ul></details>}
    {status !== "" && <p role="status">{status}</p>}
  </section>;
}
