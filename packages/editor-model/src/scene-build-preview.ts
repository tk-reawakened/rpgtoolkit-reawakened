import { foldPath } from "@tk-reawakened/core";
import type { DirectoryEntry } from "@tk-reawakened/platform-services";
import { boardPreviewRootForPath, previewBoard, type BoardPreview, type BoardPreviewOptions, type PreviewStorage } from "./board-preview.ts";
import type { SceneBuildProblem, SceneBuildResult } from "./scene-build.ts";

export type SceneBuildPreview =
  | { readonly ok: true; readonly preview: Extract<BoardPreview, { readonly ok: true }>; readonly notes: readonly SceneBuildProblem[] }
  | { readonly ok: false; readonly problems: readonly SceneBuildProblem[] };

/** Preview the exact generated board and art without writing any project files. */
export async function previewBuiltScene(storage: PreviewStorage, projectId: string, scenePath: string, built: Extract<SceneBuildResult, { readonly ok: true }>, options: BoardPreviewOptions): Promise<SceneBuildPreview> {
  const outputFiles = new Map(built.outputs.map((output) => [foldPath(output.path), output.bytes]));
  const generatedEntries = new Map<string, Map<string, DirectoryEntry>>();
  for (const { path } of built.outputs) {
    const segments = path.split("/");
    for (let i = 0; i < segments.length; i += 1) {
      const parent = foldPath(segments.slice(0, i).join("/"));
      const name = segments[i]!;
      let entries = generatedEntries.get(parent);
      if (entries === undefined) { entries = new Map(); generatedEntries.set(parent, entries); }
      entries.set(foldPath(name), { name, kind: i === segments.length - 1 ? "file" : "directory" });
    }
  }
  const overlay: PreviewStorage = {
    async list(path) {
      const disk = await storage.list(path);
      const added = generatedEntries.get(foldPath(path));
      if (!disk.ok && (added === undefined || disk.error.code !== "not-found")) return disk;
      const entries = new Map((disk.ok ? disk.value : []).map((entry) => [foldPath(entry.name), entry]));
      for (const [key, entry] of added ?? []) {
        if (entry.kind === "file" || !entries.has(key)) entries.set(key, entry);
      }
      return { ok: true, value: [...entries.values()] };
    },
    async readProject(id, path) {
      const generated = id === projectId ? outputFiles.get(foldPath(path)) : undefined;
      return generated === undefined ? storage.readProject(id, path) : { ok: true, value: generated };
    },
  };
  const boardPath = `${scenePath.slice(0, -7)}.brd`;
  const board = outputFiles.get(foldPath(boardPath));
  if (board === undefined) return { ok: false, problems: [{ path: boardPath, message: "The build did not produce its board." }] };
  const preview = await previewBoard(overlay, projectId, board, { root: boardPreviewRootForPath(scenePath), ...options });
  return preview.ok ? { ok: true, preview, notes: built.notes } : { ok: false, problems: [{ path: boardPath, message: preview.message }] };
}
