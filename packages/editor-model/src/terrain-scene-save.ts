import type { FileSystemService } from "@tk-reawakened/platform-services";
import type { SaveResult } from "./binary-document.ts";
import type { DocumentHistoryStore } from "./document-history.ts";
import { createSceneBuildOwnership, createSceneBuildOwnershipStorage, type SceneBuildCheck } from "./scene-build-ownership.ts";
import type { TerrainSceneDocument } from "./terrain-scene-document.ts";
import { prepareTerrainSceneProject, writePreparedTerrainSceneProject } from "./terrain-scene-project.ts";

type ConflictReview = (check: SceneBuildCheck) => Promise<readonly string[] | null>;
const reviews = new WeakMap<TerrainSceneDocument, ConflictReview[]>();

/** The attached editor presents generated conflicts; a detached document keeps its safe refusal. */
export function registerTerrainSceneConflictReview(document: TerrainSceneDocument, review: ConflictReview): () => void {
  const mounted = reviews.get(document) ?? [];
  mounted.push(review);
  reviews.set(document, mounted);
  return () => {
    const index = mounted.indexOf(review);
    if (index >= 0) mounted.splice(index, 1);
    if (mounted.length === 0 && reviews.get(document) === mounted) reviews.delete(document);
  };
}

/** Use the same build for toolbar, shortcut, Save All, close-with-save, and Play. */
export function connectTerrainSceneSave(document: TerrainSceneDocument, fs: FileSystemService, history: DocumentHistoryStore, projectId: string): void {
  const saveSource = document.save.bind(document);
  const ownership = createSceneBuildOwnership({ fs, history, storage: createSceneBuildOwnershipStorage(fs), projectId });
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
        let authorized: readonly string[] = [];
        if (prepared.check.conflicts.length > 0) {
          const approved = await reviews.get(document)?.at(-1)?.(prepared.check);
          if (approved == null) return failure(prepared.check.conflicts.map((conflict) => conflict.message).join("; "), "conflict");
          authorized = approved;
        }
        if (document.getSnapshot().text !== text) return retry();
        const saved = await saveSource(reason, options);
        if (!saved.ok) return saved;
        const written = await writePreparedTerrainSceneProject(prepared, ownership, authorized);
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
