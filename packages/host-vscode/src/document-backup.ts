import { createMainDocument, type DocumentStorage, type MainDocument, type DocumentIdentity, type OpenError } from "@tk-reawakened/editor-model";

export type BackupRecoveryResult =
  | { readonly ok: true; readonly document: MainDocument; readonly editId: string }
  | { readonly ok: false; readonly error: OpenError };

/** Reopen serialized model bytes as a dirty document so VS Code can save recovered changes back to the original file. */
export function recoverMainDocument(storage: DocumentStorage, identity: DocumentIdentity, bytes: Uint8Array): BackupRecoveryResult {
  const opened = createMainDocument(storage, identity, bytes);
  if (!opened.ok) return opened;
  const recovered = opened.document.apply({ type: "set-game-title", title: opened.document.getSnapshot().gameTitle });
  if (!recovered.ok) throw new Error(`Could not restore backup for ${identity.path}: ${recovered.rejection.message}`);
  return { ok: true, document: opened.document, editId: recovered.editId };
}
