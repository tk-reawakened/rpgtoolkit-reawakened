import type { FileSystemService } from "@tk-reawakened/platform-services";
import { createCheckpointGroups, type CheckpointGroups } from "./checkpoint-groups.ts";
import { sha256Hex } from "./document-history.ts";

/**
 * A wizard's write-ahead recovery group (ADR 0022 D12.3, D12.10 item 6). The canonical checkpoint store owns the
 * manifest and content bytes; this small boundary only adapts wizard write receipts.
 */
export interface WizardHistory {
  begin(name: string, planned: readonly string[]): Promise<{ readonly ok: true; readonly groupId: string } | { readonly ok: false; readonly message: string }>;
  written(groupId: string, path: string, bytes: Uint8Array): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
}

export function createWizardHistory(groups: CheckpointGroups): WizardHistory {
  return {
    async begin(name, planned) {
      const result = await groups.begin(planned, name);
      return result.ok ? { ok: true, groupId: result.value.id } : { ok: false, message: result.error.message };
    },
    async written(groupId, path, bytes) {
      const result = await groups.registerWritten(groupId, path, bytes);
      return result.ok ? { ok: true } : { ok: false, message: result.error.message };
    },
  };
}

let projectWizardSequence = 0;

/** New-project history is written by the same checkpoint service into the chosen destination's canonical history folder. */
export function createProjectWizardHistory(fs: FileSystemService, projectId: string): WizardHistory {
  const groups = createCheckpointGroups({
    fs,
    storage: fs,
    projectId,
    hash: sha256Hex,
    newId: () => `wizard-${Date.now().toString(36)}-${(++projectWizardSequence).toString(36)}`,
    time: () => new Date().toISOString(),
    guard: async () => null,
    consent: async (paths) => paths.length === 0,
  });
  return createWizardHistory(groups);
}
