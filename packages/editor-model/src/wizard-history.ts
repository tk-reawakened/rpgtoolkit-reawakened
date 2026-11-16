import type { FileSystemService } from "@tk-reawakened/platform-services";
import { createDocumentHistoryStore, type DocumentHistoryStore } from "./document-history.ts";
import { DEFAULT_HISTORY_POLICY } from "./history-policy.ts";
import { kindForPath } from "./kinds.ts";

/**
 * The history a multi-file wizard records (ADR 0022 D12.3, D12.10 item 6): one group naming every planned destination,
 * absent ones included, durably recorded before the wizard's first write, with each written file registered by the hash of
 * its bytes so a restore can prove which created files are the operation's own. A wizard that cannot record its group
 * writes nothing, and a file whose registration fails is reported, never hidden.
 */
export interface WizardHistory {
  begin(name: string, planned: readonly string[]): Promise<{ readonly ok: true; readonly groupId: string } | { readonly ok: false; readonly message: string }>;
  written(groupId: string, path: string, bytes: Uint8Array): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
}

/** The wizard history over an existing project's store. */
export function createWizardHistory(store: DocumentHistoryStore): WizardHistory {
  return {
    async begin(name, planned) {
      try { return { ok: true, groupId: (await store.beginGroup({ name, paths: planned })).id }; }
      catch (error) { return { ok: false, message: error instanceof Error ? error.message : String(error) }; }
    },
    async written(groupId, path, bytes) {
      try { await store.registerWritten(groupId, path, bytes); return { ok: true }; }
      catch (error) { return { ok: false, message: error instanceof Error ? error.message : String(error) }; }
    },
  };
}

/**
 * The wizard history for a destination that is not an open project yet (a new project folder): a store over the same
 * filesystem, so the history lands in the new project's own `.tkr-history` folder and travels with it (D12.7).
 */
export function createProjectWizardHistory(fs: Pick<FileSystemService, "read" | "write" | "createFolder" | "list" | "delete" | "stat">): WizardHistory {
  return createWizardHistory(createDocumentHistoryStore({
    project: fs,
    storage: fs,
    location: { kind: "project-folder", description: "Kept in the project's .tkr-history folder, so it travels with the project." },
    policy: () => DEFAULT_HISTORY_POLICY,
    coveredType: (path) => kindForPath(path) !== null,
  }));
}
