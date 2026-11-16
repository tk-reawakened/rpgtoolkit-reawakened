// The native/browser proof of story 11.14's history (ADR 0022 D12), as an isolated helper so the host proofs
// (`run.mjs`, `web-proof.ts`) call it instead of reimplementing the feature. It reads only what the host produced.
import { sha256Hex, type DocumentWorkspace, type HistoryGroup } from "@tk-reawakened/editor-model";
import type { FileSystemService } from "@tk-reawakened/platform-services";

const GROUP_FOLDER = ".tkr-history/groups";

/** Read the one group the wizard recorded in the produced project, and check it against the files the wizard wrote. */
export async function proveWizardGroup(
  fs: Pick<FileSystemService, "list" | "read">,
  written: readonly string[],
  expectedName: string,
): Promise<{ readonly ok: boolean; readonly problems: readonly string[] }> {
  const problems: string[] = [];
  const listed = await fs.list(GROUP_FOLDER);
  if (!listed.ok) return { ok: false, problems: [`no history group folder in the produced project: ${listed.error.message}`] };
  const names = listed.value.filter((entry) => entry.kind === "file" && entry.name.endsWith(".json"));
  if (names.length !== 1) problems.push(`expected one group record, found ${names.length}`);
  const read = await fs.read(`${GROUP_FOLDER}/${names[0]?.name ?? ""}`);
  if (!read.ok) return { ok: false, problems: [...problems, `the group record could not be read: ${read.error.message}`] };
  const group = JSON.parse(new TextDecoder().decode(read.value)) as HistoryGroup;
  if (group.kind !== "group" || group.name !== expectedName) problems.push(`group is ${group.kind}/${group.name}, expected group/${expectedName}`);
  const planned = group.before.map((item) => item.path);
  if (planned.join("\n") !== [...written].join("\n")) problems.push(`planned ${planned.join(", ")}, wizard wrote ${written.join(", ")}`);
  if (group.before.some((item) => item.sha256 !== null)) problems.push("a destination that did not exist was not recorded as absent (sha256 null)");
  const registered = new Map(group.written.map((item) => [item.path, item.sha256] as const));
  for (const path of written) {
    const bytes = await fs.read(path);
    if (!bytes.ok) { problems.push(`${path} was written but cannot be read: ${bytes.error.message}`); continue; }
    const hash = await sha256Hex(bytes.value);
    if (registered.get(path) !== hash) problems.push(`${path} was not registered with the hash of its bytes`);
  }
  if (group.written.length !== written.length) problems.push(`registered ${group.written.length} writes for ${written.length} files`);
  return { ok: problems.length === 0, problems };
}

/** The restore lifecycle on a project the host produced: save, restore an older version, then restore that restore. */
export async function proveRestoreLifecycle(
  workspace: DocumentWorkspace,
  path: string,
  setTitle: (document: { apply(command: never): { ok: boolean } }, title: string) => void,
): Promise<{ readonly ok: boolean; readonly problems: readonly string[] }> {
  const problems: string[] = [];
  const opened = await workspace.open(path);
  if (!opened.ok) return { ok: false, problems: [`${path} did not open: ${JSON.stringify(opened.error)}`] };
  const document = opened.document;
  // Two saved versions first: the proof is about restoring, not about what the host's first save does.
  for (const title of ["Proof A", "Restored by the proof"]) {
    setTitle(document as never, title);
    const saved = await document.save("manual");
    if (!saved.ok) problems.push(`the proof save failed: ${saved.failure.message}`);
  }
  const timeline = await workspace.history.documentTimeline(path);
  if (timeline.length === 0) return { ok: false, problems: [`${path} has no history after saving`] };
  const oldest = timeline[0]!;
  const restored = await workspace.restoreHistoryEntry(oldest.id);
  if (restored.restoreGroupId === null) problems.push(`restore reported no restore group: ${restored.files.map((file) => `${file.path}:${file.result}`).join(", ")}`);
  if (restored.files.some((file) => file.result !== "restored" && file.result !== "already-as-wanted")) problems.push(`restore file results: ${restored.files.map((file) => `${file.path}:${file.result}`).join(", ")}`);
  if (restored.restoreGroupId !== null) {
    const undone = await workspace.restoreHistoryGroup(restored.restoreGroupId);
    if (undone.files.some((file) => file.result !== "restored" && file.result !== "already-as-wanted")) problems.push(`undoing the restore failed: ${undone.files.map((file) => `${file.path}:${file.result}`).join(", ")}`);
  }
  return { ok: problems.length === 0, problems };
}
