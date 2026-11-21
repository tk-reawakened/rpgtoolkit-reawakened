import { decodeBoard, foldPath, utf8Encode } from "@tk-reawakened/core";
import { writeScene } from "@tk-reawakened/native-data";
import { importBoardToScene, sceneTargetPath } from "@tk-reawakened/native-data-import";
import { platformError, platformOk, type DialogService, type FileSystemService, type PlatformResult } from "@tk-reawakened/platform-services";
import { withSceneBuildProjectWrite } from "./scene-build-ownership.ts";
import { sameSceneBuildBytes } from "./terrain-scene-project.ts";

type ImportFiles = Pick<FileSystemService, "list" | "read" | "write">;
type ImportPaths = { readonly board: string; readonly scene: string };

/** Walk only the requested path, keeping stored case and refusing links before reading through them. */
async function locateImport(fs: ImportFiles, requested: string): Promise<PlatformResult<ImportPaths>> {
  const parts = requested.split("/");
  const file = parts.pop()!;
  let folder = "";
  for (const part of parts) {
    const listing = await fs.list(folder);
    if (!listing.ok) return listing;
    const matches = listing.value.filter(({ name }) => foldPath(name) === foldPath(part));
    if (matches.length !== 1 || matches[0]!.kind !== "directory") {
      return platformError("invalid-path", `Cannot safely resolve the folder for ${requested}: ${part} is missing, not a folder, or ambiguous.`);
    }
    folder = folder === "" ? matches[0]!.name : `${folder}/${matches[0]!.name}`;
  }
  const listing = await fs.list(folder);
  if (!listing.ok) return listing;
  const matches = listing.value.filter(({ name }) => foldPath(name) === foldPath(file));
  if (matches.length === 0) return platformError("not-found", `Board ${requested} was not found.`);
  if (matches.length !== 1 || matches[0]!.kind !== "file") {
    return platformError("invalid-path", `Cannot safely read ${requested}: it is not a file or its name is ambiguous.`);
  }
  const board = `${folder}/${matches[0]!.name}`;
  const scene = sceneTargetPath(board);
  if (scene === undefined) return platformError("invalid-path", `${board} needs a name before the .brd extension.`);
  const sceneName = scene.slice(folder.length + 1);
  const existing = listing.value.find(({ name }) => foldPath(name) === foldPath(sceneName));
  if (existing !== undefined) return platformError("already-exists", `${folder}/${existing.name} already exists. Import never replaces an existing file or folder.`);
  return platformOk({ board, scene });
}

/** Explicit board import (docs/spec/formats/native-scene.md#import-from-a-board-to-a-scene). A null result is cancellation. */
export async function importSavedBoardAsScene(options: {
  readonly fs: ImportFiles;
  readonly dialogs: Pick<DialogService, "ask">;
  readonly projectId: string;
  readonly boardPath: string;
  readonly hasPendingEdits: () => boolean;
}): Promise<PlatformResult<string | null>> {
  const { fs, dialogs, projectId, boardPath, hasPendingEdits } = options;
  if (!/^(?:game\/[^/]+\/)?boards\/(?:[^/]+\/)*[^/]+\.brd$/i.test(boardPath) || /[\\:\u0000-\u001f\u007f]/.test(boardPath) || boardPath.split("/").some((part) => part === "." || part === "..")) {
    return platformError("invalid-path", `Import requires a .brd file under Boards/ or Game/<game>/Boards/: ${boardPath}.`);
  }
  const pending = () => platformError("invalid-request", `Save or discard the pending edits to ${boardPath} before importing it.`);
  if (hasPendingEdits()) return pending();
  const located = await locateImport(fs, boardPath);
  if (!located.ok) return located;
  const { board, scene } = located.value;
  const source = await fs.read(board);
  if (!source.ok) return source;
  const decoded = decodeBoard(source.value);
  if (!decoded.ok) return platformError("invalid-request", `${board}: ${decoded.error.message}`);
  const imported = importBoardToScene(decoded.value.board, { boardName: board, existingPaths: [] });
  if (!imported.ok) return platformError("invalid-request", `${board}: ${imported.findings.map(({ field, path, message }) => `${field} (${path}) — ${message}`).join("; ")}`);
  const written = writeScene(imported.scene);
  if (!written.ok) return platformError("invalid-request", `${board}: ${written.problems.map(({ path, message }) => `${path} — ${message}`).join("; ")}`);

  const findings = [
    ...decoded.warnings.map((message) => `Board reader: ${message}`),
    ...imported.findings.map(({ severity, field, path, message }) => `${severity}: ${field} (${path}) — ${message}`),
  ];
  if (hasPendingEdits()) return pending();
  const answer = await dialogs.ask({
    message: `Import ${board} as a scene?`,
    detail: `Creates ${scene} only. The original board and game links stay unchanged. Replacing the board in a later build requires separate approval. ${findings.length === 0 ? "No conversion warnings or notes." : findings.join("; ")}`,
    choices: [{ id: "cancel", label: "Cancel" }, { id: "import", label: "Import as Scene" }],
    cancel: "cancel",
  });
  if (answer !== "import") return platformOk(null);
  return withSceneBuildProjectWrite(projectId, async () => {
    const current = await locateImport(fs, boardPath);
    if (!current.ok) return current;
    const fresh = await fs.read(current.value.board);
    if (!fresh.ok) return fresh;
    if (current.value.board !== board || current.value.scene !== scene || !sameSceneBuildBytes(source.value, fresh.value)) {
      return platformError("invalid-request", `${board} changed during import review. Review the current board and try again.`);
    }
    if (hasPendingEdits()) return pending();
    const saved = await fs.write(scene, utf8Encode(written.text));
    return saved.ok ? platformOk(scene) : platformError(saved.error.code, `Could not create ${scene}: ${saved.error.message}`);
  });
}
