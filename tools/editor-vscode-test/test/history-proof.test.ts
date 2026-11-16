import { readFileSync } from "node:fs";
// The helper the host proofs call: proven here against the memory host, so the native proof only has to drive its host.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { createDocumentWorkspace, createNewProject, createProjectWizardHistory } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { proveRestoreLifecycle, proveWizardGroup } from "../history-proof.ts";

test("the wizard-group proof reads a produced project's group and checks every planned and written path", async () => {
  const host = createMemoryPlatformServices();
  const created = await createNewProject(host.fs, { gameName: "Proof Quest", mainFile: "Proof.gam", starters: [] }, undefined, createProjectWizardHistory(host.fs));
  ok(created.ok);
  const good = await proveWizardGroup(host.fs, created.written, "New project");
  deepEqual(good, { ok: true, problems: [] });
  const wrong = await proveWizardGroup(host.fs, [...created.written, "Main/never.gam"], "New project");
  equal(wrong.ok, false);
  ok(wrong.problems.some((problem) => problem.includes("Main/never.gam")));
});

test("the restore lifecycle proof saves, restores and restores the restore on a real workspace", async () => {
  const host = createMemoryPlatformServices({ files: { "Main/Proof.gam": new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/main/main_minor9.gam", import.meta.url))) } });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const result = await proveRestoreLifecycle(workspace, "Main/Proof.gam", (document, title) => { document.apply({ type: "set-game-title", title } as never); });
  deepEqual(result, { ok: true, problems: [] });
  workspace.dispose();
});
