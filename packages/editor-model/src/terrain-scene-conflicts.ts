import { utf8Encode } from "@tk-reawakened/core";
import type { FileSystemService } from "@tk-reawakened/platform-services";
import { sha256Hex } from "./document-history.ts";
import { proposeSceneBuildRecovery } from "./scene-build-recovery.ts";
import { withSceneBuildProjectWrite, type SceneBuildCheck, type SceneBuildConflictKind } from "./scene-build-ownership.ts";

/** What a host shows for one destination; the hashes identify the exact bytes reviewed. */
export interface TerrainSceneConflictChoice {
  readonly path: string;
  readonly kind: SceneBuildConflictKind;
  readonly message: string;
  readonly plannedHash: string;
  readonly currentHash: string | null;
}

/** A recovery proposal for review; it has not been written. */
export interface TerrainSceneRecoveryReview {
  readonly boardPath: string;
  readonly path: string;
  readonly findings: readonly { readonly severity: string; readonly field: string; readonly path: string; readonly message: string }[];
}

export interface TerrainSceneConflictDialogs {
  /** Show the exact proposal and its findings; false includes dismissal. */
  reviewRecovery(proposal: TerrainSceneRecoveryReview): Promise<boolean>;
  /** Authorize or decline these exact destinations. */
  reviewOutputs(conflicts: readonly TerrainSceneConflictChoice[]): Promise<boolean>;
  report(message: string): void;
}

const fold = (path: string): string => path.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** The board this scene builds; a scene's own `.brd` is the only destination with a recovery import. */
export function terrainSceneBoardPath(scenePath: string): string | null {
  return scenePath.toLowerCase().endsWith(".tkrscn") ? `${scenePath.slice(0, -7)}.brd` : null;
}

/**
 * Review conflicts without mutating the original scene or board. An outside edit to this scene's board offers the
 * separate recovery scene; every other conflict returns the explicitly authorized paths for the ownership write.
 */
export async function reviewTerrainSceneConflicts(
  fs: Pick<FileSystemService, "list" | "read" | "write">,
  check: SceneBuildCheck,
  dialogs: TerrainSceneConflictDialogs,
  projectId?: string,
): Promise<readonly string[] | null> {
  const expectedBoard = terrainSceneBoardPath(check.scene);
  const board = expectedBoard === null ? undefined : check.conflicts.find((conflict) => conflict.kind === "modified" && fold(conflict.path) === fold(expectedBoard));
  if (board !== undefined) {
    const observation = check.observations.find((entry) => entry.path === board.path);
    if (observation === undefined || observation.currentHash === null) {
      dialogs.report("The board is missing from the reviewed build; nothing was recovered.");
      return null;
    }
    const resolvedBoard = observation.resolvedPath;
    const source = await fs.read(check.scene);
    const current = await fs.read(resolvedBoard);
    if (!source.ok || !current.ok || await sha256Hex(current.value) !== observation.currentHash) {
      dialogs.report("The scene or board changed before recovery review; save again.");
      return null;
    }
    const slash = resolvedBoard.lastIndexOf("/");
    const folder = slash < 0 ? "" : resolvedBoard.slice(0, slash);
    const entries = await fs.list(folder);
    if (!entries.ok) { dialogs.report(`Cannot inspect the recovery destination: ${entries.error.message}`); return null; }
    const existing = entries.value.map(({ name }) => folder === "" ? name : `${folder}/${name}`);
    const proposal = proposeSceneBuildRecovery(resolvedBoard, current.value, existing);
    if (!proposal.ok) { dialogs.report(proposal.problems.map(({ path, message }) => `${path}: ${message}`).join("; ")); return null; }
    if (fold(proposal.path) === fold(check.scene) || fold(proposal.path) === fold(resolvedBoard)) {
      dialogs.report("The recovery destination would replace the scene or board; nothing was written.");
      return null;
    }
    if (!await dialogs.reviewRecovery({ boardPath: resolvedBoard, path: proposal.path, findings: proposal.findings })) return null;
    await withSceneBuildProjectWrite(projectId ?? fs, async () => {
      const latestBoard = await fs.read(resolvedBoard);
      const latestScene = await fs.read(check.scene);
      if (!latestBoard.ok || !latestScene.ok || await sha256Hex(latestBoard.value) !== observation.currentHash ||
          await sha256Hex(latestScene.value) !== await sha256Hex(source.value)) {
        dialogs.report("The board or scene changed during review; nothing was written.");
        return;
      }
      const latestEntries = await fs.list(folder);
      if (!latestEntries.ok || latestEntries.value.some(({ name }) => fold(folder === "" ? name : `${folder}/${name}`) === fold(proposal.path))) {
        dialogs.report("The recovery destination changed during review; nothing was written.");
        return;
      }
      const written = await fs.write(proposal.path, utf8Encode(proposal.text));
      dialogs.report(written.ok
        ? `Recovery scene written to ${proposal.path}; the original scene and ${resolvedBoard} were left unchanged.`
        : `Could not write the recovery scene: ${written.error.message}`);
    });
    return null;
  }
  if (check.conflicts.length === 0) return [];
  const otherProducer = check.conflicts.find(({ kind }) => kind === "owner-mismatch");
  if (otherProducer !== undefined) {
    dialogs.report(`${otherProducer.path} is claimed by a different build producer. Change the output destination before rebuilding.`);
    return null;
  }
  const conflicts = check.conflicts.map((conflict) => {
    const observation = check.observations.find((entry) => entry.path === conflict.path);
    return { ...conflict, plannedHash: observation?.plannedHash ?? "", currentHash: observation?.currentHash ?? null };
  });
  return await dialogs.reviewOutputs(conflicts) ? check.conflicts.map(({ path }) => path) : null;
}
