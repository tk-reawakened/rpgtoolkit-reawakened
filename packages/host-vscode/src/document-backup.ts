import { createMainDocument, type DocumentIdentity, type DocumentStorage, type MainDocument, type OpenError } from "@tk-reawakened/editor-model";

export type BackupRecoveryResult =
  | { readonly ok: true; readonly document: MainDocument; readonly editId: string }
  | { readonly ok: false; readonly error: OpenError };

/**
 * Reopen a hot-exit backup as a dirty document so VS Code can save the recovered changes to the original file. The
 * document is opened over what the file holds **now** and the backup's title is applied as one undoable edit: undo shows
 * the file as it is, the save compares against it (ADR 0022 D3.5), and a file that changed while VS Code was closed
 * keeps its other changes. Only when the file cannot be opened is the backup itself the document's starting point; its
 * first save then finds the file missing or different and keeps both versions until the user chooses (D3.5).
 */
export async function recoverMainDocument(storage: DocumentStorage, identity: DocumentIdentity, backup: Uint8Array): Promise<BackupRecoveryResult> {
  const recovered = createMainDocument(storage, identity, backup);
  if (!recovered.ok) return recovered;
  const title = recovered.document.getSnapshot().gameTitle;
  const onDisk = await storage.readProject(identity.projectId, identity.path);
  const current = onDisk.ok ? createMainDocument(storage, identity, onDisk.value) : null;
  const document = current?.ok === true && current.document.getSnapshot().readOnly === null ? current.document : recovered.document;
  const edit = document.apply({ type: "set-game-title", title });
  if (!edit.ok) throw new Error(`Could not restore backup for ${identity.path}: ${edit.rejection.message}`);
  return { ok: true, document, editId: edit.editId };
}
