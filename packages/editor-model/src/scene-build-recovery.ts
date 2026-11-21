import { BinaryReader, readBoard } from "@tk-reawakened/core";
import { writeScene } from "@tk-reawakened/native-data";
import { recoverBoardToScene, type SceneImportFinding } from "@tk-reawakened/native-data-import";

export type SceneBuildRecovery =
  | { readonly ok: true; readonly path: string; readonly text: string; readonly findings: readonly SceneImportFinding[] }
  | { readonly ok: false; readonly problems: readonly { readonly path: string; readonly message: string }[] };

/** Prepare a separate scene for review from an externally edited board. Writes nothing. */
export function proposeSceneBuildRecovery(boardPath: string, boardBytes: Uint8Array, existingPaths: readonly string[]): SceneBuildRecovery {
  const board = readBoard(new BinaryReader(boardBytes, boardPath));
  if (!board.ok) return { ok: false, problems: [{ path: boardPath, message: board.error.message }] };
  const imported = recoverBoardToScene(board.value, { boardName: boardPath, existingPaths });
  if (!imported.ok) return { ok: false, problems: imported.findings.filter((finding) => finding.severity === "refusal").map((finding) => ({ path: finding.path, message: finding.message })) };
  const written = writeScene(imported.scene);
  if (!written.ok) return { ok: false, problems: written.problems.map((problem) => ({ path: problem.path, message: problem.message })) };
  return { ok: true, path: imported.scenePath, text: written.text, findings: imported.findings };
}
