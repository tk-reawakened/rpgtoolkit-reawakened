import { createDocumentIdentity, type CheckpointEnvironment } from "@tk-reawakened/editor-model";
import type { WebProject } from "./index.ts";

export function webCheckpointEnvironment(project: WebProject, allowedKey?: string): CheckpointEnvironment {
  return {
    fs: project.services.fs,
    projectId: project.project.id,
    hash: async (bytes) => [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes.slice().buffer))].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    newId: () => globalThis.crypto.randomUUID(),
    time: () => new Date().toISOString(),
    guard: async (path, removing) => {
      const key = createDocumentIdentity(project.project.id, path).key;
      const opened = project.workspace.documents().find((doc) => doc.identity.key === key);
      if (opened === undefined) return null;
      const state = opened.getSnapshot();
      return key === allowedKey && !removing && !state.dirty && !state.saving && state.conflict === null ? null : `Save or resolve your work and close ${path} before replacing or removing it.`;
    },
    consent: async (paths) => await project.services.dialogs.ask({ message: "Replace these files?", detail: `${paths.join(", ")}. Original contents will remain in project recovery history.`, choices: [{ id: "replace", label: "Replace" }, { id: "cancel", label: "Cancel" }], cancel: "cancel" }) === "replace",
  };
}
