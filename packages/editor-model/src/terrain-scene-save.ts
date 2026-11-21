import type { FileSystemService } from "@tk-reawakened/platform-services";
import type { SaveResult } from "./binary-document.ts";
import type { DocumentHistoryStore } from "./document-history.ts";
import { createSceneBuildOwnership, createSceneBuildOwnershipStorage } from "./scene-build-ownership.ts";
import type { TerrainSceneDocument } from "./terrain-scene-document.ts";
import { prepareTerrainSceneProject, writePreparedTerrainSceneProject } from "./terrain-scene-project.ts";

/** Use the same build for toolbar, shortcut, Save All, close-with-save, and Play. */
export function connectTerrainSceneSave(document: TerrainSceneDocument, fs: FileSystemService, history: DocumentHistoryStore): void {
  const saveSource = document.save.bind(document);
  const ownership = createSceneBuildOwnership({ fs, history, storage: createSceneBuildOwnershipStorage(fs) });
  const path = document.identity.path;
  const failure = (message: string, kind: "write" | "conflict" = "write"): SaveResult => ({ ok: false, failure: { document: path, kind, code: null, message } });
  let pending = Promise.resolve();
  document.save = (reason, options) => {
    const requested = document.getSnapshot();
    const retry = () => failure(`${path} changed during the build. Save again.`);
    const save = pending.then(async (): Promise<SaveResult> => {
      try {
        if (requested.readOnly !== null) return saveSource(reason, options);
        if (document.getSnapshot().text !== requested.text) return retry();
        let text = requested.text;
        if (!requested.dirty) {
          const check = await document.checkExternal();
          if (check === "unknown") return failure(`Could not check ${path} before building.`);
          if (check === "conflict") return failure(`${path} changed on disk. Resolve the source conflict before building.`, "conflict");
          if (check === "reloaded" && !document.getSnapshot().dirty) text = document.getSnapshot().text;
        }
        const prepared = await prepareTerrainSceneProject({ fs, scenePath: path, sceneText: text, ownership });
        if (!prepared.ok) return failure(prepared.problems.map((problem) => `${problem.path}: ${problem.message}`).join("; "));
        if (prepared.check.conflicts.length > 0) return failure(prepared.check.conflicts.map((conflict) => conflict.message).join("; "), "conflict");
        if (document.getSnapshot().text !== text) return retry();
        const saved = await saveSource(reason, options);
        if (!saved.ok) return saved;
        const written = await writePreparedTerrainSceneProject(prepared, ownership);
        if (written.ok) return saved;
        const outcomes = written.outcomes.map(({ path: output, message }) => `${output}: ${message}`);
        return failure(`${path} was saved, but its generated outputs are not current: ${[written.message, ...outcomes].join("; ")}`);
      } catch (error) {
        return failure(`Could not build ${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    pending = save.then(() => undefined);
    return save;
  };
}
